import { MoreHorizontal, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dot, Tag, TimeAgo } from '@/components/common';
import type { PoolEntry } from '@/lib/api';
import { shortHost, shortPath, shortServer, shortSession } from '@/lib/format';
import { anyLabel, type Element } from '@/lib/rule-draft';
import { cn } from '@/lib/utils';

/** A one-shot rule that already answered once, and now waits for a reset. */
export const isSpent = (rule: PoolEntry) => !rule.reusable && rule.usedAt !== null;

/** What a condition cell shows: a short value with the full one on hover, or a quiet "Any …". */
export function conditionText(rule: PoolEntry, element: Element): { text: string; full: string | null } {
  if (element === 'pattern') {
    return rule.pattern === '*' ? { text: anyLabel('pattern', rule.kind), full: null } : { text: rule.pattern, full: rule.pattern };
  }
  const value = rule[element];
  if (value === null) return { text: anyLabel(element, rule.kind), full: null };
  const short = element === 'session' ? shortSession(value)
    : element === 'cwd' ? shortPath(value)
      : element === 'host' ? shortHost(value)
        : shortServer(value);
  return { text: short, full: value };
}

/** A condition value as plain text. Display only: the editor has the exact value. */
export function ConditionValue({ rule, element, className }: { rule: PoolEntry; element: Element; className?: string }) {
  const { text, full } = conditionText(rule, element);
  if (full === null) return <span className={cn('text-[13px] leading-[18px] text-muted-foreground', className)}>{text}</span>;
  return (
    <span title={full !== text ? full : undefined} className={cn('font-mono text-[13px] leading-[18px] break-anywhere select-text', className)}>
      {full !== text && <span className="sr-only">{full}</span>}
      <span aria-hidden={full !== text ? true : undefined}>{text}</span>
    </span>
  );
}

/** The target a rule hands over: the thing the row is about. */
export function TargetValue({ rule, dim }: { rule: PoolEntry; dim: boolean }) {
  if (rule.pattern === '*') {
    return <span className={cn('text-sm leading-5 font-medium', dim ? 'text-muted-foreground' : 'text-foreground')}>{anyLabel('pattern', rule.kind)}</span>;
  }
  return (
    <span className={cn('font-mono text-sm leading-5 font-semibold break-anywhere select-text', dim ? 'text-muted-foreground' : 'text-foreground')}>
      {rule.pattern}
    </span>
  );
}

export function kindLine(rule: PoolEntry): string {
  return `${rule.kind === 'window' ? 'Window' : 'Pane'} · rule #${rule.id}`;
}

/** Whether the tmux server the rule names has an agent on it right now. */
export function ServerState({ rule, className }: { rule: PoolEntry; className?: string }) {
  if (rule.live === null) return null;
  return (
    <span className={cn('flex items-center gap-1.5 text-xs leading-4', rule.live ? 'text-live' : 'text-muted-foreground', className)}>
      <Dot tone={rule.live ? 'live' : 'offline'} />
      {rule.live ? 'Server online' : 'No agent online'}
    </span>
  );
}

/** Whether the rule can answer again, as a tag that says so in words. */
export function StatusTag({ rule }: { rule: PoolEntry }) {
  if (rule.reusable) return <Tag tone="neutral">Reusable</Tag>;
  if (isSpent(rule)) return <Tag tone="muted">Used up</Tag>;
  return <Tag tone="live">Ready · once</Tag>;
}

export function LastUsed({ rule, className }: { rule: PoolEntry; className?: string }) {
  return rule.usedAt
    ? <TimeAgo at={rule.usedAt} prefix="Used" className={cn('text-xs leading-4 text-muted-foreground', className)} />
    : <span className={cn('text-xs leading-4 text-muted-foreground', className)}>Never used</span>;
}

export function ResetButton({ rule, busy, onReset, className }: {
  rule: PoolEntry;
  busy: boolean;
  onReset: (rule: PoolEntry) => void;
  className?: string;
}) {
  return (
    <Button
      size="xs"
      variant="outline"
      className={className}
      disabled={busy}
      aria-label={`Reset rule ${rule.id} for one more use`}
      onClick={() => onReset(rule)}
    >
      <RotateCcw aria-hidden />
      {busy ? 'Resetting…' : 'Reset'}
    </Button>
  );
}

/** The less frequent row actions. Edit and Clone stay visible beside it. */
export function RuleMenu({ rule, busy, onReset, onDelete, className }: {
  rule: PoolEntry;
  busy: boolean;
  onReset: (rule: PoolEntry) => void;
  onDelete: (rule: PoolEntry) => void;
  className?: string;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={busy}
          aria-label={`More actions for rule ${rule.id}`}
          className={cn('text-muted-foreground hover:text-foreground data-[state=open]:bg-accent', className)}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>Rule #{rule.id}</DropdownMenuLabel>
        {isSpent(rule) && (
          <DropdownMenuItem onSelect={() => onReset(rule)}>
            <RotateCcw aria-hidden />
            Reset for one use
          </DropdownMenuItem>
        )}
        {isSpent(rule) && <DropdownMenuSeparator />}
        <DropdownMenuItem variant="destructive" onSelect={() => onDelete(rule)}>
          <Trash2 aria-hidden />
          Delete rule…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
