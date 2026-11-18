import { useCallback, useEffect, useRef, useState } from 'react';
import { formatTime } from '../core/project';
import { listDevices, RecordingSession, unlockDevices, type RecordingResult } from '../core/record';
import { deleteProject, getAsset, listProjects } from '../core/storage';
import type { Project } from '../core/types';
import { openProject } from './App';
import { Camera, Download, Film, Github, Logo, Mic, Monitor, Pointer, Shield, Sparkles, Trash, Upload, ZoomIn } from './icons';
import { RecordingOverlay } from './RecordingOverlay';
import { browserSupport, importVideo, loadSample, setNotice } from './workflow';

export const REPO = 'https://github.com/Arda-dd/clipglow';

interface Devices {
  mics: MediaDeviceInfo[];
  cameras: MediaDeviceInfo[];
}

function useDevices() {
  const [devices, setDevices] = useState<Devices>({ mics: [], cameras: [] });
  const refresh = useCallback(() => listDevices().then(setDevices), []);
  useEffect(() => {
    void refresh();
    navigator.mediaDevices?.addEventListener?.('devicechange', refresh);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', refresh);
  }, [refresh]);
  return { devices, refresh };
}

const PREFS_KEY = 'clipglow:record';

function loadPrefs(): { micId: string | null; cameraId: string | null; systemAudio: boolean } {
  try {
    return { micId: null, cameraId: null, systemAudio: true, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') };
  } catch {
    return { micId: null, cameraId: null, systemAudio: true };
  }
}

export function Home() {
  const support = browserSupport();
  const { devices, refresh } = useDevices();
  const [prefs, setPrefs] = useState(loadPrefs);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<RecordingSession | null>(null);
  const [projects, setProjects] = useState<(Project & { thumb?: string })[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // Private mode; the choice just isn't remembered.
    }
  }, [prefs]);

  const loadProjects = useCallback(async () => {
    try {
      const list = await listProjects();
      const withThumbs = await Promise.all(
        list.map(async (p) => {
          const blob = await getAsset(p.id, 'thumbnail');
          return { ...p, thumb: blob ? URL.createObjectURL(blob) : undefined };
        }),
      );
      setProjects(withThumbs);
    } catch {
      setProjects([]);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const run = async (task: (status: (s: string) => void) => Promise<Project>) => {
    setError(null);
    setBusy('Getting ready…');
    try {
      const project = await task(setBusy);
      openProject(project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const openFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('video/') && !/\.(mp4|webm|mov|mkv|m4v)$/i.test(file.name)) {
      setError('That is not a video file. Clipglow opens MP4, WebM, MOV and MKV videos.');
      return;
    }
    void run((status) => importVideo(file, file.name, {}, status));
  };

  const startRecording = async () => {
    setError(null);
    try {
      setSession(await RecordingSession.open(prefs));
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotAllowedError') return; // Closed the picker.
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const finishRecording = (result: RecordingResult) => {
    setSession(null);
    const name = `Recording ${new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
    void run(async (status) => {
      const project = await importVideo(result.screen, name, { webcam: result.webcam, webcamOffset: result.webcamOffset, fromRecorder: true }, status);
      if (result.audioDropped) setNotice(project.id, 'The sound could not be recorded, so this recording is silent. Check your microphone, or share without sound.');
      return project;
    });
  };

  const needsPermission = devices.mics.length === 0 && devices.cameras.length === 0;

  return (
    <div
      className={`home${dragging ? ' dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        openFile(e.dataTransfer.files[0]);
      }}
    >
      <header className="home-header">
        <a className="brand" href="#/">
          <Logo />
          <span>Clipglow</span>
        </a>
        <a className="ghost-link" href={REPO} target="_blank" rel="noreferrer">
          <Github size={18} /> GitHub
        </a>
      </header>

      <section className="hero">
        <div className="hero-glow" aria-hidden="true" />
        <h1>
          Screen recordings that <span className="glow-text">look amazing</span>
        </h1>
        <p className="lead">
          Record your screen or drop in a video you already have. Clipglow zooms in on the action, adds a beautiful
          background and gives you an MP4. Free, open source, and it all happens in your browser.
        </p>
      </section>

      {!support.ok && <div className="notice error">{support.reason}</div>}
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}

      <section className="start">
        <div className="start-card">
          <div className="start-icon">
            <Monitor size={22} />
          </div>
          <h2>Record your screen</h2>
          <p className="muted">A window, a tab or your whole screen. With your voice and your face if you like.</p>
          {support.record ? (
            <>
              <div className="device-rows">
                <label className="device">
                  <Mic size={16} />
                  <select
                    value={prefs.micId ?? ''}
                    onChange={(e) => setPrefs({ ...prefs, micId: e.target.value || null })}
                    aria-label="Microphone"
                  >
                    <option value="">No microphone</option>
                    {devices.mics.map((d, i) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || `Microphone ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="device">
                  <Camera size={16} />
                  <select
                    value={prefs.cameraId ?? ''}
                    onChange={(e) => setPrefs({ ...prefs, cameraId: e.target.value || null })}
                    aria-label="Camera"
                  >
                    <option value="">No camera</option>
                    {devices.cameras.map((d, i) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || `Camera ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
                {needsPermission && (
                  <button type="button" className="link-button" onClick={() => unlockDevices(true, true).then(refresh)}>
                    Allow microphone and camera to choose them
                  </button>
                )}
                <label className="check">
                  <input type="checkbox" checked={prefs.systemAudio} onChange={(e) => setPrefs({ ...prefs, systemAudio: e.target.checked })} />
                  Record the sound of what I share
                </label>
              </div>
              <button type="button" className="btn primary big" onClick={startRecording} disabled={!support.ok}>
                <span className="rec-dot" /> Start recording
              </button>
            </>
          ) : (
            <p className="notice">Recording needs a desktop browser. You can still open videos you recorded elsewhere.</p>
          )}
        </div>

        <div
          className="start-card drop"
          role="button"
          tabIndex={0}
          onClick={() => fileInput.current?.click()}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileInput.current?.click()}
        >
          <div className="start-icon">
            <Upload size={22} />
          </div>
          <h2>Open a video</h2>
          <p className="muted">
            Recorded with OBS, the Snipping Tool, QuickTime or Loom? Drop it here and Clipglow finds the moments worth
            zooming into.
          </p>
          <div className="drop-zone">
            <Film size={28} />
            <strong>Drop a video here</strong>
            <span className="muted">or click to choose · MP4, WebM, MOV</span>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="video/*,.mkv,.mov"
            hidden
            onChange={(e) => {
              openFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
      </section>

      <p className="sample-line">
        No video handy?{' '}
        <button type="button" className="link-button" onClick={() => run(loadSample)} disabled={!support.ok}>
          Try it with a sample recording →
        </button>
      </p>

      {projects.length > 0 && (
        <section className="recent">
          <h3>Your projects</h3>
          <p className="muted small">Saved in this browser only.</p>
          <div className="project-grid">
            {projects.map((p) => (
              <div key={p.id} className="project-card">
                <button type="button" className="project-open" onClick={() => openProject(p.id)}>
                  <div className="project-thumb">{p.thumb ? <img src={p.thumb} alt="" /> : <Film size={28} />}</div>
                  <div className="project-meta">
                    <strong>{p.name}</strong>
                    <span className="muted small">
                      {formatTime(p.trim.end - p.trim.start)} · {new Date(p.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                </button>
                <button
                  type="button"
                  className="icon-btn project-delete"
                  aria-label={`Delete ${p.name}`}
                  title="Delete"
                  onClick={async () => {
                    if (!confirm(`Delete "${p.name}"? This can't be undone.`)) return;
                    await deleteProject(p.id);
                    void loadProjects();
                  }}
                >
                  <Trash size={16} />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="features">
        {[
          [ZoomIn, 'Auto zoom', 'Finds where things happen and zooms in smoothly, even in videos recorded elsewhere.'],
          [Sparkles, 'Looks great by default', 'Wallpapers, padding, rounded corners, shadows and window frames.'],
          [Camera, 'Webcam bubble', 'Your face in a corner, as a circle or a rounded square. Change it any time.'],
          [Pointer, 'Smooth cursor', 'Click effects and a calm, gliding pointer for recordings with cursor data.'],
          [Download, 'MP4 and GIF', 'Up to 4K at 60 fps, fast thanks to your graphics card. GIFs for your README.'],
          [Shield, 'Private', 'Your video never leaves your computer. No account, no upload, no watermark.'],
        ].map(([Icon, title, text]) => {
          const I = Icon as typeof ZoomIn;
          return (
            <div key={title as string} className="feature">
              <I size={20} />
              <strong>{title as string}</strong>
              <span className="muted">{text as string}</span>
            </div>
          );
        })}
      </section>

      <footer className="home-footer">
        <span>
          Clipglow is free and open source under the MIT license. ·{' '}
          <a href={REPO} target="_blank" rel="noreferrer">
            Source code
          </a>
        </span>
      </footer>

      {dragging && <div className="drop-overlay">Drop to open</div>}
      {busy && (
        <div className="busy-overlay" role="status">
          <div className="spinner" />
          <span>{busy}</span>
        </div>
      )}
      {session && (
        <RecordingOverlay
          session={session}
          onDone={finishRecording}
          onCancel={() => setSession(null)}
          onError={(message) => {
            setSession(null);
            setError(message);
          }}
        />
      )}
    </div>
  );
}
