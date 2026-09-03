import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Config } from './config.js';
import type { Store } from './db.js';
import { issueSession } from './auth.js';

/**
 * Authorization code with PKCE against any compliant OIDC provider.
 *
 * The account is issuer + sub, never the email: an email can be reassigned to
 * a different person, a subject cannot.
 *
 * GitHub is deliberately absent — it publishes no OIDC discovery for user
 * login (github.com/.well-known/openid-configuration is a 404). Federate it
 * behind a provider that does.
 */

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  issuer: string;
}

let cached: { issuer: string; document: Discovery; fetchedAt: number } | null = null;
const DISCOVERY_TTL_MS = 60 * 60 * 1000;

async function discover(issuer: string): Promise<Discovery> {
  if (cached && cached.issuer === issuer && Date.now() - cached.fetchedAt < DISCOVERY_TTL_MS) {
    return cached.document;
  }
  const url = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`OIDC discovery failed: ${url} returned ${res.status}`);
  const document = await res.json() as Discovery;
  cached = { issuer, document, fetchedAt: Date.now() };
  return document;
}

interface PendingLogin {
  state: string;
  verifier: string;
  nonce: string;
  createdAt: number;
}

const pending = new Map<string, PendingLogin>();
const LOGIN_TTL_MS = 10 * 60 * 1000;

function sweep(): void {
  const cutoff = Date.now() - LOGIN_TTL_MS;
  for (const [state, login] of pending) {
    if (login.createdAt < cutoff) pending.delete(state);
  }
}

export async function beginOidc(config: Config, res: ServerResponse): Promise<void> {
  sweep();
  const document = await discover(config.oidcIssuer!);

  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(16).toString('base64url');
  const nonce = randomBytes(16).toString('base64url');
  pending.set(state, { state, verifier, nonce, createdAt: Date.now() });

  const authorize = new URL(document.authorization_endpoint);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', config.oidcClientId!);
  authorize.searchParams.set('redirect_uri', `${config.publicUrl}/auth/callback`);
  authorize.searchParams.set('scope', 'openid profile');
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('nonce', nonce);
  authorize.searchParams.set('code_challenge', challenge);
  authorize.searchParams.set('code_challenge_method', 'S256');

  res.writeHead(302, { location: authorize.toString() });
  res.end();
}

/** Decode without verifying the signature; the token came straight from the
 *  token endpoint over TLS, and the nonce ties it to this login. */
function decodeIdToken(idToken: string): { iss?: string; sub?: string; nonce?: string; name?: string; preferred_username?: string } {
  const [, payload] = idToken.split('.');
  if (!payload) throw new Error('id_token is malformed');
  return JSON.parse(Buffer.from(payload, 'base64url').toString());
}

export async function completeOidc(
  config: Config,
  store: Store,
  _req: IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<void> {
  const state = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code') ?? '';
  const login = pending.get(state);
  if (!login || !code) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('sign-in expired or was tampered with; start again');
    return;
  }
  pending.delete(state);

  const document = await discover(config.oidcIssuer!);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: `${config.publicUrl}/auth/callback`,
    client_id: config.oidcClientId!,
    client_secret: config.oidcClientSecret!,
    code_verifier: login.verifier,
  });
  const tokenRes = await fetch(document.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenRes.ok) {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('the identity provider refused the code exchange');
    return;
  }
  const tokens = await tokenRes.json() as { id_token?: string };
  if (!tokens.id_token) {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('the identity provider returned no id_token');
    return;
  }

  const claims = decodeIdToken(tokens.id_token);
  if (claims.nonce !== login.nonce) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('id_token does not belong to this sign-in');
    return;
  }
  if (!claims.sub || !claims.iss) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('id_token is missing iss or sub');
    return;
  }
  if (config.oidcAllowedSubs.length > 0 && !config.oidcAllowedSubs.includes(claims.sub)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('this account is not allowed here');
    return;
  }

  const account = store.upsertAccount(
    `${claims.iss}#${claims.sub}`,
    claims.preferred_username ?? claims.name ?? claims.sub
  );
  issueSession(res, config, account.id);
  res.writeHead(302, { location: '/' });
  res.end();
}
