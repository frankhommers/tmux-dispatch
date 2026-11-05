import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AgentsPanel } from '@/components/agents-panel';
import { AppShell } from '@/components/app-shell';
import { AuthPanel } from '@/components/auth-panel';
import { DevicesPanel } from '@/components/devices-panel';
import { LinkDevice } from '@/components/link-device';
import { RequestsSection } from '@/components/requests-section';
import { RulesPanel, type RuleFocus } from '@/components/rules-panel';
import { SignIn } from '@/components/sign-in';
import { useInbox } from '@/hooks/use-inbox';
import { getSession, type SessionInfo } from '@/lib/api';
import { describe, onUnauthorized } from '@/lib/errors';
import { useTheme } from '@/lib/theme';

export default function App() {
  const theme = useTheme();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [ruleFocus, setRuleFocus] = useState<RuleFocus | null>(null);
  const signedIn = session?.signedIn === true;
  const data = useInbox(signedIn);
  const { onArrived, onAutoAssigned } = data;

  const loadSession = useCallback(() => {
    setChecking(true);
    setSessionError(null);
    getSession()
      .then(setSession)
      .catch(cause => setSessionError(describe(cause)))
      .finally(() => setChecking(false));
  }, []);
  useEffect(loadSession, [loadSession]);
  // Any 401 means the session ended: show sign-in, keeping the current path.
  useEffect(() => onUnauthorized(loadSession), [loadSession]);

  useEffect(() => {
    onArrived(reason => {
      toast('An agent wants a terminal', { description: reason });
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification('tmux-dispatch: an agent wants a terminal', { body: reason });
      }
    });
    onAutoAssigned(event => {
      toast.success(`Assigned ${event.target} automatically`, { description: event.reason });
    });
  }, [onArrived, onAutoAssigned]);

  const showRule = useCallback((id: number, edit = false) => {
    setRuleFocus(current => ({ id, edit, nonce: (current?.nonce ?? 0) + 1 }));
  }, []);

  const themeProps = { theme: theme.preference, onTheme: theme.setPreference };
  let page;

  if (!session) {
    page = sessionError ? (
      <AuthPanel title="Could not connect" subtitle={sessionError} {...themeProps}>
        <Button variant="outline" onClick={loadSession} disabled={checking}>{checking ? 'Retrying…' : 'Retry'}</Button>
      </AuthPanel>
    ) : (
      <AuthPanel title="Connecting to dispatch…" {...themeProps}>
        <div role="status" aria-label="Connecting to dispatch" className="grid gap-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-2/3" />
        </div>
      </AuthPanel>
    );
  } else if (!signedIn) {
    page = <SignIn authMode={session.authMode} onSignedIn={loadSession} onRetry={() => location.reload()} {...themeProps} />;
  } else if (location.pathname === '/link') {
    page = <LinkDevice {...themeProps} />;
  } else {
    const inbox = data.inbox.data;
    const stale = data.connection === 'offline';
    page = (
      <AppShell
        session={session}
        connection={data.connection}
        wasLive={data.wasLive}
        counts={{
          requests: inbox ? inbox.requests.length : null,
          agents: inbox ? inbox.agents.filter(agent => agent.connected).length : null,
          rules: data.pool.data ? data.pool.data.length : null,
        }}
        onSignedOut={loadSession}
        {...themeProps}
      >
        <RequestsSection inbox={data.inbox} stale={stale} onRefresh={data.refreshInbox} />
        <AgentsPanel
          inbox={data.inbox}
          pool={data.pool.data}
          stale={stale}
          onRefresh={data.refresh}
          onShowRule={showRule}
        />
        <RulesPanel
          pool={data.pool}
          agents={inbox?.agents ?? []}
          stale={stale}
          focus={ruleFocus}
          onRefresh={data.refreshPool}
        />
        <DevicesPanel devices={data.devices} stale={stale} onRefresh={data.refreshDevices} />
      </AppShell>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      {page}
      <Toaster position="bottom-right" theme={theme.resolved} />
    </TooltipProvider>
  );
}
