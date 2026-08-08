/**
 * Vendored from d2-auth/src/client.ts. Do not edit here.
 *
 * The upstream copy at https://github.com/keivanmalhani/d2-auth is the one that
 * matters; this is a byte copy of it with this header on top, because the sites
 * that use it are separate repositories and sharing a hundred lines through a
 * published package would cost more than it saves. What actually has to agree
 * between the sites is the sessionStorage key and its JSON shape, both of which
 * are documented below. Changes belong upstream and then get re-copied.
 */

/**
 * What the other sites copy in. Deliberately dependency-free.
 *
 * These sites are separate repositories with separate builds, so sharing code
 * between them would mean publishing a package and versioning it, for about a
 * hundred lines. They do share an origin, though, which means they share
 * sessionStorage, so the real contract between them is not a package at all:
 * it is the shape of one storage key.
 *
 * So this file gets vendored into each site as src/auth.ts. It is small enough
 * to read in one sitting, and a site that drifts from it still works, because
 * the only thing that has to agree is the key name and the JSON shape below.
 *
 *   Key:   d2.session
 *   Value: { accessToken: string, expiresAt: number, membershipId: string }
 *
 * Sign-in itself lives at /d2-auth/ and is not duplicated here.
 */

export const SESSION_KEY = 'd2.session';
export const PENDING_KEY = 'd2.oauth.pending';
export const CALLBACK = '/d2-auth/';
export const CLIENT_ID = '54326';

/**
 * The application's key, and it is public on purpose.
 *
 * A browser has to send this with every request, so it is readable by anyone
 * who opens the page source. That is true of every static Destiny tool. It is
 * not a secret that can be kept, only one that can be rotated, and the only
 * cost of it leaking is that rate limits are shared.
 */
export const API_KEY = 'fe8c4f1f1a404e2e80b9e61924352167';

export const API_ROOT = 'https://www.bungie.net/Platform';

/** A minute of slack, so a request cannot expire while it is in flight. */
const SKEW_MS = 60_000;

export interface Session {
  accessToken: string;
  expiresAt: number;
  membershipId: string;
}

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;   // private mode on some browsers throws rather than returning null
  }
}

/** The signed-in session, or null if there is not a usable one. */
export function getSession(now = Date.now()): Session | null {
  const raw = storage()?.getItem(SESSION_KEY);
  if (!raw) return null;
  let session: Session;
  try {
    session = JSON.parse(raw) as Session;
  } catch {
    storage()?.removeItem(SESSION_KEY);
    return null;
  }
  if (typeof session?.accessToken !== 'string' || typeof session?.expiresAt !== 'number') {
    storage()?.removeItem(SESSION_KEY);
    return null;
  }
  if (now >= session.expiresAt - SKEW_MS) {
    storage()?.removeItem(SESSION_KEY);
    return null;
  }
  return session;
}

export function signedIn(now = Date.now()): boolean {
  return getSession(now) !== null;
}

/** Whole minutes of session left. Worth showing, because an hour is not long. */
export function minutesLeft(now = Date.now()): number {
  const session = getSession(now);
  if (!session) return 0;
  return Math.max(0, Math.floor((session.expiresAt - SKEW_MS - now) / 60_000));
}

export function signOut(): void {
  storage()?.removeItem(SESSION_KEY);
  storage()?.removeItem(PENDING_KEY);
}

function randomState(): string {
  let out = '';
  while (out.length < 32) out += Math.floor(Math.random() * 0xffffffff).toString(16);
  return out.slice(0, 32);
}

/**
 * Leave for Bungie. Comes back to /d2-auth/, which returns here.
 *
 * The pending record is what the callback checks the returned state against,
 * so if it cannot be written the flow cannot be verified on return and is not
 * worth starting.
 */
export function signIn(returnTo = location.pathname + location.search + location.hash): void {
  const store = storage();
  if (!store) {
    throw new Error(
      'This browser will not let the page store anything, so sign-in cannot ' +
        'complete safely. Private browsing sometimes does this.',
    );
  }
  const state = randomState();
  const safe = returnTo.startsWith('/') && !returnTo.startsWith('//') && !returnTo.includes('\\')
    ? returnTo
    : '/';
  store.setItem(PENDING_KEY, JSON.stringify({ state, returnTo: safe }));
  location.assign(
    'https://www.bungie.net/en/OAuth/Authorize?' +
      new URLSearchParams({ client_id: CLIENT_ID, response_type: 'code', state }).toString(),
  );
}

export class ApiError extends Error {
  constructor(message: string, readonly code = 0, readonly status = 0) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface CallOptions {
  /** Send the signed-in user's token. Required for vault and collections. */
  authenticated?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * One GET against the Platform API.
 *
 * Every request carries a deadline. A refused connection fails fast, but one
 * that is accepted and never answered hangs forever and leaves the page on a
 * spinner with no way out, which is a thing captive portals and flaky mobile
 * connections do routinely.
 */
export async function api<T>(path: string, options: CallOptions = {}): Promise<T> {
  const { authenticated = false, timeoutMs = 15_000 } = options;
  const headers: Record<string, string> = { 'X-API-Key': API_KEY, Accept: 'application/json' };

  if (authenticated) {
    const session = getSession();
    if (!session) throw new ApiError('Not signed in, or the session has expired.', 0, 401);
    headers.Authorization = 'Bearer ' + session.accessToken;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  options.signal?.addEventListener('abort', () => controller.abort());

  let response: Response;
  try {
    response = await fetch(API_ROOT + path, { headers, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError('bungie.net did not answer in time.', 0, 0);
    }
    throw new ApiError('Could not reach bungie.net.', 0, 0);
  } finally {
    clearTimeout(timer);
  }

  let payload: { Response?: T; ErrorCode?: number; ErrorStatus?: string; Message?: string } = {};
  try {
    payload = await response.json();
  } catch {
    throw new ApiError('bungie.net returned something that was not JSON.', 0, response.status);
  }

  // 1 is Success. Everything else has a name worth showing rather than hiding.
  if (payload.ErrorCode !== undefined && payload.ErrorCode !== 1) {
    throw new ApiError(
      explain(payload.ErrorStatus ?? '', payload.Message ?? ''),
      payload.ErrorCode,
      response.status,
    );
  }
  if (!response.ok) throw new ApiError('bungie.net returned HTTP ' + response.status, 0, response.status);
  return payload.Response as T;
}

/** Bungie's error names in words a player would use. */
function explain(status: string, message: string): string {
  switch (status) {
    case 'DestinyPrivacyRestriction':
      return 'That account keeps its history private, so there is nothing to read.';
    case 'DestinyAccountNotFound':
    case 'UserCannotResolveCentralAccount':
      return 'No Destiny account under that name.';
    case 'WebAuthRequired':
    case 'AuthorizationRecordExpired':
    case 'AccessTokenHasExpired':
      return 'That sign-in has expired. Signing in again takes a moment.';
    case 'PerEndpointRequestThrottleExceeded':
    case 'ThrottleLimitExceededMomentarily':
      return 'bungie.net is rate limiting us. Give it a few seconds.';
    case 'SystemDisabled':
      return 'Bungie has that part of the API switched off right now, which usually means maintenance.';
    default:
      return message || status || 'bungie.net refused the request.';
  }
}
