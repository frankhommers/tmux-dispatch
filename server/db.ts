import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import type { AgentIdentity, WireGrant } from './protocol.js';

/**
 * Persistent state: accounts, paired devices, the pre-assign pool and agent grants.
 *
 * Pending requests are deliberately not here — they belong to an open socket
 * and must not outlive it. node:sqlite keeps this dependency-free, so the
 * image needs no compiler.
 */

/** Durable agent state. Sockets and pending requests are never restored. */
export interface SavedAgent {
  id: string;
  accountId: number;
  deviceId: number | null;
  identity: AgentIdentity;
  connectedAt: number;
  lastSeen: number;
  grants: WireGrant[];
  revoked: Array<[string, number]>;
  activity: Array<[string, number]>;
}

export interface Account {
  id: number;
  subject: string;
  displayName: string;
}

export interface Device {
  id: number;
  accountId: number;
  name: string;
  createdAt: number;
  lastSeenAt: number | null;
}

export type PoolMatch = 'pane' | 'window';

export interface PoolEntry {
  id: number;
  accountId: number;
  /** A concrete id (%3, @2) or a glob over the candidate label. */
  pattern: string;
  kind: PoolMatch;
  reusable: boolean;
  /** Glob over the requesting agent's working directory. Empty means anyone. */
  cwd: string | null;
  /**
   * The tmux server a bare-id rule was made on, as `socket:pid:start_time`.
   * Ids are only unique within one server, so a rule naming one is void
   * elsewhere. Empty for label globs, which mean the same on any server.
   */
  tmuxServer: string | null;
  /** The machine the rule was made on, so a sweep never crosses hosts. */
  host: string | null;
  usedAt: number | null;
  createdAt: number;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export class Store {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY,
        subject TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS devices (
        id INTEGER PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS agent_state (
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL,
        state TEXT NOT NULL,
        PRIMARY KEY (account_id, agent_id)
      );
      CREATE TABLE IF NOT EXISTS pool (
        id INTEGER PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        pattern TEXT NOT NULL,
        kind TEXT NOT NULL,
        reusable INTEGER NOT NULL DEFAULT 0,
        cwd TEXT,
        tmux_server TEXT,
        used_at INTEGER,
        created_at INTEGER NOT NULL
      );
    `);

    this.addColumnIfMissing('pool', 'cwd', 'TEXT');
    this.addColumnIfMissing('pool', 'tmux_server', 'TEXT');
    this.addColumnIfMissing('pool', 'host', 'TEXT');
    this.collapseDuplicatePoolEntries();
  }

  /**
   * Keeping an assignment used to add a rule per press, so the same rule could
   * be stored several times over. They said one thing, so they become one row:
   * the oldest, which is the one the human actually made.
   */
  private collapseDuplicatePoolEntries(): void {
    this.db.exec(`
      DELETE FROM pool WHERE id NOT IN (
        SELECT MIN(id) FROM pool
        GROUP BY account_id, pattern, kind, IFNULL(cwd, ''), IFNULL(tmux_server, '')
      );
    `);
  }

  /**
   * A database from an earlier version keeps its rows; the new conditions are
   * simply absent there, which reads as "applies to anyone", the old meaning.
   */
  private addColumnIfMissing(table: string, column: string, type: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (columns.some(c => c.name === column)) return;
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }

  close(): void {
    this.db.close();
  }

  loadAgents(): SavedAgent[] {
    const rows = this.db.prepare('SELECT state FROM agent_state').all() as Array<{ state: string }>;
    const deviceExists = this.db.prepare('SELECT id FROM devices WHERE id = ? AND account_id = ?');
    return rows.map(row => JSON.parse(row.state) as SavedAgent).filter(agent =>
      this.accountById(agent.accountId) !== null
      && (agent.deviceId === null || deviceExists.get(agent.deviceId, agent.accountId) !== undefined));
  }

  /** Commit a whole account atomically, including removals and hidden revocations. */
  saveAgents(accountId: number, agents: SavedAgent[]): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM agent_state WHERE account_id = ?').run(accountId);
      const insert = this.db.prepare('INSERT INTO agent_state (account_id, agent_id, state) VALUES (?, ?, ?)');
      for (const agent of agents) {
        if (agent.accountId !== accountId) throw new Error('Agent account mismatch');
        insert.run(accountId, agent.id, JSON.stringify(agent));
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /** The account for an identity, created on first sight. */
  upsertAccount(subject: string, displayName: string): Account {
    this.db.prepare(
      'INSERT INTO accounts (subject, display_name) VALUES (?, ?) ' +
      'ON CONFLICT(subject) DO UPDATE SET display_name = excluded.display_name'
    ).run(subject, displayName);
    return this.accountBySubject(subject)!;
  }

  accountBySubject(subject: string): Account | null {
    const row = this.db.prepare('SELECT id, subject, display_name FROM accounts WHERE subject = ?')
      .get(subject) as { id: number; subject: string; display_name: string } | undefined;
    return row ? { id: row.id, subject: row.subject, displayName: row.display_name } : null;
  }

  accountById(id: number): Account | null {
    const row = this.db.prepare('SELECT id, subject, display_name FROM accounts WHERE id = ?')
      .get(id) as { id: number; subject: string; display_name: string } | undefined;
    return row ? { id: row.id, subject: row.subject, displayName: row.display_name } : null;
  }

  /** Returns the plaintext token once; only its hash is stored. */
  createDevice(accountId: number, name: string): { device: Device; token: string } {
    const token = newToken();
    const createdAt = Date.now();
    this.db.prepare(
      'INSERT INTO devices (account_id, token_hash, name, created_at) VALUES (?, ?, ?, ?)'
    ).run(accountId, hashToken(token), name, createdAt);
    const id = Number((this.db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id);
    return { device: { id, accountId, name, createdAt, lastSeenAt: null }, token };
  }

  deviceByToken(token: string): Device | null {
    const row = this.db.prepare(
      'SELECT id, account_id, name, created_at, last_seen_at FROM devices WHERE token_hash = ?'
    ).get(hashToken(token)) as
      { id: number; account_id: number; name: string; created_at: number; last_seen_at: number | null } | undefined;
    if (!row) return null;
    return {
      id: row.id,
      accountId: row.account_id,
      name: row.name,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
    };
  }

  touchDevice(id: number): void {
    this.db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(Date.now(), id);
  }

  listDevices(accountId: number): Device[] {
    const rows = this.db.prepare(
      'SELECT id, account_id, name, created_at, last_seen_at FROM devices WHERE account_id = ? ORDER BY created_at'
    ).all(accountId) as Array<{ id: number; account_id: number; name: string; created_at: number; last_seen_at: number | null }>;
    return rows.map(row => ({
      id: row.id,
      accountId: row.account_id,
      name: row.name,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
    }));
  }

  revokeDevice(accountId: number, id: number): boolean {
    const result = this.db.prepare('DELETE FROM devices WHERE id = ? AND account_id = ?').run(id, accountId);
    return Number(result.changes) > 0;
  }

  /**
   * A rule is what it says, not how often it was said: pressing keep twice
   * finds the rule the first press made instead of stacking a copy on it.
   */
  addPoolEntry(
    accountId: number,
    pattern: string,
    kind: PoolMatch,
    reusable: boolean,
    bound: { cwd?: string; tmuxServer?: string; host?: string } = {}
  ): PoolEntry {
    const createdAt = Date.now();
    const cwd = bound.cwd ?? null;
    const tmuxServer = bound.tmuxServer ?? null;
    const host = bound.host ?? null;

    const existing = this.listPool(accountId).find(
      entry => entry.pattern === pattern
        && entry.kind === kind
        && entry.cwd === cwd
        && entry.tmuxServer === tmuxServer
    );
    if (existing) return existing;

    this.db.prepare(
      'INSERT INTO pool (account_id, pattern, kind, reusable, cwd, tmux_server, host, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(accountId, pattern, kind, reusable ? 1 : 0, cwd, tmuxServer, host, createdAt);
    const id = Number((this.db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id);
    return { id, accountId, pattern, kind, reusable, cwd, tmuxServer, host, usedAt: null, createdAt };
  }

  listPool(accountId: number): PoolEntry[] {
    const rows = this.db.prepare(
      'SELECT id, account_id, pattern, kind, reusable, cwd, tmux_server, host, used_at, created_at FROM pool WHERE account_id = ? ORDER BY created_at, id'
    ).all(accountId) as Array<{ id: number; account_id: number; pattern: string; kind: string; reusable: number; cwd: string | null; tmux_server: string | null; host: string | null; used_at: number | null; created_at: number }>;
    return rows.map(row => ({
      id: row.id,
      accountId: row.account_id,
      pattern: row.pattern,
      kind: row.kind as PoolMatch,
      reusable: row.reusable === 1,
      cwd: row.cwd,
      tmuxServer: row.tmux_server,
      host: row.host,
      usedAt: row.used_at,
      createdAt: row.created_at,
    }));
  }

  /**
   * When this rule last handed a pane over. A one-shot rule is spent by it —
   * `entryMatches` refuses a used one — while a standing rule only gains a
   * date, which is the honest answer to "is this thing still in use?".
   */
  markPoolUsed(id: number): void {
    this.db.prepare('UPDATE pool SET used_at = ? WHERE id = ?').run(Date.now(), id);
  }

  /** Name the machine a rule was made on, once something proves which it is. */
  setPoolHost(accountId: number, id: number, host: string): void {
    this.db.prepare('UPDATE pool SET host = ? WHERE id = ? AND account_id = ?').run(host, id, accountId);
  }

  clearPoolUsed(id: number): void {
    this.db.prepare('UPDATE pool SET used_at = NULL WHERE id = ?').run(id);
  }

  removePoolEntry(accountId: number, id: number): boolean {
    const result = this.db.prepare('DELETE FROM pool WHERE id = ? AND account_id = ?').run(id, accountId);
    return Number(result.changes) > 0;
  }
}
