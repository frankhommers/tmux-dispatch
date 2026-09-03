import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';

/**
 * Persistent state: accounts, paired devices and the pre-assign pool.
 *
 * Pending requests are deliberately not here — they belong to an open socket
 * and must not outlive it. node:sqlite keeps this dependency-free, so the
 * image needs no compiler.
 */

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
      CREATE TABLE IF NOT EXISTS pool (
        id INTEGER PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        pattern TEXT NOT NULL,
        kind TEXT NOT NULL,
        reusable INTEGER NOT NULL DEFAULT 0,
        used_at INTEGER,
        created_at INTEGER NOT NULL
      );
    `);
  }

  close(): void {
    this.db.close();
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

  addPoolEntry(accountId: number, pattern: string, kind: PoolMatch, reusable: boolean): PoolEntry {
    const createdAt = Date.now();
    this.db.prepare(
      'INSERT INTO pool (account_id, pattern, kind, reusable, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(accountId, pattern, kind, reusable ? 1 : 0, createdAt);
    const id = Number((this.db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id);
    return { id, accountId, pattern, kind, reusable, usedAt: null, createdAt };
  }

  listPool(accountId: number): PoolEntry[] {
    const rows = this.db.prepare(
      'SELECT id, account_id, pattern, kind, reusable, used_at, created_at FROM pool WHERE account_id = ? ORDER BY created_at'
    ).all(accountId) as Array<{ id: number; account_id: number; pattern: string; kind: string; reusable: number; used_at: number | null; created_at: number }>;
    return rows.map(row => ({
      id: row.id,
      accountId: row.account_id,
      pattern: row.pattern,
      kind: row.kind as PoolMatch,
      reusable: row.reusable === 1,
      usedAt: row.used_at,
      createdAt: row.created_at,
    }));
  }

  markPoolUsed(id: number): void {
    this.db.prepare('UPDATE pool SET used_at = ? WHERE id = ? AND reusable = 0').run(Date.now(), id);
  }

  clearPoolUsed(id: number): void {
    this.db.prepare('UPDATE pool SET used_at = NULL WHERE id = ?').run(id);
  }

  removePoolEntry(accountId: number, id: number): boolean {
    const result = this.db.prepare('DELETE FROM pool WHERE id = ? AND account_id = ?').run(id, accountId);
    return Number(result.changes) > 0;
  }
}
