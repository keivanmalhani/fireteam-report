/**
 * Cross checks that keep the committed snapshots honest.
 *
 * The fallback table and the demo fixture are both generated, so these tests
 * exist to catch the case where one is regenerated and the other is not.
 */

import { describe, expect, it } from 'vitest';
import { collapseActivities } from '../src/activities';
import { FALLBACK_ACTIVITIES, FALLBACK_MANIFEST_VERSION } from '../src/fallback-activities';
import { recommend, type MatrixRow } from '../src/recommend';
import type { RawActivityDef } from '../src/types';
import realDefs from '../fixtures/activity-defs.json';
import demo from '../fixtures/demo.json';

const defs = realDefs.definitions as RawActivityDef[];
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
    const names = demo.players.map((p) => p.name);
    const rows: MatrixRow[] = FALLBACK_ACTIVITIES.map((g) => ({
      activity: g.name,
      category: g.category,
      counts: demo.players.map((p) => (p.clears as Record<string, number>)[g.name] ?? 0)
    }));
    const kinds = new Set(recommend(rows, names).map((r) => r.kind));
    expect([...kinds].sort()).toEqual(['first', 'lopsided', 'rusty', 'sherpa', 'speedrun']);
  });

  it('leads with a sherpa run', () => {
    const names = demo.players.map((p) => p.name);
    const rows: MatrixRow[] = FALLBACK_ACTIVITIES.map((g) => ({
      activity: g.name,
      category: g.category,
      counts: demo.players.map((p) => (p.clears as Record<string, number>)[g.name] ?? 0)
    }));
    expect(recommend(rows, names)[0].kind).toBe('sherpa');
  });
});
