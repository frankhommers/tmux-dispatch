import { useCallback, useEffect, useState } from 'react';
import { Pin, Plus, TerminalSquare, Undo2, X } from 'lucide-react';
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
      // Live first, then the most recently touched.
      rows: [...g.rows].sort((a, b) =>
        Number(Boolean(b.agent?.connected)) - Number(Boolean(a.agent?.connected))
        || a.target.localeCompare(b.target, undefined, { numeric: true })),
    }))
    // Real projects in alphabetical order; the catch-all last.
    .sort((a, b) => Number(a.cwd === null) - Number(b.cwd === null) || a.label.localeCompare(b.label));
}

/** What the row is doing, in the order a human would want to hear it. */
function activityOf(row: Row): string {
  const acted = row.grant?.lastActivity ?? row.rule?.lastActivity ?? null;
  if (acted) return `active ${ago(acted)}`;
  if (row.grant) return `since ${ago(row.grant.since)}`;
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
  const manyHosts = new Set(agents.map(agent => agent.identity.host)).size > 1;

  return (
    <Card className="border-border/60">
      <CardHeader className="gap-1">
        <div className="flex items-center gap-2">
          <TerminalSquare className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Panes</h2>
          <span className="flex-1" />
          <span className="text-xs text-muted-foreground">
            {panes} pane{panes === 1 ? '' : 's'}
          </span>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {panes === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing handed out.</p>
        ) : (
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                <th className="w-14 pb-2 pr-3 text-left font-medium">Kept</th>
                <th className="pb-2 pr-6 text-left font-medium">Pane</th>
                <th className="w-full pb-2 pr-4 text-left font-medium">Agent</th>
                <th className="pb-2 text-right font-medium whitespace-nowrap">Last activity</th>
                <th className="pb-2" />
              </tr>
            </thead>

            {groups.map(({ cwd, label, rows }) => (
              <tbody key={label}>
                <tr>
                  <th
                    colSpan={5}
                    title={cwd ?? 'Rules that are not tied to a directory'}
                    className="pt-4 pb-1 text-left text-sm font-semibold"
                  >
                    <span className={cn(!cwd && 'font-normal text-muted-foreground italic')}>{label}</span>
                  </th>
                </tr>

                {rows.map(row => (
                  <tr
                    key={row.key}
                    className={cn(
                      'border-t border-border/60 transition hover:bg-accent/40',
                      busy === row.key && 'pointer-events-none opacity-50'
                    )}
                  >
                    <td className="py-3 pr-3">
                      <button
                        type="button"
                        aria-pressed={Boolean(row.rule)}
                        className={cn(
                          'group grid size-8 place-items-center rounded-full transition',
                          row.rule
                            ? 'bg-live/15 text-live ring-1 ring-live/30 hover:bg-destructive/15 hover:text-destructive hover:ring-destructive/30'
                            : 'text-muted-foreground/50 hover:bg-accent hover:text-foreground'
                        )}
                        aria-label={row.rule
                          ? `Stop keeping ${row.target}`
                          : `Keep ${row.target} for ${label}`}
                        title={row.rule
                          ? 'Kept. Press to let it go.'
                          : 'Handed over once. Press to keep it for this project.'}
                        onClick={() => void togglePin(row)}
                      >
                        <Pin
                          className={cn(
                            'size-4 transition',
                            row.rule && 'fill-current group-hover:rotate-45'
                          )}
                        />
                      </button>
                    </td>

                    <td className="py-3 pr-6">
                      <span className="flex items-center gap-2">
                        {namesAPane(row.target) && (
                          <span
                            className={cn(
                              'size-2 shrink-0 rounded-full',
                              row.agent?.connected ? 'bg-live' : 'bg-muted-foreground/40'
                            )}
                            title={row.agent?.connected ? 'Held right now' : 'Nobody is holding it'}
                          />
                        )}
                        <span className="font-mono font-medium tabular-nums">{row.target}</span>
                        {row.command && (
                          <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                            {row.command}
                          </span>
                        )}
                      </span>
                    </td>

                    <td className="w-full max-w-0 py-3 pr-4 text-muted-foreground">
                      {row.agent ? (
                        <span className="block truncate">
                          <span className="text-foreground">
                            {row.agent.identity.mcpClient ?? 'agent'}
                          </span>
                          {row.location && ` · ${row.location}`}
                          {manyHosts && ` · ${row.agent.identity.host}`}
                          {!row.agent.connected && ` · seen ${ago(row.agent.lastSeen)}`}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/60">—</span>
                      )}
                    </td>

                    <td className="py-3 text-right text-muted-foreground tabular-nums whitespace-nowrap">
                      {activityOf(row)}
                    </td>

                    <td className="py-3 whitespace-nowrap">
                      <span className="flex items-center justify-end">
                        {row.grant && (
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Revoke ${row.target}`}
                            title="Take this pane back"
                            onClick={() => void revoke(row)}
                          >
                            <Undo2 className="size-3.5" />
                            Revoke
                          </Button>
                        )}
                        {row.agent && !row.agent.connected && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="px-1.5"
                            aria-label={`Forget ${row.agent.identity.mcpClient ?? 'agent'}`}
                            title="Forget this agent. What you revoked stays revoked."
                            onClick={() => void forget(row)}
                          >
                            <X className="size-3.5" />
                          </Button>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        )}

        <form
          className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3"
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
          <input
            value={pattern}
            onChange={event => setPattern(event.target.value)}
            placeholder="%3, or a pattern like *agents:*"
            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 font-mono text-sm outline-none transition focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          <Button type="submit" size="sm" variant="secondary">
            <Plus className="size-3.5" />
            Keep
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
