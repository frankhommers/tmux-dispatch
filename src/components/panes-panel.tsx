import { useCallback, useEffect, useState } from 'react';
import { Ellipsis, Pin, Plus, TerminalSquare, Undo2 } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  addPoolEntry,
  forgetAgent,
  keepGrant,
  listPool,
  parseLabel,
  removePoolEntry,
  revokeGrant,
  type ConnectedAgent,
  type Grant,
  type PoolEntry,
} from '@/lib/api';
import { ago, projectName } from '@/lib/format';
import { cn } from '@/lib/utils';

/** A rule naming a bare id speaks about one pane; anything else is a pattern. */
function namesAPane(pattern: string): boolean {
  return /^[%@]\d+$/.test(pattern);
}

/**
 * One line of the table: a pane, with whatever is true of it. It may be held
 * by an agent, kept by a rule, or both — and a pattern rule is a row that is
 * neither, which is why every field but the name is optional.
 */
interface Row {
  key: string;
  target: string;
  command: string;
  location: string;
  agent?: ConnectedAgent;
  grant?: Grant;
  rule?: PoolEntry;
}

interface Group {
  cwd: string | null;
  label: string;
  rows: Row[];
}

/** Held and kept are the same subject, so they are one table. */
function group(agents: ConnectedAgent[], pool: PoolEntry[]): Group[] {
  const groups = new Map<string, Group>();
  const take = (cwd: string | null): Group => {
    const key = cwd ?? '';
    const existing = groups.get(key);
    if (existing) return existing;
    const made = { cwd, label: cwd ? projectName(cwd) : 'Any project', rows: [] };
    groups.set(key, made);
    return made;
  };

  /** The rule that keeps this exact pane for this exact agent, if any. */
  const ruleFor = (agent: ConnectedAgent, target: string) => pool.find(entry =>
    entry.pattern === target
    && entry.cwd === agent.identity.cwd
    && entry.tmuxServer === agent.identity.tmuxServer);

  const claimed = new Set<number>();
  for (const agent of agents) {
    for (const grant of agent.grants) {
      const rule = ruleFor(agent, grant.target);
      if (rule) claimed.add(rule.id);
      const { location, command } = parseLabel(grant.label);
      take(agent.identity.cwd).rows.push({
        key: `${agent.id}:${grant.target}`,
        target: grant.target,
        command,
        location,
        agent,
        grant,
        rule,
      });
    }
  }

  // Rules nobody is holding right now: the pane is still spoken for.
  for (const entry of pool) {
    if (claimed.has(entry.id)) continue;
    const cwd = namesAPane(entry.pattern) ? entry.cwd : null;
    take(cwd).rows.push({
      key: `rule-${entry.id}`,
      target: entry.pattern,
      command: '',
      location: '',
      rule: entry,
    });
  }

  return [...groups.values()]
    .map(g => ({
      ...g,
      // Keep rows stable when an agent briefly connects to report activity.
      rows: [...g.rows].sort((a, b) =>
        a.target.localeCompare(b.target, undefined, { numeric: true })),
    }))
    // Real projects in alphabetical order; the catch-all last.
    .sort((a, b) => Number(a.cwd === null) - Number(b.cwd === null) || a.label.localeCompare(b.label));
}

/** What the row is doing, in the order a human would want to hear it. */
function activityOf(row: Row): string {
  const acted = row.grant?.lastActivity ?? row.rule?.lastActivity ?? null;
  if (acted) return `used ${ago(acted)}`;
  if (row.grant) return `assigned ${ago(row.grant.since)}`;
  // Nobody is holding it, so the last thing that happened is the rule firing.
  if (row.rule?.usedAt) return `handed over ${ago(row.rule.usedAt)}`;
  return 'not used yet';
}

interface Props {
  agents: ConnectedAgent[];
  onChanged: () => void;
}

/**
 * Every pane that is spoken for: who holds it, whether it keeps coming back,
 * and when it was last used. The pin is the whole of "keep" — pressed means
 * agents working here get it back without asking.
 */
