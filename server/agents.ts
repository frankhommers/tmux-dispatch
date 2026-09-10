import { EventEmitter } from 'node:events';
import type { WebSocket } from 'ws';
import {
  PROTOCOL_VERSION,
  isCompatible,
  parseAgentMessage,
  type AgentIdentity,
  type ServerToDispatch,
  type DispatchToServer,
  type WireCandidate,
  type WireGrant,
} from './protocol.js';

/**
 * Every MCP server dispatch knows about and what it currently holds.
 *
 * Dispatch holds no tmux knowledge: a request arrives with its candidates, and
 * an answer is a name the agent then validates. Requests live only as long as
 * the socket that carries them, because answering a dead socket is a lie.
 *
 * Grants are different. An idle agent reports what it holds and hangs up, so
 * an entry outlives its socket for as long as it still has something handed
 * to it. The agent's instanceId is what makes that the same machine rather
 * than a new one, and it asks before every action, so taking a pane back
 * lands even while nothing is connected.
 */

export interface OpenRequest {
  id: string;
  agentId: string;
  reason: string;
  kind: 'pane' | 'window';
  createdAt: number;
  expiresAt: number;
  candidates: WireCandidate[];
  /** What the agent would like, if it said. A hint, never matched automatically. */
  suggested?: string;
  /** Set when the pool answered it without asking a human. */
  autoAssigned?: { target: string; entryId: number };
  /** Last failure reported by the agent, shown to the human. */
  lastError?: string;
}

export interface ConnectedAgent {
  id: string;
  accountId: number;
  deviceId: number | null;
  identity: AgentIdentity;
  connectedAt: number;
  lastSeen: number;
  connected: boolean;
  grants: WireGrant[];
  /** Targets the human took back, and when. A check for one of these is refused. */
  revoked: Map<string, number>;
  /**
   * When each target was last acted on. An agent asks before every action, so
   * its checks are the only activity dispatch can honestly report.
   */
  activity: Map<string, number>;
}

let nextAnonymousId = 1;

export class AgentRegistry extends EventEmitter {
  private readonly sockets = new Map<string, WebSocket>();
  private readonly agents = new Map<string, ConnectedAgent>();
  private readonly requests = new Map<string, OpenRequest>();

  /** Take over a freshly authenticated socket and run the handshake on it. */
  accept(socket: WebSocket, accountId: number, deviceId: number | null, accountName: string): void {
    let id: string | null = null;

    socket.on('message', data => {
      const message = parseAgentMessage(String(data));
      if (!message) return;

      if (id === null) {
        if (message.type !== 'hello') return;
        if (!isCompatible(message.protocolVersion)) {
          this.send(socket, {
            type: 'refuse',
            reason: 'protocol_version',
            protocolVersion: PROTOCOL_VERSION,
          });
          socket.close();
          return;
        }
        // A 1.0 server has no instanceId; it is a new machine every dial-in.
        id = message.agent.instanceId ?? `anon-${nextAnonymousId++}`;
        this.sockets.set(id, socket);
        const known = this.agents.get(id);
        this.agents.set(id, {
          id,
          accountId,
          deviceId,
          identity: message.agent,
          connectedAt: known?.connectedAt ?? Date.now(),
          lastSeen: Date.now(),
          connected: true,
          grants: known?.grants ?? [],
          revoked: known?.revoked ?? new Map(),
          activity: known?.activity ?? new Map(),
        });
        this.send(socket, { type: 'welcome', protocolVersion: PROTOCOL_VERSION, account: accountName });
        this.emit('change', accountId);
        return;
      }

      this.handle(id, accountId, message);
    });

    socket.on('close', () => {
      if (id === null) return;
      // A newer socket for the same server may already have taken over.
      if (this.sockets.get(id) !== socket) return;
      this.sockets.delete(id);
      for (const [requestId, request] of this.requests) {
        if (request.agentId === id) this.requests.delete(requestId);
      }
      const agent = this.agents.get(id);
      if (agent) {
        agent.connected = false;
        agent.lastSeen = Date.now();
        // Nothing handed out and nothing to take back: nothing to show either.
        if (agent.grants.length === 0 && agent.revoked.size === 0) this.agents.delete(id);
      }
      this.emit('change', accountId);
    });

    socket.on('error', () => { /* 'close' follows */ });
  }

