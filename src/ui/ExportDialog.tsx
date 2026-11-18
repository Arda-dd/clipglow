import { useEffect, useRef, useState } from 'react';
import { ExportCanceled, exportVideo, type ExportFormat, type ExportOptions, type ExportSources } from '../core/media';
import { formatTime } from '../core/project';
import { outputSize } from '../core/render';
import type { Project } from '../core/types';
import { Close, Download } from './icons';
import { download, safeFilename } from './workflow';

interface Props {
  project: Project;
  sources: () => Promise<ExportSources>;
  onClose: () => void;
}

const SIZES: Record<ExportFormat, [number, string][]> = {
  mp4: [
    [720, '720p'],
    [1080, '1080p'],
    [1440, '1440p'],
    [2160, '4K'],
  ],
  webm: [
    [720, '720p'],
    [1080, '1080p'],
    [1440, '1440p'],
    [2160, '4K'],
  ],
  gif: [
    [360, 'Small'],
    [480, 'Medium'],
    [720, 'Large'],
  ],
};

const RATES: Record<ExportFormat, number[]> = { mp4: [30, 60], webm: [30, 60], gif: [10, 15, 20] };

const KEY = 'clipglow:export';

function load(): ExportOptions {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) ?? '') as ExportOptions;
    if (SIZES[o.format]?.some(([s]) => s === o.size) && RATES[o.format].includes(o.fps)) return o;
  } catch {
    // First time.
  }
  return { format: 'mp4', size: 1080, fps: 60 };
}

type State =
  | { kind: 'idle' }
  | { kind: 'running'; progress: number; started: number }
  | { kind: 'done'; blob: Blob; url: string; seconds: number }
  | { kind: 'error'; message: string };

export function ExportDialog({ project, sources, onClose }: Props) {
  const [options, setOptions] = useState<ExportOptions>(load);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(options));
    } catch {
      // Not remembered.
    }
  }, [options]);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => () => void (state.kind === 'done' && URL.revokeObjectURL(state.url)), [state]);

  const { width, height } = outputSize(project, options.size);
  const length = project.trim.end - project.trim.start;
  const ext = options.format;

  const setFormat = (format: ExportFormat) => {
    const size = SIZES[format].some(([s]) => s === options.size) ? options.size : SIZES[format][1][0];
    const fps = RATES[format].includes(options.fps) ? options.fps : RATES[format][RATES[format].length - 1 - (format === 'gif' ? 1 : 0)];
    setOptions({ format, size, fps });
  };

  const start = async () => {
    const controller = new AbortController();
    abort.current = controller;
    const started = performance.now();
    setState({ kind: 'running', progress: 0, started });
    try {
      const blob = await exportVideo(
        project,
        await sources(),
        options,
        (progress) => setState((s) => (s.kind === 'running' ? { ...s, progress } : s)),
        controller.signal,
      );
      setState({ kind: 'done', blob, url: URL.createObjectURL(blob), seconds: (performance.now() - started) / 1000 });
    } catch (err) {
      if (err instanceof ExportCanceled || controller.signal.aborted) setState({ kind: 'idle' });
      else setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  const filename = `${safeFilename(project.name)}.${ext}`;
  const running = state.kind === 'running';
  const eta =
    running && state.progress > 0.03 ? ((performance.now() - state.started) / 1000) * ((1 - state.progress) / state.progress) : null;

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !running && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <div className="modal-head">
          <h2 id="export-title">Export</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close" disabled={running}>
            <Close size={18} />
          </button>
        </div>

        {state.kind === 'done' ? (
          <div className="export-done">
            {options.format === 'gif' ? (
              <img className="export-preview" src={state.url} alt="Exported GIF" />
            ) : (
              <video className="export-preview" src={state.url} controls playsInline />
            )}
            <p className="muted small">
              {(state.blob.size / 1024 / 1024).toFixed(1)} MB · made in {formatTime(state.seconds)}
            </p>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setState({ kind: 'idle' })}>
                Export again
              </button>
              <button type="button" className="btn primary" onClick={() => download(state.blob, filename)}>
                <Download size={16} /> Download {ext.toUpperCase()}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="field">
              <span className="field-label">Format</span>
              <div className="segmented">
                {(
                  [
                    ['mp4', 'MP4', 'Works everywhere'],
                    ['webm', 'WebM', 'Smaller, for the web'],
                    ['gif', 'GIF', 'For READMEs and docs'],
                  ] as const
                ).map(([f, label, hint]) => (
                  <button key={f} type="button" className={options.format === f ? 'on' : ''} onClick={() => setFormat(f)} disabled={running} title={hint}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span className="field-label">Size</span>
              <div className="segmented">
                {SIZES[options.format].map(([s, label]) => (
                  <button key={s} type="button" className={options.size === s ? 'on' : ''} onClick={() => setOptions({ ...options, size: s })} disabled={running}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span className="field-label">Frame rate</span>
              <div className="segmented">
                {RATES[options.format].map((r) => (
                  <button key={r} type="button" className={options.fps === r ? 'on' : ''} onClick={() => setOptions({ ...options, fps: r })} disabled={running}>
                    {r} fps
                  </button>
                ))}
              </div>
            </div>
            <p className="muted small">
              {width} × {height} · {formatTime(length)} long
              {options.format === 'gif' && length > 30 ? ' · GIFs this long get big; trim it or use MP4.' : ''}
            </p>

            {state.kind === 'error' && (
              <div className="notice error" role="alert">
                {state.message}
              </div>
            )}

            {running ? (
              <div className="progress-block">
                <div className="progress">
                  <div style={{ width: `${Math.round(state.progress * 100)}%` }} />
                </div>
                <div className="progress-row">
                  <span>
                    {Math.round(state.progress * 100)}%{eta !== null ? ` · about ${formatTime(eta)} left` : ''}
                  </span>
                  <button type="button" className="link-button" onClick={() => abort.current?.abort()}>
                    Cancel
                  </button>
                </div>
                <p className="hint">Keep this tab open. Everything happens on your computer.</p>
              </div>
            ) : (
              <div className="modal-actions">
                <button type="button" className="btn" onClick={onClose}>
                  Cancel
                </button>
                <button type="button" className="btn primary" onClick={start}>
                  <Download size={16} /> Export {ext.toUpperCase()}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
