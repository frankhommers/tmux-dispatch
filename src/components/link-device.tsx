import { useState } from 'react';
import { Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { approvePairing, lookupPairing } from '@/lib/api';

/**
 * Confirming a machine's pairing code. The machine never receives a secret it
 * did not ask for, and you never paste one.
 */
export function LinkDevice() {
  const [code, setCode] = useState('');
  const [name, setName] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  return (
    <div className="aurora flex min-h-dvh items-center justify-center p-6">
      <Card className="w-full max-w-sm border-border/60 shadow-xl shadow-black/10">
        <CardHeader className="gap-1">
          <div className="flex items-center gap-2">
            <Link2 className="size-4" />
            <h1 className="text-lg font-semibold tracking-tight">Link a machine</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Enter the code that <code className="font-mono">tmux-mcp ui-login</code> printed.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {done ? (
            <p className="text-sm">
              Linked. The machine can close its prompt; you can close this page.
            </p>
          ) : (
            <>
              <input
                autoFocus
                value={code}
                onChange={event => { setCode(event.target.value.toUpperCase()); setName(null); }}
                placeholder="WQ7F-2K9P"
                className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-center font-mono text-lg tracking-widest outline-none transition focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
              {name && <p className="text-sm text-muted-foreground">This links <strong>{name}</strong>.</p>}
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={async () => {
                    try {
                      setName((await lookupPairing(code)).name);
                    } catch (cause) {
                      toast.error((cause as Error).message);
                    }
                  }}
                >
                  Check
                </Button>
                <Button
                  className="flex-1"
                  onClick={async () => {
                    try {
                      await approvePairing(code);
                      setDone(true);
                    } catch (cause) {
                      toast.error((cause as Error).message);
                    }
                  }}
                >
                  Link it
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
