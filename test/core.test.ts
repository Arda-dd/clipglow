import { describe, expect, it } from 'vitest';
import { diffFrames, median3, mergeAuto, MotionTracker, scaleFor, zoomsFromClicks, zoomsFromMotion, type MotionSample } from '../src/core/autozoom';
import { buildCameraTrack, buildCursorTrack, cameraAt, clampFocus, cursorAt } from '../src/core/camera';
import { createProject, formatTime, freeSlot, newZoom, normalizeZooms } from '../src/core/project';
import { fromCanvas, layout, outputSize, toCanvas, viewRect } from '../src/core/render';
import type { ZoomSegment } from '../src/core/types';

const project = (over: Partial<ReturnType<typeof createProject>> = {}) => ({
  ...createProject({ name: 'Test', width: 1920, height: 1080, duration: 20, hasAudio: false }),
  ...over,
});

describe('camera', () => {
  it('stays put without zooms', () => {
    const track = buildCameraTrack({ zooms: [] }, 5);
    for (const t of [0, 1, 2.5, 5]) expect(cameraAt(track, t)).toEqual({ scale: 1, x: 0.5, y: 0.5 });
  });

  it('eases into a zoom without overshooting and settles on the target', () => {
    const zoom = newZoom(1, 5, { x: 0.3, y: 0.4 }, 2);
    const track = buildCameraTrack({ zooms: [zoom] }, 8);
    expect(cameraAt(track, 0.9).scale).toBe(1);
    const scales = Array.from({ length: 40 }, (_, i) => cameraAt(track, 1 + i * 0.05).scale);
    for (let i = 1; i < scales.length; i++) expect(scales[i]).toBeGreaterThanOrEqual(scales[i - 1] - 1e-6);
    expect(Math.max(...scales)).toBeLessThanOrEqual(2 + 1e-3);
    const settled = cameraAt(track, 4.5);
    expect(settled.scale).toBeCloseTo(2, 2);
    expect(settled.x).toBeCloseTo(0.3, 2);
    expect(settled.y).toBeCloseTo(0.4, 2);
    expect(cameraAt(track, 7.9).scale).toBeCloseTo(1, 2);
  });

  it('zooms straight into the focus point instead of panning there', () => {
    const track = buildCameraTrack({ zooms: [newZoom(2, 6, { x: 0.8, y: 0.2 }, 2)] }, 8);
    // Halfway through zooming in, the camera already looks at the target (as far as the edge allows).
    const mid = cameraAt(track, 2.15);
    expect(mid.scale).toBeGreaterThan(1.05);
    expect(mid.scale).toBeLessThan(1.95);
    const allowed = clampFocus({ x: 0.8, y: 0.2 }, mid.scale);
    expect(mid.x).toBeCloseTo(allowed.x, 2);
    expect(mid.y).toBeCloseTo(allowed.y, 2);
  });

  it('glides between close segments without zooming out', () => {
    const zooms = [newZoom(1, 3, { x: 0.3, y: 0.3 }, 2), newZoom(3.3, 6, { x: 0.7, y: 0.7 }, 2)];
    const track = buildCameraTrack({ zooms }, 8);
    for (let t = 2.5; t < 4; t += 0.05) expect(cameraAt(track, t).scale).toBeGreaterThan(1.9);
    expect(cameraAt(track, 5.5).x).toBeCloseTo(0.7, 2);
  });

  it('never shows anything outside the video', () => {
    const track = buildCameraTrack({ zooms: [newZoom(0, 4, { x: 0, y: 1 }, 3)] }, 5);
    for (let t = 0; t <= 5; t += 0.1) {
      const c = cameraAt(track, t);
      const v = viewRect(c, 1920, 1080);
      expect(v.x).toBeGreaterThanOrEqual(-1e-6);
      expect(v.y).toBeGreaterThanOrEqual(-1e-6);
      expect(v.x + v.w).toBeLessThanOrEqual(1920 + 1e-3);
      expect(v.y + v.h).toBeLessThanOrEqual(1080 + 1e-3);
    }
  });

  it('starts zoomed in when the first zoom starts at zero', () => {
    const track = buildCameraTrack({ zooms: [newZoom(0, 3, { x: 0.5, y: 0.5 }, 2)] }, 4);
    expect(cameraAt(track, 0).scale).toBeCloseTo(2, 3);
  });

  it('follows the cursor when asked to', () => {
    const cursor = Array.from({ length: 61 }, (_, i) => ({ t: i * 0.1, x: 0.2 + i * 0.01, y: 0.5 }));
    const zoom = { ...newZoom(0, 6, { x: 0.5, y: 0.5 }, 2), follow: true };
    const track = buildCameraTrack({ zooms: [zoom], cursor }, 6);
    expect(cameraAt(track, 2).x).toBeLessThan(cameraAt(track, 5).x);
  });

  it('interpolates and smooths the cursor', () => {
    const samples = [
      { t: 0, x: 0, y: 0 },
      { t: 1, x: 1, y: 0.5 },
    ];
    expect(cursorAt(samples, 0.5)).toEqual({ x: 0.5, y: 0.25 });
    expect(cursorAt(samples, 5)).toEqual({ x: 1, y: 0.5 });
    const smooth = buildCursorTrack(samples, 3, 0.8)!;
    expect(smooth.at(0.5)[0]).toBeLessThan(0.5);
    expect(smooth.at(2.9)[0]).toBeCloseTo(1, 2);
  });
});

