import { useId, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { InlineError, inputClass } from '@/components/common';
import { AuthPanel } from '@/components/auth-panel';
import { approvePairing, denyPairing, lookupPairing } from '@/lib/api';
import { describe, status } from '@/lib/errors';
import type { ThemePreference } from '@/lib/theme';
import { cn } from '@/lib/utils';

type Busy = 'check' | 'link' | 'decline' | null;

/**
 * Confirming a machine's pairing code. The machine never receives a secret it
 * did not ask for, and no token is shown here.
 */
export function LinkDevice({ theme, onTheme }: { theme: ThemePreference; onTheme: (value: ThemePreference) => void }) {
  const [code, setCode] = useState('');
  /** A successful lookup, valid only for the code it was made with. */
  const [lookup, setLookup] = useState<{ code: string; name: string } | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<'linked' | 'declined' | null>(null);
  const codeId = useId();
  const helpId = useId();
  const errorId = useId();

  const checked = lookup !== null && lookup.code === code;

  const expiredMessage = (cause: unknown) =>
    status(cause) === 404
      ? 'This code is invalid or has expired. Check the code, or start pairing again on the machine.'
      : describe(cause);

  const check = async () => {
    if (!code.trim() || busy) return;
    setBusy('check');
    setError(null);
    try {
      const { name } = await lookupPairing(code.trim());
      setLookup({ code, name });
    } catch (cause) {
      setLookup(null);
      setError(expiredMessage(cause));
    } finally {
      setBusy(null);
    }
  };

  const answer = async (approve: boolean) => {
    if (!checked || busy) return;
    setBusy(approve ? 'link' : 'decline');
    setError(null);
    try {
      if (approve) await approvePairing(code.trim());
      else await denyPairing(code.trim());
      setDone(approve ? 'linked' : 'declined');
    } catch (cause) {
      // The code may have expired since the lookup: ask for a fresh check.
      setLookup(null);
      const message = expiredMessage(cause);
      setError(`${message} Check the code again to retry.`);
      toast.error(message);
    } finally {
      setBusy(null);
    }
  };

  if (done) {
    return (
      <AuthPanel
        title={done === 'linked' ? 'Machine linked' : 'Pairing declined'}
        subtitle={done === 'linked'
          ? `${lookup?.name ?? 'The machine'} can now connect. It can close its prompt.`
          : 'The machine was not linked and gets no access.'}
        theme={theme}
        onTheme={onTheme}
      >
        <Button asChild variant="outline"><a href="/">Back to dashboard</a></Button>
      </AuthPanel>
    );
  }

  return (
    <AuthPanel
      title="Link a machine"
      subtitle={<>Enter the code that <code className="font-mono text-foreground">tmux-mcp dispatch-login</code> printed.</>}
      theme={theme}
      onTheme={onTheme}
    >
      <form className="grid gap-3" onSubmit={event => { event.preventDefault(); void check(); }}>
        <div className="grid gap-1.5">
          <label htmlFor={codeId} className="text-xs font-medium">Pairing code</label>
          <input
            id={codeId}
            autoFocus
            required
            value={code}
            onChange={event => { setCode(event.target.value.toUpperCase()); setError(null); }}
            placeholder="XXXX-XXXX"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            aria-describedby={cn(helpId, error && errorId)}
            className={cn(inputClass, 'h-11 text-center font-mono text-lg tracking-widest placeholder:text-muted-foreground/50')}
          />
          <p id={helpId} className="text-xs text-muted-foreground">Eight letters and digits, like WQ7F-2K9P. Case does not matter.</p>
          <InlineError id={errorId}>{error}</InlineError>
        </div>
        {!checked && (
          <Button type="submit" disabled={busy !== null || !code.trim()}>
            {busy === 'check' ? 'Checking…' : 'Check code'}
          </Button>
        )}
      </form>
      {checked && (
        <div className="grid gap-3">
          <div className="rounded-md bg-muted px-3 py-2 text-sm">
            <span className="text-xs text-muted-foreground">Device name</span>
            <p className="font-mono font-medium break-anywhere">{lookup.name}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" disabled={busy !== null} onClick={() => void answer(false)}>
              {busy === 'decline' ? 'Declining…' : 'Decline'}
            </Button>
            <Button disabled={busy !== null} onClick={() => void answer(true)}>
              {busy === 'link' ? 'Linking…' : 'Link machine'}
            </Button>
          </div>
        </div>
      )}
      <a href="/" className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">Back to dashboard</a>
    </AuthPanel>
  );
}
