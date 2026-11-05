import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { DetailList, Disclosure, InlineError, Tag, TimeAgo, selectClass, type DetailItem } from '@/components/common';
import { ConditionRow, fieldId, modeId } from '@/components/rules/condition-row';
import { LastUsed, ServerState } from '@/components/rules/rule-cells';
import {
  addPoolEntry,
  removePoolEntry,
  updatePoolEntry,
  type ConnectedAgent,
  type PoolEntry,
} from '@/lib/api';
import { describe, status } from '@/lib/errors';
import { day, shortHost } from '@/lib/format';
import { clientName, projectOf } from '@/lib/identity';
import {
  ELEMENTS,
  LABEL,
  draftFromRule,
  emptyDraft,
  findDuplicate,
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
  /** Start from this draft instead of the rule's values. */
  seed?: Draft;
}

export type EditorOutcome = { action: 'added' | 'saved'; entry: PoolEntry } | { action: 'deleted'; id: number };

/**
 * Where a freshly opened editor puts focus: Type for a new rule, the target's
 * mode for an existing one (no keyboard popping up on a phone). Read from the
 * DOM, so call it once the form has rendered.
 */
export function editorStartId(mode: EditorMode): string {
  if (mode.type !== 'edit') return 'rule-editor-kind';
  return document.querySelector<HTMLInputElement>('input[name="rule-editor-pattern-mode"]:checked')?.id ?? modeId('pattern', false);
}

