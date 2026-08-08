/**
 * The fireteam form.
 *
 * Two to six players. Every slot is validated locally before anything is
 * fetched, because a typo should cost nothing and a bad Bungie Name should not
 * consume a request against a rate limit that is shared with everyone else
 * using the site.
 *
 * Typing names still works with nothing set up, and that is the point: building
 * a fireteam out of your friends means naming people who are not you. The two
 * shortcuts next to the button, "Add me" and "Load a clan", exist because
 * typing six of these correctly is the thing people give up on.
 */

import { describeNameError, parseBungieName } from '../bungiename';
import { MAX_PLAYERS } from '../permalink';
import { clear, el } from './dom';
import type { PlayerRef } from '../types';

export const MIN_PLAYERS = 2;

export interface PlayerFormHandlers {
  onSubmit: (players: PlayerRef[]) => void;
  onChange?: (raw: string[]) => void;
}

export interface PlayerForm {
  root: HTMLElement;
  setValues: (values: string[]) => void;
  getValues: () => string[];
  setBusy: (busy: boolean) => void;
  setMessage: (message: string, isError?: boolean) => void;
}

export function createPlayerForm(handlers: PlayerFormHandlers): PlayerForm {
  let values: string[] = ['', ''];
  let busy = false;

  const slots = el('div', { class: 'slots' });
  const message = el('p', { class: 'form-msg' });
  const addBtn = el('button', { type: 'button', class: 'btn btn-sm', text: 'Add player' });
  const meBtn = el('button', { type: 'button', class: 'btn btn-sm', id: 'add-me', text: 'Add me' });
  const clanBtn = el('button', {
    type: 'button',
    class: 'btn btn-sm',
    id: 'open-clan',
    text: 'Load a clan'
  });
  const runBtn = el('button', { type: 'button', class: 'btn btn-primary', text: 'Build the report' });

  const root = el(
    'section',
    { class: 'team-panel' },
    el('p', { class: 'eyebrow', text: 'Fireteam' }),
    slots,
    el(
      'div',
      { class: 'team-actions' },
      addBtn,
      meBtn,
      clanBtn,
      el('span', { class: 'spacer' }),
      message,
      runBtn
    )
  );

  function validate(): { players: PlayerRef[]; errors: (string | null)[]; filled: number } {
    const errors: (string | null)[] = [];
    const players: PlayerRef[] = [];
    let filled = 0;
    for (const raw of values) {
      if (raw.trim().length === 0) {
        errors.push(null);
        continue;
      }
      filled += 1;
      const parsed = parseBungieName(raw);
      if (parsed.ok) {
        players.push(parsed.value);
        errors.push(null);
      } else {
        errors.push(describeNameError(parsed.error));
      }
    }
    return { players, errors, filled };
  }

  function render(): void {
    const { players, errors, filled } = validate();
    clear(slots);

    values.forEach((value, i) => {
      const input = el('input', {
        type: 'text',
        value,
        placeholder: 'Guardian#1234',
        'aria-label': 'Player ' + (i + 1) + ' Bungie Name',
        autocomplete: 'off',
        spellcheck: 'false'
      });
      if (errors[i]) input.classList.add('is-bad');
      input.addEventListener('input', () => {
        values[i] = input.value;
        handlers.onChange?.([...values]);
        updateActions();
        input.classList.toggle('is-bad', !!parseBungieName(input.value).ok === false && input.value.trim().length > 0);
      });
      input.addEventListener('blur', render);
      input.addEventListener('keydown', (event) => {
        if ((event as KeyboardEvent).key === 'Enter') {
          event.preventDefault();
          submit();
        }
      });

      const remove = el('button', {
        type: 'button',
        class: 'slot-remove',
        'aria-label': 'Remove player ' + (i + 1),
        text: 'x'
      });
      remove.disabled = values.length <= MIN_PLAYERS;
      remove.addEventListener('click', () => {
        values.splice(i, 1);
        handlers.onChange?.([...values]);
        render();
      });

      slots.append(el('div', { class: 'slot' }, input, remove));
      if (errors[i]) slots.append(el('p', { class: 'slot-error', text: errors[i] as string }));
    });

    addBtn.disabled = values.length >= MAX_PLAYERS;
    updateActions(players, errors, filled);
  }

  function updateActions(
    players?: PlayerRef[],
    errors?: (string | null)[],
    filled?: number
  ): void {
    const state = players && errors && filled !== undefined
      ? { players, errors, filled }
      : validate();
    const hasErrors = state.errors.some((e) => e !== null);
    const enough = state.players.length >= MIN_PLAYERS;
    runBtn.disabled = busy || hasErrors || !enough;

    if (busy) return;
    if (hasErrors) setMessage('Fix the highlighted names first.', true);
    else if (!enough) setMessage('Needs at least ' + MIN_PLAYERS + ' players.');
    else setMessage('');
  }

  function setMessage(text: string, isError = false): void {
    message.textContent = text;
    message.classList.toggle('is-error', isError);
  }

  function submit(): void {
    const { players, errors } = validate();
    if (errors.some((e) => e !== null) || players.length < MIN_PLAYERS) {
      render();
      return;
    }
    handlers.onSubmit(players);
  }

  addBtn.addEventListener('click', () => {
    if (values.length >= MAX_PLAYERS) return;
    values.push('');
    render();
  });
  runBtn.addEventListener('click', submit);

  render();

  return {
    root,
    setValues(next: string[]) {
      const trimmed = next.slice(0, MAX_PLAYERS);
      while (trimmed.length < MIN_PLAYERS) trimmed.push('');
      values = trimmed;
      render();
    },
    getValues: () => [...values],
    setBusy(next: boolean) {
      busy = next;
      runBtn.textContent = next ? 'Looking up...' : 'Build the report';
      updateActions();
    },
    setMessage
  };
}
