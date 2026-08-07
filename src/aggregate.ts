/**
 * Folding Bungie's per character stats into one number per activity.
 *
 * Pure module. A Destiny account has up to three characters and Bungie reports
 * aggregate activity stats per character, so a player's real clear count for a
 * raid is the sum across all of their characters. Getting this wrong is the
 * single most common way a Destiny stats page shows the wrong number.
 */

import type { ActivityGroup } from './types';

/** The slice of AggregateActivityStats we read. */
export interface AggregateActivityEntry {
  activityHash?: number;
  values?: Record<string, { basic?: { value?: number } }>;
}

export interface AggregateActivitiesResponse {
  activities?: AggregateActivityEntry[];
}

/**
 * Stat keys that mean "this activity was completed", best first.
 * activityCompletions is the count Raid Report style tools use.
 */
export const CLEAR_STAT_KEYS = ['activityCompletions', 'activityCleared'] as const;

/** Reads the clear count out of one activity entry. */
export function readClearCount(entry: AggregateActivityEntry): number {
  const values = entry?.values;
  if (!values) return 0;
  for (const key of CLEAR_STAT_KEYS) {
    const raw = values[key]?.basic?.value;
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
      // Bungie reports these as floats.
      return Math.round(raw);
    }
  }
  return 0;
}

/**
 * Sums one player's activity clears across every character they own.
 * Returns hash -> total clears, with zero entries omitted.
 */
export function sumAggregateActivities(
  perCharacter: AggregateActivitiesResponse[]
): Map<number, number> {
  const totals = new Map<number, number>();
  for (const response of perCharacter) {
    const activities = response?.activities;
    if (!Array.isArray(activities)) continue;
    for (const entry of activities) {
      const hash = entry?.activityHash;
      if (typeof hash !== 'number' || !Number.isFinite(hash)) continue;
      const count = readClearCount(entry);
      if (count <= 0) continue;
      totals.set(hash, (totals.get(hash) ?? 0) + count);
    }
  }
  return totals;
}

/**
 * Rolls per hash totals up into per activity totals, so every difficulty of a
 * raid adds into the one row the matrix shows.
 */
export function rollUpToGroups(
  hashTotals: Map<number, number>,
  groups: ActivityGroup[]
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const group of groups) {
    let total = 0;
    for (const hash of group.hashes) total += hashTotals.get(hash) ?? 0;
    out[group.name] = total;
  }
  return out;
}

/** Convenience: characters straight through to per activity clears. */
export function clearsForPlayer(
  perCharacter: AggregateActivitiesResponse[],
  groups: ActivityGroup[]
): Record<string, number> {
  return rollUpToGroups(sumAggregateActivities(perCharacter), groups);
}

export interface PlayerSummary {
  raidClears: number;
  dungeonClears: number;
  pantheonClears: number;
  distinctRaids: number;
  totalRaids: number;
  distinctDungeons: number;
  totalDungeons: number;
  mostRun: { activity: string; count: number } | null;
}

/** Per player headline numbers shown under their column. */
export function summarisePlayer(
  clears: Record<string, number>,
  groups: ActivityGroup[]
): PlayerSummary {
  let raidClears = 0;
  let dungeonClears = 0;
  let pantheonClears = 0;
  let distinctRaids = 0;
  let distinctDungeons = 0;
  let totalRaids = 0;
  let totalDungeons = 0;
  let mostRun: { activity: string; count: number } | null = null;

  for (const group of groups) {
    const count = clears[group.name] ?? 0;
    if (group.category === 'raid') {
      totalRaids += 1;
      raidClears += count;
      if (count > 0) distinctRaids += 1;
    } else if (group.category === 'dungeon') {
      totalDungeons += 1;
      dungeonClears += count;
      if (count > 0) distinctDungeons += 1;
    } else {
      pantheonClears += count;
    }
    if (count > 0 && (!mostRun || count > mostRun.count)) {
      mostRun = { activity: group.name, count };
    }
  }

  return {
    raidClears,
    dungeonClears,
    pantheonClears,
    distinctRaids,
    totalRaids,
    distinctDungeons,
    totalDungeons,
    mostRun
  };
}
