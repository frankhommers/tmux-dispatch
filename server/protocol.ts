/**
 * The wire contract with the MCP server, specified in docs/protocol.md.
 *
 * Declared again here rather than shared as a package: a handful of message shapes do
 * not justify a third published artifact, and the two sides are deployed
 * independently anyway. PROTOCOL_VERSION is what keeps them honest.
 */

export const PROTOCOL_VERSION = '1.1';

export function protocolMajor(version: string): string {
  return version.split('.')[0] ?? '';
}

export function isCompatible(theirs: string): boolean {
  return protocolMajor(theirs) === protocolMajor(PROTOCOL_VERSION);
}

export interface AgentIdentity {
  /**
   * Stable for the lifetime of one MCP server process, so a reconnect is
   * recognisably the same server. Absent from 1.0 servers, which are then
   * treated as a fresh machine on every dial-in.
   */
  instanceId?: string;
  pid: number;
  host: string;
  cwd: string;
  tmuxSession: string | null;
  scope: string;
  client: string;
}

export interface WireCandidate {
  id: string;
  label: string;
}

/** A resource a human has handed to an agent, as the agent still sees it. */
export interface WireGrant {
  target: string;
  kind: 'pane' | 'window';
  label: string;
  since: number;
}

export type ServerToDispatch =
  | { type: 'hello'; protocolVersion: string; agent: AgentIdentity }
  | {
      type: 'request';
      id: string;
      reason: string;
      kind: 'pane' | 'window';
      createdAt: number;
      expiresAt: number;
      candidates: WireCandidate[];
    }
  | { type: 'candidates'; id: string; candidates: WireCandidate[] }
  | { type: 'withdraw'; id: string; why: 'expired' | 'answered_elsewhere' | 'shutdown' }
  | { type: 'result'; id: string; ok: true; target: string }
  | { type: 'result'; id: string; ok: false; error: string }
  | { type: 'grants'; grants: WireGrant[] }
  | { type: 'check'; id: string; target: string };

export type DispatchToServer =
  | { type: 'welcome'; protocolVersion: string; account?: string }
  | { type: 'refuse'; reason: 'protocol_version' | 'unauthorized'; protocolVersion?: string }
  | { type: 'answer'; id: string; target: string }
  | { type: 'answer'; id: string; deny: true; reason?: string }
  | { type: 'refresh'; id: string }
  | { type: 'revoke'; target: string }
  | { type: 'verdict'; id: string; allowed: boolean };

/** Parse defensively: the peer may be a different version. */
export function parseAgentMessage(raw: string): ServerToDispatch | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const message = value as { type?: unknown; id?: unknown };
  switch (message.type) {
    case 'hello':
      return message as ServerToDispatch;
    case 'grants':
      return Array.isArray((message as { grants?: unknown }).grants) ? (message as ServerToDispatch) : null;
    case 'check':
    case 'request':
    case 'candidates':
    case 'withdraw':
    case 'result':
      return typeof message.id === 'string' ? (message as ServerToDispatch) : null;
    default:
      return null;
  }
}