describe('zoom segments', () => {
  it('sorts, clamps and removes overlaps', () => {
    const zooms = normalizeZooms([newZoom(5, 9), newZoom(1, 4), newZoom(3, 6), newZoom(18, 30)], 20);
    expect(zooms.map((z) => [z.start, z.end])).toEqual([
      [1, 4],
      [4, 6],
      [6, 9],
      [18, 20],
    ]);
  });

  it('drops segments that become too short', () => {
    expect(normalizeZooms([newZoom(1, 4), newZoom(3.8, 4.1)], 20)).toHaveLength(1);
  });

  it('finds free space for a new zoom', () => {
    const zooms = [newZoom(2, 4), newZoom(8, 10)];
    expect(freeSlot(zooms, 5, 20)).toEqual({ start: 4, end: 8 });
    expect(freeSlot(zooms, 3, 20)).toBeNull();
    expect(freeSlot(zooms, 12, 20)).toEqual({ start: 10, end: 20 });
  });

  it('formats times', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(75.4)).toBe('1:15');
    expect(formatTime(3.25, true)).toBe('0:03.3');
  });
});

describe('auto zoom', () => {
  const frame = (w: number, h: number, fill: (x: number, y: number) => number) => {
    const a = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = fill(x, y);
    return a;
  };

  it('takes the per-pixel median of three frames', () => {
    const m = median3(Uint8Array.from([1, 9, 5, 7]), Uint8Array.from([5, 1, 9, 7]), Uint8Array.from([9, 5, 1, 0]));
    expect([...m]).toEqual([5, 5, 5, 7]);
  });

  it('ignores a moving pointer but sees content that changes and stays', () => {
    const w = 64;
    const h = 40;
    const tracker = new MotionTracker(w, h);
    for (let i = 0; i < 24; i++) {
      const pointer = 4 + i * 2; // moves 2 px per frame across the screen
      const typed = i >= 12 ? Math.min(10, i - 11) : 0; // text appears from frame 12 on
      tracker.push(
        i / 8,
        frame(w, h, (x, y) => {
          if (x >= pointer && x < pointer + 2 && y >= 30 && y < 33) return 0;
          if (y >= 10 && y < 12 && x >= 20 && x < 20 + typed * 2) return 0;
          return 220;
        }),
      );
    }
    const moving = tracker.samples.filter((s) => s.box && s.box.y0 > 0.6);
    expect(moving).toHaveLength(0);
    const typing = tracker.samples.filter((s) => s.box);
    expect(typing.length).toBeGreaterThan(3);
    for (const s of typing) expect(s.box!.y0).toBeCloseTo(10 / h);
  });

  it('measures where two frames differ', () => {
    const a = frame(100, 50, () => 10);
    const b = frame(100, 50, (x, y) => (x >= 20 && x < 30 && y >= 10 && y < 20 ? 200 : 10));
    const s = diffFrames(a, b, 100, 50, 1);
    expect(s.area).toBeCloseTo(100 / 5000);
    expect(s.box).toEqual({ x0: 0.2, y0: 0.2, x1: 0.3, y1: 0.4 });
    expect(diffFrames(a, a, 100, 50, 2)).toEqual({ t: 2, area: 0, box: null });
  });

  const typing = (from: number, to: number, box = { x0: 0.1, y0: 0.1, x1: 0.2, y1: 0.15 }): MotionSample[] => {
    const out: MotionSample[] = [];
    for (let t = from; t < to; t += 0.125) out.push({ t, area: 0.002, box });
    return out;
  };

  it('zooms into a small area with ongoing changes', () => {
    const zooms = zoomsFromMotion(typing(2, 4), 10);
    expect(zooms).toHaveLength(1);
    const [z] = zooms;
    expect(z.origin).toBe('auto');
    expect(z.start).toBeCloseTo(1.65, 2);
    expect(z.end).toBeGreaterThan(4.8);
    expect(z.focus.x).toBeCloseTo(0.15);
    expect(z.scale).toBeGreaterThan(2);
  });

  it('ignores short blips and large changes', () => {
    expect(zoomsFromMotion([{ t: 1, area: 0.001, box: { x0: 0.1, y0: 0.1, x1: 0.12, y1: 0.12 } }], 10)).toHaveLength(0);
    const scrolling: MotionSample[] = Array.from({ length: 20 }, (_, i) => ({ t: i * 0.125, area: 0.6, box: { x0: 0, y0: 0, x1: 1, y1: 1 } }));
    expect(zoomsFromMotion(scrolling, 10)).toHaveLength(0);
  });

  it('splits activity in different places and merges activity in one place', () => {
    const far = zoomsFromMotion([...typing(1, 3), ...typing(3.2, 5, { x0: 0.7, y0: 0.7, x1: 0.8, y1: 0.75 })], 10);
    expect(far).toHaveLength(2);
    const near = zoomsFromMotion([...typing(1, 3), ...typing(4.5, 6)], 10);
    expect(near).toHaveLength(1);
  });

  it('zooms less into bigger areas', () => {
    expect(scaleFor({ x0: 0, y0: 0, x1: 0.1, y1: 0.1 })).toBe(2.4);
    expect(scaleFor({ x0: 0, y0: 0, x1: 0.4, y1: 0.2 })).toBeCloseTo(1.5);
    expect(scaleFor({ x0: 0, y0: 0, x1: 0.9, y1: 0.9 })).toBe(1.35);
  });

  it('groups nearby clicks into one zoom', () => {
    const zooms = zoomsFromClicks(
      [
        { t: 1, x: 0.2, y: 0.2 },
        { t: 2, x: 0.25, y: 0.22 },
        { t: 8, x: 0.8, y: 0.8 },
      ],
      12,
    );
    expect(zooms).toHaveLength(2);
    expect(zooms[0].start).toBeCloseTo(0.4);
    expect(zooms[0].end).toBeCloseTo(4);
  });

  it('keeps manual zooms when auto zoom runs again', () => {
    const manual = newZoom(1, 3);
    const auto: ZoomSegment[] = [
      { ...newZoom(2, 4), origin: 'auto' },
      { ...newZoom(6, 8), origin: 'auto' },
    ];
    const old = { ...newZoom(10, 12), origin: 'auto' as const };
    const merged = mergeAuto([manual, old], auto, 20);
    expect(merged.map((z) => [z.start, z.origin])).toEqual([
      [1, 'manual'],
      [6, 'auto'],
    ]);
  });
});

