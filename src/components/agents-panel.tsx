import { useMemo, useState } from 'react';
import { Ellipsis } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog, DetailList, Disclosure, LoadError, NotReported, Panel, SectionHeader, SectionNotice } from '@/components/common';
import { GrantRow } from '@/components/grant-row';
import type { Inbox } from '@/hooks/use-inbox';
import { forgetAgent, type ConnectedAgent, type PoolEntry } from '@/lib/api';
import { status } from '@/lib/errors';
import { ago, absolute, plural, shortSession } from '@/lib/format';
import { clientName, projectOf } from '@/lib/identity';
import { cn } from '@/lib/utils';

function byStatus(a: ConnectedAgent, b: ConnectedAgent): number {
  return Number(b.connected) - Number(a.connected)
    || a.identity.host.localeCompare(b.identity.host)
    || a.identity.cwd.localeCompare(b.identity.cwd)
    || a.id.localeCompare(b.id);
}

export function ConnectionLabel({ connected }: { connected: boolean }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5 text-xs font-medium', connected ? 'text-live' : 'text-muted-foreground')}>
      <span aria-hidden className={cn('size-1.5 rounded-full', connected ? 'bg-live' : 'border border-current')} />
      {connected ? 'Connected' : 'Offline'}
    </span>
  );
}

function IdentityDetails({ agent }: { agent: ConnectedAgent }) {
  const identity = agent.identity;
  return (
    <DetailList
      items={[
        ['Client', identity.mcpClient ?? <NotReported />],
        ['Raw client', identity.client || <NotReported />, true],
        ['Machine', identity.host || <NotReported />, true],
        ['Path', identity.cwd || <NotReported />, true],
        ['Agent session', identity.sessionId ?? <NotReported />, true],
        ['Tmux server', identity.tmuxServer ?? <NotReported />, true],
        ['Tmux session', identity.tmuxSession ?? <NotReported />, true],
        ['Scope', identity.scope || <NotReported />],
        ['PID', String(identity.pid), true],
        ['Instance', identity.instanceId ?? <NotReported />, true],
        ['Agent ID', agent.id, true],
        ['Connected', `${absolute(agent.connectedAt)} (${ago(agent.connectedAt)})`],
        ['Last seen', `${absolute(agent.lastSeen)} (${ago(agent.lastSeen)})`],
      ]}
    />
  );
}

function AgentCard({ agent, pool, onChanged, onShowRule }: {
  agent: ConnectedAgent;
  pool: PoolEntry[] | null;
  onChanged: () => void;
  onShowRule: (id: number, edit?: boolean) => void;
}) {
  const [forgetOpen, setForgetOpen] = useState(false);
  const identity = agent.identity;
  const project = projectOf(identity);
  const headingId = `agent-${agent.id.replace(/[^\w-]/g, '_')}`;

  return (
    <Panel className="overflow-hidden">
      <article aria-labelledby={headingId}>
        <div className="grid gap-1 p-4">
          <div className="flex items-start justify-between gap-3">
            <h3 id={headingId} className="min-w-0 text-sm leading-5 font-semibold break-anywhere">
              {clientName(identity)}
              {project && <span className="font-normal text-muted-foreground"> / {project}</span>}
            </h3>
            <div className="flex items-center gap-1">
              <ConnectionLabel connected={agent.connected} />
              {!agent.connected && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-xs" aria-label={`More actions for ${clientName(identity)}${project ? ` in ${project}` : ''}`}>
                      <Ellipsis aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onSelect={() => setForgetOpen(true)}>Forget agent</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
          <p className="text-xs leading-[18px] text-muted-foreground break-anywhere">
            {identity.host}
            {identity.sessionId && (
              <> · Agent session <code className="font-mono">{shortSession(identity.sessionId)}</code></>
            )}
          </p>
          <code className="font-mono text-xs leading-[18px] text-muted-foreground select-text break-anywhere">{identity.cwd}</code>
        </div>

        {agent.grants.length > 0 ? (
          <ul aria-label={`Current access for ${clientName(identity)}`} className="m-0 list-none p-0">
            {agent.grants.map(grant => (
              <GrantRow key={grant.target} agent={agent} grant={grant} pool={pool} onChanged={onChanged} onShowRule={onShowRule} />
            ))}
          </ul>
        ) : (
          <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">No current assignments.</p>
        )}

        <div className="border-t border-border px-4 py-2">
          <Disclosure summary="Agent details">
            <div className="pb-2"><IdentityDetails agent={agent} /></div>
          </Disclosure>
        </div>
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
          toast.success(`Forgot ${clientName(identity)}${project ? ` in ${project}` : ''}`);
          onChanged();
        }}
      />
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
  const loaded = inbox.data !== null;
  const connected = agents.filter(agent => agent.connected).length;
  const offline = agents.length - connected;
  const assignments = agents.reduce((total, agent) => total + agent.grants.length, 0);

  const count = loaded
    ? [`${connected} connected`, offline > 0 ? `${offline} offline` : null, plural(assignments, 'assignment')]
      .filter(Boolean).join(' · ')
    : undefined;

  return (
    <section id="agents" aria-labelledby="agents-title" className="min-w-0 scroll-mt-4 sm:scroll-mt-20">
      <SectionHeader
        id="agents-title"
        title="Agents"
        count={count}
        description="Current access. Revoking ends an assignment; automatic rules stay until removed."
      />
      {loaded && (
        <SectionNotice error={inbox.error} refreshing={inbox.refreshing} stale={stale} what="agents" onRetry={onRefresh} />
      )}
      {!loaded && inbox.error ? (
        <LoadError what="agents" error={inbox.error} onRetry={onRefresh} busy={inbox.refreshing} />
      ) : !loaded ? (
        <div className="grid gap-4 lg:grid-cols-2" aria-busy="true">
          <p role="status" className="sr-only">Loading agents…</p>
          {[0, 1].map(key => (
            <Panel key={key} className="grid gap-2 p-4">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-8 w-full" />
            </Panel>
          ))}
        </div>
      ) : agents.length === 0 ? (
        <Panel className="flex min-h-16 items-center px-4 text-sm text-muted-foreground">
          No agents connected. Agents appear when they connect to dispatch.
        </Panel>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {agents.map(agent => (
            <AgentCard key={agent.id} agent={agent} pool={pool} onChanged={onRefresh} onShowRule={onShowRule} />
          ))}
        </div>
      )}
    </section>
  );
}