export function PanesPanel({ agents, onChanged }: Props) {
  const [pool, setPool] = useState<PoolEntry[]>([]);
  const [pattern, setPattern] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const loadPool = useCallback(async () => {
    try {
      setPool((await listPool()).pool);
    } catch (cause) {
      toast.error((cause as Error).message);
    }
  }, []);

  // The rules move with what the agents report, so they are read again
  // whenever the inbox says something changed.
  useEffect(() => { void loadPool(); }, [loadPool, agents]);

  const changed = () => { void loadPool(); onChanged(); };

  const act = async (key: string, run: () => Promise<void>) => {
    setBusy(key);
    try {
      await run();
      changed();
    } catch (cause) {
      toast.error((cause as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const togglePin = (row: Row) => act(row.key, async () => {
    if (row.rule) {
      await removePoolEntry(row.rule.id);
      toast.success(`${row.target} is no longer kept`);
      return;
    }
    if (!row.agent) return;
    await keepGrant(row.agent.id, row.target);
    toast.success(`${row.target} stays with ${projectName(row.agent.identity.cwd)}`, {
      description: 'Agents working there get it back without asking.',
    });
  });

  const revoke = (row: Row) => act(row.key, async () => {
    if (!row.agent) return;
    await revokeGrant(row.agent.id, row.target);
    toast.success(`Revoked ${row.target}`, {
      description: row.agent.connected ? undefined : 'Lands at its next action.',
    });
  });

  const forget = (row: Row) => act(row.key, async () => {
    if (!row.agent) return;
    await forgetAgent(row.agent.id);
  });

  const groups = group(agents, pool);
  const panes = groups.reduce((total, g) => total + g.rows.length, 0);

  return (
    <Card className="border-border">
      <CardHeader className="gap-1">
        <div className="flex items-center gap-2">
          <TerminalSquare className="size-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Pane access</h2>
          <span className="flex-1" />
          <span className="text-xs text-muted-foreground">
            {panes} {panes === 1 ? 'entry' : 'entries'}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">See who has access. Pin a pane to assign it automatically next time.</p>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {panes === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing handed out.</p>
        ) : (
          <div>
            <p className="mb-2 text-xs text-muted-foreground xl:hidden">Scroll the table horizontally to see all columns.</p>
            <div role="region" aria-label="Pane access table" tabIndex={0} className="overflow-x-auto rounded-lg border border-border focus-visible:outline-2 focus-visible:outline-ring">
              <table className="w-full min-w-[800px] border-collapse text-sm">
            <caption className="sr-only">Assigned panes and automatic assignment rules, grouped by project</caption>
            <thead>
              <tr className="bg-muted text-xs font-semibold tracking-wide text-foreground uppercase">
                <th scope="col" className="px-4 py-3 text-left">Pane / rule</th>
                <th scope="col" className="px-4 py-3 text-left">Agent / machine</th>
                <th scope="col" className="px-4 py-3 text-left">Auto-assign</th>
                <th scope="col" className="px-4 py-3 text-left whitespace-nowrap">Last activity</th>
                <th scope="col" className="w-px px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>

            {groups.map(({ cwd, label, rows }) => (
              <tbody key={cwd ?? 'all-projects'}>
                <tr>
                  <th
                    colSpan={5}
                    scope="rowgroup"
                    title={cwd ?? 'Rules that are not tied to a directory'}
                    className="border-y border-border bg-background px-4 py-2.5 text-left text-sm font-semibold"
                  >
                    <span>{label}</span>
                    <span className="ml-3 font-normal text-muted-foreground">{rows.length} {rows.length === 1 ? 'entry' : 'entries'}</span>
                    {cwd && <span className="ml-4 font-mono text-xs font-normal text-muted-foreground">{cwd}</span>}
                  </th>
                </tr>

                {rows.map(row => (
                  <tr
                    key={row.key}
                    className={cn(
                      'border-t border-border even:bg-muted/25 transition-colors hover:bg-accent',
                      busy === row.key && 'pointer-events-none opacity-50'
                    )}
                  >
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2">
                        <span className="break-all font-mono font-semibold tabular-nums">{row.target}</span>
                        {row.command && <span className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">{row.command}</span>}
                      </div>
                      {row.location && <p className="mt-1 text-xs text-muted-foreground">{row.location}</p>}
                    </td>

                    <td className="px-4 py-4">
                      {row.agent ? (
                        <>
                          <p className="font-medium">{row.agent.identity.mcpClient ?? 'Agent'}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{row.agent.identity.host}</p>
                        </>
                      ) : <span className="text-muted-foreground">Not assigned</span>}
                    </td>

                    <td className="px-4 py-4">
                      <button
                        type="button"
                        disabled={busy === row.key}
                        aria-pressed={Boolean(row.rule)}
                        className={cn('inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring', row.rule ? 'border-live/40 bg-live/10 text-live hover:bg-live/20' : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground')}
                        aria-label={row.rule ? `Stop keeping ${row.target}` : `Keep ${row.target} for ${label}`}
                        title={row.rule ? 'Automatically assigned. Click to disable.' : 'Assigned once. Click to assign automatically next time.'}
                        onClick={() => void togglePin(row)}
                      >
                        <Pin className={cn('size-3.5', row.rule && 'fill-current')} />
                        {row.rule ? 'On' : 'Off'}
                      </button>
                    </td>

                    <td className="px-4 py-4 text-muted-foreground tabular-nums whitespace-nowrap">
                      {activityOf(row)}
                    </td>

                    <td className="px-4 py-4 whitespace-nowrap">
                      <div className="grid grid-cols-[6rem_2rem] items-center gap-2">
                        {row.grant && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="col-start-1 row-start-1"
                            disabled={busy === row.key}
                            aria-label={`Revoke ${row.target}`}
                            title="Take this pane back"
                            onClick={() => void revoke(row)}
                          >
                            <Undo2 className="size-3.5" />
                            Revoke
                          </Button>
                        )}
                        {row.agent && !row.agent.connected && (
                          <DropdownMenu.Root>
                            <DropdownMenu.Trigger asChild>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                className="col-start-2 row-start-1 text-muted-foreground"
                                disabled={busy === row.key}
                                aria-label={`More actions for ${row.target}`}
                              >
                                <Ellipsis className="size-4" />
                              </Button>
                            </DropdownMenu.Trigger>
                            <DropdownMenu.Portal>
                              <DropdownMenu.Content
                                align="end"
                                sideOffset={4}
                                className="z-50 w-64 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
                              >
                                <DropdownMenu.Label className="px-2 py-1.5 text-xs font-normal text-muted-foreground">
                                  Remove this offline agent’s {row.agent.grants.length} {row.agent.grants.length === 1 ? 'assignment' : 'assignments'} from the overview. Access is not revoked.
                                </DropdownMenu.Label>
                                <DropdownMenu.Item
                                  className="cursor-pointer rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent focus:text-accent-foreground"
                                  onSelect={() => void forget(row)}
                                >
                                  Forget agent
                                </DropdownMenu.Item>
                              </DropdownMenu.Content>
                            </DropdownMenu.Portal>
                          </DropdownMenu.Root>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
              </table>
            </div>
          </div>
        )}

        <form
          className="flex flex-wrap items-center gap-2 border-t border-border pt-3"
          onSubmit={async event => {
            event.preventDefault();
            if (!pattern.trim()) return;
            try {
              await addPoolEntry(pattern.trim(), 'pane', true);
              setPattern('');
              changed();
            } catch (cause) {
              toast.error((cause as Error).message);
            }
          }}
        >
          <label htmlFor="pane-pattern" className="w-full text-sm font-medium">Automatically assign a pane</label>
          <input
            id="pane-pattern"
            value={pattern}
            onChange={event => setPattern(event.target.value)}
            placeholder="%3, or a pattern like *agents:*"
            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 font-mono text-sm outline-none transition focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          <Button type="submit" size="sm" variant="secondary">
            <Plus className="size-3.5" />
            Add rule
          </Button>
          <p className="w-full text-xs text-muted-foreground">
            <code className="font-mono">%3</code> is one pane. Anything else is matched
            against <code className="font-mono">id session:window.pane command title</code>,
            with <code className="font-mono">*</code> for any text — so{' '}
            <code className="font-mono">*agents:*</code> is every pane in the session{' '}
            <code className="font-mono">agents</code>.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