  private handle(agentId: string, accountId: number, message: ServerToDispatch): void {
    const agent = this.agents.get(agentId);
    if (agent) agent.lastSeen = Date.now();

    switch (message.type) {
      case 'request': {
        this.requests.set(message.id, {
          id: message.id,
          agentId,
          reason: message.reason,
          kind: message.kind,
          createdAt: message.createdAt,
          expiresAt: message.expiresAt,
          candidates: message.candidates,
          suggested: message.suggested,
        });
        this.emit('request', accountId, this.requests.get(message.id)!);
        this.emit('change', accountId);
        return;
      }
      case 'candidates': {
        const request = this.requests.get(message.id);
        if (!request) return;
        request.candidates = message.candidates;
        this.emit('change', accountId);
        return;
      }
      case 'withdraw': {
        this.requests.delete(message.id);
        this.emit('change', accountId);
        return;
      }
      case 'result': {
        const request = this.requests.get(message.id);
        if (!request) return;
        if (message.ok) {
          this.requests.delete(message.id);
        } else {
          // The agent refused the target: put the reason in front of the human
          // and leave the request open.
          request.lastError = message.error;
          delete request.autoAssigned;
        }
        this.emit('change', accountId);
        return;
      }
      case 'grants': {
        if (!agent) return;
        this.settleRevocations(agent, message.grants);
        // An agent that has not caught up yet still reports what it was told
        // to give back. Showing that would suggest an assignment that is over.
        agent.grants = message.grants.filter(grant => !agent.revoked.has(grant.target));
        this.emit('change', accountId);
        return;
      }
      case 'check': {
        const socket = this.sockets.get(agentId);
        if (!socket) return;
        agent?.activity.set(message.target, Date.now());
        this.emit('change', accountId);
        this.send(socket, {
          type: 'verdict',
          id: message.id,
          allowed: !agent?.revoked.has(message.target),
        });
        return;
      }
      default:
        return;
    }
  }

  /**
   * Drop revocations the agent has caught up with: either it no longer lists
   * the target, or a human has handed the same one back since.
   */
  private settleRevocations(agent: ConnectedAgent, reported: WireGrant[]): void {
    for (const [target, at] of agent.revoked) {
      const grant = reported.find(g => g.target === target);
      if (!grant || grant.since > at) agent.revoked.delete(target);
    }
  }

  private send(socket: WebSocket, message: DispatchToServer): void {
    try { socket.send(JSON.stringify(message)); } catch { /* the close handler cleans up */ }
  }

  /**
   * The machines worth showing: connected, or still holding something. An
   * entry that is neither may still be remembered — a revocation outlives the
   * socket it could not be delivered on — but there is nothing to show.
   */
  listAgents(accountId: number): ConnectedAgent[] {
    return [...this.agents.values()].filter(
      agent => agent.accountId === accountId && (agent.connected || agent.grants.length > 0)
    );
  }

  listRequests(accountId: number): OpenRequest[] {
    const mine = new Set(this.listAgents(accountId).map(agent => agent.id));
    return [...this.requests.values()]
      .filter(request => mine.has(request.agentId))
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  getRequest(accountId: number, id: string): OpenRequest | null {
    const request = this.requests.get(id);
    if (!request) return null;
    return this.agents.get(request.agentId)?.accountId === accountId ? request : null;
  }

  answer(accountId: number, id: string, answer: { target: string } | { deny: true; reason?: string }): boolean {
    const request = this.getRequest(accountId, id);
    if (!request) return false;
    const socket = this.sockets.get(request.agentId);
    if (!socket) return false;
    delete request.lastError;
    this.send(socket, 'target' in answer
      ? { type: 'answer', id, target: answer.target }
      : { type: 'answer', id, deny: true, reason: answer.reason });
    return true;
  }

  refresh(accountId: number, id: string): boolean {
    const request = this.getRequest(accountId, id);
    if (!request) return false;
    const socket = this.sockets.get(request.agentId);
    if (!socket) return false;
    this.send(socket, { type: 'refresh', id });
    return true;
  }

  /**
   * Take a target back from an agent. Remembered rather than merely sent: the
   * agent asks before its next action, so this lands even if it is not
   * listening right now.
   */
  revoke(accountId: number, agentId: string, target: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent || agent.accountId !== accountId) return false;
    if (!agent.grants.some(grant => grant.target === target)) return false;
    agent.revoked.set(target, Date.now());
    agent.grants = agent.grants.filter(grant => grant.target !== target);
    const socket = this.sockets.get(agentId);
    if (socket) this.send(socket, { type: 'revoke', target });
    this.emit('change', accountId);
    return true;
  }

  /**
   * A machine whose pairing was revoked: close what it has open and forget it.
   * It cannot dial back in, so keeping its grants in view would suggest a
   * take-back that could never be delivered.
   */
  dropDevice(deviceId: number): void {
    for (const [id, agent] of [...this.agents]) {
      if (agent.deviceId !== deviceId) continue;
      const socket = this.sockets.get(id);
      this.sockets.delete(id);
      this.agents.delete(id);
      for (const [requestId, request] of this.requests) {
        if (request.agentId === id) this.requests.delete(requestId);
      }
      socket?.close();
      this.emit('change', agent.accountId);
    }
  }

  /**
   * What an agent holds and who it is, so a standing rule can be cut from a
   * grant that already works rather than typed out by hand.
   */
  heldBy(accountId: number, agentId: string, target: string): { grant: WireGrant; identity: AgentIdentity } | null {
    const agent = this.agents.get(agentId);
    if (!agent || agent.accountId !== accountId) return null;
    const grant = agent.grants.find(g => g.target === target);
    return grant ? { grant, identity: agent.identity } : null;
  }

  markAutoAssigned(id: string, target: string, entryId: number): void {
    const request = this.requests.get(id);
    if (request) request.autoAssigned = { target, entryId };
  }

  agentOf(id: string): ConnectedAgent | null {
    const request = this.requests.get(id);
    return request ? this.agents.get(request.agentId) ?? null : null;
  }
}
