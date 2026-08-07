import { describe, expect, it } from 'vitest';
import {
  describeNameError,
  formatBungieName,
  isValidBungieName,
  parseBungieName,
  type NameError
} from '../src/bungiename';

describe('parseBungieName: valid forms', () => {
  it('parses a plain Bungie Name', () => {
    expect(parseBungieName('Guardian#1234')).toEqual({
      ok: true,
      value: { name: 'Guardian', code: 1234 }
    });
  });

  it('keeps spaces inside the display name', () => {
    const parsed = parseBungieName('The Drifter#0001');
    expect(parsed.ok && parsed.value.name).toBe('The Drifter');
  });

  it('reads a zero padded code as a number', () => {
    const parsed = parseBungieName('Ana#0007');
    expect(parsed.ok && parsed.value.code).toBe(7);
  });

  it('accepts a short unpadded code', () => {
    const parsed = parseBungieName('Ana#7');
    expect(parsed.ok && parsed.value.code).toBe(7);
  });

  it('trims surrounding whitespace', () => {
    const parsed = parseBungieName('   Guardian#1234   ');
    expect(parsed.ok && parsed.value).toEqual({ name: 'Guardian', code: 1234 });
  });

  it('trims whitespace around the two halves', () => {
    const parsed = parseBungieName('Guardian  #  1234');
    expect(parsed.ok && parsed.value).toEqual({ name: 'Guardian', code: 1234 });
  });

  it('accepts non-ascii display names', () => {
    const parsed = parseBungieName('Kaguya#4242');
    expect(parsed.ok && parsed.value.name).toBe('Kaguya');
  });
});

describe('parseBungieName: invalid forms', () => {
  const bad: [string, NameError][] = [
    ['', 'empty'],
    ['    ', 'empty'],
    ['Guardian', 'missing-hash'],
    ['Guardian#12#34', 'too-many-hashes'],
    ['#1234', 'empty-name'],
    ['  #1234', 'empty-name'],
    ['Guardian#', 'empty-code'],
    ['Guardian#   ', 'empty-code'],
    ['Guardian#12a4', 'non-numeric-code'],
    ['Guardian#abcd', 'non-numeric-code'],
    ['Guardian#-123', 'non-numeric-code'],
    ['Guardian#12.4', 'non-numeric-code'],
    ['Guardian#12345', 'code-too-long'],
    ['Guardian#0000', 'code-out-of-range']
  ];

  for (const [input, error] of bad) {
    it('rejects ' + JSON.stringify(input) + ' with ' + error, () => {
      expect(parseBungieName(input)).toEqual({ ok: false, error });
    });
  }

  it('rejects a value that is not a string', () => {
    expect(parseBungieName(undefined as unknown as string)).toEqual({ ok: false, error: 'empty' });
  });
});

describe('isValidBungieName', () => {
  it('is true for a good name', () => {
    expect(isValidBungieName('Guardian#1234')).toBe(true);
  });

  it('is false for a bad name', () => {
    expect(isValidBungieName('Guardian')).toBe(false);
  });
});

describe('formatBungieName', () => {
  it('pads the code to four digits', () => {
    expect(formatBungieName({ name: 'Ana', code: 7 })).toBe('Ana#0007');
  });

  it('leaves a full width code alone', () => {
    expect(formatBungieName({ name: 'Guardian', code: 1234 })).toBe('Guardian#1234');
  });

  it('round trips through parse', () => {
    const text = 'The Drifter#0042';
    const parsed = parseBungieName(text);
    expect(parsed.ok && formatBungieName(parsed.value)).toBe(text);
  });

  it('normalises an unpadded code on the way back out', () => {
    const parsed = parseBungieName('Ana#7');
    expect(parsed.ok && formatBungieName(parsed.value)).toBe('Ana#0007');
  });
});

describe('describeNameError', () => {
  it('has a message for every error kind', () => {
    const kinds: NameError[] = [
      'empty',
      'missing-hash',
      'too-many-hashes',
      'empty-name',
      'empty-code',
      'non-numeric-code',
      'code-too-long',
      'code-out-of-range'
    ];
    for (const kind of kinds) {
      expect(describeNameError(kind).length).toBeGreaterThan(0);
    }
  });
});
