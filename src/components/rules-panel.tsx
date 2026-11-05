import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { DetailList, Disclosure, LoadError, Panel, SectionHeader, SectionNotice } from '@/components/common';
import { RuleEditorForm, type EditorOutcome, type EditorSession } from '@/components/rule-editor';
import type { Pool } from '@/hooks/use-inbox';
import { resetPoolEntry, type ConnectedAgent, type PoolEntry } from '@/lib/api';
import { describe } from '@/lib/errors';
import { absolute, ago, shortServer, shortSession } from '@/lib/format';
import { IDENTITY, LABEL, anyLabel, type Element } from '@/lib/rule-draft';
import { cn } from '@/lib/utils';

export interface RuleFocus {
  id: number;
  edit: boolean;
  nonce: number;
}

const cellButton = 'block w-full rounded-sm text-left text-xs leading-[18px] hover:underline hover:underline-offset-2 max-sm:min-h-11';

function display(rule: PoolEntry, element: Element): { text: string; any: boolean; mono: boolean } {
  if (element === 'pattern') {
    return rule.pattern === '*' ? { text: anyLabel('pattern', rule.kind), any: true, mono: false } : { text: rule.pattern, any: false, mono: true };
  }
  const value = rule[element];
  if (value === null) return { text: anyLabel(element, rule.kind), any: true, mono: false };
  if (element === 'session') return { text: shortSession(value), any: false, mono: true };
  if (element === 'tmuxServer') return { text: shortServer(value), any: false, mono: true };
  return { text: value, any: false, mono: true };
}

function usageLabel(rule: PoolEntry): string {
  if (rule.reusable) return 'Reusable';
  return rule.usedAt ? 'One-shot · Used' : 'One-shot · Ready';
}

/** A read-only condition that opens the editor at that condition. */
function ConditionButton({ rule, element, onEdit, disabled }: {
  rule: PoolEntry;
  element: Element;
  onEdit: (rule: PoolEntry, element: Element) => void;
  disabled: boolean;
}) {
  const shown = display(rule, element);
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={`Edit ${LABEL[element].toLowerCase()} condition for rule ${rule.id}: ${shown.text}`}
      onClick={() => onEdit(rule, element)}
      className={cn(cellButton, shown.any ? 'text-muted-foreground' : 'text-foreground', shown.mono && 'font-mono break-anywhere')}
    >
      {shown.text}
    </button>
  );
}

function Availability({ rule }: { rule: PoolEntry }) {
  if (rule.live === null) return null;
  return (
    <span className={cn('mt-1 block text-xs leading-[18px]', rule.live ? 'text-live' : 'text-muted-foreground')}>
      {rule.live ? 'Connected' : 'No connected agent'}
    </span>
  );
}

function UseCell({ rule, busy, onReset }: { rule: PoolEntry; busy: boolean; onReset: (rule: PoolEntry) => void }) {
  return (
    <div className="text-xs leading-[18px]">
      <span>{usageLabel(rule)}</span>
      <span className="mt-1 block text-muted-foreground">{rule.usedAt ? `Handed over ${ago(rule.usedAt)}` : 'Not used'}</span>
      {!rule.reusable && rule.usedAt && (
        <Button size="xs" variant="outline" className="mt-1.5" disabled={busy} onClick={() => onReset(rule)}>
          {busy ? 'Resetting…' : 'Reset for one use'}
        </Button>
      )}
    </div>
  );
}

