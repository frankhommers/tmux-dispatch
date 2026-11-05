import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { InlineError, inputClass } from '@/components/common';
import { AuthPanel } from '@/components/auth-panel';
import { login, type AuthMode } from '@/lib/api';
import type { ThemePreference } from '@/lib/theme';
import { cn } from '@/lib/utils';

interface Props {
  authMode: AuthMode;
  onSignedIn: () => void;
  onRetry: () => void;
  theme: ThemePreference;
  onTheme: (value: ThemePreference) => void;
}

/**
 * Signing in, in whichever way this deployment uses. The page path stays as
 * it is, so signing in on /link returns to pairing.
 */
export function SignIn({ authMode, onSignedIn, onRetry, theme, onTheme }: Props) {
  // The password lives only in this component's memory and is cleared on success.
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordId = useId();
  const errorId = useId();

  if (authMode === 'token') {
    return (
      <AuthPanel title="Open dispatch with a valid access link" subtitle="This deployment uses an access link with a token. The link you used is missing its token or the token is no longer valid." theme={theme} onTheme={onTheme}>
        <Button variant="outline" onClick={onRetry}>Retry</Button>
      </AuthPanel>
    );
  }

  if (authMode === 'oidc') {
    return (
      <AuthPanel title="Sign in to manage terminal access" theme={theme} onTheme={onTheme}>
        <Button asChild>
          <a href="/auth/start">Continue to identity provider</a>
        </Button>
      </AuthPanel>
    );
  }

  return (
    <AuthPanel title="Sign in to manage terminal access" theme={theme} onTheme={onTheme}>
      <form
        className="grid gap-3"
        onSubmit={async event => {
          event.preventDefault();
          if (!password || busy) return;
          setBusy(true);
          setError(null);
          try {
            await login(password);
            setPassword('');
            onSignedIn();
          } catch (cause) {
            const message = cause instanceof Error ? cause.message : String(cause);
            setError(message ? message.charAt(0).toUpperCase() + message.slice(1) : 'Could not sign in.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="grid gap-1.5">
          <label htmlFor={passwordId} className="text-xs font-medium">Password</label>
          <input
            id={passwordId}
            autoFocus
            required
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={event => setPassword(event.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className={cn(inputClass)}
          />
          <InlineError id={errorId}>{error}</InlineError>
        </div>
        <Button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
      </form>
    </AuthPanel>
  );
}
