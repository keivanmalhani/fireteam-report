/**
 * Bungie API client.
 *
 * This is the only module that talks to the network on a player's behalf, and
 * the only one that reads the user's API key. Per player endpoints require an
 * X-API-Key header; the key belongs to the person using the site and is never
 * committed, bundled or sent anywhere except bungie.net.
 */

import { clearsForPlayer, type AggregateActivitiesResponse } from './aggregate';
import { formatBungieName } from './bungiename';
import type { ActivityGroup, PlayerRef, PlayerStats } from './types';

export const API_ROOT = 'https://www.bungie.net/Platform';
export const APP_URL = 'https://www.bungie.net/en/Application';

/** The only two things this app is allowed to keep in localStorage. */
export const STORAGE_KEY_APIKEY = 'fireteam-report.apikey';
export const STORAGE_KEY_MANIFEST = 'fireteam-report.manifest';

/** Bungie platform error codes worth naming. */
export const ERR_SUCCESS = 1;
export const ERR_API_KEY_MISSING = 2102;
export const ERR_PRIVACY = 1665;
export const ERR_ACCOUNT_NOT_FOUND = 1601;

export class BungieError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly status: number
  ) {
    super(message);
    this.name = 'BungieError';
  }
}

/* ------------------------------------------------------------------ */
/* key storage                                                         */
/* ------------------------------------------------------------------ */

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // private browsing or blocked storage
  }
}

export function getApiKey(): string {
  return storage()?.getItem(STORAGE_KEY_APIKEY)?.trim() ?? '';
}

export function setApiKey(key: string): void {
  const trimmed = key.trim();
  const store = storage();
  if (!store) return;
  if (trimmed) store.setItem(STORAGE_KEY_APIKEY, trimmed);
  else store.removeItem(STORAGE_KEY_APIKEY);
}

export function clearApiKey(): void {
  storage()?.removeItem(STORAGE_KEY_APIKEY);
}

export function hasApiKey(): boolean {
  return getApiKey().length > 0;
}

/* ------------------------------------------------------------------ */
/* transport                                                           */
/* ------------------------------------------------------------------ */

interface PlatformResponse<T> {
  Response?: T;
  ErrorCode?: number;
  ErrorStatus?: string;
  Message?: string;
}

interface RequestOptions {
  /** Send the key when we have one. The manifest works without it, mostly. */
  key?: string;
  method?: 'GET' | 'POST';
  body?: unknown;
  /** Bungie occasionally answers a keyless manifest call with 2102. */
  retries?: number;
  /** Hard deadline. A hung request would otherwise leave the UI spinning. */
  timeoutMs?: number;
}

/** Default deadline for a per player call. */
export const REQUEST_TIMEOUT_MS = 15000;

async function platformFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { key = '', method = 'GET', body, retries = 0, timeoutMs = REQUEST_TIMEOUT_MS } = options;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (key) headers['X-API-Key'] = key;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetch(API_ROOT + path, {
          method,
          headers,
          signal: controller.signal,
          ...(body === undefined ? {} : { body: JSON.stringify(body) })
        });
      } finally {
        clearTimeout(timer);
      }

      let payload: PlatformResponse<T> | null = null;
      try {
        payload = (await response.json()) as PlatformResponse<T>;
      } catch {
        payload = null;
      }

      const code = payload?.ErrorCode ?? 0;
      if (response.ok && code === ERR_SUCCESS && payload?.Response !== undefined) {
        return payload.Response;
      }

      const message =
        payload?.Message ?? payload?.ErrorStatus ?? 'HTTP ' + response.status;
      const error = new BungieError(message, code, response.status);

      // Only the flaky keyless manifest case is worth retrying.
      const retryable = code === ERR_API_KEY_MISSING || response.status >= 500;
      if (!retryable || attempt === retries) throw error;
      lastError = error;
    } catch (err) {
      const wrapped =
        err instanceof Error && err.name === 'AbortError'
          ? new BungieError('bungie.net did not answer in time.', 0, 0)
          : err;
      if (attempt === retries) throw wrapped;
      lastError = wrapped;
    }
    await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
  }
  throw lastError instanceof Error ? lastError : new Error('Request failed');
}

/* ------------------------------------------------------------------ */
/* endpoints                                                           */
/* ------------------------------------------------------------------ */

