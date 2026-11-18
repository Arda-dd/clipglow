import type { CursorStyle, Project, Style, WebcamStyle, ZoomSegment } from './types';

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

export const defaultStyle = (): Style => ({
  background: { kind: 'preset', id: 'aurora' },
  backgroundBlur: 0.4,
  padding: 0.08,
  radius: 18,
  shadow: 0.6,
  aspect: 'auto',
  frame: 'none',
  frameTitle: '',
});

export const defaultCursorStyle = (): CursorStyle => ({ show: true, size: 1.4, smoothing: 0.6, clicks: true });

export const defaultWebcam = (): WebcamStyle => ({
  show: true,
  corner: 'bottom-right',
  size: 0.22,
  shape: 'circle',
  mirror: true,
  shrinkOnZoom: true,
});

export interface NewProject {
  name: string;
  width: number;
  height: number;
  duration: number;
  hasAudio: boolean;
  hasWebcam?: boolean;
  webcamOffset?: number;
  cursor?: Project['cursor'];
  clicks?: Project['clicks'];
}

export function createProject(source: NewProject): Project {
  const now = Date.now();
  return {
    id: uid(),
    name: source.name,
    createdAt: now,
    updatedAt: now,
    width: source.width,
    height: source.height,
    duration: source.duration,
    hasAudio: source.hasAudio,
    hasWebcam: source.hasWebcam ?? false,
    webcamOffset: source.webcamOffset ?? 0,
    trim: { start: 0, end: source.duration },
    zooms: [],
    cameraSpeed: 'normal',
    cursor: source.cursor,
    clicks: source.clicks,
    style: defaultStyle(),
    cursorStyle: defaultCursorStyle(),
    webcam: defaultWebcam(),
  };
}

export const MIN_ZOOM_LENGTH = 0.5;

export function newZoom(start: number, end: number, focus = { x: 0.5, y: 0.5 }, scale = 2): ZoomSegment {
  return { id: uid(), start, end, scale, focus, follow: false, origin: 'manual' };
}

/** Sorts segments and removes overlaps, so that the timeline always shows clean, separate blocks. */
export function normalizeZooms(zooms: ZoomSegment[], duration: number): ZoomSegment[] {
  const sorted = zooms
    .map((z) => ({ ...z, start: clamp(z.start, 0, duration), end: clamp(z.end, 0, duration) }))
    .filter((z) => z.end - z.start >= MIN_ZOOM_LENGTH - 1e-6)
    .sort((a, b) => a.start - b.start);
  const out: ZoomSegment[] = [];
  for (const z of sorted) {
    const prev = out[out.length - 1];
    if (prev && z.start < prev.end) {
      const start = prev.end;
      if (z.end - start >= MIN_ZOOM_LENGTH) out.push({ ...z, start });
    } else out.push(z);
  }
  return out;
}

/** The free space at `t` where a new zoom can go, or null if `t` is inside a zoom. */
export function freeSlot(zooms: ZoomSegment[], t: number, duration: number): { start: number; end: number } | null {
  if (zooms.some((z) => t >= z.start && t < z.end)) return null;
  const before = zooms.filter((z) => z.end <= t).reduce((m, z) => Math.max(m, z.end), 0);
  const after = zooms.filter((z) => z.start > t).reduce((m, z) => Math.min(m, z.start), duration);
  return { start: before, end: after };
}

export function formatTime(seconds: number, precise = false): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  const sec = precise ? rest.toFixed(1).padStart(4, '0') : String(Math.floor(rest)).padStart(2, '0');
  return `${m}:${sec}`;
}
