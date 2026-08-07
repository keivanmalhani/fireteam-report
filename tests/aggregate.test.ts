import { describe, expect, it } from 'vitest';
import {
  clearsForPlayer,
  readClearCount,
  rollUpToGroups,
  sumAggregateActivities,
  summarisePlayer,
  type AggregateActivitiesResponse
} from '../src/aggregate';
import type { ActivityGroup } from '../src/types';

/** Bungie reports one of these per character. */
const character = (entries: [number, number][]): AggregateActivitiesResponse => ({
  activities: entries.map(([activityHash, value]) => ({
    activityHash,
    values: { activityCompletions: { basic: { value } } }
  }))
});

const GROUPS: ActivityGroup[] = [
  { name: 'Vault of Glass', category: 'raid', tiers: ['Standard', 'Master'], hashes: [100, 101] },
  { name: 'Last Wish', category: 'raid', tiers: ['Standard'], hashes: [200] },
  { name: 'Duality', category: 'dungeon', tiers: ['Standard', 'Master'], hashes: [300, 301] },
  { name: 'Prophecy', category: 'dungeon', tiers: ['Standard'], hashes: [400] }
];

describe('readClearCount', () => {
  it('reads activityCompletions', () => {
    expect(readClearCount({ values: { activityCompletions: { basic: { value: 12 } } } })).toBe(12);
  });

  it('falls back to activityCleared', () => {
    expect(readClearCount({ values: { activityCleared: { basic: { value: 3 } } } })).toBe(3);
  });

  it('prefers activityCompletions over activityCleared', () => {
    expect(
      readClearCount({
        values: {
          activityCompletions: { basic: { value: 9 } },
          activityCleared: { basic: { value: 2 } }
        }
      })
    ).toBe(9);
  });

  it('rounds the floats Bungie sends', () => {
    expect(readClearCount({ values: { activityCompletions: { basic: { value: 7.0 } } } })).toBe(7);
  });

  it('returns zero when the entry has no values', () => {
    expect(readClearCount({})).toBe(0);
    expect(readClearCount({ values: {} })).toBe(0);
    expect(readClearCount({ values: { activityCompletions: {} } })).toBe(0);
  });
});

describe('summing across characters', () => {
  it('adds one activity up across three characters', () => {
    // A Destiny account can hold three characters. Missing this sum is the
    // classic way to under-report someone's raid clears.
    const totals = sumAggregateActivities([
      character([[100, 5]]),
      character([[100, 3]]),
      character([[100, 4]])
    ]);
    expect(totals.get(100)).toBe(12);
  });

  it('adds several activities across three characters at once', () => {
    const totals = sumAggregateActivities([
      character([
        [100, 5],
        [200, 1]
      ]),
      character([
        [100, 3],
        [300, 2]
      ]),
      character([
        [200, 6],
        [300, 1]
      ])
    ]);
    expect(totals.get(100)).toBe(8);
    expect(totals.get(200)).toBe(7);
    expect(totals.get(300)).toBe(3);
  });

  it('handles a character with nothing recorded', () => {
    const totals = sumAggregateActivities([character([[100, 5]]), { activities: [] }, character([[100, 2]])]);
    expect(totals.get(100)).toBe(7);
  });

  it('ignores a response with no activities array', () => {
    const totals = sumAggregateActivities([character([[100, 5]]), {}]);
    expect(totals.get(100)).toBe(5);
  });

  it('omits activities nobody has cleared', () => {
    const totals = sumAggregateActivities([character([[100, 0]])]);
    expect(totals.has(100)).toBe(false);
  });

  it('ignores entries with no activity hash', () => {
    const totals = sumAggregateActivities([
      { activities: [{ values: { activityCompletions: { basic: { value: 4 } } } }] }
    ]);
    expect(totals.size).toBe(0);
  });

  it('returns nothing for an account with no characters', () => {
    expect(sumAggregateActivities([]).size).toBe(0);
  });
});

describe('rollUpToGroups', () => {
  it('folds every difficulty of one raid into a single number', () => {
    const totals = new Map([
      [100, 6],
      [101, 4]
    ]);
    expect(rollUpToGroups(totals, GROUPS)['Vault of Glass']).toBe(10);
  });

  it('reports zero for an activity the player has never run', () => {
    expect(rollUpToGroups(new Map(), GROUPS)['Prophecy']).toBe(0);
  });

  it('covers every group in the catalog', () => {
    expect(Object.keys(rollUpToGroups(new Map(), GROUPS)).sort()).toEqual(
      GROUPS.map((g) => g.name).sort()
    );
  });
});

describe('clearsForPlayer', () => {
  it('goes from three characters straight to per activity clears', () => {
    const clears = clearsForPlayer(
      [
        character([
          [100, 4],
          [101, 1],
          [300, 2]
        ]),
        character([
          [100, 3],
          [200, 5]
        ]),
        character([
          [101, 2],
          [400, 1]
        ])
      ],
      GROUPS
    );
    expect(clears).toEqual({
      'Vault of Glass': 10,
      'Last Wish': 5,
      Duality: 2,
      Prophecy: 1
    });
  });
});

describe('summarisePlayer', () => {
  it('splits raid and dungeon totals', () => {
    const s = summarisePlayer({ 'Vault of Glass': 10, 'Last Wish': 5, Duality: 2 }, GROUPS);
    expect(s.raidClears).toBe(15);
    expect(s.dungeonClears).toBe(2);
  });

  it('counts distinct activities out of the number that exist', () => {
    const s = summarisePlayer({ 'Vault of Glass': 10, Duality: 2 }, GROUPS);
    expect(s.distinctRaids).toBe(1);
    expect(s.totalRaids).toBe(2);
    expect(s.distinctDungeons).toBe(1);
    expect(s.totalDungeons).toBe(2);
  });

  it('finds the activity the player has run most', () => {
    const s = summarisePlayer({ 'Vault of Glass': 10, 'Last Wish': 5, Prophecy: 21 }, GROUPS);
    expect(s.mostRun).toEqual({ activity: 'Prophecy', count: 21 });
  });

  it('reports no favourite for a player with no clears', () => {
    const s = summarisePlayer({}, GROUPS);
    expect(s.mostRun).toBeNull();
    expect(s.raidClears).toBe(0);
    expect(s.distinctRaids).toBe(0);
  });

  it('keeps Pantheon out of the raid totals', () => {
    const groups: ActivityGroup[] = [
      ...GROUPS,
      { name: 'The Pantheon: Oryx Exalted', category: 'pantheon', tiers: ['Standard'], hashes: [500] }
    ];
    const s = summarisePlayer({ 'Vault of Glass': 4, 'The Pantheon: Oryx Exalted': 3 }, groups);
    expect(s.raidClears).toBe(4);
    expect(s.pantheonClears).toBe(3);
    expect(s.totalRaids).toBe(2);
  });
});
