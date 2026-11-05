import { InlineError, inputClass } from '@/components/common';
import { LABEL, anyLabel, type Condition, type Element } from '@/lib/rule-draft';
import { cn } from '@/lib/utils';

export type FieldPart = 'value' | 'label' | 'hint' | 'error' | 'any' | 'limit';

export const fieldId = (element: Element, part: FieldPart) => `rule-editor-${element}-${part}`;

/** The radio a condition's mode is set with, by its current state: where focus goes for an Any field. */
export const modeId = (element: Element, constrained: boolean) => fieldId(element, constrained ? 'limit' : 'any');

/** One short example per condition. The full matching rules live under Pattern help. */
export const EXAMPLE: Record<Element, string> = {
  pattern: '%24 or *agents:*',
  session: '7f3c2a91-…',
  cwd: '*/Repos/tmux-*',
  host: 'frank-mbp',
  tmuxServer: '/tmp/tmux-501/default:4821:…',
};

const segment = cn(
  'relative inline-flex h-7 items-center rounded-[5px] px-2.5 text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors',
  'hover:text-foreground has-[:checked]:bg-card has-[:checked]:text-foreground has-[:checked]:ring-1 has-[:checked]:ring-border',
  'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-ring',
  'max-sm:h-10 max-sm:px-3.5',
);

/**
 * One condition: its name, Any or Limit to…, and the value only when limited.
 * The mode is a pair of native radios, so arrow keys and screen readers work
 * as they do everywhere else.
 */
export function ConditionRow({ element, condition, kind, error, onMode, onValue }: {
  element: Element;
  condition: Condition;
  kind: 'pane' | 'window';
  error?: string;
  onMode: (constrained: boolean) => void;
  onValue: (value: string) => void;
}) {
  const limited = condition.constrained;
  const name = `rule-editor-${element}-mode`;
  const describedBy = cn(limited && fieldId(element, 'hint'), error && fieldId(element, 'error')) || undefined;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:grid-cols-[7.5rem_auto_minmax(0,1fr)] sm:py-2">
      <label
        id={fieldId(element, 'label')}
        htmlFor={limited ? fieldId(element, 'value') : modeId(element, false)}
        className="text-[13px] leading-[18px] font-medium"
      >
        {LABEL[element]}
      </label>
      <div
        role="radiogroup"
        aria-labelledby={fieldId(element, 'label')}
        aria-describedby={!limited && error ? fieldId(element, 'error') : undefined}
        aria-invalid={!limited && error ? true : undefined}
        className={cn(
          'inline-flex w-fit justify-self-end rounded-md bg-muted p-0.5 ring-1 ring-inset ring-border sm:justify-self-start',
          !limited && error && 'ring-destructive',
        )}
      >
        <label className={segment}>
          <input
            type="radio"
            id={modeId(element, false)}
            name={name}
            value="any"
            checked={!limited}
            onChange={() => onMode(false)}
            className="absolute inset-0 m-0 cursor-pointer appearance-none rounded-[5px] opacity-0"
          />
          Any
        </label>
        <label className={segment}>
          <input
            type="radio"
            id={modeId(element, true)}
            name={name}
            value="constrained"
            checked={limited}
            onChange={() => onMode(true)}
            className="absolute inset-0 m-0 cursor-pointer appearance-none rounded-[5px] opacity-0"
          />
          Limit to…
        </label>
      </div>
      {limited ? (
        <div className="col-span-2 min-w-0 sm:col-span-1">
          <input
            id={fieldId(element, 'value')}
            value={condition.value}
            placeholder={`e.g. ${EXAMPLE[element]}`}
            onChange={event => onValue(event.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            className={cn(inputClass, 'h-8 font-mono text-[13px] max-sm:text-base')}
          />
          <span id={fieldId(element, 'hint')} className="sr-only">For example {EXAMPLE[element]}</span>
        </div>
      ) : (
        <p className="hidden text-[13px] leading-[18px] text-muted-foreground sm:block">{anyLabel(element, kind)}</p>
      )}
      {error && (
        <div className="col-span-2 sm:col-span-1 sm:col-start-3">
          <InlineError id={fieldId(element, 'error')}>{error}</InlineError>
        </div>
      )}
    </div>
  );
}
