/**
 * Wiring. Owns the page state and decides between demo mode and live mode.
 */

import { formatBungieName } from '../bungiename';
import { buildCardModel, renderCardPng } from '../card';
import { buildDiscordSummary } from '../discord';
import { fetchPlayerStats, getApiKey, hasApiKey } from '../bungie';
import { loadActivityCatalog, type ActivityCatalog } from '../manifest';
import { buildShareUrl, decodeFireteam, encodeFireteam } from '../permalink';
import {
  diversifyRecommendations,
  recommend,
  type MatrixRow,
  type Recommendation
} from '../recommend';
import { demoBlurbs, demoPlayers } from '../demo';
import { clear, el, qs } from './dom';
import { createKeyModal, openKeyModal } from './keymodal';
import { createPlayerForm } from './players';
import { renderLegend, renderMatrix } from './matrix';
import { renderRecommendations } from './recommendations';
import { renderSummaries } from './summary';
import type { ActivityGroup, PlayerRef, PlayerStats } from '../types';

interface State {
  catalog: ActivityCatalog | null;
  players: PlayerStats[];
  demo: boolean;
  busy: boolean;
}

const state: State = { catalog: null, players: [], demo: true, busy: false };

/** Matrix rows for the engine. Players with a problem are left out entirely. */
export function toMatrixRows(groups: ActivityGroup[], players: PlayerStats[]): MatrixRow[] {
  const usable = players.filter((p) => !p.problem);
  return groups.map((g) => ({
    activity: g.name,
    category: g.category,
    counts: usable.map((p) => p.clears[g.name] ?? 0)
  }));
}

