import { useEffect, useState, type ReactNode } from 'react';
import { Settings } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ThemeSelect } from '@/components/theme-select';
import type { Connection } from '@/hooks/use-inbox';
import { logout, type SessionInfo } from '@/lib/api';
import { describe } from '@/lib/errors';
import type { ThemePreference } from '@/lib/theme';
import { cn } from '@/lib/utils';

export function ConnectionStatus({ state, wasLive }: { state: Connection; wasLive: boolean }) {
  const label = state === 'live'
    ? 'Live updates'
    : state === 'connecting'
      ? 'Connecting…'
      : wasLive ? 'Reconnecting…' : 'Updates offline, retrying';
  return (
    <span role="status" className={cn('inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap', state === 'live' ? 'text-live' : 'text-muted-foreground')}>
      <span
        aria-hidden
        className={cn('size-1.5 rounded-full', state === 'live' ? 'bg-live' : state === 'offline' ? 'animate-pulse bg-warning-border' : 'bg-muted-foreground')}
      />
      {label}
    </span>
  );
}

type Permission = NotificationPermission | 'unsupported';

const readPermission = (): Permission => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);

function SettingsMenu({ session }: { session: SessionInfo }) {
  const [permission, setPermission] = useState<Permission>(readPermission);
  const account = session.authMode === 'token' ? 'Access link' : session.account ?? 'Local account';

  return (
    <DropdownMenu onOpenChange={open => { if (open) setPermission(readPermission()); }}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Settings">
          <Settings aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72">
        <DropdownMenuLabel>
          <span className="block">Signed in as</span>
          <span className="block text-sm font-medium text-foreground break-anywhere">{account}</span>
        </DropdownMenuLabel>
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
            Enable notifications
          </DropdownMenuItem>
        ) : (
          <DropdownMenuLabel className="leading-[18px]">
            {permission === 'granted'
              ? 'Desktop notifications are on for new requests.'
              : permission === 'denied'
                ? 'Notifications are blocked for this site. Allow them in the browser site settings to get alerts.'
                : 'This browser does not support desktop notifications.'}
          </DropdownMenuLabel>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SignOut({ onSignedOut }: { onSignedOut: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await logout();
          onSignedOut();
        } catch (cause) {
          toast.error(`Could not sign out. ${describe(cause)}`);
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </Button>
  );
}

export interface NavCounts {
  requests: number | null;
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

  const links: { href: string; label: string; count: number | null }[] = [
    { href: '#requests', label: 'Requests', count: counts.requests },
    { href: '#agents', label: 'Agents', count: counts.agents },
    { href: '#rules', label: 'Rules', count: counts.rules },
    { href: '#machines', label: 'Machines', count: null },
  ];

  return (
    <div className="min-h-dvh">
      <header className="border-b border-border bg-card sm:sticky sm:top-0 sm:z-40">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2 sm:min-h-14 sm:px-6">
          <div className="order-1 flex items-center gap-2.5">
            <span aria-hidden className="font-mono text-lg leading-6 text-live">&gt;_</span>
            <h1 className="text-base leading-6 font-[650]">tmux-dispatch</h1>
          </div>
          <div className="order-2 ml-auto sm:order-3">
            <ConnectionStatus state={connection} wasLive={wasLive} />
          </div>
          <nav aria-label="Sections" className="order-3 -mx-2 flex flex-wrap gap-1 max-sm:w-full sm:order-2 sm:mx-0">
            {links.map(link => (
              <a
                key={link.href}
                href={link.href}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground max-sm:min-h-11"
              >
                {link.label}
                {link.count !== null && <span className="text-foreground tabular-nums">{link.count}</span>}
              </a>
            ))}
          </nav>
          <div className="order-4 flex items-center gap-1 max-sm:w-full max-sm:justify-end">
            <ThemeSelect value={theme} onChange={onTheme} />
            <SettingsMenu session={session} />
            {session.authMode !== 'token' && <SignOut onSignedOut={onSignedOut} />}
          </div>
        </div>
      </header>
      <main className="mx-auto grid max-w-[1440px] gap-6 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