/** How each condition matches, for the Pattern help disclosure. */
const HELP: Record<Element, string> = {
  pattern: 'A bare ID like %24 or @5 matches exactly and needs its tmux server. Other text is an anchored, case-insensitive glob over the full tmux label: * any text, ? one character. *agents:* matches a tmux session anywhere in the label.',
  session: 'Exact, case-sensitive. The agent session ID the agent reports, not the tmux session name.',
  cwd: 'Path or glob over the agent working directory, case-insensitive. Here * may cross slashes: */Repos/tmux-* matches any depth.',
  host: 'Exact, case-sensitive. The host name the agent reports.',
  tmuxServer: 'Exact. The full socket:pid:start_time fingerprint; the short :pid in the table is display only. Easiest filled from an agent.',
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

const fieldLabel = 'text-xs leading-4 font-medium';
const fieldHelp = 'text-xs leading-4 text-muted-foreground';

/**
 * Add, edit or clone one rule: five conditions, each Any or limited,
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
  /** A duplicate the server reported that the loaded pool did not yet show: a race. */
  const [raced, setRaced] = useState<PoolEntry | null>(null);
  const [stale, setStale] = useState(false);
  const [removed, setRemoved] = useState(editing !== null && pool !== null && baseRule === null);
  const [filledFrom, setFilledFrom] = useState<string | null>(null);
  const focusAfter = useRef<Element | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  const dirty = !sameDraft(draft, baseline);
  const current = editing === null ? null : pool?.find(rule => rule.id === editing) ?? null;
  const live = useMemo(() => findDuplicate(pool, draft, editing), [pool, draft, editing]);
  const duplicate = live ?? raced;

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

  const guard = (then: () => void) => {
    if (dirty && !removed) setConfirm({ kind: 'discard', then });
    else then();
  };
  closeGuard.current = () => guard(onClose);

  const change = (next: Draft) => {
    setRaced(null);
    setDraft(next);
  };

  const setCondition = (element: Element, patch: Partial<Draft['conditions'][Element]>) => {
    setRaced(null);
    setDraft(state => ({
      ...state,
      conditions: { ...state.conditions, [element]: { ...state.conditions[element], ...patch } },
    }));
  };

  const setMode = (element: Element, constrained: boolean) => {
    setCondition(element, { constrained });
    // Limited with nothing typed yet: put the cursor where it is needed.
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
      document.getElementById(draft.conditions[first].constrained ? fieldId(first, 'value') : modeId(first, false))?.focus();
      return;
    }
    if (stale || busy || duplicate) return;
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
      const known = new Set(pool?.map(rule => rule.id) ?? []);
      const { entry } = await addPoolEntry(toNewEntry(draft));
      // A race: someone added the same rule since the last snapshot.
      if (known.has(entry.id)) {
        setRaced(entry);
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
        <div className="grid gap-1 border-b border-border px-6 py-4 pr-14 max-sm:px-4 max-sm:pr-14">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-[13px] leading-[18px]">This rule was removed</DialogDescription>
        </div>
        <p className="px-6 py-4 text-sm max-sm:px-4">
          Someone removed this rule while it was open. Your values are kept: use them to add a new rule, or close.
        </p>
        <div className="flex flex-wrap justify-end gap-2 border-t border-border px-6 py-3 max-sm:px-4">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={() => onSwitch({ mode: { type: 'add' }, seed: draft })}>Use as new rule</Button>
        </div>
      </>
    );
  }

  const body = editing !== null && baseRule ? toPatch(baseRule, draft) : toNewEntry(draft);
  const scope = summarize(draft);
  const blocked = duplicate !== null && duplicate !== undefined;

  return (
    <>
      <div className="grid gap-0.5 border-b border-border px-6 py-4 pr-14 max-sm:px-4 max-sm:pr-14">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription className="text-[13px] leading-[18px]">
          All conditions must match. Changes apply to future requests.
        </DialogDescription>
        {current && (
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-4 text-muted-foreground">
            <span>Created {day(current.createdAt)}</span>
            <LastUsed rule={current} />
            {current.lastActivity && <TimeAgo at={current.lastActivity} prefix="Active" />}
            <ServerState rule={current} />
          </p>
        )}
      </div>

      <form
        id="rule-editor-form"
        noValidate
        className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-6 py-4 max-sm:px-4"
        onSubmit={event => { event.preventDefault(); void save(); }}
      >
        {stale && (
          <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-warning-border bg-warning-surface px-3 py-2 text-xs text-warning">
            <AlertTriangle className="size-4" aria-hidden />
            <span className="flex-1">This rule changed elsewhere. Reload its values before saving.</span>
            <Button type="button" size="xs" variant="outline" className="text-foreground" onClick={reload}>Reload values</Button>
          </div>
        )}

        <div className={cn('grid grid-cols-2 gap-x-3 gap-y-3', agents.length > 0 && 'sm:grid-cols-[1fr_1fr_1.5fr]')}>
          <div className="grid content-start gap-1.5">
            <label htmlFor="rule-editor-kind" className={fieldLabel}>Type</label>
            <select
              id="rule-editor-kind"
              value={draft.kind}
              disabled={editing !== null}
              aria-describedby={editing !== null ? 'rule-editor-kind-help' : undefined}
              onChange={event => change({ ...draft, kind: event.target.value === 'window' ? 'window' : 'pane' })}
              className={cn(selectClass, 'w-full')}
            >
              <option value="pane">Pane</option>
              <option value="window">Window</option>
            </select>
            {editing !== null && (
              <p id="rule-editor-kind-help" className={fieldHelp}>
                Fixed for an existing rule.{' '}
                <button
                  type="button"
                  className="rounded-sm text-foreground underline underline-offset-2 hover:no-underline"
                  onClick={() => onSwitch({ mode: { type: 'clone', sourceId: editing }, seed: { ...draft, kind: otherKind } })}
                >
                  Clone as {otherKind}
                </button>
              </p>
            )}
          </div>
          <div className="grid content-start gap-1.5">
            <label htmlFor="rule-editor-use" className={fieldLabel}>Use</label>
            <select
              id="rule-editor-use"
              value={draft.reusable ? 'reusable' : 'once'}
              aria-describedby="rule-editor-use-help"
              onChange={event => change({ ...draft, reusable: event.target.value === 'reusable' })}
              className={cn(selectClass, 'w-full')}
            >
              <option value="reusable">Reusable</option>
              <option value="once">One-shot</option>
            </select>
            <p id="rule-editor-use-help" className={fieldHelp}>
              {draft.reusable
                ? 'Keeps answering matching requests.'
                : current?.usedAt
                  ? 'Already used: stays spent until you reset it.'
                  : 'Answers one request, then waits for a reset.'}
            </p>
          </div>
          {agents.length > 0 && (
            <div className="col-span-2 grid content-start gap-1.5 sm:col-span-1">
              <label htmlFor="rule-editor-agent" className={fieldLabel}>
                Fill from agent <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <select
                id="rule-editor-agent"
                value=""
                aria-describedby="rule-editor-agent-help"
                onChange={event => {
                  const agent = agents.find(candidate => candidate.id === event.target.value);
                  if (!agent) return;
                  change(withAgent(draft, agent));
                  setFilledFrom(`${clientName(agent.identity)} on ${shortHost(agent.identity.host)}`);
                }}
                className={cn(selectClass, 'w-full')}
              >
                <option value="">Choose an agent…</option>
                {agents.map(agent => (
                  <option key={agent.id} value={agent.id}>
                    {projectOf(agent.identity) ?? 'No path'} · {clientName(agent.identity)} · {shortHost(agent.identity.host)}{agent.online ? '' : ' (offline)'}
                  </option>
                ))}
              </select>
              <p id="rule-editor-agent-help" className={fieldHelp} aria-live="polite">
                {filledFrom
                  ? `Filled from ${filledFrom}. What it does not report stays Any.`
                  : 'Fills session, path, machine and server. Never the target.'}
              </p>
            </div>
          )}
        </div>

        <fieldset className="m-0 min-w-0 border-0 p-0">
          <legend className="mb-1.5 text-xs leading-4 font-medium">Conditions</legend>
          <div className="divide-y divide-border rounded-md border border-border">
            {ELEMENTS.map(element => (
              <ConditionRow
                key={element}
                element={element}
                condition={draft.conditions[element]}
                kind={draft.kind}
                error={errors[element]}
                onMode={constrained => setMode(element, constrained)}
                onValue={value => setCondition(element, { value })}
              />
            ))}
          </div>
          <Disclosure summary="Pattern help" className="mt-1.5">
            <DetailList items={ELEMENTS.map((element): DetailItem => [LABEL[element], HELP[element]])} className="rounded-md bg-muted/60 p-3" />
          </Disclosure>
        </fieldset>

        <section
          aria-labelledby="rule-editor-scope"
          className={cn('rounded-md bg-muted/60 px-3 py-2.5', scope.incomplete && 'ring-1 ring-inset ring-warning-border/40')}
        >
          <h3 id="rule-editor-scope" className="flex items-center gap-2 text-xs leading-4 font-medium text-muted-foreground">
            Scope
            {scope.incomplete && <Tag tone="attention">Incomplete</Tag>}
          </h3>
          <p className="mt-1 text-[13px] leading-[18px] break-anywhere text-foreground">
            {scope.parts.map((part, index) => part.missing
              ? <span key={index} className="font-medium text-warning">{part.text}</span>
              : <span key={index}>{part.text}</span>)}
          </p>
          {/* Nothing is ready to save while the scope is incomplete, so there are no exact values to show. */}
          {!scope.incomplete && (
            <Disclosure summary={editing !== null ? 'Exact change' : 'Exact values'} className="mt-1">
              <pre className="m-0 overflow-x-auto rounded-sm bg-card p-2 font-mono text-xs whitespace-pre-wrap break-anywhere select-text">
                {JSON.stringify(body, null, 2)}
              </pre>
            </Disclosure>
          )}
        </section>

        {saveError && <InlineError>{saveError}</InlineError>}
      </form>

      <div className="grid gap-3 border-t border-border bg-card px-6 py-3 max-sm:px-4">
        <div aria-live="polite" className="empty:hidden">
          {blocked && !confirm && (
            <div id="rule-editor-duplicate" className="flex items-start gap-2 rounded-md bg-muted/70 px-3 py-2 text-[13px] leading-[18px]">
              <Info className="mt-px size-4 shrink-0 text-muted-foreground" aria-hidden />
              <p className="min-w-0 flex-1">
                <span className="font-medium">This rule already exists</span>
                <span className="text-muted-foreground max-sm:hidden">
                  {' — '}rule #{duplicate.id} has the same type and conditions.{' '}
                  {duplicate.reusable !== draft.reusable
                    ? `Only Use differs: edit rule #${duplicate.id} to change it.`
                    : 'Change a condition to make a new rule.'}
                </span>
                <span className="block text-muted-foreground sm:hidden">
                  {duplicate.reusable !== draft.reusable ? `To change Use, edit rule #${duplicate.id}.` : 'Change a condition to make a new rule.'}
                </span>
              </p>
              <Button
                type="button"
                size="xs"
                variant="outline"
                className="-my-0.5"
                onClick={() => guard(() => onSwitch({ mode: { type: 'edit', id: duplicate.id } }))}
              >
                Edit rule #{duplicate.id}
              </Button>
            </div>
          )}
        </div>
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
            {mode.type === 'clone' && !blocked && (
              <span className="mr-auto text-xs text-muted-foreground max-sm:basis-full">Rule #{mode.sourceId} stays unchanged.</span>
            )}
            <Button variant="outline" disabled={busy !== null} onClick={() => guard(onClose)}>Cancel</Button>
            <Button
              type="submit"
              form="rule-editor-form"
              disabled={busy !== null || stale || blocked}
              aria-describedby={blocked ? 'rule-editor-duplicate' : undefined}
            >
              {busy === 'save' ? 'Saving…' : saveLabel}
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
