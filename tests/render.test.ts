/**
 * Render smoke tests.
 *
 * The pure modules are covered in detail elsewhere; these exist so a mistake in
 * the DOM building shows up as a failing test rather than a blank page. The
 * network is stubbed to fail, which also exercises the path where the manifest
 * is unreachable and the committed fallback table is used.
 */

// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, toMatrixRows } from '../src/ui/app';
import { renderMatrix, heatClass } from '../src/ui/matrix';
import { renderSummaries } from '../src/ui/summary';
import { renderRecommendations } from '../src/ui/recommendations';
import { recommend } from '../src/recommend';
import { FALLBACK_ACTIVITIES } from '../src/fallback-activities';
import { demoPlayers } from '../src/demo';
import realDefs from '../fixtures/activity-defs.json';

const DEF_PATH = '/common/destiny2_content/json/en/DestinyActivityDefinition-test.json';

/** A manifest response shaped exactly like the real one. */
const manifestBody = {
  Response: {
    version: realDefs.manifestVersion,
    jsonWorldComponentContentPaths: { en: { DestinyActivityDefinition: DEF_PATH } }
  },
  ErrorCode: 1
};

/** The definition file is keyed by hash, same as Bungie serves it. */
const definitionsBody = Object.fromEntries(
  realDefs.definitions.map((d) => [String(d.hash), d])
);

const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

/** Serves the manifest and the definitions, and nothing else. */
function stubNetwork(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      String(url).includes('/Platform/Destiny2/Manifest/')
        ? json(manifestBody)
        : json(definitionsBody)
    )
  );
}

async function waitFor(check: () => boolean, timeoutMs = 8000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('timed out waiting for the app to settle');
}

async function mountApp(): Promise<HTMLElement> {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app') as HTMLElement;
  mount(root);
  await waitFor(() => (root.querySelector('#catalog-note')?.textContent ?? '').length > 0);
  return root;
}

beforeEach(() => {
  localStorage.clear();
  stubNetwork();
});

describe('heatClass', () => {
  it('maps counts onto the ramp', () => {
    expect(heatClass(0)).toBe('h0');
    expect(heatClass(1)).toBe('h1');
    expect(heatClass(3)).toBe('h2');
    expect(heatClass(7)).toBe('h3');
    expect(heatClass(15)).toBe('h4');
    expect(heatClass(40)).toBe('h5');
  });
});

describe('toMatrixRows', () => {
  it('builds one row per activity aligned to the usable players', () => {
    const players = demoPlayers();
    const rows = toMatrixRows(FALLBACK_ACTIVITIES, players);
    expect(rows).toHaveLength(FALLBACK_ACTIVITIES.length);
    expect(rows[0].counts).toHaveLength(6);
  });

  it('leaves players with a problem out of the counts', () => {
    const players = demoPlayers();
    players[0] = { ...players[0], problem: 'private' };
    const rows = toMatrixRows(FALLBACK_ACTIVITIES, players);
    expect(rows[0].counts).toHaveLength(5);
  });
});

describe('renderMatrix', () => {
  it('renders both a table and a stacked list', () => {
    const frag = renderMatrix(FALLBACK_ACTIVITIES, demoPlayers());
    const host = document.createElement('div');
    host.append(frag);
    expect(host.querySelector('table.matrix')).not.toBeNull();
    expect(host.querySelector('.stack')).not.toBeNull();
  });

  it('gives the table one body row per activity plus a heading per category', () => {
    const host = document.createElement('div');
    host.append(renderMatrix(FALLBACK_ACTIVITIES, demoPlayers()));
    const rows = host.querySelectorAll('table.matrix tbody tr');
    expect(rows.length).toBe(FALLBACK_ACTIVITIES.length + 3);
  });

  it('shows a question mark rather than a zero for a private player', () => {
    const players = demoPlayers();
    players[0] = { ...players[0], problem: 'private', clears: {} };
    const host = document.createElement('div');
    host.append(renderMatrix(FALLBACK_ACTIVITIES, players));
    const firstCell = host.querySelector('table.matrix tbody tr:nth-child(2) td .cell');
    expect(firstCell?.textContent).toBe('?');
  });

  it('asks for players when the fireteam is empty', () => {
    const host = document.createElement('div');
    host.append(renderMatrix(FALLBACK_ACTIVITIES, []));
    expect(host.querySelector('.empty')).not.toBeNull();
  });
});

