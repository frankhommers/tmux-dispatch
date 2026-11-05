import { parseLabel, type Target } from '@/lib/api';
import { Tag } from '@/components/common';
import { projectName } from '@/lib/format';
import { cn } from '@/lib/utils';

interface Props {
  target: Target;
  /** Radio group name, unique per request. */
  name: string;
  selected: boolean;
  /** The agent asked for this one by name. */
  suggested: boolean;
  /** Already handed to an agent working in this directory, on the same tmux server. */
  heldBy?: string;
  onSelect: () => void;
}

/**
 * One candidate on one line, as a native radio. Selecting never assigns: the
 * Assign button does that. Hovering does nothing at all.
 */
export function TargetRow({ target, name, selected, suggested, heldBy, onSelect }: Props) {
  const { location, command, title } = parseLabel(target.label);
  // A label that does not split cleanly is shown whole, so nothing is lost.
  const parsed = location !== '';

  return (
    <label
      className={cn(
        'grid cursor-pointer grid-cols-[auto_minmax(2.5rem,auto)_minmax(0,1fr)_auto] items-center gap-x-3 border-t border-border px-4 py-2 hover:bg-accent/60 max-sm:min-h-12 max-sm:grid-cols-[auto_minmax(2.5rem,auto)_minmax(0,1fr)] max-sm:py-2.5',
        selected && 'bg-highlight hover:bg-highlight',
      )}
    >
      <input
        type="radio"
        name={name}
        value={target.id}
        checked={selected}
        onChange={onSelect}
        className="size-4 shrink-0 accent-[var(--ring)]"
      />
      <code className="font-mono text-sm font-semibold">{target.id}</code>
      <span className="flex min-w-0 items-center gap-x-2 gap-y-0.5 max-sm:flex-wrap">
        {parsed ? (
          <>
            <span className="font-mono text-[13px] sm:shrink-0 max-sm:break-anywhere">{location}</span>
            {command && <Tag tone="neutral" className="font-mono font-normal">{command}</Tag>}
            {title && (
              <span className="min-w-0 text-[13px] text-muted-foreground sm:truncate max-sm:basis-full max-sm:break-anywhere" title={title}>
                {title}
              </span>
            )}
          </>
        ) : (
          <span className="min-w-0 font-mono text-[13px] break-anywhere">{target.label}</span>
        )}
      </span>
      {(suggested || heldBy) && (
        <span className="flex flex-wrap items-center justify-end gap-1.5 max-sm:col-start-3 max-sm:justify-start max-sm:pt-1">
          {suggested && <Tag tone="live">Requested by agent</Tag>}
          {heldBy && <Tag tone="attention" title={heldBy}>Held by {projectName(heldBy)}</Tag>}
        </span>
      )}
    </label>
  );
}
