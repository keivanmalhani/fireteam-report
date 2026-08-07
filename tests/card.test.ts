import { describe, expect, it } from 'vitest';
import {
  blockShift,
  buildCardModel,
  cardLayout,
  cardLayoutFor,
  CARD_HEIGHT,
  CARD_LIST_ROWS,
  CARD_SITE_LABEL,
  CARD_WIDTH,
  fireteamLine,
  fitFontSize,
  HERO_SIZES,
  KIND_COLORS,
  kindColor,
  NO_PICKS_REASON,
  NO_PICKS_TITLE,
  trackedWidth,
  truncateToWidth,
  withAlpha,
  wrapText
} from '../src/card';
import { KIND_PRIORITY, recommend, type MatrixRow } from '../src/recommend';
import { FALLBACK_ACTIVITIES } from '../src/fallback-activities';
import { demoPlayers } from '../src/demo';
import type { PlayerStats } from '../src/types';

/** One character is one unit, which is all the layout tests need. */
const chars = (s: string): number => s.length;

/**
 * A pessimistic stand in for a real font: 0.62 em per character is wider than
 * this weight actually measures, so anything that fits here fits on a canvas.
 */
const emWide = (s: string, size: number): number => s.length * size * 0.62;

const player = (name: string, code: number, problem?: PlayerStats['problem']): PlayerStats => ({
  ref: { name, code },
  label: name + '#' + String(code).padStart(4, '0'),
  clears: {},
  ...(problem ? { problem } : {})
});

const rows: MatrixRow[] = [
  { activity: 'Vault of Glass', category: 'raid', counts: [4, 4, 0] },
  { activity: 'Root of Nightmares', category: 'raid', counts: [0, 0, 0] },
  { activity: 'Prophecy', category: 'dungeon', counts: [8, 9, 7] },
  { activity: 'Duality', category: 'dungeon', counts: [1, 1, 1] },
  { activity: 'Pit of Heresy', category: 'dungeon', counts: [9, 1, 1] },
  { activity: "King's Fall", category: 'raid', counts: [6, 6, 0] }
];
const PLAYERS = [player('Wraith', 4417), player('Kestrel', 912), player('Ovid', 7731)];
const RECS = recommend(rows, PLAYERS.map((p) => p.ref.name));

