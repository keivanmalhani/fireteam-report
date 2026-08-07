/**
 * Demo mode.
 *
 * A visitor with no API key still sees the whole product working, using an
 * invented fireteam committed to the repo. This is deliberate: asking someone
 * to register for an API key before they know what the site does is a good way
 * to have them close the tab.
 */

import demoData from '../fixtures/demo.json';
import type { PlayerStats } from './types';

interface DemoPlayer {
  name: string;
  code: number;
  label: string;
  blurb: string;
  clears: Record<string, number>;
}

interface DemoFile {
  note: string;
  manifestVersion: string;
  players: DemoPlayer[];
}

const data = demoData as DemoFile;

export const DEMO_MANIFEST_VERSION = data.manifestVersion;

export function demoPlayers(): PlayerStats[] {
  return data.players.map((p) => ({
    ref: { name: p.name, code: p.code },
    label: p.label,
    clears: { ...p.clears }
  }));
}

export function demoBlurbs(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of data.players) out[p.label] = p.blurb;
  return out;
}
