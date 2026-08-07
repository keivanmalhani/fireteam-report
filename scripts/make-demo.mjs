/**
 * Builds fixtures/demo.json, the six player dataset used by demo mode and by
 * the tests. Counts are hand set rather than random so the demo actually
 * demonstrates something: every recommendation rule fires at least once, and
 * the numbers look like a real group of friends with one veteran and one
 * newcomer.
 *
 * Run with: node scripts/make-demo.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const PLAYERS = [
  { name: 'Wraith', code: 4417, blurb: 'day one raider, has cleared everything' },
  { name: 'Kestrel', code: 912, blurb: 'reliable weekly regular' },
  { name: 'Ovid', code: 7731, blurb: 'came back for the newest expansion' },
  { name: 'Marrow', code: 2208, blurb: 'plays most weeks' },
  { name: 'Solene', code: 1145, blurb: 'newer, still filling in the back catalogue' },
  { name: 'Tidebreaker', code: 6690, blurb: 'joined the clan last month' }
];

/** Clears per activity, in the same player order as PLAYERS. */
const CLEARS = {
  // raids
  "Crota's End":                    [20, 2, 2, 2, 1, 1],
  'Crown of Sorrow':                [2, 2, 0, 0, 0, 0],
  'Deep Stone Crypt':               [18, 14, 12, 9, 5, 3],
  'Garden of Salvation':            [11, 7, 6, 4, 1, 0],
  "King's Fall":                    [16, 12, 9, 7, 6, 5],
  'Last Wish':                      [31, 24, 19, 15, 9, 6],
  'Leviathan':                      [14, 9, 0, 6, 0, 0],
  'Leviathan, Eater of Worlds':     [5, 3, 0, 2, 0, 0],
  'Leviathan, Spire of Stars':      [3, 2, 0, 1, 0, 0],
  'Root of Nightmares':             [13, 9, 8, 5, 2, 0],
  "Salvation's Edge":               [9, 6, 4, 3, 2, 0],
  'Scourge of the Past':            [5, 3, 0, 2, 0, 0],
  'Vault of Glass':                 [24, 17, 15, 11, 6, 4],
  'Vow of the Disciple':            [12, 8, 7, 5, 3, 1],
  // pantheon
  'The Pantheon: Atraks Sovereign': [3, 2, 1, 0, 0, 0],
  'The Pantheon: Nezarec Sublime':  [1, 1, 1, 1, 1, 0],
  'The Pantheon: Oryx Exalted':     [4, 3, 2, 2, 1, 0],
  'The Pantheon: Rhulk Indomitable':[3, 2, 2, 1, 0, 0],
  // dungeons
  'Duality':                        [14, 9, 7, 5, 5, 5],
  'Equilibrium':                    [0, 0, 0, 0, 0, 0],
  'Ghosts of the Deep':             [2, 1, 1, 1, 1, 1],
  'Grasp of Avarice':               [17, 11, 8, 6, 6, 5],
  'Pit of Heresy':                  [8, 5, 4, 3, 2, 1],
  'Prophecy':                       [21, 13, 10, 8, 7, 6],
  'Spire of the Watcher':           [6, 4, 3, 2, 1, 1],
  'The Shattered Throne':           [19, 12, 9, 7, 4, 2],
  "Warlord's Ruin":                 [7, 4, 3, 2, 1, 0]
};

const defs = JSON.parse(readFileSync(join(ROOT, 'fixtures', 'activity-defs.json'), 'utf8'));

// Cross check the demo against the derived activity list so the fixture cannot
// drift away from the real manifest without the build noticing.
const SUFFIX = /:\s*(Standard|Normal|Master|Legend|Expert|Contest|Prestige|Challenge Mode|Level\s+\d+)\s*$/;
const derived = new Set(
  defs.definitions.map((d) => {
    const t = d.displayProperties.name.trim();
    const m = SUFFIX.exec(t);
    const n = m ? t.slice(0, m.index).trim() : t;
    return n.length ? n : t;
  })
);

const missing = [...derived].filter((n) => !(n in CLEARS));
const extra = Object.keys(CLEARS).filter((n) => !derived.has(n));
if (missing.length || extra.length) {
  process.stderr.write('demo fixture out of sync with the manifest\n');
  if (missing.length) process.stderr.write('  missing: ' + missing.join(', ') + '\n');
  if (extra.length) process.stderr.write('  extra:   ' + extra.join(', ') + '\n');
  process.exit(1);
}

const players = PLAYERS.map((p, i) => {
  const clears = {};
  for (const [activity, counts] of Object.entries(CLEARS)) {
    if (counts[i] > 0) clears[activity] = counts[i];
  }
  return {
    name: p.name,
    code: p.code,
    label: p.name + '#' + String(p.code).padStart(4, '0'),
    blurb: p.blurb,
    clears
  };
});

writeFileSync(
  join(ROOT, 'fixtures', 'demo.json'),
  JSON.stringify(
    {
      note: 'Invented fireteam used by demo mode and by the tests. Not real players.',
      manifestVersion: defs.manifestVersion,
      players
    },
    null,
    2
  ) + '\n'
);

process.stdout.write('wrote fixtures/demo.json with ' + players.length + ' players over ' +
  Object.keys(CLEARS).length + ' activities\n');
