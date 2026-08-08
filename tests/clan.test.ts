/**
 * Clan logic: parsing a roster, walking its pages, picking a fireteam out of
 * it, and capping what that costs.
 *
 * Every one of these is a pure function on purpose. The paging in particular is
 * the kind of thing that is only ever wrong on the one clan big enough to have
 * a second page, which is exactly the case nobody tests by hand.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  FIRETEAM_SIZE,
  MAX_CHARACTERS,
  MAX_ROSTER_PAGES,
  defaultSelection,
  describeBudget,
  mapSettledWithLimit,
  nextRosterPage,
  parseClanSummary,
  parseMemberClans,
  parseRosterMember,
  progressLabel,
  requestBudget,
  selectedMembers,
  sortRoster,
  toggleSelected,
  type RosterMember
} from '../src/clan';

/** Shaped exactly like a real GroupV2 Members entry, trimmed to what is read. */
function rawMember(overrides: Record<string, unknown> = {}): unknown {
  return {
    memberType: 2,
    isOnline: false,
    lastOnlineStatusChange: '1786150257',
    groupId: '881267',
    destinyUserInfo: {
      LastSeenDisplayName: 'iihavetoes',
      crossSaveOverride: 3,
      membershipType: 3,
      membershipId: '4611686018467183841',
      displayName: 'iihavetoes',
      bungieGlobalDisplayName: 'iihavetoes',
      bungieGlobalDisplayNameCode: 9582
    },
    ...overrides
  };
}

function member(partial: Partial<RosterMember> & { membershipId: string }): RosterMember {
  return {
    ref: { name: 'Guardian', code: 1 },
    label: 'Guardian#0001',
    membershipType: 3,
    isOnline: false,
    lastOnline: 0,
    memberType: 2,
    ...partial
  };
}

describe('parseClanSummary', () => {
  it('reads the fields the picker shows', () => {
    expect(
      parseClanSummary({ groupId: '881267', name: 'Math Class', memberCount: 96, motto: 'math.gg' })
    ).toEqual({ groupId: '881267', name: 'Math Class', memberCount: 96, motto: 'math.gg' });
  });

  it('survives a clan with no motto', () => {
    expect(parseClanSummary({ groupId: '1', name: 'Quiet' })?.motto).toBe('');
    expect(parseClanSummary({ groupId: '1', name: 'Quiet' })?.memberCount).toBe(0);
  });

  it('refuses anything without an id and a name', () => {
    expect(parseClanSummary({ name: 'No id' })).toBeNull();
    expect(parseClanSummary({ groupId: '1' })).toBeNull();
    expect(parseClanSummary(null)).toBeNull();
    expect(parseClanSummary('a clan')).toBeNull();
  });
});

describe('parseRosterMember', () => {
  it('reads a real roster entry into a fireteam slot', () => {
    const parsed = parseRosterMember(rawMember({ isOnline: true }));
    expect(parsed).toEqual({
      ref: { name: 'iihavetoes', code: 9582 },
      label: 'iihavetoes#9582',
      membershipType: 3,
      membershipId: '4611686018467183841',
      isOnline: true,
      lastOnline: 1786150257,
      memberType: 2
    });
  });

  it('reads lastOnlineStatusChange even though Bungie sends it as a string', () => {
    expect(parseRosterMember(rawMember())?.lastOnline).toBe(1786150257);
    expect(parseRosterMember(rawMember({ lastOnlineStatusChange: 5 }))?.lastOnline).toBe(5);
    expect(parseRosterMember(rawMember({ lastOnlineStatusChange: 'soon' }))?.lastOnline).toBe(0);
  });

  it('pads the code the way the rest of the app writes a Bungie Name', () => {
    const raw = rawMember();
    (raw as { destinyUserInfo: Record<string, unknown> }).destinyUserInfo
      .bungieGlobalDisplayNameCode = 7;
    expect(parseRosterMember(raw)?.label).toBe('iihavetoes#0007');
  });

  it('falls back through the display names Bungie might have filled in', () => {
    const raw = rawMember() as { destinyUserInfo: Record<string, unknown> };
    raw.destinyUserInfo.bungieGlobalDisplayName = '';
    raw.destinyUserInfo.displayName = '';
    expect(parseRosterMember(raw)?.ref.name).toBe('iihavetoes');
  });

  it('drops a clan member with no Destiny account rather than showing a dead row', () => {
    // A clan can hold a bungie.net account that never played. There is nothing
    // to look up for one, so it has no place in a picker.
    expect(parseRosterMember({ memberType: 2 })).toBeNull();
    expect(parseRosterMember(rawMember({ destinyUserInfo: { membershipType: 3 } }))).toBeNull();
    expect(
      parseRosterMember(rawMember({ destinyUserInfo: { membershipId: '1', membershipType: 0 } }))
    ).toBeNull();
    expect(parseRosterMember(null)).toBeNull();
  });
});

