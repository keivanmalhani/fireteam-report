import { describe, expect, it } from 'vitest';
import { buildShareUrl, decodeFireteam, encodeFireteam, MAX_PLAYERS } from '../src/permalink';
import type { PlayerRef } from '../src/types';

const ref = (name: string, code: number): PlayerRef => ({ name, code });

describe('encodeFireteam', () => {
  it('encodes a single player', () => {
    expect(encodeFireteam([ref('Guardian', 1234)])).toBe('#f=Guardian%231234');
  });

  it('encodes several players separated by commas', () => {
    expect(encodeFireteam([ref('Ana', 7), ref('Rob', 1234)])).toBe('#f=Ana%230007,Rob%231234');
  });

  it('returns an empty string for an empty fireteam', () => {
    expect(encodeFireteam([])).toBe('');
  });

  it('caps the fireteam at six', () => {
    const many = Array.from({ length: 9 }, (_, i) => ref('P' + i, 1000 + i));
    expect(decodeFireteam(encodeFireteam(many))).toHaveLength(MAX_PLAYERS);
  });
});

describe('round trip', () => {
  const cases: [string, PlayerRef[]][] = [
    ['one player', [ref('Guardian', 1234)]],
    ['two players', [ref('Ana', 7), ref('Rob', 1234)]],
    [
      'a full fireteam',
      [
        ref('Wraith', 4417),
        ref('Kestrel', 912),
        ref('Ovid', 7731),
        ref('Marrow', 2208),
        ref('Solene', 1145),
        ref('Tidebreaker', 6690)
      ]
    ],
    ['a name with spaces', [ref('The Drifter', 42)]],
    ['a name with a comma', [ref('Bell, Book', 1111)]],
    ['a name with a percent sign', [ref('100% Uptime', 2222)]],
    ['a name with an ampersand', [ref('Salt & Pepper', 3333)]],
    ['a name with a plus', [ref('C++', 4444)]]
  ];

  for (const [label, players] of cases) {
    it('survives ' + label, () => {
      expect(decodeFireteam(encodeFireteam(players))).toEqual(players);
    });
  }

  it('normalises an unpadded code through the round trip', () => {
    expect(decodeFireteam(encodeFireteam([ref('Ana', 7)]))).toEqual([ref('Ana', 7)]);
  });
});

describe('decodeFireteam', () => {
  it('accepts a hash with or without the leading marker', () => {
    expect(decodeFireteam('#f=Ana%230007')).toEqual([ref('Ana', 7)]);
    expect(decodeFireteam('f=Ana%230007')).toEqual([ref('Ana', 7)]);
  });

  it('returns nothing for an empty hash', () => {
    expect(decodeFireteam('')).toEqual([]);
    expect(decodeFireteam('#')).toEqual([]);
  });

  it('returns nothing when the parameter is missing', () => {
    expect(decodeFireteam('#other=1')).toEqual([]);
  });

  it('returns nothing for a value that is not a string', () => {
    expect(decodeFireteam(undefined as unknown as string)).toEqual([]);
  });

  it('ignores unparseable entries but keeps the good ones', () => {
    expect(decodeFireteam('#f=Ana%230007,broken,Rob%231234')).toEqual([
      ref('Ana', 7),
      ref('Rob', 1234)
    ]);
  });

  it('survives a malformed percent escape', () => {
    expect(decodeFireteam('#f=%E0%A4%A,Rob%231234')).toEqual([ref('Rob', 1234)]);
  });

  it('drops duplicates, comparing case insensitively', () => {
    expect(decodeFireteam('#f=Ana%230007,ana%230007,Rob%231234')).toEqual([
      ref('Ana', 7),
      ref('Rob', 1234)
    ]);
  });

  it('reads the parameter out of a hash carrying several', () => {
    expect(decodeFireteam('#a=1&f=Ana%230007&z=9')).toEqual([ref('Ana', 7)]);
  });
});

describe('buildShareUrl', () => {
  it('appends the fireteam to a bare url', () => {
    expect(buildShareUrl('https://example.com/app/', [ref('Ana', 7)])).toBe(
      'https://example.com/app/#f=Ana%230007'
    );
  });

  it('replaces an existing hash rather than stacking onto it', () => {
    expect(buildShareUrl('https://example.com/app/#f=Old%231111', [ref('Ana', 7)])).toBe(
      'https://example.com/app/#f=Ana%230007'
    );
  });

  it('returns a clean url when the fireteam is empty', () => {
    expect(buildShareUrl('https://example.com/app/#f=Old%231111', [])).toBe(
      'https://example.com/app/'
    );
  });
});
