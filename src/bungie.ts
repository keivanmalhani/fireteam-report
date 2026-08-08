/**
 * Bungie API client.
 *
 * This is the only module that talks to the network on a player's behalf. Every
 * call carries the application's own API key, which ships in the built
 * JavaScript on purpose: a browser has to send one with every request, so there
 * is nowhere to put it that a reader cannot reach. Nobody is asked to create
 * one. See src/auth.ts for the whole of that argument.
 *
 * Everything here is public reading. Signing in adds an access token, and the
 * only calls that use it live in signin.ts, because none of the stats endpoints
 * below need one.
 */

import { API_KEY, API_ROOT } from './auth';
import { clearsForPlayer, type AggregateActivitiesResponse } from './aggregate';
import { formatBungieName } from './bungiename';
import {
  MAX_ROSTER_PAGES,
  nextRosterPage,
  parseClanSummary,
  parseMemberClans,
  parseRosterMember,
  sortRoster,
  type ClanSummary,
  type RosterMember
} from './clan';
import type { ActivityGroup, PlayerRef, PlayerStats } from './types';

export { API_ROOT };

/** The only thing this app keeps in localStorage. */
export const STORAGE_KEY_MANIFEST = 'fireteam-report.manifest';

/** Bungie platform error codes worth naming. */
export const ERR_SUCCESS = 1;
export const ERR_SYSTEM_DISABLED = 5;
export const ERR_API_KEY_MISSING = 2102;
export const ERR_PRIVACY = 1665;
export const ERR_ACCOUNT_NOT_FOUND = 1601;
export const ERR_GROUP_NOT_FOUND = 622;
export const ERR_THROTTLED_BY_GAME_SERVER = 1672;

/**
 * The codes that mean the signed-in hour is over rather than something being
 * wrong. Bungie issues no refresh token to a public client, so there is nothing
 * to do about any of these except sign in again, and in particular there is
 * nothing to gain by retrying one.
 */
export const AUTH_EXPIRY_CODES: ReadonlySet<number> = new Set([
  99, // WebAuthRequired
  2111, // AccessTokenHasExpired
  2123, // AuthorizationRecordExpired
  2124 // AuthorizationRecordRevoked
]);

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
/* transport                                                           */
/* ------------------------------------------------------------------ */

interface PlatformResponse<T> {
  Response?: T;
  ErrorCode?: number;
  ErrorStatus?: string;
  Message?: string;
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  /** Extra attempts after the first. Zero for anything in a per player fan out. */
  retries?: number;
  /** Hard deadline. A hung request would otherwise leave the UI spinning. */
  timeoutMs?: number;
}

/** Default deadline for a per player call. */
export const REQUEST_TIMEOUT_MS = 15000;

/**
 * Whether a failure is worth trying again, decided on the platform error code
 * and not on the HTTP status.
 *
 * This distinction is the whole point of the function. Bungie answers ordinary
 * application errors with HTTP 500 and a real ErrorCode in the body: a private
 * account, a clan that does not exist and an expired token all arrive as 500.
 * A predicate that branches on `status >= 500` therefore retries every one of
 * them, which turns one refusal into four, four times the rate limit spent, and
 * a four times longer wait before the page says the same thing it could have
 * said immediately. guardian-timeline shipped exactly that bug.
 *
 * So: when Bungie gave us a code, the code decides. Only a failure with no code
 * at all is a real transport or gateway problem, and those are the ones the
 * status is allowed to speak for.
 */
export function isRetriable(code: number, status: number): boolean {
  if (AUTH_EXPIRY_CODES.has(code)) return false;
  if (code > ERR_SUCCESS) {
    return (
      code === ERR_API_KEY_MISSING || // seen spuriously on healthy keyless calls
      code === ERR_SYSTEM_DISABLED ||
      code === ERR_THROTTLED_BY_GAME_SERVER ||
      (code >= 31 && code <= 57) // the throttling family
    );
  }
  return status >= 500 || status === 0;
}