describe('cardLayout', () => {
  const L = cardLayout();

  it('is the size a social preview wants', () => {
    expect(L.width).toBe(CARD_WIDTH);
    expect(L.height).toBe(CARD_HEIGHT);
    expect(L.scale).toBe(1);
  });

  it('keeps every block inside the padding', () => {
    expect(L.hero.x).toBe(L.pad);
    expect(L.hero.x + L.hero.w).toBe(L.width - L.pad);
    expect(L.headRule.x + L.headRule.w).toBe(L.width - L.pad);
    expect(L.brand.y).toBeGreaterThan(0);
    expect(L.fireteam.y).toBeLessThan(L.height);
    expect(L.site.x).toBe(L.width - L.pad);
  });

  it('stacks the card top to bottom in reading order', () => {
    expect(L.brand.y).toBeLessThan(L.headRule.y);
    expect(L.headRule.y).toBeLessThan(L.hero.y);
    expect(L.hero.y + L.hero.h).toBeLessThan(L.listTop);
    expect(L.listTop).toBeLessThan(L.footRule.y);
    expect(L.footRule.y).toBeLessThan(L.fireteam.y);
  });

  it('keeps the hero contents inside the hero panel', () => {
    expect(L.heroTag.y).toBeGreaterThan(L.hero.y);
    expect(L.heroName.y).toBeGreaterThan(L.heroTag.y + L.heroTag.h);
    expect(L.heroReason.y).toBeGreaterThan(L.heroName.y);
    // Both reason lines, plus room for the descenders on the second one.
    expect(L.heroReason.y + L.heroReason.lineHeight + 8).toBeLessThan(
      L.hero.y + L.hero.h
    );
    expect(L.heroName.x + L.heroName.maxWidth).toBeLessThanOrEqual(L.hero.x + L.hero.w);
    expect(L.heroTag.x).toBeGreaterThan(L.hero.x + L.heroBorder);
  });

  it('fits a full list between the hero and the footer', () => {
    const last = L.listTop + (CARD_LIST_ROWS - 1) * L.rowHeight;
    expect(last).toBeLessThan(L.footRule.y);
    expect(L.rowRankX).toBeLessThan(L.rowBarX);
    expect(L.rowBarX).toBeLessThan(L.rowNameX);
    expect(L.rowNameX).toBeLessThan(L.rowLabelX);
    expect(L.rowLabelX).toBe(L.width - L.pad);
  });

  it('leaves the names room without running into the site label', () => {
    expect(L.fireteam.maxWidth).toBeLessThan(L.width - L.pad * 2);
    expect(L.fireteam.x + L.fireteam.maxWidth).toBeLessThan(L.site.x);
    expect(L.fireteam.y).toBe(L.site.y);
  });

  it('scales the whole card off one factor', () => {
    const half = cardLayout(CARD_WIDTH / 2, CARD_HEIGHT / 2);
    expect(half.scale).toBe(0.5);
    expect(half.pad).toBe(Math.round(L.pad / 2));
    expect(half.hero.w).toBe(half.width - half.pad * 2);
    expect(half.heroName.size).toBe(Math.round(L.heroName.size / 2));
    expect(half.footRule.y).toBeLessThan(half.height);
  });

  it('gives the hero the height the missing rows would have used', () => {
    const full = cardLayout(CARD_WIDTH, CARD_HEIGHT, CARD_LIST_ROWS);
    const none = cardLayout(CARD_WIDTH, CARD_HEIGHT, 0);
    expect(none.hero.h).toBe(full.hero.h + CARD_LIST_ROWS * full.rowHeight);
    expect(none.hero.y + none.hero.h).toBeLessThan(none.footRule.y);
    // The contents move with the panel rather than staying at the top of it.
    expect(none.heroName.y).toBeGreaterThan(full.heroName.y);
    expect(none.heroReason.y + none.heroReason.lineHeight).toBeLessThan(
      none.hero.y + none.hero.h
    );
  });

  it('still fits a short list above the footer', () => {
    for (const count of [1, 2, 3]) {
      const L2 = cardLayout(CARD_WIDTH, CARD_HEIGHT, count);
      expect(L2.hero.y + L2.hero.h).toBeLessThan(L2.listTop);
      expect(L2.listTop + (count - 1) * L2.rowHeight).toBeLessThan(L2.footRule.y);
    }
  });

  it('ignores a list longer than the card draws', () => {
    expect(cardLayout(CARD_WIDTH, CARD_HEIGHT, 99).hero.h).toBe(cardLayout().hero.h);
  });
});

describe('cardLayoutFor', () => {
  it('sizes the layout from the model it will draw', () => {
    const model = buildCardModel({ recommendations: RECS, players: PLAYERS });
    const thin = buildCardModel({ recommendations: RECS.slice(0, 1), players: PLAYERS });
    expect(cardLayoutFor(model).hero.h).toBe(cardLayout().hero.h);
    expect(cardLayoutFor(thin).hero.h).toBeGreaterThan(cardLayoutFor(model).hero.h);
  });
});

