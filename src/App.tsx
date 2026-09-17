import { useEffect, useState } from 'react';
import { Inbox, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';
import { DevicesPanel } from '@/components/devices-panel';
import { LinkDevice } from '@/components/link-device';
import { PanesPanel } from '@/components/panes-panel';
import { RequestCard } from '@/components/request-card';
import { SignIn } from '@/components/sign-in';
import { useInbox, type Connection } from '@/hooks/use-inbox';
import { getSession, logout, type SessionInfo } from '@/lib/api';
import { cn } from '@/lib/utils';

function ConnectionDot({ state }: { state: Connection }) {
  const label = state === 'live' ? 'Live' : state === 'connecting' ? 'Connecting' : 'Reconnecting';
  return (
    <span className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="relative flex size-2">
        {state === 'live' && (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-live opacity-60" />
        )}
        <span
          className={cn(
            'relative inline-flex size-2 rounded-full',
            state === 'live' ? 'bg-live' : state === 'connecting' ? 'bg-muted-foreground' : 'bg-destructive'
          )}
        />
      </span>
      {label}
    </span>
  );
}

export default function App() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const signedIn = session?.signedIn === true;
  const { requests, agents, connection, error, refresh, onArrived, onAutoAssigned } = useInbox(signedIn);

  const loadSession = () => { void getSession().then(setSession).catch(() => setSession(null)); };
  useEffect(loadSession, []);

  useEffect(() => {
    onArrived(reason => {
      toast('An agent wants a pane', { description: reason });
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification('tmux-dispatch: an agent wants a pane', { body: reason });
      }
    });
    onAutoAssigned(data => {
      toast.success(`Assigned ${data.target} automatically`, { description: data.reason });
    });
    if (signedIn && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  }, [onArrived, onAutoAssigned, signedIn]);

  if (location.pathname === '/link') return (<><LinkDevice /><Toaster position="bottom-right" /></>);
  if (!session) return null;
  if (!signedIn) return (<><SignIn authMode={session.authMode} onSignedIn={loadSession} /><Toaster position="bottom-right" /></>);

  const pending = requests?.length ?? 0;
  const held = agents.reduce((total, agent) => total + agent.grants.length, 0);

  return (
    <div className="aurora min-h-dvh">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 py-10">
        <header className="flex items-baseline justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">tmux-dispatch</h1>
            <p className="text-sm text-muted-foreground">
              {pending === 0 ? 'No agent is waiting' : `${pending} request${pending === 1 ? '' : 's'} waiting`}
              {held > 0 && ` · ${held} handed out`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <ConnectionDot state={connection} />
            {session.authMode !== 'token' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => { await logout(); loadSession(); }}
              >
                <LogOut className="size-3.5" />
              </Button>
            )}
          </div>
        </header>

        {error && (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">{error}</p>
        )}

        {requests === null ? null : requests.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/70 py-16 text-center">
            <Inbox className="size-8 text-muted-foreground/60" />
            <p className="text-sm font-medium">Nothing is waiting</p>
          </div>
        ) : (
          <div className="space-y-4">
            {requests.map(request => (
              <RequestCard key={request.id} request={request} onChanged={refresh} />
            ))}
          </div>
        )}

        <PanesPanel agents={agents} onChanged={refresh} />

        <DevicesPanel />
      </div>
      <Toaster position="bottom-right" />
    </div>
  );
}
