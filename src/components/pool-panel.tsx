import { useEffect, useState } from 'react';
import { Plus, RotateCcw, Trash2, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { addPoolEntry, listPool, removePoolEntry, resetPoolEntry, type PoolEntry } from '@/lib/api';

/**
 * Pre-assigned entries. An entry is a pane id or a glob over the candidate
 * label, matched against what the agent offered — so it decides faster, never
 * wider.
 */
export function PoolPanel() {
  const [pool, setPool] = useState<PoolEntry[]>([]);
  const [pattern, setPattern] = useState('');
  const [reusable, setReusable] = useState(false);

  const load = async () => {
    try {
      setPool((await listPool()).pool);
    } catch (cause) {
      toast.error((cause as Error).message);
    }
  };

  useEffect(() => { void load(); }, []);

  return (
    <Card className="border-border/60">
      <CardHeader className="gap-1">
        <div className="flex items-center gap-2">
          <Zap className="size-4 text-live" />
          <h2 className="text-sm font-semibold">Assign without asking</h2>
        </div>
        <p className="text-sm text-muted-foreground">Matching requests are answered at once.</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={async event => {
            event.preventDefault();
            if (!pattern.trim()) return;
            try {
              await addPoolEntry(pattern.trim(), 'pane', reusable);
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
            placeholder="%3 or *agents:*"
            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 font-mono text-sm outline-none transition focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={reusable} onChange={event => setReusable(event.target.checked)} />
            reusable
          </label>
          <Button type="submit" size="sm" variant="secondary">
            <Plus className="size-3.5" />
            Add
          </Button>
        </form>

        {pool.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing pre-assigned.</p>
        ) : (
          <ul className="space-y-1">
            {pool.map(entry => (
              <li key={entry.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-accent/60">
                <code className="font-mono text-sm">{entry.pattern}</code>
                <Badge variant="secondary" className="text-[11px]">{entry.kind}</Badge>
                {entry.cwd && (
                  <Badge variant="outline" className="max-w-[16rem] truncate text-[11px]" title={entry.cwd}>
                    {entry.cwd}
                  </Badge>
                )}
                {entry.tmuxServer && (
                  <Badge variant="outline" className="text-[11px]" title={entry.tmuxServer}>
                    this tmux
                  </Badge>
                )}
                {entry.reusable && <Badge variant="outline" className="text-[11px]">reusable</Badge>}
                {entry.usedAt && <Badge variant="outline" className="text-[11px]">used</Badge>}
                <span className="flex-1" />
                {entry.usedAt && (
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Make it available again"
                    onClick={async () => { await resetPoolEntry(entry.id); void load(); }}
                  >
                    <RotateCcw className="size-3.5" />
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => { await removePoolEntry(entry.id); void load(); }}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
