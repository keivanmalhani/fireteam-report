/**
 * The 1200 x 630 share card.
 *
 * This site gets pasted into a group chat, so for most of the people who see it
 * the card *is* the product: they read it in the channel and never click. That
 * decides what goes on it. One pick, big, with the reason in the same words the
 * page uses, then the next few options as a ranked list. The numbers that
 * justify all of it stay on the page, where there is room to read them.
 *
 * The layout maths is a pure function returning boxes so it can be checked
 * without a canvas, and the drawing touches nothing outside the standard 2D
 * context, so the same code runs in the browser and under the headless canvas
 * in scripts/render-og.mjs.
 */

import { KIND_LABEL, type Recommendation, type RecommendationKind } from './recommend';
import type { PlayerStats } from './types';

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

/** How many picks follow the hero. Five in total, same as the Discord text. */
export const CARD_LIST_ROWS = 4;

export const CARD_SITE_LABEL = 'keivanmalhani.github.io/fireteam-report';

/** Straight out of style.css. The card has to look like the page it came from. */
export const CARD_COLORS = {
  bg: '#0b0d11',
  glow: '#191f2b',
  surface: '#13161c',
  line: '#262c37',
  lineSoft: '#1d222b',
  ink: '#e9e7e2',
  dim: '#a2a8b4',
  faint: '#6c7381',
  accent: '#d9a752'
};

/** The verdict colours, same values the page paints the cards with. */
export const KIND_COLORS: Record<RecommendationKind, string> = {
  sherpa: '#d9a752',
  first: '#9b8ce0',
  speedrun: '#4fc3ad',
  lopsided: '#7f8998',
  rusty: '#c08040'
};

/** Nothing recommended means nothing to colour, so the card goes grey. */
export function kindColor(kind: RecommendationKind | null): string {
  return kind === null ? CARD_COLORS.faint : KIND_COLORS[kind];
}

/** Canvas takes rgba() but not #rrggbb plus an alpha, so mix it here. */
export function withAlpha(hex: string, alpha: number): string {
  const raw = hex.replace('#', '');
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha + ')';
}

/* ------------------------------------------------------------------ *
 * Layout
 * ------------------------------------------------------------------ */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A baseline and a size. `x` is the left edge, or the right edge if aligned right. */
export interface TextSpot {
  x: number;
  y: number;
  size: number;
}

export interface CardLayout {
  width: number;
  height: number;
  scale: number;
  pad: number;
  brand: TextSpot;
  tagline: TextSpot;
  headRule: { x: number; y: number; w: number };
  hero: Box;
  heroBorder: number;
  heroTag: { x: number; y: number; h: number; size: number; gap: number };
  heroName: TextSpot & { maxWidth: number };
  heroReason: TextSpot & { maxWidth: number; lineHeight: number };
  listTop: number;
  rowHeight: number;
  rowRankX: number;
  rowBarX: number;
  rowNameX: number;
  rowLabelX: number;
  rowFontSize: number;
  rowLabelSize: number;
  footRule: { x: number; y: number; w: number };
  fireteam: TextSpot & { maxWidth: number };
  site: TextSpot;
}

/** The tag row, the name and two lines of reason, at the reference size. */
const HERO_CONTENT_H = 196;

/**
 * Everything is measured from the 1200 x 630 reference and multiplied through
 * one scale factor, so a half size card is the same card rather than a
 * different one.
 *
 * `listRows` is how many picks will actually be drawn under the hero. A short
 * fireteam can match only one or two rules, and a card with a 200 pixel hole in
 * the middle of it looks broken, so the hero panel takes back the height the
 * missing rows would have used and its contents sit centred inside it.
 */
