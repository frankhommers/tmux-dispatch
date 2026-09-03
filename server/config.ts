import { randomBytes } from 'node:crypto';

/**
 * How a human signs in is derived from what is configured, so a deployment
 * has one knob fewer. AUTH_MODE overrides the detection.
 */
export type AuthMode = 'token' | 'password' | 'oidc';

export interface Config {
  port: number;
  publicUrl: string;
  authMode: AuthMode;
  /** token mode: the shared secret, printed on start when generated. */
  token: string;
  /** password mode. */
  adminPassword?: string;
  adminPasswordHash?: string;
  /** oidc mode. */
  oidcIssuer?: string;
  oidcClientId?: string;
  oidcClientSecret?: string;
  oidcAllowedSubs: string[];
  sessionSecret: string;
  databasePath: string;
  /** Refuse to run without TLS in front when the public URL says https. */
  requireForwardedHttps: boolean;
}

const MIN_PASSWORD_LENGTH = 12;

function detectMode(env: NodeJS.ProcessEnv): AuthMode {
  const explicit = env.AUTH_MODE as AuthMode | undefined;
  if (explicit) {
    if (explicit !== 'token' && explicit !== 'password' && explicit !== 'oidc') {
      throw new Error(`AUTH_MODE must be token, password or oidc (got '${explicit}')`);
    }
    return explicit;
  }
  if (env.OIDC_ISSUER) return 'oidc';
  if (env.ADMIN_PASSWORD || env.ADMIN_PASSWORD_HASH) return 'password';
  return 'token';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const authMode = detectMode(env);
  const publicUrl = (env.PUBLIC_URL ?? `http://127.0.0.1:${env.PORT ?? 7676}`).replace(/\/$/, '');

  if (authMode === 'password') {
    const password = env.ADMIN_PASSWORD;
    // A single shared secret on a public URL is the weakest mode; a short one
    // is not a mode, it is an invitation.
    if (password !== undefined && password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    if (!password && !env.ADMIN_PASSWORD_HASH) {
      throw new Error('password mode needs ADMIN_PASSWORD or ADMIN_PASSWORD_HASH');
    }
  }

  if (authMode === 'oidc') {
    for (const key of ['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET']) {
      if (!env[key]) throw new Error(`oidc mode needs ${key}`);
    }
  }

  return {
    port: Number(env.PORT ?? 7676),
    publicUrl,
    authMode,
    token: env.TMUX_MCP_DISPATCH_TOKEN ?? randomBytes(16).toString('hex'),
    adminPassword: env.ADMIN_PASSWORD,
    adminPasswordHash: env.ADMIN_PASSWORD_HASH,
    oidcIssuer: env.OIDC_ISSUER,
    oidcClientId: env.OIDC_CLIENT_ID,
    oidcClientSecret: env.OIDC_CLIENT_SECRET,
    oidcAllowedSubs: (env.OIDC_ALLOWED_SUBS ?? '').split(',').map(s => s.trim()).filter(Boolean),
    sessionSecret: env.SESSION_SECRET ?? randomBytes(32).toString('hex'),
    databasePath: env.DATABASE_PATH ?? ':memory:',
    requireForwardedHttps: publicUrl.startsWith('https://'),
  };
}
