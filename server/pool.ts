import type { PoolEntry } from './db.js';
import type { WireCandidate } from './protocol.js';

/**
 * Matching a pre-assigned entry against what an agent actually offered.
 *
 * The match is always made against the candidate list the MCP server sent, so
 * an entry can never widen what that server would accept — it only decides
 * faster, without asking.
 */

/** A glob over the whole candidate label: '*' spans anything, '?' one char. */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
}

/** Who is asking, as far as an entry is allowed to care. */
export interface Asker {
  cwd: string;
  tmuxServer: string;
  /** The machine the agent runs on. */
  host?: string;
  /** The configured agent session, when the agent named one. */
  sessionId?: string;
}

export function entryMatches(
  entry: PoolEntry,
  candidate: WireCandidate,
  kind: 'pane' | 'window',
  asker?: Asker
): boolean {
  if (entry.kind !== kind) return false;
  if (entry.usedAt !== null && !entry.reusable) return false;

  // Every bound element must hold at once; an unbound one matches anything.
  // Which elements bind is the human's per-element choice when keeping or
  // writing the rule.
  if (entry.session && entry.session !== asker?.sessionId) return false;
  if (entry.cwd && !globToRegExp(entry.cwd).test(asker?.cwd ?? '')) return false;
  if (entry.host && entry.host !== asker?.host) return false;

  // Bound to a tmux server: a bare id means nothing on any other one, so the
  // rule falls silent and the human is asked again.
  if (entry.tmuxServer && entry.tmuxServer !== asker?.tmuxServer) return false;

  // A bare id is compared exactly; anything else is a glob over the label,
  // which is where session, window, command and title live.
  if (/^[%@]\d+$/.test(entry.pattern)) return entry.pattern === candidate.id;
  return globToRegExp(entry.pattern).test(candidate.label) || globToRegExp(entry.pattern).test(candidate.id);
}

export interface PoolMatchResult {
  entry: PoolEntry;
  candidate: WireCandidate;
}

/**
 * First entry that matches, in the order the human listed them. A target in
 * `held` belongs to another agent already: handing it out again would give one
 * pane to two agents, so the human is asked instead.
 */
export function findPoolMatch(
  entries: PoolEntry[],
  candidates: WireCandidate[],
  kind: 'pane' | 'window',
  asker?: Asker,
  held: ReadonlySet<string> = new Set()
): PoolMatchResult | null {
  const free = candidates.filter(c => !held.has(c.id));
  for (const entry of entries) {
    const candidate = free.find(c => entryMatches(entry, c, kind, asker));
    if (candidate) return { entry, candidate };
  }
  return null;
}