describe('parseMemberClans', () => {
  /**
   * Shaped like the measured GroupV2/User answer for a cross saved account:
   * every clan record ever held, with the dead ones flagged in
   * areAllMembershipsInactive rather than removed.
   */
  const measured = {
    areAllMembershipsInactive: { '881267': false, '1275992': true },
    results: [
      { group: { groupId: '881267', name: 'Math Class', memberCount: 96, motto: 'math.gg' } },
      { group: { groupId: '1275992', name: 'Hayley Williams', memberCount: 3, motto: 'glhf' } }
    ]
  };

  it('keeps the clan the player is actually in and drops the ghost', () => {
    // Without this, one-click "Use my clan" becomes a choice between a real
    // clan and a record of one the account has already left behind.
    const clans = parseMemberClans(measured);
    expect(clans).toHaveLength(1);
    expect(clans[0]).toEqual({
      groupId: '881267',
      name: 'Math Class',
      memberCount: 96,
      motto: 'math.gg'
    });
  });

  it('keeps a clan the flag map does not mention', () => {
    // Dropping somebody's only clan on a missing field is the worse error.
    const clans = parseMemberClans({
      results: [{ group: { groupId: '9', name: 'Unflagged' } }]
    });
    expect(clans).toHaveLength(1);
  });

  it('drops entries with no readable group in them', () => {
    expect(parseMemberClans({ results: [{}, { group: { name: 'no id' } }] })).toEqual([]);
  });

  it('answers an empty list to junk rather than throwing', () => {
    expect(parseMemberClans(null)).toEqual([]);
    expect(parseMemberClans('nope')).toEqual([]);
    expect(parseMemberClans({})).toEqual([]);
  });
});

describe('nextRosterPage', () => {
  it('stops on the single page a normal clan fits in', () => {
    expect(
      nextRosterPage({ page: 1, received: 96, hasMore: false, totalResults: 96, collected: 96 })
    ).toBeNull();
  });

  it('follows hasMore, and currentpage is 1-based', () => {
    expect(
      nextRosterPage({ page: 1, received: 100, hasMore: true, totalResults: 240, collected: 100 })
    ).toBe(2);
    expect(
      nextRosterPage({ page: 2, received: 100, hasMore: true, totalResults: 240, collected: 200 })
    ).toBe(3);
  });

  it('keeps going when the total says there is more even if hasMore does not', () => {
    // Believing the flag alone is how a big clan silently shows one page.
    expect(
      nextRosterPage({ page: 1, received: 100, hasMore: false, totalResults: 240, collected: 100 })
    ).toBe(2);
  });

  it('stops when the collected count has caught the total', () => {
    expect(
      nextRosterPage({ page: 3, received: 40, hasMore: false, totalResults: 240, collected: 240 })
    ).toBeNull();
  });

  it('stops on an empty page whatever the server claims', () => {
    expect(
      nextRosterPage({ page: 2, received: 0, hasMore: true, totalResults: 999, collected: 96 })
    ).toBeNull();
  });

  it('stops at the safety net rather than looping forever', () => {
    expect(
      nextRosterPage({
        page: MAX_ROSTER_PAGES,
        received: 100,
        hasMore: true,
        totalResults: 100000,
        collected: 500
      })
    ).toBeNull();
  });

  it('copes with a server that gives no total at all', () => {
    expect(nextRosterPage({ page: 1, received: 100, hasMore: true, collected: 100 })).toBe(2);
    expect(nextRosterPage({ page: 1, received: 100, hasMore: false, collected: 100 })).toBeNull();
  });
});

