/**
 * Cross checks that keep the committed snapshots honest.
 *
 * The fallback table and the demo fixture are both generated, so these tests
 * exist to catch the case where one is regenerated and the other is not.
 */

import { describe, expect, it } from 'vitest';
import { collapseActivities } from '../src/activities';
import { FALLBACK_ACTIVITIES, FALLBACK_MANIFEST_VERSION } from '../src/fallback-activities';
import { diversifyRecommendations, recommend, type MatrixRow } from '../src/recommend';
import type { RawActivityDef } from '../src/types';
import realDefs from '../fixtures/activity-defs.json';
import demo from '../fixtures/demo.json';

const defs = realDefs.definitions as RawActivityDef[];

const demoRows = (): MatrixRow[] =>
  FALLBACK_ACTIVITIES.map((g) => ({
    activity: g.name,
    category: g.category,
    counts: demo.players.map((p) => (p.clears as Record<string, number>)[g.name] ?? 0)
  }));

/** The strict ranking. */
const demoRecs = () => recommend(demoRows(), demo.players.map((p) => p.name));
/** The order actually rendered. */
const demoDisplayed = () => diversifyRecommendations(demoRecs());
const normalise = (groups: typeof FALLBACK_ACTIVITIES) =>
  groups
    .map((g) => ({
      name: g.name,
      category: g.category,
      tiers: [...g.tiers].sort(),
      hashes: [...g.hashes].sort((a, b) => a - b)
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

describe('the committed fallback table', () => {
  it('is exactly what the collapsing rules produce from the real definitions', () => {
    expect(normalise(collapseActivities(defs))).toEqual(normalise(FALLBACK_ACTIVITIES));
  });

  it('was generated from the same manifest version as the definition fixture', () => {
    expect(FALLBACK_MANIFEST_VERSION).toBe(realDefs.manifestVersion);
  });

  it('holds 14 raids, 9 dungeons and 4 Pantheon encounters', () => {
    const counts = FALLBACK_ACTIVITIES.reduce<Record<string, number>>((acc, g) => {
      acc[g.category] = (acc[g.category] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({ raid: 14, dungeon: 9, pantheon: 4 });
  });
});

describe('the demo fixture', () => {
  it('has six players', () => {
    expect(demo.players).toHaveLength(6);
  });

  it('names every player in valid Bungie Name form', () => {
    for (const p of demo.players) {
      expect(p.label).toMatch(/^.+#\d{4}$/);
    }
  });

  it('only mentions activities that exist in the derived catalog', () => {
    const known = new Set(FALLBACK_ACTIVITIES.map((g) => g.name));
    for (const p of demo.players) {
      for (const activity of Object.keys(p.clears)) {
        expect(known.has(activity)).toBe(true);
      }
    }
  });

  it('demonstrates every recommendation kind at least once', () => {
    const kinds = new Set(demoRecs().map((r) => r.kind));
    expect([...kinds].sort()).toEqual(['first', 'lopsided', 'rusty', 'sherpa', 'speedrun']);
  });

  it('leads with a sherpa run', () => {
    expect(demoRecs()[0].kind).toBe('sherpa');
  });
});

/**
 * The demo is the first and often only thing a visitor sees. If it produces one
 * verdict over and over, the engine looks like it can only say one thing. These
 * assert the variety directly, so a fixture edit that makes the list monotonous
 * fails here instead of shipping.
 */
describe('the demo fireteam reads with variety', () => {
  it('shows at least three different verdicts in the first five cards', () => {
    const top = demoDisplayed().slice(0, 5);
    expect(new Set(top.map((r) => r.kind)).size).toBeGreaterThanOrEqual(3);
  });

  it('never repeats one verdict more than twice in a row', () => {
    const kinds = demoDisplayed().map((r) => r.kind);
    let run = 1;
    for (let i = 1; i < kinds.length; i += 1) {
      run = kinds[i] === kinds[i - 1] ? run + 1 : 1;
      expect(run).toBeLessThanOrEqual(2);
    }
  });

  it('names at least three different players across the sherpa runs', () => {
    const subjects = demoRecs()
      .filter((r) => r.kind === 'sherpa')
      .map((r) => r.subject);
    expect(new Set(subjects).size).toBeGreaterThanOrEqual(3);
  });

  it('never names the same player twice in the first five cards', () => {
    const named = demoDisplayed()
      .slice(0, 5)
      .map((r) => r.subject)
      .filter((s): s is string => typeof s === 'string');
    expect(new Set(named).size).toBe(named.length);
  });

  it('fires both warnings, not just the suggestions', () => {
    const kinds = demoRecs().map((r) => r.kind);
    expect(kinds).toContain('rusty');
    expect(kinds).toContain('lopsided');
  });

  it('names different players across the lopsided calls', () => {
    const subjects = demoRecs()
      .filter((r) => r.kind === 'lopsided')
      .map((r) => r.subject);
    expect(new Set(subjects).size).toBe(subjects.length);
  });

  it('keeps the whole list short enough to read in one go', () => {
    // Ten cards is about one screen. A longer list buries the warnings.
    expect(demoRecs().length).toBeLessThanOrEqual(12);
  });

  it('gives no single player more than half the sherpa runs', () => {
    const sherpas = demoRecs().filter((r) => r.kind === 'sherpa');
    const counts = new Map<string, number>();
    for (const r of sherpas) counts.set(r.subject ?? '', (counts.get(r.subject ?? '') ?? 0) + 1);
    for (const n of counts.values()) {
      expect(n).toBeLessThanOrEqual(Math.ceil(sherpas.length / 2));
    }
  });

  it('shows every player as capable, so nobody is a blank sheet', () => {
    for (const p of demo.players) {
      const total = Object.values(p.clears as Record<string, number>).reduce((a, b) => a + b, 0);
      expect(total).toBeGreaterThan(20);
    }
  });

  it('puts a warning somewhere in the displayed list', () => {
    const kinds = demoDisplayed().map((r) => r.kind);
    expect(kinds.some((k) => k === 'rusty' || k === 'lopsided')).toBe(true);
  });
});
