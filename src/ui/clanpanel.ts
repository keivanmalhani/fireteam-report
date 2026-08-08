/**
 * Load a clan instead of typing six Bungie Names.
 *
 * Typing "Guardian#1234" correctly, six times, hash codes and all, is the other
 * thing that stops people using this site. A clan roster is those same people
 * already spelled right, so this panel is the second half of the same problem
 * the sign-in button solves.
 *
 * All the decisions are in clan.ts and all the requests are in bungie.ts. What
 * is left here is markup and event handlers, deliberately, so that none of the
 * paging, ordering, selection or cost logic needs a browser to be tested.
 */

import { clansForPlayer, fetchClanRoster, searchClans } from '../bungie';
import {
  FIRETEAM_SIZE,
  MEMBER_TYPE_LABEL,
  defaultSelection,
  describeBudget,
  selectedMembers,
  toggleSelected,
  type ClanSummary,
  type RosterMember
} from '../clan';
import { failureText } from '../signin';
import { clear, el, qs } from './dom';

export interface ClanPanelHandlers {
  /** The picked members, in roster order, ready to become the fireteam. */
  onUse: (members: RosterMember[]) => void;
  onSignIn: () => void;
}

export interface OwnAccount {
  /** The bungie.net membership id from the session. Group lookups use type 254. */
  membershipId: string;
}

export interface ClanPanel {
  root: HTMLDialogElement;
  open: () => void;
  /** Called whenever the session changes, so the one-click path appears. */
  setAccount: (account: OwnAccount | null) => void;
}

/** Bungie's own membership type, which is what a session's id belongs to. */
const BUNGIE_NEXT = 254;

interface PanelState {
  account: OwnAccount | null;
  clans: ClanSummary[];
  clan: ClanSummary | null;
  roster: RosterMember[];
  selected: string[];
  busy: boolean;
  /** Set when somebody tried to check a seventh person. */
  atCap: boolean;
}

