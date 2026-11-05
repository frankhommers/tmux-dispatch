/** "3m ago", close enough for a list that refreshes itself. */
export function ago(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

/** "4m", "1h": how long until a moment, for expiry labels. */
export function until(at: number): string {
  const seconds = Math.max(0, Math.round((at - Date.now()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

/** A full local date and time, for details where precision matters. */
export function absolute(at: number): string {
  return new Date(at).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

/** "Nov 2, 2026". */
export function day(at: number): string {
  return new Date(at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * A session id short enough to read in a table. Long ids (UUIDs, mostly) are
 * cut to their first eight characters, which is enough to tell two apart;
 * short human-chosen names stay whole.
 * Display only: never send a shortened value back to the API.
 */
export function shortSession(id: string): string {
  return id.length > 16 ? id.slice(0, 8) : id;
}

/** A tmux server instance, short enough for a cell: its pid. Display only. */
export function shortServer(fingerprint: string): string {
  const parts = fingerprint.split(':');
  return parts.length >= 3 ? `:${parts[parts.length - 2]}` : fingerprint;
}

/** A project as you would name it: the last segment of its path. */
export function projectName(cwd: string): string {
  return cwd.replace(/\/+$/, '').split('/').pop() || cwd;
}

/**
 * tmux names panes `%3` and windows `@5`. Someone reading a number off their
 * screen types the number, so accept that too rather than refusing it.
 */
export function normaliseTarget(input: string, kind: 'pane' | 'window'): string {
  const value = input.trim();
  return /^\d+$/.test(value) ? `${kind === 'window' ? '@' : '%'}${value}` : value;
}

/** A rule naming a bare id speaks about one pane or window; anything else is a pattern. */
export function isBareId(pattern: string): boolean {
  return /^[%@]\d+$/.test(pattern);
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** A machine as people name it: the first label of its host name. Display only. */
export function shortHost(host: string): string {
  return host.split('.')[0] || host;
}

/**
 * A working directory short enough for a row, keeping what tells projects
 * apart: home becomes ~, and only the last three segments are kept.
 * Display only: the full path stays available beside it.
 */
export function shortPath(cwd: string): string {
  const home = cwd.replace(/^\/(Users|home)\/[^/]+/, '~');
  const parts = home.split('/').filter(Boolean);
  if (parts.length <= 4) return home;
  return `${parts[0] === '~' ? '~/' : '/'}…/${parts.slice(-3).join('/')}`;
}

/** Minutes left before a moment; negative once it has passed. */
export function minutesLeft(at: number): number {
  return (at - Date.now()) / 60_000;
}
