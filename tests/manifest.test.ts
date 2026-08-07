/**
 * Manifest loading, with the network misbehaving in the ways it actually does.
 *
 * The case that matters most here is a request that is accepted and then never
 * answered. A refused request fails fast and reaches the fallback on its own; a
 * hung one will sit there forever unless something cuts it off, which leaves
 * the page on a spinner with no way out.
 */

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadActivityCatalog } from '../src/manifest';
import { FALLBACK_ACTIVITIES } from '../src/fallback-activities';
import realDefs from '../fixtures/activity-defs.json';

const DEF_PATH = '/common/destiny2_content/json/en/DestinyActivityDefinition-test.json';
const manifestBody = {
  Response: {
    version: realDefs.manifestVersion,
    jsonWorldComponentContentPaths: { en: { DestinyActivityDefinition: DEF_PATH } }
  },
  ErrorCode: 1
};
const definitionsBody = Object.fromEntries(realDefs.definitions.map((d) => [String(d.hash), d]));
const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

/**
 * A request that is accepted and then never answered, but which does honour an
 * abort signal, exactly like a real connection held open by a captive portal.
 * Without a deadline this promise never settles.
 */
const hangUntilAborted = (..._args: unknown[]): Promise<Response> => {
  const init = _args[1] as RequestInit | undefined;
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      const err = new Error('The operation was aborted.');
      err.name = 'AbortError';
      reject(err);
    });
  });
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('a healthy network', () => {
  it('derives the catalog from the manifest', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).includes('/Manifest/') ? json(manifestBody) : json(definitionsBody)
      )
    );
    const catalog = await loadActivityCatalog();
    expect(catalog.source).toBe('network');
    expect(catalog.groups).toHaveLength(FALLBACK_ACTIVITIES.length);
  });

  it('passes an abort signal on every request', async () => {
    const spy = vi.fn(async (url: string) =>
      String(url).includes('/Manifest/') ? json(manifestBody) : json(definitionsBody)
    );
    vi.stubGlobal('fetch', spy);
    await loadActivityCatalog();
    for (const call of spy.mock.calls) {
      const init = (call as unknown[])[1] as RequestInit;
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });
});

describe('a refused network', () => {
  it('falls back to the bundled list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ERR_CONNECTION_RESET')));
    const catalog = await loadActivityCatalog();
    expect(catalog.source).toBe('fallback');
    expect(catalog.note).toContain('Could not reach bungie.net');
    expect(catalog.groups).toHaveLength(FALLBACK_ACTIVITIES.length);
  });
});

describe('a network that accepts the connection and never answers', () => {
  it('gives up rather than hanging, and still renders an activity list', async () => {
    vi.useFakeTimers();
    // Honours the abort signal, like a real hung request behind a captive
    // portal. Without a deadline this promise never settles.
    vi.stubGlobal('fetch', vi.fn(hangUntilAborted));

    const pending = loadActivityCatalog();
    // Well past every attempt and its backoff.
    await vi.advanceTimersByTimeAsync(120000);
    const catalog = await pending;

    expect(catalog.source).toBe('fallback');
    expect(catalog.note).toContain('did not answer in time');
    expect(catalog.groups).toHaveLength(FALLBACK_ACTIVITIES.length);
  });

  it('falls back to the cached list when there is one', async () => {
    localStorage.setItem(
      'fireteam-report.manifest',
      JSON.stringify({ version: 'cached-version', groups: FALLBACK_ACTIVITIES.slice(0, 3) })
    );
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(hangUntilAborted));

    const pending = loadActivityCatalog();
    await vi.advanceTimersByTimeAsync(120000);
    const catalog = await pending;

    expect(catalog.source).toBe('cache');
    expect(catalog.groups).toHaveLength(3);
  });
});
