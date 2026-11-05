import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog, Count, LoadError, Panel, SectionNotice } from '@/components/common';
import type { Devices } from '@/hooks/use-inbox';
import { revokeDevice, type Device } from '@/lib/api';
import { ago, day } from '@/lib/format';

/**
 * The machines allowed to connect at all. Unpairing one drops its token: a
 * different thing from revoking an assignment, which ends one grant. A machine
 * can run several agents, so this is not joined to the agent list.
 */
export function DevicesPanel({ devices, stale, onRefresh }: { devices: Devices; stale: boolean; onRefresh: () => void }) {
  const list = devices.data;
  const loaded = list !== null;
  // Collapsed when there are machines; open when empty or failing.
  const [open, setOpen] = useState<boolean | null>(null);
  const [unpairing, setUnpairing] = useState<Device | null>(null);
  const needsAttention = (!loaded && devices.error !== null) || (loaded && list.length === 0);

  useEffect(() => {
    if (open === null && (loaded || devices.error)) setOpen(needsAttention);
    else if (needsAttention && open === false && devices.error) setOpen(true);
  }, [loaded, devices.error, needsAttention, open]);

  const pairHint = (
    <p className="text-xs leading-[18px] text-muted-foreground">
      Pair a machine with <code className="font-mono text-foreground">tmux-mcp dispatch-login</code>, then{' '}
      <a href="/link" className="font-medium text-foreground underline underline-offset-2 hover:no-underline">enter pairing code</a>.
    </p>
  );

  return (
    <section id="machines" aria-labelledby="machines-title" className="min-w-0 scroll-mt-4 sm:scroll-mt-20">
      <Panel className="overflow-hidden">
        <details open={open ?? false} onToggle={event => setOpen((event.target as HTMLDetailsElement).open)}>
          <summary className="flex items-center gap-2 px-4 py-3 hover:bg-accent/50 max-sm:min-h-11">
            <ChevronRight className="disclosure-chevron size-4 text-muted-foreground" aria-hidden />
            <h2 id="machines-title" tabIndex={-1} className="text-base leading-6 font-semibold">
              Paired machines
              {loaded && <Count>{list.length}</Count>}
            </h2>
            <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">Allowed to connect to dispatch</span>
          </summary>
          <div className="border-t border-border">
            {loaded && (devices.error || stale) && (
              <div className="px-4 pt-3">
                <SectionNotice error={devices.error} refreshing={devices.refreshing} stale={stale} what="machines" onRetry={onRefresh} />
              </div>
            )}
            {!loaded && devices.error ? (
              <div className="p-3"><LoadError what="machines" error={devices.error} onRetry={onRefresh} busy={devices.refreshing} /></div>
            ) : !loaded ? (
              <div className="grid gap-2 p-4" aria-busy="true">
                <p role="status" className="text-xs text-muted-foreground">Loading machines…</p>
                <Skeleton className="h-8 w-full" />
              </div>
            ) : list.length === 0 ? (
              <div className="grid gap-1 px-4 py-3">
                <p className="text-sm text-muted-foreground">No paired machines.</p>
                {pairHint}
              </div>
            ) : (
              <>
                <ul className="m-0 list-none p-0">
                  {list.map(device => (
                    <li key={device.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
                      <div className="min-w-0">
                        <p className="font-mono text-sm font-medium break-anywhere">{device.name}</p>
                        <p className="text-xs leading-[18px] text-muted-foreground">
                          {device.lastSeenAt ? `Last connected ${ago(device.lastSeenAt)}` : 'Never connected'} · Paired {day(device.createdAt)}
                        </p>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => setUnpairing(device)} aria-label={`Unpair ${device.name}`}>
                        Unpair
                      </Button>
                    </li>
                  ))}
                </ul>
                <div className="px-4 py-3">{pairHint}</div>
              </>
            )}
          </div>
        </details>
      </Panel>

      <ConfirmDialog
        open={unpairing !== null}
        onOpenChange={next => { if (!next) setUnpairing(null); }}
        title={unpairing ? `Unpair ${unpairing.name}?` : 'Unpair machine?'}
        description="Its token is revoked and agents connected from it are disconnected. To connect again it has to pair again."
        confirmLabel="Unpair machine"
        busyLabel="Unpairing…"
        onConfirm={async () => {
          if (!unpairing) return;
          await revokeDevice(unpairing.id);
          toast.success(`Unpaired ${unpairing.name}`);
          onRefresh();
        }}
      />
    </section>
  );
}
