import { useId, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { InlineError, inputClass } from '@/components/common';
import { deny } from '@/lib/api';
import { describe } from '@/lib/errors';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reason: string;
  requestId: string;
  onDenied: () => void;
}

/**
 * Denying ends the agent's request, and the note is the only thing the agent
 * is told about why. A failure keeps the dialog and the note.
 */
export function DenyDialog({ open, onOpenChange, reason, requestId, onDenied }: Props) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteId = useId();
  const helpId = useId();
  const errorId = useId();

  return (
    <Dialog open={open} onOpenChange={next => { if (!busy) { setError(null); onOpenChange(next); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-left">
          <DialogTitle>Deny this request?</DialogTitle>
          <DialogDescription>
            The agent asked: “{reason}”. It is told the request was declined and gets no terminal.
          </DialogDescription>
        </DialogHeader>
        <form
          id={`${noteId}-form`}
          className="grid gap-1.5"
          onSubmit={async event => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await deny(requestId, note.trim());
              toast.success('Request denied');
              setNote('');
              onOpenChange(false);
              onDenied();
            } catch (cause) {
              const message = describe(cause);
              setError(message);
              toast.error(message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label htmlFor={noteId} className="text-xs font-medium">Reason (optional)</label>
          <textarea
            id={noteId}
            autoFocus
            rows={3}
            value={note}
            onChange={event => setNote(event.target.value)}
            aria-describedby={cn(helpId, error && errorId)}
            className={cn(inputClass, 'h-auto py-2 leading-5')}
          />
          <p id={helpId} className="text-xs text-muted-foreground">The agent sees this note.</p>
          <InlineError id={errorId}>{error}</InlineError>
        </form>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button type="submit" form={`${noteId}-form`} variant="destructive" disabled={busy}>
            {busy ? 'Denying…' : 'Deny request'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
