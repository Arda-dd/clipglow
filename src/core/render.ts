// Draws one frame of the final video. The same code runs for the live preview and the export, so what you see is
// exactly what you get.

import { drawBackground, presetById } from './backgrounds';
import { buildCameraTrack, buildCursorTrack, cameraAt, type CameraState, type Track } from './camera';
import { clamp } from './project';
import type { Aspect, Corner, Project } from './types';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Canvas = HTMLCanvasElement | OffscreenCanvas;
export type Drawable = CanvasImageSource & { width?: number; height?: number };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const RATIOS: Record<Exclude<Aspect, 'auto'>, number> = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
  '4:5': 4 / 5,
  '4:3': 4 / 3,
};

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Output size for a given shorter side, e.g. 1080 for "1080p". */
export function outputSize(project: Pick<Project, 'width' | 'height' | 'style'>, shortSide: number) {
  const ratio = project.style.aspect === 'auto' ? project.width / project.height : RATIOS[project.style.aspect];
  return ratio >= 1
    ? { width: even(shortSide * ratio), height: even(shortSide) }
    : { width: even(shortSide), height: even(shortSide / ratio) };
}

/** Height of the window title bar as a share of the window width. */
const BAR = 0.034;

export interface Layout {
  /** The whole window: title bar and video. */
  window: Rect;
  /** Just the video. */
  content: Rect;
  bar: number;
  radius: number;
  /** One unit is one pixel of a 1080p output, so sizes look the same at every resolution. */
  unit: number;
}

export function layout(project: Pick<Project, 'width' | 'height' | 'style'>, w: number, h: number): Layout {
  const { style } = project;
  const unit = Math.min(w, h) / 1080;
  const pad = style.padding * Math.min(w, h);
  const availW = w - pad * 2;
  const availH = h - pad * 2;
  const bar = style.frame === 'none' ? 0 : BAR;
  const k = Math.min(availW / project.width, availH / (project.height + bar * project.width));
  const cw = project.width * k;
  const ch = project.height * k;
  const barH = bar * cw;
  const x = (w - cw) / 2;
  const y = (h - ch - barH) / 2;
  const radius = pad > 0 || style.frame !== 'none' ? Math.min(style.radius * unit, cw / 4) : 0;
  return {
    window: { x, y, w: cw, h: ch + barH },
    content: { x, y: y + barH, w: cw, h: ch },
    bar: barH,
    radius,
    unit,
  };
}

function roundRect(ctx: Ctx, r: Rect, radius: number | number[]) {
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, radius);
}

/** The part of the source video that is visible for a camera state, in source pixels. */
export function viewRect(camera: CameraState, width: number, height: number): Rect {
  const w = width / camera.scale;
  const h = height / camera.scale;
  return { x: camera.x * width - w / 2, y: camera.y * height - h / 2, w, h };
}

/** Maps a point in the source video (0 to 1) to the output canvas. */
export function toCanvas(point: { x: number; y: number }, camera: CameraState, content: Rect) {
  const vx = camera.x - 0.5 / camera.scale;
  const vy = camera.y - 0.5 / camera.scale;
  return {
    x: content.x + (point.x - vx) * camera.scale * content.w,
    y: content.y + (point.y - vy) * camera.scale * content.h,
  };
}

/** Maps a point on the output canvas back to the source video (0 to 1), for clicking on the preview. */
export function fromCanvas(point: { x: number; y: number }, camera: CameraState, content: Rect) {
  const vx = camera.x - 0.5 / camera.scale;
  const vy = camera.y - 0.5 / camera.scale;
  return {
    x: vx + (point.x - content.x) / content.w / camera.scale,
    y: vy + (point.y - content.y) / content.h / camera.scale,
  };
}

