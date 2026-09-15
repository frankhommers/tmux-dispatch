import { useState } from 'react';
import { Pin, TerminalSquare, Undo2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { forgetAgent, keepGrant, parseLabel, revokeGrant, type ConnectedAgent } from '@/lib/api';
import { cn } from '@/lib/utils';

/** "3m ago", close enough for a list that refreshes itself. */
function ago(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

/** A project as you would name it: the last segment of its path. */
function projectName(cwd: string): string {
  return cwd.replace(/\/+$/, '').split('/').pop() || cwd;
}

interface Props {
  agents: ConnectedAgent[];
  onChanged: () => void;
}

/**
 * What is handed out, grouped the way you think about it: by project, then by
 * the agent process holding it. A process is named by the client that started
 * it and the pane it runs in, since a pid tells a human nothing. The host only
 * appears when there is more than one.
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

  const forget = async (agent: ConnectedAgent) => {
    try {
      await forgetAgent(agent.id);
      onChanged();
    } catch (cause) {
      toast.error((cause as Error).message);
    }
  };

  const keep = async (agent: ConnectedAgent, target: string) => {
    setBusy(`${agent.id}:${target}`);
    try {
      await keepGrant(agent.id, target);
      toast.success(`${target} stays with ${projectName(agent.identity.cwd)}`, {
        description: 'Agents working there get it back without asking.',
      });
      onChanged();
    } catch (cause) {
      toast.error((cause as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const manyHosts = new Set(agents.map(agent => agent.identity.host)).size > 1;
  const held = agents.reduce((total, agent) => total + agent.grants.length, 0);

  const byProject = new Map<string, ConnectedAgent[]>();
  for (const agent of agents) {
    byProject.set(agent.identity.cwd, [...(byProject.get(agent.identity.cwd) ?? []), agent]);
  }
  // Living processes first, then the most recently heard from.
  const projects = [...byProject.entries()]
    .map(([cwd, processes]) => ({
      cwd,
      processes: [...processes].sort(
        (a, b) => Number(b.connected) - Number(a.connected) || b.lastSeen - a.lastSeen
      ),
    }))
    .sort((a, b) => projectName(a.cwd).localeCompare(projectName(b.cwd)));

  return (
    <Card className="border-border/60">
      <CardHeader className="gap-1">
        <div className="flex items-center gap-2">
          <TerminalSquare className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Handed out</h2>
          <span className="flex-1" />
          <span className="text-xs text-muted-foreground">
            {held} pane{held === 1 ? '' : 's'}
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {projects.map(({ cwd, processes }) => (
          <section key={cwd} className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold" title={cwd}>{projectName(cwd)}</h3>

            {processes.map(agent => (
              <div key={agent.id} className="flex flex-col gap-1 pl-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span
                    className={cn(
                      'size-2 shrink-0 rounded-full',
                      agent.connected ? 'bg-live' : 'bg-muted-foreground/50'
                    )}
                  />
                  <span className="min-w-0 truncate">
                    <span className="font-medium text-foreground">{agent.identity.mcpClient ?? 'agent'}</span>
                    {agent.identity.tmuxSession && ` · in ${agent.identity.tmuxSession}`}
                    {agent.identity.scope !== 'none' && ` · scope ${agent.identity.scope}`}
                    {manyHosts && ` · ${agent.identity.host}`}
                    {' · '}
                    {agent.connected ? 'connected' : `seen ${ago(agent.lastSeen)}`}
                  </span>
                  <span className="flex-1" />
                  {!agent.connected && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1.5"
                      aria-label={`Forget ${agent.identity.mcpClient ?? 'agent'} in ${cwd}`}
                      title="Forget this process. What you revoked stays revoked."
                      onClick={() => void forget(agent)}
                    >
                      <X className="size-3.5" />
                    </Button>
                  )}
                </div>

                {agent.grants.length === 0 ? (
                  <p className="pl-4 text-xs text-muted-foreground">Nothing held.</p>
                ) : (
                  <ul className="space-y-0.5">
                    {agent.grants.map(grant => {
                      const { location, command } = parseLabel(grant.label);
                      const key = `${agent.id}:${grant.target}`;
                      return (
                        <li
                          key={grant.target}
                          className={cn(
                            'flex items-center gap-2 rounded-lg py-1 pr-1 pl-4 hover:bg-accent/60',
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
                            {grant.reason && <span className="ml-2 opacity-70">{grant.reason}</span>}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground/80">
                            {grant.lastActivity ? `used ${ago(grant.lastActivity)}` : `since ${ago(grant.since)}`}
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Keep ${grant.target} for this directory`}
                            title="Give it back to agents working here, without asking"
                            onClick={() => void keep(agent, grant.target)}
                          >
                            <Pin className="size-3.5" />
                            Keep
                          </Button>
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
          </section>
        ))}
      </CardContent>
    </Card>
  );
}
