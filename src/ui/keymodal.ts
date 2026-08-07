/**
 * The API key explainer.
 *
 * The key is the user's own, it is free, and it stays in their browser. That
 * has to be said plainly, because asking a stranger to paste a credential into
 * a website is otherwise a reasonable thing to refuse.
 */

import { APP_URL, getApiKey, setApiKey, clearApiKey } from '../bungie';
import { el, qs } from './dom';

export interface KeyModalHandlers {
  onSaved: () => void;
  onCleared: () => void;
}

export function createKeyModal(handlers: KeyModalHandlers): HTMLDialogElement {
  const input = el('input', {
    type: 'password',
    id: 'apikey-input',
    placeholder: 'paste your API key here',
    autocomplete: 'off',
    spellcheck: 'false'
  });

  const dialog = el(
    'dialog',
    { id: 'key-dialog' },
    el(
      'form',
      { method: 'dialog' },
      el(
        'div',
        { class: 'dlg-head' },
        el('p', { class: 'eyebrow', text: 'Live mode' }),
        el('h2', { text: 'Use your own Bungie API key' })
      ),
      el(
        'div',
        { class: 'dlg-body' },
        el('p', {
          text:
            'Bungie requires a key for per player stats. It is free, it takes about ' +
            'two minutes, and there is no approval step.'
        }),
        el(
          'ol',
          {},
          el('li', {}, 'Open ', el('a', { href: APP_URL, target: '_blank', rel: 'noopener' }, 'bungie.net/en/Application'), ' and sign in.'),
          el('li', {}, 'Choose ', el('code', { text: 'Create New App' }), '.'),
          el('li', {}, 'Application Name: anything, for example ', el('code', { text: 'my fireteam report' }), '.'),
          el('li', {}, 'Website: the address of this page.'),
          el('li', {}, 'OAuth Client Type: ', el('code', { text: 'Not Applicable' }), '.'),
          el('li', {}, 'Origin Header: ', el('code', { text: location.origin }), ' exactly. This is the field people miss, and without it the browser call is refused.'),
          el('li', {}, 'Accept the terms, create the app, then copy the ', el('code', { text: 'API Key' }), ' it shows you.')
        ),
        el('label', { for: 'apikey-input', class: 'eyebrow', text: 'Your key' }),
        input,
        el('div', {
          class: 'privacy-note',
          text:
            'The key is stored in this browser only, in localStorage, and is sent ' +
            'to bungie.net and nowhere else. There is no server behind this site. ' +
            'Clearing it below removes it.'
        })
      ),
      el(
        'div',
        { class: 'dlg-foot' },
        el('button', { type: 'button', class: 'btn btn-ghost btn-sm', id: 'key-clear', text: 'Clear stored key' }),
        el('span', { class: 'spacer' }),
        el('button', { type: 'button', class: 'btn', id: 'key-cancel', text: 'Cancel' }),
        el('button', { type: 'button', class: 'btn btn-primary', id: 'key-save', text: 'Save key' })
      )
    )
  ) as HTMLDialogElement;

  qs<HTMLButtonElement>('#key-cancel', dialog).addEventListener('click', () => dialog.close());

  qs<HTMLButtonElement>('#key-save', dialog).addEventListener('click', () => {
    setApiKey(input.value);
    input.value = '';
    dialog.close();
    handlers.onSaved();
  });

  qs<HTMLButtonElement>('#key-clear', dialog).addEventListener('click', () => {
    clearApiKey();
    input.value = '';
    dialog.close();
    handlers.onCleared();
  });

  return dialog;
}

export function openKeyModal(dialog: HTMLDialogElement): void {
  const input = dialog.querySelector<HTMLInputElement>('#apikey-input');
  if (input) input.value = getApiKey();
  dialog.showModal();
}
