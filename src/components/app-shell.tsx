import { useEffect, useState, type ReactNode } from 'react';
import { Bell, LogOut, Monitor, Moon, Settings, Sun } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Connection } from '@/hooks/use-inbox';
import { logout, type SessionInfo } from '@/lib/api';
import { describe } from '@/lib/errors';
import type { ThemePreference } from '@/lib/theme';
import { cn } from '@/lib/utils';

export function ConnectionStatus({ state, wasLive }: { state: Connection; wasLive: boolean }) {
  const label = state === 'live'
    ? 'Live'
    : state === 'connecting'
      ? 'Connecting…'
      : wasLive ? 'Reconnecting…' : 'Offline, retrying';
  return (
    <span
      role="status"
      title={state === 'live' ? 'Live updates are on' : 'Live updates are not connected; data may be out of date'}
      className={cn('inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap', state === 'live' ? 'text-live' : 'text-warning')}
    >
      <span
        aria-hidden
        className={cn('size-2 rounded-full', state === 'live' ? 'bg-live' : 'animate-pulse bg-warning-border')}
      />
      {label}
    </span>
  );
}

type Permission = NotificationPermission | 'unsupported';

const readPermission = (): Permission => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);

/** Everything that is not about terminals: who you are, appearance, alerts, signing out. */
function SettingsMenu({ session, theme, onTheme, onSignedOut }: {
  session: SessionInfo;
  theme: ThemePreference;
  onTheme: (value: ThemePreference) => void;
  onSignedOut: () => void;
}) {
  const [permission, setPermission] = useState<Permission>(readPermission);
  const [signingOut, setSigningOut] = useState(false);
  const account = session.authMode === 'token' ? 'Access link' : session.account ?? 'Local account';

  const signOut = async () => {
    setSigningOut(true);
    try {
      await logout();
      onSignedOut();
    } catch (cause) {
      toast.error(`Could not sign out. ${describe(cause)}`);
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <DropdownMenu onOpenChange={open => { if (open) setPermission(readPermission()); }}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Settings" className="max-sm:size-11">
          <Settings aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>
          <span className="block text-xs font-normal text-muted-foreground">Signed in as</span>
          <span className="block text-sm font-medium text-foreground break-anywhere">{account}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Appearance</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={value => onTheme(value as ThemePreference)}>
          <DropdownMenuRadioItem value="system"><Monitor aria-hidden />System</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="light"><Sun aria-hidden />Light</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark"><Moon aria-hidden />Dark</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        {permission === 'default' ? (
          <DropdownMenuItem
            onSelect={() => {
              void Notification.requestPermission().then(result => {
                setPermission(result);
                if (result === 'granted') toast.success('Notifications enabled for new requests');
              });
            }}
          >
            <Bell aria-hidden />
            Notify me of new requests
          </DropdownMenuItem>
        ) : (
          <DropdownMenuLabel className="text-xs leading-[18px] font-normal text-muted-foreground">
            {permission === 'granted'
              ? 'Desktop notifications are on for new requests.'
              : permission === 'denied'
                ? 'Notifications are blocked for this site. Allow them in the browser site settings to get alerts.'
                : 'This browser does not support desktop notifications.'}
          </DropdownMenuLabel>
        )}
        {session.authMode !== 'token' && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={signingOut} onSelect={event => { event.preventDefault(); void signOut(); }}>
              <LogOut aria-hidden />
              {signingOut ? 'Signing out…' : 'Sign out'}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface NavCounts {
  requests: number | null;
  /** Requests with less than ten minutes left, and those with less than two. */
  expiring?: number;
  urgent?: number;
  agents: number | null;
  rules: number | null;
}

export function AppShell({ session, connection, wasLive, counts, theme, onTheme, onSignedOut, children }: {
  session: SessionInfo;
  connection: Connection;
  wasLive: boolean;
  counts: NavCounts;
  theme: ThemePreference;
  onTheme: (value: ThemePreference) => void;
  onSignedOut: () => void;
  children: ReactNode;
}) {
  // Keep the document title useful in a background tab.
  useEffect(() => {
    document.title = counts.requests ? `(${counts.requests}) tmux-dispatch` : 'tmux-dispatch';
  }, [counts.requests]);

  const waiting = counts.requests ?? 0;
  const urgent = (counts.urgent ?? 0) > 0;
  const expiring = counts.expiring ?? 0;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-3 px-4 sm:gap-5 sm:px-6">
          <a href="#top" className="flex items-center gap-2 rounded-md" aria-label="tmux-dispatch, back to top">
            <span aria-hidden className="grid size-7 place-items-center rounded-md bg-foreground font-mono text-xs font-bold text-background">&gt;_</span>
            <h1 className="text-[15px] leading-6 font-semibold tracking-tight max-[400px]:sr-only">tmux-dispatch</h1>
          </a>
          {waiting > 0 && (
            <a
              href="#requests"
              aria-label={`${waiting} ${waiting === 1 ? 'request' : 'requests'} waiting${expiring > 0 ? `, ${expiring} expiring within 10 minutes` : ''}. Go to requests.`}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset max-sm:min-h-11',
                urgent
                  ? 'bg-urgent-surface text-destructive ring-destructive/40 hover:ring-destructive'
                  : 'bg-warning-surface text-warning ring-warning-border/50 hover:ring-warning-border',
              )}
            >
              <span aria-hidden className={cn('size-1.5 animate-pulse rounded-full', urgent ? 'bg-destructive' : 'bg-warning-border')} />
              {waiting} waiting
              {expiring > 0 && (
                <span className="font-medium">· {expiring}<span className="max-[420px]:hidden"> expiring</span><span className="min-[421px]:hidden"> soon</span></span>
              )}
            </a>
          )}
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <ConnectionStatus state={connection} wasLive={wasLive} />
            <SettingsMenu session={session} theme={theme} onTheme={onTheme} onSignedOut={onSignedOut} />
          </div>
        </div>
      </header>
      <main id="top" className="mx-auto grid max-w-[1440px] gap-8 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
