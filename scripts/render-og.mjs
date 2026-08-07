/**
 * Renders the demo fireteam's share card to public/og.png at exactly 1200x630,
 * for the site's Open Graph / Twitter card meta tags.
 *
 * Deliberately not wired into the build and deliberately not a devDependency.
 * It needs a native canvas, and making that a real dependency would have every
 * clone of this repo download a platform binary to produce one file that
 * changes about once a year:
 *
 *   npm install --no-save @napi-rs/canvas
 *   node scripts/render-og.mjs
 *
 * It is also the only way to look at the card without opening a browser, which
 * is what it is mostly used for.
 *
 * This mirrors guardian-timeline/scripts/render-card.mjs. That script bundles
 * the card's TypeScript with the esbuild Vite already brings along, and this
 * repo is on the same Vite 5 line, so esbuild is what is in node_modules here
 * too and the command is unchanged. (A sibling on Vite 8 has no esbuild at all,
 * only rolldown, so check node_modules/.bin before copying this into another
 * repo.)
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const { createCanvas, GlobalFonts } = await import('@napi-rs/canvas').catch(() => {
  console.error('Missing canvas. Run: npm install --no-save @napi-rs/canvas');
  process.exit(1);
});

const scratch = mkdtempSync(join(tmpdir(), 'fireteam-og-'));
const entry = join(scratch, 'entry.ts');
const bundle = join(scratch, 'bundle.mjs');

// The activity list comes from the committed fallback table rather than the
// live manifest: this runs offline, and an og:image that quietly changes with
// Bungie's servers would be a bad thing to have in the repo.
writeFileSync(
  entry,
  `
import { FALLBACK_ACTIVITIES } from ${JSON.stringify(join(root, 'src/fallback-activities.ts'))};
import { demoPlayers } from ${JSON.stringify(join(root, 'src/demo.ts'))};
import { diversifyRecommendations, recommend } from ${JSON.stringify(join(root, 'src/recommend.ts'))};
import { buildCardModel, cardLayoutFor, drawCard, CARD_WIDTH, CARD_HEIGHT } from ${JSON.stringify(join(root, 'src/card.ts'))};

export function makeModel() {
  const players = demoPlayers();
  const usable = players.filter((p) => !p.problem);
  const rows = FALLBACK_ACTIVITIES.map((group) => ({
    activity: group.name,
    category: group.category,
    counts: usable.map((p) => p.clears[group.name] ?? 0)
  }));
  const recs = recommend(rows, usable.map((p) => p.ref.name));
  // Same order the page and the Discord paste show.
  return buildCardModel({
    recommendations: diversifyRecommendations(recs),
    players
  });
}
export { cardLayoutFor, drawCard, CARD_WIDTH, CARD_HEIGHT };
`,
);

execFileSync(
  join(root, 'node_modules/.bin/esbuild'),
  [entry, '--bundle', '--format=esm', '--platform=node', `--outfile=${bundle}`],
  { stdio: 'inherit' },
);

const { makeModel, cardLayoutFor, drawCard, CARD_WIDTH, CARD_HEIGHT } = await import(
  `file://${bundle}`
);

// Without this, the apostrophe in "Crota's End" can come out as tofu on a
// machine where napi-rs's own bundled fallback does not cover it.
if (GlobalFonts.loadSystemFonts) GlobalFonts.loadSystemFonts();

const model = makeModel();
const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
drawCard(canvas.getContext('2d'), model, cardLayoutFor(model, CARD_WIDTH, CARD_HEIGHT));

const out = join(root, 'public/og.png');
mkdirSync(join(root, 'public'), { recursive: true });
writeFileSync(out, canvas.toBuffer('image/png'));
rmSync(scratch, { recursive: true, force: true });

console.log(`wrote ${out} at ${CARD_WIDTH}x${CARD_HEIGHT}`);
console.log(`hero:     ${model.hero.activity} [${model.hero.kind}]`);
console.log(`reason:   ${model.hero.reason}`);
console.log(`then:     ${model.rows.map((r) => r.activity).join(', ')}`);
console.log(`fireteam: ${model.fireteam.join(', ')}`);