describe('layout', () => {
  it('keeps the video shape and centers it', () => {
    const p = project();
    const l = layout(p, 1920, 1080);
    expect(l.content.w / l.content.h).toBeCloseTo(16 / 9);
    expect(l.content.x).toBeCloseTo((1920 - l.content.w) / 2);
    expect(l.content.y).toBeCloseTo((1080 - l.content.h) / 2);
  });

  it('fills the frame without padding', () => {
    const p = project({ style: { ...project().style, padding: 0 } });
    expect(layout(p, 1920, 1080).content).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
    expect(layout(p, 1920, 1080).radius).toBe(0);
  });

  it('makes room for a window title bar', () => {
    const p = project({ style: { ...project().style, frame: 'macos' } });
    const l = layout(p, 1920, 1080);
    expect(l.bar).toBeGreaterThan(0);
    expect(l.content.y).toBeCloseTo(l.window.y + l.bar);
    expect(l.window.h).toBeCloseTo(l.content.h + l.bar);
  });

  it('computes output sizes for every aspect ratio', () => {
    const base = project();
    const size = (aspect: string) => outputSize({ ...base, style: { ...base.style, aspect: aspect as never } }, 1080);
    expect(size('auto')).toEqual({ width: 1920, height: 1080 });
    expect(size('9:16')).toEqual({ width: 1080, height: 1920 });
    expect(size('1:1')).toEqual({ width: 1080, height: 1080 });
    expect(size('4:5')).toEqual({ width: 1080, height: 1350 });
  });

  it('maps points between the video and the canvas both ways', () => {
    const content = { x: 100, y: 50, w: 1600, h: 900 };
    const camera = { scale: 2, x: 0.4, y: 0.6 };
    const p = { x: 0.35, y: 0.62 };
    const back = fromCanvas(toCanvas(p, camera, content), camera, content);
    expect(back.x).toBeCloseTo(p.x);
    expect(back.y).toBeCloseTo(p.y);
    expect(toCanvas({ x: 0.4, y: 0.6 }, camera, content)).toEqual({ x: 900, y: 500 });
  });
});
