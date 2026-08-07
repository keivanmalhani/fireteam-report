/**
 * The matrix: activities down the side, players across the top.
 *
 * Two renderings share one data shape. The table is the good desktop
 * experience with a sticky activity column; under 700px the table is hidden
 * and a stacked card list takes over, because a six column table on a phone is
 * unreadable no matter how much it is squeezed.
 */

import { el } from './dom';
import type { ActivityCategory, ActivityGroup, PlayerStats } from '../types';

const CATEGORY_LABEL: Record<ActivityCategory, string> = {
  raid: 'Raids',
  pantheon: 'Pantheon',
  dungeon: 'Dungeons'
};

/** Buckets a clear count onto the heat ramp. */
export function heatClass(count: number): string {
  if (count <= 0) return 'h0';
  if (count <= 2) return 'h1';
  if (count <= 4) return 'h2';
  if (count <= 9) return 'h3';
  if (count <= 19) return 'h4';
  return 'h5';
}

function cellText(player: PlayerStats, activity: string): { text: string; cls: string } {
  if (player.problem) return { text: '?', cls: 'h0 private' };
  const count = player.clears[activity] ?? 0;
  return { text: count === 0 ? '-' : String(count), cls: heatClass(count) };
}

function byCategory(groups: ActivityGroup[]): [ActivityCategory, ActivityGroup[]][] {
  const order: ActivityCategory[] = ['raid', 'dungeon', 'pantheon'];
  return order
    .map((cat) => [cat, groups.filter((g) => g.category === cat)] as [ActivityCategory, ActivityGroup[]])
    .filter(([, list]) => list.length > 0);
}

function tierLine(group: ActivityGroup): string {
  const tiers = [...group.tiers].sort();
  return tiers.length <= 1 ? '' : tiers.join(' / ');
}

function renderTable(groups: ActivityGroup[], players: PlayerStats[]): HTMLElement {
  const head = el(
    'tr',
    {},
    el('th', { class: 'act-col', text: 'Activity' }),
    ...players.map((p) => el('th', { title: p.label }, p.ref.name))
  );

  const body = el('tbody');
  for (const [cat, list] of byCategory(groups)) {
    body.append(
      el(
        'tr',
        { class: 'cat-head' },
        el('th', { colspan: String(players.length + 1), text: CATEGORY_LABEL[cat] })
      )
    );
    for (const group of list) {
      const tiers = tierLine(group);
      body.append(
        el(
          'tr',
          {},
          el(
            'th',
            {},
            group.name,
            tiers ? el('span', { class: 'tiers', text: tiers }) : null
          ),
          ...players.map((p) => {
            const { text, cls } = cellText(p, group.name);
            return el('td', {}, el('span', { class: 'cell ' + cls, text }));
          })
        )
      );
    }
  }

  return el(
    'div',
    { class: 'matrix-scroll' },
    el('table', { class: 'matrix' }, el('thead', {}, head), body)
  );
}

function renderStack(groups: ActivityGroup[], players: PlayerStats[]): HTMLElement {
  const root = el('div', { class: 'stack' });

  for (const [cat, list] of byCategory(groups)) {
    const section = el('div', { class: 'stack-group' }, el('p', { class: 'eyebrow', text: CATEGORY_LABEL[cat] }));

    for (const group of list) {
      const counts = players.map((p) => (p.problem ? 0 : p.clears[group.name] ?? 0));
      const peak = Math.max(1, ...counts);
      const tiers = tierLine(group);

      const rows = el(
        'div',
        { class: 'stack-rows' },
        ...players.map((p, i) => {
          const count = counts[i];
          const pct = p.problem ? 0 : Math.round((count / peak) * 100);
          return el(
            'div',
            { class: 'stack-row' },
            el('span', { class: 'stack-name', text: p.ref.name }),
            el(
              'span',
              { class: 'stack-bar' },
              el('span', { class: 'stack-meter' }, el('i', { style: 'width:' + pct + '%' })),
              el('span', {
                class: 'stack-count' + (count === 0 ? ' zero' : ''),
                text: p.problem ? '?' : count === 0 ? '-' : String(count)
              })
            )
          );
        })
      );

      section.append(
        el(
          'div',
          { class: 'stack-card' },
          el('h3', { text: group.name }),
          tiers ? el('p', { class: 'tiers', text: tiers }) : null,
          rows
        )
      );
    }
    root.append(section);
  }

  return root;
}

export function renderMatrix(groups: ActivityGroup[], players: PlayerStats[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  if (players.length === 0 || groups.length === 0) {
    frag.append(el('div', { class: 'empty', text: 'Add some players to see the matrix.' }));
    return frag;
  }
  frag.append(renderTable(groups, players));
  frag.append(renderStack(groups, players));
  return frag;
}

export function renderLegend(): HTMLElement {
  const swatch = (cls: string, label: string) =>
    el('span', { class: 'legend' }, el('i', { class: 'cell ' + cls }), label);
  return el(
    'div',
    { class: 'legend', style: 'gap:14px' },
    swatch('h0', 'none'),
    swatch('h1', '1-2'),
    swatch('h2', '3-4'),
    swatch('h3', '5-9'),
    swatch('h4', '10-19'),
    swatch('h5', '20+')
  );
}
