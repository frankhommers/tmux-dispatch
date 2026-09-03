import { randomInt } from 'node:crypto';
import type { Store } from './db.js';

/**
 * Device-code pairing, so a machine is linked by confirming a short code in a
 * browser you are already signed into — no secret is ever pasted by hand.
 */

const CODE_TTL_MS = 10 * 60 * 1000;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1

export interface PendingPairing {
  userCode: string;
  deviceCode: string;
  name: string;
  createdAt: number;
  accountId: number | null;
  token: string | null;
  denied: boolean;
}

function code(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

export class Pairings {
  private readonly byUserCode = new Map<string, PendingPairing>();
  private readonly byDeviceCode = new Map<string, PendingPairing>();

  start(name: string): PendingPairing {
    this.sweep();
    const pairing: PendingPairing = {
      userCode: `${code(4)}-${code(4)}`,
      deviceCode: code(32),
      name,
      createdAt: Date.now(),
      accountId: null,
      token: null,
      denied: false,
    };
    this.byUserCode.set(pairing.userCode, pairing);
    this.byDeviceCode.set(pairing.deviceCode, pairing);
    return pairing;
  }

  find(userCode: string): PendingPairing | null {
    this.sweep();
    return this.byUserCode.get(userCode.trim().toUpperCase()) ?? null;
  }

  approve(store: Store, userCode: string, accountId: number): PendingPairing | null {
    const pairing = this.find(userCode);
    if (!pairing || pairing.accountId || pairing.denied) return null;
    const { token } = store.createDevice(accountId, pairing.name);
    pairing.accountId = accountId;
    pairing.token = token;
    return pairing;
  }

  deny(userCode: string): boolean {
    const pairing = this.find(userCode);
    if (!pairing || pairing.accountId) return false;
    pairing.denied = true;
    return true;
  }

  /** Called by the waiting CLI. Returns the token exactly once. */
  claim(deviceCode: string): { status: 'pending' } | { status: 'denied' } | { status: 'ready'; token: string } | null {
    this.sweep();
    const pairing = this.byDeviceCode.get(deviceCode);
    if (!pairing) return null;
    if (pairing.denied) return { status: 'denied' };
    if (!pairing.token) return { status: 'pending' };
    const token = pairing.token;
    this.byUserCode.delete(pairing.userCode);
    this.byDeviceCode.delete(pairing.deviceCode);
    return { status: 'ready', token };
  }

  private sweep(): void {
    const cutoff = Date.now() - CODE_TTL_MS;
    for (const [key, pairing] of this.byUserCode) {
      if (pairing.createdAt < cutoff) {
        this.byUserCode.delete(key);
        this.byDeviceCode.delete(pairing.deviceCode);
      }
    }
  }
}
