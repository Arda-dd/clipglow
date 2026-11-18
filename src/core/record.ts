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
  /** Seconds the webcam started after the screen. Negative if it started first. */
  webcamOffset: number;
  /** True when the sound had to be left out to get a recording at all. */
  audioDropped: boolean;
}

const SCREEN_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
const CAMERA_TYPES = ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm', 'video/mp4'];

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

interface Track {
  recorder: MediaRecorder;
  chunks: Blob[];
  startedAt: number;
}

export class RecordingSession {
  /** The screen recording that will be kept. */
  private main: Track | null = null;
  /** A silent copy of the screen recording, kept only until the sound is known to work. */
  private backup: Track | null = null;
  private cam: Track | null = null;
  private audioContext: AudioContext | null = null;
  private audio: MediaStreamTrack | null = null;
  private watch: ReturnType<typeof setTimeout> | undefined;
  private endedListeners = new Set<() => void>();
  /** True when the sound had to be left out to get a recording at all. */
  audioDropped = false;

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
      video: { frameRate: { ideal: 60 }, width: { max: 3840 }, height: { max: 2160 } },
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
    const session = new RecordingSession(display, mic, camera);
    await session.prepareAudio();
    return session;
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

  /**
   * Mixes the screen's sound and the microphone into one track. This runs right after the click: an AudioContext
   * made later may stay suspended. If mixing doesn't work, the microphone alone is better than a silent video.
   */
  private async prepareAudio() {
    const screenAudio = this.display.getAudioTracks()[0] ?? null;
    const micAudio = this.mic?.getAudioTracks()[0] ?? null;
    if (!screenAudio || !micAudio) {
      this.audio = screenAudio ?? micAudio;
      return;
    }
    try {
      const ctx = new AudioContext();
      const out = ctx.createMediaStreamDestination();
      ctx.createMediaStreamSource(new MediaStream([screenAudio])).connect(out);
      ctx.createMediaStreamSource(new MediaStream([micAudio])).connect(out);
      if (ctx.state !== 'running') await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 500))]);
      if (ctx.state !== 'running') throw new Error('Audio mixing is not available');
      this.audioContext = ctx;
      this.audio = out.stream.getAudioTracks()[0];
    } catch {
      this.audio = micAudio;
    }
  }

  private record(stream: MediaStream, options: MediaRecorderOptions): Track {
    const track: Track = { recorder: new MediaRecorder(stream, options), chunks: [], startedAt: 0 };
    track.recorder.ondataavailable = (e) => e.data.size && track.chunks.push(e.data);
    track.recorder.onstart = () => (track.startedAt = performance.now());
    track.recorder.start(1000);
    return track;
  }

  start() {
    const video = this.display.getVideoTracks()[0];
    const { width, height } = this.size;
    const pixels = Math.max(1, width * height);
    // About 8 Mbps at 1080p, more for bigger screens, so text stays sharp.
    const videoBitsPerSecond = Math.round(Math.min(40e6, Math.max(6e6, (pixels / (1920 * 1080)) * 8e6)));
    const mimeType = pick(SCREEN_TYPES);
    this.main = this.record(new MediaStream(this.audio ? [video, this.audio] : [video]), { mimeType, videoBitsPerSecond, audioBitsPerSecond: 160_000 });
    if (this.camera) this.cam = this.record(this.camera, { mimeType: pick(CAMERA_TYPES), videoBitsPerSecond: 3e6 });
    // A sound track that never delivers anything (it happens) makes the recorder wait forever and write nothing,
    // and there is no way to tell beforehand. So a silent copy runs alongside for the first seconds: if it gets data
    // while the real one gets none, the sound is the problem and the silent copy, complete from the first frame,
    // takes over.
    if (this.audio) {
      this.backup = this.record(new MediaStream([video]), { mimeType: mimeType.replace(',opus', ''), videoBitsPerSecond });
      this.checkSound(0);
    }
  }

  private checkSound(round: number) {
    this.watch = setTimeout(() => {
      const { main, backup } = this;
      if (!main || !backup) return;
      if (main.chunks.length) this.dropBackup();
      else if (backup.chunks.length) {
        main.recorder.ondataavailable = null;
        main.recorder.stop();
        this.main = backup;
        this.backup = null;
        this.audioDropped = true;
      } else if (round < 4) this.checkSound(round + 1);
      else this.dropBackup();
    }, 2500);
  }

  private dropBackup() {
    if (!this.backup) return;
    this.backup.recorder.ondataavailable = null;
    if (this.backup.recorder.state !== 'inactive') this.backup.recorder.stop();
    this.backup = null;
  }

  private get all() {
    return [this.main, this.backup, this.cam].filter((t): t is Track => !!t);
  }

  pause() {
    for (const t of this.all) if (t.recorder.state === 'recording') t.recorder.pause();
  }

  resume() {
    for (const t of this.all) if (t.recorder.state === 'paused') t.recorder.resume();
  }

  get state() {
    return this.main?.recorder.state ?? 'inactive';
  }

  async stop(): Promise<RecordingResult> {
    clearTimeout(this.watch);
    // If the sound never worked out either way, the recording with sound is still the better guess.
    this.dropBackup();
    const done = (t: Track | null) =>
      new Promise<void>((resolve) => {
        if (!t || t.recorder.state === 'inactive') return resolve();
        t.recorder.addEventListener('stop', () => resolve(), { once: true });
        t.recorder.stop();
      });
    await Promise.all([done(this.main), done(this.cam)]);
    this.close();
    const { main, cam } = this;
    if (!main?.chunks.length) throw new Error('The browser recorded nothing. Try sharing a different window or screen, or use another browser.');
    const type = (t: Track) => t.recorder.mimeType.split(';')[0] || 'video/webm';
    return {
      screen: new Blob(main.chunks, { type: type(main) }),
      webcam: cam?.chunks.length ? new Blob(cam.chunks, { type: type(cam) }) : null,
      webcamOffset: cam?.startedAt && main.startedAt ? (cam.startedAt - main.startedAt) / 1000 : 0,
      audioDropped: this.audioDropped,
    };
  }

  /** Stops everything without keeping the recording. */
  close() {
    clearTimeout(this.watch);
    for (const s of [this.display, this.mic, this.camera]) s?.getTracks().forEach((t) => t.stop());
    void this.audioContext?.close();
    this.audioContext = null;
  }
}
