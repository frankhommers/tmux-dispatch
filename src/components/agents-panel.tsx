import { useMemo, useRef, useState } from 'react';
import { ChevronDown, Ellipsis } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ConfirmDialog,
  DetailList,
  Dot,
  LoadError,
  NotReported,
  Panel,
  PanelToolbar,
  SectionNotice,
  TimeAgo,
  type DetailItem,
} from '@/components/common';
import { GrantRow } from '@/components/grant-row';
import type { Inbox } from '@/hooks/use-inbox';
import { forgetAgent, type ConnectedAgent, type PoolEntry } from '@/lib/api';
import { status } from '@/lib/errors';
import { ago, absolute, plural, shortHost, shortPath, shortSession } from '@/lib/format';
import { clientName, projectOf } from '@/lib/identity';
import { cn } from '@/lib/utils';

/**
 * By project, machine and id only. Status is left out on purpose: agents dial
 * in and hang up all the time, and a list that re-sorts on that never holds still.
 */
function byStatus(a: ConnectedAgent, b: ConnectedAgent): number {
  return (projectOf(a.identity) ?? '').localeCompare(projectOf(b.identity) ?? '')
    || a.identity.host.localeCompare(b.identity.host)
    || a.id.localeCompare(b.id);
}

/**
 * What to call each agent's project. The folder name, unless two agents work
 * in different folders of the same name: then the shortened path tells them apart.
 */
function projectLabels(agents: ConnectedAgent[]): Map<string, string> {
  const paths = new Map<string, Set<string>>();
  for (const agent of agents) {
    const project = projectOf(agent.identity);
    if (!project) continue;
    paths.set(project, (paths.get(project) ?? new Set()).add(agent.identity.cwd));
  }
  const labels = new Map<string, string>();
  for (const agent of agents) {
    const project = projectOf(agent.identity);
    const label = !project
      ? clientName(agent.identity)
      : (paths.get(project)?.size ?? 0) > 1 ? shortPath(agent.identity.cwd) : project;
    labels.set(agent.id, label);
  }
  return labels;
}

function identityItems(agent: ConnectedAgent): [DetailItem[], DetailItem[]] {
  const identity = agent.identity;
  return [
    [
      ['Client', identity.mcpClient ?? <NotReported />],
      ['Raw client', identity.client || <NotReported />, true],
      ['Machine', identity.host || <NotReported />, true],
      ['Path', identity.cwd || <NotReported />, true],
      ['Agent session', identity.sessionId ?? <NotReported />, true],
      ['Tmux server', identity.tmuxServer ?? <NotReported />, true],
      ['Tmux session', identity.tmuxSession ?? <NotReported />, true],
    ],
    [
      ['Scope', identity.scope || <NotReported />],
      ['PID', String(identity.pid), true],
      ['Instance', identity.instanceId ?? <NotReported />, true],
      ['Agent ID', agent.id, true],
      ['Connected', `${absolute(agent.connectedAt)} (${ago(agent.connectedAt)})`],
      ['Last seen', `${absolute(agent.lastSeen)} (${ago(agent.lastSeen)})`],
    ],
  ];
}

function StatusText({ agent, className }: { agent: ConnectedAgent; className?: string }) {
  return agent.online ? (
    <span className={cn('inline-flex items-center gap-1.5 text-[13px] leading-5 font-medium text-live', className)} title={`Last heard from ${absolute(agent.lastSeen)}`}>
      <Dot tone="live" />
      Online
    </span>
  ) : (
    <span className={cn('inline-flex items-center gap-1.5 text-[13px] leading-5 text-muted-foreground', className)}>
      <Dot tone="offline" />
      <span>Offline · <TimeAgo at={agent.lastSeen} prefix="last seen" /></span>
    </span>
  );
}

