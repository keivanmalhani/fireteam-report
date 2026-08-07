/** Shared types. No runtime behaviour lives here. */

export type ActivityCategory = 'raid' | 'dungeon' | 'pantheon';

/** The shape we care about from DestinyActivityDefinition. */
export interface RawActivityDef {
  hash: number;
  displayProperties?: { name?: string };
  activityModeTypes?: number[];
}

/** One row of the matrix: a real activity with its difficulty tiers folded in. */
export interface ActivityGroup {
  /** Collapsed name, e.g. "Vault of Glass". */
  name: string;
  category: ActivityCategory;
  /** Difficulty tiers seen for this activity, e.g. ["Standard", "Master"]. */
  tiers: string[];
  /** Every activity hash that rolls up into this group. */
  hashes: number[];
}

/** A Bungie Name, split into its two parts. */
export interface PlayerRef {
  name: string;
  code: number;
}

/** Why a player has no usable numbers. */
export type PlayerProblem = 'private' | 'not-found' | 'error';

export interface PlayerStats {
  ref: PlayerRef;
  /** "Guardian#1234" */
  label: string;
  membershipType?: number;
  membershipId?: string;
  /** Clears keyed by collapsed activity name. */
  clears: Record<string, number>;
  problem?: PlayerProblem;
  problemDetail?: string;
}