describe('renderSummaries', () => {
  it('renders one card per player', () => {
    const host = document.createElement('div');
    host.append(renderSummaries(demoPlayers(), FALLBACK_ACTIVITIES));
    expect(host.querySelectorAll('.pcard')).toHaveLength(6);
  });

  it('says why a private player has no numbers instead of showing zero', () => {
    const players = demoPlayers();
    players[0] = { ...players[0], problem: 'private', problemDetail: 'Stats are private.' };
    const host = document.createElement('div');
    host.append(renderSummaries(players, FALLBACK_ACTIVITIES));
    const card = host.querySelector('.pcard');
    expect(card?.querySelector('.problem')?.textContent).toBe('Stats are private.');
    expect(card?.textContent).not.toContain('Raid clears');
  });
});

describe('renderRecommendations', () => {
  it('renders a card per recommendation and explains the ranking', () => {
    const players = demoPlayers();
    const recs = recommend(
      toMatrixRows(FALLBACK_ACTIVITIES, players),
      players.map((p) => p.ref.name)
    );
    const host = document.createElement('div');
    host.append(renderRecommendations(recs));
    expect(host.querySelectorAll('.rec')).toHaveLength(recs.length);
    expect(host.querySelector('.rank-note')).not.toBeNull();
  });

  it('says so plainly when nothing stands out', () => {
    const host = document.createElement('div');
    host.append(renderRecommendations([]));
    expect(host.querySelector('.empty')?.textContent).toContain('Nothing stands out');
  });
});

describe('mounting the whole app', () => {
  it('renders the demo fireteam when there is no API key', async () => {
    const root = await mountApp();
    expect(root.querySelector('#mode-pill')?.textContent).toContain('Demo mode');
    expect(root.querySelectorAll('.pcard')).toHaveLength(6);
    expect(root.querySelectorAll('.rec').length).toBeGreaterThan(0);
    expect(root.querySelector('table.matrix')).not.toBeNull();
  });

  it('derives the activity list from the manifest it fetched', async () => {
    const root = await mountApp();
    const note = root.querySelector('#catalog-note')?.textContent ?? '';
    expect(note).toContain('14 raids and 9 dungeons');
    expect(note).toContain('derived from the live manifest');
  });

  it('caches the derived list against the manifest version', async () => {
    await mountApp();
    const cached = JSON.parse(localStorage.getItem('fireteam-report.manifest') ?? '{}');
    expect(cached.version).toBe(realDefs.manifestVersion);
    expect(cached.groups).toHaveLength(FALLBACK_ACTIVITIES.length);
  });

  it('reuses the cache instead of refetching when the version is unchanged', async () => {
    await mountApp();
    const first = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(first).toBe(2);
    await mountApp();
    const second = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    // Only the manifest is checked the second time, not the 11 MB definitions.
    expect(second - first).toBe(1);
  });

  it('starts the fireteam form with two empty slots', async () => {
    const root = await mountApp();
    expect(root.querySelectorAll('.slot input')).toHaveLength(2);
  });

  it('does not write anything to localStorage beyond the manifest cache', async () => {
    await mountApp();
    const keys = Object.keys(localStorage);
    for (const key of keys) {
      expect(['fireteam-report.manifest', 'fireteam-report.apikey']).toContain(key);
    }
  });

  it('offers the permalink and Discord buttons', async () => {
    const root = await mountApp();
    expect(root.querySelector('#copy-link')).not.toBeNull();
    expect(root.querySelector('#copy-discord')).not.toBeNull();
  });
});

describe('when bungie.net cannot be reached', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  });

  it('falls back to the activity list bundled with the site', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app') as HTMLElement;
    mount(root);
    await waitFor(() => (root.querySelector('#catalog-note')?.textContent ?? '').length > 0);
    const note = root.querySelector('#catalog-note')?.textContent ?? '';
    expect(note).toContain('14 raids and 9 dungeons');
    expect(note).toContain('bundled with the site');
    expect(root.querySelector('#catalog-note .notice')?.textContent).toContain(
      'Could not reach bungie.net'
    );
    expect(root.querySelectorAll('.pcard')).toHaveLength(6);
  });
});
