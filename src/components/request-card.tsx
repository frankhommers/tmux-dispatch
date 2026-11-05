import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, Ellipsis, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog, DetailList, Disclosure, InlineError, NotReported, Panel, inputClass } from '@/components/common';
import { DenyDialog } from '@/components/deny-dialog';
import { TargetRow } from '@/components/target-row';
import { dismissRequest, grant, refreshTargets, type PaneRequest } from '@/lib/api';
import { describe, status } from '@/lib/errors';
import { absolute, ago, normaliseTarget, until } from '@/lib/format';
import { clientName, projectOf } from '@/lib/identity';
import { cn } from '@/lib/utils';

interface Props {
  request: PaneRequest;
  headingId: string;
  /** Re-read the inbox. */
  onChanged: () => void;
  /** This card answered or dismissed its request; focus moves on when it goes. */
  onActed: (id: string) => void;
}

function ageLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

export function RequestCard({ request, headingId, onChanged, onActed }: Props) {
  const noun = request.kind === 'window' ? 'window' : 'pane';
  const Noun = request.kind === 'window' ? 'Window' : 'Pane';
  const offered = request.suggested !== null
    && request.candidates.some(candidate => candidate.id === request.suggested);

  const [selected, setSelected] = useState<string | null>(offered ? request.suggested : null);
  // A target the agent named but did not offer can only be assigned by ID, so
  // put it in that field rather than making someone retype it.
  const [manualOpen, setManualOpen] = useState(!offered && request.suggested !== null);
  const [typed, setTyped] = useState(offered ? '' : request.suggested ?? '');
  const [sending, setSending] = useState<string | null>(null);
  /** Sent and waiting for the agent: no second submission until it settles. */
  const [sent, setSent] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [denyOpen, setDenyOpen] = useState(false);
  const [dismissOpen, setDismissOpen] = useState(false);
  const expiryChecked = useRef(false);

  const groupName = useId();
  const manualId = useId();
  const manualHelpId = useId();
  const assignErrorId = useId();
  const manualPanelId = useId();

  // A refreshed list may no longer hold the selected target.
  useEffect(() => {
    if (selected !== null && !request.candidates.some(candidate => candidate.id === selected)) {
      setSelected(null);
      setAnnouncement('Selected target is no longer offered');
    }
  }, [request.candidates, selected]);

  // The agent refused: the request is open again. Answering clears lastError
  // on the server, so any error seen after sending is a new refusal.
  useEffect(() => {
    if (sent !== null && request.lastError !== null) setSent(null);
  }, [request.lastError, sent]);

  // Never wait forever on an acknowledgement that may have been lost.
  useEffect(() => {
    if (sent === null) return;
    const timer = setTimeout(() => setSent(null), 20_000);
    return () => clearTimeout(timer);
  }, [sent]);

  // At expiry, ask the server rather than claiming the request is gone.
  const expired = Date.now() >= request.expiresAt;
  useEffect(() => {
    if (expired && !expiryChecked.current) {
      expiryChecked.current = true;
      onChanged();
    }
  }, [expired, onChanged]);

  const autoAssigned = request.autoAssigned;
  const locked = sending !== null || sent !== null || autoAssigned !== null;

  const assign = async (target: string) => {
    setSending(target);
    setAssignError(null);
    try {
      await grant(request.id, target);
      setSent(target);
      toast.success(`Assignment sent for ${target}`, { description: request.reason });
      onActed(request.id);
      onChanged();
    } catch (cause) {
      const message = status(cause) === 404 ? 'This request is no longer waiting.' : describe(cause);
      setAssignError(message);
      toast.error(message);
      onChanged();
    } finally {
      setSending(null);
    }
  };

  // The list came with the request; asking the agent for a new one is how a
  // pane opened since then becomes assignable.
  const refresh = async () => {
    setRefreshing(true);
    try {
      await refreshTargets(request.id);
      setTimeout(onChanged, 400);
    } catch (cause) {
      toast.error(describe(cause));
    } finally {
      setTimeout(() => setRefreshing(false), 400);
    }
  };

  const agent = request.agent;
  const project = projectOf(agent);
  const heldBy = selected ? request.heldElsewhere[selected] : undefined;

  return (
    <Panel className="overflow-hidden border-l-[3px] border-l-warning-border">
      <article aria-labelledby={headingId}>
        <div className="grid gap-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              {agent ? (
                <>
                  <strong className="font-semibold">{clientName(agent)}</strong>
                  {project && <><span className="text-muted-foreground" aria-hidden>/</span><span>{project}</span></>}
                  <span className="text-xs text-muted-foreground">on {agent.host}</span>
                </>
              ) : (
                <span className="text-muted-foreground">Agent identity unavailable</span>
              )}
              <span className="rounded-sm bg-warning-surface px-1.5 text-xs leading-[18px] font-medium text-warning">
                {Noun} request
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              {ageLabel(request.ageSeconds)} · {expired ? 'Expired, checking…' : `Expires in ${until(request.expiresAt)}`}
            </span>
          </div>
          <h3 id={headingId} tabIndex={-1} className="text-base leading-6 font-semibold break-anywhere">
            {request.reason}
          </h3>
          {agent?.cwd && (
            <code className="font-mono text-xs text-muted-foreground select-text break-anywhere">{agent.cwd}</code>
          )}
        </div>

        <div aria-live="polite" className="sr-only">{announcement}</div>

        {(request.lastError || autoAssigned || sent) && (
          <div className="grid gap-2 px-4 pb-3">
            {request.lastError && (
              <p role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span className="break-anywhere">
                  The agent refused this assignment: {request.lastError}. Choose another target.
                </span>
              </p>
            )}
            {autoAssigned && (
              <p role="status" className="rounded-md bg-muted px-3 py-2 text-sm">
                Automatically assigned <code className="font-mono">{autoAssigned.target}</code> by rule #{autoAssigned.entryId}. Waiting for the agent to confirm.
              </p>
            )}
            {sent && !autoAssigned && (
              <p role="status" className="rounded-md bg-muted px-3 py-2 text-sm">
                Assignment sent for <code className="font-mono">{sent}</code>. Waiting for the agent to confirm.
              </p>
            )}
          </div>
        )}

        <fieldset role="radiogroup" className="m-0 min-w-0 border-0 p-0">
          <legend className="px-4 pb-2 text-xs font-medium text-muted-foreground">Choose a {noun}</legend>
          {request.candidates.length > 0 ? (
            <div>
              {request.candidates.map(target => (
                <TargetRow
                  key={target.id}
                  name={groupName}
                  target={target}
                  selected={selected === target.id}
                  suggested={target.id === request.suggested}
                  heldBy={request.heldElsewhere[target.id]}
                  onSelect={() => { setSelected(target.id); setAnnouncement(''); }}
                />
              ))}
            </div>
          ) : (
            <p className="border-t border-border px-4 py-4 text-sm text-muted-foreground">
              No {noun}s offered. Open a {noun}, then refresh, or assign by ID.
            </p>
          )}
        </fieldset>

        {heldBy && (
          <p className="flex items-start gap-2 border-t border-border bg-warning-surface px-4 py-2 text-xs leading-[18px] text-warning">
            <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
            <span className="break-anywhere">
              {selected} is already held by an agent in <code className="font-mono">{heldBy}</code>. You can still assign it.
            </span>
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              disabled={selected === null || locked || expired}
              aria-describedby={assignError ? assignErrorId : undefined}
              onClick={() => selected && void assign(selected)}
            >
              {sending !== null && sending === selected ? 'Assigning…' : selected ? `Assign ${selected}` : 'Assign'}
            </Button>
            <Button
              variant="outline"
              aria-expanded={manualOpen}
              aria-controls={manualPanelId}
              onClick={() => setManualOpen(open => !open)}
            >
              Assign by ID
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <Button variant="ghost" onClick={() => void refresh()} disabled={refreshing}>
              <RefreshCw aria-hidden className={cn(refreshing && 'animate-spin')} />
              Refresh
            </Button>
            <Button variant="ghost" onClick={() => setDenyOpen(true)}>Deny</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="More request actions">
                  <Ellipsis aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => setDismissOpen(true)}>Dismiss without answering</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {assignError && (
          <div className="px-4 pb-3">
            <InlineError id={assignErrorId}>{assignError}</InlineError>
          </div>
        )}

        {manualOpen && (
          <form
            id={manualPanelId}
            className="grid gap-1.5 border-t border-border px-4 py-3"
            onSubmit={event => {
              event.preventDefault();
              const target = normaliseTarget(typed, request.kind);
              if (target && !locked) void assign(target);
            }}
          >
            <label htmlFor={manualId} className="text-xs font-medium">{Noun} ID</label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id={manualId}
                value={typed}
                onChange={event => setTyped(event.target.value)}
                placeholder={request.kind === 'window' ? '@5' : '%3'}
                aria-describedby={manualHelpId}
                autoComplete="off"
                spellCheck={false}
                className={cn(inputClass, 'w-40 font-mono')}
              />
              <Button type="submit" variant="secondary" disabled={locked}>Assign</Button>
            </div>
            <p id={manualHelpId} className="text-xs text-muted-foreground">
              The agent validates this target against its scope. A plain number becomes {request.kind === 'window' ? '@' : '%'} followed by it.
            </p>
          </form>
        )}

        <div className="border-t border-border px-4 py-2">
          <Disclosure summary="Request details">
            <DetailList
              className="pb-2"
              items={[
                ['Request', request.id, true],
                ['Created', absolute(request.createdAt)],
                ['Expires', absolute(request.expiresAt)],
                ['Client', agent?.mcpClient ?? <NotReported />],
                ['Raw client', agent?.client ?? <NotReported />, true],
                ['Machine', agent?.host ?? <NotReported />, true],
                ['Path', agent?.cwd ?? <NotReported />, true],
                ['Agent session', agent?.sessionId ?? <NotReported />, true],
                ['Tmux server', agent?.tmuxServer ?? <NotReported />, true],
                ['Tmux session', agent?.tmuxSession ?? <NotReported />, true],
                ['Scope', agent?.scope ?? <NotReported />],
                ['PID', agent ? String(agent.pid) : <NotReported />, true],
                ['Instance', agent?.instanceId ?? <NotReported />, true],
                ['Suggested', request.suggested ?? 'None', true],
                ['Age', ago(request.createdAt)],
              ]}
            />
          </Disclosure>
        </div>
      </article>

      <DenyDialog
        open={denyOpen}
        onOpenChange={setDenyOpen}
        reason={request.reason}
        requestId={request.id}
        onDenied={() => { onActed(request.id); onChanged(); }}
      />
      <ConfirmDialog
        open={dismissOpen}
        onOpenChange={setDismissOpen}
        title="Dismiss without answering?"
        description="Remove this request without sending an answer? The agent is not told anything. Use this for requests the agent has forgotten; use Deny to decline."
        confirmLabel="Dismiss request"
        busyLabel="Dismissing…"
        onConfirm={async () => {
          await dismissRequest(request.id);
          toast.success('Request dismissed');
          onActed(request.id);
          onChanged();
        }}
      />
    </Panel>
  );
}
