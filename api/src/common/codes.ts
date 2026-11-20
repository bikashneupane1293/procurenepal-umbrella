// Short human-friendly IDs: no 0/O/1/I/L, so they survive being read out over the phone.
// Org ID (given by an office to its staff): PN-7K3Q9M. Personal ID: U-8H3K2M. © Cuidado Technology Pvt. Ltd.
import { randomInt } from 'crypto';

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const ORG_CODE_RE = /^PN-[2-9A-HJKMNP-Z]{6}$/;
export const USER_CODE_RE = /^U-[2-9A-HJKMNP-Z]{6}$/;

export function makeCode(prefix: 'PN' | 'U', length = 6): string {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return `${prefix}-${out}`;
}

/** Upper-cases and trims what a person typed, so "pn-7k3q9m " still matches. */
export const normalizeCode = (s: string | null | undefined) => String(s ?? '').trim().toUpperCase();