describe('sortRoster', () => {
  it('puts whoever is online first, because that is the question', () => {
    const sorted = sortRoster([
      member({ membershipId: 'a', lastOnline: 900 }),
      member({ membershipId: 'b', isOnline: true, lastOnline: 1 })
    ]);
    expect(sorted.map((m) => m.membershipId)).toEqual(['b', 'a']);
  });

  it('then orders by most recently seen', () => {
    const sorted = sortRoster([
      member({ membershipId: 'old', lastOnline: 10 }),
      member({ membershipId: 'new', lastOnline: 900 })
    ]);
    expect(sorted.map((m) => m.membershipId)).toEqual(['new', 'old']);
  });

  it('breaks a tie on the name so the order never wobbles between renders', () => {
    const sorted = sortRoster([
      member({ membershipId: 'z', label: 'Zoe#0001' }),
      member({ membershipId: 'a', label: 'Ana#0001' })
    ]);
    expect(sorted.map((m) => m.membershipId)).toEqual(['a', 'z']);
  });

  it('does not mutate what it was handed', () => {
    const input = [member({ membershipId: 'a' }), member({ membershipId: 'b', isOnline: true })];
    sortRoster(input);
    expect(input.map((m) => m.membershipId)).toEqual(['a', 'b']);
  });
});

describe('defaultSelection', () => {
  const roster = Array.from({ length: 20 }, (_, i) =>
    member({ membershipId: 'm' + i, isOnline: i >= 15, lastOnline: i })
  );

  it('preselects a fireteam, not the whole clan', () => {
    expect(defaultSelection(roster)).toHaveLength(FIRETEAM_SIZE);
  });

  it('preselects the people who are online', () => {
    expect(defaultSelection(roster).slice(0, 5)).toEqual(['m19', 'm18', 'm17', 'm16', 'm15']);
  });

  it('takes everybody when the clan is smaller than a fireteam', () => {
    expect(defaultSelection(roster.slice(0, 3))).toHaveLength(3);
  });

  it('handles an empty roster and a zero size', () => {
    expect(defaultSelection([])).toEqual([]);
    expect(defaultSelection(roster, 0)).toEqual([]);
    expect(defaultSelection(roster, -3)).toEqual([]);
  });
});

