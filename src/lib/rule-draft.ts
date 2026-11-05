import type { ConnectedAgent, NewPoolEntry, PoolEntry, PoolEntryPatch } from '@/lib/api';
import { isBareId, shortServer, shortSession } from '@/lib/format';

/** The five matching elements, in the order they are always shown. */
export const ELEMENTS = ['pattern', 'session', 'cwd', 'host', 'tmuxServer'] as const;
export type Element = (typeof ELEMENTS)[number];
export type IdentityElement = Exclude<Element, 'pattern'>;
export const IDENTITY: IdentityElement[] = ['session', 'cwd', 'host', 'tmuxServer'];

export const LABEL: Record<Element, string> = {
  pattern: 'Target',
  session: 'Agent session',
  cwd: 'Path',
  host: 'Machine',
  tmuxServer: 'Tmux server',
};

export function anyLabel(element: Element, kind: 'pane' | 'window'): string {
  switch (element) {
    case 'pattern': return kind === 'window' ? 'Any window' : 'Any pane';
    case 'session': return 'Any session';
    case 'cwd': return 'Any path';
    case 'host': return 'Any machine';
    case 'tmuxServer': return 'Any server';
  }
}

/**
 * One condition as the form holds it. The value survives switching to Any, so
 * switching back restores what was typed.
 */
export interface Condition {
  constrained: boolean;
  value: string;
}

export interface Draft {
  kind: 'pane' | 'window';
  reusable: boolean;
  conditions: Record<Element, Condition>;
}

const any = (): Condition => ({ constrained: false, value: '' });

/** Pane, reusable, target constrained but blank, everything else Any. */
export function emptyDraft(): Draft {
  return {
    kind: 'pane',
    reusable: true,
    conditions: { pattern: { constrained: true, value: '' }, session: any(), cwd: any(), host: any(), tmuxServer: any() },
  };
}

export function draftFromRule(rule: PoolEntry): Draft {
  const condition = (value: string | null): Condition =>
    value === null ? any() : { constrained: true, value };
  return {
    kind: rule.kind,
    reusable: rule.reusable,
    conditions: {
      pattern: rule.pattern === '*' ? any() : { constrained: true, value: rule.pattern },
      session: condition(rule.session),
      cwd: condition(rule.cwd),
      host: condition(rule.host),
      tmuxServer: condition(rule.tmuxServer),
    },
  };
}

/** Identity values from one agent; whatever it does not report stays Any. */
export function withAgent(draft: Draft, agent: ConnectedAgent): Draft {
  const identity = agent.identity;
  const from = (value: string | undefined | null): Condition =>
    value ? { constrained: true, value } : any();
  return {
    ...draft,
    conditions: {
      ...draft.conditions,
      session: from(identity.sessionId),
      cwd: from(identity.cwd),
      host: from(identity.host),
      tmuxServer: from(identity.tmuxServer),
    },
  };
}

/** The value an element is saved as: trimmed when constrained, null when Any. */
export function valueOf(draft: Draft, element: Element): string | null {
  const condition = draft.conditions[element];
  if (!condition.constrained) return element === 'pattern' ? '*' : null;
  return condition.value.trim();
}

export type Errors = Partial<Record<Element, string>>;

/** Never broaden a blank field silently; never send a bare ID without its server. */
export function validate(draft: Draft, kindLocked: boolean): Errors {
  const errors: Errors = {};
  for (const element of ELEMENTS) {
    const condition = draft.conditions[element];
    if (condition.constrained && !condition.value.trim()) {
      errors[element] = element === 'pattern'
        ? 'Enter a target ID or pattern, or choose Any.'
        : `Enter a value, or choose Any to match any ${LABEL[element].toLowerCase()}.`;
    }
  }
  const pattern = valueOf(draft, 'pattern') ?? '';
  if (!errors.pattern && isBareId(pattern)) {
    if (pattern.startsWith('%') && draft.kind === 'window') {
      errors.pattern = kindLocked
        ? 'This is a window rule, and %IDs name panes. Use an @ ID or a label pattern.'
        : 'Window rules use @ IDs. Use an @ ID, or change Type to Pane.';
    } else if (pattern.startsWith('@') && draft.kind === 'pane') {
      errors.pattern = kindLocked
        ? 'This is a pane rule, and @IDs name windows. Use a % ID or a label pattern.'
        : 'Pane rules use % IDs. Use a % ID, or change Type to Window.';
    }
    if (!draft.conditions.tmuxServer.constrained) {
      errors.tmuxServer = 'A bare ID needs its tmux server. Bind a server or use a label pattern.';
    }
  }
  return errors;
}

