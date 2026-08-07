import { describe, expect, it } from 'vitest';
import {
  buildHashIndex,
  collapseActivities,
  collapseName,
  countByCategory,
  isPantheon,
  splitVariant,
  MODE_DUNGEON,
  MODE_RAID
} from '../src/activities';
import type { RawActivityDef } from '../src/types';
import realDefs from '../fixtures/activity-defs.json';

const def = (hash: number, name: string, modes: number[]): RawActivityDef => ({
  hash,
  displayProperties: { name },
  activityModeTypes: modes
});

describe('splitVariant: every difficulty suffix', () => {
  it('strips ": Standard"', () => {
    expect(splitVariant('Vault of Glass: Standard')).toEqual({
      name: 'Vault of Glass',
      tier: 'Standard'
    });
  });

  it('strips ": Normal"', () => {
    expect(splitVariant('Leviathan: Normal')).toEqual({ name: 'Leviathan', tier: 'Normal' });
  });

  it('strips ": Master"', () => {
    expect(splitVariant('Vault of Glass: Master')).toEqual({
      name: 'Vault of Glass',
      tier: 'Master'
    });
  });

  it('strips ": Legend"', () => {
    expect(splitVariant('Pit of Heresy: Legend')).toEqual({
      name: 'Pit of Heresy',
      tier: 'Legend'
    });
  });

  it('strips ": Expert"', () => {
    expect(splitVariant("King's Fall: Expert")).toEqual({ name: "King's Fall", tier: 'Expert' });
  });

  it('strips ": Contest"', () => {
    expect(splitVariant('Equilibrium: Contest')).toEqual({ name: 'Equilibrium', tier: 'Contest' });
  });

  it('strips ": Prestige"', () => {
    expect(splitVariant('Leviathan: Prestige')).toEqual({ name: 'Leviathan', tier: 'Prestige' });
  });

  it('strips ": Challenge Mode"', () => {
    expect(splitVariant('Vault of Glass: Challenge Mode')).toEqual({
      name: 'Vault of Glass',
      tier: 'Challenge Mode'
    });
  });

  it('strips ": Level 55"', () => {
    expect(splitVariant('Last Wish: Level 55')).toEqual({ name: 'Last Wish', tier: 'Level 55' });
  });

  it('strips ": Level 58"', () => {
    expect(splitVariant('Last Wish: Level 58')).toEqual({ name: 'Last Wish', tier: 'Level 58' });
  });

  it('strips a Level suffix of any digit count', () => {
    expect(splitVariant('Last Wish: Level 5').name).toBe('Last Wish');
    expect(splitVariant('Last Wish: Level 100').name).toBe('Last Wish');
  });

  it('tolerates extra spacing around the suffix', () => {
    expect(splitVariant('  Duality:   Master  ')).toEqual({ name: 'Duality', tier: 'Master' });
  });
});

describe('splitVariant: what must not be stripped', () => {
  it('keeps a name with no suffix and calls it Standard', () => {
    expect(splitVariant('Deep Stone Crypt')).toEqual({
      name: 'Deep Stone Crypt',
      tier: 'Standard'
    });
  });

  it('only strips a suffix at the end', () => {
    expect(collapseName('Leviathan, Eater of Worlds')).toBe('Leviathan, Eater of Worlds');
  });

  it('does not fold a longer name into a shorter one', () => {
    expect(collapseName('Leviathan, Eater of Worlds: Prestige')).toBe('Leviathan, Eater of Worlds');
    expect(collapseName('Leviathan: Prestige')).toBe('Leviathan');
  });

  it('does not strip an unknown suffix', () => {
    expect(collapseName('The Pantheon: Oryx Exalted')).toBe('The Pantheon: Oryx Exalted');
  });

  it('does not reduce a name that is nothing but a suffix', () => {
    expect(splitVariant(': Master')).toEqual({ name: ': Master', tier: 'Standard' });
  });

  it('does not strip a suffix word that is not preceded by a colon', () => {
    expect(collapseName('Master Rahool')).toBe('Master Rahool');
  });
});

describe('isPantheon', () => {
  it('matches the Pantheon encounters', () => {
    expect(isPantheon('The Pantheon: Oryx Exalted')).toBe(true);
    expect(isPantheon('Pantheon: Atraks Sovereign')).toBe(true);
  });

  it('does not match ordinary raids', () => {
    expect(isPantheon('Vault of Glass')).toBe(false);
    expect(isPantheon('Last Wish')).toBe(false);
  });
});

