import { useEffect, useState } from 'react';
import { ArrowDownToLine, Inbox, LogOut, TerminalSquare } from 'lucide-react';
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
  const label = state === 'live' ? 'Live updates' : state === 'connecting' ? 'Connecting updates' : 'Reconnecting updates';
  return (
    <span className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium">
      <span className="relative flex size-2">
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
    <div className="min-h-dvh">
      <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-8 px-4 py-6 sm:px-8 sm:py-10">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-xl border border-live/40 bg-live/10 text-live">
              <TerminalSquare className="size-6" />
            </span>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">tmux-dispatch</h1>
              <p className="text-sm text-muted-foreground">Your terminals. Your call.</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ConnectionDot state={connection} />
            {session.authMode !== 'token' && (
              <Button
                variant="ghost"
                size="sm"
                aria-label="Sign out"
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

        <section aria-label="Overview" className="grid grid-cols-2 divide-x divide-border rounded-xl border border-border bg-card">
          {[
            { label: 'Waiting', value: requests === null ? '—' : pending, icon: Inbox },
            { label: 'Assigned', value: requests === null ? '—' : held, icon: ArrowDownToLine },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="px-4 py-5 sm:px-6">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground sm:text-sm">
                <Icon className="hidden size-4 sm:block" />{label}
              </div>
              <p className="text-3xl font-semibold tabular-nums tracking-tight">{value}</p>
            </div>
          ))}
        </section>

        <section aria-labelledby="requests-heading" className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 id="requests-heading" className="text-lg font-semibold">Requests</h2>
              <p className="text-sm text-muted-foreground">Choose which terminal each agent can use.</p>
            </div>
            {pending > 0 && <span className="rounded-full bg-live/15 px-3 py-1 text-xs font-semibold text-live">{pending} waiting</span>}
          </div>
          {requests === null ? (
            <div role="status" className="rounded-xl border border-border bg-card p-8 text-sm text-muted-foreground">Loading requests…</div>
          ) : requests.length === 0 ? (
            <div className="flex items-center gap-4 rounded-xl border border-border bg-card px-6 py-8">
              <span className="grid size-12 shrink-0 place-items-center rounded-full bg-live/10 text-live"><Inbox className="size-6" /></span>
              <div>
                <p className="font-semibold">All caught up</p>
                <p className="mt-1 text-sm text-muted-foreground">New requests will appear here when an agent needs a terminal.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {requests.map(request => (
                <RequestCard key={request.id} request={request} onChanged={refresh} />
              ))}
            </div>
          )}
        </section>

        <PanesPanel agents={agents} onChanged={refresh} />

        <DevicesPanel agents={agents} />
        <footer className="border-t border-border pt-4 text-xs text-muted-foreground">Access is managed per pane. You can revoke an assignment at any time.</footer>
      </main>
      <Toaster position="bottom-right" />
    </div>
  );
}
