import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import type { Config } from './config.js';
import { Store } from './db.js';
import { AgentRegistry } from './agents.js';
import { Pairings } from './devices.js';
import { findPoolMatch } from './pool.js';
import {
  Throttle,
  clearSession,
  constantTimeEquals,
  issueSession,
  localAccount,
  readSession,
  verifyPassword,
} from './auth.js';
import { beginOidc, completeOidc } from './oidc.js';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

export interface Service {
  port: number;
  url: string;
  store: Store;
  agents: AgentRegistry;
  close(): Promise<void>;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  const relative = pathname === '/' || pathname.startsWith('/r/') || pathname === '/link'
    ? 'index.html'
    : pathname.slice(1);
  const target = resolve(publicDir, relative);
  if (target !== publicDir && !target.startsWith(publicDir + '/')) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(target);
    const immutable = relative.startsWith('assets/');
    res.writeHead(200, {
      'content-type': TYPES[extname(target)] ?? 'application/octet-stream',
      'content-length': body.byteLength,
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
}

export async function startService(config: Config): Promise<Service> {
  const store = new Store(config.databasePath);
  const agents = new AgentRegistry();
  const pairings = new Pairings();
  const throttle = new Throttle();
  const subscribers = new Set<{ accountId: number; res: ServerResponse }>();

  const broadcast = (accountId: number, event: string, data: unknown): void => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const sub of subscribers) {
      if (sub.accountId !== accountId) continue;
      try { sub.res.write(payload); } catch { /* dropped on close */ }
    }
  };

  agents.on('change', (accountId: number) => broadcast(accountId, 'change', {}));

  // Pre-assigned entries answer before a human is bothered. The match runs
  // against the candidates the agent sent, so it can never widen that list.
  agents.on('request', (accountId: number, request) => {
    const match = findPoolMatch(store.listPool(accountId), request.candidates, request.kind);
    if (!match) {
      broadcast(accountId, 'request', { id: request.id, reason: request.reason });
      return;
    }
    if (agents.answer(accountId, request.id, { target: match.candidate.id })) {
      agents.markAutoAssigned(request.id, match.candidate.id, match.entry.id);
      store.markPoolUsed(match.entry.id);
      broadcast(accountId, 'auto-assigned', {
        id: request.id,
        reason: request.reason,
        target: match.candidate.id,
        label: match.candidate.label,
      });
    }
  });