export interface UserInfoCard {
  membershipType: number;
  membershipId: string;
  displayName?: string;
  bungieGlobalDisplayName?: string;
  bungieGlobalDisplayNameCode?: number;
  crossSaveOverride?: number;
  applicableMembershipTypes?: number[];
}

/**
 * Finds a player by Bungie Name across every platform.
 * Cross save means one person can answer on several platforms; the account
 * that owns the character data is the cross save primary when one is set.
 */
export async function searchPlayer(key: string, ref: PlayerRef): Promise<UserInfoCard | null> {
  const results = await platformFetch<UserInfoCard[]>(
    '/Destiny2/SearchDestinyPlayerByBungieName/-1/',
    {
      key,
      method: 'POST',
      body: { displayName: ref.name, displayNameCode: ref.code }
    }
  );
  if (!Array.isArray(results) || results.length === 0) return null;
  const primary = results.find(
    (r) => r.crossSaveOverride && r.crossSaveOverride === r.membershipType
  );
  return primary ?? results[0];
}

interface ProfileCharacters {
  characters?: { data?: Record<string, unknown>; privacy?: number };
}

/** Character ids for an account. An empty list usually means private stats. */
export async function getCharacterIds(
  key: string,
  membershipType: number,
  membershipId: string
): Promise<string[]> {
  const profile = await platformFetch<ProfileCharacters>(
    '/Destiny2/' + membershipType + '/Profile/' + membershipId + '/?components=200',
    { key }
  );
  const data = profile?.characters?.data;
  if (!data || typeof data !== 'object') return [];
  return Object.keys(data);
}

export async function getAggregateActivityStats(
  key: string,
  membershipType: number,
  membershipId: string,
  characterId: string
): Promise<AggregateActivitiesResponse> {
  return platformFetch<AggregateActivitiesResponse>(
    '/Destiny2/' +
      membershipType +
      '/Account/' +
      membershipId +
      '/Character/' +
      characterId +
      '/Stats/AggregateActivityStats/',
    { key }
  );
}

/* ------------------------------------------------------------------ */
/* orchestration                                                       */
/* ------------------------------------------------------------------ */

/**
 * Full lookup for one player: find them, list their characters, pull aggregate
 * stats for each, and sum. A player with their stats set to private gets a
 * PlayerStats carrying a `problem` rather than a column full of zeroes, because
 * "0 clears" and "would not say" are very different answers.
 */
export async function fetchPlayerStats(
  key: string,
  ref: PlayerRef,
  groups: ActivityGroup[]
): Promise<PlayerStats> {
  const label = formatBungieName(ref);
  const base: PlayerStats = { ref, label, clears: {} };

  let card: UserInfoCard | null;
  try {
    card = await searchPlayer(key, ref);
  } catch (err) {
    return { ...base, problem: 'error', problemDetail: messageOf(err) };
  }
  if (!card) {
    return { ...base, problem: 'not-found', problemDetail: 'No Destiny account with that Bungie Name.' };
  }

  const found: PlayerStats = {
    ...base,
    membershipType: card.membershipType,
    membershipId: card.membershipId
  };

  let characterIds: string[];
  try {
    characterIds = await getCharacterIds(key, card.membershipType, card.membershipId);
  } catch (err) {
    if (err instanceof BungieError && err.code === ERR_PRIVACY) {
      return { ...found, problem: 'private', problemDetail: 'This player keeps their stats private.' };
    }
    return { ...found, problem: 'error', problemDetail: messageOf(err) };
  }

  if (characterIds.length === 0) {
    return { ...found, problem: 'private', problemDetail: 'No characters visible, so the account is private.' };
  }

  const perCharacter: AggregateActivitiesResponse[] = [];
  let privacyHits = 0;
  for (const characterId of characterIds) {
    try {
      perCharacter.push(
        await getAggregateActivityStats(key, card.membershipType, card.membershipId, characterId)
      );
    } catch (err) {
      if (err instanceof BungieError && err.code === ERR_PRIVACY) privacyHits += 1;
      else return { ...found, problem: 'error', problemDetail: messageOf(err) };
    }
  }

  if (perCharacter.length === 0) {
    return {
      ...found,
      problem: privacyHits > 0 ? 'private' : 'error',
      problemDetail:
        privacyHits > 0
          ? 'This player keeps their activity history private.'
          : 'Could not read activity history.'
    };
  }

  return { ...found, clears: clearsForPlayer(perCharacter, groups) };
}

function messageOf(err: unknown): string {
  if (err instanceof BungieError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Unknown error';
}
