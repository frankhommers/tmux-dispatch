import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listDevices,
  listPool,
  listRequests,
  token,
  type ConnectedAgent,
  type Device,
  type PaneRequest,
  type PoolEntry,
} from '@/lib/api';
import { describe } from '@/lib/errors';

export type Connection = 'connecting' | 'live' | 'offline';

/**
 * One server snapshot. `data` is the last successful read and survives later
 * failures, so a failed refresh never blanks a section; `error` says the most
 * recent read failed.
 */
export interface Resource<T> {
  data: T | null;
  error: string | null;
  refreshing: boolean;
}

const EMPTY = { data: null, error: null, refreshing: false };

/** A read that ignores responses older than the newest one it started. */
function useResource<T>(load: () => Promise<T>) {
  const [state, setState] = useState<Resource<T>>(EMPTY);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const mine = ++sequence.current;
    setState(current => ({ ...current, refreshing: true }));
    try {
      const data = await load();
      if (mine === sequence.current) setState({ data, error: null, refreshing: false });
    } catch (cause) {
      if (mine === sequence.current) setState(current => ({ ...current, error: describe(cause), refreshing: false }));
    }
  }, [load]);
  const reset = useCallback(() => {
    sequence.current++;
    setState(EMPTY);
  }, []);
  return [state, refresh, setState, reset] as const;
}

const readInbox = () => listRequests();
const readPool = () => listPool().then(body => body.pool);
const readDevices = () => listDevices().then(body => body.devices);

/**
 * The dashboard's data, kept fresh by the service's event stream. Events only
 * say that something changed; every list is always re-read, so the page
 * cannot drift from what the agents actually have open. Requests, rules and
 * machines are read independently, so one failing cannot blank the others.
 */
export function useInbox(enabled: boolean) {
  const [inbox, refreshInbox, setInbox, resetInbox] = useResource(readInbox);
  const [pool, refreshPool, , resetPool] = useResource(readPool);
  const [devices, refreshDevices, , resetDevices] = useResource(readDevices);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [wasLive, setWasLive] = useState(false);
  const handlers = useRef<{ arrived: (reason: string) => void; auto: (data: AutoAssigned) => void }>({
    arrived: () => {},
    auto: () => {},
  });

  const refresh = useCallback(async () => {
    await Promise.all([refreshInbox(), refreshPool(), refreshDevices()]);
  }, [refreshInbox, refreshPool, refreshDevices]);

  useEffect(() => {
    if (!enabled) {
      resetInbox();
      resetPool();
      resetDevices();
      setConnection('connecting');
      setWasLive(false);
      return;
    }
    void refresh();

    const query = token ? `?t=${encodeURIComponent(token)}` : '';
    const events = new EventSource(`/events${query}`);
    events.addEventListener('open', () => {
      setConnection('live');
      setWasLive(true);
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
      setInbox(current => current.data === null ? current : {
        ...current,
        data: {
          ...current.data,
          requests: current.data.requests.map(request => ({
            ...request,
            ageSeconds: Math.round((Date.now() - request.createdAt) / 1000),
          })),
        },
      });
    }, 1000);

    return () => {
      events.close();
      clearInterval(timer);
    };
  }, [enabled, refresh, setInbox, resetInbox, resetPool, resetDevices]);

  const onArrived = useCallback((handler: (reason: string) => void) => {
    handlers.current.arrived = handler;
  }, []);
  const onAutoAssigned = useCallback((handler: (data: AutoAssigned) => void) => {
    handlers.current.auto = handler;
  }, []);

  return {
    inbox,
    pool,
    devices,
    connection,
    wasLive,
    refresh,
    refreshInbox,
    refreshPool,
    refreshDevices,
    onArrived,
    onAutoAssigned,
  };
}

export type Inbox = Resource<{ requests: PaneRequest[]; agents: ConnectedAgent[] }>;
export type Pool = Resource<PoolEntry[]>;
export type Devices = Resource<Device[]>;

export interface AutoAssigned {
  id: string;
  reason: string;
  target: string;
  label: string;
}
