/**
 * Fetches the live Destiny manifest and regenerates the committed fallback
 * table plus the raw definition fixture the tests check the collapsing against.
 *
 * Run with: npm run derive
 *
 * The app does this at runtime too. This script exists so the repo carries a
 * known good snapshot for the case where Bungie is unreachable, and so the
 * collapsing rules can be tested against real definitions rather than
 * hand written ones.
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://www.bungie.net/Platform/Destiny2/Manifest/';
const MODE_RAID = 4;
const MODE_DUNGEON = 82;

/** Kept identical to src/activities.ts. tests/fallback.test.ts proves they agree. */
const SUFFIXES = [
  'Standard', 'Normal', 'Master', 'Legend',
  'Expert', 'Contest', 'Prestige', 'Challenge Mode'
];
const SUFFIX_PATTERN = new RegExp(':\\s*(' + SUFFIXES.join('|') + '|Level\\s+\\d+)\\s*$');

function splitVariant(raw) {
  const trimmed = raw.trim();
  const match = SUFFIX_PATTERN.exec(trimmed);
  if (!match) return { name: trimmed, tier: 'Standard' };
  const name = trimmed.slice(0, match.index).trim();
  if (name.length === 0) return { name: trimmed, tier: 'Standard' };
  return { name, tier: match[1].replace(/\s+/g, ' ').trim() };
}

const isPantheon = (name) => /^(the\s+)?pantheon\s*:/i.test(name.trim());

async function getJson(url, tries = 5) {
  let last;
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const body = await res.json();
      if (res.ok && (body.ErrorCode === undefined || body.ErrorCode === 1)) return body;
      last = new Error('ErrorCode ' + body.ErrorCode + ' ' + (body.ErrorStatus || res.status));
    } catch (err) {
      last = err;
    }
    await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  throw last;
}

async function main() {
  process.stdout.write('fetching manifest ...\n');
  const manifest = await getJson(API);
  const version = manifest.Response.version;
  const path = manifest.Response.jsonWorldComponentContentPaths.en.DestinyActivityDefinition;
  process.stdout.write('manifest version ' + version + '\n');

  process.stdout.write('fetching activity definitions ...\n');
  const defs = await getJson('https://www.bungie.net' + path);
  const all = Object.values(defs);
  process.stdout.write('activity definitions: ' + all.length + '\n');

  const relevant = all.filter(
    (d) =>
      Array.isArray(d.activityModeTypes) &&
      (d.activityModeTypes.includes(MODE_RAID) || d.activityModeTypes.includes(MODE_DUNGEON)) &&
      d.displayProperties &&
      typeof d.displayProperties.name === 'string' &&
      d.displayProperties.name.trim().length > 0
  );

  const rawNamesRaid = new Set();
  const rawNamesDungeon = new Set();
  for (const d of relevant) {
    if (d.activityModeTypes.includes(MODE_RAID)) rawNamesRaid.add(d.displayProperties.name);
    if (d.activityModeTypes.includes(MODE_DUNGEON)) rawNamesDungeon.add(d.displayProperties.name);
  }
  process.stdout.write(
    'raw names: ' + rawNamesRaid.size + ' raid, ' + rawNamesDungeon.size + ' dungeon\n'
  );

  // Collapse. Raid wins when a definition is tagged as both.
  const rank = { raid: 0, pantheon: 1, dungeon: 2 };
  const groups = new Map();
  for (const d of relevant) {
    const { name, tier } = splitVariant(d.displayProperties.name);
    const base = d.activityModeTypes.includes(MODE_RAID) ? 'raid' : 'dungeon';
    const category = isPantheon(name) ? 'pantheon' : base;
    const found = groups.get(name);
    if (!found) {
      groups.set(name, { name, category, tiers: [tier], hashes: [d.hash] });
      continue;
    }
    if (rank[category] < rank[found.category]) found.category = category;
    if (!found.tiers.includes(tier)) found.tiers.push(tier);
    if (!found.hashes.includes(d.hash)) found.hashes.push(d.hash);
  }

  const list = [...groups.values()].sort(
    (a, b) => rank[a.category] - rank[b.category] || a.name.localeCompare(b.name)
  );
  for (const g of list) {
    g.tiers.sort();
    g.hashes.sort((a, b) => a - b);
  }

  const counts = { raid: 0, dungeon: 0, pantheon: 0 };
  for (const g of list) counts[g.category] += 1;
  process.stdout.write(
    'collapsed: ' + counts.raid + ' raids, ' + counts.dungeon + ' dungeons, ' +
    counts.pantheon + ' pantheon\n'
  );

  // Raw fixture: just the fields the collapsing reads, so tests exercise the
  // real module against real Bungie data without carrying an 11 MB file.
  const sample = relevant
    .map((d) => ({
      hash: d.hash,
      displayProperties: { name: d.displayProperties.name },
      activityModeTypes: d.activityModeTypes.slice().sort((a, b) => a - b)
    }))
    .sort((a, b) => a.hash - b.hash);

  writeFileSync(
    join(ROOT, 'fixtures', 'activity-defs.json'),
    JSON.stringify({ manifestVersion: version, definitions: sample }, null, 2) + '\n'
  );

  const header = [
    '/**',
    ' * Fallback activity table.',
    ' *',
    ' * Generated by scripts/derive-activities.mjs. Do not edit by hand.',
    ' *',
    ' * The app derives this list from the live manifest on every visit and only',
    ' * falls back to this snapshot when bungie.net cannot be reached. Keeping it',
    ' * committed means the site still renders something sensible when the API is',
    ' * down, without making the list the source of truth.',
    ' *',
    ' * Manifest version: ' + version,
    ' * Derived: ' + counts.raid + ' raids, ' + counts.dungeon + ' dungeons, ' +
      counts.pantheon + ' pantheon encounters',
    ' */',
    '',
    "import type { ActivityGroup } from './types';",
    '',
    "export const FALLBACK_MANIFEST_VERSION = '" + version + "';",
    '',
    'export const FALLBACK_ACTIVITIES: ActivityGroup[] = ['
  ].join('\n');

  const body = list
    .map((g) => {
      const tiers = g.tiers.map((t) => "'" + t.replace(/'/g, "\\'") + "'").join(', ');
      return (
        '  {\n' +
        "    name: '" + g.name.replace(/'/g, "\\'") + "',\n" +
        "    category: '" + g.category + "',\n" +
        '    tiers: [' + tiers + '],\n' +
        '    hashes: [' + g.hashes.join(', ') + ']\n' +
        '  }'
      );
    })
    .join(',\n');

  writeFileSync(
    join(ROOT, 'src', 'fallback-activities.ts'),
    header + '\n' + body + '\n];\n'
  );

  process.stdout.write('wrote src/fallback-activities.ts and fixtures/activity-defs.json\n');
}

main().catch((err) => {
  process.stderr.write('derive failed: ' + (err && err.message ? err.message : String(err)) + '\n');
  process.exit(1);
});