function RuleDetails({ rule }: { rule: PoolEntry }) {
  return (
    <DetailList
      items={[
        ['Created', absolute(rule.createdAt)],
        ['Last handed over', rule.usedAt ? absolute(rule.usedAt) : 'Not used'],
        ['Last activity', rule.lastActivity ? `${absolute(rule.lastActivity)} (${ago(rule.lastActivity)})` : 'No activity reported'],
        ['Target', rule.pattern, true],
        ['Agent session', rule.session ?? 'Any', true],
        ['Path', rule.cwd ?? 'Any', true],
        ['Machine', rule.host ?? 'Any', true],
        ['Tmux server', rule.tmuxServer ?? 'Any', true],
      ]}
    />
  );
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
  const nonce = useRef(0);
  const origin = useRef<HTMLElement | null>(null);
  const returnTo = useRef<string | null>(null);
  const closeGuard = useRef<(() => void) | null>(null);
  const rules = pool.data;
  const loaded = rules !== null;
  // Keep rendering the last form while the dialog animates closed.
  const lastSession = useRef<EditorSession | null>(null);
  if (session) lastSession.current = session;
  const shown = session ?? lastSession.current;

  const open = (next: Omit<EditorSession, 'nonce'>) => {
    origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    returnTo.current = null;
    setSession({ ...next, nonce: ++nonce.current });
  };
  const switchTo = (next: Omit<EditorSession, 'nonce'>) => {
    setSession({ ...next, nonce: ++nonce.current });
    // The dialog stays open; start the new form at its first field.
    requestAnimationFrame(() => document.getElementById(next.mode.type === 'edit' ? 'rule-editor-pattern-mode' : 'rule-editor-kind')?.focus());
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
    // The table and the card list both exist; only one is displayed.
    const row = [...document.querySelectorAll<HTMLElement>(`[data-rule-row="${highlight}"]`)]
      .find(element => element.getClientRects().length > 0);
    if (row && !session) {
      row.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
      row.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    }
    const timer = setTimeout(() => setHighlight(null), 4000);
    return () => clearTimeout(timer);
  }, [highlight, rules, session]);

  const reset = async (rule: PoolEntry) => {
    setBusy(current => new Set(current).add(rule.id));
    try {
      await resetPoolEntry(rule.id);
      toast.success(`Rule #${rule.id} is ready for one more use`);
      onRefresh();
    } catch (cause) {
      toast.error(describe(cause));
    } finally {
      setBusy(current => {
        const next = new Set(current);
        next.delete(rule.id);
        return next;
      });
    }
  };

  const edit = (rule: PoolEntry, element?: Element) => open({ mode: { type: 'edit', id: rule.id }, focus: element });
  const clone = (rule: PoolEntry) => open({ mode: { type: 'clone', sourceId: rule.id } });
  const add = () => open({ mode: { type: 'add' } });

  const addButton = (
    <Button variant="outline" size="sm" onClick={add} disabled={!loaded}>
      <Plus aria-hidden />
      Add rule
    </Button>
  );

  return (
    <section id="rules" aria-labelledby="rules-title" className="min-w-0 scroll-mt-4 sm:scroll-mt-20">
      <SectionHeader
        id="rules-title"
        title="Automatic rules"
        count={loaded ? rules.length : undefined}
        description="First matching rule answers automatically. All five conditions must match."
        actions={addButton}
      />
      {loaded && <SectionNotice error={pool.error} refreshing={pool.refreshing} stale={stale} what="rules" onRetry={onRefresh} />}

      {!loaded && pool.error ? (
        <LoadError what="rules" error={pool.error} onRetry={onRefresh} busy={pool.refreshing} />
      ) : !loaded ? (
        <Panel className="grid gap-3 p-4" aria-busy="true">
          <p role="status" className="text-xs text-muted-foreground">Loading rules…</p>
          {[0, 1, 2, 3].map(key => <Skeleton key={key} className="h-9 w-full" />)}
        </Panel>
      ) : rules.length === 0 ? (
        <Panel className="flex min-h-16 flex-wrap items-center justify-between gap-3 px-4 py-3">
          <p className="text-sm text-muted-foreground">No automatic rules. Requests need your approval.</p>
          <Button variant="outline" size="sm" onClick={add}><Plus aria-hidden />Add rule</Button>
        </Panel>
      ) : (
        <Panel className="overflow-hidden">
          {/* Wide screens: the scope matrix. */}
          <table className="hidden w-full table-fixed border-collapse text-left lg:table">
            <caption className="sr-only">Automatic rules in matching order. The first matching rule answers.</caption>
            <colgroup>
              <col style={{ width: 36 }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '19%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 96 }} />
            </colgroup>
            <thead>
              <tr className="bg-muted text-xs text-muted-foreground">
                <th scope="col" className="py-2.5 pl-3 font-medium"><span className="sr-only">Order</span>#</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Target</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Agent session</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Path</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Machine</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Tmux server</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Use</th>
                <th scope="col" className="px-3 py-2.5 font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule, index) => {
                const disabled = busy.has(rule.id);
                return (
                  <tr
                    key={rule.id}
                    data-rule-row={rule.id}
                    className={cn('border-t border-border align-top transition-colors', highlight === rule.id && 'bg-highlight')}
                  >
                    <td className="py-3 pl-3 text-xs text-muted-foreground">{index + 1}</td>
                    <td className="px-3 py-3 [&_button]:text-sm [&_button]:leading-5 [&_button]:font-semibold">
                      <ConditionButton rule={rule} element="pattern" onEdit={edit} disabled={disabled} />
                      <span className="mt-1 block text-xs leading-[18px] text-muted-foreground">
                        {rule.kind === 'window' ? 'Window' : 'Pane'} · Rule {rule.id}
                      </span>
                    </td>
                    {IDENTITY.map(element => (
                      <td key={element} className="px-3 py-3">
                        <ConditionButton rule={rule} element={element} onEdit={edit} disabled={disabled} />
                        {element === 'tmuxServer' && <Availability rule={rule} />}
                      </td>
                    ))}
                    <td className="px-3 py-3"><UseCell rule={rule} busy={disabled} onReset={reset} /></td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col items-start">
                        <Button variant="ghost" size="xs" disabled={disabled} onClick={() => edit(rule)} aria-label={`Edit rule ${rule.id}`}>Edit</Button>
                        <Button variant="ghost" size="xs" disabled={disabled} onClick={() => clone(rule)} aria-label={`Clone rule ${rule.id}`}>Clone</Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Narrow screens: the same rules as labeled records. */}
          <ol aria-label="Automatic rules in matching order" className="m-0 list-none p-0 lg:hidden">
            {rules.map((rule, index) => {
              const disabled = busy.has(rule.id);
              return (
                <li
                  key={rule.id}
                  data-rule-row={rule.id}
                  className={cn('grid gap-3 border-t border-border px-4 py-3 first:border-t-0 transition-colors', highlight === rule.id && 'bg-highlight')}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-xs text-muted-foreground">#{index + 1} · Target</span>
                      <div className="[&_button]:text-sm [&_button]:leading-5 [&_button]:font-semibold">
                        <ConditionButton rule={rule} element="pattern" onEdit={edit} disabled={disabled} />
                      </div>
                      <span className="block text-xs text-muted-foreground">
                        {rule.kind === 'window' ? 'Window' : 'Pane'} · Rule {rule.id}
                      </span>
                    </div>
                    <UseCell rule={rule} busy={disabled} onReset={reset} />
                  </div>
                  <dl className="m-0 grid gap-x-3 gap-y-2 sm:grid-cols-2 max-sm:gap-y-0">
                    {IDENTITY.map(element => (
                      <div key={element} className="min-w-0">
                        <dt className="text-xs text-muted-foreground">{LABEL[element]}</dt>
                        <dd className="m-0">
                          <ConditionButton rule={rule} element={element} onEdit={edit} disabled={disabled} />
                          {element === 'tmuxServer' && <Availability rule={rule} />}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" disabled={disabled} onClick={() => edit(rule)} aria-label={`Edit rule ${rule.id}`}>Edit</Button>
                    <Button variant="outline" size="sm" disabled={disabled} onClick={() => clone(rule)} aria-label={`Clone rule ${rule.id}`}>Clone</Button>
                  </div>
                  <Disclosure summary={<>Details<span className="sr-only"> for rule {rule.id}</span></>}>
                    <RuleDetails rule={rule} />
                  </Disclosure>
                </li>
              );
            })}
          </ol>
          <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
            Rules apply to future requests. Removing a rule does not revoke current access.
          </p>
        </Panel>
      )}

      <Dialog
        open={session !== null}
        onOpenChange={next => {
          if (next) return;
          if (closeGuard.current) closeGuard.current();
          else close();
        }}
      >
        <DialogContent
          className="flex max-h-[calc(100dvh-48px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[680px] max-sm:max-h-[calc(100dvh-32px)]"
          onOpenAutoFocus={event => {
            event.preventDefault();
            const element = session?.focus;
            const target = element
              ? document.getElementById(`rule-editor-${element}-value`)?.hasAttribute('disabled')
                ? `rule-editor-${element}-mode`
                : `rule-editor-${element}-value`
              : session?.mode.type === 'edit' ? 'rule-editor-pattern-mode' : 'rule-editor-kind';
            requestAnimationFrame(() => document.getElementById(target)?.focus());
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
