import { describe, expect, it } from 'vitest';
import {
  diversifyRecommendations,
  headline,
  isEveryonesFirst,
  isLopsided,
  isRusty,
  isSherpa,
  isSpeedrun,
  recommend,
  tallyKinds,
  tallyLabel,
  RUSTY_MAX_AVERAGE,
  SPEEDRUN_MIN_CLEARS,
  type MatrixRow
} from '../src/recommend';

const SIX = ['Wraith', 'Kestrel', 'Ovid', 'Marrow', 'Solene', 'Tidebreaker'];

const row = (activity: string, counts: number[], category: 'raid' | 'dungeon' | 'pantheon' = 'raid'): MatrixRow => ({
  activity,
  category,
  counts
});

/* ------------------------------------------------------------------ */
/* sherpa                                                              */
/* ------------------------------------------------------------------ */

describe('sherpa run', () => {
  it('fires when exactly one player has no clears', () => {
    expect(isSherpa([4, 3, 2, 1, 1, 0])).toBe(true);
  });

  it('names the player who has never cleared it', () => {
    const [rec] = recommend([row('Root of Nightmares', [13, 9, 8, 5, 2, 0])], SIX);
    expect(rec.kind).toBe('sherpa');
    expect(rec.subject).toBe('Tidebreaker');
    expect(rec.reason).toContain('Tidebreaker');
  });

  it('names the right player when the newcomer is not last', () => {
    const [rec] = recommend([row('Last Wish', [5, 0, 3, 2, 1, 4])], SIX);
    expect(rec.subject).toBe('Kestrel');
  });

  it('does NOT fire when two players have no clears', () => {
    expect(isSherpa([4, 3, 2, 1, 0, 0])).toBe(false);
  });

  it('does NOT fire when everyone has cleared it', () => {
    expect(isSherpa([4, 3, 2, 1, 1, 1])).toBe(false);
  });

  it('does NOT fire when nobody has cleared it', () => {
    expect(isSherpa([0, 0, 0, 0, 0, 0])).toBe(false);
  });

  it('does NOT fire for a single player', () => {
    expect(isSherpa([0])).toBe(false);
  });

  it('ranks the better supported sherpa first', () => {
    const recs = recommend(
      [row('Thin support', [1, 1, 1, 1, 1, 0]), row('Deep support', [13, 9, 8, 5, 2, 0])],
      SIX
    );
    expect(recs.map((r) => r.activity)).toEqual(['Deep support', 'Thin support']);
  });
});

/* ------------------------------------------------------------------ */
/* everyone's first                                                    */
/* ------------------------------------------------------------------ */

