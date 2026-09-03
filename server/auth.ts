import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Config } from './config.js';
import type { Store } from './db.js';

/**
 * Sessions for the browser, device tokens for agents.
 *
 * The session cookie is a signed value rather than a database row: there is
 * nothing to store, and revocation happens by rotating SESSION_SECRET, which
 * is the right blast radius for a single-tenant-ish service.
 */

const COOKIE = 'tmux_mcp_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface Session {
  accountId: number;
  issuedAt: number;
}

function sign(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function issueSession(res: ServerResponse, config: Config, accountId: number): void {
  const payload = Buffer.from(JSON.stringify({ accountId, issuedAt: Date.now() })).toString('base64url');
  const cookie = `${payload}.${sign(payload, config.sessionSecret)}`;
  const secure = config.publicUrl.startsWith('https://') ? '; Secure' : '';
  res.setHeader(
    'set-cookie',
    `${COOKIE}=${cookie}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  );
}

export function clearSession(res: ServerResponse): void {
  res.setHeader('set-cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

export function readSession(req: IncomingMessage, config: Config): Session | null {
  const raw = (req.headers.cookie ?? '')
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!raw) return null;

  const [payload, signature] = raw.split('.');
  if (!payload || !signature) return null;
  const expected = sign(payload, config.sessionSecret);
  if (!constantTimeEquals(signature, expected)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Session;
    if (Date.now() - session.issuedAt > SESSION_TTL_MS) return null;
    return session;
  } catch {
    return null;
  }
}

export function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    // Still compare something, so length does not leak through timing alone.
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

/** scrypt, so a leaked hash is not a leaked password. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltRaw, hashRaw] = stored.split('$');
  if (scheme !== 'scrypt' || !saltRaw || !hashRaw) return false;
  const derived = scryptSync(password, Buffer.from(saltRaw, 'base64url'), 32);
  return constantTimeEquals(derived.toString('base64url'), hashRaw);
}

/**
 * Failed sign-ins slow down, per key. A public endpoint with one shared
 * secret needs this; without it the password is only as good as the attacker's
 * patience.
 */
export class Throttle {
  private readonly failures = new Map<string, { count: number; until: number }>();

  delayFor(key: string): number {
    const entry = this.failures.get(key);
    if (!entry) return 0;
    return Math.max(0, entry.until - Date.now());
  }

  recordFailure(key: string): void {
    const entry = this.failures.get(key) ?? { count: 0, until: 0 };
    entry.count += 1;
    // 0, 1s, 2s, 4s … capped at 30s.
    const delay = entry.count < 2 ? 0 : Math.min(2 ** (entry.count - 2) * 1000, 30_000);
    entry.until = Date.now() + delay;
    this.failures.set(key, entry);
  }

  recordSuccess(key: string): void {
    this.failures.delete(key);
  }
}

/** The single account used by token and password mode. */
export function localAccount(store: Store): { id: number; displayName: string } {
  const account = store.upsertAccount('local:admin', 'admin');
  return { id: account.id, displayName: account.displayName };
}