describe('toggleSelected', () => {
  it('adds somebody who is not picked', () => {
    expect(toggleSelected(['a'], 'b')).toEqual(['a', 'b']);
  });

  it('removes somebody who is', () => {
    expect(toggleSelected(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });

  it('refuses a seventh, because a fireteam is six', () => {
    const full = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(toggleSelected(full, 'g')).toEqual(full);
  });

  it('still lets a full fireteam be unpicked', () => {
    const full = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(toggleSelected(full, 'c')).toEqual(['a', 'b', 'd', 'e', 'f']);
  });

  it('never mutates the array it was given', () => {
    const before = ['a'];
    toggleSelected(before, 'b');
    expect(before).toEqual(['a']);
  });
});

describe('selectedMembers', () => {
  it('returns the picks in roster order, not in click order', () => {
    const roster = [
      member({ membershipId: 'a', lastOnline: 1 }),
      member({ membershipId: 'b', lastOnline: 9 }),
      member({ membershipId: 'c', isOnline: true })
    ];
    expect(selectedMembers(roster, ['a', 'c']).map((m) => m.membershipId)).toEqual(['c', 'a']);
  });

  it('ignores an id that is not on the roster any more', () => {
    expect(selectedMembers([member({ membershipId: 'a' })], ['a', 'gone'])).toHaveLength(1);
  });
});

describe('requestBudget', () => {
  it('charges one profile call plus one per character', () => {
    expect(requestBudget(1)).toEqual({ min: 2, max: 1 + MAX_CHARACTERS });
    expect(requestBudget(6)).toEqual({ min: 12, max: 24 });
  });

  it('costs nothing for nobody', () => {
    expect(requestBudget(0)).toEqual({ min: 0, max: 0 });
    expect(requestBudget(-2)).toEqual({ min: 0, max: 0 });
  });

  it('says the range in words, because the reader is spending a shared limit', () => {
    expect(describeBudget(6)).toBe('about 12 to 24 requests');
    expect(describeBudget(0)).toBe('no requests');
  });
});

describe('progressLabel', () => {
  it('counts players read, not requests made', () => {
    expect(progressLabel(0, 6)).toBe('Read 0 of 6 players...');
    expect(progressLabel(3, 6)).toBe('Read 3 of 6 players...');
  });

  it('stops counting once everything is in', () => {
    expect(progressLabel(6, 6)).toBe('Finishing up...');
    expect(progressLabel(9, 6)).toBe('Finishing up...');
  });

  it('has something to say before the total is known', () => {
    expect(progressLabel(0, 0)).toBe('Reading players...');
  });
});

describe('mapSettledWithLimit', () => {
  /** Resolves when told to, so the test controls exactly what is in flight. */
  function gate() {
    let open!: () => void;
    const promise = new Promise<void>((resolve) => {
      open = resolve;
    });
    return { promise, open };
  }

  it('keeps results in input order however they finish', async () => {
    const out = await mapSettledWithLimit([30, 10, 20], 3, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });
    expect(out).toEqual([
      { ok: true, value: 30 },
      { ok: true, value: 10 },
      { ok: true, value: 20 }
    ]);
  });

  it('never runs more than the limit at once', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapSettledWithLimit(Array.from({ length: 12 }, (_, i) => i), 3, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return null;
    });
    expect(peak).toBe(3);
  });

  it('does actually run them in parallel, not one after another', async () => {
    const gates = [gate(), gate(), gate()];
    let started = 0;
    const running = mapSettledWithLimit(gates, 3, async (g) => {
      started += 1;
      await g.promise;
      return true;
    });
    await Promise.resolve();
    expect(started).toBe(3);
    for (const g of gates) g.open();
    expect(await running).toHaveLength(3);
  });

  it('lets the good results through when one of them fails', async () => {
    // A private profile is common. Losing five players because the sixth would
    // not answer is the wrong trade, so a failure is an entry, not a rejection.
    const out = await mapSettledWithLimit([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('private');
      return n;
    });
    expect(out[0]).toEqual({ ok: true, value: 1 });
    expect(out[1].ok).toBe(false);
    expect(out[2]).toEqual({ ok: true, value: 3 });
  });

  it('reports progress once per player, in order of completion', async () => {
    const seen: number[] = [];
    await mapSettledWithLimit([1, 2, 3, 4], 2, async () => null, (done) => seen.push(done));
    expect(seen).toEqual([1, 2, 3, 4]);
  });

  it('counts a failure as progress too, or the bar would stall', async () => {
    const seen: [number, number][] = [];
    await mapSettledWithLimit(
      [1, 2],
      1,
      async (n) => {
        if (n === 1) throw new Error('no');
        return n;
      },
      (done, total) => seen.push([done, total])
    );
    expect(seen).toEqual([
      [1, 2],
      [2, 2]
    ]);
  });

  it('does nothing at all for an empty list', async () => {
    const worker = vi.fn();
    expect(await mapSettledWithLimit([], 4, worker)).toEqual([]);
    expect(worker).not.toHaveBeenCalled();
  });

  it('treats a nonsense limit as one at a time rather than none', async () => {
    const out = await mapSettledWithLimit([1, 2], 0, async (n) => n);
    expect(out).toEqual([
      { ok: true, value: 1 },
      { ok: true, value: 2 }
    ]);
  });
});
