import { parseLabel, type Target } from '@/lib/api';
import { projectName } from '@/lib/format';

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
 * One candidate, as a native radio. Selecting never assigns: the Assign
 * button below the list does that. Hovering does nothing at all.
 */
export function TargetRow({ target, name, selected, suggested, heldBy, onSelect }: Props) {
  const { location, command, title } = parseLabel(target.label);
  // A label that does not split cleanly is shown whole, so nothing is lost.
  const parsed = location !== '';

  return (
    <label className="flex cursor-pointer items-start gap-3 border-t border-border px-4 py-3 hover:bg-accent/60 has-[:checked]:bg-muted max-sm:flex-wrap">
      <input
        type="radio"
        name={name}
        value={target.id}
        checked={selected}
        onChange={onSelect}
        className="mt-0.5 size-4 shrink-0 accent-[var(--live)]"
      />
      <code className="shrink-0 font-mono text-sm font-semibold">{target.id}</code>
      <span className="min-w-[8rem] flex-1">
        {parsed ? (
          <>
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-mono text-sm break-anywhere">{location}</span>
              {command && <span className="rounded-sm bg-muted px-1.5 font-mono text-xs leading-[18px]">{command}</span>}
            </span>
            {title && <span className="mt-0.5 block text-xs leading-[18px] text-muted-foreground break-anywhere">{title}</span>}
          </>
        ) : (
          <span className="font-mono text-sm break-anywhere">{target.label}</span>
        )}
      </span>
      <span className="flex shrink-0 flex-wrap items-center gap-2 max-sm:basis-full max-sm:pl-7">
        {suggested && (
          <span className="rounded-sm bg-muted px-1.5 text-xs leading-[18px] font-medium">Requested</span>
        )}
        {heldBy && (
          <span className="rounded-sm bg-warning-surface px-1.5 text-xs leading-[18px] font-medium text-warning">
            Held by {projectName(heldBy)}
          </span>
        )}
      </span>
    </label>
  );
}