export function cardLayout(
  width = CARD_WIDTH,
  height = CARD_HEIGHT,
  listRows = CARD_LIST_ROWS
): CardLayout {
  const scale = Math.min(width / CARD_WIDTH, height / CARD_HEIGHT);
  const s = (n: number): number => Math.round(n * scale);

  const pad = s(52);
  const content = width - pad * 2;
  const rowHeight = s(46);
  const missing = Math.max(0, CARD_LIST_ROWS - Math.max(0, listRows));
  const spare = missing * rowHeight;

  const hero: Box = { x: pad, y: s(124), w: content, h: s(236) + spare };
  const heroBorder = s(4);
  const heroTextX = hero.x + s(30);
  const heroTextW = hero.w - s(60);
  const heroTop = hero.y + Math.round((hero.h - s(HERO_CONTENT_H)) / 2);

  return {
    width,
    height,
    scale,
    pad,
    brand: { x: pad, y: s(76), size: s(25) },
    tagline: { x: width - pad, y: s(76), size: s(14) },
    headRule: { x: pad, y: s(100), w: content },
    hero,
    heroBorder,
    heroTag: { x: heroTextX, y: heroTop, h: s(28), size: s(14), gap: s(9) },
    heroName: { x: heroTextX, y: heroTop + s(110), size: s(72), maxWidth: heroTextW },
    heroReason: {
      x: heroTextX,
      y: heroTop + s(158),
      size: s(25),
      lineHeight: s(31),
      maxWidth: heroTextW
    },
    listTop: s(392) + spare,
    rowHeight,
    rowRankX: pad + s(20),
    rowBarX: pad + s(32),
    rowNameX: pad + s(50),
    rowLabelX: width - pad,
    rowFontSize: s(23),
    rowLabelSize: s(14),
    footRule: { x: pad, y: height - s(74), w: content },
    fireteam: {
      x: pad,
      y: height - s(46),
      size: s(16),
      // The site label is right aligned into the rest of the row, so the names
      // get two thirds of the width and give up the tail when they need more.
      maxWidth: Math.round(content * 0.66)
    },
    site: { x: width - pad, y: height - s(46), size: s(16) }
  };
}

/* ------------------------------------------------------------------ *
 * Text fitting
 * ------------------------------------------------------------------ */

export interface MeasureFn {
  (text: string): number;
}

/** Width of `text` when drawn at `size` pixels. */
export interface MeasureAtFn {
  (text: string, size: number): number;
}

/**
 * Shorten with a trailing ellipsis until it fits. Returns the original when it
 * already fits and an empty string when not even one character plus the
 * ellipsis will.
 */
export function truncateToWidth(
  text: string,
  maxWidth: number,
  measure: MeasureFn,
  ellipsis = '...'
): string {
  if (maxWidth <= 0) return '';
  if (measure(text) <= maxWidth) return text;
  for (let n = text.length - 1; n > 0; n--) {
    const candidate = text.slice(0, n).trimEnd() + ellipsis;
    if (measure(candidate) <= maxWidth) return candidate;
  }
  return '';
}

/** Greedy word wrap, hard capped at `maxLines` with the last line truncated. */
export function wrapText(
  text: string,
  maxWidth: number,
  measure: MeasureFn,
  maxLines = 2
): string[] {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? current + ' ' + word : word;
    if (measure(candidate) <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length === maxLines) {
    const consumed = lines.join(' ').split(/\s+/).filter(Boolean).length;
    const rest = words.slice(consumed);
    if (rest.length > 0) {
      lines[maxLines - 1] = truncateToWidth(
        lines[maxLines - 1] + ' ' + rest.join(' '),
        maxWidth,
        measure
      );
    }
  }
  return lines;
}

/**
 * The largest of `sizes` at which the text fits, or the last one if none do.
 *
 * The hero is a Destiny activity name, and those run from "Duality" to "The
 * Pantheon: Rhulk Indomitable". Shrinking the type is better than wrapping it,
 * because a two line hero stops looking like a headline, and better than
 * truncating it, because half an activity name is not a recommendation.
 */
export function fitFontSize(
  text: string,
  maxWidth: number,
  sizes: number[],
  measureAt: MeasureAtFn
): number {
  if (sizes.length === 0) return 0;
  for (const size of sizes) {
    if (measureAt(text, size) <= maxWidth) return size;
  }
  return sizes[sizes.length - 1];
}

/** Hero sizes, largest first. The last one is the floor before truncation. */
export const HERO_SIZES = [72, 64, 57, 50, 44, 38];

/**
 * How far down to nudge a text block that used fewer lines than the space kept
 * for it. The hero panel reserves two lines for the reason; when the reason
 * only needs one, the block would otherwise sit high with the gap underneath.
 */
export function blockShift(
  usedLines: number,
  maxLines: number,
  lineHeight: number
): number {
  const spare = Math.max(0, maxLines - Math.max(0, usedLines));
  return Math.round((spare * lineHeight) / 2);
}

/**
 * The fireteam, named in full when it fits and counted when it does not. Six
 * Bungie names of any length will not fit on one line, and dropping the tail
 * silently would be a lie about who the report is for.
 */
