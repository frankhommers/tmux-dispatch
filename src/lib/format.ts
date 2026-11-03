/** "3m ago", close enough for a list that refreshes itself. */
export function ago(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

/**
 * A session id short enough to read in a table. Long ids (UUIDs, mostly) are
 * cut to their first eight characters, which is enough to tell two apart.
 */
export function shortSession(id: string): string {
  return id.length > 12 ? id.slice(0, 8) : id;
}

/** A tmux server instance, short enough for a chip: its pid. */
export function shortServer(fingerprint: string): string {
  const parts = fingerprint.split(':');
  return parts.length >= 3 ? `:${parts[parts.length - 2]}` : fingerprint;
}

/** A project as you would name it: the last segment of its path. */
export function projectName(cwd: string): string {
  return cwd.replace(/\/+$/, '').split('/').pop() || cwd;
}