describe("everyone's first", () => {
  it('fires when nobody in the fireteam has cleared it', () => {
    expect(isEveryonesFirst([0, 0, 0, 0, 0, 0])).toBe(true);
  });

  it('is reported as the first kind', () => {
    const [rec] = recommend([row('Equilibrium', [0, 0, 0, 0, 0, 0], 'dungeon')], SIX);
    expect(rec.kind).toBe('first');
    expect(rec.reason).toContain('blind run');
  });

  it('does NOT fire when a single player has one clear', () => {
    expect(isEveryonesFirst([0, 0, 0, 0, 0, 1])).toBe(false);
  });

  it('does NOT fire on an empty fireteam', () => {
    expect(isEveryonesFirst([])).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* speedrun                                                            */
/* ------------------------------------------------------------------ */

describe('speedrun', () => {
  it('fires when every player is at the threshold', () => {
    expect(isSpeedrun([5, 5, 5, 5, 5, 5])).toBe(true);
    expect(SPEEDRUN_MIN_CLEARS).toBe(5);
  });

  it('fires when everyone is well past the threshold', () => {
    expect(isSpeedrun([31, 24, 19, 15, 9, 6])).toBe(true);
  });

  it('does NOT fire when one player is one clear short', () => {
    expect(isSpeedrun([31, 24, 19, 15, 9, 4])).toBe(false);
  });

  it('does NOT fire when one player has none', () => {
    expect(isSpeedrun([31, 24, 19, 15, 9, 0])).toBe(false);
  });

  it('ranks the more practised speedrun first', () => {
    const recs = recommend(
      [row('Duality', [5, 5, 5, 5, 5, 5]), row('Last Wish', [31, 24, 19, 15, 9, 6])],
      SIX
    );
    expect(recs.map((r) => r.activity)).toEqual(['Last Wish', 'Duality']);
  });
});

/* ------------------------------------------------------------------ */
/* rusty                                                               */
/* ------------------------------------------------------------------ */

describe('rusty', () => {
  it('fires when everyone has cleared it but barely', () => {
    expect(isRusty([2, 1, 1, 1, 1, 1])).toBe(true);
    expect(RUSTY_MAX_AVERAGE).toBe(2);
  });

  it('does NOT fire when a player has never cleared it', () => {
    expect(isRusty([2, 1, 1, 1, 1, 0])).toBe(false);
  });

  it('does NOT fire when the fireteam has plenty of runs between them', () => {
    expect(isRusty([4, 4, 4, 4, 4, 4])).toBe(false);
  });

  it('does NOT fire when it is really a speedrun', () => {
    expect(isRusty([5, 5, 5, 5, 5, 5])).toBe(false);
  });

  it('explains the total in the reason', () => {
    const [rec] = recommend([row('Ghosts of the Deep', [2, 1, 1, 1, 1, 1], 'dungeon')], SIX);
    expect(rec.kind).toBe('rusty');
    expect(rec.reason).toContain('7');
  });
});

/* ------------------------------------------------------------------ */
/* lopsided                                                            */
/* ------------------------------------------------------------------ */

describe('lopsided', () => {
  it('fires when one player has more clears than everyone else combined', () => {
    expect(isLopsided([20, 2, 2, 2, 1, 1])).toBe(true);
  });

  it('names the player who will be calling it', () => {
    const [rec] = recommend([row("Crota's End", [20, 2, 2, 2, 1, 1])], SIX);
    expect(rec.kind).toBe('lopsided');
    expect(rec.subject).toBe('Wraith');
    expect(rec.reason).toContain('Wraith');
  });

  it('does NOT fire when the top player exactly equals the rest', () => {
    expect(isLopsided([5, 3, 2])).toBe(false);
  });

  it('does NOT fire when two players tie at the top', () => {
    expect(isLopsided([10, 10, 1])).toBe(false);
  });

  it('does NOT fire when nobody has cleared it', () => {
    expect(isLopsided([0, 0, 0])).toBe(false);
  });

  it('does NOT fire for a single player', () => {
    expect(isLopsided([9])).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* ranking and shape                                                   */
/* ------------------------------------------------------------------ */

describe('ranking', () => {
  it('puts sherpa above everyone-first above speedrun', () => {
    const recs = recommend(
      [
        row('Speedy', [9, 9, 9, 9, 9, 9]),
        row('Blind', [0, 0, 0, 0, 0, 0]),
        row('Carry', [4, 3, 2, 1, 1, 0])
      ],
      SIX
    );
    expect(recs.map((r) => r.kind)).toEqual(['sherpa', 'first', 'speedrun']);
  });

  it('puts the warnings below the suggestions', () => {
    const recs = recommend(
      [
        row('Uneven', [20, 2, 2, 2, 1, 1]),
        row('Slow', [2, 1, 1, 1, 1, 1]),
        row('Blind', [0, 0, 0, 0, 0, 0])
      ],
      SIX
    );
    expect(recs.map((r) => r.kind)).toEqual(['first', 'rusty', 'lopsided']);
  });

  it('breaks ties on activity name so the order is stable', () => {
    const recs = recommend([row('Bravo', [0, 0]), row('Alpha', [0, 0])], ['A', 'B']);
    expect(recs.map((r) => r.activity)).toEqual(['Alpha', 'Bravo']);
  });

  it('keeps secondary matches in flags', () => {
    // One zero makes it a sherpa run, and the veteran still outweighs the rest.
    const [rec] = recommend([row('Both', [40, 1, 1, 0])], ['A', 'B', 'C', 'D']);
    expect(rec.kind).toBe('sherpa');
    expect(rec.flags).toContain('lopsided');
  });

  it('returns nothing for an activity no rule matches', () => {
    expect(recommend([row('Middling', [18, 14, 12, 9, 5, 3])], SIX)).toEqual([]);
  });

  it('skips rows whose counts do not line up with the players', () => {
    expect(recommend([row('Broken', [1, 2])], SIX)).toEqual([]);
  });

  it('skips rows with no counts at all', () => {
    expect(recommend([row('Empty', [])], [])).toEqual([]);
  });

  it('honours the limit option', () => {
    const rows = [
      row('A', [0, 0, 0, 0, 0, 0]),
      row('B', [0, 0, 0, 0, 0, 0]),
      row('C', [0, 0, 0, 0, 0, 0])
    ];
    expect(recommend(rows, SIX, { limit: 2 })).toHaveLength(2);
  });

  it('carries the category through to the recommendation', () => {
    const [rec] = recommend([row('Prophecy', [0, 0, 0, 0, 0, 0], 'dungeon')], SIX);
    expect(rec.category).toBe('dungeon');
  });

  it('is a pure function, so the same input gives the same output', () => {
    const rows = [row('A', [4, 3, 2, 1, 1, 0]), row('B', [0, 0, 0, 0, 0, 0])];
    expect(recommend(rows, SIX)).toEqual(recommend(rows, SIX));
  });
});

/* ------------------------------------------------------------------ */
/* display order                                                       */
/* ------------------------------------------------------------------ */

describe('diversifyRecommendations', () => {
  const kinds = (recs: { kind: string }[]) => recs.map((r) => r.kind);

  it('breaks up a run of more than two identical verdicts', () => {
    const recs = recommend(
      [
        row('S1', [9, 8, 7, 6, 5, 0]),
        row('S2', [8, 7, 6, 5, 4, 0]),
        row('S3', [7, 6, 5, 4, 3, 0]),
        row('F1', [0, 0, 0, 0, 0, 0])
      ],
      SIX
    );
    expect(kinds(recs)).toEqual(['sherpa', 'sherpa', 'sherpa', 'first']);
    expect(kinds(diversifyRecommendations(recs))).toEqual([
      'sherpa',
      'sherpa',
      'first',
      'sherpa'
    ]);
  });

  it('leaves a list that already alternates untouched', () => {
    const recs = recommend([row('S1', [9, 8, 7, 6, 5, 0]), row('F1', [0, 0, 0, 0, 0, 0])], SIX);
    expect(diversifyRecommendations(recs)).toEqual(recs);
  });

  it('keeps the relative order inside a verdict', () => {
    const recs = recommend(
      [
        row('Big', [9, 8, 7, 6, 5, 0]),
        row('Mid', [8, 7, 6, 5, 4, 0]),
        row('Small', [3, 2, 1, 1, 1, 0]),
        row('Blind', [0, 0, 0, 0, 0, 0])
      ],
      SIX
    );
    const sherpas = diversifyRecommendations(recs)
      .filter((r) => r.kind === 'sherpa')
      .map((r) => r.activity);
    expect(sherpas).toEqual(['Big', 'Mid', 'Small']);
  });

  it('drops nothing and invents nothing', () => {
    const recs = recommend(
      [
        row('S1', [9, 8, 7, 6, 5, 0]),
        row('S2', [8, 7, 6, 5, 4, 0]),
        row('S3', [7, 6, 5, 4, 3, 0]),
        row('F1', [0, 0, 0, 0, 0, 0]),
        row('P1', [9, 9, 9, 9, 9, 9])
      ],
      SIX
    );
    const out = diversifyRecommendations(recs);
    expect(out).toHaveLength(recs.length);
    expect([...out].sort((a, b) => a.activity.localeCompare(b.activity))).toEqual(
      [...recs].sort((a, b) => a.activity.localeCompare(b.activity))
    );
  });

  it('still shows everything when every verdict is the same', () => {
    const recs = recommend(
      [
        row('S1', [9, 8, 7, 6, 5, 0]),
        row('S2', [8, 7, 6, 5, 4, 0]),
        row('S3', [7, 6, 5, 4, 3, 0])
      ],
      SIX
    );
    expect(diversifyRecommendations(recs)).toHaveLength(3);
  });

  it('honours a custom cap', () => {
    const recs = recommend(
      [
        row('S1', [9, 8, 7, 6, 5, 0]),
        row('S2', [8, 7, 6, 5, 4, 0]),
        row('F1', [0, 0, 0, 0, 0, 0])
      ],
      SIX
    );
    expect(kinds(diversifyRecommendations(recs, { maxConsecutive: 1 }))).toEqual([
      'sherpa',
      'first',
      'sherpa'
    ]);
  });

  it('is a no-op on an empty list', () => {
    expect(diversifyRecommendations([])).toEqual([]);
  });

  it('does not change which verdict any activity got', () => {
    const recs = recommend(
      [row('S1', [9, 8, 7, 6, 5, 0]), row('S2', [8, 7, 6, 5, 4, 0]), row('F1', [0, 0, 0, 0, 0, 0])],
      SIX
    );
    const before = new Map(recs.map((r) => [r.activity, r.kind]));
    for (const r of diversifyRecommendations(recs)) {
      expect(r.kind).toBe(before.get(r.activity));
    }
  });
});

describe('tallyKinds', () => {
  it('counts each verdict in priority order', () => {
    const recs = recommend(
      [
        row('S1', [9, 8, 7, 6, 5, 0]),
        row('S2', [8, 7, 6, 5, 4, 0]),
        row('F1', [0, 0, 0, 0, 0, 0]),
        row('P1', [9, 9, 9, 9, 9, 9])
      ],
      SIX
    );
    expect(tallyKinds(recs)).toEqual([
      ['sherpa', 2],
      ['first', 1],
      ['speedrun', 1]
    ]);
  });

  it('is empty for an empty list', () => {
    expect(tallyKinds([])).toEqual([]);
  });
});

describe('tallyLabel', () => {
  it('uses the singular for one', () => {
    expect(tallyLabel('sherpa', 1)).toBe('sherpa run');
    expect(tallyLabel('first', 1)).toBe('blind run');
    expect(tallyLabel('speedrun', 1)).toBe('speedrun');
  });

  it('uses the plural for anything else', () => {
    expect(tallyLabel('sherpa', 3)).toBe('sherpa runs');
    expect(tallyLabel('rusty', 2)).toBe('rusty runs');
    expect(tallyLabel('lopsided', 0)).toBe('lopsided runs');
  });
});

/* ------------------------------------------------------------------ */
/* the one sentence version                                            */
/* ------------------------------------------------------------------ */

describe('headline', () => {
  const first = (rows: MatrixRow[], players = SIX) => recommend(rows, players);

  it('names the person being carried, because that is the whole pitch', () => {
    const recs = first([row('Vault of Glass', [0, 4, 6, 2, 3, 9])]);
    expect(headline(recs, 6)).toBe('Run Vault of Glass and get Wraith their first clear.');
  });

  it('tells a fireteam of six that it is new to all six of them', () => {
    const recs = first([row('Salvation\'s Edge', [0, 0, 0, 0, 0, 0])]);
    expect(headline(recs, 6)).toBe(
      "Run Salvation's Edge. It is new to all 6 of you, so go in blind."
    );
  });

  it('promises a quick one when everybody knows it', () => {
    const recs = first([row('Last Wish', [9, 8, 12, 7, 6, 11])]);
    expect(headline(recs, 6)).toBe('Run Last Wish. Everybody knows it, so it should be a quick one.');
  });

  it('warns instead of selling when the top pick is a warning', () => {
    expect(headline(first([row('Crota\'s End', [1, 1, 1, 1, 1, 1])]), 6)).toBe(
      "Run Crota's End, but nobody has run it much, so give it the evening."
    );
    const lopsided = first([row('Garden of Salvation', [40, 1, 2, 1, 1, 1])]);
    expect(headline(lopsided, 6)).toBe(
      'Run Garden of Salvation, and expect Wraith to end up calling it.'
    );
  });

  it('says so plainly when there is nothing to say', () => {
    expect(headline([], 6)).toBe('Nothing stands out for this fireteam, so run whatever you feel like.');
  });

  it('is an instruction, with no counts or jargon in it', () => {
    // The matrix is where the numbers live. This is the line somebody reads
    // who has never seen the site before, so it has to survive on its own.
    const recs = first([row('Vault of Glass', [0, 4, 6, 2, 3, 9])]);
    const line = headline(recs, 6);
    expect(line.startsWith('Run ')).toBe(true);
    expect(line).not.toMatch(/clears|sherpa|speedrun|lopsided|matrix|%/i);
  });

  it('reads the list it is given, so the displayed order and the sentence agree', () => {
    const recs = diversifyRecommendations(
      first([row('Last Wish', [9, 8, 12, 7, 6, 11]), row('Vault of Glass', [0, 4, 6, 2, 3, 9])])
    );
    expect(headline(recs, 6)).toContain(recs[0].activity);
  });
});
