// Auto zoom.
//
// With cursor data (the sample, or recordings that have it), zooms come from the clicks.
//
// Without it, which is the case for any video you drop in, they come from the picture itself: the video is decoded
// at a low resolution, consecutive frames are compared, and the places where something changes in a small area for a
// while (typing, a menu opening, a toggle) become zooms. Changes that cover a large part of the screen (scrolling, a
// new page) end a zoom instead, because zooming into them would only show part of what is happening.

import { clamp, normalizeZooms, uid } from './project';
import type { Click, ZoomSegment } from './types';

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface MotionSample {
  t: number;
  /** Share of pixels that changed since the previous sample. */
  area: number;
  /** Bounding box of the change (0 to 1), or null if nothing changed. */
  box: Box | null;
}

export const ANALYSIS_WIDTH = 320;
export const ANALYSIS_FPS = 8;

/** Luma difference that counts as a change. Low enough for anti-aliased text, high enough for video noise. */
const PIXEL_THRESHOLD = 22;

export function toGray(rgba: Uint8ClampedArray, out?: Uint8Array): Uint8Array {
  const n = rgba.length / 4;
  const gray = out ?? new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) gray[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  return gray;
}

/**
 * Per-pixel median of three frames. Applied to frames a little apart in time, it removes things that only pass
 * through, like a moving mouse pointer, and keeps changes that stay, like typed text or an opened menu.
 */
export function median3(a: Uint8Array, b: Uint8Array, c: Uint8Array, out?: Uint8Array): Uint8Array {
  const m = out ?? new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    const z = c[i];
    m[i] = x > y ? (y > z ? y : x > z ? z : x) : x > z ? x : y > z ? z : y;
  }
  return m;
}

/**
 * Turns a stream of grayscale frames into motion samples, ignoring the mouse pointer.
 *
 * The cleaned frame for time i is the median of frames i - 2, i and i + 2, so results lag two frames behind the
 * input and are reported with the time of the frame they describe.
 */
export class MotionTracker {
  private frames: { t: number; gray: Uint8Array }[] = [];
  private previous: Uint8Array | null = null;
  readonly samples: MotionSample[] = [];

  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {}

  push(t: number, gray: Uint8Array) {
    this.frames.push({ t, gray });
    if (this.frames.length > 5) this.frames.shift();
    if (this.frames.length < 5) return;
    const [a, , b, , c] = this.frames;
    const clean = median3(a.gray, b.gray, c.gray);
    if (this.previous) this.samples.push(diffFrames(this.previous, clean, this.width, this.height, b.t));
    this.previous = clean;
  }
}

