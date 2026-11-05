import type { ReactNode } from 'react';
import { Panel } from '@/components/common';
import { ThemeSelect } from '@/components/theme-select';
import type { ThemePreference } from '@/lib/theme';

/** The 384px panel every pre-dashboard screen uses: sign-in, pairing, bootstrap. */
export function AuthPanel({ title, subtitle, children, theme, onTheme }: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  theme: ThemePreference;
  onTheme: (value: ThemePreference) => void;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex justify-end p-4">
        <ThemeSelect value={theme} onChange={onTheme} />
      </div>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 sm:items-center">
        <Panel className="w-full max-w-[384px] p-6 max-sm:p-4">
          <div className="mb-4 flex items-center gap-2.5">
            <span aria-hidden className="font-mono text-lg leading-6 text-live">&gt;_</span>
            <span className="text-base leading-6 font-[650]">tmux-dispatch</span>
          </div>
          <h1 className="text-base leading-6 font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          <div className="mt-4 grid gap-3">{children}</div>
        </Panel>
      </main>
    </div>
  );
}
