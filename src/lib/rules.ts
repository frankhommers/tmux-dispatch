import type { AgentIdentity, ConnectedAgent, Grant, PoolEntry } from '@/lib/api';

/** Where a rule is in its life: always ready, ready once more, or spent. */
export type RuleLifecycle = 'reusable' | 'once' | 'spent';

export function lifecycleOf(entry: Pick<PoolEntry, 'reusable' | 'usedAt'>): RuleLifecycle {
  if (entry.reusable) return 'reusable';
  return entry.usedAt == null ? 'once' : 'spent';
}

/** Whether a rule could still hand a pane over. A used one-shot rule cannot until it is reset. */
export function canFire(entry: Pick<PoolEntry, 'reusable' | 'usedAt'>): boolean {
  return lifecycleOf(entry) !== 'spent';
}

/**
 * The rule "Auto-assign next time" would create for this grant, if one already
 * exists. Mirrors the server's keep defaults: reusable, bound to the machine
 * and tmux server, plus the agent session when reported, else the path.
 * Like the server, it ignores lifecycle: a spent rule with this scope is
 * still the one keep returns, so callers must check `lifecycleOf`.
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
 * bare IDs: a glob is never claimed to belong to one grant. Spent one-shot
 * rules are left out: they cannot assign anything until reset.
 */
export function exactRulesFor(pool: PoolEntry[], agent: ConnectedAgent, grant: Grant): PoolEntry[] {
  const identity = agent.identity;
  return pool.filter(entry =>
    canFire(entry)
    && entry.pattern === grant.target
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

/** The same scope as `keepDefaults`, short enough to sit beside a button. */
export function keepScope(identity: AgentIdentity): string {
  return identity.sessionId
    ? 'Reusable · this session · any path · this machine & tmux server'
    : 'Reusable · this path · this machine & tmux server';
}