/** Compares two grayscale frames of the same size. */
export function diffFrames(a: Uint8Array, b: Uint8Array, width: number, height: number, t: number): MotionSample {
  let count = 0;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const d = a[row + x] - b[row + x];
      if (d > PIXEL_THRESHOLD || d < -PIXEL_THRESHOLD) {
        count++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  // A couple of changed pixels is compression noise.
  if (count < 3) return { t, area: 0, box: null };
  return {
    t,
    area: count / (width * height),
    box: { x0: x0 / width, y0: y0 / height, x1: (x1 + 1) / width, y1: (y1 + 1) / height },
  };
}

export interface AutoZoomOptions {
  /** Changes larger than this share of the screen end a zoom. */
  bigChange: number;
  /** A zoomed area may grow to at most this share of the width and height. */
  maxSpread: number;
  /** Quiet time that ends a burst of activity. */
  gap: number;
  /** Minimum length of activity, in seconds, to be worth a zoom. */
  minActive: number;
  minScale: number;
  maxScale: number;
}

export const DEFAULTS: AutoZoomOptions = {
  bigChange: 0.22,
  maxSpread: 0.42,
  gap: 1.1,
  minActive: 0.6,
  minScale: 1.35,
  maxScale: 2.4,
};

interface Burst {
  start: number;
  last: number;
  box: Box;
  samples: number;
}

const union = (a: Box, b: Box): Box => ({
  x0: Math.min(a.x0, b.x0),
  y0: Math.min(a.y0, b.y0),
  x1: Math.max(a.x1, b.x1),
  y1: Math.max(a.y1, b.y1),
});

/**
 * How far to zoom so that a box fills about 60% of the view. Box and view are both in shares of the video, so the
 * video's aspect ratio doesn't matter: at scale s the view is 1/s of the width and 1/s of the height.
 */
export function scaleFor(box: Box, o: AutoZoomOptions = DEFAULTS) {
  const w = Math.max(box.x1 - box.x0, 0.02);
  const h = Math.max(box.y1 - box.y0, 0.02);
  return clamp(Math.min(0.6 / w, 0.6 / h), o.minScale, o.maxScale);
}

function burstsFrom(samples: MotionSample[], o: AutoZoomOptions): Burst[] {
  const bursts: Burst[] = [];
  let cur: Burst | null = null;
  const close = () => {
    if (cur) bursts.push(cur);
    cur = null;
  };
  for (const s of samples) {
    if (s.area >= o.bigChange) {
      close();
      continue;
    }
    if (!s.box) {
      if (cur && s.t - cur.last > o.gap) close();
      continue;
    }
    if (!cur) {
      cur = { start: s.t, last: s.t, box: s.box, samples: 1 };
      continue;
    }
    const grown = union(cur.box, s.box);
    if (s.t - cur.last > o.gap || grown.x1 - grown.x0 > o.maxSpread || grown.y1 - grown.y0 > o.maxSpread) {
      close();
      cur = { start: s.t, last: s.t, box: s.box, samples: 1 };
    } else {
      cur.box = grown;
      cur.last = s.t;
      cur.samples++;
    }
  }
  close();
  return bursts;
}

/** Turns motion samples into zoom segments. */
export function zoomsFromMotion(samples: MotionSample[], duration: number, options: Partial<AutoZoomOptions> = {}): ZoomSegment[] {
  const o = { ...DEFAULTS, ...options };
  const bursts = burstsFrom(samples, o).filter((b) => b.last - b.start >= o.minActive && b.samples >= 4);
  const zooms: ZoomSegment[] = [];
  for (const b of bursts) {
    const focus = { x: (b.box.x0 + b.box.x1) / 2, y: (b.box.y0 + b.box.y1) / 2 };
    const scale = scaleFor(b.box, o);
    const start = Math.max(0, b.start - 0.35);
    const end = Math.min(duration, Math.max(b.last + 1, start + 1.6));
    const prev = zooms[zooms.length - 1];
    // Two bursts close together in the same place are one zoom.
    if (prev && start - prev.end < 1.5 && Math.hypot(prev.focus.x - focus.x, prev.focus.y - focus.y) < 0.12) {
      prev.end = end;
      prev.scale = Math.min(prev.scale, scale);
      continue;
    }
    zooms.push({ id: uid(), start, end, scale: round(scale), focus, follow: false, origin: 'auto' });
  }
  return normalizeZooms(zooms, duration);
}

const round = (n: number) => Math.round(n * 20) / 20;

/** Zooms from recorded clicks: clicks close in time and place share one zoom. */
export function zoomsFromClicks(clicks: Click[], duration: number): ZoomSegment[] {
  const sorted = [...clicks].sort((a, b) => a.t - b.t);
  const groups: Click[][] = [];
  for (const c of sorted) {
    const g = groups[groups.length - 1];
    const last = g?.[g.length - 1];
    const cx = g ? g.reduce((s, k) => s + k.x, 0) / g.length : 0;
    const cy = g ? g.reduce((s, k) => s + k.y, 0) / g.length : 0;
    if (g && last && c.t - last.t < 4 && Math.hypot(c.x - cx, c.y - cy) < 0.22) g.push(c);
    else groups.push([c]);
  }
  const zooms = groups.map((g): ZoomSegment => {
    const xs = g.map((c) => c.x);
    const ys = g.map((c) => c.y);
    const box = { x0: Math.min(...xs) - 0.08, y0: Math.min(...ys) - 0.08, x1: Math.max(...xs) + 0.08, y1: Math.max(...ys) + 0.08 };
    const spread = Math.max(box.x1 - box.x0, box.y1 - box.y0);
    return {
      id: uid(),
      start: Math.max(0, g[0].t - 0.6),
      end: Math.min(duration, g[g.length - 1].t + 2),
      scale: round(clamp(0.55 / spread, 1.5, 2.2)),
      focus: { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 },
      follow: false,
      origin: 'auto',
    };
  });
  return normalizeZooms(zooms, duration);
}

/** Keeps the zooms you made yourself and replaces the automatic ones. */
export function mergeAuto(existing: ZoomSegment[], auto: ZoomSegment[], duration: number): ZoomSegment[] {
  const manual = existing.filter((z) => z.origin === 'manual');
  const free = auto.filter((a) => !manual.some((m) => a.start < m.end && a.end > m.start));
  return normalizeZooms([...manual, ...free], duration);
}
