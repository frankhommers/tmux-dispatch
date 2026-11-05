import { useId, useState } from 'react';
import { ChevronDown, Repeat } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DetailList, NotReported, Tag, TimeAgo } from '@/components/common';
import { keepGrant, parseLabel, revokeGrant, type ConnectedAgent, type Grant, type PoolEntry } from '@/lib/api';
import { describe } from '@/lib/errors';
import { absolute, ago } from '@/lib/format';
import { exactRulesFor, keepDefaults, keepScope, keptBy } from '@/lib/rules';
import { cn } from '@/lib/utils';

/**
 * Grant rows line up as columns from lg up:
 * target | location, command, title | activity | automatic | revoke | details.
 * Below lg each row folds into two lines.
 */
const GRID = 'lg:grid lg:grid-cols-[72px_minmax(0,1fr)_132px_188px_92px_28px] lg:items-center lg:gap-x-3';

interface Props {
  agent: ConnectedAgent;
  grant: Grant;
  pool: PoolEntry[] | null;
  onChanged: () => void;
  onShowRule: (id: number, edit?: boolean) => void;
  /** Called once a revoke succeeded, so focus can move before this row goes. */
  onRevoked?: () => void;
}

/** One current assignment: what it is, when it was used, and what can be done. */
export function GrantRow({ agent, grant, pool, onChanged, onShowRule, onRevoked }: Props) {
  const [busy, setBusy] = useState<'keep' | 'revoke' | null>(null);
  const [open, setOpen] = useState(false);
  // The rule just made, shown until the refreshed pool can say so itself.
  const [justKept, setJustKept] = useState<{ id: number; pool: PoolEntry[] | null } | null>(null);
  const detailsId = useId();
  const scopeId = useId();

  const { location, command, title } = parseLabel(grant.label);
  const offline = !agent.connected;
  const scope = keepScope(agent.identity);
  const keptRule = pool ? keptBy(pool, agent.identity, grant) : undefined;
  const keptId = keptRule?.id
    ?? (justKept && (justKept.pool === pool || pool?.some(entry => entry.id === justKept.id)) ? justKept.id : undefined);

  const keep = async () => {
    setBusy('keep');
    const known = new Set(pool?.map(entry => entry.id) ?? []);
    try {
      const { entry } = await keepGrant(agent.id, grant.target);
      const existed = known.has(entry.id);
      setJustKept({ id: entry.id, pool });
      toast.success(
        existed ? `Rule #${entry.id} already auto-assigns ${grant.target}` : `Rule #${entry.id} auto-assigns ${grant.target} next time`,
        {
          description: existed ? undefined : scope,
          action: { label: 'View rule', onClick: () => onShowRule(entry.id) },
          cancel: { label: 'Edit', onClick: () => onShowRule(entry.id, true) },
        },
      );
      onChanged();
    } catch (cause) {
      toast.error(describe(cause));
    } finally {
      setBusy(null);
    }
  };

  const revoke = async () => {
    setBusy('revoke');
    try {
      await revokeGrant(agent.id, grant.target);
      const related = pool ? exactRulesFor(pool, agent, grant) : [];
      const ruleNote = related.length > 0
        ? `Rule #${related[0].id} can still assign it automatically. Removing a rule is separate.`
        : undefined;
      toast.success(agent.connected ? `Revoked ${grant.target}` : 'Revocation recorded. Takes effect at its next action.', {
        description: ruleNote,
        action: related.length > 0 ? { label: 'View rule', onClick: () => onShowRule(related[0].id) } : undefined,
      });
      onRevoked?.();
      onChanged();
    } catch (cause) {
      toast.error(describe(cause));
    } finally {
      setBusy(null);
    }
  };

  const strong = offline ? 'text-muted-foreground' : 'text-foreground';

  return (
    <li className="group/grant border-t border-border/70 first:border-t-0 hover:bg-muted/40">
      <div className={cn('flex flex-col gap-1.5 px-4 py-2 max-lg:py-2.5', GRID)}>
        {/* Line one below lg: what is assigned. */}
        <div className="flex min-w-0 items-baseline gap-x-2.5 lg:contents">
          <code className={cn('shrink-0 font-mono text-sm leading-5 font-semibold', strong)}>{grant.target}</code>
          <div className="flex min-w-0 flex-1 items-center gap-x-2">
            <span className={cn('font-mono text-[13px] leading-5 break-anywhere', location ? 'shrink-0' : 'min-w-0', strong)}>
              {location || grant.label}
            </span>
            {command && <Tag className="font-mono font-normal">{command}</Tag>}
            {title && (
              <span title={title} className="min-w-0 truncate text-[13px] leading-5 text-muted-foreground">
                {title}
              </span>
            )}
          </div>
        </div>

        {/* Line two below lg: when it was used, and what can be done. */}
        <div className="flex min-w-0 items-center justify-between gap-2 lg:contents">
          <span className="min-w-0 truncate text-[13px] leading-5 text-muted-foreground">
            {grant.lastActivity ? <TimeAgo at={grant.lastActivity} prefix="Used" /> : 'No activity'}
          </span>

          <div className="flex shrink-0 items-center gap-1 lg:contents">
            <span id={scopeId} className="sr-only">
              {keptId !== undefined ? `Rule #${keptId} assigns ${grant.target} to this agent again automatically.` : `Creates a rule: ${scope}.`}
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-describedby={scopeId}
                  disabled={keptId === undefined && (busy !== null || pool === null)}
                  onClick={() => (keptId !== undefined ? onShowRule(keptId) : void keep())}
                  className={cn(
                    'px-2 lg:justify-self-start',
                    keptId !== undefined
                      ? 'text-live hover:bg-live-surface hover:text-live'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {keptId !== undefined ? (
                    <>
                      <Repeat aria-hidden className="size-3.5" />
                      Auto · rule #{keptId}
                    </>
                  ) : busy === 'keep' ? (
                    'Saving…'
                  ) : (
                    <>
                      <span className="sm:hidden">Auto-assign</span>
                      <span className="max-sm:hidden">Auto-assign next time</span>
                    </>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-64">
                {keptId !== undefined ? `Rule #${keptId} assigns it again. Open in Rules.` : scope}
              </TooltipContent>
            </Tooltip>

            <Button
              variant="outline"
              size="sm"
              className="lg:justify-self-end"
              disabled={busy !== null}
              onClick={() => void revoke()}
              aria-label={busy === 'revoke' ? undefined : `Revoke ${grant.target}`}
            >
              {busy === 'revoke' ? 'Revoking…' : 'Revoke'}
            </Button>

            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground hover:text-foreground lg:justify-self-end"
              aria-expanded={open}
              aria-controls={detailsId}
              aria-label={`Details for ${grant.target}`}
              onClick={() => setOpen(value => !value)}
            >
              <ChevronDown aria-hidden className={cn('transition-transform', open && 'rotate-180')} />
            </Button>
          </div>
        </div>
      </div>

      <div id={detailsId} hidden={!open} className="px-4 pb-3 lg:pl-[calc(1rem+72px+0.75rem)]">
        {open && (
          <div className="rounded-md bg-muted/60 px-3 py-2.5">
            <DetailList
              items={[
                ['Reason', grant.reason || <NotReported />],
                ['Assigned', `${absolute(grant.since)} (${ago(grant.since)})`],
                ['Last activity', grant.lastActivity ? `${absolute(grant.lastActivity)} (${ago(grant.lastActivity)})` : 'No activity reported'],
                ['Kind', grant.kind === 'window' ? 'Window' : 'Pane'],
                ['Title', title || <span className="text-muted-foreground">None</span>],
                ['Label', grant.label, true],
                ['Auto-assign', keptId !== undefined ? `Rule #${keptId} assigns it again.` : keepDefaults(agent.identity)],
              ]}
            />
          </div>
        )}
      </div>
    </li>
  );
}
