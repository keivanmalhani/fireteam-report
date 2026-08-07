/**
 * The recommendation engine.
 *
 * Pure module. Takes a matrix of clear counts and returns a ranked list of
 * things the fireteam could run tonight, each with a one sentence reason.
 * No network, no DOM, no clock, so the ranking is fully reproducible.
 *
 * The ranking is a judgement about the evening, not about the numbers:
 * carrying one person through their first clear is the best use of a fireteam,
 * a blind run for everyone is the next best, and a fast clean run is third.
 */

import type { ActivityCategory } from './types';

export type RecommendationKind = 'sherpa' | 'first' | 'speedrun' | 'rusty' | 'lopsided';

/** One activity's clear counts, aligned index for index with the player list. */
export interface MatrixRow {
  activity: string;
  category: ActivityCategory;
  counts: number[];
}

export interface Recommendation {
  activity: string;
  category: ActivityCategory;
  /** The highest ranked rule that matched. */
  kind: RecommendationKind;
  /** Every rule that matched, highest ranked first. */
  flags: RecommendationKind[];
  /** One sentence, ready to render. */
  reason: string;
  /** The player the reason is about, for sherpa and lopsided. */
  subject?: string;
  /** Higher sorts first. Deterministic. */
  score: number;
}

/** Rule order. Lower is better. This is the whole opinion of the tool. */
export const KIND_PRIORITY: Record<RecommendationKind, number> = {
  sherpa: 0,
  first: 1,
  speedrun: 2,
  rusty: 3,
  lopsided: 4
};

export const KIND_LABEL: Record<RecommendationKind, string> = {
  sherpa: 'Sherpa run',
  first: "Everyone's first",
  speedrun: 'Speedrun',
  rusty: 'Rusty',
  lopsided: 'Lopsided'
};

/** A player needs this many clears before the activity counts as routine. */
export const SPEEDRUN_MIN_CLEARS = 5;
/** Everyone has cleared it, but fewer than this many runs each on average. */
export const RUSTY_MAX_AVERAGE = 2;

const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);

/** Exactly one player has never cleared it and every other player has. */
export function isSherpa(counts: number[]): boolean {
  if (counts.length < 2) return false;
  const zeros = counts.filter((c) => c === 0).length;
  if (zeros !== 1) return false;
  return counts.every((c) => c === 0 || c >= 1);
}

/** Nobody in the fireteam has cleared it. */
export function isEveryonesFirst(counts: number[]): boolean {
  return counts.length > 0 && counts.every((c) => c === 0);
}

/** Every player is comfortably familiar with it. */
export function isSpeedrun(counts: number[]): boolean {
  return counts.length > 0 && counts.every((c) => c >= SPEEDRUN_MIN_CLEARS);
}

/** Everyone has cleared it, but not many times between them. */
export function isRusty(counts: number[]): boolean {
  if (counts.length === 0) return false;
  if (!counts.every((c) => c >= 1)) return false;
  if (isSpeedrun(counts)) return false;
  return sum(counts) < RUSTY_MAX_AVERAGE * counts.length;
}

/** One player has more clears than everyone else put together. */
export function isLopsided(counts: number[]): boolean {
  if (counts.length < 2) return false;
  const total = sum(counts);
  if (total === 0) return false;
  const top = Math.max(...counts);
  // Strictly greater, and only when a single player holds that top count.
  if (counts.filter((c) => c === top).length > 1) return false;
  return top > total - top;
}

const RULES: { kind: RecommendationKind; test: (counts: number[]) => boolean }[] = [
  { kind: 'sherpa', test: isSherpa },
  { kind: 'first', test: isEveryonesFirst },
  { kind: 'speedrun', test: isSpeedrun },
  { kind: 'rusty', test: isRusty },
  { kind: 'lopsided', test: isLopsided }
];

const plural = (n: number, one: string, many: string): string =>
  n === 1 ? one : many;

function reasonFor(
  kind: RecommendationKind,
  row: MatrixRow,
  players: string[]
): { reason: string; subject?: string } {
  const counts = row.counts;
  const total = sum(counts);

  switch (kind) {
    case 'sherpa': {
      const i = counts.findIndex((c) => c === 0);
      const subject = players[i] ?? 'One player';
      const others = counts.length - 1;
      return {
        subject,
        reason:
          subject +
          ' is the only one without a clear, and the other ' +
          others +
          ' have ' +
          total +
          ' between them to carry it.'
      };
    }
    case 'first':
      return {
        reason:
          'Nobody here has cleared it, so it is a blind run for all ' +
          counts.length +
          ' of you.'
      };
    case 'speedrun':
      return {
        reason:
          'Everyone has at least ' +
          SPEEDRUN_MIN_CLEARS +
          ' clears, ' +
          total +
          ' in total, so expect a fast one.'
      };
    case 'rusty':
      return {
        reason:
          'Everyone has cleared it, but only ' +
          total +
          ' ' +
          plural(total, 'run', 'runs') +
          ' between ' +
          counts.length +
          ' of you, so expect it to be slow.'
      };
    case 'lopsided': {
      const top = Math.max(...counts);
      const i = counts.indexOf(top);
      const subject = players[i] ?? 'One player';
      return {
        subject,
        reason:
          subject +
          ' has ' +
          top +
          ' clears against ' +
          (total - top) +
          ' for everyone else combined, so expect them to call it.'
      };
    }
  }
}

/**
 * Tiebreak inside a rule, so two sherpa runs are ordered by how much support
 * the newcomer actually has. Larger sorts first.
 */
function tiebreak(kind: RecommendationKind, counts: number[]): number {
  const total = sum(counts);
  switch (kind) {
    case 'sherpa':
      return total;
    case 'first':
      return 0;
    case 'speedrun':
      return total;
    case 'rusty':
      return -total;
    case 'lopsided':
      return Math.max(...counts, 0);
  }
}

export interface RecommendOptions {
  /** Cap the returned list. Omit for everything that matched. */
  limit?: number;
}

/**
 * Ranks the fireteam's options. Each activity contributes at most one
 * recommendation, keyed on the highest ranked rule it matched, with the other
 * matches kept in `flags` so nothing is silently dropped.
 */
export function recommend(
  rows: MatrixRow[],
  players: string[],
  options: RecommendOptions = {}
): Recommendation[] {
  const out: Recommendation[] = [];

  for (const row of rows) {
    if (!Array.isArray(row.counts) || row.counts.length === 0) continue;
    if (row.counts.length !== players.length) continue;

    const flags = RULES.filter((r) => r.test(row.counts)).map((r) => r.kind);
    if (flags.length === 0) continue;

    const kind = flags[0];
    const { reason, subject } = reasonFor(kind, row, players);
    out.push({
      activity: row.activity,
      category: row.category,
      kind,
      flags,
      reason,
      ...(subject ? { subject } : {}),
      score: tiebreak(kind, row.counts)
    });
  }

  out.sort(
    (a, b) =>
      KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind] ||
      b.score - a.score ||
      a.activity.localeCompare(b.activity)
  );

  return typeof options.limit === 'number' ? out.slice(0, options.limit) : out;
}

/** Shown in the UI so the ordering is not a black box. */
export const RANKING_EXPLANATION =
  'Sherpa runs rank first because carrying one person to their first clear is ' +
  'the best thing a full fireteam can do with an evening. Everyone-first runs ' +
  'come next, then speedruns. Rusty and lopsided are warnings, not suggestions.';
