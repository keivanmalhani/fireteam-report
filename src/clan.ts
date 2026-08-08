/**
 * Clans: reading a roster, picking a fireteam out of it, and paying for it.
 *
 * Pure module. No fetch, no DOM, no clock. The calls themselves live in
 * bungie.ts; what is here is every decision those calls need, so the paging,
 * the ordering, the selection cap and the request budget can all be tested
 * without a browser or a network.
 *
 * The reason any of this exists: typing six Bungie Names, hash codes and all,
 * is the thing that stops people using this site. A clan roster is the same six
 * people already spelled correctly.
 */

import type { PlayerRef } from './types';

/** Bungie serves a clan roster 100 entries at a time. */
export const ROSTER_PAGE_SIZE = 100;

/**
 * A safety net, not a limit anyone should hit. Destiny caps a clan at 100
 * members, so a correct roster is one page; this only exists so a server that
 * keeps saying "there is more" cannot spin the loop forever.
 */
export const MAX_ROSTER_PAGES = 5;

/** A fireteam is a raid team. Six, and this is also permalink's MAX_PLAYERS. */
export const FIRETEAM_SIZE = 6;

/** How many players are read at once. See requestBudget for why it is small. */
export const PLAYER_CONCURRENCY = 3;

/** A Destiny account holds at most this many characters. */
export const MAX_CHARACTERS = 3;

/* ------------------------------------------------------------------ */
/* parsing                                                             */
/* ------------------------------------------------------------------ */

export interface ClanSummary {
  groupId: string;
  name: string;
  memberCount: number;
  motto: string;
}

/** Clan member ranks, highest first, as Bungie numbers them. */
export const MEMBER_TYPE_LABEL: Record<number, string> = {
  5: 'Founder',
  4: 'Acting founder',
  3: 'Admin',
  2: 'Member',
  1: 'Beginner'
};

export interface RosterMember {
  ref: PlayerRef;
  /** "Guardian#1234", the same label the rest of the app uses. */
  label: string;
  membershipType: number;
  membershipId: string;
  isOnline: boolean;
  /** Epoch seconds of the last online status change, or 0 when unknown. */
  lastOnline: number;
  memberType: number;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  // Bungie sends lastOnlineStatusChange as a string of digits.
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return 0;
}

/** One clan out of a search result or a group membership entry. */
export function parseClanSummary(raw: unknown): ClanSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const group = raw as Record<string, unknown>;
  const groupId = asString(group.groupId);
  const name = asString(group.name);
  if (!groupId || !name) return null;
  return {
    groupId,
    name,
    memberCount: asNumber(group.memberCount),
    motto: asString(group.motto)
  };
}

/** The GroupV2/User answer, trimmed to what is read. */
export interface MemberClansResponse {
  results?: { group?: unknown }[];
  /** groupId -> true when the player has no active membership left in it. */
  areAllMembershipsInactive?: Record<string, boolean>;
}

/**
 * The clans one player is actually in.
 *
 * Measured on a real cross saved account: GroupV2/User answers with every clan
 * record the account has ever held, and flags the dead ones in
 * areAllMembershipsInactive. Keeping those would turn the one-click
 * "Use my clan" into a choice between a clan and the ghost of one, so only the
 * active records survive. A record the flag map does not mention is kept,
 * because dropping somebody's only clan on a missing field is the worse error.
 */
export function parseMemberClans(raw: unknown): ClanSummary[] {
  if (!raw || typeof raw !== 'object') return [];
  const response = raw as MemberClansResponse;
  const inactive = response.areAllMembershipsInactive ?? {};
  return (response.results ?? [])
    .map((entry) => parseClanSummary(entry?.group))
    .filter((c): c is ClanSummary => c !== null && inactive[c.groupId] !== true);
}

/**
 * One roster entry.
 *
 * Returns null rather than a half filled member when there is no Destiny
 * membership on the entry. A clan can hold a bungie.net account that never
 * played, and there is nothing to look up for one of those, so it is better
 * left out of the picker than shown as a row that always fails.
 */
export function parseRosterMember(raw: unknown): RosterMember | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as Record<string, unknown>;
  const info = entry.destinyUserInfo;
  if (!info || typeof info !== 'object') return null;
  const user = info as Record<string, unknown>;

  const membershipId = asString(user.membershipId);
  const membershipType = asNumber(user.membershipType);
  if (!membershipId || membershipType <= 0) return null;

  const name =
    asString(user.bungieGlobalDisplayName) ||
    asString(user.displayName) ||
    asString(user.LastSeenDisplayName);
  if (!name) return null;

  return {
    ref: { name, code: asNumber(user.bungieGlobalDisplayNameCode) },
    label: name + '#' + String(asNumber(user.bungieGlobalDisplayNameCode)).padStart(4, '0'),
    membershipType,
    membershipId,
    isOnline: entry.isOnline === true,
    lastOnline: asNumber(entry.lastOnlineStatusChange),
    memberType: asNumber(entry.memberType)
  };
}

/* ------------------------------------------------------------------ */
/* paging                                                              */
/* ------------------------------------------------------------------ */

export interface PageProgress {
  /** The 1-based page just fetched. Bungie's `currentpage` starts at 1. */
  page: number;
  /** How many entries that page returned, before any parsing dropped some. */
  received: number;
  /** Bungie's own flag. */
  hasMore: boolean;
  /** The total the server claims, when it gives one. */
  totalResults?: number;
  /**
   * Every entry the pages so far returned, counted before parsing drops any.
   * It is compared against totalResults, and totalResults counts that way.
   */
  collected: number;
}

