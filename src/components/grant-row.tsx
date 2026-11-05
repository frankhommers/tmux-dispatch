import { useId, useState } from 'react';
import { ChevronDown, Repeat, Repeat1 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DetailList, NotReported, Tag, TimeAgo } from '@/components/common';
import { keepGrant, parseLabel, revokeGrant, type ConnectedAgent, type Grant, type PoolEntry } from '@/lib/api';
import { describe } from '@/lib/errors';
import { absolute, ago } from '@/lib/format';
import { exactRulesFor, keepDefaults, keepScope, keptBy, lifecycleOf, type RuleLifecycle } from '@/lib/rules';
import { cn } from '@/lib/utils';

/**
 * Grant rows line up as columns from lg up:
 * target | location, command, title | activity | automatic | revoke | details.
 * Below lg each row folds into two lines; on phones activity gets a line of
 * its own and the rule scope shows under "Auto-assign next time".
 */
const GRID = 'lg:grid lg:grid-cols-[72px_minmax(0,1fr)_132px_188px_92px_28px] lg:items-center lg:gap-x-3';

/** What the grant row says about the rule that assigns this target again, by lifecycle. */
function linkedCopy(id: number, state: RuleLifecycle, target: string) {
  switch (state) {
    case 'reusable':
      return {
        label: `Auto · rule #${id}`,
        detail: `Rule #${id} assigns it again automatically.`,
        spoken: `Rule #${id} assigns ${target} to this agent again automatically. Opens the rule.`,
      };
    case 'once':
      return {
        label: `Auto once · rule #${id}`,
        detail: `Rule #${id} assigns it automatically one more time, then it is used up.`,
        spoken: `Rule #${id} assigns ${target} to this agent automatically one more time. Opens the rule.`,
      };
    case 'spent':
      return {
        label: `Rule #${id} used up`,
        detail: `Rule #${id} was for one use and has been used. Reset it in Rules to assign it again.`,
        spoken: `Rule #${id} is used up and will not assign ${target} again until reset. Opens the rule.`,
      };
  }
}

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
  const [justKept, setJustKept] = useState<{ id: number; state: RuleLifecycle; pool: PoolEntry[] | null } | null>(null);
  const detailsId = useId();
  const scopeId = useId();

  const { location, command, title } = parseLabel(grant.label);
  const offline = !agent.connected;
  const scope = keepScope(agent.identity);
  const keptRule = pool ? keptBy(pool, agent.identity, grant) : undefined;
  // The rule keep would return. When spent, keeping again would only return it
  // (the server dedupes on scope), so the row links to it for a Reset instead.
  const linked = keptRule
    ? { id: keptRule.id, state: lifecycleOf(keptRule) }
    : justKept && (justKept.pool === pool || pool?.some(entry => entry.id === justKept.id))
      ? { id: justKept.id, state: justKept.state }
      : undefined;
  const copy = linked && linkedCopy(linked.id, linked.state, grant.target);
  const activity = grant.lastActivity ? <TimeAgo at={grant.lastActivity} prefix="Used" /> : 'No activity';

  const keep = async () => {
    setBusy('keep');
    const known = new Set(pool?.map(entry => entry.id) ?? []);
    try {
      const { entry } = await keepGrant(agent.id, grant.target);
      const existed = known.has(entry.id);
      const state = lifecycleOf(entry);
      setJustKept({ id: entry.id, state, pool });
      toast.success(
        !existed
          ? `Rule #${entry.id} auto-assigns ${grant.target} next time`
          : state === 'reusable'
            ? `Rule #${entry.id} already auto-assigns ${grant.target}`
            : `Rule #${entry.id} already exists for ${grant.target}`,
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
      // Only rules that can still fire; a reusable one says the most about what happens next.
      const related = pool ? exactRulesFor(pool, agent, grant) : [];
      const next = related.find(entry => entry.reusable) ?? related[0];
      const ruleNote = next
        ? `Rule #${next.id} can still assign it automatically${next.reusable ? '' : ', once'}. Removing a rule is separate.`
        : undefined;
      toast.success(agent.connected ? `Revoked ${grant.target}` : 'Revocation recorded. Takes effect at its next action.', {
        description: ruleNote,
        action: next ? { label: 'View rule', onClick: () => onShowRule(next.id) } : undefined,
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
            <span
              className={cn(
                'font-mono text-[13px] leading-5 break-anywhere',
                location ? 'shrink-0 max-sm:min-w-0 max-sm:shrink' : 'min-w-0',
                strong,
              )}
            >
              {location || grant.label}
            </span>
            {command && <Tag className="font-mono font-normal">{command}</Tag>}
            {title && (
              <span title={title} className="min-w-0 truncate text-[13px] leading-5 text-muted-foreground max-sm:hidden">
                {title}
              </span>
            )}
          </div>
        </div>

        {/* Phones: activity first, whole, then the title in what room is left. */}
        <p className="flex min-w-0 items-baseline gap-x-1.5 text-[13px] leading-5 text-muted-foreground sm:hidden">
          <span className="shrink-0 whitespace-nowrap">{activity}</span>
          {title && (
            <>
              <span aria-hidden>·</span>
              <span title={title} className="min-w-0 truncate">{title}</span>
            </>
          )}
        </p>

        {/* Line two below lg: when it was used, and what can be done. */}
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 sm:flex-nowrap lg:contents">
          <span className="shrink-0 text-[13px] leading-5 whitespace-nowrap text-muted-foreground max-sm:hidden lg:min-w-0 lg:truncate">
            {activity}
          </span>

          <div className="flex shrink-0 items-center gap-1 max-sm:w-full lg:contents">
            <span id={scopeId} className="sr-only">
              {copy ? copy.spoken : `Creates a rule: ${scope}.`}
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-describedby={scopeId}
                  disabled={!linked && (busy !== null || pool === null)}
                  onClick={() => (linked ? onShowRule(linked.id) : void keep())}
                  className={cn(
                    'px-2 max-sm:-ml-2 max-sm:mr-auto lg:justify-self-start',
                    linked && linked.state !== 'spent'
                      ? 'text-live hover:bg-live-surface hover:text-live'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {copy && linked ? (
                    <>
                      {linked.state === 'reusable' && <Repeat aria-hidden className="size-3.5" />}
                      {linked.state === 'once' && <Repeat1 aria-hidden className="size-3.5" />}
                      {copy.label}
                    </>
                  ) : busy === 'keep' ? (
                    'Saving…'
                  ) : (
                    'Auto-assign next time'
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-64">
                {copy ? `${copy.detail} Open in Rules.` : scope}
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

          {/* Phones have no hover: say what the rule would cover before it is made. */}
          {!linked && pool !== null && (
            <p aria-hidden className="basis-full text-xs leading-4 text-muted-foreground sm:hidden">{scope}</p>
          )}
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
                ['Auto-assign', copy ? copy.detail : keepDefaults(agent.identity)],
              ]}
            />
          </div>
        )}
      </div>
    </li>
  );
}