/** The body for a new rule: Any elements are simply not sent. */
export function toNewEntry(draft: Draft): NewPoolEntry {
  const entry: NewPoolEntry = { pattern: valueOf(draft, 'pattern') ?? '*', kind: draft.kind, reusable: draft.reusable };
  for (const element of IDENTITY) {
    const value = valueOf(draft, element);
    if (value) entry[element] = value;
  }
  return entry;
}

/** Only what changed: a string binds, null unbinds, absent stays. */
export function toPatch(rule: PoolEntry, draft: Draft): PoolEntryPatch {
  const patch: PoolEntryPatch = {};
  const pattern = valueOf(draft, 'pattern') ?? '*';
  if (pattern !== rule.pattern) patch.pattern = pattern;
  for (const element of IDENTITY) {
    const value = valueOf(draft, element);
    if (value !== rule[element]) patch[element] = value;
  }
  if (draft.reusable !== rule.reusable) patch.reusable = draft.reusable;
  return patch;
}

/** The server keeps one rule per kind and set of conditions, whatever its Use. */
export function findSame(pool: PoolEntry[], entry: NewPoolEntry): PoolEntry | undefined {
  return pool.find(rule =>
    rule.pattern === entry.pattern
    && rule.kind === entry.kind
    && rule.session === (entry.session ?? null)
    && rule.cwd === (entry.cwd ?? null)
    && rule.host === (entry.host ?? null)
    && rule.tmuxServer === (entry.tmuxServer ?? null));
}

/**
 * Another rule with the same kind and conditions as this draft, which the
 * server would refuse to add again. While editing, the rule itself does not
 * count. Only complete drafts are compared: a blank limited field never is.
 */
export function findDuplicate(pool: PoolEntry[] | null, draft: Draft, except: number | null): PoolEntry | undefined {
  if (!pool) return undefined;
  if (ELEMENTS.some(element => draft.conditions[element].constrained && !draft.conditions[element].value.trim())) return undefined;
  const entry = toNewEntry(draft);
  return findSame(pool.filter(rule => rule.id !== except), entry);
}

/** Whether the fields the form edits differ between two snapshots of a rule. */
export function sameRecord(a: PoolEntry, b: PoolEntry): boolean {
  return a.pattern === b.pattern && a.kind === b.kind && a.reusable === b.reusable
    && a.session === b.session && a.cwd === b.cwd && a.host === b.host && a.tmuxServer === b.tmuxServer;
}

export function sameDraft(a: Draft, b: Draft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The rule in one plain sentence, for review before saving. */
export function summarize(draft: Draft): string {
  const noun = draft.kind === 'window' ? 'window' : 'pane';
  const pattern = valueOf(draft, 'pattern') || '…';
  const target = pattern === '*'
    ? `Any ${noun}`
    : isBareId(pattern) ? `${noun === 'window' ? 'Window' : 'Pane'} ${pattern}` : `${noun === 'window' ? 'Windows' : 'Panes'} matching ${pattern}`;
  const session = valueOf(draft, 'session');
  const host = valueOf(draft, 'host');
  const server = valueOf(draft, 'tmuxServer');
  const cwd = valueOf(draft, 'cwd');
  const who = session ? `from agents in session ${shortSession(session)}` : 'from any agent session';
  const where = host ? `on ${host}` : 'on any machine';
  const which = server ? `using server ${shortServer(server)}` : 'on any tmux server';
  const path = cwd ? `Path matching ${cwd}.` : 'Any path.';
  return `${target} ${who}, ${where}, ${which}. ${path} ${draft.reusable ? 'Reusable.' : 'One-shot.'}`;
}
