/**
 * The ranked list of things to run tonight.
 *
 * The shape of this section is the answer to "organize the data in a more
 * visually simple and meaningful way". A reader who has never seen the site
 * should be able to stop after the first thing on the page and still have an
 * answer, so the top pick is a headline sentence and one large card, and
 * everything below it is explicitly the runners up. The tally, the secondary
 * verdicts and the explanation of the ranking are all still here, moved out of
 * the way rather than deleted.
 */

import { el } from './dom';
import {
  diversifyRecommendations,
  headline,
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

/**
 * How many runners up stay on the page.
 *
 * A full catalogue can match twenty-something activities, and past the first
 * handful they are the same verdict saying the same sentence about a different
 * raid. Printing all of them turns the answer back into a list to be waded
 * through, which is the thing this section is supposed to stop doing. The rest
 * are one click away, not gone.
 */
export const VISIBLE_RUNNERS_UP = 5;

/** One runner up. Same card the whole list used to be made of, tightened. */
function renderRunnerUp(rec: Recommendation, rank: number): HTMLElement {
  const secondary = rec.flags.filter((f) => f !== rec.kind);
  return el(
    'article',
    { class: 'rec kind-' + rec.kind },
    el('div', { class: 'rec-rank', text: String(rank) }),
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
  );
}

/** The top pick, sized so it is the only thing anybody has to read. */
function renderHero(rec: Recommendation): HTMLElement {
  const secondary = rec.flags.filter((f) => f !== rec.kind);
  return el(
    'article',
    { class: 'rec hero rank-1 kind-' + rec.kind },
    el(
      'div',
      { class: 'hero-main' },
      el('p', { class: 'hero-verdict' }, KIND_LABEL[rec.kind]),
      el('h3', { class: 'hero-name', text: rec.activity }),
      el('p', { class: 'hero-reason', text: rec.reason }),
      el(
        'div',
        { class: 'hero-tags' },
        el('span', { class: 'tag tag-cat', text: CATEGORY_TAG[rec.category] }),
        ...secondary.map((f) =>
          el('span', { class: 'tag tag-cat', text: 'also ' + KIND_LABEL[f].toLowerCase() })
        )
      )
    )
  );
}

export function renderRecommendations(
  recs: Recommendation[],
  playerCount = 0
): DocumentFragment {
  const frag = document.createDocumentFragment();

  if (recs.length === 0) {
    frag.append(
      el('p', { class: 'headline', text: headline(recs, playerCount) }),
      el('div', {
        class: 'empty',
        text:
          'Nothing stands out for this fireteam. Everyone is at a similar level ' +
          'on everything, so pick whatever you feel like.'
      })
    );
    return frag;
  }

  const ordered = diversifyRecommendations(recs);

  // The sentence first, before any card, tag or number. Everything under it is
  // supporting evidence for it.
  frag.append(el('p', { class: 'headline', text: headline(ordered, playerCount) }));
  frag.append(renderHero(ordered[0]));

  const rest = ordered.slice(1);
  if (rest.length > 0) {
    const shown = el('div', { class: 'recs' });
    rest
      .slice(0, VISIBLE_RUNNERS_UP)
      .forEach((rec, i) => shown.append(renderRunnerUp(rec, i + 2)));

    const runners = el(
      'div',
      { class: 'runners' },
      el('p', { class: 'eyebrow', text: 'Or, in order' }),
      shown
    );

    const overflow = rest.slice(VISIBLE_RUNNERS_UP);
    if (overflow.length > 0) {
      const more = el('div', { class: 'recs' });
      overflow.forEach((rec, i) =>
        more.append(renderRunnerUp(rec, i + 2 + VISIBLE_RUNNERS_UP))
      );
      runners.append(
        el(
          'details',
          { class: 'more-recs' },
          el('summary', {
            text:
              overflow.length +
              (overflow.length === 1 ? ' more option' : ' more options') +
              ', ranked lower'
          }),
          more
        )
      );
    }
    frag.append(runners);
  }

  // The tally and the ranking rules are reference material, not the answer, so
  // they sit behind a disclosure rather than between the reader and the pick.
  const tally = tallyKinds(recs);
  frag.append(
    el(
      'details',
      { class: 'rank-details' },
      el('summary', { text: 'How this was ranked' }),
      el(
        'p',
        { class: 'rec-tally' },
        ...tally.flatMap(([kind, count], i) => [
          i > 0 ? el('span', { class: 'sep', text: '/' }) : null,
          el(
            'span',
            { class: 'kind-' + kind },
            el('b', { text: String(count) }),
            ' ' + tallyLabel(kind, count)
          )
        ])
      ),
      el('p', { class: 'rank-note', text: RANKING_EXPLANATION })
    )
  );
  return frag;
}
