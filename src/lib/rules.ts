import type { AgentIdentity, ConnectedAgent, Grant, PoolEntry } from '@/lib/api';

/**
 * The rule "Keep automatically" would create for this grant, if one already
 * exists. Mirrors the server's keep defaults: reusable, bound to the machine
 * and tmux server, plus the agent session when reported, else the path.
 */
export function keptBy(pool: PoolEntry[], identity: AgentIdentity, grant: Grant): PoolEntry | undefined {
  return pool.find(entry =>
    entry.pattern === grant.target
    && entry.kind === grant.kind
    && entry.host === (identity.host ?? null)
    && entry.tmuxServer === (identity.tmuxServer ?? null)
    && (identity.sessionId
      ? entry.session === identity.sessionId && entry.cwd === null
      : entry.session === null && entry.cwd === identity.cwd));
}

/**
 * Exact-ID rules that could hand this same target to this agent again. Only
 * bare IDs: a glob is never claimed to belong to one grant.
 */
export function exactRulesFor(pool: PoolEntry[], agent: ConnectedAgent, grant: Grant): PoolEntry[] {
  const identity = agent.identity;
  return pool.filter(entry =>
    entry.pattern === grant.target
    && entry.kind === grant.kind
    && (entry.tmuxServer === null || entry.tmuxServer === identity.tmuxServer)
    && (entry.host === null || entry.host === identity.host)
    && (entry.session === null || entry.session === identity.sessionId)
    && (entry.cwd === null || entry.cwd === identity.cwd));
}

export function keepDefaults(identity: AgentIdentity): string {
  return identity.sessionId
    ? 'Creates a reusable rule bound to this machine, its tmux server and this agent session. Any path.'
    : 'Creates a reusable rule bound to this machine, its tmux server and this path. No agent session is reported.';
}
