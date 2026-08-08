/**
 * The sign-in module, which is entirely pure functions over one session object.
 *
 * These exist because the alternative is finding out what the page says about
 * an expired hour by expiring an hour.
 */

import { describe, expect, it } from 'vitest';
import { ApiError, type Session } from '../src/auth';
import { BungieError } from '../src/bungie';
import {
  EXPIRING_MINUTES,
  failureText,
  getOwnPlayer,
  isSessionExpiry,
  pickOwnMembership,
  signInView,
  type ApiCall
} from '../src/signin';

const session: Session = {
  accessToken: 'token',
  expiresAt: 0,
  membershipId: '4583459'
};

describe('signInView', () => {
  it('offers sign-in and says what it buys when nobody is signed in', () => {
    const view = signInView(null, 0);
    expect(view.kind).toBe('signed-out');
    expect(view.showSignIn).toBe(true);
    expect(view.showMine).toBe(false);
    expect(view.note).toBe('Sign in to add yourself and your clan without typing names.');
  });

  it('promises nothing more than not having to type a name', () => {
    // The sign-in buys one thing. Claiming more would be a lie a player finds
    // out about, and there is nothing else honest to claim: every stats call
    // this site makes works signed out.
    const note = signInView(null, 0).note;
    expect(note).not.toMatch(/faster|better|more data|private|full|required|needed/i);
  });

  it('swaps the buttons over once there is a session', () => {
    const view = signInView(session, 59);
    expect(view.kind).toBe('signed-in');
    expect(view.showSignIn).toBe(false);
    expect(view.showMine).toBe(true);
  });

  it('says how many minutes are left and that they cannot be extended', () => {
    const view = signInView(session, 59);
    expect(view.note).toContain('59 minutes');
    expect(view.note).toContain('cannot be renewed');
  });

  it('changes tone under five minutes', () => {
    expect(signInView(session, EXPIRING_MINUTES + 1).kind).toBe('signed-in');
    expect(signInView(session, EXPIRING_MINUTES).kind).toBe('expiring');
    expect(signInView(session, EXPIRING_MINUTES).note).toContain('5 minutes left');
  });

  it('reads as one minute rather than one minutes', () => {
    expect(signInView(session, 1).note).toContain('about 1 minute left');
  });

  it('says the last minute is the last minute', () => {
    const view = signInView(session, 0);
    expect(view.kind).toBe('expiring');
    expect(view.note).toContain('within the minute');
    expect(view.showMine).toBe(true);
  });

  it('clamps a negative or fractional count rather than printing it', () => {
    expect(signInView(session, -4).minutesLeft).toBe(0);
    expect(signInView(session, 12.9).minutesLeft).toBe(12);
    expect(signInView(session, 12.9).note).toContain('12 minutes');
  });

  it('reports no minutes at all when signed out', () => {
    expect(signInView(null, 45).minutesLeft).toBe(0);
  });
});

describe('isSessionExpiry', () => {
  it('recognises auth.ts refusing a call it knows has lapsed', () => {
    expect(isSessionExpiry(new ApiError('Not signed in, or the session has expired.', 0, 401))).toBe(
      true
    );
  });

  it('recognises every platform code that means the token is done', () => {
    // WebAuthRequired, AccessTokenHasExpired, AuthorizationRecordExpired,
    // AuthorizationRecordRevoked. Bungie sends all four as HTTP 500.
    for (const code of [99, 2111, 2123, 2124]) {
      expect(isSessionExpiry(new ApiError('nope', code, 500)), String(code)).toBe(true);
      expect(isSessionExpiry(new BungieError('nope', code, 500)), String(code)).toBe(true);
    }
  });

  it('does not mistake other failures for an expired hour', () => {
    expect(isSessionExpiry(new BungieError('private', 1665, 500))).toBe(false);
    expect(isSessionExpiry(new BungieError('nobody', 1601, 500))).toBe(false);
    expect(isSessionExpiry(new BungieError('no clan', 622, 500))).toBe(false);
    expect(isSessionExpiry(new Error('offline'))).toBe(false);
    expect(isSessionExpiry(null)).toBe(false);
  });
});

