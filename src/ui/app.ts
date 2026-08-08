/**
 * Wiring. Owns the page state and decides between demo mode and live mode.
 */

import { getSession, minutesLeft, signIn, signOut } from '../auth';
import { formatBungieName } from '../bungiename';
import { buildCardModel, renderCardPng } from '../card';
import { buildDiscordSummary } from '../discord';
import { fetchPlayerStats, fetchPlayerStatsByMembership } from '../bungie';
import {
  PLAYER_CONCURRENCY,
  mapSettledWithLimit,
  progressLabel,
  type RosterMember
} from '../clan';
import { failureText, getOwnPlayer, isSessionExpiry, signInView } from '../signin';
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
import { createClanPanel } from './clanpanel';
import { createPlayerForm } from './players';
import { renderLegend, renderMatrix } from './matrix';
import { renderRecommendations } from './recommendations';
import { renderSummaries } from './summary';
import type { ActivityGroup, PlayerRef, PlayerStats } from '../types';

/**
 * One place in the fireteam. The membership is optional because a name typed
 * into the form has to be searched for, while somebody picked off a clan roster
 * arrives already resolved and that search can be skipped.
 */
interface Slot {
  ref: PlayerRef;
  membershipType?: number;
  membershipId?: string;
}

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

  const clanPanel = createClanPanel({
    onUse: (members) => void runLookup(members.map(slotForMember)),
    onSignIn: () => startSignIn()
  });
  document.body.append(clanPanel.root);

  const form = createPlayerForm({
    onSubmit: (players) => void runLookup(players.map((ref) => ({ ref }))),
    onChange: () => undefined
  });
  qs('#team-slot').append(form.root);

  qs<HTMLButtonElement>('#sign-in').addEventListener('click', () => startSignIn());
  qs<HTMLButtonElement>('#sign-out').addEventListener('click', () => {
    signOut();
    paintAccount();
    setNotice('Signed out. Typing Bungie Names still works, and so does loading a clan.');
  });
  qs<HTMLButtonElement>('#add-me').addEventListener('click', () => void addMe());
  qs<HTMLButtonElement>('#open-clan').addEventListener('click', () => clanPanel.open());
  qs<HTMLButtonElement>('#copy-link').addEventListener('click', copyLink);
  qs<HTMLButtonElement>('#copy-discord').addEventListener('click', copyDiscord);
  qs<HTMLButtonElement>('#download-card').addEventListener('click', () => void downloadCard());

  window.addEventListener('hashchange', () => {
    const refs = decodeFireteam(location.hash);
    if (refs.length > 0) {
      form.setValues(refs.map(formatBungieName));
      void runLookup(refs.map((ref) => ({ ref })));
    }
  });

  void boot();

  function slotForMember(member: RosterMember): Slot {
    return {
      ref: member.ref,
      membershipType: member.membershipType,
      membershipId: member.membershipId
    };
  }

  async function boot(): Promise<void> {
    paintAccount();
    setStatus('Loading the activity list from the Destiny manifest...');
    state.catalog = await loadActivityCatalog();
    setStatus('');
    renderCatalogNote();

    // No key to check any more, so a shared link just runs.
    const refs = decodeFireteam(location.hash);
    if (refs.length > 0) {
      form.setValues(refs.map(formatBungieName));
      await runLookup(refs.map((ref) => ({ ref })));
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

  function startSignIn(): void {
    try {
      signIn();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : 'This browser would not start the sign-in.',
        true
      );
    }
  }

  /**
   * Put the signed-in visitor in the first empty slot.
   *
   * This is the one call on the page that spends the token, so it is also the
   * only one that can discover the hour is over.
   */
  async function addMe(): Promise<void> {
    setStatus('Reading your account...');
    try {
      const me = await getOwnPlayer();
      setStatus('');
      const label = formatBungieName(me.ref);
      const values = form.getValues();
      if (values.some((v) => v.trim().toLowerCase() === label.toLowerCase())) {
        setNotice('You are already in the fireteam.');
        return;
      }
      const empty = values.findIndex((v) => v.trim().length === 0);
      if (empty === -1) values.push(label);
      else values[empty] = label;
      form.setValues(values);
      clearNotice();
    } catch (error) {
      setStatus('');
      showFailure(error);
    }
  }

  /**
   * A failure, with the session cleared first when that is what failed.
   *
   * The order matters. An expiry can arrive because bungie.net rejected a token
   * the local clock still believes in, and in that case the stored session
   * still looks fine: the page would sit there offering a countdown and a
   * "sign out" button under a message telling the reader to sign in again, with
   * no sign-in button to press. The repaint has to come after the session is
   * gone, not before.
   */
  function showFailure(error: unknown): void {
    if (isSessionExpiry(error)) signOut();
    paintAccount();
    const { title, body } = failureText(error);
    setNotice(title + '. ' + body, true);
  }

  async function runLookup(slots: Slot[]): Promise<void> {
    if (!state.catalog) return;
    const groups = state.catalog.groups;

    state.busy = true;
    form.setBusy(true);
    clearNotice();
    setStatus(progressLabel(0, slots.length));
    history.replaceState(null, '', buildShareUrl(location.href, slots.map((s) => s.ref)));

    // Capped rather than fanned out: the API key is the site's and therefore
    // shared with everyone else using it, so six players arriving as six
    // simultaneous bursts of up to four requests is somebody else's problem too.
    const settled = await mapSettledWithLimit(
      slots,
      PLAYER_CONCURRENCY,
      (slot) =>
        slot.membershipId !== undefined && slot.membershipType !== undefined
          ? fetchPlayerStatsByMembership(
              slot.ref,
              slot.membershipType,
              slot.membershipId,
              groups
            )
          : fetchPlayerStats(slot.ref, groups),
      (done, total) => setStatus(progressLabel(done, total))
    );

    // One player who would not answer must not cost the other five their
    // report, so a rejection becomes that player's problem and nothing else's.
    const results: PlayerStats[] = settled.map((outcome, i) =>
      outcome.ok
        ? outcome.value
        : {
            ref: slots[i].ref,
            label: formatBungieName(slots[i].ref),
            clears: {},
            problem: 'error' as const,
            problemDetail: failureText(outcome.error).body
          }
    );

    state.players = results;
    state.demo = false;
    state.busy = false;
    form.setBusy(false);
    form.setValues(results.map((p) => p.label));
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
    const recs = recommend(
      rows,
      usable.map((p) => p.ref.name)
    );

    const recSlot = qs('#rec-slot');
    clear(recSlot);
    recSlot.append(renderRecommendations(recs, usable.length));

    const matrixSlot = qs('#matrix-slot');
    clear(matrixSlot);
    matrixSlot.append(renderMatrix(groups, players));

    const legendSlot = qs('#legend-slot');
    clear(legendSlot);
    legendSlot.append(renderLegend());

    const summarySlot = qs('#summary-slot');
    clear(summarySlot);
    summarySlot.append(renderSummaries(players, groups, state.demo ? demoBlurbs() : {}));

    paintAccount();
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

  /** The sign-in area and everything that depends on there being a session. */
  function paintAccount(): void {
    const session = getSession();
    const view = signInView(session, minutesLeft());

    qs<HTMLButtonElement>('#sign-in').hidden = !view.showSignIn;
    qs<HTMLButtonElement>('#sign-out').hidden = view.showSignIn;
    qs<HTMLButtonElement>('#add-me').hidden = !view.showMine;
    qs('#session-note').textContent = view.note;
    clanPanel.setAccount(session ? { membershipId: session.membershipId } : null);

    const pill = qs('#mode-pill');
    pill.className = 'pill ' + (state.demo ? 'is-demo' : 'is-live');
    clear(pill);
    pill.append(el('span', { class: 'dot' }), state.demo ? 'Demo mode' : 'Live data');
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
          el(
            'div',
            { class: 'account' },
            el(
              'div',
              { class: 'account-row' },
              el('span', { class: 'pill is-demo', id: 'mode-pill' }, el('span', { class: 'dot' }), 'Demo mode'),
              el('button', {
                class: 'btn btn-sm btn-primary',
                id: 'sign-in',
                type: 'button',
                text: 'Sign in with Bungie'
              }),
              el('button', { class: 'btn btn-sm', id: 'sign-out', type: 'button', text: 'Sign out' })
            ),
            el('p', { class: 'account-note', id: 'session-note' })
          )
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

  // The matrix is still the evidence, but it is not the answer, so it starts
  // folded away. Somebody who has never seen this site should be able to read
  // the pick at the top and leave without ever opening a table.
  main.append(
    el(
      'section',
      { class: 'section' },
      el(
        'details',
        { class: 'matrix-details', id: 'matrix-details' },
        el(
          'summary',
          {},
          el('span', { class: 'summary-title', text: 'Who has cleared what' }),
          el('span', { class: 'summary-hint', text: 'the full grid' })
        ),
        el('div', { class: 'section-head', style: 'margin-top:14px' }, el('span', { id: 'legend-slot' })),
        el('div', { id: 'matrix-slot' })
      ),
      // Outside the disclosure on purpose. This slot carries the warning shown
      // when bungie.net could not be reached and the bundled snapshot is being
      // used, and a warning nobody can see until they open a folded section is
      // not a warning.
      el('div', { id: 'catalog-note' })
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
