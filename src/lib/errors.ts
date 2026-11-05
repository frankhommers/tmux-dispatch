import { ApiError } from '@/lib/api';

const UNAUTHORIZED = 'tmux-dispatch:unauthorized';

/**
 * The message to show for a failed call. A 401 also tells the app shell the
 * session is gone, so it can show sign-in instead of firing more requests.
 */
export function describe(cause: unknown): string {
  if (cause instanceof ApiError && cause.status === 401) {
    window.dispatchEvent(new Event(UNAUTHORIZED));
    return 'Your session ended. Sign in again.';
  }
  if (cause instanceof TypeError) return 'Could not reach dispatch. Check the connection and try again.';
  const message = cause instanceof Error ? cause.message : String(cause);
  return message ? message.charAt(0).toUpperCase() + message.slice(1) : 'Something went wrong.';
}

export function status(cause: unknown): number | null {
  return cause instanceof ApiError ? cause.status : null;
}

export function onUnauthorized(handler: () => void): () => void {
  window.addEventListener(UNAUTHORIZED, handler);
  return () => window.removeEventListener(UNAUTHORIZED, handler);
}
