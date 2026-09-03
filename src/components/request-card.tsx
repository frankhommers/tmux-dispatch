import { useEffect, useState } from 'react';
import { AlertTriangle, Cpu, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { DenyDialog } from '@/components/deny-dialog';
import { TargetRow } from '@/components/target-row';
import { grant, refreshTargets, type PaneRequest } from '@/lib/api';

function ageLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

export function RequestCard({ request, onChanged }: { request: PaneRequest; onChanged: () => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Arrow keys walk the list; Enter assigns whatever is highlighted.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (request.candidates.length === 0) return;
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const index = request.candidates.findIndex(target => target.id === selected);
      const next = event.key === 'ArrowDown'
        ? Math.min(index + 1, request.candidates.length - 1)
        : Math.max(index - 1, 0);
      setSelected(request.candidates[index === -1 ? 0 : next].id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [request.candidates, selected]);

  const assign = async (target: string) => {
    setBusy(true);
    try {
      await grant(request.id, target);
      toast.success(`Assigned ${target}`, { description: request.reason });
      onChanged();
    } catch (cause) {
      toast.error((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // The list came with the request; asking the agent for a new one is how a
  // pane opened since then becomes assignable.
  const refresh = async () => {
    setRefreshing(true);
    try {
      await refreshTargets(request.id);
      setTimeout(onChanged, 400);
    } catch (cause) {
      toast.error((cause as Error).message);
    } finally {
      setTimeout(() => setRefreshing(false), 400);
    }
  };

  return (
    <Card className="animate-in fade-in slide-in-from-bottom-2 overflow-hidden border-border/60 shadow-lg shadow-black/5 duration-500">
      <CardHeader className="gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="font-mono text-[11px]">{request.kind}</Badge>
          <span className="font-mono text-xs text-muted-foreground">{request.id}</span>
          <span className="text-xs text-muted-foreground">· {ageLabel(request.ageSeconds)}</span>
          {request.agent && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Cpu className="size-3" />
              {request.agent.host}
              <span className="opacity-60">· scope {request.agent.scope}</span>
            </span>
          )}
        </div>
        <p className="text-balance text-lg font-semibold leading-snug">{request.reason}</p>
        {request.agent?.cwd && (
          <p className="font-mono text-xs text-muted-foreground">{request.agent.cwd}</p>
        )}
      </CardHeader>

      <CardContent>
        {request.lastError && (
          <p className="mb-3 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>
              The agent refused that: {request.lastError}. It is still waiting.
            </span>
          </p>
        )}

        {request.candidates.length > 0 ? (
          <ul className="-mx-1 space-y-0.5">
            {request.candidates.map(target => (
              <TargetRow
                key={target.id}
                target={target}
                busy={busy}
                selected={selected === target.id}
                onSelect={() => setSelected(target.id)}
                onAssign={() => void assign(target.id)}
              />
            ))}
          </ul>
        ) : (
          <p className="px-1 py-6 text-center text-sm text-muted-foreground">
            The agent offered no {request.kind}. Open one and refresh.
          </p>
        )}
      </CardContent>

      <CardFooter className="justify-between gap-3 border-t border-border/60 !py-3">
        <p className="text-xs text-muted-foreground">
          Opened a {request.kind} just now? Refresh — the agent will look again.
        </p>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={refreshing}>
            <RefreshCw className={refreshing ? 'size-3.5 animate-spin' : 'size-3.5'} />
            Refresh
          </Button>
          <DenyDialog reason={request.reason} requestId={request.id} onDenied={onChanged} />
        </div>
      </CardFooter>
    </Card>
  );
}
