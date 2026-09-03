import { useState } from 'react';
import { Undo2, TerminalSquare } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { parseLabel, revokeGrant, type ConnectedAgent } from '@/lib/api';
import { cn } from '@/lib/utils';

/** "3m ago", close enough for a list that refreshes itself. */
function ago(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

interface Props {
  agents: ConnectedAgent[];
  onChanged: () => void;
}

/**
 * Which machines hold what. An agent is listed while it is connected or while
 * it still holds something, so a pane you handed over does not disappear from
 * view just because the agent went quiet.
 */
export function AgentsPanel({ agents, onChanged }: Props) {
  const [busy, setBusy] = useState<string | null>(null);

  if (agents.length === 0) return null;

  const revoke = async (agent: ConnectedAgent, target: string) => {
    setBusy(`${agent.id}:${target}`);
    try {
      await revokeGrant(agent.id, target);
      toast.success(`Revoked ${target}`, {
        description: agent.connected ? undefined : 'Lands at its next action.',
      });
      onChanged();
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
          <TerminalSquare className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Machines</h2>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {agents.map(agent => (
          <div key={agent.id} className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-mono font-medium">{agent.identity.host}</span>
              <span className="min-w-0 truncate text-muted-foreground">{agent.identity.cwd}</span>
              <Badge variant="outline" className="text-[11px]">scope {agent.identity.scope}</Badge>
              <span className="flex-1" />
              <span
                className={cn(
                  'flex items-center gap-1.5 text-xs',
                  agent.connected ? 'text-muted-foreground' : 'text-muted-foreground/70'
                )}
              >
                <span className={cn('size-2 rounded-full', agent.connected ? 'bg-live' : 'bg-muted-foreground/50')} />
                {agent.connected ? 'connected' : `seen ${ago(agent.lastSeen)}`}
              </span>
            </div>

            {agent.grants.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing held.</p>
            ) : (
              <ul className="space-y-1">
                {agent.grants.map(grant => {
                  const { location, command, title } = parseLabel(grant.label);
                  const key = `${agent.id}:${grant.target}`;
                  return (
                    <li
                      key={grant.target}
                      className={cn(
                        'flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-accent/60',
                        busy === key && 'pointer-events-none opacity-50'
                      )}
                    >
                      <span className="font-mono text-sm font-medium tabular-nums">{grant.target}</span>
                      {command && (
                        <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                          {command}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                        {location}
                        {title && <span className="ml-2 opacity-70">{title}</span>}
                      </span>
                      <span className="text-xs text-muted-foreground/80">
                        {grant.lastActivity ? `used ${ago(grant.lastActivity)}` : `since ${ago(grant.since)}`}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Revoke ${grant.target}`}
                        onClick={() => void revoke(agent, grant.target)}
                      >
                        <Undo2 className="size-3.5" />
                        Revoke
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
