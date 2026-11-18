// Background wallpapers, drawn as soft blobs of color over a base gradient, with a little grain against banding.

import type { Background } from './types';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

interface Blob {
  x: number;
  y: number;
  r: number;
  color: string;
}

export interface Preset {
  id: string;
  name: string;
  /** Linear gradient from top left to bottom right. */
  base: [string, string];
  blobs: Blob[];
  /** Dark wallpapers get a lighter shadow edge, light ones a darker one. */
  dark: boolean;
}

export const PRESETS: Preset[] = [
  {
    id: 'aurora',
    name: 'Aurora',
    base: ['#0b1026', '#1a1145'],
    dark: true,
    blobs: [
      { x: 0.1, y: 0.15, r: 0.7, color: '#2dd4bf' },
      { x: 0.85, y: 0.25, r: 0.65, color: '#7c3aed' },
      { x: 0.6, y: 1, r: 0.7, color: '#ec4899' },
    ],
  },
  {
    id: 'glow',
    name: 'Glow',
    base: ['#ff7a59', '#7c5cff'],
    dark: true,
    blobs: [
      { x: 0, y: 0, r: 0.8, color: '#ffb36b' },
      { x: 1, y: 0.2, r: 0.7, color: '#ff3d8b' },
      { x: 0.4, y: 1.1, r: 0.8, color: '#6d5cff' },
    ],
  },
  {
    id: 'sunset',
    name: 'Sunset',
    base: ['#ff9966', '#ff5e62'],
    dark: false,
    blobs: [
      { x: 0.2, y: 0.1, r: 0.6, color: '#ffd194' },
      { x: 0.9, y: 0.9, r: 0.7, color: '#d9467a' },
    ],
  },
  {
    id: 'ocean',
    name: 'Ocean',
    base: ['#0f2a6b', '#0b4f8a'],
    dark: true,
    blobs: [
      { x: 0.9, y: 0.1, r: 0.7, color: '#22d3ee' },
      { x: 0.1, y: 0.9, r: 0.75, color: '#2563eb' },
      { x: 0.5, y: 0.5, r: 0.4, color: '#0ea5e9' },
    ],
  },
  {
    id: 'candy',
    name: 'Candy',
    base: ['#fbcfe8', '#c7d2fe'],
    dark: false,
    blobs: [
      { x: 0.1, y: 0.2, r: 0.6, color: '#f9a8d4' },
      { x: 0.9, y: 0.3, r: 0.6, color: '#a5f3fc' },
      { x: 0.5, y: 1, r: 0.65, color: '#c4b5fd' },
    ],
  },
  {
    id: 'forest',
    name: 'Forest',
    base: ['#052e2b', '#0a3d2a'],
    dark: true,
    blobs: [
      { x: 0.15, y: 0.85, r: 0.7, color: '#10b981' },
      { x: 0.9, y: 0.1, r: 0.6, color: '#a3e635' },
    ],
  },
  {
    id: 'peach',
    name: 'Peach',
    base: ['#ffe5c4', '#ffc6c6'],
    dark: false,
    blobs: [
      { x: 0.85, y: 0.15, r: 0.6, color: '#fdffb6' },
      { x: 0.15, y: 0.9, r: 0.6, color: '#ffadad' },
    ],
  },
  {
    id: 'ember',
    name: 'Ember',
    base: ['#1c1210', '#24110f'],
    dark: true,
    blobs: [
      { x: 0.8, y: 0.85, r: 0.75, color: '#f97316' },
      { x: 0.15, y: 0.1, r: 0.55, color: '#dc2626' },
    ],
  },
  {
    id: 'lavender',
    name: 'Lavender',
    base: ['#ede9fe', '#e0e7ff'],
    dark: false,
    blobs: [
      { x: 0.2, y: 0.8, r: 0.6, color: '#d8b4fe' },
      { x: 0.85, y: 0.2, r: 0.55, color: '#bfdbfe' },
    ],
  },
  {
    id: 'midnight',
    name: 'Midnight',
    base: ['#020617', '#0f172a'],
    dark: true,
    blobs: [
      { x: 0.8, y: 0.1, r: 0.6, color: '#1e3a5f' },
      { x: 0.1, y: 0.95, r: 0.6, color: '#312e81' },
    ],
  },
  { id: 'paper', name: 'Paper', base: ['#fafaf9', '#e7e5e4'], dark: false, blobs: [] },
  { id: 'graphite', name: 'Graphite', base: ['#3f3f46', '#18181b'], dark: true, blobs: [] },
];

export const presetById = (id: string) => PRESETS.find((p) => p.id === id) ?? PRESETS[0];

function hexToRgba(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

let grain: HTMLCanvasElement | OffscreenCanvas | null = null;

function grainTile(): HTMLCanvasElement | OffscreenCanvas | null {
  if (grain) return grain;
  try {
    const size = 128;
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d') as Ctx | null;
    if (!ctx) return null;
    const img = ctx.createImageData(size, size);
    let seed = 7;
    for (let i = 0; i < img.data.length; i += 4) {
      seed = (seed * 16807) % 2147483647;
      const v = seed % 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 10;
    }
    ctx.putImageData(img, 0, 0);
    grain = c;
    return c;
  } catch {
    return null;
  }
}

export function drawPreset(ctx: Ctx, preset: Preset, w: number, h: number) {
  const base = ctx.createLinearGradient(0, 0, w, h);
  base.addColorStop(0, preset.base[0]);
  base.addColorStop(1, preset.base[1]);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  const size = Math.max(w, h);
  for (const b of preset.blobs) {
    const g = ctx.createRadialGradient(b.x * w, b.y * h, 0, b.x * w, b.y * h, b.r * size);
    g.addColorStop(0, hexToRgba(b.color, 0.85));
    g.addColorStop(0.55, hexToRgba(b.color, 0.25));
    g.addColorStop(1, hexToRgba(b.color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  const tile = grainTile();
  if (tile) {
    const pattern = ctx.createPattern(tile, 'repeat');
    if (pattern) {
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, w, h);
    }
  }
}

/** Draws an image so that it covers the whole area, optionally blurred. */
export function drawCover(ctx: Ctx, image: CanvasImageSource & { width: number; height: number }, w: number, h: number, blur: number) {
  const iw = image.width;
  const ih = image.height;
  const scale = Math.max(w / iw, h / ih) * (blur > 0 ? 1.08 : 1);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.save();
  if (blur > 0) ctx.filter = `blur(${Math.round(blur * Math.min(w, h) * 0.04)}px)`;
  ctx.drawImage(image, (w - dw) / 2, (h - dh) / 2, dw, dh);
  ctx.restore();
}

export interface BackgroundAssets {
  image?: (CanvasImageSource & { width: number; height: number }) | null;
}

export function drawBackground(ctx: Ctx, bg: Background, blur: number, w: number, h: number, assets: BackgroundAssets) {
  if (bg.kind === 'solid') {
    ctx.fillStyle = bg.color;
    ctx.fillRect(0, 0, w, h);
  } else if (bg.kind === 'image' && assets.image) {
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, w, h);
    drawCover(ctx, assets.image, w, h, blur);
  } else {
    drawPreset(ctx, presetById(bg.kind === 'preset' ? bg.id : 'aurora'), w, h);
  }
}

/** A small preview of a preset as a data URL, for the background picker. */
export function presetThumbnail(preset: Preset, w = 96, h = 64): string {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  drawPreset(ctx, preset, w, h);
  return c.toDataURL();
}