export function fireteamLine(
  names: string[],
  maxWidth: number,
  measure: MeasureFn
): string {
  if (names.length === 0) return '';
  const all = names.join(', ');
  if (measure(all) <= maxWidth) return all;
  for (let keep = names.length - 1; keep >= 1; keep--) {
    const candidate =
      names.slice(0, keep).join(', ') + ' +' + (names.length - keep) + ' more';
    if (measure(candidate) <= maxWidth) return candidate;
  }
  return truncateToWidth(all, maxWidth, measure);
}

/* ------------------------------------------------------------------ *
 * Model
 * ------------------------------------------------------------------ */

/** Same sentence the page shows when no rule matched anything. */
export const NO_PICKS_TITLE = 'No strong picks';
export const NO_PICKS_REASON =
  'Everyone is at a similar level on everything, so pick whatever you feel like.';

export interface CardHero {
  activity: string;
  /** null only in the empty state, which paints the card grey. */
  kind: RecommendationKind | null;
  /** "RAID", "DUNGEON", "PANTHEON", or empty in the empty state. */
  category: string;
  reason: string;
}

export interface CardRow {
  rank: number;
  activity: string;
  kind: RecommendationKind;
}

export interface CardModel {
  hero: CardHero;
  rows: CardRow[];
  fireteam: string[];
  /** Players whose stats could not be read, so the names line stays honest. */
  excluded: number;
  siteLabel: string;
}

export interface CardModelOptions {
  /**
   * In the order they should be shown, which is the caller's business: the app
   * passes the diversified order so the card matches the page and the paste.
   */
  recommendations: Recommendation[];
  players: PlayerStats[];
  siteLabel?: string;
  maxRows?: number;
}

/** Turns a finished report into the handful of strings the card draws. */
export function buildCardModel(options: CardModelOptions): CardModel {
  const {
    recommendations,
    players,
    siteLabel = CARD_SITE_LABEL,
    maxRows = CARD_LIST_ROWS
  } = options;

  const top = recommendations[0];
  const hero: CardHero = top
    ? {
        activity: top.activity,
        kind: top.kind,
        category: top.category.toUpperCase(),
        reason: top.reason
      }
    : { activity: NO_PICKS_TITLE, kind: null, category: '', reason: NO_PICKS_REASON };

  const rows = recommendations
    .slice(1, 1 + Math.max(0, maxRows))
    .map((rec, i) => ({ rank: i + 2, activity: rec.activity, kind: rec.kind }));

  return {
    hero,
    rows,
    fireteam: players.map((p) => p.ref.name),
    excluded: players.filter((p) => p.problem).length,
    siteLabel
  };
}

/* ------------------------------------------------------------------ *
 * Drawing
 * ------------------------------------------------------------------ */

type Ctx = CanvasRenderingContext2D;

// The page's stack first, with DejaVu on the end for headless renders on a
// machine that has no UI fonts at all.
const SANS =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, ' +
  '"Helvetica Neue", Arial, "DejaVu Sans", sans-serif';
const MONO =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, ' +
  '"DejaVu Sans Mono", monospace';

function font(weight: number, size: number, family = SANS): string {
  return weight + ' ' + size + 'px ' + family;
}

/** The layout this model needs, which depends on how many picks it carries. */
export function cardLayoutFor(
  model: CardModel,
  width = CARD_WIDTH,
  height = CARD_HEIGHT
): CardLayout {
  return cardLayout(width, height, model.rows.length);
}

