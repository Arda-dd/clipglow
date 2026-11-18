// Everything that reads or writes video files, built on Mediabunny and WebCodecs. Runs only in the browser.

import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  CanvasSink,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_VERY_HIGH,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
  type WrappedCanvas,
} from 'mediabunny';
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import { ANALYSIS_FPS, ANALYSIS_WIDTH, MotionTracker, toGray, type MotionSample } from './autozoom';
import { Renderer, outputSize, type RenderAssets } from './render';
import type { Project } from './types';

export interface MediaInfo {
  width: number;
  height: number;
  duration: number;
  hasAudio: boolean;
}

const open = (blob: Blob) => new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });

export async function probe(blob: Blob): Promise<MediaInfo> {
  const input = open(blob);
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new Error('This file has no video.');
    if (!(await video.canDecode())) throw new Error('Your browser cannot play this video format. Try an MP4 or WebM file.');
    const audio = await input.getPrimaryAudioTrack();
    const duration = await input.computeDuration();
    return { width: video.displayWidth, height: video.displayHeight, duration, hasAudio: !!audio && (await audio.canDecode()) };
  } finally {
    input.dispose();
  }
}

/**
 * Recordings from MediaRecorder have no duration and no seek index, so the browser can't jump around in them.
 * Copying them into a new file (without re-encoding) fixes both.
 */
export async function remux(blob: Blob): Promise<Blob> {
  const input = open(blob);
  const mp4 = blob.type.includes('mp4');
  const output = new Output({ format: mp4 ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(), target: new BufferTarget() });
  try {
    const conversion = await Conversion.init({ input, output, showWarnings: false });
    if (!conversion.isValid) return blob;
    await conversion.execute();
    const buffer = output.target.buffer;
    return buffer ? new Blob([buffer], { type: mp4 ? 'video/mp4' : 'video/webm' }) : blob;
  } catch (err) {
    console.warn('Clipglow: could not remux the recording, using it as is', err);
    return blob;
  } finally {
    input.dispose();
  }
}

/** A small frame of the video for the project list. */
export async function thumbnail(blob: Blob, t: number): Promise<Blob | null> {
  const input = open(blob);
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return null;
    const sink = new CanvasSink(track, { width: 480 });
    const frame = await sink.getCanvas(Math.max(t, await track.getFirstTimestamp()));
    if (!frame) return null;
    const canvas = frame.canvas;
    if ('convertToBlob' in canvas) return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
  } catch {
    return null;
  } finally {
    input.dispose();
  }
}

/** Small frames spread over the video, for the timeline. */
export async function filmstrip(blob: Blob, count: number, height = 56): Promise<string[]> {
  const input = open(blob);
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return [];
    const duration = await input.computeDuration();
    const first = await track.getFirstTimestamp();
    const sink = new CanvasSink(track, { height: height * 2 });
    const times = Array.from({ length: count }, (_, i) => Math.max(first, ((i + 0.5) / count) * duration));
    const out: string[] = [];
    for await (const frame of sink.canvasesAtTimestamps(times)) {
      if (!frame) continue;
      const c = frame.canvas;
      const blob = 'convertToBlob' in c ? await c.convertToBlob({ type: 'image/jpeg', quality: 0.7 }) : null;
      if (blob) out.push(URL.createObjectURL(blob));
      else if ('toDataURL' in c) out.push(c.toDataURL('image/jpeg', 0.7));
    }
    return out;
  } catch {
    return [];
  } finally {
    input.dispose();
  }
}

const readPixels = (() => {
  let canvas: OffscreenCanvas | null = null;
  return (frame: WrappedCanvas) => {
    const { width, height } = frame.canvas;
    if (!canvas || canvas.width !== width || canvas.height !== height) canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(frame.canvas, 0, 0);
    return { data: ctx.getImageData(0, 0, width, height).data, width, height };
  };
})();