describe('failureText', () => {
  it('offers the sign-in again instead of showing a code', () => {
    const { title, body } = failureText(new BungieError('AccessTokenHasExpired', 2111, 500));
    expect(title).toBe('That sign-in has run out');
    expect(body).toContain('Sign in again');
    expect(body).not.toContain('AccessTokenHasExpired');
  });

  it('still explains a private account', () => {
    expect(failureText(new BungieError('x', 1665, 500)).title).toBe('This account is private');
  });

  it('still explains a name that matched nothing', () => {
    const { title, body } = failureText(new BungieError('x', 1601, 500));
    expect(title).toBe('No account by that name');
    expect(body).toContain('Guardian#1234');
  });

  it('blames the site rather than the reader when the shared key is rejected', () => {
    const { title, body } = failureText(new BungieError('ApiInvalidOrExpiredKey', 2101, 500));
    expect(title).toBe('This site cannot talk to Bungie');
    expect(body).toContain('fault here');
  });

  it('says the rate limit is shared, because that is why it happened', () => {
    const { title, body } = failureText(new BungieError('throttled', 51, 500));
    expect(title).toBe('Bungie is rate limiting us');
    expect(body).toContain('shared');
  });

  it('shows an unknown platform message rather than swallowing it', () => {
    expect(failureText(new BungieError('Something odd', 1234, 500)).body).toBe('Something odd');
  });

  it('has something to say about a thrown value it has never seen', () => {
    expect(failureText('whoops').title).toBe('That did not work');
  });
});

describe('pickOwnMembership', () => {
  it('takes the membership Bungie names as the cross save primary', () => {
    const picked = pickOwnMembership({
      primaryMembershipId: 'b',
      destinyMemberships: [
        { membershipType: 1, membershipId: 'a' },
        { membershipType: 3, membershipId: 'b' }
      ]
    });
    expect(picked?.membershipId).toBe('b');
  });

  it('falls back to the search path guess when no primary is named', () => {
    const picked = pickOwnMembership({
      destinyMemberships: [
        { membershipType: 1, membershipId: 'a', crossSaveOverride: 3 },
        { membershipType: 3, membershipId: 'b', crossSaveOverride: 3 }
      ]
    });
    expect(picked?.membershipId).toBe('b');
  });

  it('falls back when the named primary is not in the list', () => {
    const picked = pickOwnMembership({
      primaryMembershipId: 'missing',
      destinyMemberships: [{ membershipType: 1, membershipId: 'a' }]
    });
    expect(picked?.membershipId).toBe('a');
  });

  it('returns null for an account with no Destiny memberships', () => {
    expect(pickOwnMembership({ destinyMemberships: [] })).toBeNull();
    expect(pickOwnMembership({})).toBeNull();
    expect(pickOwnMembership(null)).toBeNull();
  });
});

describe('getOwnPlayer', () => {
  function stub(response: unknown): {
    call: ApiCall;
    seen: { path: string; authenticated?: boolean };
  } {
    const seen = { path: '', authenticated: undefined as boolean | undefined };
    const call = (async (path: string, options?: { authenticated?: boolean }) => {
      seen.path = path;
      seen.authenticated = options?.authenticated;
      return response;
    }) as ApiCall;
    return { call, seen };
  }

  it('reads the signed-in account with the token, not the name search', async () => {
    const { call, seen } = stub({
      primaryMembershipId: '9',
      destinyMemberships: [
        {
          membershipType: 3,
          membershipId: '9',
          bungieGlobalDisplayName: 'Guardian',
          bungieGlobalDisplayNameCode: 42
        }
      ]
    });
    const me = await getOwnPlayer(call);
    expect(seen.path).toBe('/User/GetMembershipsForCurrentUser/');
    expect(seen.authenticated).toBe(true);
    expect(me).toEqual({
      ref: { name: 'Guardian', code: 42 },
      membershipType: 3,
      membershipId: '9'
    });
  });

  it('falls back to the platform display name when there is no Bungie Name', async () => {
    const { call } = stub({
      destinyMemberships: [{ membershipType: 2, membershipId: '7', displayName: 'OldPsnName' }]
    });
    const me = await getOwnPlayer(call);
    expect(me.ref.name).toBe('OldPsnName');
    expect(me.ref.code).toBe(0);
  });

  it('says so when the Bungie account has no Destiny account on it', async () => {
    const { call } = stub({ destinyMemberships: [] });
    await expect(getOwnPlayer(call)).rejects.toMatchObject({ code: 1601 });
  });

  it('lets an expired session through untouched, for failureText to read', async () => {
    const call = (async () => {
      throw new ApiError('Not signed in, or the session has expired.', 0, 401);
    }) as ApiCall;
    await expect(getOwnPlayer(call)).rejects.toSatisfy(isSessionExpiry);
  });
});
