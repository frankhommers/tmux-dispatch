import { useId, useState, type ReactNode } from 'react';
import { AlertCircle, ChevronRight, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { describe } from '@/lib/errors';
import { absolute, ago, shortPath } from '@/lib/format';
import { cn } from '@/lib/utils';

export const inputClass =
  'h-9 w-full min-w-0 rounded-md border border-input bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-destructive max-sm:h-11';

export const selectClass =
  'h-9 min-w-0 rounded-md border border-input bg-card px-2 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-60 max-sm:h-11';

export function Panel({ className, children, ...props }: React.ComponentProps<'div'>) {
  return (
    <div className={cn('min-w-0 rounded-lg border border-border bg-card text-card-foreground', className)} {...props}>
      {children}
    </div>
  );
}

export type Tone = 'neutral' | 'attention' | 'urgent' | 'live' | 'muted';

const TONE: Record<Tone, string> = {
  neutral: 'bg-secondary text-secondary-foreground',
  attention: 'bg-warning-surface text-warning ring-1 ring-inset ring-warning-border/40',
  urgent: 'bg-urgent-surface text-destructive ring-1 ring-inset ring-destructive/30',
  live: 'bg-live-surface text-live',
  muted: 'bg-transparent text-muted-foreground ring-1 ring-inset ring-border',
};

/** A small label with a meaning: amber needs a decision, red is urgent, green is live. */
export function Tag({ tone = 'neutral', className, children, ...props }: React.ComponentProps<'span'> & { tone?: Tone }) {
  return (
    <span
      className={cn('inline-flex shrink-0 items-center gap-1 rounded px-1.5 text-xs leading-5 font-medium whitespace-nowrap', TONE[tone], className)}
      {...props}
    >
      {children}
    </span>
  );
}

/** A status dot; always next to text that says the same thing. */
export function Dot({ tone }: { tone: 'live' | 'offline' | 'attention' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-2 shrink-0 rounded-full',
        tone === 'live' && 'bg-live',
        tone === 'offline' && 'border border-muted-foreground',
        tone === 'attention' && 'bg-warning-border',
      )}
    />
  );
}

/** A relative time that tells the exact moment on hover and to assistive tech. */
export function TimeAgo({ at, prefix, className }: { at: number; prefix?: string; className?: string }) {
  return (
    <time dateTime={new Date(at).toISOString()} title={absolute(at)} className={className}>
      {prefix ? `${prefix} ` : ''}{ago(at)}
    </time>
  );
}

/** A working directory, shortened to what tells projects apart; the full path on hover and in selection. */
export function PathText({ path, className }: { path: string; className?: string }) {
  const short = shortPath(path);
  return (
    <code title={path} className={cn('font-mono text-xs text-muted-foreground select-text break-anywhere', className)}>
      {short !== path && <span className="sr-only">{path}</span>}
      <span aria-hidden={short !== path ? true : undefined}>{short}</span>
    </code>
  );
}

/** The one line at the top of a tab: what this is for, and what can be done. */
export function PanelToolbar({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <p className="min-w-0 text-[13px] leading-[18px] text-muted-foreground">{children}</p>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A small count next to a heading. Hidden until there is a real number. */
export function Count({ children }: { children: ReactNode }) {
  return <span className="ml-2 text-xs font-medium text-muted-foreground">{children}</span>;
}

export function SectionHeader({ id, title, count, description, actions }: {
  id: string;
  title: string;
  count?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 id={id} tabIndex={-1} className="text-lg leading-[26px] font-semibold">
          {title}
          {count !== undefined && count !== null && <Count>{count}</Count>}
        </h2>
        {description && <p className="mt-0.5 text-xs leading-[18px] text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * The quiet line under a section heading: a failed refresh over data still on
 * screen, a refresh in progress, or data that may be stale while the event
 * stream is down. Nothing at all when everything is current.
 */
export function SectionNotice({ error, refreshing, stale, what, onRetry }: {
  error: string | null;
  refreshing: boolean;
  stale: boolean;
  what: string;
  onRetry: () => void;
}) {
  if (error) {
    return (
      <div role="status" className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 px-3 py-2 text-xs text-destructive">
        <AlertCircle className="size-4" aria-hidden />
        <span>Could not refresh {what}. Showing the last loaded data. {error}</span>
        <Button size="xs" variant="outline" className="ml-auto text-foreground" onClick={onRetry} disabled={refreshing}>
          <RefreshCw aria-hidden className={cn(refreshing && 'animate-spin')} />
          Retry
        </Button>
      </div>
    );
  }
  if (stale) {
    return <p className="mb-3 text-xs text-muted-foreground">May be out of date while live updates reconnect.</p>;
  }
  return null;
}

/** First load failed: the error takes the list's place. */
export function LoadError({ what, error, onRetry, busy }: { what: string; error: string; onRetry: () => void; busy: boolean }) {
  return (
    <Panel className="flex flex-wrap items-center gap-3 px-4 py-4">
      <AlertCircle className="size-4 text-destructive" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium">Could not load {what}</p>
        <p className="text-xs text-muted-foreground break-anywhere">{error}</p>
      </div>
      <Button size="sm" variant="outline" onClick={onRetry} disabled={busy}>
        <RefreshCw aria-hidden className={cn(busy && 'animate-spin')} />
        Retry
      </Button>
    </Panel>
  );
}

/** A native disclosure, for secondary detail that must stay reachable without hover. */
export function Disclosure({ summary, children, className, summaryClassName, defaultOpen }: {
  summary: ReactNode;
  children: ReactNode;
  className?: string;
  summaryClassName?: string;
  defaultOpen?: boolean;
}) {
  return (
    <details className={cn('group text-xs', className)} open={defaultOpen}>
      <summary className={cn('inline-flex items-center gap-1 rounded-sm py-1 text-muted-foreground hover:text-foreground max-sm:min-h-11', summaryClassName)}>
        <ChevronRight className="disclosure-chevron size-3.5" aria-hidden />
        {summary}
      </summary>
      <div className="pt-2">{children}</div>
    </details>
  );
}

export type DetailItem = [label: string, value: ReactNode, mono?: boolean];

/** Labeled values, selectable in full. */
export function DetailList({ items, className }: { items: DetailItem[]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-1.5 text-xs leading-[18px] max-sm:grid-cols-1 max-sm:gap-y-0.5', className)}>
      {items.map(([label, value, mono]) => (
        <div key={label} className="contents max-sm:block max-sm:pb-1.5">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className={cn('m-0 min-w-0 break-anywhere select-text', mono && 'font-mono')}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function NotReported() {
  return <span className="text-muted-foreground">Not reported</span>;
}

export function InlineError({ id, children }: { id?: string; children: ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="flex items-start gap-1.5 text-xs leading-[18px] text-destructive">
      <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden />
      <span className="break-anywhere">{children}</span>
    </p>
  );
}

/**
 * A yes/no question before an action that cannot be taken back. It stays open
 * with the error inline when the action fails, and closes only on success.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel,
  busyLabel,
  cancelLabel = 'Cancel',
  destructive = true,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  children?: ReactNode;
  confirmLabel: string;
  busyLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** Resolve to close; throw to keep the dialog open with the message. */
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (busy) return;
        if (!next) setError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-left">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        <InlineError id={errorId}>{error}</InlineError>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            disabled={busy}
            aria-describedby={error ? errorId : undefined}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm();
                onOpenChange(false);
              } catch (cause) {
                setError(describe(cause));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? busyLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
