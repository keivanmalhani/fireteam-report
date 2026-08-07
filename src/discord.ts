/**
 * The "copy for Discord" text.
 *
 * Pure. Plain text, no markdown tables, short enough to paste into a channel
 * without anyone having to scroll past it. Discord's message limit is 2000
 * characters, so the list is capped and the remainder is counted rather than
 * dumped.
 */

import { KIND_LABEL, type Recommendation } from './recommend';
import type { PlayerStats } from './types';

export const DISCORD_LIMIT = 2000;
export const MAX_LINES = 5;

export interface DiscordOptions {
  recommendations: Recommendation[];
  players: PlayerStats[];
  shareUrl?: string;
  maxLines?: number;
}

export function buildDiscordSummary(options: DiscordOptions): string {
  const { recommendations, players, shareUrl, maxLines = MAX_LINES } = options;

  const names = players.map((p) => p.ref.name).join(', ');
  const lines: string[] = [];

  lines.push('Fireteam Report: ' + (names || 'nobody yet'));

  const problems = players.filter((p) => p.problem);
  if (problems.length > 0) {
    lines.push(
      '(' + problems.map((p) => p.ref.name).join(', ') +
        (problems.length === 1 ? ' has' : ' have') +
        ' private stats, so not counted)'
    );
  }

  lines.push('');

  if (recommendations.length === 0) {
    lines.push('No strong picks. Everyone is at a similar level on everything.');
  } else {
    lines.push('Tonight:');
    const shown = recommendations.slice(0, maxLines);
    shown.forEach((rec, i) => {
      lines.push(
        String(i + 1) + '. ' + rec.activity + ' [' + KIND_LABEL[rec.kind] + '] ' + rec.reason
      );
    });
    const rest = recommendations.length - shown.length;
    if (rest > 0) lines.push('...and ' + rest + ' more on the site.');
  }

  if (shareUrl) {
    lines.push('');
    lines.push(shareUrl);
  }

  const text = lines.join('\n');
  return text.length <= DISCORD_LIMIT ? text : text.slice(0, DISCORD_LIMIT - 3) + '...';
}
