import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export type WorkspaceTab = 'agents' | 'rules' | 'machines';

const TABS: WorkspaceTab[] = ['agents', 'rules', 'machines'];
const KEY = 'tmux-dispatch-tab';

function fromHash(): WorkspaceTab | null {
  const hash = location.hash.replace('#', '');
  return (TABS as string[]).includes(hash) ? hash as WorkspaceTab : null;
}

/** The tab shown: the address says so first, then the last one used. */
export function useWorkspaceTab() {
  const [tab, setTabState] = useState<WorkspaceTab>(() => {
    const stored = localStorage.getItem(KEY);
    return fromHash() ?? ((TABS as string[]).includes(stored ?? '') ? stored as WorkspaceTab : 'agents');
  });

  const setTab = useCallback((next: WorkspaceTab) => {
    setTabState(next);
    localStorage.setItem(KEY, next);
    history.replaceState(null, '', `#${next}`);
  }, []);

  useEffect(() => {
    const onHash = () => {
      const next = fromHash();
      if (!next) return;
      setTabState(next);
      localStorage.setItem(KEY, next);
      const workspace = document.getElementById('workspace');
      if (workspace && workspace.getBoundingClientRect().top < 0) workspace.scrollIntoView({ block: 'start' });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return [tab, setTab] as const;
}

function TabCount({ value, tone }: { value: number | null; tone?: 'muted' }) {
  if (value === null) return null;
  return (
    <span className={tone === 'muted'
      ? 'text-xs font-normal text-muted-foreground tabular-nums'
      : 'rounded-full bg-secondary px-1.5 text-xs leading-5 font-medium text-secondary-foreground tabular-nums'}
    >
      {value}
    </span>
  );
}

/**
 * Everything that is not a pending request: what agents hold now, the rules
 * that answer future requests, and the machines allowed to connect. One at a
 * time, so the page stays short and the requests above it stay in view.
 */
export function Workspace({ tab, onTab, counts, agents, rules, machines }: {
  tab: WorkspaceTab;
  onTab: (tab: WorkspaceTab) => void;
  counts: { agents: number | null; offline: number | null; rules: number | null; machines: number | null };
  agents: ReactNode;
  rules: ReactNode;
  machines: ReactNode;
}) {
  return (
    <section id="workspace" aria-label="Agents, rules and machines" className="min-w-0 scroll-mt-14">
      <Tabs value={tab} onValueChange={value => onTab(value as WorkspaceTab)}>
        <TabsList aria-label="Sections" className="sticky top-14 z-30 -mx-4 bg-background px-4 pt-2 sm:-mx-6 sm:px-6">
          <TabsTrigger value="agents">
            Agents <TabCount value={counts.agents} />
          </TabsTrigger>
          <TabsTrigger value="rules">
            <span className="max-sm:hidden">Automatic rules</span><span className="sm:hidden">Rules</span> <TabCount value={counts.rules} />
          </TabsTrigger>
          <TabsTrigger value="machines">
            Machines <TabCount value={counts.machines} />
          </TabsTrigger>
        </TabsList>
        {/* Mounted while hidden: drafts, open details and handled focus requests survive a tab switch. */}
        <TabsContent value="agents" forceMount>{agents}</TabsContent>
        <TabsContent value="rules" forceMount>{rules}</TabsContent>
        <TabsContent value="machines" forceMount>{machines}</TabsContent>
      </Tabs>
    </section>
  );
}
