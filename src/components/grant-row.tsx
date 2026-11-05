import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DetailList, Disclosure } from '@/components/common';
import { keepGrant, parseLabel, revokeGrant, type ConnectedAgent, type Grant, type PoolEntry } from '@/lib/api';
import { describe } from '@/lib/errors';
import { absolute, ago } from '@/lib/format';
import { exactRulesFor, keepDefaults, keptBy } from '@/lib/rules';

interface Props {
  agent: ConnectedAgent;
  grant: Grant;
  pool: PoolEntry[] | null;
  onChanged: () => void;
  onShowRule: (id: number, edit?: boolean) => void;
}

/** One current assignment: what it is, when it was used, and what can be done. */
export function GrantRow({ agent, grant, pool, onChanged, onShowRule }: Props) {
  const [busy, setBusy] = useState<'keep' | 'revoke' | null>(null);
  const { location, command, title } = parseLabel(grant.label);
  const kept = pool ? keptBy(pool, agent.identity, grant) : undefined;
  const helpText = keepDefaults(agent.identity);

  const keep = async () => {
    setBusy('keep');
    const known = new Set(pool?.map(entry => entry.id) ?? []);
    try {
      const { entry } = await keepGrant(agent.id, grant.target);
      const existed = known.has(entry.id);
      toast.success(existed ? `Rule #${entry.id} already keeps ${grant.target}` : `Rule #${entry.id} keeps ${grant.target} automatically`, {
        description: existed ? undefined : helpText,
        action: { label: 'Edit rule', onClick: () => onShowRule(entry.id, true) },
      });
      onChanged();
      onShowRule(entry.id);
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
      onChanged();
    } catch (cause) {
      toast.error(describe(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-t border-border px-4 py-3 max-sm:grid-cols-1">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <code className="font-mono text-sm font-semibold">{grant.target}</code>
          {location ? <span className="font-mono text-sm break-anywhere">{location}</span> : <span className="font-mono text-sm break-anywhere">{grant.label}</span>}
          {command && <span className="rounded-sm bg-muted px-1.5 font-mono text-xs leading-[18px]">{command}</span>}
        </div>
        <p className="mt-1 text-xs leading-[18px] text-muted-foreground">
          {grant.lastActivity ? `Used ${ago(grant.lastActivity)}` : 'No activity reported'} · Assigned {ago(grant.since)}
        </p>
      </div>
      <div className="flex flex-wrap items-start justify-end gap-1">
        {kept ? (
          <Button variant="ghost" size="sm" onClick={() => onShowRule(kept.id)}>View rule #{kept.id}</Button>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" disabled={busy !== null || pool === null} onClick={() => void keep()}>
                {busy === 'keep' ? 'Keeping…' : 'Keep automatically'}
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">{helpText}</TooltipContent>
          </Tooltip>
        )}
        <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void revoke()} aria-label={`Revoke ${grant.target}`}>
          {busy === 'revoke' ? 'Revoking…' : 'Revoke'}
        </Button>
      </div>
      <Disclosure summary={<>Details<span className="sr-only"> for {grant.target}</span></>} className="col-span-full" summaryClassName="py-0.5">
        <DetailList
          items={[
            ['Label', grant.label, true],
            ['Title', title || 'None'],
            ['Kind', grant.kind === 'window' ? 'Window' : 'Pane'],
            ['Reason', grant.reason ?? 'Not reported'],
            ['Assigned', absolute(grant.since)],
            ['Last activity', grant.lastActivity ? absolute(grant.lastActivity) : 'No activity reported'],
            ['Keep automatically', helpText],
            ['Revoking', 'Ends this assignment only. Automatic rules stay until you remove them.'],
          ]}
        />
      </Disclosure>
    </li>
  );
}
