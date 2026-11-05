import { useId } from 'react';
import { selectClass } from '@/components/common';
import type { ThemePreference } from '@/lib/theme';
import { cn } from '@/lib/utils';

export function ThemeSelect({ value, onChange, className }: {
  value: ThemePreference;
  onChange: (value: ThemePreference) => void;
  className?: string;
}) {
  const id = useId();
  return (
    <span className={cn('inline-flex items-center', className)}>
      <label htmlFor={id} className="sr-only">Appearance</label>
      <select
        id={id}
        value={value}
        onChange={event => onChange(event.target.value as ThemePreference)}
        className={cn(selectClass, 'h-8 text-xs')}
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </span>
  );
}
