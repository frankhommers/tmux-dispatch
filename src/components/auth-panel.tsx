import type { ReactNode } from 'react';
import { Panel } from '@/components/common';
import { ThemeSelect } from '@/components/theme-select';
import type { ThemePreference } from '@/lib/theme';

/** The panel every pre-dashboard screen uses: sign-in, pairing, bootstrap. */
export function AuthPanel({ title, subtitle, children, theme, onTheme }: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  theme: ThemePreference;
  onTheme: (value: ThemePreference) => void;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <main className="flex flex-1 items-start justify-center px-4 pt-[10vh] pb-16 sm:items-center sm:pt-0">
        <div className="w-full max-w-[400px]">
          <div className="mb-5 flex items-center gap-2.5 px-1">
            <span aria-hidden className="grid size-8 place-items-center rounded-md bg-foreground font-mono text-xs font-bold text-background">&gt;_</span>
            <div>
              <span className="block text-[15px] leading-5 font-semibold tracking-tight">tmux-dispatch</span>
              <span className="block text-xs text-muted-foreground">Hand tmux panes to your AI agents, by request or by rule.</span>
            </div>
          </div>
          <Panel className="p-6 max-sm:p-4">
            <h1 className="text-lg leading-[26px] font-semibold">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
            <div className="mt-5 grid gap-3">{children}</div>
          </Panel>
          <div className="mt-3 flex items-center justify-end gap-2 px-1 text-xs text-muted-foreground">
            Appearance
            <ThemeSelect value={theme} onChange={onTheme} />
          </div>
        </div>
      </main>
    </div>
  );
}
