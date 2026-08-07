/** Renders the ranked list of things to run tonight. */

import { el } from './dom';
import {
  diversifyRecommendations,
  KIND_LABEL,
  RANKING_EXPLANATION,
  tallyKinds,
  tallyLabel,
  type Recommendation
} from '../recommend';
import type { ActivityCategory } from '../types';

const CATEGORY_TAG: Record<ActivityCategory, string> = {
  raid: 'Raid',
  dungeon: 'Dungeon',
  pantheon: 'Pantheon'
};

export function renderRecommendations(recs: Recommendation[]): DocumentFragment {
  const frag = document.createDocumentFragment();

  if (recs.length === 0) {
    frag.append(
      el('div', {
        class: 'empty',
        text:
          'Nothing stands out for this fireteam. Everyone is at a similar level ' +
          'on everything, so pick whatever you feel like.'
      })
    );
    return frag;
  }

  // Tally first, off the ranked list, so the range of verdicts is visible
  // without having to scroll the cards.
  const tally = tallyKinds(recs);
  frag.append(
    el(
      'p',
      { class: 'rec-tally' },
      ...tally.flatMap(([kind, count], i) => [
        i > 0 ? el('span', { class: 'sep', text: '/' }) : null,
        el('span', { class: 'kind-' + kind }, el('b', { text: String(count) }), ' ' + tallyLabel(kind, count))
      ])
    )
  );

  const ordered = diversifyRecommendations(recs);
  const list = el('div', { class: 'recs' });
  ordered.forEach((rec, i) => {
    const secondary = rec.flags.filter((f) => f !== rec.kind);
    list.append(
      el(
        'article',
        { class: 'rec kind-' + rec.kind + (i === 0 ? ' rank-1' : '') },
        el('div', { class: 'rec-rank', text: String(i + 1) }),
        el(
          'div',
          { class: 'rec-main' },
          el(
            'div',
            { class: 'rec-title' },
            el('span', { class: 'name', text: rec.activity }),
            el('span', { class: 'tag', text: KIND_LABEL[rec.kind] }),
            el('span', { class: 'tag tag-cat', text: CATEGORY_TAG[rec.category] }),
            ...secondary.map((f) =>
              el('span', { class: 'tag tag-cat', text: 'also ' + KIND_LABEL[f].toLowerCase() })
            )
          ),
          el('p', { class: 'rec-reason', text: rec.reason })
        ),
        el('div', { class: 'rec-side' })
      )
    );
  });

  frag.append(list);
  frag.append(el('p', { class: 'rank-note', text: RANKING_EXPLANATION }));
  return frag;
}
