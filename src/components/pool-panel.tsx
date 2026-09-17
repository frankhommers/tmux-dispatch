import { useEffect, useState } from 'react';
import { Pin, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { addPoolEntry, listPool, removePoolEntry, type PoolEntry } from '@/lib/api';
import { ago, projectName } from '@/lib/format';
import { cn } from '@/lib/utils';

/** What the rule is doing, in the order a human would want to hear it. */
function activity(entry: PoolEntry): string {
  if (entry.lastActivity) return `active ${ago(entry.lastActivity)}`;
  if (entry.usedAt) return `handed over ${ago(entry.usedAt)}`;
  return 'not used yet';
}

/** Where the rule applies. A rule bound to nothing applies everywhere. */
function where(entry: PoolEntry): string {
  return entry.cwd ? projectName(entry.cwd) : 'Any project';
}

/**
 * Standing rules: a pane that goes back to the same project without asking.
 * Each row is one pinned pane — pressing the pin again lets it go.
 */
export function PoolPanel() {
  const [pool, setPool] = useState<PoolEntry[]>([]);
  const [pattern, setPattern] = useState('');
  const [once, setOnce] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);

  const load = async () => {
    try {
      setPool((await listPool()).pool);
    } catch (cause) {
      toast.error((cause as Error).message);
    }
  };

  useEffect(() => { void load(); }, []);

  const release = async (entry: PoolEntry) => {
    setBusy(entry.id);
    try {
      await removePoolEntry(entry.id);
      toast.success(`${entry.pattern} is no longer kept`, {
        description: `${where(entry)} will be asked for again.`,
      });
      void load();
    } catch (cause) {
      toast.error((cause as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="border-border/60">
      <CardHeader className="gap-1">
        <div className="flex items-center gap-2">
          <Pin className="size-4 fill-current text-live" />
          <h2 className="text-sm font-semibold">Kept panes</h2>
          <span className="flex-1" />
          <span className="text-xs text-muted-foreground">
            {pool.length} rule{pool.length === 1 ? '' : 's'}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">Handed back without asking you.</p>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {pool.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing kept. Press the pin on a pane under Handed out to keep it.
          </p>
        ) : (
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                <th className="w-12 pb-2 text-left font-medium">Kept</th>
                <th className="pb-2 text-left font-medium">Pane</th>
                <th className="pb-2 text-left font-medium">Project</th>
                <th className="pb-2 text-right font-medium">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {pool.map(entry => (
                <tr
                  key={entry.id}
                  className={cn(
                    'border-t border-border/60 transition hover:bg-accent/40',
                    busy === entry.id && 'pointer-events-none opacity-50'
                  )}
                >
                  <td className="py-3">
                    <button
                      type="button"
                      aria-pressed
                      className="group grid size-8 place-items-center rounded-full bg-live/15 text-live ring-1 ring-live/30 transition hover:bg-destructive/15 hover:text-destructive hover:ring-destructive/30"
                      aria-label={`Stop keeping ${entry.pattern} for ${where(entry)}`}
                      title="Kept. Press to let it go."
                      onClick={() => void release(entry)}
                    >
                      <Pin className="size-4 fill-current transition group-hover:rotate-45" />
                    </button>
                  </td>

                  <td className="py-3">
                    <span className="flex items-center gap-2">
                      {entry.live !== null && (
                        <span
                          className={cn(
                            'size-2 shrink-0 rounded-full',
                            entry.live ? 'bg-live' : 'bg-muted-foreground/40'
                          )}
                          title={entry.live
                            ? 'Its tmux server is running'
                            : 'Nothing is connected from its tmux server'}
                        />
                      )}
                      <span className="font-mono font-medium tabular-nums">{entry.pattern}</span>
                      {entry.kind === 'window' && (
                        <span className="text-xs text-muted-foreground">window</span>
                      )}
                      {!entry.reusable && (
                        <span className="text-xs text-muted-foreground">
                          {entry.usedAt ? 'one-shot, spent' : 'one-shot'}
                        </span>
                      )}
                    </span>
                  </td>

                  <td className="py-3" title={entry.cwd ?? 'Every directory'}>
                    <span className={cn(!entry.cwd && 'text-muted-foreground italic')}>
                      {where(entry)}
                    </span>
                  </td>

                  <td className="py-3 text-right text-muted-foreground tabular-nums">
                    {activity(entry)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <form
          className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3"
          onSubmit={async event => {
            event.preventDefault();
            if (!pattern.trim()) return;
            try {
              await addPoolEntry(pattern.trim(), 'pane', !once);
              setPattern('');
              void load();
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
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={once} onChange={event => setOnce(event.target.checked)} />
            only once
          </label>
          <Button type="submit" size="sm" variant="secondary">
            <Plus className="size-3.5" />
            Add
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