/** Decodes the video at a low resolution and measures what changes between frames. */
export async function analyzeMotion(blob: Blob, onProgress?: (p: number) => void, signal?: AbortSignal): Promise<MotionSample[]> {
  const input = open(blob);
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return [];
    const duration = await input.computeDuration();
    const start = await track.getFirstTimestamp();
    const sink = new CanvasSink(track, { width: ANALYSIS_WIDTH, poolSize: 2 });
    const times: number[] = [];
    for (let t = Math.max(0, start); t < duration; t += 1 / ANALYSIS_FPS) times.push(t);
    let tracker: MotionTracker | null = null;
    let i = 0;
    for await (const frame of sink.canvasesAtTimestamps(times)) {
      if (signal?.aborted) throw new DOMException('Canceled', 'AbortError');
      const t = times[i++];
      if (!frame) continue;
      const px = readPixels(frame);
      tracker ??= new MotionTracker(px.width, px.height);
      tracker.push(t, toGray(px.data));
      if (i % 8 === 0) onProgress?.(i / times.length);
    }
    onProgress?.(1);
    return tracker?.samples ?? [];
  } finally {
    input.dispose();
  }
}

/** Reads frames in order and returns the one showing at a given time. Much faster than seeking for every frame. */
class FrameReader {
  private iterator: AsyncGenerator<WrappedCanvas, void, unknown>;
  private current: WrappedCanvas | null = null;
  private next: WrappedCanvas | null | undefined;

  private constructor(
    private readonly input: Input,
    sink: CanvasSink,
    readonly width: number,
    readonly height: number,
  ) {
    this.iterator = sink.canvases();
  }

  static async open(blob: Blob, maxWidth: number) {
    const input = open(blob);
    const track = await input.getPrimaryVideoTrack();
    if (!track) {
      input.dispose();
      return null;
    }
    const width = Math.min(maxWidth, track.displayWidth);
    const height = Math.round((width / track.displayWidth) * track.displayHeight);
    return new FrameReader(input, new CanvasSink(track, { width, height }), width, height);
  }

  async at(t: number) {
    if (this.next === undefined) this.next = (await this.iterator.next()).value ?? null;
    while (this.next && this.next.timestamp <= t) {
      this.current = this.next;
      this.next = (await this.iterator.next()).value ?? null;
    }
    return this.current ? { image: this.current.canvas, width: this.width, height: this.height } : null;
  }

  close() {
    void this.iterator.return(undefined);
    this.input.dispose();
  }
}

export type ExportFormat = 'mp4' | 'webm' | 'gif';

export interface ExportOptions {
  format: ExportFormat;
  /** Shorter side of the output: 720, 1080, 1440 or 2160. */
  size: number;
  fps: number;
}

export interface ExportSources {
  screen: Blob;
  webcam?: Blob | null;
  assets: RenderAssets;
}

export class ExportCanceled extends Error {
  constructor() {
    super('Export canceled');
  }
}