  /** Who is this browser? Null when signed out. */
  const accountFor = (req: IncomingMessage): number | null => {
    if (config.authMode === 'token') {
      const url = new URL(req.url ?? '/', config.publicUrl);
      const header = req.headers.authorization;
      const presented = header?.startsWith('Bearer ') ? header.slice(7) : url.searchParams.get('t');
      if (presented && constantTimeEquals(presented, config.token)) return localAccount(store).id;
      return readSession(req, config)?.accountId ?? null;
    }
    return readSession(req, config)?.accountId ?? null;
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', config.publicUrl);
    const path = url.pathname;

    if (path === '/api/health') {
      sendJson(res, 200, { ok: true, authMode: config.authMode });
      return;
    }

    // Behind TLS termination; refuse to serve a public URL over plain http.
    if (config.requireForwardedHttps && req.headers['x-forwarded-proto'] === 'http') {
      sendJson(res, 400, { error: 'this deployment expects https' });
      return;
    }

    if (path === '/api/session' && req.method === 'GET') {
      const accountId = accountFor(req);
      sendJson(res, 200, {
        authMode: config.authMode,
        signedIn: accountId !== null,
        account: accountId !== null ? store.accountById(accountId)?.displayName ?? null : null,
      });
      return;
    }

    if (path === '/api/login' && req.method === 'POST') {
      if (config.authMode !== 'password') {
        sendJson(res, 400, { error: 'this deployment does not use a password' });
        return;
      }
      const key = String(req.socket.remoteAddress ?? 'unknown');
      const wait = throttle.delayFor(key);
      if (wait > 0) {
        sendJson(res, 429, { error: `too many attempts, try again in ${Math.ceil(wait / 1000)}s` });
        return;
      }
      const body = await readBody(req);
      const password = typeof body.password === 'string' ? body.password : '';
      const ok = config.adminPasswordHash
        ? verifyPassword(password, config.adminPasswordHash)
        : constantTimeEquals(password, config.adminPassword ?? '');
      if (!ok) {
        throttle.recordFailure(key);
        sendJson(res, 401, { error: 'wrong password' });
        return;
      }
      throttle.recordSuccess(key);
      issueSession(res, config, localAccount(store).id);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (path === '/api/logout' && req.method === 'POST') {
      clearSession(res);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (path === '/auth/start' && config.authMode === 'oidc') {
      await beginOidc(config, res);
      return;
    }

    if (path === '/auth/callback' && config.authMode === 'oidc') {
      await completeOidc(config, store, req, res, url);
      return;
    }

    if (path.startsWith('/api/') || path === '/events') {
      const accountId = accountFor(req);
      if (accountId === null) {
        sendJson(res, 401, { error: 'not signed in' });
        return;
      }
      await handleApi(path, req, res, url, accountId);
      return;
    }

    await serveStatic(path, res);
  };

  const handleApi = async (
    path: string,
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    accountId: number
  ): Promise<void> => {
    if (path === '/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      const sub = { accountId, res };
      subscribers.add(sub);
      req.on('close', () => subscribers.delete(sub));
      return;
    }

    if (path === '/api/requests' && req.method === 'GET') {
      sendJson(res, 200, {
        requests: agents.listRequests(accountId).map(request => ({
          id: request.id,
          reason: request.reason,
          kind: request.kind,
          createdAt: request.createdAt,
          expiresAt: request.expiresAt,
          ageSeconds: Math.round((Date.now() - request.createdAt) / 1000),
          candidates: request.candidates,
          autoAssigned: request.autoAssigned ?? null,
          lastError: request.lastError ?? null,
          agent: agents.agentOf(request.id)?.identity ?? null,
        })),
        agents: agents.listAgents(accountId).map(agent => ({
          id: agent.id,
          identity: agent.identity,
          connectedAt: agent.connectedAt,
          lastSeen: agent.lastSeen,
          connected: agent.connected,
          grants: agent.grants.map(grant => ({
            ...grant,
            lastActivity: agent.activity.get(grant.target) ?? null,
          })),
        })),
      });
      return;
    }

    const answerMatch = path.match(/^\/api\/requests\/([^/]+)\/(grant|deny|refresh)$/);
    if (answerMatch && req.method === 'POST') {
      const [, id, action] = answerMatch;
      const body = await readBody(req);
      if (action === 'refresh') {
        sendJson(res, agents.refresh(accountId, id) ? 200 : 404, { ok: true });
        return;
      }
      if (action === 'deny') {
        const reason = typeof body.reason === 'string' ? body.reason : undefined;
        sendJson(res, agents.answer(accountId, id, { deny: true, reason }) ? 200 : 404, { ok: true });
        return;
      }
      const target = typeof body.target === 'string' ? body.target : '';
      if (!target) {
        sendJson(res, 400, { error: 'target is required' });
        return;
      }
      sendJson(res, agents.answer(accountId, id, { target }) ? 200 : 404, { ok: true });
      return;
    }

    const revokeMatch = path.match(/^\/api\/agents\/([^/]+)\/revoke$/);
    if (revokeMatch && req.method === 'POST') {
      const body = await readBody(req);
      const target = typeof body.target === 'string' ? body.target : '';
      if (!target) {
        sendJson(res, 400, { error: 'target is required' });
        return;
      }
      sendJson(res, agents.revoke(accountId, revokeMatch[1], target) ? 200 : 404, { ok: true });
      return;
    }

    if (path === '/api/pool' && req.method === 'GET') {
      sendJson(res, 200, { pool: store.listPool(accountId) });
      return;
    }

    if (path === '/api/pool' && req.method === 'POST') {
      const body = await readBody(req);
      const pattern = typeof body.pattern === 'string' ? body.pattern.trim() : '';
      if (!pattern) {
        sendJson(res, 400, { error: 'pattern is required' });
        return;
      }
      const kind = body.kind === 'window' ? 'window' : 'pane';
      sendJson(res, 200, {
        entry: store.addPoolEntry(accountId, pattern, kind, body.reusable === true),
      });
      return;
    }

    const poolMatch = path.match(/^\/api\/pool\/(\d+)$/);
    if (poolMatch && req.method === 'DELETE') {
      sendJson(res, store.removePoolEntry(accountId, Number(poolMatch[1])) ? 200 : 404, { ok: true });
      return;
    }
    if (poolMatch && req.method === 'POST') {
      store.clearPoolUsed(Number(poolMatch[1]));
      sendJson(res, 200, { ok: true });
      return;
    }

    if (path === '/api/devices' && req.method === 'GET') {
      sendJson(res, 200, { devices: store.listDevices(accountId) });
      return;
    }

    const deviceMatch = path.match(/^\/api\/devices\/(\d+)$/);
    if (deviceMatch && req.method === 'DELETE') {
      const deviceId = Number(deviceMatch[1]);
      const revoked = store.revokeDevice(accountId, deviceId);
      if (revoked) agents.dropDevice(deviceId);
      sendJson(res, revoked ? 200 : 404, { ok: true });
      return;
    }

    if (path === '/api/pair/lookup' && req.method === 'POST') {
      const body = await readBody(req);
      const pairing = pairings.find(String(body.userCode ?? ''));
      sendJson(res, pairing ? 200 : 404, pairing ? { name: pairing.name } : { error: 'unknown or expired code' });
      return;
    }

    if (path === '/api/pair/approve' && req.method === 'POST') {
      const body = await readBody(req);
      const pairing = pairings.approve(store, String(body.userCode ?? ''), accountId);
      sendJson(res, pairing ? 200 : 404, pairing ? { ok: true } : { error: 'unknown or expired code' });
      return;
    }

    if (path === '/api/pair/deny' && req.method === 'POST') {
      const body = await readBody(req);
      sendJson(res, pairings.deny(String(body.userCode ?? '')) ? 200 : 404, { ok: true });
      return;
    }

    sendJson(res, 404, { error: `not found: ${path}` });
  };

  const server = createServer((req, res) => {
    void handle(req, res).catch((error: Error) => {
      if (!res.headersSent) sendJson(res, 500, { error: error.message });
      else res.end();
    });
  });

  // Device pairing is unauthenticated by nature: the CLI has no credential
  // yet. It is rate-limited and the code is useless until a signed-in human
  // approves it.
  server.on('request', () => { /* handled above */ });

  const openSockets = new Set<Socket>();
  server.on('connection', socket => {
    openSockets.add(socket);
    socket.on('close', () => openSockets.delete(socket));
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', config.publicUrl);
    if (url.pathname !== '/agent') {
      socket.destroy();
      return;
    }
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

    let accountId: number | null = null;
    let deviceId: number | null = null;
    let accountName = 'local';

    // The shared token is only a credential in token mode; a paired device
    // works in every mode, because pairing is not mode-specific.
    if (config.authMode === 'token' && token && constantTimeEquals(token, config.token)) {
      const account = localAccount(store);
      accountId = account.id;
      accountName = account.displayName;
    } else if (token) {
      const device = store.deviceByToken(token);
      if (device) {
        store.touchDevice(device.id);
        accountId = device.accountId;
        deviceId = device.id;
        accountName = store.accountById(device.accountId)?.displayName ?? 'account';
      }
    }

    if (accountId === null) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const resolvedAccountId = accountId;
    const resolvedName = accountName;
    wss.handleUpgrade(req, socket, head, ws => {
      agents.accept(ws, resolvedAccountId, deviceId, resolvedName);
    });
  });

  // Unauthenticated pairing start, handled before the API guard.
  const originalHandle = handle;
  const withPairing = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', config.publicUrl);
    if (url.pathname === '/api/pair/start' && req.method === 'POST') {
      const body = await readBody(req);
      const pairing = pairings.start(typeof body.name === 'string' && body.name ? body.name : 'a machine');
      sendJson(res, 200, {
        userCode: pairing.userCode,
        deviceCode: pairing.deviceCode,
        verificationUri: `${config.publicUrl}/link`,
        intervalSeconds: 2,
        expiresInSeconds: 600,
      });
      return;
    }
    if (url.pathname === '/api/pair/claim' && req.method === 'POST') {
      const body = await readBody(req);
      const claim = pairings.claim(String(body.deviceCode ?? ''));
      sendJson(res, claim ? 200 : 404, claim ?? { error: 'unknown or expired code' });
      return;
    }
    await originalHandle(req, res);
  };

  server.removeAllListeners('request');
  server.on('request', (req, res) => {
    void withPairing(req, res).catch((error: Error) => {
      if (!res.headersSent) sendJson(res, 500, { error: error.message });
      else res.end();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, '0.0.0.0', () => resolve());
  });
  const port = (server.address() as AddressInfo).port;

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    store,
    agents,
    close: async () => {
      for (const socket of openSockets) socket.destroy();
      wss.close();
      await new Promise<void>(resolve => server.close(() => resolve()));
      store.close();
    },
  };
}
