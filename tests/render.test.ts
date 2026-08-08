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
import { renderRecommendations, VISIBLE_RUNNERS_UP } from '../src/ui/recommendations';
import { diversifyRecommendations, headline, recommend } from '../src/recommend';
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
  sessionStorage.clear();
  stubNetwork();
});

/**
 * A session exactly as d2-auth writes it. Seeding storage is the whole of
 * "being signed in" as far as this site is concerned, which is the point of
 * keeping the sign-in itself in another repository.
 */
function seedSession(minutes = 42): void {
  sessionStorage.setItem(
    'd2.session',
    JSON.stringify({
      accessToken: 'seeded-token',
      expiresAt: Date.now() + minutes * 60_000 + 60_000,
      membershipId: '4583459'
    })
  );
}

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
    const firstCell = host.querySelector('table.matrix tbody tr:nth-child(2) td');
    expect(firstCell?.textContent).toBe('?');
    expect(firstCell?.className).toContain('private');
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
    host.append(renderRecommendations(recs, players.length));
    expect(host.querySelectorAll('.rec')).toHaveLength(recs.length);
    expect(host.querySelector('.rank-note')).not.toBeNull();
  });

  it('leads with one sentence, before any card or tag', () => {
    const players = demoPlayers();
    const recs = recommend(
      toMatrixRows(FALLBACK_ACTIVITIES, players),
      players.map((p) => p.ref.name)
    );
    const host = document.createElement('div');
    host.append(renderRecommendations(recs, players.length));
    const line = host.querySelector('.headline');
    expect(line?.textContent).toBe(headline(diversifyRecommendations(recs), players.length));
    // It is the first thing in the section, or it is not a headline.
    expect(host.firstElementChild).toBe(line);
  });

  it('gives the top pick a card of its own and calls the rest runners up', () => {
    const players = demoPlayers();
    const recs = recommend(
      toMatrixRows(FALLBACK_ACTIVITIES, players),
      players.map((p) => p.ref.name)
    );
    const host = document.createElement('div');
    host.append(renderRecommendations(recs, players.length));
    const hero = host.querySelector('.rec.hero');
    expect(hero).not.toBeNull();
    expect(hero?.querySelector('.hero-name')?.textContent).toBe(
      diversifyRecommendations(recs)[0].activity
    );
    expect(host.querySelectorAll('.rec.hero')).toHaveLength(1);
    // Nothing is dropped, only folded.
    expect(host.querySelectorAll('.runners .rec')).toHaveLength(recs.length - 1);
  });

  it('shows a handful of runners up and folds the long tail away', () => {
    const players = demoPlayers();
    const recs = recommend(
      toMatrixRows(FALLBACK_ACTIVITIES, players),
      players.map((p) => p.ref.name)
    );
    expect(recs.length).toBeGreaterThan(VISIBLE_RUNNERS_UP + 1);
    const host = document.createElement('div');
    host.append(renderRecommendations(recs, players.length));
    expect(host.querySelectorAll('.runners > .recs > .rec')).toHaveLength(VISIBLE_RUNNERS_UP);
    const more = host.querySelector('details.more-recs');
    expect((more as HTMLDetailsElement).open).toBe(false);
    expect(more?.querySelectorAll('.rec')).toHaveLength(recs.length - 1 - VISIBLE_RUNNERS_UP);
    expect(more?.querySelector('summary')?.textContent).toBe(
      recs.length - 1 - VISIBLE_RUNNERS_UP + ' more options, ranked lower'
    );
  });

  it('numbers the folded ones as a continuation, not a new list', () => {
    const players = demoPlayers();
    const recs = recommend(
      toMatrixRows(FALLBACK_ACTIVITIES, players),
      players.map((p) => p.ref.name)
    );
    const host = document.createElement('div');
    host.append(renderRecommendations(recs, players.length));
    const ranks = [...host.querySelectorAll('.runners .rec-rank')].map((n) => n.textContent);
    expect(ranks[0]).toBe('2');
    expect(ranks[ranks.length - 1]).toBe(String(recs.length));
  });

  it('does not offer a disclosure when there is no tail to hide', () => {
    const recs = recommend(
      [
        { activity: 'Vault of Glass', category: 'raid' as const, counts: [0, 4] },
        { activity: 'Last Wish', category: 'raid' as const, counts: [9, 8] }
      ],
      ['Ana', 'Rob']
    );
    const host = document.createElement('div');
    host.append(renderRecommendations(recs, 2));
    expect(host.querySelector('details.more-recs')).toBeNull();
  });

  it('folds the ranking rules away rather than putting them before the answer', () => {
    const players = demoPlayers();
    const recs = recommend(
      toMatrixRows(FALLBACK_ACTIVITIES, players),
      players.map((p) => p.ref.name)
    );
    const host = document.createElement('div');
    host.append(renderRecommendations(recs, players.length));
    const details = host.querySelector('details.rank-details');
    expect(details).not.toBeNull();
    expect((details as HTMLDetailsElement).open).toBe(false);
    expect(details?.querySelector('.rank-note')).not.toBeNull();
    expect(details?.querySelector('.rec-tally')).not.toBeNull();
  });

  it('says so plainly when nothing stands out', () => {
    const host = document.createElement('div');
    host.append(renderRecommendations([]));
    expect(host.querySelector('.empty')?.textContent).toContain('Nothing stands out');
    expect(host.querySelector('.headline')?.textContent).toContain('whatever you feel like');
  });
});