function AgentGroup({ agent, label, pool, onChanged, onShowRule }: {
  agent: ConnectedAgent;
  label: string;
  pool: PoolEntry[] | null;
  onChanged: () => void;
  onShowRule: (id: number, edit?: boolean) => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [forgetOpen, setForgetOpen] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const identity = agent.identity;
  const client = clientName(identity);
  const project = projectOf(identity);
  const safeId = agent.id.replace(/[^\w-]/g, '_');
  const headingId = `agent-${safeId}`;
  const detailsId = `agent-details-${safeId}`;
  const offline = !agent.online;
  const who = `${client}${project ? ` in ${project}` : ''} on ${shortHost(identity.host)}`;
  const [left, right] = identityItems(agent);

  return (
    <li className="border-t border-border first:border-t-0">
      <article aria-labelledby={headingId}>
        <header className="bg-muted/45 dark:bg-muted/35">
          <div className="flex items-start gap-3 px-4 py-2 max-sm:py-1.5">
            <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1.5 max-sm:py-2.5">
              <h3
                id={headingId}
                ref={headingRef}
                tabIndex={-1}
                title={identity.cwd || undefined}
                className={cn(
                  'min-w-0 text-sm leading-5 font-semibold break-anywhere',
                  offline ? 'text-muted-foreground' : 'text-foreground',
                )}
              >
                {label}
                <span className="sr-only">, {client} on {identity.host}{offline ? ', offline' : ''}</span>
              </h3>
              <p aria-hidden className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-[13px] leading-5 text-muted-foreground max-sm:basis-full">
                {project && <span>{client}</span>}
                {project && <span aria-hidden>·</span>}
                <span title={identity.host}>{shortHost(identity.host)}</span>
                {identity.sessionId && (
                  <>
                    <span aria-hidden>·</span>
                    <code title={identity.sessionId} className="font-mono text-xs">{shortSession(identity.sessionId)}</code>
                  </>
                )}
              </p>
              <StatusText agent={agent} className="basis-full sm:hidden" />
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <StatusText agent={agent} className="mr-2 max-sm:hidden" />
              <Button
                variant="ghost"
                size="xs"
                className="text-muted-foreground hover:text-foreground"
                aria-expanded={detailsOpen}
                aria-controls={detailsId}
                onClick={() => setDetailsOpen(open => !open)}
              >
                Details<span className="sr-only"> for {who}</span>
                <ChevronDown aria-hidden className={cn('transition-transform', detailsOpen && 'rotate-180')} />
              </Button>
              {offline && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-xs" className="text-muted-foreground hover:text-foreground" aria-label={`More actions for ${who}`}>
                      <Ellipsis aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onSelect={() => setForgetOpen(true)}>Forget agent…</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>

          <div id={detailsId} hidden={!detailsOpen} className="px-4 pb-3">
            {detailsOpen && (
              <div className="grid gap-x-10 gap-y-1.5 rounded-md border border-border bg-card px-3 py-2.5 lg:grid-cols-2">
                <DetailList items={left} />
                <DetailList items={right} />
              </div>
            )}
          </div>
        </header>

        {agent.grants.length > 0 ? (
          <ul aria-label={`Assignments for ${who}`} className="m-0 list-none border-t border-border/70 p-0">
            {agent.grants.map(grant => (
              <GrantRow
                key={grant.target}
                agent={agent}
                grant={grant}
                pool={pool}
                onChanged={onChanged}
                onShowRule={onShowRule}
                onRevoked={() => headingRef.current?.focus()}
              />
            ))}
          </ul>
        ) : (
          <p className="border-t border-border/70 px-4 py-2.5 text-[13px] leading-5 text-muted-foreground">No assignments</p>
        )}
      </article>

      <ConfirmDialog
        open={forgetOpen}
        onOpenChange={setForgetOpen}
        title="Forget this agent?"
        description={`${plural(agent.grants.length, 'assignment')} listed. Removes this agent from the overview. Access is not revoked.`}
        confirmLabel="Forget agent"
        busyLabel="Forgetting…"
        onConfirm={async () => {
          try {
            await forgetAgent(agent.id);
          } catch (cause) {
            if (status(cause) === 409) {
              onChanged();
              throw new Error('This agent connected again, so it stays in the overview. The list has been refreshed.');
            }
            throw cause;
          }
          toast.success(`Forgot ${client}${project ? ` in ${project}` : ''}`);
          document.getElementById('agents-title')?.focus();
          onChanged();
        }}
      />
    </li>
  );
}

function LoadingRows() {
  return (
    <Panel className="overflow-hidden" aria-busy="true">
      <p role="status" className="sr-only">Loading agents…</p>
      {[0, 1].map(key => (
        <div key={key} className="border-t border-border first:border-t-0">
          <div className="flex items-center gap-3 bg-muted/45 px-4 py-3.5 dark:bg-muted/35">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="ml-auto h-3.5 w-20" />
          </div>
          {[0, 1].map(row => (
            <div key={row} className="flex items-center gap-4 border-t border-border/70 px-4 py-3.5">
              <Skeleton className="h-4 w-10" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-7 w-20 max-sm:hidden" />
            </div>
          ))}
        </div>
      ))}
    </Panel>
  );
}

/** Every agent the server knows, with the access it holds right now. */
export function AgentsPanel({ inbox, pool, stale, onRefresh, onShowRule }: {
  inbox: Inbox;
  pool: PoolEntry[] | null;
  stale: boolean;
  onRefresh: () => void;
  onShowRule: (id: number, edit?: boolean) => void;
}) {
  const agents = useMemo(() => [...(inbox.data?.agents ?? [])].sort(byStatus), [inbox.data?.agents]);
  const labels = useMemo(() => projectLabels(agents), [agents]);
  const loaded = inbox.data !== null;
  const online = agents.filter(agent => agent.online).length;
  const offline = agents.length - online;
  const assignments = agents.reduce((total, agent) => total + agent.grants.length, 0);

  return (
    <div className="min-w-0">
      <h2 id="agents-title" tabIndex={-1} className="sr-only">Agents</h2>
      <PanelToolbar>
        {loaded && agents.length > 0 && (
          <>
            <span className="font-medium text-foreground">{online} online</span>
            {offline > 0 && <> · {offline} offline</>}
            {' · '}{plural(assignments, 'assignment')}.{' '}
          </>
        )}
        Revoking ends an assignment; automatic rules stay.
      </PanelToolbar>
      {loaded && (
        <SectionNotice error={inbox.error} refreshing={inbox.refreshing} stale={stale} what="agents" onRetry={onRefresh} />
      )}
      {!loaded && inbox.error ? (
        <LoadError what="agents" error={inbox.error} onRetry={onRefresh} busy={inbox.refreshing} />
      ) : !loaded ? (
        <LoadingRows />
      ) : agents.length === 0 ? (
        <Panel className="px-4 py-6 text-center">
          <p className="text-sm font-medium">No agents yet</p>
          <p className="mt-0.5 text-[13px] leading-[18px] text-muted-foreground">Agents appear here when they connect to dispatch.</p>
        </Panel>
      ) : (
        <TooltipProvider delayDuration={300}>
          <Panel className="overflow-hidden">
            <ul aria-label="Agents" className="m-0 list-none p-0">
              {agents.map(agent => (
                <AgentGroup
                  key={agent.id}
                  agent={agent}
                  label={labels.get(agent.id) ?? clientName(agent.identity)}
                  pool={pool}
                  onChanged={onRefresh}
                  onShowRule={onShowRule}
                />
              ))}
            </ul>
          </Panel>
        </TooltipProvider>
      )}
    </div>
  );
}
