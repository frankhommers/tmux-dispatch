import { useEffect, useRef, useState } from 'react';
import { Copy, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog, LoadError, Panel, PanelToolbar, SectionNotice } from '@/components/common';
import { RuleEditorForm, editorStartId, type EditorOutcome, type EditorSession } from '@/components/rule-editor';
import {
  ConditionValue,
  LastUsed,
  ResetButton,
  RuleMenu,
  ServerState,
  StatusTag,
  TargetValue,
  conditionText,
  isSpent,
  kindLine,
} from '@/components/rules/rule-cells';
import type { Pool } from '@/hooks/use-inbox';
import { removePoolEntry, resetPoolEntry, type ConnectedAgent, type PoolEntry } from '@/lib/api';
import { describe, status } from '@/lib/errors';
import { IDENTITY, LABEL } from '@/lib/rule-draft';
import { cn } from '@/lib/utils';

export interface RuleFocus {
  id: number;
  edit: boolean;
  nonce: number;
}

interface RowProps {
  rule: PoolEntry;
  order: number;
  busy: boolean;
  highlighted: boolean;
  onEdit: (rule: PoolEntry) => void;
  onClone: (rule: PoolEntry) => void;
  onReset: (rule: PoolEntry) => void;
  onDelete: (rule: PoolEntry) => void;
}

const th = 'h-9 px-3 text-left align-middle text-xs font-medium text-muted-foreground';

/** Wide screens: one aligned row per rule, conditions as plain text. */
function RuleRow({ rule, order, busy, highlighted, onEdit, onClone, onReset, onDelete }: RowProps) {
  const spent = isSpent(rule);
  return (
    <tr
      data-rule-row={rule.id}
      className={cn(
        'border-t border-border align-top transition-colors duration-500',
        spent && 'bg-muted/50 [&_.rule-value]:text-muted-foreground',
        highlighted && 'bg-highlight',
      )}
    >
      <td className="py-3 pl-4 font-mono text-[13px] leading-5 font-semibold text-foreground tabular-nums">{order}</td>
      <td className="px-3 py-3">
        <TargetValue rule={rule} dim={spent} />
        <span className="block text-xs leading-4 text-muted-foreground">{kindLine(rule)}</span>
      </td>
      {IDENTITY.map(element => (
        <td key={element} className="px-3 py-3 leading-5">
          <ConditionValue rule={rule} element={element} className="rule-value" />
          {element === 'tmuxServer' && <ServerState rule={rule} className="mt-1" />}
        </td>
      ))}
      <td className="px-3 py-3">
        <div className="flex flex-col items-start gap-1">
          <StatusTag rule={rule} />
          <LastUsed rule={rule} />
          {spent && <ResetButton rule={rule} busy={busy} onReset={onReset} className="mt-0.5" />}
        </div>
      </td>
      <td className="py-2.5 pr-3 pl-1">
        <div className="flex items-center justify-end gap-0.5">
          <Button variant="ghost" size="xs" data-rule-edit disabled={busy} onClick={() => onEdit(rule)} aria-label={`Edit rule ${rule.id}`}>
            Edit
          </Button>
          <RuleMenu rule={rule} busy={busy} onClone={onClone} onReset={onReset} onDelete={onDelete} />
        </div>
      </td>
    </tr>
  );
}

/** Narrow screens: the same rule as a static record with one main action. */
function RuleRecord({ rule, order, busy, highlighted, onEdit, onClone, onReset, onDelete }: RowProps) {
  const spent = isSpent(rule);
  return (
    <li
      data-rule-row={rule.id}
      className={cn(
        'grid gap-3 border-t border-border px-4 py-3 transition-colors duration-500 first:border-t-0',
        spent && 'bg-muted/50 [&_.rule-value]:text-muted-foreground',
        highlighted && 'bg-highlight',
      )}
    >
      <div className="flex items-start gap-3">
        <span className="w-5 shrink-0 pt-px font-mono text-[13px] leading-5 font-semibold text-foreground tabular-nums" aria-hidden>{order}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <TargetValue rule={rule} dim={spent} />
            <span className="text-xs leading-4 text-muted-foreground">{kindLine(rule)}</span>
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-4 text-muted-foreground">
            <StatusTag rule={rule} />
            <LastUsed rule={rule} />
          </p>
        </div>
        <RuleMenu rule={rule} busy={busy} onReset={onReset} onDelete={onDelete} className="-mt-1 -mr-2 max-sm:-my-2.5" />
      </div>
      <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2 pl-7">
        {IDENTITY.map(element => {
          const long = conditionText(rule, element).text.length > 18;
          return (
            <div key={element} className={cn('min-w-0', long && 'col-span-2')}>
              <dt className="text-xs leading-4 text-muted-foreground">{LABEL[element]}</dt>
              <dd className="m-0 min-w-0">
                <ConditionValue rule={rule} element={element} className="rule-value" />
                {element === 'tmuxServer' && <ServerState rule={rule} className="mt-0.5" />}
              </dd>
            </div>
          );
        })}
      </dl>
      <div className="flex items-center gap-2 pl-7">
        <Button variant="outline" size="sm" data-rule-edit className="max-sm:flex-1" disabled={busy} onClick={() => onEdit(rule)} aria-label={`Edit rule ${rule.id}`}>
          Edit
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => onClone(rule)} aria-label={`Clone rule ${rule.id}`}>
          <Copy aria-hidden />
          Clone
        </Button>
        {spent && <ResetButton rule={rule} busy={busy} onReset={onReset} className="max-sm:h-11 max-sm:px-3" />}
      </div>
    </li>
  );
}

