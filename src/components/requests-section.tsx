import { useCallback, useEffect, useMemo, useRef } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { LoadError, Panel, SectionNotice, Tag } from '@/components/common';
import { minutesLeft } from '@/lib/format';
import { RequestCard } from '@/components/request-card';
import type { Inbox } from '@/hooks/use-inbox';

const headingFor = (id: string) => `request-${id.replace(/[^\w-]/g, '_')}-title`;

/**
 * Every pending request, oldest first. New arrivals never take focus; when a
 * request this page answered disappears, focus moves to the next one.
 */
export function RequestsSection({ inbox, stale, onRefresh }: {
  inbox: Inbox;
  stale: boolean;
  onRefresh: () => void;
}) {
  const requests = useMemo(
    () => [...(inbox.data?.requests ?? [])].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
    [inbox.data?.requests]
  );
  const acted = useRef<{ id: string; index: number } | null>(null);
  const ids = requests.map(request => request.id).join('\n');

  const onActed = useCallback((id: string) => {
    acted.current = { id, index: requests.findIndex(request => request.id === id) };
  }, [requests]);

  useEffect(() => {
    const last = acted.current;
    if (!last || requests.some(request => request.id === last.id)) return;
    acted.current = null;
    const next = requests[Math.min(last.index, requests.length - 1)];
    document.getElementById(next ? headingFor(next.id) : 'requests-title')?.focus();
    // Keyed on membership only, not on every tick of the age labels.
  }, [ids]);

  const loaded = inbox.data !== null;

  const expiring = requests.filter(request => minutesLeft(request.expiresAt) < 2).length;

  return (
    <section id="requests" aria-labelledby="requests-title" className="min-w-0 scroll-mt-20">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="requests-title" tabIndex={-1} className="text-lg leading-[26px] font-semibold">Requests</h2>
        {loaded && expiring > 0 && <Tag tone="urgent">{expiring} about to expire</Tag>}
        {loaded && requests.length > 0 && (
          <p className="text-[13px] text-muted-foreground max-sm:basis-full">
            {requests.length === 1 ? 'An agent is blocked until you answer.' : `${requests.length} agents are blocked until you answer.`}
          </p>
        )}
      </div>
      {loaded && (
        <SectionNotice error={inbox.error} refreshing={inbox.refreshing} stale={stale} what="requests" onRetry={onRefresh} />
      )}
      {!loaded && inbox.error ? (
        <LoadError what="requests" error={inbox.error} onRetry={onRefresh} busy={inbox.refreshing} />
      ) : !loaded ? (
        <Panel className="grid gap-3 border-l-4 p-4" aria-busy="true">
          <p role="status" className="text-xs text-muted-foreground">Loading requests…</p>
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-10 w-full" />
        </Panel>
      ) : requests.length === 0 ? (
        <Panel className="flex min-h-12 items-center gap-2.5 px-4 py-3 text-sm text-muted-foreground">
          <CheckCircle2 className="size-4 text-live" aria-hidden />
          No agent is waiting for a terminal. New requests appear here and as a notification.
        </Panel>
      ) : (
        <div className={requests.length > 1 ? "grid gap-4 xl:grid-cols-2 xl:items-start" : "grid gap-4"}>
          {requests.map(request => (
            <RequestCard
              key={request.id}
              request={request}
              headingId={headingFor(request.id)}
              onChanged={onRefresh}
              onActed={onActed}
            />
          ))}
        </div>
      )}
    </section>
  );
}
