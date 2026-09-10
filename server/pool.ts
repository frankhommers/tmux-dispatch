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
}

export function entryMatches(
  entry: PoolEntry,
  candidate: WireCandidate,
  kind: 'pane' | 'window',
  asker?: Asker
): boolean {
  if (entry.kind !== kind) return false;
  if (entry.usedAt !== null && !entry.reusable) return false;

  // Bound to a directory: only agents working there collect it.
  if (entry.cwd && !globToRegExp(entry.cwd).test(asker?.cwd ?? '')) return false;

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

/** First entry that matches, in the order the human listed them. */
export function findPoolMatch(
  entries: PoolEntry[],
  candidates: WireCandidate[],
  kind: 'pane' | 'window',
  asker?: Asker
): PoolMatchResult | null {
  for (const entry of entries) {
    const candidate = candidates.find(c => entryMatches(entry, c, kind, asker));
    if (candidate) return { entry, candidate };
  }
  return null;
}
