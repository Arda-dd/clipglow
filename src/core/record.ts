// Screen recording with getDisplayMedia and MediaRecorder: the screen (with its sound, if shared), the microphone
// mixed in, and the webcam as a separate video so its position and shape can still be changed afterwards.

export interface RecordOptions {
  systemAudio: boolean;
  micId: string | null;
  cameraId: string | null;
}

export interface RecordingResult {
  screen: Blob;
  webcam: Blob | null;
  /** Seconds the webcam started after the screen. */
  webcamOffset: number;
}

const VIDEO_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
const CAMERA_TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];

const pick = (types: string[]) => types.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';

export const canRecord = () =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia && typeof MediaRecorder !== 'undefined';

export async function listDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
      mics: devices.filter((d) => d.kind === 'audioinput' && d.deviceId),
      cameras: devices.filter((d) => d.kind === 'videoinput' && d.deviceId),
    };
  } catch {
    return { mics: [], cameras: [] };
  }
}

/** Asks for microphone and camera permission once, so the device lists have names. */
export async function unlockDevices(audio: boolean, video: boolean) {
  if (!audio && !video) return;
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio, video });
    s.getTracks().forEach((t) => t.stop());
  } catch {
    // Denied; the lists stay without names.
  }
}

export class RecordingSession {
  private chunks: Blob[] = [];
  private camChunks: Blob[] = [];
  private recorder: MediaRecorder | null = null;
  private camRecorder: MediaRecorder | null = null;
  private startedAt = 0;
  private camStartedAt = 0;
  private audioContext: AudioContext | null = null;
  private endedListeners = new Set<() => void>();

  private constructor(
    readonly display: MediaStream,
    readonly mic: MediaStream | null,
    readonly camera: MediaStream | null,
  ) {
    display.getVideoTracks()[0]?.addEventListener('ended', () => this.endedListeners.forEach((fn) => fn()));
  }

  /** Shows the browser's screen picker and opens the microphone and camera. Needs a click. */
  static async open(options: RecordOptions): Promise<RecordingSession> {
    const display = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 60 }, width: { ideal: 3840 }, height: { ideal: 2160 } },
      audio: options.systemAudio,
      // Chrome-only hints: don't offer this tab, but do offer system audio and switching what is shared.
      ...({ selfBrowserSurface: 'exclude', systemAudio: 'include', surfaceSwitching: 'include' } as object),
    });
    const stopAll = (streams: (MediaStream | null)[]) => streams.forEach((s) => s?.getTracks().forEach((t) => t.stop()));
    let mic: MediaStream | null = null;
    let camera: MediaStream | null = null;
    try {
      if (options.micId)
        mic = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: options.micId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      if (options.cameraId)
        camera = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: options.cameraId }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        });
    } catch (err) {
      stopAll([display, mic, camera]);
      throw err;
    }
    return new RecordingSession(display, mic, camera);
  }

  /** Called when sharing stops from the browser's own "Stop sharing" bar. */
  onEnded(fn: () => void) {
    this.endedListeners.add(fn);
    return () => this.endedListeners.delete(fn);
  }

  get size() {
    const s = this.display.getVideoTracks()[0]?.getSettings();
    return { width: s?.width ?? 0, height: s?.height ?? 0 };
  }

  private audioTrack(): MediaStreamTrack | null {
    const screenAudio = this.display.getAudioTracks()[0] ?? null;
    const micAudio = this.mic?.getAudioTracks()[0] ?? null;
    if (!screenAudio || !micAudio) return screenAudio ?? micAudio;
    // Both: mix them into one track.
    const ctx = new AudioContext();
    const out = ctx.createMediaStreamDestination();
    ctx.createMediaStreamSource(new MediaStream([screenAudio])).connect(out);
    ctx.createMediaStreamSource(new MediaStream([micAudio])).connect(out);
    this.audioContext = ctx;
    return out.stream.getAudioTracks()[0];
  }

  start() {
    const video = this.display.getVideoTracks()[0];
    const audio = this.audioTrack();
    const { width, height } = this.size;
    const pixels = Math.max(1, width * height);
    // About 8 Mbps at 1080p, more for bigger screens, so text stays sharp.
    const bitrate = Math.round(Math.min(40e6, Math.max(6e6, (pixels / (1920 * 1080)) * 8e6)));
    this.recorder = new MediaRecorder(new MediaStream(audio ? [video, audio] : [video]), {
      mimeType: pick(VIDEO_TYPES),
      videoBitsPerSecond: bitrate,
      audioBitsPerSecond: 160_000,
    });
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.onstart = () => (this.startedAt = performance.now());
    if (this.camera) {
      this.camRecorder = new MediaRecorder(this.camera, { mimeType: pick(CAMERA_TYPES), videoBitsPerSecond: 3e6 });
      this.camRecorder.ondataavailable = (e) => e.data.size && this.camChunks.push(e.data);
      this.camRecorder.onstart = () => (this.camStartedAt = performance.now());
    }
    this.recorder.start(1000);
    this.camRecorder?.start(1000);
  }

  pause() {
    this.recorder?.pause();
    this.camRecorder?.pause();
  }

  resume() {
    this.recorder?.resume();
    this.camRecorder?.resume();
  }

  get state() {
    return this.recorder?.state ?? 'inactive';
  }

  async stop(): Promise<RecordingResult> {
    const done = (r: MediaRecorder | null) =>
      new Promise<void>((resolve) => {
        if (!r || r.state === 'inactive') return resolve();
        r.addEventListener('stop', () => resolve(), { once: true });
        r.stop();
      });
    await Promise.all([done(this.recorder), done(this.camRecorder)]);
    this.close();
    const type = this.recorder?.mimeType.split(';')[0] || 'video/webm';
    return {
      screen: new Blob(this.chunks, { type }),
      webcam: this.camChunks.length ? new Blob(this.camChunks, { type: this.camRecorder?.mimeType.split(';')[0] || 'video/webm' }) : null,
      webcamOffset: this.camStartedAt && this.startedAt ? Math.max(0, (this.camStartedAt - this.startedAt) / 1000) : 0,
    };
  }

  /** Stops everything without keeping the recording. */
  close() {
    for (const s of [this.display, this.mic, this.camera]) s?.getTracks().forEach((t) => t.stop());
    void this.audioContext?.close();
    this.audioContext = null;
  }
}