describe('mounting the whole app', () => {
  it('renders the demo fireteam with nobody signed in', async () => {
    const root = await mountApp();
    expect(root.querySelector('#mode-pill')?.textContent).toContain('Demo mode');
    expect(root.querySelectorAll('.pcard')).toHaveLength(6);
    expect(root.querySelectorAll('.rec').length).toBeGreaterThan(0);
    expect(root.querySelector('table.matrix')).not.toBeNull();
  });

  it('never asks anybody for an API key', async () => {
    // This used to be a dialog with a seven step recipe in it. Nothing that
    // asks a reader to go and create a credential may come back.
    await mountApp();
    const page = document.body;
    expect(page.querySelector('#apikey-input')).toBeNull();
    expect(page.querySelector('#key-dialog')).toBeNull();
    expect(page.querySelector('#open-key')).toBeNull();
    expect(page.querySelector('input[type=password]')).toBeNull();
    expect(page.textContent ?? '').not.toMatch(/API key|bungie\.net\/en\/Application|Create New App/i);
  });

  it('offers one button instead, and it is the sign-in', async () => {
    const root = await mountApp();
    const button = root.querySelector('#sign-in');
    expect(button?.textContent).toBe('Sign in with Bungie');
    expect((button as HTMLButtonElement).hidden).toBe(false);
    expect((root.querySelector('#sign-out') as HTMLButtonElement).hidden).toBe(true);
    expect((root.querySelector('#add-me') as HTMLButtonElement).hidden).toBe(true);
    expect(root.querySelector('#session-note')?.textContent).toContain('Sign in to add yourself');
  });

  it('shows the session and its shortcuts once there is one', async () => {
    seedSession(42);
    const root = await mountApp();
    expect((root.querySelector('#sign-in') as HTMLButtonElement).hidden).toBe(true);
    expect((root.querySelector('#sign-out') as HTMLButtonElement).hidden).toBe(false);
    expect((root.querySelector('#add-me') as HTMLButtonElement).hidden).toBe(false);
    const note = root.querySelector('#session-note')?.textContent ?? '';
    expect(note).toContain('Signed in');
    expect(note).toMatch(/4[12] minutes/);
    expect(note).toContain('cannot be renewed');
  });

  it('drops the session shortcuts again when it has expired', async () => {
    // An hour old session is not a session. auth.ts refuses to hand it back,
    // and the page must not offer buttons that only work with one.
    sessionStorage.setItem(
      'd2.session',
      JSON.stringify({ accessToken: 't', expiresAt: Date.now() - 1000, membershipId: '1' })
    );
    const root = await mountApp();
    expect((root.querySelector('#sign-in') as HTMLButtonElement).hidden).toBe(false);
    expect((root.querySelector('#add-me') as HTMLButtonElement).hidden).toBe(true);
  });

  it('lets a clan be loaded, signed in or not', async () => {
    await mountApp();
    const dialog = document.querySelector('#clan-dialog');
    expect(document.querySelector('#open-clan')?.textContent).toBe('Load a clan');
    expect(dialog).not.toBeNull();
    expect(dialog?.querySelector('#clan-name')).not.toBeNull();
    expect(dialog?.querySelector('#clan-search')).not.toBeNull();
    // Signed out, the one-click path is offered as the sign-in that unlocks it.
    expect((dialog?.querySelector('#clan-mine') as HTMLButtonElement).hidden).toBe(true);
    expect((dialog?.querySelector('#clan-signin') as HTMLButtonElement).hidden).toBe(false);
    expect(dialog?.textContent).toContain('needs no sign-in at all');
  });

  it('offers the clan one-click path to somebody signed in', async () => {
    seedSession();
    await mountApp();
    const dialog = document.querySelector('#clan-dialog');
    expect((dialog?.querySelector('#clan-mine') as HTMLButtonElement).hidden).toBe(false);
    expect((dialog?.querySelector('#clan-signin') as HTMLButtonElement).hidden).toBe(true);
  });

  it('says the clan name has to be exact, because Bungie will not guess', async () => {
    await mountApp();
    expect(document.querySelector('#clan-dialog')?.textContent).toContain(
      'matches the whole clan name'
    );
  });

  it('keeps typing Bungie Names working with nothing signed in', async () => {
    const root = await mountApp();
    const inputs = root.querySelectorAll<HTMLInputElement>('.slot input');
    expect(inputs).toHaveLength(2);
    expect(inputs[0].placeholder).toBe('Guardian#1234');
    expect(root.querySelector('.team-actions .btn-primary')?.textContent).toBe(
      'Build the report'
    );
  });

  it('folds the matrix away under a heading rather than leading with it', async () => {
    const root = await mountApp();
    const details = root.querySelector<HTMLDetailsElement>('#matrix-details');
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(details?.querySelector('summary')?.textContent).toContain('Who has cleared what');
    // Demoted, not deleted: the whole grid is still in there.
    expect(details?.querySelector('table.matrix')).not.toBeNull();
    expect(details?.querySelector('.stack')).not.toBeNull();
  });

  it('puts the answer above the fold, before any table', async () => {
    const root = await mountApp();
    const line = root.querySelector('.headline');
    const table = root.querySelector('table.matrix');
    expect(line?.textContent?.length ?? 0).toBeGreaterThan(0);
    expect(line?.compareDocumentPosition(table as Node) ?? 0).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
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
    // There is nothing else to keep now. The old key lived here; the session
    // lives in sessionStorage and is written by d2-auth, not by this site.
    await mountApp();
    expect(Object.keys(localStorage)).toEqual(['fireteam-report.manifest']);
  });

  it('offers the permalink, Discord and card buttons', async () => {
    const root = await mountApp();
    expect(root.querySelector('#copy-link')).not.toBeNull();
    expect(root.querySelector('#copy-discord')).not.toBeNull();
    // The label is the accessible name, so it has to say what comes out.
    expect(root.querySelector('#download-card')?.textContent).toBe(
      'Download the card, 1200x630'
    );
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