export function mount(root: HTMLElement): void {
  root.append(buildSkeleton());

  const keyDialog = createKeyModal({
    onSaved: () => {
      refreshModePill();
      form.setMessage('Key saved. Build the report to pull live stats.');
    },
    onCleared: () => {
      refreshModePill();
      loadDemo();
    }
  });
  document.body.append(keyDialog);

  const form = createPlayerForm({
    onSubmit: (players) => void runLookup(players),
    onChange: () => undefined
  });
  qs('#team-slot').append(form.root);

  qs<HTMLButtonElement>('#open-key').addEventListener('click', () => openKeyModal(keyDialog));
  qs<HTMLButtonElement>('#copy-link').addEventListener('click', copyLink);
  qs<HTMLButtonElement>('#copy-discord').addEventListener('click', copyDiscord);
  qs<HTMLButtonElement>('#download-card').addEventListener('click', () => void downloadCard());

  window.addEventListener('hashchange', () => {
    const refs = decodeFireteam(location.hash);
    if (refs.length > 0) {
      form.setValues(refs.map(formatBungieName));
      void runLookup(refs);
    }
  });

  void boot();

  async function boot(): Promise<void> {
    refreshModePill();
    setStatus('Loading the activity list from the Destiny manifest...');
    state.catalog = await loadActivityCatalog();
    setStatus('');
    renderCatalogNote();

    const refs = decodeFireteam(location.hash);
    if (refs.length > 0 && hasApiKey()) {
      form.setValues(refs.map(formatBungieName));
      await runLookup(refs);
      return;
    }
    if (refs.length > 0 && !hasApiKey()) {
      form.setValues(refs.map(formatBungieName));
      loadDemo(
        'This link has a fireteam in it, but looking real players up needs your own ' +
          'Bungie API key. The demo fireteam is shown until you add one.'
      );
      return;
    }
    loadDemo();
  }

  function loadDemo(note?: string): void {
    state.demo = true;
    state.players = demoPlayers();
    if (note) setNotice(note);
    else clearNotice();
    renderAll();
  }

  async function runLookup(refs: PlayerRef[]): Promise<void> {
    if (!state.catalog) return;
    if (!hasApiKey()) {
      openKeyModal(keyDialog);
      return;
    }

    state.busy = true;
    form.setBusy(true);
    clearNotice();
    setStatus('Looking up ' + refs.length + ' players...');
    history.replaceState(null, '', buildShareUrl(location.href, refs));

    const key = getApiKey();
    const results: PlayerStats[] = [];
    for (const ref of refs) {
      setStatus('Looking up ' + formatBungieName(ref) + '...');
      results.push(await fetchPlayerStats(key, ref, state.catalog.groups));
    }

    state.players = results;
    state.demo = false;
    state.busy = false;
    form.setBusy(false);
    setStatus('');

    const failed = results.filter((p) => p.problem);
    if (failed.length === results.length) {
      setNotice(
        'None of those players could be read. ' +
          failed.map((p) => p.label + ': ' + (p.problemDetail ?? 'failed')).join(' '),
        true
      );
    } else if (failed.length > 0) {
      setNotice(
        failed.map((p) => p.label + ': ' + (p.problemDetail ?? 'failed')).join(' ') +
          ' They are shown but not counted in the recommendations.'
      );
    } else {
      clearNotice();
    }
    renderAll();
  }

  function renderAll(): void {
    if (!state.catalog) return;
    const groups = state.catalog.groups;
    const players = state.players;
    const usable = players.filter((p) => !p.problem);
    const rows = toMatrixRows(groups, players);
    const recs = recommend(rows, usable.map((p) => p.ref.name));

    const recSlot = qs('#rec-slot');
    clear(recSlot);
    recSlot.append(renderRecommendations(recs));

    const matrixSlot = qs('#matrix-slot');
    clear(matrixSlot);
    matrixSlot.append(renderMatrix(groups, players));

    const legendSlot = qs('#legend-slot');
    clear(legendSlot);
    legendSlot.append(renderLegend());

    const summarySlot = qs('#summary-slot');
    clear(summarySlot);
    summarySlot.append(renderSummaries(players, groups, state.demo ? demoBlurbs() : {}));

    refreshModePill();
  }

  function currentRefs(): PlayerRef[] {
    return state.players.map((p) => p.ref);
  }

  async function copyLink(): Promise<void> {
    const url = buildShareUrl(location.href, currentRefs());
    await copyText(url, '#copy-link', 'Link copied');
  }

  /**
   * The picks in the order the page shows them. Everything that leaves this
   * site shares it, so the paste and the card match what people are looking at
   * while they read it out.
   */
  function shareRecommendations(): Recommendation[] {
    if (!state.catalog) return [];
    const usable = state.players.filter((p) => !p.problem);
    return diversifyRecommendations(
      recommend(
        toMatrixRows(state.catalog.groups, state.players),
        usable.map((p) => p.ref.name)
      )
    );
  }

  async function copyDiscord(): Promise<void> {
    if (!state.catalog) return;
    const text = buildDiscordSummary({
      recommendations: shareRecommendations(),
      players: state.players,
      shareUrl: buildShareUrl(location.href, currentRefs())
    });
    await copyText(text, '#copy-discord', 'Summary copied');
  }

  async function downloadCard(): Promise<void> {
    if (!state.catalog) return;
    const button = qs<HTMLButtonElement>('#download-card');
    const original = button.textContent ?? '';
    try {
      const blob = await renderCardPng(
        buildCardModel({
          recommendations: shareRecommendations(),
          players: state.players
        })
      );
      const url = URL.createObjectURL(blob);
      const link = el('a', { href: url, download: 'fireteam-report.png' });
      link.click();
      // Revoking straight away cancels the save in some browsers, so the URL
      // is held for a moment before it is let go.
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      button.textContent = 'Card saved';
    } catch {
      button.textContent = 'Card failed';
    }
    setTimeout(() => {
      button.textContent = original;
    }, 1600);
  }

  async function copyText(text: string, selector: string, done: string): Promise<void> {
    const button = qs<HTMLButtonElement>(selector);
    const original = button.textContent ?? '';
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = done;
    } catch {
      button.textContent = 'Copy failed';
    }
    setTimeout(() => {
      button.textContent = original;
    }, 1600);
  }

  function refreshModePill(): void {
    const pill = qs('#mode-pill');
    const live = hasApiKey() && !state.demo;
    pill.className = 'pill ' + (live ? 'is-live' : 'is-demo');
    clear(pill);
    pill.append(
      el('span', { class: 'dot' }),
      live ? 'Live data' : hasApiKey() ? 'Key saved' : 'Demo mode'
    );
  }

  function renderCatalogNote(): void {
    const catalog = state.catalog;
    if (!catalog) return;
    const slot = qs('#catalog-note');
    clear(slot);
    const counts = catalog.groups.reduce(
      (acc, g) => {
        acc[g.category] += 1;
        return acc;
      },
      { raid: 0, dungeon: 0, pantheon: 0 } as Record<string, number>
    );
    const where =
      catalog.source === 'network'
        ? 'derived from the live manifest'
        : catalog.source === 'cache'
          ? 'from the copy cached in this browser'
          : 'from the snapshot bundled with the site';
    slot.append(
      el('p', {
        class: 'section-note',
        text:
          counts.raid + ' raids and ' + counts.dungeon + ' dungeons ' + where +
          ' (version ' + catalog.version + '). New raids appear here on their own.'
      })
    );
    // This warning belongs to the activity list, not to a lookup, so it lives
    // in its own slot. Putting it in the shared notice area meant the next
    // render quietly wiped it before anyone read it.
    if (catalog.note) {
      slot.append(el('div', { class: 'notice', text: catalog.note }));
    }
  }

  function setStatus(text: string): void {
    const slot = qs('#status');
    clear(slot);
    if (!text) return;
    slot.append(el('span', { class: 'spinner' }), text);
  }

  function setNotice(text: string, isError = false): void {
    const slot = qs('#notice');
    clear(slot);
    slot.append(el('div', { class: 'notice' + (isError ? ' is-error' : ''), text }));
  }

  function clearNotice(): void {
    clear(qs('#notice'));
  }
}

