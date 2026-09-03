/**
 * The wire contract with the MCP server, specified in docs/protocol.md.
 *
 * Declared again here rather than shared as a package: six message shapes do
 * not justify a third published artifact, and the two sides are deployed
 * independently anyway. PROTOCOL_VERSION is what keeps them honest.
 */

export const PROTOCOL_VERSION = '1.0';

export function protocolMajor(version: string): string {
  return version.split('.')[0] ?? '';
}

export function isCompatible(theirs: string): boolean {
  return protocolMajor(theirs) === protocolMajor(PROTOCOL_VERSION);
}

export interface AgentIdentity {
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

export type ServerToUi =
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
  | { type: 'result'; id: string; ok: false; error: string };

export type UiToServer =
  | { type: 'welcome'; protocolVersion: string; account?: string }
  | { type: 'refuse'; reason: 'protocol_version' | 'unauthorized'; protocolVersion?: string }
  | { type: 'answer'; id: string; target: string }
  | { type: 'answer'; id: string; deny: true; reason?: string }
  | { type: 'refresh'; id: string };

/** Parse defensively: the peer may be a different version. */
export function parseAgentMessage(raw: string): ServerToUi | null {
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
      return message as ServerToUi;
    case 'request':
    case 'candidates':
    case 'withdraw':
    case 'result':
      return typeof message.id === 'string' ? (message as ServerToUi) : null;
    default:
      return null;
  }
}
