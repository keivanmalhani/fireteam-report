import { describe, expect, it } from 'vitest';
import { buildDiscordSummary, DISCORD_LIMIT } from '../src/discord';
import { recommend, type MatrixRow } from '../src/recommend';
import type { PlayerStats } from '../src/types';

const player = (name: string, code: number, problem?: PlayerStats['problem']): PlayerStats => ({
  ref: { name, code },
  label: name + '#' + String(code).padStart(4, '0'),
  clears: {},
  ...(problem ? { problem } : {})
});

const PLAYERS = [player('Wraith', 4417), player('Kestrel', 912)];
const rows: MatrixRow[] = [
  { activity: 'Root of Nightmares', category: 'raid', counts: [4, 0] },
  { activity: 'Equilibrium', category: 'dungeon', counts: [0, 0] }
];
const RECS = recommend(rows, ['Wraith', 'Kestrel']);

describe('buildDiscordSummary', () => {
  it('names the fireteam on the first line', () => {
    const text = buildDiscordSummary({ recommendations: RECS, players: PLAYERS });
    expect(text.split('\n')[0]).toBe('Fireteam Report: Wraith, Kestrel');
  });

  it('lists the picks in rank order', () => {
    const text = buildDiscordSummary({ recommendations: RECS, players: PLAYERS });
    expect(text).toContain('1. Root of Nightmares');
    expect(text).toContain('2. Equilibrium');
  });

  it('includes the share link when given one', () => {
    const text = buildDiscordSummary({
      recommendations: RECS,
      players: PLAYERS,
      shareUrl: 'https://example.com/#f=A%231111'
    });
    expect(text).toContain('https://example.com/#f=A%231111');
  });

  it('caps the list and counts the remainder', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      activity: 'Raid ' + i,
      category: 'raid' as const,
      counts: [0, 0]
    }));
    const text = buildDiscordSummary({
      recommendations: recommend(many, ['A', 'B']),
      players: PLAYERS,
      maxLines: 3
    });
    expect(text).toContain('...and 6 more on the site.');
  });

  it('calls out players whose stats could not be read', () => {
    const text = buildDiscordSummary({
      recommendations: RECS,
      players: [player('Wraith', 4417), player('Shy', 5150, 'private')]
    });
    expect(text).toContain('Shy has private stats');
  });

  it('says so plainly when nothing stands out', () => {
    const text = buildDiscordSummary({ recommendations: [], players: PLAYERS });
    expect(text).toContain('No strong picks');
  });

  it('stays inside the Discord message limit', () => {
    const many = Array.from({ length: 400 }, (_, i) => ({
      activity: 'A rather long activity name number ' + i,
      category: 'raid' as const,
      counts: [0, 0]
    }));
    const text = buildDiscordSummary({
      recommendations: recommend(many, ['A', 'B']),
      players: PLAYERS,
      maxLines: 400
    });
    expect(text.length).toBeLessThanOrEqual(DISCORD_LIMIT);
  });
});
