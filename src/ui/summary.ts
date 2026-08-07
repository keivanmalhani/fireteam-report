/** Per player headline numbers. */

import { el } from './dom';
import { summarisePlayer } from '../aggregate';
import type { ActivityGroup, PlayerStats } from '../types';

export function renderSummaries(
  players: PlayerStats[],
  groups: ActivityGroup[],
  blurbs: Record<string, string> = {}
): DocumentFragment {
  const frag = document.createDocumentFragment();
  if (players.length === 0) {
    frag.append(el('div', { class: 'empty', text: 'No players yet.' }));
    return frag;
  }

  const grid = el('div', { class: 'summary-grid' });
  for (const player of players) {
    const s = summarisePlayer(player.clears, groups);
    const card = el(
      'article',
      { class: 'pcard' },
      el('h3', { text: player.label }),
      blurbs[player.label] ? el('p', { class: 'blurb', text: blurbs[player.label] }) : null
    );

    if (player.problem) {
      card.append(
        el('p', {
          class: 'problem',
          text:
            player.problemDetail ??
            'Stats are not available for this player, so they are not counted above.'
        })
      );
      grid.append(card);
      continue;
    }

    const stat = (label: string, value: string, big = false) =>
      el(
        'div',
        { class: 'pstat' },
        el('span', { text: label }),
        el('span', { class: big ? 'big' : '', text: value })
      );

    card.append(
      el(
        'div',
        { class: 'pstats' },
        stat('Raid clears', String(s.raidClears), true),
        stat('Dungeon clears', String(s.dungeonClears), true),
        stat('Distinct raids', s.distinctRaids + ' of ' + s.totalRaids),
        stat('Distinct dungeons', s.distinctDungeons + ' of ' + s.totalDungeons),
        s.pantheonClears > 0 ? stat('Pantheon clears', String(s.pantheonClears)) : null,
        stat('Most run', s.mostRun ? s.mostRun.activity + ' (' + s.mostRun.count + ')' : 'nothing yet')
      )
    );
    grid.append(card);
  }

  frag.append(grid);
  return frag;
}
