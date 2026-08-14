// Verbatim transplant of sigma.js official demo canvas renderers
// (packages/demo/src/canvas-utils.ts) — the reference-demo label/hover look.
// Only change: colors are parameterized for dark-mode translation
// (docs/design/graph-sigma-parity-2026-07-27.md §5). Drawing geometry is
// untouched.

import type { Settings } from 'sigma/settings';
import type { NodeDisplayData, PartialButFor, PlainObject } from 'sigma/types';

export interface CanvasTheme {
  /** drawLabel plate fill (original: #ffffffcc). */
  labelPlate: string;
  /** Label text color (original: #000000). */
  text: string;
  /** drawHover card fill (original: #fff). */
  hoverCard: string;
  /** drawHover card shadow (original: #000). */
  hoverShadow: string;
}

export const CANVAS_THEME_LIGHT: CanvasTheme = {
  labelPlate: '#ffffffcc',
  text: '#000000',
  hoverCard: '#fff',
  hoverShadow: '#000',
};

export const CANVAS_THEME_DARK: CanvasTheme = {
  labelPlate: '#111318cc',
  text: '#e6e6e6',
  hoverCard: '#1c1f26',
  hoverShadow: '#000',
};

function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/** Hover card: label + type subLabel + community label in community color. */
export function makeDrawHover(theme: CanvasTheme) {
  return function drawHover(
    context: CanvasRenderingContext2D,
    data: PlainObject,
    settings: PlainObject
  ) {
    const size = settings.labelSize;
    const font = settings.labelFont;
    const weight = settings.labelWeight;
    const subLabelSize = size - 2;

    const label = data.label;
    const subLabel = data.tag !== 'unknown' ? data.tag : '';
    const clusterLabel = data.clusterLabel;

    context.beginPath();
    context.fillStyle = theme.hoverCard;
    context.shadowOffsetX = 0;
    context.shadowOffsetY = 2;
    context.shadowBlur = 8;
    context.shadowColor = theme.hoverShadow;

    context.font = `${weight} ${size}px ${font}`;
    const labelWidth = context.measureText(label).width;
    context.font = `${weight} ${subLabelSize}px ${font}`;
    const subLabelWidth = subLabel ? context.measureText(subLabel).width : 0;
    context.font = `${weight} ${subLabelSize}px ${font}`;
    const clusterLabelWidth = clusterLabel ? context.measureText(clusterLabel).width : 0;

    const textWidth = Math.max(labelWidth, subLabelWidth, clusterLabelWidth);

    const x = Math.round(data.x);
    const y = Math.round(data.y);
    const w = Math.round(textWidth + size / 2 + data.size + 3);
    const hLabel = Math.round(size / 2 + 4);
    const hSubLabel = subLabel ? Math.round(subLabelSize / 2 + 9) : 0;
    const hClusterLabel = clusterLabel ? Math.round(subLabelSize / 2 + 9) : 0;

    drawRoundRect(context, x, y - hSubLabel - 12, w, hClusterLabel + hLabel + hSubLabel + 12, 5);
    context.closePath();
    context.fill();

    context.shadowOffsetX = 0;
    context.shadowOffsetY = 0;
    context.shadowBlur = 0;

    context.fillStyle = theme.text;
    context.font = `${weight} ${size}px ${font}`;
    context.fillText(label, data.x + data.size + 3, data.y + size / 3);

    if (subLabel) {
      context.fillStyle = theme.text;
      context.font = `${weight} ${subLabelSize}px ${font}`;
      context.fillText(subLabel, data.x + data.size + 3, data.y - (2 * size) / 3 - 2);
    }

    if (clusterLabel) {
      context.fillStyle = data.color;
      context.font = `${weight} ${subLabelSize}px ${font}`;
      context.fillText(clusterLabel, data.x + data.size + 3, data.y + size / 3 + 3 + subLabelSize);
    }
  };
}

/** Node label: translucent plate + text (the reference-demo label plate). */
export function makeDrawLabel(theme: CanvasTheme) {
  return function drawLabel(
    context: CanvasRenderingContext2D,
    data: PartialButFor<NodeDisplayData, 'x' | 'y' | 'size' | 'label' | 'color'>,
    settings: Settings
  ): void {
    if (!data.label) return;

    const size = settings.labelSize,
      font = settings.labelFont,
      weight = settings.labelWeight;

    context.font = `${weight} ${size}px ${font}`;
    const width = context.measureText(data.label).width + 8;

    context.fillStyle = theme.labelPlate;
    context.fillRect(data.x + data.size, data.y + size / 3 - 15, width, 20);

    context.fillStyle = theme.text;
    context.fillText(data.label, data.x + data.size + 3, data.y + size / 3);
  };
}