function buildSkeleton(): DocumentFragment {
  const frag = document.createDocumentFragment();

  frag.append(
    el(
      'header',
      { class: 'masthead' },
      el(
        'div',
        { class: 'wrap masthead-inner' },
        el(
          'div',
          { class: 'brand' },
          el('h1', {}, 'fireteam', el('span', { class: 'dim', text: ' report' })),
          el(
            'p',
            { class: 'tagline' },
            'Raid Report tells you what you did. This tells you ',
            el('strong', { text: 'what to run tonight' }),
            '.'
          )
        ),
        el(
          'div',
          { class: 'masthead-actions' },
          el('span', { class: 'pill is-demo', id: 'mode-pill' }, el('span', { class: 'dot' }), 'Demo mode'),
          el('button', { class: 'btn btn-sm', id: 'open-key', type: 'button', text: 'API key' })
        )
      )
    )
  );

  const main = el('main', { class: 'wrap' });

  main.append(el('div', { id: 'team-slot' }));
  main.append(el('p', { id: 'status', class: 'form-msg', style: 'margin-top:12px' }));
  main.append(el('div', { id: 'notice' }));

  main.append(
    el(
      'section',
      { class: 'section' },
      el(
        'div',
        { class: 'section-head' },
        el('h2', { text: 'Tonight' }),
        el('span', { class: 'eyebrow', text: 'ranked' })
      ),
      el('div', { id: 'rec-slot' })
    )
  );

  main.append(
    el(
      'section',
      { class: 'section' },
      el(
        'div',
        { class: 'section-head' },
        el('h2', { text: 'Who has cleared what' }),
        el('span', { id: 'legend-slot' })
      ),
      el('div', { id: 'catalog-note' }),
      el('div', { id: 'matrix-slot' })
    )
  );

  main.append(
    el(
      'section',
      { class: 'section' },
      el('div', { class: 'section-head' }, el('h2', { text: 'Per player' })),
      el('div', { id: 'summary-slot' })
    )
  );

  main.append(
    el(
      'section',
      { class: 'section' },
      el('div', { class: 'section-head' }, el('h2', { text: 'Share it' })),
      el('p', {
        class: 'section-note',
        text:
          'The fireteam is encoded in the link, so anyone who opens it sees the same ' +
          'team. There is no server and nothing is stored anywhere but your browser. ' +
          'The card is an image of the top pick, sized to unfurl in a chat.'
      }),
      el(
        'div',
        { class: 'team-actions', style: 'border-top:none;padding-top:6px' },
        el('button', { class: 'btn', id: 'copy-link', type: 'button', text: 'Copy permalink' }),
        el('button', { class: 'btn', id: 'copy-discord', type: 'button', text: 'Copy for Discord' }),
        el('button', {
          class: 'btn',
          id: 'download-card',
          type: 'button',
          text: 'Download the card, 1200x630'
        })
      )
    )
  );

  frag.append(main);

  frag.append(
    el(
      'footer',
      { class: 'foot' },
      el(
        'div',
        { class: 'wrap row' },
        el('span', {}, 'Not affiliated with Bungie. Activity data from the Destiny 2 API.'),
        el(
          'span',
          {},
          el(
            'a',
            { href: 'https://github.com/keivanmalhani/fireteam-report', target: '_blank', rel: 'noopener' },
            'Source on GitHub'
          )
        )
      )
    )
  );

  return frag;
}

export { encodeFireteam };
