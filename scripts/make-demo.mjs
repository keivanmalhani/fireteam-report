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

/**
 * Six people with overlapping but distinct histories, which is what a real
 * group looks like. Nobody is a blank sheet: the veteran skipped the newer
 * dungeons, the dungeon regular is light on raids, the returning player never
 * saw the sunset content. That is what makes different people the missing one
 * on different activities instead of the same person every time.
 */
const PLAYERS = [
  { name: 'Wraith', code: 4417, blurb: 'day one raider, took a long break, skipped the newer dungeons' },
  { name: 'Kestrel', code: 912, blurb: 'dungeon regular, lighter on raids' },
  { name: 'Ovid', code: 7731, blurb: 'came back for the newest expansion, never saw the sunset raids' },
  { name: 'Marrow', code: 2208, blurb: 'steady all rounder, plays most weeks' },
  { name: 'Solene', code: 1145, blurb: 'newer, filling in the back catalogue' },
  { name: 'Tidebreaker', code: 6690, blurb: 'joined last month, keen raider' }
];

/**
 * Clears per activity, in the same player order as PLAYERS.
 *
 * These are set by hand, not generated, because the demo has a job to do: the
 * ranked list has to show what the engine can actually say. Every rule fires,
 * the sherpa runs name three different people, and both warnings appear.
 * tests/fixtures.test.ts asserts those properties, so an edit that makes this
 * monotonous again fails the suite.
 */
const CLEARS = {
  // raids
  "Crota's End":                    [22, 3, 2, 2, 1, 1],   // lopsided: Wraith farmed the sword
  'Crown of Sorrow':                [4, 2, 0, 3, 0, 0],
  'Deep Stone Crypt':               [16, 11, 8, 9, 6, 4],
  'Garden of Salvation':            [12, 8, 5, 7, 3, 2],
  "King's Fall":                    [14, 9, 7, 8, 6, 4],
  'Last Wish':                      [28, 19, 12, 16, 9, 7], // speedrun
  'Leviathan':                      [13, 7, 0, 6, 0, 0],
  'Leviathan, Eater of Worlds':     [6, 3, 0, 3, 0, 0],
  'Leviathan, Spire of Stars':      [5, 2, 0, 3, 0, 0],
  'Root of Nightmares':             [2, 1, 1, 2, 1, 1],    // rusty: everyone did it once at launch
  "Salvation's Edge":               [5, 4, 7, 6, 0, 3],    // sherpa: Solene
  'Scourge of the Past':            [7, 4, 0, 4, 0, 0],
  'Vault of Glass':                 [24, 15, 11, 13, 9, 0], // sherpa: Tidebreaker
  'Vow of the Disciple':            [11, 7, 6, 8, 4, 3],
  // pantheon
  'The Pantheon: Atraks Sovereign': [4, 2, 0, 3, 0, 0],
  'The Pantheon: Nezarec Sublime':  [3, 2, 0, 2, 0, 0],
  'The Pantheon: Oryx Exalted':     [5, 3, 0, 3, 0, 0],
  'The Pantheon: Rhulk Indomitable':[4, 3, 0, 2, 0, 0],
  // dungeons
  'Duality':                        [9, 16, 5, 7, 4, 3],
  'Equilibrium':                    [0, 0, 0, 0, 0, 0],    // everyone's first: the new dungeon
  'Ghosts of the Deep':             [0, 14, 6, 5, 4, 3],   // sherpa: Wraith, who skipped it
  'Grasp of Avarice':               [4, 31, 3, 5, 2, 2],   // lopsided: Kestrel farmed Gjallarhorn
  'Pit of Heresy':                  [6, 12, 4, 5, 3, 2],
  'Prophecy':                       [17, 22, 9, 11, 8, 6], // speedrun
  'Spire of the Watcher':           [1, 2, 1, 1, 1, 1],    // rusty: nobody likes it
  'The Shattered Throne':           [15, 18, 7, 9, 5, 4],
  "Warlord's Ruin":                 [3, 9, 5, 6, 4, 2]
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
