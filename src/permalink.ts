/**
 * Fireteam permalinks.
 *
 * The whole fireteam lives in the URL hash, so pasting the link into Discord
 * loads the same six players for everyone who clicks it. There is no backend
 * and no database, and the hash never reaches a server because browsers do not
 * send it.
 *
 * Pure module.
 */

import { formatBungieName, parseBungieName } from './bungiename';
import type { PlayerRef } from './types';

/** Hash parameter holding the fireteam. */
export const PARAM = 'f';
/** A fireteam is at most a full raid team. */
export const MAX_PLAYERS = 6;

/**
 * Encodes to "#f=Ana%230007,Rob%231234".
 *
 * Names are percent encoded individually, so a name containing a comma or a
 * hash survives the round trip.
 */
export function encodeFireteam(players: PlayerRef[]): string {
  const valid = players.filter((p) => p && typeof p.name === 'string' && p.name.trim().length > 0);
  if (valid.length === 0) return '';
  const joined = valid
    .slice(0, MAX_PLAYERS)
    .map((p) => encodeURIComponent(formatBungieName(p)))
    .join(',');
  return '#' + PARAM + '=' + joined;
}

/**
 * Reads a fireteam back out of a hash. Unparseable entries are dropped rather
 * than failing the whole link, so one bad name in a pasted URL still loads the
 * rest of the team.
 */
export function decodeFireteam(hash: string): PlayerRef[] {
  if (typeof hash !== 'string' || hash.length === 0) return [];
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  if (body.length === 0) return [];

  let raw: string | null = null;
  for (const chunk of body.split('&')) {
    const eq = chunk.indexOf('=');
    if (eq === -1) continue;
    if (chunk.slice(0, eq) === PARAM) raw = chunk.slice(eq + 1);
  }
  if (raw === null || raw.length === 0) return [];

  const out: PlayerRef[] = [];
  const seen = new Set<string>();
  for (const piece of raw.split(',')) {
    if (piece.length === 0) continue;
    let decoded: string;
    try {
      decoded = decodeURIComponent(piece);
    } catch {
      continue;
    }
    const parsed = parseBungieName(decoded);
    if (!parsed.ok) continue;
    const key = formatBungieName(parsed.value).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(parsed.value);
    if (out.length === MAX_PLAYERS) break;
  }
  return out;
}

/** Absolute link for the share button. */
export function buildShareUrl(base: string, players: PlayerRef[]): string {
  const withoutHash = base.split('#')[0];
  return withoutHash + encodeFireteam(players);
}
