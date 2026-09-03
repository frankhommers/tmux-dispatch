import { EventEmitter } from 'node:events';
import type { WebSocket } from 'ws';
import {
  PROTOCOL_VERSION,
  isCompatible,
  parseAgentMessage,
  type AgentIdentity,
  type ServerToUi,
  type UiToServer,
  type WireCandidate,
} from './protocol.js';

/**
 * Every connected MCP server and the requests it currently has open.
 *
 * The UI holds no tmux knowledge: a request arrives with its candidates, and
 * an answer is a name the agent then validates. Requests live only as long as
 * the socket that carries them, because answering a dead socket is a lie.
 */

export interface OpenRequest {
  id: string;
  agentId: number;
  reason: string;
  kind: 'pane' | 'window';
  createdAt: number;
  expiresAt: number;
  candidates: WireCandidate[];
  /** Set when the pool answered it without asking a human. */
  autoAssigned?: { target: string; entryId: number };
  /** Last failure reported by the agent, shown to the human. */
  lastError?: string;
}

export interface ConnectedAgent {
  id: number;
  accountId: number;
  deviceId: number | null;
  identity: AgentIdentity;
  connectedAt: number;
}

let nextAgentId = 1;

export class AgentRegistry extends EventEmitter {
  private readonly sockets = new Map<number, WebSocket>();
  private readonly agents = new Map<number, ConnectedAgent>();
  private readonly requests = new Map<string, OpenRequest>();

  /**
   * Take over a freshly authenticated socket. Resolves once the handshake is
   * done, or rejects when the protocol majors differ.
   */
  accept(socket: WebSocket, accountId: number, deviceId: number | null, accountName: string): void {
    const id = nextAgentId++;
    let handshaken = false;

    socket.on('message', data => {
      const message = parseAgentMessage(String(data));
      if (!message) return;

      if (!handshaken) {
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
        handshaken = true;
        this.sockets.set(id, socket);
        this.agents.set(id, {
          id,
          accountId,
          deviceId,
          identity: message.agent,
          connectedAt: Date.now(),
        });
        this.send(socket, { type: 'welcome', protocolVersion: PROTOCOL_VERSION, account: accountName });
        this.emit('change', accountId);
        return;
      }

      this.handle(id, accountId, message);
    });

    socket.on('close', () => {
      this.sockets.delete(id);
      this.agents.delete(id);
      for (const [requestId, request] of this.requests) {
        if (request.agentId === id) this.requests.delete(requestId);
      }
      this.emit('change', accountId);
    });

    socket.on('error', () => { /* 'close' follows */ });
  }

  private handle(agentId: number, accountId: number, message: ServerToUi): void {
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
      default:
        return;
    }
  }

  private send(socket: WebSocket, message: UiToServer): void {
    try { socket.send(JSON.stringify(message)); } catch { /* the close handler cleans up */ }
  }

  listAgents(accountId: number): ConnectedAgent[] {
    return [...this.agents.values()].filter(agent => agent.accountId === accountId);
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

  markAutoAssigned(id: string, target: string, entryId: number): void {
    const request = this.requests.get(id);
    if (request) request.autoAssigned = { target, entryId };
  }

  agentOf(id: string): ConnectedAgent | null {
    const request = this.requests.get(id);
    return request ? this.agents.get(request.agentId) ?? null : null;
  }
}
