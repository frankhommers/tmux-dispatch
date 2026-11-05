import { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { DetailList, Disclosure, InlineError, inputClass, selectClass } from '@/components/common';
import {
  addPoolEntry,
  removePoolEntry,
  updatePoolEntry,
  type ConnectedAgent,
  type PoolEntry,
} from '@/lib/api';
import { describe, status } from '@/lib/errors';
import { absolute, ago } from '@/lib/format';
import { clientName, projectOf } from '@/lib/identity';
import {
  ELEMENTS,
  LABEL,
  anyLabel,
  draftFromRule,
  emptyDraft,
  findSame,
  sameDraft,
  sameRecord,
  summarize,
  toNewEntry,
  toPatch,
  validate,
  withAgent,
  type Draft,
  type Element,
  type Errors,
} from '@/lib/rule-draft';
import { cn } from '@/lib/utils';

export type EditorMode = { type: 'add' } | { type: 'edit'; id: number } | { type: 'clone'; sourceId: number };

export interface EditorSession {
  nonce: number;
  mode: EditorMode;
  /** The condition to focus first, when opened from a cell. */
  focus?: Element;
  /** Start from this draft instead of the rule's values. */
  seed?: Draft;
}

export type EditorOutcome = { action: 'added' | 'saved'; entry: PoolEntry } | { action: 'deleted'; id: number };

const fieldId = (element: Element, part: 'mode' | 'value' | 'help' | 'error') => `rule-editor-${element}-${part}`;

const HELP: Record<Element, string> = {
  pattern: 'ID or pattern. A bare ID like %24 or @5 matches exactly and needs its tmux server. Other text is an anchored, case-insensitive glob over the full label: * any text, ? one character. For example *agents:* matches a tmux session anywhere in the label.',
  session: 'Exact value, case-sensitive. The agent session ID, not the tmux session name.',
  cwd: 'Path or glob, case-insensitive, over the agent working directory. For example */Repos/tmux-*. Here * may cross slashes.',
  host: 'Exact value, case-sensitive. The host name the agent reports.',
  tmuxServer: 'Exact value. The full socket:pid:start_time fingerprint; the short :pid in the table is display only.',
};

const PLACEHOLDER: Record<Element, string> = {
  pattern: '%24 or *agents:*',
  session: 'Agent session ID',
  cwd: '*/Repos/project',
  host: 'Host name',
  tmuxServer: '/tmp/tmux-501/default:4821:1781001000',
};

type Confirm = null | { kind: 'discard'; then: () => void } | { kind: 'delete' };

interface Props {
  session: EditorSession;
  pool: PoolEntry[] | null;
  agents: ConnectedAgent[];
  /** Open another editor session in place of this one. */
  onSwitch: (session: Omit<EditorSession, 'nonce'>) => void;
  onClose: () => void;
  onDone: (outcome: EditorOutcome) => void;
  /** Lets the dialog ask before closing over unsaved changes. */
  closeGuard: React.MutableRefObject<(() => void) | null>;
}

function initialDraft(session: EditorSession, pool: PoolEntry[] | null): Draft {
  if (session.seed) return session.seed;
  const sourceId = session.mode.type === 'edit' ? session.mode.id : session.mode.type === 'clone' ? session.mode.sourceId : null;
  const source = sourceId === null ? undefined : pool?.find(rule => rule.id === sourceId);
  return source ? draftFromRule(source) : emptyDraft();
}

/**
 * Add, edit or clone one rule: five conditions, each Any or constrained,
 * validated before anything is sent. Rendered inside the dialog content the
 * rules panel owns, so switching between rules keeps the dialog open.
 */
export function RuleEditorForm({ session, pool, agents, onSwitch, onClose, onDone, closeGuard }: Props) {
  const mode = session.mode;
  const editing = mode.type === 'edit' ? mode.id : null;
  const [draft, setDraft] = useState<Draft>(() => initialDraft(session, pool));
  const [baseline, setBaseline] = useState<Draft>(draft);
  /** The record as it was when the form loaded it, for stale-edit detection. */
  const [baseRule, setBaseRule] = useState<PoolEntry | null>(() =>
    editing === null ? null : pool?.find(rule => rule.id === editing) ?? null);
  const [errors, setErrors] = useState<Errors>({});
  const [checked, setChecked] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [duplicate, setDuplicate] = useState<PoolEntry | null>(null);
  const [stale, setStale] = useState(false);
  const [removed, setRemoved] = useState(editing !== null && pool !== null && baseRule === null);
  const [filledFrom, setFilledFrom] = useState<string | null>(null);
  const focusAfter = useRef<Element | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const noticeRef = useRef<HTMLDivElement | null>(null);

  const dirty = !sameDraft(draft, baseline);
  const current = editing === null ? null : pool?.find(rule => rule.id === editing) ?? null;

  // Stale-edit detection, best effort: there is no revision token, so this
  // compares the fields the form edits against the snapshot it started from.
  useEffect(() => {
    if (editing === null || pool === null || removed || busy !== null) return;
    if (!current) {
      setRemoved(true);
      return;
    }
    if (baseRule && !sameRecord(current, baseRule)) {
      if (dirty) {
        setStale(true);
      } else {
        const next = draftFromRule(current);
        setBaseRule(current);
        setDraft(next);
        setBaseline(next);
      }
    }
  }, [pool, current, baseRule, dirty, editing, removed, busy]);

  // Re-validate as the user types once a save has been attempted.
  useEffect(() => {
    if (checked) setErrors(validate(draft, editing !== null));
  }, [draft, checked, editing]);

  useEffect(() => {
    const element = focusAfter.current;
    if (!element) return;
    focusAfter.current = null;
    document.getElementById(fieldId(element, 'value'))?.focus();
  });

  useEffect(() => {
    if (confirm) confirmRef.current?.focus();
  }, [confirm]);

  // A duplicate or a failed save is reported below the fields: bring it into view.
  useEffect(() => {
    if (duplicate || saveError) noticeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [duplicate, saveError]);

  const guard = (then: () => void) => {
    if (dirty && !removed) setConfirm({ kind: 'discard', then });
    else then();
  };
  closeGuard.current = () => guard(onClose);

  const setCondition = (element: Element, patch: Partial<Draft['conditions'][Element]>) => {
    setDuplicate(null);
    setDraft(current => ({
      ...current,
      conditions: { ...current.conditions, [element]: { ...current.conditions[element], ...patch } },
    }));
  };

  const setMode = (element: Element, constrained: boolean) => {
    setCondition(element, { constrained });
    // Back to Constrained with nothing typed: put the cursor where it is needed.
    if (constrained && !draft.conditions[element].value) focusAfter.current = element;
  };

  const reload = () => {
    if (!current) return;
    const next = draftFromRule(current);
    setBaseRule(current);
    setDraft(next);
    setBaseline(next);
    setStale(false);
    setSaveError(null);
  };

  const save = async () => {
    const found = validate(draft, editing !== null);
    setErrors(found);
    setChecked(true);
    const first = ELEMENTS.find(element => found[element]);
    if (first) {
      const target = draft.conditions[first].constrained ? fieldId(first, 'value') : fieldId(first, 'mode');
      document.getElementById(target)?.focus();
      return;
    }
    if (stale || busy) return;
    setBusy('save');
    setSaveError(null);
    try {
      if (editing !== null) {
        if (!baseRule) return;
        const patch = toPatch(baseRule, draft);
        if (Object.keys(patch).length === 0) {
          toast('No changes to save');
          onClose();
          return;
        }
        const { entry } = await updatePoolEntry(editing, patch);
        toast.success(`Saved rule #${entry.id}`);
        onDone({ action: 'saved', entry });
        return;
      }
      const body = toNewEntry(draft);
      const existing = pool ? findSame(pool, body) : undefined;
      if (existing) {
        setDuplicate(existing);
        return;
      }
      const known = new Set(pool?.map(rule => rule.id) ?? []);
      const { entry } = await addPoolEntry(body);
      // A race: someone added the same rule since the last snapshot.
      if (known.has(entry.id)) {
        setDuplicate(entry);
        return;
      }
      toast.success(mode.type === 'clone' ? `Added rule #${entry.id}, cloned from #${mode.sourceId}` : `Added rule #${entry.id}`);
      onDone({ action: 'added', entry });
    } catch (cause) {
      if (editing !== null && status(cause) === 404) {
        setRemoved(true);
      } else {
        const message = describe(cause);
        setSaveError(message);
        toast.error(message);
      }
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (editing === null) return;
    setBusy('delete');
    setSaveError(null);
    try {
      await removePoolEntry(editing);
      toast.success(`Removed rule #${editing}`, { description: 'Existing assignments keep their access.' });
      onDone({ action: 'deleted', id: editing });
    } catch (cause) {
      const message = status(cause) === 404 ? 'This rule was already removed.' : describe(cause);
      setSaveError(message);
      setConfirm(null);
      toast.error(message);
    } finally {
      setBusy(null);
    }
  };

  const title = mode.type === 'add' ? 'Add rule' : mode.type === 'edit' ? `Edit rule #${mode.id}` : `Clone rule #${mode.sourceId}`;
  const saveLabel = mode.type === 'add' ? 'Add rule' : mode.type === 'edit' ? 'Save changes' : 'Add cloned rule';
  const otherKind = draft.kind === 'pane' ? 'window' : 'pane';

  if (removed) {
    return (
      <>
        <div className="grid gap-2 p-6 max-sm:p-4">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>This rule was removed</DialogDescription>
          <p className="text-sm">
            Someone removed this rule while it was open. Your values are kept: use them to add a new rule, or close.
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-border p-4 sm:px-6">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={() => onSwitch({ mode: { type: 'add' }, seed: draft })}>Use as new rule</Button>
        </div>
      </>
    );
  }

  const body = editing !== null && baseRule ? toPatch(baseRule, draft) : toNewEntry(draft);

  return (
    <>
      <div className="grid gap-1 border-b border-border p-6 pr-14 max-sm:p-4 max-sm:pr-14">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription className="text-xs">All conditions must match. Changes apply to future requests.</DialogDescription>
      </div>

      <form
        id="rule-editor-form"
        noValidate
        className="min-h-0 flex-1 overflow-y-auto px-6 py-4 max-sm:px-4"
        onSubmit={event => { event.preventDefault(); void save(); }}
      >
        {stale && (
          <div role="alert" className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-warning-border bg-warning-surface px-3 py-2 text-xs text-warning">
            <AlertTriangle className="size-4" aria-hidden />
            <span className="flex-1">This rule changed. Reload values before saving.</span>
            <Button type="button" size="xs" variant="outline" className="text-foreground" onClick={reload}>Reload values</Button>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid content-start gap-1.5">
            <label htmlFor="rule-editor-kind" className="text-xs font-medium">Type</label>
            <select
              id="rule-editor-kind"
              value={draft.kind}
              disabled={editing !== null}
              aria-describedby={editing !== null ? 'rule-editor-kind-help' : undefined}
              onChange={event => { setDuplicate(null); setDraft({ ...draft, kind: event.target.value === 'window' ? 'window' : 'pane' }); }}
              className={cn(selectClass, 'w-full')}
            >
              <option value="pane">Pane</option>
              <option value="window">Window</option>
            </select>
            {editing !== null && (
              <p id="rule-editor-kind-help" className="text-xs text-muted-foreground">
                The type of an existing rule cannot change.{' '}
                <button
                  type="button"
                  className="underline underline-offset-2 hover:no-underline"
                  onClick={() => onSwitch({ mode: { type: 'clone', sourceId: editing }, seed: { ...draft, kind: otherKind } })}
                >
                  Clone as another type
                </button>
              </p>
            )}
          </div>
          <div className="grid content-start gap-1.5">
            <label htmlFor="rule-editor-use" className="text-xs font-medium">Use</label>
            <select
              id="rule-editor-use"
              value={draft.reusable ? 'reusable' : 'once'}
              aria-describedby="rule-editor-use-help"
              onChange={event => { setDuplicate(null); setDraft({ ...draft, reusable: event.target.value === 'reusable' }); }}
              className={cn(selectClass, 'w-full')}
            >
              <option value="reusable">Reusable</option>
              <option value="once">One-shot</option>
            </select>
            <p id="rule-editor-use-help" className="text-xs text-muted-foreground">
              {draft.reusable
                ? 'Keeps answering matching requests.'
                : current?.usedAt
                  ? 'This rule was already used, so as one-shot it stays spent until you reset it.'
                  : 'Answers one matching request, then waits for a reset.'}
            </p>
          </div>
        </div>

        {agents.length > 0 && (
          <div className="mt-4 grid gap-1.5">
            <label htmlFor="rule-editor-agent" className="text-xs font-medium">Use values from agent (optional)</label>
            <select
              id="rule-editor-agent"
              value=""
              aria-describedby="rule-editor-agent-help"
              onChange={event => {
                const agent = agents.find(candidate => candidate.id === event.target.value);
                if (!agent) return;
                setDuplicate(null);
                setDraft(withAgent(draft, agent));
                setFilledFrom(`${clientName(agent.identity)} on ${agent.identity.host}`);
              }}
              className={cn(selectClass, 'w-full')}
            >
              <option value="">Choose an agent…</option>
              {agents.map(agent => (
                <option key={agent.id} value={agent.id}>
                  {clientName(agent.identity)} · {agent.identity.host} · {projectOf(agent.identity) ?? 'no path'}{agent.connected ? '' : ' (offline)'}
                </option>
              ))}
            </select>
            <p id="rule-editor-agent-help" className="text-xs text-muted-foreground" aria-live="polite">
              {filledFrom
                ? `Filled session, path, machine and server from ${filledFrom}. Anything it does not report stays Any.`
                : 'Fills the four identity conditions. Never picks a target, and saves nothing by itself.'}
            </p>
          </div>
        )}

        <div className="mt-4">
          {ELEMENTS.map(element => {
            const condition = draft.conditions[element];
            const error = errors[element];
            return (
              <div
                key={element}
                className="grid gap-x-3 gap-y-1.5 border-t border-border py-3 sm:grid-cols-[7.5rem_8.5rem_minmax(0,1fr)] sm:items-center"
              >
                <label htmlFor={fieldId(element, condition.constrained ? 'value' : 'mode')} className="text-xs font-medium">
                  {LABEL[element]}
                </label>
                <select
                  id={fieldId(element, 'mode')}
                  aria-label={`${LABEL[element]} mode`}
                  value={condition.constrained ? 'constrained' : 'any'}
                  onChange={event => setMode(element, event.target.value === 'constrained')}
                  aria-invalid={!condition.constrained && error ? true : undefined}
                  aria-describedby={error ? fieldId(element, 'error') : undefined}
                  className={cn(selectClass, 'w-full')}
                >
                  <option value="any">Any</option>
                  <option value="constrained">Constrained</option>
                </select>
                <input
                  id={fieldId(element, 'value')}
                  value={condition.constrained ? condition.value : ''}
                  placeholder={condition.constrained ? PLACEHOLDER[element] : anyLabel(element, draft.kind)}
                  disabled={!condition.constrained}
                  onChange={event => setCondition(element, { value: event.target.value })}
                  aria-invalid={condition.constrained && error ? true : undefined}
                  aria-describedby={cn(fieldId(element, 'help'), error && fieldId(element, 'error'))}
                  autoComplete="off"
                  spellCheck={false}
                  className={cn(inputClass, 'font-mono text-xs max-sm:text-sm')}
                />
                <p id={fieldId(element, 'help')} className="text-xs leading-[18px] text-muted-foreground sm:col-start-3">
                  {HELP[element]}
                </p>
                {error && (
                  <div className="sm:col-start-3">
                    <InlineError id={fieldId(element, 'error')}>{error}</InlineError>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-2 rounded-md border border-border p-3 text-xs leading-[18px]">
          <p className="font-medium">Scope</p>
          <p className="mt-1 break-anywhere text-muted-foreground">{summarize(draft)}</p>
          <Disclosure summary="Exact values" className="mt-2">
            <pre className="m-0 overflow-x-auto rounded-sm bg-muted p-2 font-mono text-xs whitespace-pre-wrap break-anywhere select-text">
              {JSON.stringify(body, null, 2)}
            </pre>
          </Disclosure>
        </div>

        <div ref={noticeRef}>
        {duplicate && (
          <div role="alert" className="mt-4 grid gap-2 rounded-md border border-warning-border bg-warning-surface p-3 text-xs text-warning">
            <p className="font-semibold">This rule already exists</p>
            <p>
              Rule #{duplicate.id} has the same type and conditions.{' '}
              {duplicate.reusable !== draft.reusable
                ? 'Only Use differs. Edit the existing rule to change it.'
                : 'Change a condition or the type to create a distinct rule.'}
            </p>
            <div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="text-foreground"
                onClick={() => guard(() => onSwitch({ mode: { type: 'edit', id: duplicate.id } }))}
              >
                Edit existing rule
              </Button>
            </div>
          </div>
        )}

        {mode.type === 'edit' && current && (
          <Disclosure summary="Rule details" className="mt-4">
            <DetailList
              items={[
                ['Rule', `#${current.id}`],
                ['Created', absolute(current.createdAt)],
                ['Last handed over', current.usedAt ? `${absolute(current.usedAt)} (${ago(current.usedAt)})` : 'Not used'],
                ['Last activity', current.lastActivity ? `${absolute(current.lastActivity)} (${ago(current.lastActivity)})` : 'No activity reported'],
                ['Server', current.live === null ? 'No server bound' : current.live ? 'An agent on this server is connected' : 'No connected agent on this server'],
              ]}
            />
          </Disclosure>
        )}

        {saveError && <div className="mt-4"><InlineError>{saveError}</InlineError></div>}
        </div>
      </form>

      <div className="border-t border-border p-4 sm:px-6">
        {confirm?.kind === 'discard' ? (
          <div role="alertdialog" aria-labelledby="rule-editor-discard" className="flex flex-wrap items-center justify-end gap-2">
            <p id="rule-editor-discard" className="mr-auto text-sm font-medium">Discard changes?</p>
            <Button ref={confirmRef} variant="outline" onClick={() => setConfirm(null)}>Keep editing</Button>
            <Button variant="destructive" onClick={() => { const then = confirm.then; setConfirm(null); then(); }}>Discard</Button>
          </div>
        ) : confirm?.kind === 'delete' ? (
          <div role="alertdialog" aria-labelledby="rule-editor-delete" className="flex flex-wrap items-center justify-end gap-2">
            <p id="rule-editor-delete" className="mr-auto text-sm font-medium">
              Remove rule #{editing}? Existing assignments keep their access.
            </p>
            <Button ref={confirmRef} variant="outline" disabled={busy !== null} onClick={() => setConfirm(null)}>Keep rule</Button>
            <Button variant="destructive" disabled={busy !== null} onClick={() => void remove()}>
              {busy === 'delete' ? 'Removing…' : 'Remove rule'}
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {editing !== null && (
              <Button variant="ghost-destructive" className="mr-auto" disabled={busy !== null} onClick={() => setConfirm({ kind: 'delete' })}>
                Delete rule
              </Button>
            )}
            {mode.type === 'clone' && <span className="mr-auto text-xs text-muted-foreground max-sm:basis-full">Rule #{mode.sourceId} stays unchanged.</span>}
            <Button variant="outline" disabled={busy !== null} onClick={() => guard(onClose)}>Cancel</Button>
            <Button type="submit" form="rule-editor-form" disabled={busy !== null || stale}>
              {busy === 'save' ? 'Saving…' : saveLabel}
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