/** Draw the whole card onto a context sized to the layout. */
export function drawCard(
  ctx: Ctx,
  model: CardModel,
  layout: CardLayout = cardLayoutFor(model)
): void {
  const L = layout;
  const C = CARD_COLORS;
  const accent = kindColor(model.hero.kind);
  const measure: MeasureFn = (t) => ctx.measureText(t).width;

  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  drawBackground(ctx, L);

  // Wordmark, set the way the masthead sets it: one word lit, one word dim.
  ctx.font = font(600, L.brand.size);
  ctx.fillStyle = C.ink;
  ctx.fillText('fireteam', L.brand.x, L.brand.y);
  ctx.fillStyle = C.faint;
  ctx.fillText(' report', L.brand.x + measure('fireteam'), L.brand.y);

  ctx.font = font(600, L.tagline.size);
  ctx.fillStyle = C.accent;
  const tagline = 'WHAT TO RUN TONIGHT';
  const trackingTag = L.tagline.size * 0.16;
  drawTracked(
    ctx,
    tagline,
    L.tagline.x - trackedWidth(tagline, trackingTag, measure),
    L.tagline.y,
    trackingTag
  );

  hairline(ctx, L.headRule.x, L.headRule.y, L.headRule.w, C.lineSoft, L.scale);

  drawHero(ctx, model, L, accent);
  drawRows(ctx, model, L);

  hairline(ctx, L.footRule.x, L.footRule.y, L.footRule.w, C.lineSoft, L.scale);

  // The fireteam, small and last, but named.
  ctx.font = font(400, L.fireteam.size);
  ctx.fillStyle = C.dim;
  const note = model.excluded > 0 ? ' (' + model.excluded + ' not counted)' : '';
  const names = fireteamLine(
    model.fireteam,
    L.fireteam.maxWidth - measure(note),
    measure
  );
  ctx.fillText(names + note, L.fireteam.x, L.fireteam.y);

  ctx.font = font(500, L.site.size);
  ctx.fillStyle = C.accent;
  ctx.textAlign = 'right';
  ctx.fillText(model.siteLabel, L.site.x, L.site.y);
  ctx.textAlign = 'left';

  ctx.restore();
}

function drawBackground(ctx: Ctx, L: CardLayout): void {
  const C = CARD_COLORS;
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, L.width, L.height);

  // The page has a wide radial wash above the masthead. Canvas gradients are
  // circular, so this is the round approximation of that ellipse; at this size
  // the difference is not visible.
  const cx = L.width / 2;
  const cy = -220 * L.scale;
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 620 * L.scale);
  glow.addColorStop(0, C.glow);
  glow.addColorStop(1, withAlpha(C.glow, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, L.width, L.height);

  // A hairline edge, so the card does not dissolve into a dark chat client.
  ctx.strokeStyle = C.line;
  ctx.lineWidth = Math.max(1, Math.round(L.scale));
  ctx.strokeRect(0.5, 0.5, L.width - 1, L.height - 1);
}

function drawHero(ctx: Ctx, model: CardModel, L: CardLayout, accent: string): void {
  const C = CARD_COLORS;
  const hero = L.hero;
  const measure: MeasureFn = (t) => ctx.measureText(t).width;

  // Clipping to the rounded panel is what keeps the accent edge square against
  // rounded corners without drawing four arcs by hand.
  ctx.save();
  roundRectPath(ctx, hero.x, hero.y, hero.w, hero.h, 12 * L.scale);
  ctx.clip();
  ctx.fillStyle = C.surface;
  ctx.fillRect(hero.x, hero.y, hero.w, hero.h);
  const wash = ctx.createLinearGradient(hero.x, 0, hero.x + hero.w * 0.5, 0);
  wash.addColorStop(0, withAlpha(accent, 0.14));
  wash.addColorStop(1, withAlpha(accent, 0));
  ctx.fillStyle = wash;
  ctx.fillRect(hero.x, hero.y, hero.w, hero.h);
  ctx.fillStyle = accent;
  ctx.fillRect(hero.x, hero.y, L.heroBorder, hero.h);
  ctx.restore();

  // The reason is measured before anything is placed, because a one line
  // reason moves the whole block down to stay centred in the panel.
  ctx.font = font(400, L.heroReason.size);
  const reason = wrapText(model.hero.reason, L.heroReason.maxWidth, measure, 2);
  const shift = blockShift(reason.length, 2, L.heroReason.lineHeight);

  // Verdict tag, then category tag, in the page's own tag styling.
  let tagX = L.heroTag.x;
  const tagY = L.heroTag.y + shift;
  if (model.hero.kind !== null) {
    tagX = drawTag(ctx, KIND_LABEL[model.hero.kind].toUpperCase(), tagX, tagY, L, accent);
    tagX += L.heroTag.gap;
  }
  if (model.hero.category) {
    drawTag(ctx, model.hero.category, tagX, tagY, L, C.faint, C.line);
  }

  const sizes = HERO_SIZES.map((n) => Math.round(n * L.scale));
  const size = fitFontSize(model.hero.activity, L.heroName.maxWidth, sizes, (t, px) => {
    ctx.font = font(600, px);
    return ctx.measureText(t).width;
  });
  ctx.font = font(600, size);
  ctx.fillStyle = C.ink;
  ctx.fillText(
    truncateToWidth(model.hero.activity, L.heroName.maxWidth, measure),
    L.heroName.x,
    L.heroName.y + shift
  );

  ctx.font = font(400, L.heroReason.size);
  ctx.fillStyle = C.dim;
  reason.forEach((line, i) => {
    ctx.fillText(line, L.heroReason.x, L.heroReason.y + shift + i * L.heroReason.lineHeight);
  });
}