export function createClanPanel(handlers: ClanPanelHandlers): ClanPanel {
  const state: PanelState = {
    account: null,
    clans: [],
    clan: null,
    roster: [],
    selected: [],
    busy: false,
    atCap: false
  };

  const nameInput = el('input', {
    type: 'text',
    id: 'clan-name',
    placeholder: 'Exact clan name',
    autocomplete: 'off',
    spellcheck: 'false'
  });
  const searchBtn = el('button', {
    type: 'button',
    class: 'btn',
    id: 'clan-search',
    text: 'Find it'
  });
  const mineBtn = el('button', {
    type: 'button',
    class: 'btn btn-primary',
    id: 'clan-mine',
    text: 'Use my clan'
  });
  const signInBtn = el('button', {
    type: 'button',
    class: 'btn btn-primary',
    id: 'clan-signin',
    text: 'Sign in with Bungie'
  });
  const status = el('p', { class: 'form-msg', id: 'clan-status' });
  const results = el('div', { id: 'clan-results' });
  const roster = el('div', { id: 'clan-roster' });
  const footNote = el('p', { class: 'form-msg', id: 'clan-cost' });
  const useBtn = el('button', {
    type: 'button',
    class: 'btn btn-primary',
    id: 'clan-use',
    text: 'Build the report'
  });

  const dialog = el(
    'dialog',
    { id: 'clan-dialog' },
    el(
      'form',
      { method: 'dialog' },
      el(
        'div',
        { class: 'dlg-head' },
        el('p', { class: 'eyebrow', text: 'Fireteam' }),
        el('h2', { text: 'Load a clan' })
      ),
      el(
        'div',
        { class: 'dlg-body' },
        el('p', {
          text:
            'Pick people off a clan roster instead of typing their names. Reading a clan ' +
            'needs no sign-in at all; signing in only saves you knowing the name.'
        }),
        el('div', { class: 'clan-mine', id: 'clan-mine-slot' }, mineBtn, signInBtn),
        el('label', { for: 'clan-name', class: 'eyebrow', text: 'Or find one by name' }),
        el('div', { class: 'clan-find' }, nameInput, searchBtn),
        el('p', {
          class: 'privacy-note',
          text:
            'Bungie matches the whole clan name, not part of it. Capitals and spaces are ' +
            'forgiven, spelling is not, so "Math Clas" finds nothing.'
        }),
        status,
        results,
        roster
      ),
      el(
        'div',
        { class: 'dlg-foot' },
        footNote,
        el('span', { class: 'spacer' }),
        el('button', { type: 'button', class: 'btn', id: 'clan-close', text: 'Cancel' }),
        useBtn
      )
    )
  ) as HTMLDialogElement;

  qs<HTMLButtonElement>('#clan-close', dialog).addEventListener('click', () => dialog.close());
  signInBtn.addEventListener('click', () => {
    dialog.close();
    handlers.onSignIn();
  });
  mineBtn.addEventListener('click', () => void loadMyClans());
  searchBtn.addEventListener('click', () => void runSearch());
  nameInput.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Enter') {
      event.preventDefault();
      void runSearch();
    }
  });
  useBtn.addEventListener('click', () => {
    const picked = selectedMembers(state.roster, state.selected);
    if (picked.length < 2) return;
    dialog.close();
    handlers.onUse(picked);
  });

  function setBusy(busy: boolean, message = ''): void {
    state.busy = busy;
    clear(status);
    if (message) {
      if (busy) status.append(el('span', { class: 'spinner' }));
      status.append(message);
    }
    searchBtn.disabled = busy;
    mineBtn.disabled = busy;
    paintFoot();
  }

  function setError(error: unknown): void {
    const { title, body } = failureText(error);
    clear(status);
    status.append(el('span', { class: 'is-error', text: title + '. ' + body }));
    state.busy = false;
    searchBtn.disabled = false;
    mineBtn.disabled = false;
    paintFoot();
  }

  async function runSearch(): Promise<void> {
    const name = nameInput.value.trim();
    if (name.length === 0) {
      clear(status);
      status.append(el('span', { class: 'is-error', text: 'Type the clan name first.' }));
      return;
    }
    state.clan = null;
    state.roster = [];
    state.selected = [];
    clear(roster);
    setBusy(true, 'Looking for ' + name + '...');
    try {
      state.clans = await searchClans(name);
      setBusy(false);
      if (state.clans.length === 0) {
        clear(status);
        status.append(
          el('span', {
            class: 'is-error',
            text:
              'No clan is called exactly "' +
              name +
              '". Bungie will not match part of a name, so it has to be spelled the way ' +
              'the clan spells it.'
          })
        );
      }
      paintClans();
    } catch (error) {
      setError(error);
    }
  }

  async function loadMyClans(): Promise<void> {
    const account = state.account;
    if (!account) return;
    state.clan = null;
    state.roster = [];
    state.selected = [];
    clear(roster);
    setBusy(true, 'Reading your clans...');
    try {
      state.clans = await clansForPlayer(BUNGIE_NEXT, account.membershipId);
      setBusy(false);
      if (state.clans.length === 0) {
        clear(status);
        status.append(
          el('span', { class: 'is-error', text: 'That account is not in a clan.' })
        );
      } else if (state.clans.length === 1) {
        // One clan is the overwhelmingly common case, and making somebody click
        // a list of one is exactly the friction this button exists to remove.
        await openClan(state.clans[0]);
        return;
      }
      paintClans();
    } catch (error) {
      setError(error);
    }
  }

  async function openClan(clan: ClanSummary): Promise<void> {
    state.clan = clan;
    state.clans = [];
    clear(results);
    setBusy(true, 'Reading the roster for ' + clan.name + '...');
    try {
      state.roster = await fetchClanRoster(clan.groupId, (collected, total) => {
        setBusy(true, 'Read ' + collected + ' of ' + total + ' members...');
      });
      state.selected = defaultSelection(state.roster);
      setBusy(false, '');
      paintRoster();
    } catch (error) {
      setError(error);
    }
  }

  function paintClans(): void {
    clear(results);
    if (state.clans.length === 0) return;
    const list = el('div', { class: 'clan-list' });
    for (const clan of state.clans) {
      const button = el(
        'button',
        { type: 'button', class: 'clan-hit' },
        el('span', { class: 'clan-hit-name', text: clan.name }),
        el('span', {
          class: 'clan-hit-meta',
          text: clan.memberCount + (clan.memberCount === 1 ? ' member' : ' members')
        }),
        clan.motto ? el('span', { class: 'clan-hit-motto', text: clan.motto }) : null
      );
      button.addEventListener('click', () => void openClan(clan));
      list.append(button);
    }
    results.append(list);
  }

  function paintRoster(): void {
    clear(roster);
    const clan = state.clan;
    if (!clan) return;

    if (state.roster.length === 0) {
      roster.append(
        el('div', {
          class: 'empty',
          text: 'That clan has no members with a Destiny account on them.'
        })
      );
      paintFoot();
      return;
    }

    const head = el(
      'div',
      { class: 'roster-head' },
      el('p', { class: 'eyebrow', id: 'roster-count' }),
      el('span', { class: 'spacer' }),
      el('button', { type: 'button', class: 'btn btn-ghost btn-sm', id: 'roster-clear', text: 'Clear' })
    );
    const list = el('div', { class: 'roster', role: 'group', 'aria-label': clan.name + ' roster' });

    for (const member of state.roster) {
      const checkbox = el('input', { type: 'checkbox' }) as HTMLInputElement;
      checkbox.checked = state.selected.includes(member.membershipId);
      checkbox.addEventListener('change', () => {
        const next = toggleSelected(state.selected, member.membershipId);
        // toggleSelected refuses to go past six, so a checkbox that would have
        // been the seventh has to be put back the way it was.
        state.atCap = next.length === state.selected.length && checkbox.checked;
        state.selected = next;
        checkbox.checked = state.selected.includes(member.membershipId);
        paintCount();
        paintFoot();
      });

      list.append(
        el(
          'label',
          { class: 'roster-row' + (member.isOnline ? ' is-online' : '') },
          checkbox,
          el(
            'span',
            { class: 'roster-who' },
            el('span', { class: 'roster-name', text: member.ref.name }),
            el('span', { class: 'roster-code', text: '#' + String(member.ref.code).padStart(4, '0') })
          ),
          el('span', {
            class: 'roster-tag',
            text: member.isOnline ? 'online' : MEMBER_TYPE_LABEL[member.memberType] ?? ''
          })
        )
      );
    }

    roster.append(head, list);
    qs<HTMLButtonElement>('#roster-clear', roster).addEventListener('click', () => {
      state.selected = [];
      state.atCap = false;
      for (const box of roster.querySelectorAll<HTMLInputElement>('input[type=checkbox]')) {
        box.checked = false;
      }
      paintCount();
      paintFoot();
    });
    paintCount();
    paintFoot();
  }

  function paintCount(): void {
    const slot = roster.querySelector('#roster-count');
    if (!slot) return;
    slot.textContent =
      state.selected.length +
      ' of ' +
      state.roster.length +
      ' picked, up to ' +
      FIRETEAM_SIZE;
  }

  function paintFoot(): void {
    const count = state.selected.length;
    useBtn.disabled = state.busy || count < 2;
    clear(footNote);
    if (state.roster.length === 0) return;
    if (state.atCap) {
      footNote.append(
        el('span', {
          class: 'is-error',
          text: 'Six is a full fireteam. Uncheck somebody to swap them out.'
        })
      );
      return;
    }
    if (count < 2) {
      footNote.append('Pick at least two people.');
      return;
    }
    footNote.append(
      'Reading ' + count + ' players costs ' + describeBudget(count) + ' against a shared key.'
    );
  }

  function paintAccount(): void {
    const signedIn = state.account !== null;
    mineBtn.hidden = !signedIn;
    signInBtn.hidden = signedIn;
  }

  paintAccount();
  paintFoot();

  return {
    root: dialog,
    open() {
      state.atCap = false;
      dialog.showModal();
    },
    setAccount(account: OwnAccount | null) {
      state.account = account;
      paintAccount();
    }
  };
}
