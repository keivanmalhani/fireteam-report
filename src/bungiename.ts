/**
 * Bungie Name parsing. Pure, so the form can be validated before spending a
 * request against someone's rate limit.
 *
 * A Bungie Name is a display name plus a numeric code: "Guardian#1234".
 * The code is stored as an integer, so "Ana#0007" and "Ana#7" are the same
 * player and both format back as "Ana#0007".
 */

import type { PlayerRef } from './types';

/** Bungie codes are at most four digits, and the padded form is canonical. */
export const CODE_DIGITS = 4;

export type NameError =
  | 'empty'
  | 'missing-hash'
  | 'too-many-hashes'
  | 'empty-name'
  | 'empty-code'
  | 'non-numeric-code'
  | 'code-too-long'
  | 'code-out-of-range';

export interface ParseOk { ok: true; value: PlayerRef }
export interface ParseErr { ok: false; error: NameError }
export type ParseResult = ParseOk | ParseErr;

/**
 * Parses "Name#1234". Returns a tagged result rather than throwing so the form
 * can show a specific message per failure.
 */
export function parseBungieName(input: string): ParseResult {
  if (typeof input !== 'string') return { ok: false, error: 'empty' };
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false, error: 'empty' };

  const parts = trimmed.split('#');
  if (parts.length === 1) return { ok: false, error: 'missing-hash' };
  if (parts.length > 2) return { ok: false, error: 'too-many-hashes' };

  const name = parts[0].trim();
  const rawCode = parts[1].trim();

  if (name.length === 0) return { ok: false, error: 'empty-name' };
  if (rawCode.length === 0) return { ok: false, error: 'empty-code' };
  if (!/^\d+$/.test(rawCode)) return { ok: false, error: 'non-numeric-code' };
  if (rawCode.length > CODE_DIGITS) return { ok: false, error: 'code-too-long' };

  const code = Number(rawCode);
  if (code <= 0) return { ok: false, error: 'code-out-of-range' };

  return { ok: true, value: { name, code } };
}

/** True when the string is a well formed Bungie Name. */
export function isValidBungieName(input: string): boolean {
  return parseBungieName(input).ok;
}

/** Canonical text form, zero padded: { name: "Ana", code: 7 } -> "Ana#0007". */
export function formatBungieName(ref: PlayerRef): string {
  return ref.name + '#' + String(ref.code).padStart(CODE_DIGITS, '0');
}

/** Human readable message for a parse failure. */
export function describeNameError(error: NameError): string {
  switch (error) {
    case 'empty': return 'Enter a Bungie Name.';
    case 'missing-hash': return 'Needs the # code, for example Guardian#1234.';
    case 'too-many-hashes': return 'Only one # is allowed.';
    case 'empty-name': return 'Needs a name before the #.';
    case 'empty-code': return 'Needs the digits after the #.';
    case 'non-numeric-code': return 'The part after # must be digits only.';
    case 'code-too-long': return 'The code after # is at most four digits.';
    case 'code-out-of-range': return 'The code after # cannot be zero.';
  }
}