/** Draws one tag box and returns the x its right edge landed on. */
function drawTag(
  ctx: Ctx,
  text: string,
  x: number,
  y: number,
  L: CardLayout,
  ink: string,
  border = ink
): number {
  const padX = Math.round(9 * L.scale);
  const tracking = L.heroTag.size * 0.1;
  ctx.font = font(600, L.heroTag.size);
  const width =
    trackedWidth(text, tracking, (t) => ctx.measureText(t).width) + padX * 2;

  ctx.strokeStyle = border;
  ctx.lineWidth = Math.max(1, Math.round(L.scale));
  roundRectPath(ctx, x + 0.5, y + 0.5, width, L.heroTag.h, 3 * L.scale);
  ctx.stroke();

  ctx.fillStyle = ink;
  drawTracked(ctx, text, x + padX, y + L.heroTag.h / 2 + L.heroTag.size * 0.36, tracking);
  return x + width;
}

function drawRows(ctx: Ctx, model: CardModel, L: CardLayout): void {
  const C = CARD_COLORS;
  const measure: MeasureFn = (t) => ctx.measureText(t).width;

  model.rows.forEach((row, i) => {
    const y = L.listTop + i * L.rowHeight;
    const colour = kindColor(row.kind);

    ctx.font = font(500, Math.round(L.rowFontSize * 0.68), MONO);
    ctx.fillStyle = C.faint;
    ctx.textAlign = 'right';
    ctx.fillText(String(row.rank), L.rowRankX, y);
    ctx.textAlign = 'left';

    // The same 3px verdict stripe the cards on the page carry.
    ctx.fillStyle = colour;
    ctx.fillRect(
      L.rowBarX,
      y - Math.round(L.rowFontSize * 0.74),
      Math.max(2, Math.round(3 * L.scale)),
      Math.round(L.rowFontSize * 0.95)
    );

    const label = KIND_LABEL[row.kind].toUpperCase();
    const tracking = L.rowLabelSize * 0.08;
    ctx.font = font(600, L.rowLabelSize);
    const labelWidth = trackedWidth(label, tracking, measure);
    ctx.fillStyle = colour;
    drawTracked(ctx, label, L.rowLabelX - labelWidth, y, tracking);

    ctx.font = font(500, L.rowFontSize);
    ctx.fillStyle = C.ink;
    const room = L.rowLabelX - labelWidth - L.rowNameX - Math.round(24 * L.scale);
    ctx.fillText(truncateToWidth(row.activity, room, measure), L.rowNameX, y);
  });
}

/** Canvas has no letter spacing, so tracked text is placed one glyph at a time. */
function drawTracked(ctx: Ctx, text: string, x: number, y: number, tracking: number): void {
  let cursor = x;
  for (const ch of text) {
    ctx.fillText(ch, cursor, y);
    cursor += ctx.measureText(ch).width + tracking;
  }
}

/** What `drawTracked` will occupy, needed to right align it. */
export function trackedWidth(
  text: string,
  tracking: number,
  measure: MeasureFn
): number {
  if (text.length === 0) return 0;
  let total = 0;
  for (const ch of text) total += measure(ch);
  return total + tracking * (text.length - 1);
}

function hairline(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  colour: string,
  scale: number
): void {
  ctx.strokeStyle = colour;
  ctx.lineWidth = Math.max(1, Math.round(scale));
  ctx.beginPath();
  ctx.moveTo(x, y + 0.5);
  ctx.lineTo(x + w, y + 0.5);
  ctx.stroke();
}

function roundRectPath(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Render the card in a browser and hand back a PNG blob. */
export async function renderCardPng(model: CardModel): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser would not give us a canvas to draw on.');
  drawCard(ctx, model, cardLayoutFor(model, CARD_WIDTH, CARD_HEIGHT));
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('The browser could not turn the card into a PNG.'));
    }, 'image/png');
  });
}
