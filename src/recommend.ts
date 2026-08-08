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

export interface DiversifyOptions {
  /** How many of the same verdict may appear in a row. */
  maxConsecutive?: number;
}

/** Default cap on a run of identical verdicts in the displayed list. */
export const MAX_CONSECUTIVE_KIND = 2;

/**
 * Display order. Keeps the ranking from `recommend` but refuses to show more
 * than `maxConsecutive` of the same verdict in a row, pulling the next
 * different verdict up instead.
 *
 * This is deliberately separate from `recommend`, which stays a strict
 * priority sort. The reason for reordering is that a fireteam runs one thing
 * tonight, so the fourth best sherpa run carries almost no information the
 * first one did not already give, while the best speedrun carries new
 * information. Breaking up runs raises how much the visible part of the list
 * actually tells you. It never changes which activities are recommended or
 * what verdict each one gets, and relative order inside a verdict is
 * preserved, so nothing is reranked on the quiet.
 */
export function diversifyRecommendations(
  recs: Recommendation[],
  options: DiversifyOptions = {}
): Recommendation[] {
  const maxConsecutive = options.maxConsecutive ?? MAX_CONSECUTIVE_KIND;
  if (maxConsecutive < 1 || recs.length === 0) return [...recs];

  const pool = [...recs];
  const out: Recommendation[] = [];
  let lastKind: RecommendationKind | null = null;
  let run = 0;

  while (pool.length > 0) {
    let index = 0;
    if (lastKind !== null && run >= maxConsecutive) {
      const alternative = pool.findIndex((r) => r.kind !== lastKind);
      // If everything left is the same verdict, show it rather than drop it.
      if (alternative !== -1) index = alternative;
    }
    const [picked] = pool.splice(index, 1);
    if (picked.kind === lastKind) run += 1;
    else {
      lastKind = picked.kind;
      run = 1;
    }
    out.push(picked);
  }

  return out;
}

/**
 * Short nouns for the tally line, singular and plural. "Blind run" is already
 * the wording used in the everyone's-first reason, so the tally does not
 * introduce a second name for the same thing.
 */
export const KIND_NOUN: Record<RecommendationKind, [string, string]> = {
  sherpa: ['sherpa run', 'sherpa runs'],
  first: ['blind run', 'blind runs'],
  speedrun: ['speedrun', 'speedruns'],
  rusty: ['rusty run', 'rusty runs'],
  lopsided: ['lopsided run', 'lopsided runs']
};

/** "3 sherpa runs", "1 blind run". */
export function tallyLabel(kind: RecommendationKind, count: number): string {
  const [one, many] = KIND_NOUN[kind];
  return count === 1 ? one : many;
}

/** How many of each verdict were found, in priority order. */
export function tallyKinds(recs: Recommendation[]): [RecommendationKind, number][] {
  const counts = new Map<RecommendationKind, number>();
  for (const rec of recs) counts.set(rec.kind, (counts.get(rec.kind) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => KIND_PRIORITY[a[0]] - KIND_PRIORITY[b[0]]);
}

/**
 * The whole report in one sentence, for somebody who has never seen the site.
 *
 * The matrix answers "who has cleared what", which is a question you have to
 * already care about. This answers "what are we running", which is the question
 * that made anybody open the page. It is deliberately an instruction rather
 * than a statistic: no counts, no percentages, no jargon from the tally line.
 */
export function headline(recs: Recommendation[], playerCount: number): string {
  const top = recs[0];
  if (!top) {
    return 'Nothing stands out for this fireteam, so run whatever you feel like.';
  }
  const who = top.subject ?? 'one of you';
  switch (top.kind) {
    case 'sherpa':
      return 'Run ' + top.activity + ' and get ' + who + ' their first clear.';
    case 'first':
      return (
        'Run ' + top.activity + '. It is new to all ' + playerCount + ' of you, so go in blind.'
      );
    case 'speedrun':
      return 'Run ' + top.activity + '. Everybody knows it, so it should be a quick one.';
    case 'rusty':
      return 'Run ' + top.activity + ', but nobody has run it much, so give it the evening.';
    case 'lopsided':
      return 'Run ' + top.activity + ', and expect ' + who + ' to end up calling it.';
  }
}

/** Shown in the UI so the ordering is not a black box. */
export const RANKING_EXPLANATION =
  'Sherpa runs rank first because carrying one person to their first clear is ' +
  'the best thing a full fireteam can do with an evening. Everyone-first runs ' +
  'come next, then speedruns. Rusty and lopsided are warnings, not suggestions. ' +
  'Where a run of the same verdict would repeat more than twice, the next ' +
  'different verdict is shown instead, so the list does not turn into one note ' +
  'played over and over.';
