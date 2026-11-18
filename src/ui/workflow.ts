import { mergeAuto, zoomsFromClicks, zoomsFromMotion } from '../core/autozoom';
import { probe, remux, thumbnail, analyzeMotion } from '../core/media';
import { createProject, type NewProject } from '../core/project';
import { saveAsset, saveProject } from '../core/storage';
import type { Click, CursorSample, Project } from '../core/types';

export interface ImportExtras {
  webcam?: Blob | null;
  webcamOffset?: number;
  cursor?: CursorSample[];
  clicks?: Click[];
  /** Recordings from MediaRecorder need fixing before they can be seeked. */
  fromRecorder?: boolean;
}

const baseName = (name: string) => name.replace(/\.[a-z0-9]+$/i, '').trim() || 'Untitled';

export async function importVideo(source: Blob, name: string, extras: ImportExtras = {}, onStatus?: (s: string) => void): Promise<Project> {
  onStatus?.('Reading the video…');
  const needsRemux = extras.fromRecorder || source.type.includes('webm') || /\.webm$/i.test(name);
  const screen = needsRemux ? await remux(source) : source;
  const info = await probe(screen);
  let webcam: Blob | null = null;
  if (extras.webcam) {
    onStatus?.('Reading the webcam video…');
    webcam = await remux(extras.webcam);
  }
  const data: NewProject = {
    name: baseName(name),
    ...info,
    hasWebcam: !!webcam,
    webcamOffset: extras.webcamOffset ?? 0,
    cursor: extras.cursor,
    clicks: extras.clicks,
  };
  const project = createProject(data);
  await saveAsset(project.id, 'screen', screen);
  if (webcam) await saveAsset(project.id, 'webcam', webcam);
  const thumb = await thumbnail(screen, Math.min(1, info.duration / 3));
  if (thumb) await saveAsset(project.id, 'thumbnail', thumb);
  await saveProject(project);
  return project;
}

/** Finds zoom spots: from clicks when the recording has them, otherwise from what moves on screen. */
export async function autoZoom(project: Project, screen: Blob, onProgress?: (p: number) => void, signal?: AbortSignal) {
  let auto;
  if (project.clicks?.length) auto = zoomsFromClicks(project.clicks, project.duration);
  else auto = zoomsFromMotion(await analyzeMotion(screen, onProgress, signal), project.duration);
  return mergeAuto(project.zooms, auto, project.duration);
}

interface SampleMeta {
  cursor?: CursorSample[];
  clicks?: Click[];
  title?: string;
}

export const SAMPLE_URL = 'sample/demo.webm';

export async function loadSample(onStatus?: (s: string) => void): Promise<Project> {
  onStatus?.('Downloading the sample…');
  const [video, meta] = await Promise.all([
    fetch(SAMPLE_URL).then((r) => {
      if (!r.ok) throw new Error('Could not download the sample video.');
      return r.blob();
    }),
    fetch('sample/demo.json').then((r): Promise<SampleMeta> => (r.ok ? r.json() : Promise.resolve({}))),
  ]);
  const project = await importVideo(video, 'Sample: Taskly demo', { cursor: meta.cursor, clicks: meta.clicks }, onStatus);
  if (meta.title) {
    project.style = { ...project.style, frame: 'browser', frameTitle: meta.title };
    await saveProject(project);
  }
  return project;
}

/** A message to show once when a project opens. */
export function setNotice(id: string, message: string) {
  try {
    sessionStorage.setItem(`clipglow:notice:${id}`, message);
  } catch {
    // Not shown then.
  }
}

export function takeNotice(id: string): string | null {
  try {
    const key = `clipglow:notice:${id}`;
    const message = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    return message;
  } catch {
    return null;
  }
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const safeFilename = (name: string) => name.replace(/[\\/:*?"<>|]+/g, '').trim() || 'clipglow';

/** WebCodecs is what makes export fast; without it nothing works. */
export function browserSupport(): { ok: boolean; record: boolean; reason?: string } {
  const webcodecs = typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined';
  const record = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia && typeof MediaRecorder !== 'undefined';
  if (!webcodecs)
    return { ok: false, record, reason: 'Your browser does not support WebCodecs, which Clipglow needs to read and export video. Use a recent Chrome, Edge, Firefox or Safari.' };
  return { ok: true, record };
}
