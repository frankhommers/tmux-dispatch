/** "3m ago", close enough for a list that refreshes itself. */
export function ago(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

/** A project as you would name it: the last segment of its path. */
export function projectName(cwd: string): string {
  return cwd.replace(/\/+$/, '').split('/').pop() || cwd;
}
