/**
 * Collapsing raid and dungeon variants into one row per real activity.
 *
 * Pure module. Nothing in here touches the network or the DOM, so the rules
 * can be tested directly against a fixture list of definitions.
 *
 * Bungie ships one DestinyActivityDefinition per difficulty, so a single raid
 * shows up as "Vault of Glass: Standard", "Vault of Glass: Master" and
 * "Vault of Glass: Challenge Mode". Players think of that as one raid, so the
 * matrix shows one row and tracks the tiers underneath.
 */

import type { ActivityCategory, ActivityGroup, RawActivityDef } from './types';

/** activityModeTypes value that means Raid. */
export const MODE_RAID = 4;
/** activityModeTypes value that means Dungeon. */
export const MODE_DUNGEON = 82;

/**
 * Difficulty suffixes Bungie appends after a colon. Order matters only for
 * readability; the pattern is anchored to the end of the string so at most one
 * can match.
 */
export const VARIANT_SUFFIXES = [
  'Standard',
  'Normal',
  'Master',
  'Legend',
  'Expert',
  'Contest',
  'Prestige',
  'Challenge Mode'
] as const;

/** Matches ": Master", ": Challenge Mode", ": Level 55" and friends, at the end only. */
const SUFFIX_PATTERN = new RegExp(
  ':\\s*(' + VARIANT_SUFFIXES.join('|') + '|Level\\s+\\d+)\\s*$'
);

/** Tier label used when a definition carries no explicit difficulty suffix. */
export const DEFAULT_TIER = 'Standard';

/**
 * Splits "Vault of Glass: Master" into its activity name and its tier.
 * A name with no recognised suffix keeps its full text and gets the default
 * tier, which is what makes "Leviathan" and "Leviathan: Prestige" line up.
 * Only a trailing suffix is stripped, so "Leviathan, Eater of Worlds" and
 * "The Pantheon: Oryx Exalted" survive intact.
 */
export function splitVariant(rawName: string): { name: string; tier: string } {
  const trimmed = rawName.trim();
  const match = SUFFIX_PATTERN.exec(trimmed);
  if (!match) {
    return { name: trimmed, tier: DEFAULT_TIER };
  }
  const name = trimmed.slice(0, match.index).trim();
  // A name that is nothing but a suffix is not a variant, it is the whole name.
  if (name.length === 0) {
    return { name: trimmed, tier: DEFAULT_TIER };
  }
  return { name, tier: match[1].replace(/\s+/g, ' ').trim() };
}

/** Convenience wrapper when only the collapsed name is wanted. */
export function collapseName(rawName: string): string {
  return splitVariant(rawName).name;
}

/**
 * Pantheon is a limited-time boss rush built out of raid encounters. It carries
 * the raid mode flag but it is not a raid, so it gets its own category and
 * never dilutes the raid totals.
 */
export function isPantheon(name: string): boolean {
  return /^(the\s+)?pantheon\s*:/i.test(name.trim());
}

function categoryFor(name: string, mode: ActivityCategory): ActivityCategory {
  return isPantheon(name) ? 'pantheon' : mode;
}

/**
 * Turns raw definitions into one group per real activity.
 *
 * A definition can carry both mode 4 and mode 82 (Bungie tags Crota's End as
 * both a raid and a dungeon). Raid wins, so the activity appears exactly once.
 */
export function collapseActivities(defs: RawActivityDef[]): ActivityGroup[] {
  const groups = new Map<string, ActivityGroup>();
  const rank: Record<ActivityCategory, number> = { raid: 0, pantheon: 1, dungeon: 2 };

  for (const def of defs) {
    const rawName = def.displayProperties?.name;
    if (!rawName || !rawName.trim()) continue;

    const modes = def.activityModeTypes;
    if (!Array.isArray(modes)) continue;
    const isRaid = modes.includes(MODE_RAID);
    const isDungeon = modes.includes(MODE_DUNGEON);
    if (!isRaid && !isDungeon) continue;

    const { name, tier } = splitVariant(rawName);
    const category = categoryFor(name, isRaid ? 'raid' : 'dungeon');

    const existing = groups.get(name);
    if (!existing) {
      groups.set(name, { name, category, tiers: [tier], hashes: [def.hash] });
      continue;
    }
    // Raid beats dungeon when the same activity is tagged as both.
    if (rank[category] < rank[existing.category]) {
      existing.category = category;
    }
    if (!existing.tiers.includes(tier)) existing.tiers.push(tier);
    if (!existing.hashes.includes(def.hash)) existing.hashes.push(def.hash);
  }

  return [...groups.values()].sort(
    (a, b) => rank[a.category] - rank[b.category] || a.name.localeCompare(b.name)
  );
}

/** Lookup from every rolled-up hash to its collapsed activity name. */
export function buildHashIndex(groups: ActivityGroup[]): Map<number, string> {
  const index = new Map<number, string>();
  for (const group of groups) {
    for (const hash of group.hashes) index.set(hash, group.name);
  }
  return index;
}

export function countByCategory(groups: ActivityGroup[]): Record<ActivityCategory, number> {
  const out: Record<ActivityCategory, number> = { raid: 0, dungeon: 0, pantheon: 0 };
  for (const group of groups) out[group.category] += 1;
  return out;
}
