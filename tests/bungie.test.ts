/**
 * The retry predicate, and proof that it is actually wired up.
 *
 * This file exists because of a specific bug, shipped in a sibling site and
 * latent in this one: Bungie answers ordinary application errors with HTTP 500
 * and a real ErrorCode in the body, so a retry rule written as `status >= 500`
 * retries every private account, every missing clan and every dead token four
 * times over. The tests below are the description of what must not happen.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUTH_EXPIRY_CODES,
  ERR_API_KEY_MISSING,
  ERR_GROUP_NOT_FOUND,
  ERR_PRIVACY,
  fetchClanRoster,
  isRetriable,
  searchClans
} from '../src/bungie';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AUTH_EXPIRY_CODES', () => {
  it('is exactly the four codes that mean sign in again', () => {
    expect([...AUTH_EXPIRY_CODES].sort((a, b) => a - b)).toEqual([99, 2111, 2123, 2124]);
  });
});

describe('isRetriable', () => {
  it('never retries an expired sign-in, whatever the HTTP status says', () => {
    for (const code of AUTH_EXPIRY_CODES) {
      expect(isRetriable(code, 500), String(code)).toBe(false);
      expect(isRetriable(code, 401), String(code)).toBe(false);
    }
  });

  it('never retries an ordinary application error that arrived as a 500', () => {
    // Every one of these is a real answer. Asking again gets the same answer,
    // four times slower, having spent four times the shared rate limit.
    expect(isRetriable(ERR_PRIVACY, 500)).toBe(false);
    expect(isRetriable(ERR_GROUP_NOT_FOUND, 500)).toBe(false);
    expect(isRetriable(1601, 500)).toBe(false);
    expect(isRetriable(2101, 500)).toBe(false);
  });

  it('retries the spurious missing key, which is the reason retries exist', () => {
    expect(isRetriable(ERR_API_KEY_MISSING, 500)).toBe(true);
  });

  it('retries throttling and maintenance, which do clear on their own', () => {
    expect(isRetriable(5, 500)).toBe(true); // SystemDisabled
    expect(isRetriable(1672, 500)).toBe(true); // DestinyThrottledByGameServer
    expect(isRetriable(31, 500)).toBe(true);
    expect(isRetriable(51, 500)).toBe(true);
    expect(isRetriable(57, 500)).toBe(true);
    expect(isRetriable(58, 500)).toBe(false);
  });

  it('lets the status speak only when Bungie gave no code at all', () => {
    expect(isRetriable(0, 502)).toBe(true);
    expect(isRetriable(0, 0)).toBe(true); // a thrown fetch or a timeout
    expect(isRetriable(0, 404)).toBe(false);
  });
});

describe('the retry loop as wired up', () => {
  function stubOnce(body: unknown, status = 500) {
    const fetchMock = vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body
    }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('asks once for a dead token rather than four times', async () => {
    const fetchMock = stubOnce({ ErrorCode: 2111, ErrorStatus: 'AccessTokenHasExpired' });
    await expect(searchClans('Math Class')).rejects.toMatchObject({ code: 2111 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('asks once for a clan that does not exist', async () => {
    const fetchMock = stubOnce({ ErrorCode: 622, ErrorStatus: 'GroupNotFound' });
    await expect(searchClans('Nope')).rejects.toMatchObject({ code: 622 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does retry a gateway failure that carries no Bungie error at all', async () => {
    const fetchMock = stubOnce({}, 503);
    await expect(searchClans('Math Class')).rejects.toBeInstanceOf(Error);
    // One attempt plus the two retries these one-shot calls are allowed.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('sends the site key so nobody is asked to make one', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ErrorCode: 1,
        Response: { results: [{ groupId: '881267', name: 'Math Class', memberCount: 96 }] }
      })
    }));
    vi.stubGlobal('fetch', fetchMock);
    const clans = await searchClans('  math class  ');
    expect(clans).toEqual([
      { groupId: '881267', name: 'Math Class', memberCount: 96, motto: '' }
    ]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://www.bungie.net/Platform/GroupV2/Search/');
    expect((init.headers as Record<string, string>)['X-API-Key']).toMatch(/^[0-9a-f]{32}$/);
    // Trimmed, and the body is the measured shape: exact name, clans only.
    expect(JSON.parse(String(init.body))).toEqual({
      name: 'math class',
      groupType: 1,
      creationDate: 0,
      sortBy: 0,
      page: 0
    });
  });
});

describe('the roster walk as wired up', () => {
  /** The smallest entry parseRosterMember will accept, with a unique id. */
  function rosterEntry(n: number): unknown {
    return {
      memberType: 2,
      isOnline: false,
      lastOnlineStatusChange: String(1000 + n),
      destinyUserInfo: {
        membershipType: 3,
        membershipId: 'id-' + n,
        bungieGlobalDisplayName: 'Guardian' + n,
        bungieGlobalDisplayNameCode: 1
      }
    };
  }

  /** Serves each body once, in order, and records the URLs asked for. */
  function stubPages(...bodies: unknown[]) {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      urls.push(String(url));
      const body = bodies[Math.min(urls.length - 1, bodies.length - 1)];
      return { ok: true, status: 200, json: async () => ({ ErrorCode: 1, Response: body }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    return { fetchMock, urls };
  }

  it('follows the second page of a big clan instead of silently stopping', async () => {
    const first = Array.from({ length: 100 }, (_, i) => rosterEntry(i));
    const second = Array.from({ length: 40 }, (_, i) => rosterEntry(100 + i));
    const { fetchMock, urls } = stubPages(
      { results: first, totalResults: 140, hasMore: true },
      { results: second, totalResults: 140, hasMore: false }
    );
    const members = await fetchClanRoster('881267');
    expect(members).toHaveLength(140);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // currentpage is 1-based. Asking for page 0 gets page 1 again, which is
    // the sort of off-by-one that looks like it works on a one page clan.
    expect(urls[0]).toContain('/GroupV2/881267/Members/?currentpage=1');
    expect(urls[1]).toContain('/GroupV2/881267/Members/?currentpage=2');
  });

  it('asks for exactly one page when Bungie counts an entry the picker drops', async () => {
    // A clan can hold a bungie.net account that never played Destiny. Bungie's
    // totalResults counts it; parseRosterMember drops it. The walk has to
    // count raw entries the way the server does, or every roster holding one
    // of these ends by paying for one more page that is always empty.
    const { fetchMock } = stubPages({
      results: [rosterEntry(1), { memberType: 2 }, rosterEntry(2)],
      totalResults: 3,
      hasMore: false
    });
    const members = await fetchClanRoster('881267');
    expect(members).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('lists a member the pages disagree about once, not twice', async () => {
    // Somebody joining or leaving between two page reads shifts everybody
    // else by one, so the same member can arrive on both pages.
    const first = Array.from({ length: 100 }, (_, i) => rosterEntry(i));
    const second = [rosterEntry(99), ...Array.from({ length: 39 }, (_, i) => rosterEntry(100 + i))];
    stubPages(
      { results: first, totalResults: 140, hasMore: true },
      { results: second, totalResults: 140, hasMore: false }
    );
    const members = await fetchClanRoster('881267');
    expect(members).toHaveLength(139);
    expect(members.filter((m) => m.membershipId === 'id-99')).toHaveLength(1);
  });

  it('reports progress in members held, against the server total', async () => {
    const seen: [number, number][] = [];
    stubPages({
      results: [rosterEntry(1), { memberType: 2 }, rosterEntry(2)],
      totalResults: 3,
      hasMore: false
    });
    await fetchClanRoster('881267', (collected, total) => seen.push([collected, total]));
    expect(seen).toEqual([[2, 3]]);
  });
});
