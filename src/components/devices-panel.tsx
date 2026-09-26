import { useCallback, useEffect, useState } from 'react';
import { Laptop, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { listDevices, revokeDevice, type ConnectedAgent, type Device } from '@/lib/api';

function ago(at: number | null): string {
  if (!at) return 'Not connected yet';
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return 'Last connected just now';
  if (seconds < 3600) return `Last connected ${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `Last connected ${Math.round(seconds / 3600)}h ago`;
  return `Last connected ${Math.round(seconds / 86_400)}d ago`;
}

/**
 * The machines allowed to connect at all. Revoking one here drops its token:
 * a different thing from taking a pane back, which only ends one assignment.
 */
export function DevicesPanel({ agents }: { agents: ConnectedAgent[] }) {
  const [devices, setDevices] = useState<Device[]>([]);

  const load = useCallback(async () => {
    try {
      setDevices((await listDevices()).devices);
    } catch (cause) {
      toast.error((cause as Error).message);
    }
  }, []);

  // A new inbox snapshot also means device connection times may have changed.
  useEffect(() => { void load(); }, [load, agents]);

  return (
    <Card className="border-border">
      <CardHeader className="gap-1">
        <div className="flex items-center gap-2">
          <Laptop className="size-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Paired machines</h2>
        </div>
        <p className="text-sm text-muted-foreground">Machines allowed to connect and request terminal access.</p>
      </CardHeader>
      <CardContent>
        {devices.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing paired. Run <code className="font-mono">tmux-mcp dispatch-login</code>.
          </p>
        ) : (
          <ul className="space-y-2">
            {devices.map(device => (
              <li key={device.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-3 hover:bg-accent">
                <span className="min-w-0 break-all font-mono text-sm font-medium">{device.name}</span>
                <span className="flex-1" />
                <span
                  className="text-xs text-muted-foreground"
                  title={device.lastSeenAt ? `Last connection started: ${new Date(device.lastSeenAt).toLocaleString()}` : undefined}
                >
                  {ago(device.lastSeenAt)}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Unpair ${device.name}`}
                  title="Unpair this machine"
                  onClick={async () => {
                    try {
                      await revokeDevice(device.id);
                      toast.success(`Unpaired ${device.name}`);
                      void load();
                    } catch (cause) {
                      toast.error((cause as Error).message);
                    }
                  }}
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