function drawWindowBar(ctx: Ctx, project: Project, l: Layout, dark: boolean) {
  const { window: win, bar, radius } = l;
  const r = { x: win.x, y: win.y, w: win.w, h: bar };
  ctx.fillStyle = dark ? '#26272b' : '#ececef';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)';
  ctx.fillRect(r.x, r.y + r.h - Math.max(1, l.unit), r.w, Math.max(1, l.unit));
  const dot = bar * 0.26;
  const cy = r.y + bar / 2;
  const left = r.x + Math.max(radius * 0.6, bar * 0.55);
  ['#ff5f57', '#febc2e', '#28c840'].forEach((color, i) => {
    ctx.beginPath();
    ctx.arc(left + i * dot * 3.1, cy, dot, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  });
  const title = project.style.frameTitle.trim();
  const font = `500 ${Math.round(bar * 0.38)}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
  if (project.style.frame === 'browser') {
    const pw = Math.min(r.w * 0.46, r.w - (left - r.x) * 2 - dot * 20);
    const ph = bar * 0.62;
    const pill = { x: r.x + (r.w - pw) / 2, y: cy - ph / 2, w: pw, h: ph };
    roundRect(ctx, pill, ph / 2);
    ctx.fillStyle = dark ? '#3a3b40' : '#ffffff';
    ctx.fill();
    if (title) {
      ctx.font = font;
      ctx.fillStyle = dark ? '#c9cad1' : '#55565c';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(fitText(ctx, title, pw - ph), pill.x + pw / 2, cy + bar * 0.02);
    }
  } else if (title) {
    ctx.font = font;
    ctx.fillStyle = dark ? '#c9cad1' : '#55565c';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(fitText(ctx, title, r.w * 0.6), r.x + r.w / 2, cy + bar * 0.02);
  }
}

function fitText(ctx: Ctx, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t + '…';
}

// A classic arrow pointer, one unit tall, tip at (0, 0).
const ARROW: [number, number][] = [
  [0, 0],
  [0, 0.8],
  [0.19, 0.62],
  [0.32, 0.92],
  [0.45, 0.86],
  [0.32, 0.57],
  [0.57, 0.57],
];

function drawArrow(ctx: Ctx, x: number, y: number, size: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size, size);
  ctx.beginPath();
  ARROW.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
  ctx.closePath();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = size * 0.12;
  ctx.shadowOffsetY = size * 0.04;
  ctx.lineJoin = 'round';
  ctx.lineWidth = 0.075;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#111114';
  ctx.fill();
  ctx.restore();
}

export const CLICK_EFFECT = 0.5;

function cornerPosition(corner: Corner, size: number, w: number, h: number, margin: number) {
  const x = corner.endsWith('left') ? margin : w - margin - size;
  const y = corner.startsWith('top') ? margin : h - margin - size;
  return { x, y };
}

/** Draws `image` into `r`, cropped so it covers the whole rectangle. */
function drawCoverInto(ctx: Ctx, image: Drawable, iw: number, ih: number, r: Rect, mirror: boolean) {
  const scale = Math.max(r.w / iw, r.h / ih);
  const sw = r.w / scale;
  const sh = r.h / scale;
  ctx.save();
  if (mirror) {
    ctx.translate(r.x + r.w, r.y);
    ctx.scale(-1, 1);
    ctx.drawImage(image, (iw - sw) / 2, (ih - sh) / 2, sw, sh, 0, 0, r.w, r.h);
  } else ctx.drawImage(image, (iw - sw) / 2, (ih - sh) / 2, sw, sh, r.x, r.y, r.w, r.h);
  ctx.restore();
}

export interface FrameInput {
  t: number;
  screen: Drawable | null;
  webcam?: { image: Drawable; width: number; height: number } | null;
}

export interface RenderAssets {
  backgroundImage?: (CanvasImageSource & { width: number; height: number }) | null;
}

/** Keeps the expensive parts (camera path, background) cached between frames. */
export class Renderer {
  private project!: Project;
  private camera!: Track;
  private cursor: Track | null = null;
  private cameraKey = '';
  private cursorKey = '';
  private bg: { key: string; canvas: Canvas } | null = null;
  private assets: RenderAssets = {};
  private assetsVersion = 0;

  constructor(project: Project) {
    this.setProject(project);
  }

  setProject(project: Project) {
    this.project = project;
    const cameraKey = JSON.stringify([project.zooms, project.cameraSpeed, project.duration, !!project.cursor]);
    if (cameraKey !== this.cameraKey) {
      this.cameraKey = cameraKey;
      this.camera = buildCameraTrack({ zooms: project.zooms, cursor: project.cursor }, project.duration, project.cameraSpeed);
    }
    const cursorKey = JSON.stringify([project.cursorStyle.smoothing, project.duration, project.cursor?.length ?? 0]);
    if (cursorKey !== this.cursorKey) {
      this.cursorKey = cursorKey;
      this.cursor = project.cursor?.length ? buildCursorTrack(project.cursor, project.duration, project.cursorStyle.smoothing) : null;
    }
  }

  setAssets(assets: RenderAssets) {
    this.assets = assets;
    this.assetsVersion++;
  }

  cameraAt(t: number): CameraState {
    return cameraAt(this.camera, t);
  }

  private background(w: number, h: number): Canvas {
    const { style } = this.project;
    const key = JSON.stringify([w, h, style.background, style.backgroundBlur, this.assetsVersion]);
    if (this.bg?.key === key) return this.bg.canvas;
    const canvas: Canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = canvas.getContext('2d') as Ctx;
    drawBackground(ctx, style.background, style.backgroundBlur, w, h, { image: this.assets.backgroundImage });
    this.bg = { key, canvas };
    return canvas;
  }

  draw(ctx: Ctx, w: number, h: number, frame: FrameInput) {
    const p = this.project;
    const { style } = p;
    const l = layout(p, w, h);
    const camera = this.cameraAt(frame.t);
    const dark = style.background.kind === 'preset' ? presetById(style.background.id).dark : true;

    ctx.save();
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(this.background(w, h), 0, 0);

    // Shadow under the window.
    if (style.shadow > 0 && (style.padding > 0 || style.aspect !== 'auto')) {
      ctx.save();
      roundRect(ctx, l.window, l.radius);
      ctx.shadowColor = `rgba(0,0,0,${0.25 + 0.35 * style.shadow})`;
      ctx.shadowBlur = 90 * style.shadow * l.unit;
      ctx.shadowOffsetY = 28 * style.shadow * l.unit;
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.restore();
    }

    // The window: title bar and the zoomed video, clipped to rounded corners.
    ctx.save();
    roundRect(ctx, l.window, l.radius);
    ctx.clip();
    ctx.fillStyle = '#000';
    ctx.fillRect(l.window.x, l.window.y, l.window.w, l.window.h);
    if (l.bar > 0) drawWindowBar(ctx, p, l, dark);
    if (frame.screen) {
      const v = viewRect(camera, p.width, p.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(frame.screen, v.x, v.y, v.w, v.h, l.content.x, l.content.y, l.content.w, l.content.h);
    }
    this.drawCursor(ctx, frame.t, camera, l);
    ctx.restore();

    // A thin edge so light videos don't melt into light backgrounds.
    if (l.radius > 0 || style.padding > 0) {
      roundRect(ctx, l.window, l.radius);
      ctx.lineWidth = Math.max(1, l.unit);
      ctx.strokeStyle = dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.10)';
      ctx.stroke();
    }

    this.drawWebcam(ctx, w, h, camera, frame);
    ctx.restore();
  }

  private drawCursor(ctx: Ctx, t: number, camera: CameraState, l: Layout) {
    const p = this.project;
    if (!this.cursor || !p.cursorStyle.show) return;
    const [x, y] = this.cursor.at(t);
    const pos = toCanvas({ x, y }, camera, l.content);
    // About the size of a real pointer: 2% of the video height, growing with the zoom like the rest of the screen.
    let size = 0.021 * l.content.h * p.cursorStyle.size * camera.scale;
    if (p.cursorStyle.clicks && p.clicks) {
      for (const c of p.clicks) {
        const age = t - c.t;
        if (age < 0 || age > CLICK_EFFECT) continue;
        const k = age / CLICK_EFFECT;
        const at = toCanvas(c, camera, l.content);
        ctx.beginPath();
        ctx.arc(at.x, at.y, size * (0.3 + 1.3 * Math.sin((k * Math.PI) / 2)), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${0.35 * (1 - k)})`;
        ctx.fill();
        ctx.lineWidth = size * 0.07;
        ctx.strokeStyle = `rgba(255,255,255,${0.9 * (1 - k)})`;
        ctx.stroke();
        // The pointer briefly presses down.
        size *= 1 - 0.18 * Math.sin(Math.min(1, k * 2.5) * Math.PI);
      }
    }
    drawArrow(ctx, pos.x, pos.y, size);
  }

  private drawWebcam(ctx: Ctx, w: number, h: number, camera: CameraState, frame: FrameInput) {
    const { webcam } = this.project;
    if (!frame.webcam || !webcam.show) return;
    const short = Math.min(w, h);
    const shrink = webcam.shrinkOnZoom ? 1 - 0.3 * clamp(camera.scale - 1, 0, 1) : 1;
    const size = webcam.size * short * shrink;
    const margin = Math.max(short * 0.03, this.project.style.padding * short * 0.35);
    const pos = cornerPosition(webcam.corner, size, w, h, margin);
    const r = { x: pos.x, y: pos.y, w: size, h: size };
    const radius = webcam.shape === 'circle' ? size / 2 : webcam.shape === 'rounded' ? size * 0.22 : size * 0.04;
    ctx.save();
    roundRect(ctx, r, radius);
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = size * 0.12;
    ctx.shadowOffsetY = size * 0.04;
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.restore();
    ctx.save();
    roundRect(ctx, r, radius);
    ctx.clip();
    drawCoverInto(ctx, frame.webcam.image, frame.webcam.width, frame.webcam.height, r, webcam.mirror);
    ctx.restore();
    roundRect(ctx, r, radius);
    ctx.lineWidth = Math.max(1.5, size * 0.012);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.stroke();
  }
}