describe('collapseActivities', () => {
  it('folds every difficulty of one raid into a single row', () => {
    const groups = collapseActivities([
      def(1, 'Vault of Glass: Standard', [MODE_RAID]),
      def(2, 'Vault of Glass: Master', [MODE_RAID]),
      def(3, 'Vault of Glass: Challenge Mode', [MODE_RAID])
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('Vault of Glass');
    expect(groups[0].tiers.sort()).toEqual(['Challenge Mode', 'Master', 'Standard']);
  });

  it('rolls every hash up into the group', () => {
    const groups = collapseActivities([
      def(11, 'Duality: Standard', [MODE_DUNGEON]),
      def(22, 'Duality: Master', [MODE_DUNGEON])
    ]);
    expect(groups[0].hashes.sort((a, b) => a - b)).toEqual([11, 22]);
  });

  it('does not repeat a tier that appears twice', () => {
    const groups = collapseActivities([
      def(1, 'Pit of Heresy: Master', [MODE_DUNGEON]),
      def(2, 'Pit of Heresy: Master', [MODE_DUNGEON])
    ]);
    expect(groups[0].tiers).toEqual(['Master']);
    expect(groups[0].hashes).toEqual([1, 2]);
  });

  it('lets raid win when Bungie tags one activity as both raid and dungeon', () => {
    const groups = collapseActivities([
      def(1, "Crota's End: Legend", [MODE_DUNGEON]),
      def(2, "Crota's End: Standard", [MODE_RAID])
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].category).toBe('raid');
  });

  it('puts Pantheon in its own category even though it carries the raid mode', () => {
    const groups = collapseActivities([def(1, 'The Pantheon: Rhulk Indomitable', [MODE_RAID])]);
    expect(groups[0].category).toBe('pantheon');
  });

  it('ignores activities that are neither raid nor dungeon', () => {
    expect(collapseActivities([def(1, 'Some Strike', [3, 18])])).toEqual([]);
  });

  it('ignores definitions with a blank or missing name', () => {
    const groups = collapseActivities([
      def(1, '   ', [MODE_RAID]),
      { hash: 2, activityModeTypes: [MODE_RAID] }
    ]);
    expect(groups).toEqual([]);
  });

  it('ignores definitions with no mode list at all', () => {
    expect(collapseActivities([{ hash: 1, displayProperties: { name: 'Nameless' } }])).toEqual([]);
  });

  it('sorts raids first, then pantheon, then dungeons', () => {
    const groups = collapseActivities([
      def(1, 'Duality', [MODE_DUNGEON]),
      def(2, 'The Pantheon: Oryx Exalted', [MODE_RAID]),
      def(3, 'Last Wish', [MODE_RAID])
    ]);
    expect(groups.map((g) => g.category)).toEqual(['raid', 'pantheon', 'dungeon']);
  });
});

describe('buildHashIndex', () => {
  it('maps every rolled up hash back to its collapsed name', () => {
    const groups = collapseActivities([
      def(7, 'Duality: Standard', [MODE_DUNGEON]),
      def(8, 'Duality: Master', [MODE_DUNGEON])
    ]);
    const index = buildHashIndex(groups);
    expect(index.get(7)).toBe('Duality');
    expect(index.get(8)).toBe('Duality');
    expect(index.size).toBe(2);
  });
});

describe('against the real manifest snapshot', () => {
  const defs = realDefs.definitions as RawActivityDef[];

  it('starts from 37 raid names and 21 dungeon names', () => {
    const raidNames = new Set(
      defs.filter((d) => d.activityModeTypes?.includes(MODE_RAID)).map((d) => d.displayProperties?.name)
    );
    const dungeonNames = new Set(
      defs.filter((d) => d.activityModeTypes?.includes(MODE_DUNGEON)).map((d) => d.displayProperties?.name)
    );
    expect(raidNames.size).toBe(37);
    expect(dungeonNames.size).toBe(21);
  });

  it('collapses them into one row per real activity', () => {
    const counts = countByCategory(collapseActivities(defs));
    expect(counts).toEqual({ raid: 14, dungeon: 9, pantheon: 4 });
  });

  it('produces one Vault of Glass carrying three tiers', () => {
    const vog = collapseActivities(defs).find((g) => g.name === 'Vault of Glass');
    expect(vog).toBeDefined();
    expect(vog?.tiers.sort()).toEqual(['Challenge Mode', 'Master', 'Standard']);
  });

  it("lists Crota's End exactly once, as a raid", () => {
    const groups = collapseActivities(defs).filter((g) => g.name === "Crota's End");
    expect(groups).toHaveLength(1);
    expect(groups[0].category).toBe('raid');
  });

  it('never emits a name that still carries a difficulty suffix', () => {
    const bad = collapseActivities(defs)
      .map((g) => g.name)
      .filter((n) => /:\s*(Standard|Normal|Master|Legend|Expert|Contest|Prestige|Challenge Mode|Level\s+\d+)$/.test(n));
    expect(bad).toEqual([]);
  });
});