describe('truncateToWidth', () => {
  it('leaves text that already fits alone', () => {
    expect(truncateToWidth('Duality', 20, chars)).toBe('Duality');
  });

  it('cuts with an ellipsis when it does not fit', () => {
    const out = truncateToWidth('The Pantheon: Rhulk Indomitable', 12, chars);
    expect(out.endsWith('...')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(12);
  });

  it('gives up rather than drawing an ellipsis on its own', () => {
    expect(truncateToWidth('Last Wish', 2, chars)).toBe('');
    expect(truncateToWidth('Last Wish', 0, chars)).toBe('');
  });
});

describe('wrapText', () => {
  it('breaks on words', () => {
    expect(wrapText('nobody here has cleared', 12, chars)).toEqual([
      'nobody here',
      'has cleared'
    ]);
  });

  it('keeps a word that is wider than the line rather than splitting it', () => {
    expect(wrapText('Leviathan', 4, chars, 1)).toEqual(['Leviathan']);
  });

  it('truncates the last line when there is more text than lines', () => {
    const lines = wrapText('one two three four five six seven', 9, chars, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith('...')).toBe(true);
  });

  it('returns nothing for empty text', () => {
    expect(wrapText('   ', 40, chars)).toEqual([]);
  });
});

describe('fitFontSize', () => {
  it('takes the largest size that fits', () => {
    expect(fitFontSize('Duality', 1036, HERO_SIZES, emWide)).toBe(72);
  });

  it('steps down for a long name', () => {
    const size = fitFontSize('The Pantheon: Rhulk Indomitable', 1036, HERO_SIZES, emWide);
    expect(size).toBeLessThan(72);
    expect(emWide('The Pantheon: Rhulk Indomitable', size)).toBeLessThanOrEqual(1036);
  });

  it('falls back to the floor when nothing fits', () => {
    expect(fitFontSize('x'.repeat(400), 100, HERO_SIZES, emWide)).toBe(
      HERO_SIZES[HERO_SIZES.length - 1]
    );
  });

  it('has nothing to say about an empty size list', () => {
    expect(fitFontSize('Duality', 100, [], emWide)).toBe(0);
  });
});

describe('every activity name in the manifest fits the hero', () => {
  const L = cardLayout();
  const sizes = HERO_SIZES;

  it.each(FALLBACK_ACTIVITIES.map((g) => g.name))('%s', (name) => {
    const size = fitFontSize(name, L.heroName.maxWidth, sizes, emWide);
    // Not the floor, so no real name is ever set at the smallest size, and
    // never truncated.
    expect(size).toBeGreaterThan(sizes[sizes.length - 1]);
    expect(truncateToWidth(name, L.heroName.maxWidth, (s) => emWide(s, size))).toBe(name);
  });
});

describe('blockShift', () => {
  it('does not move a block that used all its lines', () => {
    expect(blockShift(2, 2, 31)).toBe(0);
  });

  it('centres a block that used fewer', () => {
    expect(blockShift(1, 2, 31)).toBe(16);
    expect(blockShift(0, 2, 30)).toBe(30);
  });

  it('never pulls a block upward', () => {
    expect(blockShift(5, 2, 31)).toBe(0);
    expect(blockShift(-1, 2, 31)).toBe(31);
  });
});

describe('fireteamLine', () => {
  const six = ['Wraith', 'Kestrel', 'Ovid', 'Marrow', 'Solene', 'Tidebreaker'];

  it('names everyone when there is room', () => {
    expect(fireteamLine(six, 200, chars)).toBe(six.join(', '));
  });

  it('counts the tail it had to drop', () => {
    const line = fireteamLine(six, 30, chars);
    expect(line.length).toBeLessThanOrEqual(30);
    expect(line).toContain('Wraith');
    expect(line).toMatch(/\+\d+ more$/);
  });

  it('keeps at least one name when the fireteam is all long names', () => {
    const long = Array.from({ length: 6 }, (_, i) => 'AVeryLongBungieName' + i);
    const line = fireteamLine(long, 40, chars);
    expect(line.length).toBeLessThanOrEqual(40);
    expect(line.startsWith('AVeryLongBungieName0')).toBe(true);
  });

  it('truncates a single name that cannot fit at all', () => {
    const line = fireteamLine(['x'.repeat(80)], 20, chars);
    expect(line.length).toBeLessThanOrEqual(20);
    expect(line.endsWith('...')).toBe(true);
  });

  it('has nothing to draw for an empty fireteam', () => {
    expect(fireteamLine([], 200, chars)).toBe('');
  });
});

describe('colours', () => {
  it('has one for every verdict the engine can return', () => {
    for (const kind of Object.keys(KIND_PRIORITY)) {
      expect(KIND_COLORS[kind as keyof typeof KIND_COLORS]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('goes grey when there is nothing to recommend', () => {
    expect(kindColor(null)).not.toBe(KIND_COLORS.sherpa);
    expect(kindColor('speedrun')).toBe(KIND_COLORS.speedrun);
  });

  it('mixes an alpha into a hex colour', () => {
    expect(withAlpha('#d9a752', 0.14)).toBe('rgba(217, 167, 82, 0.14)');
    expect(withAlpha('#000000', 0)).toBe('rgba(0, 0, 0, 0)');
  });
});

describe('trackedWidth', () => {
  it('counts the gaps between glyphs but not after the last one', () => {
    expect(trackedWidth('abc', 2, chars)).toBe(3 + 4);
  });

  it('is zero for an empty string', () => {
    expect(trackedWidth('', 2, chars)).toBe(0);
  });
});

describe('buildCardModel', () => {
  it('makes the first pick the hero', () => {
    const model = buildCardModel({ recommendations: RECS, players: PLAYERS });
    expect(model.hero.activity).toBe(RECS[0].activity);
    expect(model.hero.kind).toBe(RECS[0].kind);
    expect(model.hero.reason).toBe(RECS[0].reason);
    expect(model.hero.category).toBe(RECS[0].category.toUpperCase());
  });

  it('numbers the rest from two', () => {
    const model = buildCardModel({ recommendations: RECS, players: PLAYERS });
    expect(model.rows.map((r) => r.rank)).toEqual([2, 3, 4, 5]);
    expect(model.rows[0].activity).toBe(RECS[1].activity);
  });

  it('shows no more than the card has room for', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      activity: 'Raid ' + i,
      category: 'raid' as const,
      counts: [0, 0, 0]
    }));
    const model = buildCardModel({
      recommendations: recommend(many, ['A', 'B', 'C']),
      players: PLAYERS
    });
    expect(model.rows).toHaveLength(CARD_LIST_ROWS);
  });

  it('honours a smaller list', () => {
    const model = buildCardModel({
      recommendations: RECS,
      players: PLAYERS,
      maxRows: 1
    });
    expect(model.rows).toHaveLength(1);
    expect(model.rows[0].rank).toBe(2);
  });

  it('says so plainly when nothing stands out', () => {
    const model = buildCardModel({ recommendations: [], players: PLAYERS });
    expect(model.hero.activity).toBe(NO_PICKS_TITLE);
    expect(model.hero.reason).toBe(NO_PICKS_REASON);
    expect(model.hero.kind).toBeNull();
    expect(model.hero.category).toBe('');
    expect(model.rows).toEqual([]);
  });

  it('names the whole fireteam and counts who could not be read', () => {
    const model = buildCardModel({
      recommendations: RECS,
      players: [...PLAYERS, player('Shy', 5150, 'private')]
    });
    expect(model.fireteam).toEqual(['Wraith', 'Kestrel', 'Ovid', 'Shy']);
    expect(model.excluded).toBe(1);
  });

  it('carries the site label so the card says where it came from', () => {
    expect(buildCardModel({ recommendations: RECS, players: PLAYERS }).siteLabel).toBe(
      CARD_SITE_LABEL
    );
    expect(
      buildCardModel({ recommendations: RECS, players: PLAYERS, siteLabel: 'x' }).siteLabel
    ).toBe('x');
  });

  it('holds the demo fireteam, which is what the og:image renders', () => {
    const players = demoPlayers();
    const usable = players.filter((p) => !p.problem);
    const matrix = FALLBACK_ACTIVITIES.map((g) => ({
      activity: g.name,
      category: g.category,
      counts: usable.map((p) => p.clears[g.name] ?? 0)
    }));
    const model = buildCardModel({
      recommendations: recommend(matrix, usable.map((p) => p.ref.name)),
      players
    });
    expect(model.hero.kind).not.toBeNull();
    expect(model.rows).toHaveLength(CARD_LIST_ROWS);
    expect(model.excluded).toBe(0);
    const L = cardLayoutFor(model);
    expect(
      fireteamLine(model.fireteam, L.fireteam.maxWidth, (s) => emWide(s, L.fireteam.size))
        .length
    ).toBeGreaterThan(0);
  });
});
