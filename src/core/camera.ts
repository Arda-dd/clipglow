// The virtual camera: where the view is zoomed in at any moment.
//
// Zoom segments say *what* to show. The camera moves there with a critically damped spring, which gives the soft,
// natural start and stop people know from Screen Studio, never overshoots, and handles any sequence of segments
// (zooming in, panning from one spot to the next, zooming out) with the same few lines.
//
// Springs depend on their history, so seeking to any time must give the same answer as playing up to it. The whole
// path is therefore simulated once per edit at a fixed rate, and looking up a time is just reading that table.

import { clamp } from './project';
import type { CameraSpeed, CursorSample, Point, ZoomSegment } from './types';

export interface CameraState {
  scale: number;
  x: number;
  y: number;
}

export const RATE = 120;

/** Angular frequency of the spring. Higher is faster; it settles in about 4.7 / omega seconds. */
const OMEGA: Record<CameraSpeed, number> = { slow: 5.5, normal: 8.5, fast: 13 };
/** Gaps between segments shorter than this pan straight across instead of zooming out and in again. */
export const BRIDGE = 1.2;

/** Linear interpolation in a sorted list of cursor samples. */
export function cursorAt(samples: CursorSample[], t: number): Point | null {
  if (!samples.length) return null;
  if (t <= samples[0].t) return { x: samples[0].x, y: samples[0].y };
  const last = samples[samples.length - 1];
  if (t >= last.t) return { x: last.x, y: last.y };
  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = samples[lo];
  const b = samples[hi];
  const k = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

/** Keeps the visible area inside the video. */
export function clampFocus(focus: Point, scale: number): Point {
  const half = 0.5 / Math.max(1, scale);
  return { x: clamp(focus.x, half, 1 - half), y: clamp(focus.y, half, 1 - half) };
}

/** Semi-implicit Euler step of a critically damped spring. Mutates `s`. */
function spring(s: { p: number; v: number }, target: number, omega: number, dt: number) {
  s.v += (-2 * omega * s.v - omega * omega * (s.p - target)) * dt;
  s.p += s.v * dt;
}

/** Fixed-rate samples of [a, b, c] triples with linear interpolation between them. */
export class Track {
  constructor(
    private readonly data: Float32Array,
    private readonly rate: number,
  ) {}

  get length() {
    return this.data.length / 3;
  }

  at(t: number): [number, number, number] {
    const n = this.length;
    const f = clamp(t * this.rate, 0, n - 1);
    const i = Math.floor(f);
    const j = Math.min(n - 1, i + 1);
    const k = f - i;
    const d = this.data;
    return [
      d[i * 3] + (d[j * 3] - d[i * 3]) * k,
      d[i * 3 + 1] + (d[j * 3 + 1] - d[i * 3 + 1]) * k,
      d[i * 3 + 2] + (d[j * 3 + 2] - d[i * 3 + 2]) * k,
    ];
  }
}

export interface TargetContext {
  zooms: ZoomSegment[];
  cursor?: CursorSample[];
}

/** Where the camera wants to be at `t`, given where it is now. */
export function cameraTarget(ctx: TargetContext, t: number, current: CameraState): CameraState {
  const { zooms } = ctx;
  const active = zooms.find((z) => t >= z.start && t < z.end);
  const focusOf = (z: ZoomSegment): Point => {
    if (z.follow && ctx.cursor?.length) return cursorAt(ctx.cursor, t) ?? z.focus;
    return z.focus;
  };
  if (active) {
    const f = clampFocus(focusOf(active), active.scale);
    return { scale: active.scale, x: f.x, y: f.y };
  }
  const prev = [...zooms].reverse().find((z) => z.end <= t);
  const next = zooms.find((z) => z.start > t);
  // A short gap between two segments: stay zoomed in and glide over to the next one.
  if (prev && next && next.start - prev.end <= BRIDGE) {
    const scale = Math.min(prev.scale, next.scale);
    const f = clampFocus(focusOf(next), scale);
    return { scale, x: f.x, y: f.y };
  }
  // Zooming out: keep looking at the same spot, so it is a pure zoom out and not a pan. Once fully out the focus no
  // longer matters, so it already moves to the next segment, which makes the next zoom in a pure zoom too.
  if (current.scale > 1.02 || !next) return { scale: 1, x: current.x, y: current.y };
  const f = clampFocus(focusOf(next), next.scale);
  return { scale: 1, x: f.x, y: f.y };
}

export function buildCameraTrack(ctx: TargetContext, duration: number, speed: CameraSpeed = 'normal'): Track {
  const omega = OMEGA[speed];
  const n = Math.max(2, Math.ceil(duration * RATE) + 1);
  const data = new Float32Array(n * 3);
  const dt = 1 / RATE;
  const s = { p: 1, v: 0 };
  const x = { p: 0.5, v: 0 };
  const y = { p: 0.5, v: 0 };
  // Start in the right place if the video begins inside a zoom.
  const first = cameraTarget(ctx, 0, { scale: 1, x: 0.5, y: 0.5 });
  if (ctx.zooms[0] && ctx.zooms[0].start <= 0) {
    s.p = first.scale;
    x.p = first.x;
    y.p = first.y;
  }
  for (let i = 0; i < n; i++) {
    const t = i * dt;
    const target = cameraTarget(ctx, t, { scale: s.p, x: x.p, y: y.p });
    if (i > 0) {
      spring(s, target.scale, omega, dt);
      spring(x, target.x, omega, dt);
      spring(y, target.y, omega, dt);
    }
    data[i * 3] = s.p;
    data[i * 3 + 1] = x.p;
    data[i * 3 + 2] = y.p;
  }
  return new Track(data, RATE);
}

export function cameraAt(track: Track, t: number): CameraState {
  const [scale, x, y] = track.at(t);
  const f = clampFocus({ x, y }, scale);
  return { scale: Math.max(1, scale), x: f.x, y: f.y };
}

/** A smoothed copy of the cursor path. `smoothing` 0 keeps it as recorded, 1 is very smooth. */
export function buildCursorTrack(samples: CursorSample[], duration: number, smoothing: number): Track | null {
  if (!samples.length) return null;
  const omega = 60 - 50 * clamp(smoothing, 0, 1);
  const n = Math.max(2, Math.ceil(duration * RATE) + 1);
  const data = new Float32Array(n * 3);
  const dt = 1 / RATE;
  const start = cursorAt(samples, 0)!;
  const x = { p: start.x, v: 0 };
  const y = { p: start.y, v: 0 };
  // Many small steps per sample keep the spring stable even when it is very stiff.
  const sub = 4;
  for (let i = 0; i < n; i++) {
    const t = i * dt;
    const target = cursorAt(samples, t)!;
    if (i > 0)
      for (let k = 0; k < sub; k++) {
        spring(x, target.x, omega, dt / sub);
        spring(y, target.y, omega, dt / sub);
      }
    data[i * 3] = x.p;
    data[i * 3 + 1] = y.p;
    data[i * 3 + 2] = 0;
  }
  return new Track(data, RATE);
}
