/**
 * Everything the page asks of the service.
 *
 * In token mode the token arrives once in the query string and then lives in
 * sessionStorage; in password and OIDC mode a session cookie does the work
 * and the token is simply absent.
 */
const TOKEN_KEY = 'tmux-mcp-token';

function readToken(): string {
  const params = new URLSearchParams(location.search);
  const fromUrl = params.get('t');
  if (fromUrl) {
    sessionStorage.setItem(TOKEN_KEY, fromUrl);
    params.delete('t');
    history.replaceState({}, '', location.pathname + (params.toString() ? `?${params}` : ''));
    return fromUrl;
  }
  return sessionStorage.getItem(TOKEN_KEY) ?? '';
}

export const token = readToken();

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(init.headers as Record<string, string> ?? {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(body.error ?? res.statusText, res.status);
  }
  return res.json() as Promise<T>;
}

export type AuthMode = 'token' | 'password' | 'oidc';

export interface SessionInfo {
  authMode: AuthMode;
  signedIn: boolean;
  account: string | null;
}

export interface AgentIdentity {
  instanceId?: string;
  /** The tmux server it talks to, as `socket:pid:start_time`. */
  tmuxServer?: string;
  /** Which MCP client started it, as that client names itself. */
  mcpClient?: string;
  pid: number;
  host: string;
  cwd: string;
  tmuxSession: string | null;
  scope: string;
  client: string;
}

export interface Target {
  id: string;
  label: string;
}

export interface PaneRequest {
  id: string;
  reason: string;
  kind: 'pane' | 'window';
  createdAt: number;
  expiresAt: number;
  ageSeconds: number;
  candidates: Target[];
  /** What the agent would like, if it said so. A hint; the human still chooses. */
  suggested: string | null;
  /** Candidates already handed out on this same tmux server, by directory. */
  heldElsewhere: Record<string, string>;
  autoAssigned: { target: string; entryId: number } | null;
  lastError: string | null;
  agent: AgentIdentity | null;
}

/** A pane or window a human handed to an agent, still held by it. */
export interface Grant {
  target: string;
  kind: 'pane' | 'window';
  label: string;
  since: number;
  /** Why it was asked for, kept after the request itself is gone. */
  reason?: string;
  /** When the agent last asked about it, which is when it last acted on it. */
  lastActivity: number | null;
}

export interface ConnectedAgent {
  id: string;
  identity: AgentIdentity;
  connectedAt: number;
  lastSeen: number;
  connected: boolean;
  grants: Grant[];
}

export interface PoolEntry {
  id: number;
  pattern: string;
  kind: 'pane' | 'window';
  reusable: boolean;
  /** Only agents working here collect it. Null means anyone. */
  cwd: string | null;
  /** The tmux server a bare id belongs to; the rule is void on any other. */
  tmuxServer: string | null;
  usedAt: number | null;
  createdAt: number;
}

export interface Device {
  id: number;
  name: string;
  createdAt: number;
  lastSeenAt: number | null;
}

export const getSession = () => api<SessionInfo>('/api/session');
export const login = (password: string) =>
  api<{ ok: true }>('/api/login', { method: 'POST', body: JSON.stringify({ password }) });
export const logout = () => api<{ ok: true }>('/api/logout', { method: 'POST' });

export const listRequests = () =>
  api<{ requests: PaneRequest[]; agents: ConnectedAgent[] }>('/api/requests');
export const grant = (id: string, target: string) =>
  api<{ ok: true }>(`/api/requests/${id}/grant`, { method: 'POST', body: JSON.stringify({ target }) });
export const deny = (id: string, reason: string) =>
  api<{ ok: true }>(`/api/requests/${id}/deny`, { method: 'POST', body: JSON.stringify({ reason }) });
export const refreshTargets = (id: string) =>
  api<{ ok: true }>(`/api/requests/${id}/refresh`, { method: 'POST' });
export const dismissRequest = (id: string) =>
  api<{ ok: true }>(`/api/requests/${id}`, { method: 'DELETE' });

export const forgetAgent = (agentId: string) =>
  api<{ ok: true }>(`/api/agents/${encodeURIComponent(agentId)}`, { method: 'DELETE' });

export const keepGrant = (agentId: string, target: string) =>
  api<{ entry: PoolEntry }>(`/api/agents/${encodeURIComponent(agentId)}/keep`, {
    method: 'POST',
    body: JSON.stringify({ target }),
  });

export const revokeGrant = (agentId: string, target: string) =>
  api<{ ok: true }>(`/api/agents/${encodeURIComponent(agentId)}/revoke`, {
    method: 'POST',
    body: JSON.stringify({ target }),
  });

export const listPool = () => api<{ pool: PoolEntry[] }>('/api/pool');
export const addPoolEntry = (pattern: string, kind: 'pane' | 'window', reusable: boolean) =>
  api<{ entry: PoolEntry }>('/api/pool', { method: 'POST', body: JSON.stringify({ pattern, kind, reusable }) });
export const removePoolEntry = (id: number) =>
  api<{ ok: true }>(`/api/pool/${id}`, { method: 'DELETE' });
export const resetPoolEntry = (id: number) =>
  api<{ ok: true }>(`/api/pool/${id}`, { method: 'POST' });

export const listDevices = () => api<{ devices: Device[] }>('/api/devices');
export const revokeDevice = (id: number) =>
  api<{ ok: true }>(`/api/devices/${id}`, { method: 'DELETE' });
export const lookupPairing = (userCode: string) =>
  api<{ name: string }>('/api/pair/lookup', { method: 'POST', body: JSON.stringify({ userCode }) });
export const approvePairing = (userCode: string) =>
  api<{ ok: true }>('/api/pair/approve', { method: 'POST', body: JSON.stringify({ userCode }) });
export const denyPairing = (userCode: string) =>
  api<{ ok: true }>('/api/pair/deny', { method: 'POST', body: JSON.stringify({ userCode }) });

/**
 * A tmux label is "%3  session:window.0  zsh  "title"". Splitting it lets a
 * row show the id and command prominently and the rest quietly, rather than
 * one long monospace string.
 */
export function parseLabel(label: string): { id: string; location: string; command: string; title: string } {
  const parts = label.split(/\s{2,}/);
  return {
    id: parts[0] ?? label,
    location: parts[1] ?? '',
    command: parts[2] ?? '',
    title: (parts[3] ?? '').replace(/^"|"$/g, ''),
  };
}