/**
 * The next page to fetch, or null when the roster is complete.
 *
 * `hasMore` is the flag to believe first, but it is not the only signal: a
 * server that filled the page and still claims a bigger total is telling us
 * there is more whatever the flag says. Believing the flag alone is how a big
 * clan silently shows only its first page, which is the failure this function
 * exists to prevent.
 *
 * An empty page ends the walk regardless. Whatever else is true, there is
 * nothing further to merge and another request would only spend rate limit.
 */
export function nextRosterPage(
  progress: PageProgress,
  maxPages = MAX_ROSTER_PAGES
): number | null {
  if (progress.received <= 0) return null;
  if (progress.page >= maxPages) return null;
  if (progress.hasMore) return progress.page + 1;
  const total = progress.totalResults;
  if (typeof total === 'number' && total > progress.collected) return progress.page + 1;
  return null;
}

/* ------------------------------------------------------------------ */
/* ordering and selection                                              */
/* ------------------------------------------------------------------ */

/**
 * Roster order: online first, then most recently seen, then alphabetically.
 *
 * Who is online right now is the only ordering that matches the question being
 * asked, which is "who is around tonight". Alphabetical would bury them.
 */
export function sortRoster(members: RosterMember[]): RosterMember[] {
  return [...members].sort(
    (a, b) =>
      Number(b.isOnline) - Number(a.isOnline) ||
      b.lastOnline - a.lastOnline ||
      a.label.localeCompare(b.label)
  );
}

/**
 * The selection the picker opens with.
 *
 * A clan is up to a hundred people and this site compares a fireteam, so the
 * roster is a picker rather than a bulk load. Preselecting the top of the
 * sorted roster means the common case, "the people who are on right now", is
 * one click away, and everything else is a few checkboxes.
 */
export function defaultSelection(
  members: RosterMember[],
  size = FIRETEAM_SIZE
): string[] {
  return sortRoster(members)
    .slice(0, Math.max(0, size))
    .map((m) => m.membershipId);
}

/**
 * Check or uncheck one member, refusing to go over the cap.
 *
 * Returning the same array identity when nothing changed lets the caller tell
 * a no-op from a change, which is what makes the "six is the most" message
 * appear only when somebody actually tried to add a seventh.
 */
export function toggleSelected(
  selected: readonly string[],
  membershipId: string,
  max = FIRETEAM_SIZE
): string[] {
  const index = selected.indexOf(membershipId);
  if (index !== -1) return selected.filter((id) => id !== membershipId);
  if (selected.length >= max) return [...selected];
  return [...selected, membershipId];
}

/** The chosen members, in roster order rather than click order. */
export function selectedMembers(
  members: RosterMember[],
  selected: readonly string[]
): RosterMember[] {
  const wanted = new Set(selected);
  return sortRoster(members).filter((m) => wanted.has(m.membershipId));
}

/* ------------------------------------------------------------------ */
/* what it costs                                                       */
/* ------------------------------------------------------------------ */

export interface RequestBudget {
  min: number;
  max: number;
}

/**
 * How many requests reading N players actually costs.
 *
 * One profile call finds the characters, then one aggregate stats call per
 * character, and an account holds up to three. So a player is two requests at
 * best and four at worst, and there is no endpoint that batches it.
 *
 * This number is shown to the reader before the button is pressed, because the
 * API key is the site's and therefore shared by every visitor: a rate limit
 * spent here is spent on somebody else's report too. It is also why the picker
 * caps at a fireteam instead of offering to read a hundred people.
 */
export function requestBudget(playerCount: number): RequestBudget {
  const players = Math.max(0, Math.floor(playerCount));
  return { min: players * 2, max: players * (1 + MAX_CHARACTERS) };
}

/** "about 12 to 24 requests", or the exact number when there is no range. */
export function describeBudget(playerCount: number): string {
  const { min, max } = requestBudget(playerCount);
  if (max === 0) return 'no requests';
  if (min === max) return min + ' requests';
  return 'about ' + min + ' to ' + max + ' requests';
}

/** "Read 3 of 6 players..." Pinned down here so a test can read it. */
export function progressLabel(done: number, total: number): string {
  const clamped = Math.min(Math.max(0, Math.floor(done)), Math.max(0, Math.floor(total)));
  if (total <= 0) return 'Reading players...';
  if (clamped >= total) return 'Finishing up...';
  return 'Read ' + clamped + ' of ' + total + ' players...';
}

/* ------------------------------------------------------------------ */
/* running the fan out                                                 */
/* ------------------------------------------------------------------ */

export type Settled<R> = { ok: true; value: R } | { ok: false; error: unknown };

/**
 * Run a worker over every item, at most `limit` at a time, and never reject.
 *
 * Two properties matter and both are tested. Results come back in input order,
 * so a fireteam does not reshuffle itself depending on whose profile answered
 * first. And one failure cannot take the batch down: a private profile is
 * common, and losing five good players because the sixth would not answer is
 * the wrong trade. Failures come back as entries, not as a rejection.
 *
 * The limit is what keeps a six player read from arriving at bungie.net as six
 * simultaneous bursts of up to four requests each.
 */
export async function mapSettledWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  onSettled?: (done: number, total: number) => void
): Promise<Settled<R>[]> {
  const total = items.length;
  const out: Settled<R>[] = new Array(total);
  if (total === 0) return out;

  const width = Math.max(1, Math.floor(limit));
  let next = 0;
  let done = 0;

  async function run(): Promise<void> {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= total) return;
      try {
        out[index] = { ok: true, value: await worker(items[index], index) };
      } catch (error) {
        out[index] = { ok: false, error };
      }
      done += 1;
      onSettled?.(done, total);
    }
  }

  await Promise.all(Array.from({ length: Math.min(width, total) }, run));
  return out;
}
