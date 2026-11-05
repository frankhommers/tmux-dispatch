import { useState } from 'react';
import { KeyRound, Laptop } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog, LoadError, Panel, PanelToolbar, SectionNotice } from '@/components/common';
import type { Devices } from '@/hooks/use-inbox';
import { revokeDevice, type Device } from '@/lib/api';
import { absolute, day } from '@/lib/format';
import { TimeAgo } from '@/components/common';

/**
 * The machines allowed to connect at all. Unpairing one drops its token: a
 * different thing from revoking an assignment, which ends one grant. A machine
 * can run several agents, so this is not joined to the agent list.
 */
export function DevicesPanel({ devices, stale, onRefresh }: { devices: Devices; stale: boolean; onRefresh: () => void }) {
  const list = devices.data;
  const loaded = list !== null;
  const [unpairing, setUnpairing] = useState<Device | null>(null);

  const pairButton = (
    <Button variant="outline" size="sm" asChild className="max-sm:h-11">
      <a href="/link"><KeyRound aria-hidden />Enter pairing code</a>
    </Button>
  );

  return (
    <div className="min-w-0">
      <h2 id="machines-title" tabIndex={-1} className="sr-only">Paired machines</h2>
      <PanelToolbar actions={pairButton}>
        Machines allowed to connect agents. Pair one with{' '}
        <code className="rounded bg-muted px-1 font-mono text-xs text-foreground">tmux-mcp dispatch-login</code>, then enter its code.
      </PanelToolbar>
      {loaded && (devices.error || stale) && (
        <SectionNotice error={devices.error} refreshing={devices.refreshing} stale={stale} what="machines" onRetry={onRefresh} />
      )}
      {!loaded && devices.error ? (
        <LoadError what="machines" error={devices.error} onRetry={onRefresh} busy={devices.refreshing} />
      ) : !loaded ? (
        <Panel className="grid gap-2 p-4" aria-busy="true">
          <p role="status" className="text-xs text-muted-foreground">Loading machines…</p>
          <Skeleton className="h-8 w-full" />
        </Panel>
      ) : list.length === 0 ? (
        <Panel className="px-4 py-6 text-center text-sm text-muted-foreground">
          No paired machines yet. Agents can only connect from a paired machine.
        </Panel>
      ) : (
        <Panel className="overflow-hidden">
          <ul className="m-0 list-none p-0" aria-label="Paired machines">
            {list.map(device => (
              <li key={device.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-4 py-3 first:border-t-0">
                <Laptop className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold break-anywhere">{device.name}</p>
                  <p className="text-xs leading-[18px] text-muted-foreground">
                    {device.lastSeenAt ? <TimeAgo at={device.lastSeenAt} prefix="Last connected" /> : 'Never connected'}
                    {' · '}
                    <span title={absolute(device.createdAt)}>Paired {day(device.createdAt)}</span>
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setUnpairing(device)} aria-label={`Unpair ${device.name}`} className="max-sm:h-11">
                  Unpair
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

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
    </div>
  );
}