async function platformFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, retries = 0, timeoutMs = REQUEST_TIMEOUT_MS } = options;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-API-Key': API_KEY
  };
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

      const message = payload?.Message ?? payload?.ErrorStatus ?? 'HTTP ' + response.status;
      const error = new BungieError(message, code, response.status);
      if (attempt === retries || !isRetriable(code, response.status)) throw error;
      lastError = error;
    } catch (err) {
      const wrapped =
        err instanceof Error && err.name === 'AbortError'
          ? new BungieError('bungie.net did not answer in time.', 0, 0)
          : err;
      // A BungieError has already been through isRetriable above; anything else
      // is a thrown fetch, which is exactly what the loop is for.
      if (attempt === retries || wrapped instanceof BungieError) throw wrapped;
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
export async function searchPlayer(ref: PlayerRef): Promise<UserInfoCard | null> {
  const results = await platformFetch<UserInfoCard[]>(
    '/Destiny2/SearchDestinyPlayerByBungieName/-1/',
    {
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
  membershipType: number,
  membershipId: string
): Promise<string[]> {
  const profile = await platformFetch<ProfileCharacters>(
    '/Destiny2/' + membershipType + '/Profile/' + membershipId + '/?components=200'
  );
  const data = profile?.characters?.data;
  if (!data || typeof data !== 'object') return [];
  return Object.keys(data);
}

export async function getAggregateActivityStats(
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
      '/Stats/AggregateActivityStats/'
  );
}

/* ------------------------------------------------------------------ */
/* clans                                                               */
/* ------------------------------------------------------------------ */

interface SearchGroupsResponse {
  results?: unknown[];
  totalResults?: number;
  hasMore?: boolean;
}

interface GroupMembersResponse {
  results?: unknown[];
  totalResults?: number;
  hasMore?: boolean;
}

/**
 * Clans matching a name.
 *
 * Measured, so it is worth writing down: Bungie matches the whole name, not a
 * prefix and not a substring. Capitalisation and surrounding spaces are
 * forgiven, everything else is not, so "Math Clas" finds nothing at all. The UI
 * has to say so or people will assume the site is broken.
 *
 * These calls are one-shot and a transient failure kills the whole flow, so
 * unlike the per player fan out they are allowed a couple of retries.
 */
export async function searchClans(name: string): Promise<ClanSummary[]> {
  const response = await platformFetch<SearchGroupsResponse>('/GroupV2/Search/', {
    method: 'POST',
    body: { name: name.trim(), groupType: 1, creationDate: 0, sortBy: 0, page: 0 },
    retries: 2
  });
  return (response?.results ?? [])
    .map(parseClanSummary)
    .filter((c): c is ClanSummary => c !== null);
}

/**
 * The clans one player belongs to. Needs no token, only the app key.
 * parseMemberClans drops the dead records, so one real clan arrives as one
 * clan and the panel can go straight to its roster.
 */
export async function clansForPlayer(
  membershipType: number,
  membershipId: string
): Promise<ClanSummary[]> {
  const response = await platformFetch<unknown>(
    '/GroupV2/User/' + membershipType + '/' + membershipId + '/0/1/',
    { retries: 2 }
  );
  return parseMemberClans(response);
}

/**
 * The whole roster, following Bungie's paging rather than assuming one page.
 *
 * `currentpage` is 1-based. A Destiny clan caps at 100 and a page holds 100, so
 * today this almost always makes exactly one request, but "almost always" is
 * not a reason to truncate the one clan where it does not hold. nextRosterPage
 * owns the decision and is tested on its own.
 */
export async function fetchClanRoster(
  groupId: string,
  onPage?: (collected: number, total: number) => void
): Promise<RosterMember[]> {
  const members: RosterMember[] = [];
  const seen = new Set<string>();
  // Counted in raw entries, not parsed members. Bungie's totalResults counts
  // every entry, including the bungie.net-only accounts parseRosterMember
  // drops, so the walk has to count the same way or a roster holding one of
  // those ends by asking for one more page that is always empty.
  let rawSeen = 0;
  let page: number | null = 1;

  while (page !== null) {
    const response: GroupMembersResponse = await platformFetch<GroupMembersResponse>(
      '/GroupV2/' + groupId + '/Members/?currentpage=' + page,
      { retries: 2 }
    );
    const raw = response?.results ?? [];
    rawSeen += raw.length;
    for (const entry of raw) {
      const member = parseRosterMember(entry);
      if (!member || seen.has(member.membershipId)) continue;
      seen.add(member.membershipId);
      members.push(member);
    }
    onPage?.(members.length, response?.totalResults ?? members.length);
    page = nextRosterPage(
      {
        page,
        received: raw.length,
        hasMore: response?.hasMore === true,
        totalResults: response?.totalResults,
        collected: rawSeen
      },
      MAX_ROSTER_PAGES
    );
  }

  return sortRoster(members);
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
  ref: PlayerRef,
  groups: ActivityGroup[]
): Promise<PlayerStats> {
  const base: PlayerStats = { ref, label: formatBungieName(ref), clears: {} };

  let card: UserInfoCard | null;
  try {
    card = await searchPlayer(ref);
  } catch (err) {
    return { ...base, problem: 'error', problemDetail: messageOf(err) };
  }
  if (!card) {
    return {
      ...base,
      problem: 'not-found',
      problemDetail: 'No Destiny account with that Bungie Name.'
    };
  }
  return statsForMembership(base, card.membershipType, card.membershipId, groups);
}

/**
 * The same lookup for somebody who arrived off a clan roster.
 *
 * The roster already carries the membership, so the name search is skipped.
 * That is one saved request per player, which on a six person fireteam is a
 * whole player's worth of the shared rate limit.
 */
export async function fetchPlayerStatsByMembership(
  ref: PlayerRef,
  membershipType: number,
  membershipId: string,
  groups: ActivityGroup[]
): Promise<PlayerStats> {
  const base: PlayerStats = { ref, label: formatBungieName(ref), clears: {} };
  return statsForMembership(base, membershipType, membershipId, groups);
}

async function statsForMembership(
  base: PlayerStats,
  membershipType: number,
  membershipId: string,
  groups: ActivityGroup[]
): Promise<PlayerStats> {
  const found: PlayerStats = { ...base, membershipType, membershipId };

  let characterIds: string[];
  try {
    characterIds = await getCharacterIds(membershipType, membershipId);
  } catch (err) {
    if (err instanceof BungieError && err.code === ERR_PRIVACY) {
      return {
        ...found,
        problem: 'private',
        problemDetail: 'This player keeps their stats private.'
      };
    }
    return { ...found, problem: 'error', problemDetail: messageOf(err) };
  }

  if (characterIds.length === 0) {
    return {
      ...found,
      problem: 'private',
      problemDetail: 'No characters visible, so the account is private.'
    };
  }

  const perCharacter: AggregateActivitiesResponse[] = [];
  let privacyHits = 0;
  for (const characterId of characterIds) {
    try {
      perCharacter.push(
        await getAggregateActivityStats(membershipType, membershipId, characterId)
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
