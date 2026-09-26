import { useState } from 'react';
import { KeyRound, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { login, type AuthMode } from '@/lib/api';

export function SignIn({ authMode, onSignedIn }: { authMode: AuthMode; onSignedIn: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (authMode === 'oidc') {
    return (
      <Shell>
        <p className="text-sm text-muted-foreground">
          Sign in with your identity provider to see requests from your machines.
        </p>
        <Button asChild className="w-full">
          <a href="/auth/start">
            <LogIn className="size-4" />
            Continue
          </a>
        </Button>
      </Shell>
    );
  }

  return (
    <Shell>
      <p className="text-sm text-muted-foreground">
        This deployment is protected by a single password.
      </p>
      <form
        className="flex flex-col gap-3"
        onSubmit={async event => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await login(password);
            onSignedIn();
          } catch (cause) {
            setError((cause as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <input
          autoFocus
          type="password"
          value={password}
          onChange={event => setPassword(event.target.value)}
          placeholder="Password"
          className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none transition focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={busy || password.length === 0}>
          <KeyRound className="size-4" />
          Sign in
        </Button>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <Card className="w-full max-w-sm border-border shadow-sm">
        <CardHeader>
          <h1 className="text-lg font-semibold tracking-tight">tmux-dispatch</h1>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">{children}</CardContent>
      </Card>
    </div>
  );
}
