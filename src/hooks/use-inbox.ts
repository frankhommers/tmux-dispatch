import { useCallback, useEffect, useRef, useState } from 'react';
import { listRequests, token, type ConnectedAgent, type PaneRequest } from '@/lib/api';

export type Connection = 'connecting' | 'live' | 'offline';

/**
 * The inbox, kept fresh by the service's event stream. Events only say that
 * something changed; the list itself is always re-read, so the page cannot
 * drift from what the agents actually have open.
 */
export function useInbox(enabled: boolean) {
  const [requests, setRequests] = useState<PaneRequest[] | null>(null);
  const [agents, setAgents] = useState<ConnectedAgent[]>([]);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [error, setError] = useState<string | null>(null);
  const handlers = useRef<{ arrived: (reason: string) => void; auto: (data: AutoAssigned) => void }>({
    arrived: () => {},
    auto: () => {},
  });

  const refresh = useCallback(async () => {
    try {
      const { requests, agents } = await listRequests();
      setRequests(requests);
      setAgents(agents);
      setError(null);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();

    const query = token ? `?t=${encodeURIComponent(token)}` : '';
    const events = new EventSource(`/events${query}`);
    events.addEventListener('open', () => {
      setConnection('live');
      // Changes during a dropped stream are not replayed by the server.
      void refresh();
    });
    events.addEventListener('error', () => setConnection('offline'));
    events.addEventListener('change', () => void refresh());
    events.addEventListener('request', event => {
      void refresh();
      try {
        handlers.current.arrived(JSON.parse((event as MessageEvent).data).reason);
      } catch { /* a malformed event is not worth breaking the page over */ }
    });
    events.addEventListener('auto-assigned', event => {
      void refresh();
      try {
        handlers.current.auto(JSON.parse((event as MessageEvent).data) as AutoAssigned);
      } catch { /* as above */ }
    });

    // Age labels tick without involving the server.
    const timer = setInterval(() => {
      setRequests(current =>
        current?.map(request => ({
          ...request,
          ageSeconds: Math.round((Date.now() - request.createdAt) / 1000),
        })) ?? null
      );
    }, 1000);

    return () => {
      events.close();
      clearInterval(timer);
    };
  }, [enabled, refresh]);

  const onArrived = useCallback((handler: (reason: string) => void) => {
    handlers.current.arrived = handler;
  }, []);
  const onAutoAssigned = useCallback((handler: (data: AutoAssigned) => void) => {
    handlers.current.auto = handler;
  }, []);

  return { requests, agents, connection, error, refresh, onArrived, onAutoAssigned };
}

export interface AutoAssigned {
  id: string;
  reason: string;
  target: string;
  label: string;
}