export async function exportVideo(
  project: Project,
  sources: ExportSources,
  options: ExportOptions,
  onProgress: (p: number) => void,
  signal: AbortSignal,
): Promise<Blob> {
  if (options.format === 'gif') return exportGif(project, sources, options, onProgress, signal);
  const { width, height } = outputSize(project, options.size);
  const mp4 = options.format === 'mp4';
  const videoCodec = mp4 ? 'avc' : 'vp9';
  if (!(await canEncodeVideo(videoCodec, { width, height }))) {
    throw new Error(
      mp4
        ? `Your browser can't encode ${width}×${height} MP4 video. Try a smaller size, or WebM.`
        : `Your browser can't encode ${width}×${height} WebM video. Try a smaller size, or MP4.`,
    );
  }
  const audioCodec = mp4 ? ((await canEncodeAudio('aac')) ? 'aac' : 'opus') : 'opus';

  const renderer = new Renderer(project);
  renderer.setAssets(sources.assets);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  const webcam = project.hasWebcam && project.webcam.show && sources.webcam ? await FrameReader.open(sources.webcam, 720) : null;

  const input = open(sources.screen);
  const output = new Output({
    format: mp4 ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
    target: new BufferTarget(),
  });
  const { start, end } = project.trim;
  let offset: number | null = null;
  try {
    const conversion = await Conversion.init({
      input,
      output,
      trim: { start, end },
      showWarnings: false,
      video: {
        codec: videoCodec,
        frameRate: options.fps,
        forceTranscode: true,
        quality: options.size >= 1440 ? QUALITY_HIGH : QUALITY_VERY_HIGH,
        processedWidth: width,
        processedHeight: height,
        process: async (sample) => {
          // Output timestamps start at zero after trimming; the project works in source time.
          if (offset === null) offset = sample.timestamp < start - 0.05 ? start : 0;
          const t = sample.timestamp + offset;
          const cam = webcam ? await webcam.at(t - project.webcamOffset) : null;
          renderer.draw(ctx, width, height, { t, screen: sample.toCanvasImageSource(), webcam: cam });
          return canvas;
        },
      },
      audio: project.hasAudio ? { codec: audioCodec } : { discard: true },
    });
    if (!conversion.isValid) throw new Error('This video cannot be exported: ' + conversion.discardedTracks.map((d) => d.reason).join(', '));
    conversion.onProgress = (p) => onProgress(p);
    const cancel = () => void conversion.cancel();
    signal.addEventListener('abort', cancel);
    try {
      await conversion.execute();
    } catch (err) {
      if (signal.aborted) throw new ExportCanceled();
      throw err;
    } finally {
      signal.removeEventListener('abort', cancel);
    }
    const buffer = output.target.buffer!;
    return new Blob([buffer], { type: mp4 ? 'video/mp4' : 'video/webm' });
  } finally {
    webcam?.close();
    input.dispose();
  }
}

async function exportGif(project: Project, sources: ExportSources, options: ExportOptions, onProgress: (p: number) => void, signal: AbortSignal) {
  const { width, height } = outputSize(project, options.size);
  const renderer = new Renderer(project);
  renderer.setAssets(sources.assets);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const webcam = project.hasWebcam && project.webcam.show && sources.webcam ? await FrameReader.open(sources.webcam, 480) : null;
  const input = open(sources.screen);
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('This file has no video.');
    const sink = new CanvasSink(track, { poolSize: 2 });
    const times: number[] = [];
    for (let t = project.trim.start; t < project.trim.end; t += 1 / options.fps) times.push(t);
    const gif = GIFEncoder();
    const delay = Math.round(1000 / options.fps);
    // Screen recordings hold still a lot. A frame identical to the one before just makes that one last longer.
    let pending: { data: Uint8ClampedArray; delay: number } | null = null;
    const flush = () => {
      if (!pending) return;
      const palette = quantize(pending.data, 256);
      gif.writeFrame(applyPalette(pending.data, palette), width, height, { palette, delay: pending.delay });
    };
    const same = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
      for (let k = 0; k < a.length; k += 4) if (Math.abs(a[k] - b[k]) > 3 || Math.abs(a[k + 1] - b[k + 1]) > 3 || Math.abs(a[k + 2] - b[k + 2]) > 3) return false;
      return true;
    };
    let i = 0;
    for await (const frame of sink.canvasesAtTimestamps(times)) {
      if (signal.aborted) throw new ExportCanceled();
      const t = times[i++];
      const cam = webcam ? await webcam.at(t - project.webcamOffset) : null;
      renderer.draw(ctx, width, height, { t, screen: frame?.canvas ?? null, webcam: cam });
      const { data } = ctx.getImageData(0, 0, width, height);
      if (pending && same(pending.data, data)) pending.delay += delay;
      else {
        flush();
        pending = { data, delay };
      }
      if (i % 4 === 0) {
        onProgress(i / times.length);
        // Let the page breathe: quantizing is heavy and runs on the main thread.
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    flush();
    gif.finish();
    onProgress(1);
    return new Blob([gif.bytes() as Uint8Array<ArrayBuffer>], { type: 'image/gif' });
  } finally {
    webcam?.close();
    input.dispose();
  }
}