/**
 * Where focus goes back after the editor closes. A menu item is gone by then,
 * so an action picked from a row menu returns to that menu's button.
 */
function returnPoint(): HTMLElement | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  const trigger = active.closest('[role="menu"]')?.getAttribute('aria-labelledby');
  return (trigger && document.getElementById(trigger)) || active;
}

export function RulesPanel({ pool, agents, stale, focus, onRefresh }: {
  pool: Pool;
  agents: ConnectedAgent[];
  stale: boolean;
  focus: RuleFocus | null;
  onRefresh: () => void;
}) {
  const [session, setSession] = useState<EditorSession | null>(null);
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const [highlight, setHighlight] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<PoolEntry | null>(null);
  const nonce = useRef(0);
  const origin = useRef<HTMLElement | null>(null);
  const returnTo = useRef<string | null>(null);
  const closeGuard = useRef<(() => void) | null>(null);
  /** A rule removed from its row menu: focus goes to the heading once it is gone. */
  const removed = useRef<number | null>(null);
  const rules = pool.data;
  const loaded = rules !== null;
  // Keep rendering the last form while the dialog animates closed.
  const lastSession = useRef<EditorSession | null>(null);
  if (session) lastSession.current = session;
  const shown = session ?? lastSession.current;

  const open = (next: Omit<EditorSession, 'nonce'>) => {
    origin.current = returnPoint();
    returnTo.current = null;
    setSession({ ...next, nonce: ++nonce.current });
  };
  const switchTo = (next: Omit<EditorSession, 'nonce'>) => {
    setSession({ ...next, nonce: ++nonce.current });
    // The dialog stays open; start the new form at its first field.
    requestAnimationFrame(() => document.getElementById(editorStartId(next.mode))?.focus());
  };
  const close = () => setSession(null);

  const onDone = (outcome: EditorOutcome) => {
    if (outcome.action === 'deleted') returnTo.current = 'rules-title';
    else if (outcome.action === 'added') setHighlight(outcome.entry.id);
    close();
    onRefresh();
  };

  // Another section asked to show (or edit) a rule.
  useEffect(() => {
    if (!focus) return;
    if (focus.edit) open({ mode: { type: 'edit', id: focus.id } });
    else setHighlight(focus.id);
    // Keyed on the nonce: each request from elsewhere is a fresh one.
  }, [focus?.nonce]);

  // Bring a highlighted rule into view once it exists, then let it fade.
  useEffect(() => {
    if (highlight === null || !rules?.some(rule => rule.id === highlight)) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // The table and the record list both exist; only one is displayed.
    const row = [...document.querySelectorAll<HTMLElement>(`[data-rule-row="${highlight}"]`)]
      .find(element => element.getClientRects().length > 0);
    if (row && !session) {
      row.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
      row.querySelector<HTMLElement>('[data-rule-edit]')?.focus({ preventScroll: true });
    }
    const timer = setTimeout(() => setHighlight(null), 4000);
    return () => clearTimeout(timer);
  }, [highlight, rules, session]);

  useEffect(() => {
    if (removed.current === null || rules?.some(rule => rule.id === removed.current)) return;
    removed.current = null;
    document.getElementById('rules-title')?.focus();
  }, [rules]);

  const markBusy = (id: number, on: boolean) => setBusy(current => {
    const next = new Set(current);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  });

  const reset = async (rule: PoolEntry) => {
    markBusy(rule.id, true);
    try {
      await resetPoolEntry(rule.id);
      toast.success(`Rule #${rule.id} is ready for one more use`);
      onRefresh();
    } catch (cause) {
      toast.error(describe(cause));
    } finally {
      markBusy(rule.id, false);
    }
  };

  const remove = async (rule: PoolEntry) => {
    try {
      await removePoolEntry(rule.id);
    } catch (cause) {
      if (status(cause) !== 404) throw cause;
    }
    removed.current = rule.id;
    toast.success(`Removed rule #${rule.id}`, { description: 'Existing assignments keep their access.' });
    onRefresh();
  };

  const edit = (rule: PoolEntry) => open({ mode: { type: 'edit', id: rule.id } });
  const clone = (rule: PoolEntry) => open({ mode: { type: 'clone', sourceId: rule.id } });
  const add = () => open({ mode: { type: 'add' } });

  const rowProps = (rule: PoolEntry, index: number): RowProps => ({
    rule,
    order: index + 1,
    busy: busy.has(rule.id),
    highlighted: highlight === rule.id,
    onEdit: edit,
    onClone: clone,
    onReset: reset,
    onDelete: setDeleting,
  });

  return (
    <section aria-labelledby="rules-title" className="min-w-0">
      <h2 id="rules-title" tabIndex={-1} className="sr-only">Automatic rules</h2>
      <PanelToolbar
        actions={(
          <Button variant="outline" size="sm" onClick={add} disabled={!loaded}>
            <Plus aria-hidden />
            Add rule
          </Button>
        )}
      >
        First matching rule answers. All conditions must match.
      </PanelToolbar>
      {loaded && <SectionNotice error={pool.error} refreshing={pool.refreshing} stale={stale} what="rules" onRetry={onRefresh} />}

      {!loaded && pool.error ? (
        <LoadError what="rules" error={pool.error} onRetry={onRefresh} busy={pool.refreshing} />
      ) : !loaded ? (
        <Panel className="grid gap-2 p-4" aria-busy="true">
          <p role="status" className="text-xs text-muted-foreground">Loading rules…</p>
          {[0, 1, 2, 3].map(key => <Skeleton key={key} className="h-11 w-full" />)}
        </Panel>
      ) : rules.length === 0 ? (
        <Panel className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">No automatic rules</p>
            <p className="text-[13px] leading-[18px] text-muted-foreground">
              Every request waits for your decision. Add a rule, or use “Auto-assign next time” on an assignment.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={add}><Plus aria-hidden />Add rule</Button>
        </Panel>
      ) : (
        <Panel className="overflow-hidden">
          <table className="hidden w-full table-fixed border-collapse lg:table">
            <caption className="sr-only">Automatic rules in matching order. The first matching rule answers.</caption>
            {/*
              Order, Status and Actions keep fixed widths. The conditions share
              what is left: these percentages sum to 54% and Path takes the
              rest, which still fits a 1024px viewport (about 960px of table:
              272px fixed, 518px for the four, about 170px for Path). Values
              wrap rather than push the actions out.
            */}
            <colgroup>
              <col style={{ width: 44 }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '13%' }} />
              <col />
              <col style={{ width: '11%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: 136 }} />
              <col style={{ width: 92 }} />
            </colgroup>
            <thead className="bg-muted/60">
              <tr>
                <th scope="col" className={cn(th, 'pl-4')}><span aria-hidden>#</span><span className="sr-only">Order</span></th>
                <th scope="col" className={th}>Target</th>
                {IDENTITY.map(element => <th key={element} scope="col" className={th}>{element === 'session' ? 'Session' : LABEL[element]}</th>)}
                <th scope="col" className={th}>Status</th>
                <th scope="col" className={th}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule, index) => <RuleRow key={rule.id} {...rowProps(rule, index)} />)}
            </tbody>
          </table>

          <ol aria-label="Automatic rules in matching order" className="m-0 list-none p-0 lg:hidden">
            {rules.map((rule, index) => <RuleRecord key={rule.id} {...rowProps(rule, index)} />)}
          </ol>

          <p className="border-t border-border px-4 py-2.5 text-xs leading-4 text-muted-foreground">
            Rules apply to future requests. Removing a rule does not revoke current access.
          </p>
        </Panel>
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={next => { if (!next) setDeleting(null); }}
        title={deleting ? `Remove rule #${deleting.id}?` : 'Remove rule?'}
        description="Future matching requests will wait for your decision. Existing assignments keep their access."
        confirmLabel="Remove rule"
        busyLabel="Removing…"
        onConfirm={() => (deleting ? remove(deleting) : Promise.resolve())}
      />

      <Dialog
        open={session !== null}
        onOpenChange={next => {
          if (next) return;
          if (closeGuard.current) closeGuard.current();
          else close();
        }}
      >
        <DialogContent
          className="flex max-h-[calc(100dvh-48px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[760px] max-sm:max-h-[calc(100dvh-24px)]"
          onOpenAutoFocus={event => {
            event.preventDefault();
            if (session) requestAnimationFrame(() => document.getElementById(editorStartId(session.mode))?.focus());
          }}
          onCloseAutoFocus={event => {
            event.preventDefault();
            const back = returnTo.current ? document.getElementById(returnTo.current) : origin.current;
            if (back && back.isConnected) back.focus();
            else document.getElementById('rules-title')?.focus();
          }}
        >
          {shown && (
            <RuleEditorForm
              key={shown.nonce}
              session={shown}
              pool={rules}
              agents={agents}
              onSwitch={switchTo}
              onClose={close}
              onDone={onDone}
              closeGuard={closeGuard}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
