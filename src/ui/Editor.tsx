import { useCallback, useEffect, useRef, useState } from 'react';
import { cursorAt } from '../core/camera';
import { filmstrip } from '../core/media';
import { clamp, formatTime, freeSlot, MIN_ZOOM_LENGTH, newZoom, normalizeZooms } from '../core/project';
import { fromCanvas, layout, outputSize, Renderer } from '../core/render';
import { getAsset, getProject, saveAsset, saveProject } from '../core/storage';
import type { Project, ZoomSegment } from '../core/types';
import { goHome } from './App';
import { ExportDialog } from './ExportDialog';
import { Back, Download, Logo, Pause, Play, Redo, Sparkles, Undo, ZoomIn } from './icons';
import { Inspector, type Update } from './Inspector';
import { Timeline } from './Timeline';
import { autoZoom } from './workflow';

interface Media {
  screen: Blob;
  webcam: Blob | null;
  screenUrl: string;
  webcamUrl: string | null;
  background: ImageBitmap | null;
}

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) && (el as HTMLInputElement).type !== 'range';

export function Editor({ id }: { id: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [media, setMedia] = useState<Media | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState<number | null>(null);
  const [strip, setStrip] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const [, force] = useState(0);

  const projectRef = useRef<Project | null>(null);
  const past = useRef<Project[]>([]);
  const future = useRef<Project[]>([]);
  const lastKey = useRef<{ key: string; at: number } | null>(null);
  const renderer = useRef<Renderer | null>(null);
  const screenVideo = useRef<HTMLVideoElement>(null);
  const camVideo = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const timeRef = useRef(0);
  const analyzeAbort = useRef<AbortController | null>(null);

  // ---- Loading ----
  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    (async () => {
      const p = await getProject(id);
      if (!p) throw new Error('This project does not exist in this browser anymore.');
      const screen = await getAsset(id, 'screen');
      if (!screen) throw new Error('The video of this project is missing.');
      const webcam = p.hasWebcam ? ((await getAsset(id, 'webcam')) ?? null) : null;
      const bgBlob = await getAsset(id, 'background');
      const background = bgBlob ? await createImageBitmap(bgBlob).catch(() => null) : null;
      if (cancelled) return;
      const screenUrl = URL.createObjectURL(screen);
      const webcamUrl = webcam ? URL.createObjectURL(webcam) : null;
      urls.push(screenUrl, ...(webcamUrl ? [webcamUrl] : []));
      renderer.current = new Renderer(p);
      renderer.current.setAssets({ backgroundImage: background });
      projectRef.current = p;
      timeRef.current = p.trim.start;
      setTime(p.trim.start);
      setProject(p);
      setMedia({ screen, webcam, screenUrl, webcamUrl, background });
      void filmstrip(screen, 24).then((s) => !cancelled && setStrip(s));
      // A brand new project gets its zooms right away.
      if (p.zooms.length === 0 && p.createdAt === p.updatedAt) void runAutoZoom(p, screen);
    })().catch((err) => setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
      analyzeAbort.current?.abort();
    };
  }, [id]);

  // ---- Editing with undo ----
  const commit = (next: Project) => {
    projectRef.current = next;
    renderer.current?.setProject(next);
    setProject(next);
  };

  const update: Update = useCallback((fn, key) => {
    const prev = projectRef.current;
    if (!prev) return;
    const next = { ...fn(prev), updatedAt: Date.now() };
    const now = performance.now();
    const merge = key && lastKey.current?.key === key && now - lastKey.current.at < 1500;
    if (!merge) {
      past.current.push(prev);
      if (past.current.length > 150) past.current.shift();
      future.current = [];
    }
    lastKey.current = key ? { key, at: now } : null;
    commit(next);
  }, []);

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev || !projectRef.current) return;
    future.current.push(projectRef.current);
    lastKey.current = null;
    commit({ ...prev, updatedAt: Date.now() });
  }, []);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next || !projectRef.current) return;
    past.current.push(projectRef.current);
    lastKey.current = null;
    commit({ ...next, updatedAt: Date.now() });
  }, []);

  // Autosave.
  useEffect(() => {
    if (!project) return;
    const t = setTimeout(() => void saveProject(project), 400);
    return () => clearTimeout(t);
  }, [project]);

  // ---- Drawing ----
  const draw = useCallback(() => {
    const c = canvas.current;
    const r = renderer.current;
    const p = projectRef.current;
    const v = screenVideo.current;
    if (!c || !r || !p || !v) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const t = timeRef.current;
    const cam = camVideo.current;
    const camT = t - p.webcamOffset;
    r.draw(ctx, c.width, c.height, {
      t,
      screen: v.readyState >= 2 ? v : null,
      webcam: cam && cam.readyState >= 2 && camT >= 0 ? { image: cam, width: cam.videoWidth, height: cam.videoHeight } : null,
    });
  }, []);

  // Size the canvas to fit the stage at the output's aspect ratio.
  useEffect(() => {
    const el = stage.current;
    const c = canvas.current;
    if (!el || !c || !project) return;
    const fit = () => {
      const { width, height } = outputSize(project, 1080);
      const k = Math.min(el.clientWidth / width, el.clientHeight / height);
      const cssW = Math.max(1, Math.floor(width * k));
      const cssH = Math.max(1, Math.floor(height * k));
      const dpr = Math.min(2, devicePixelRatio || 1);
      c.style.width = `${cssW}px`;
      c.style.height = `${cssH}px`;
      c.width = Math.round(cssW * dpr);
      c.height = Math.round(cssH * dpr);
      draw();
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, [project?.style.aspect, project?.width, project?.height, !!project, draw]);

  useEffect(() => {
    if (!playing) draw();
  }, [project, playing, draw]);

  // Playback loop.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const v = screenVideo.current;
      const p = projectRef.current;
      if (!v || !p) return;
      const t = v.currentTime;
      timeRef.current = t;
      if (t >= p.trim.end - 0.01 || v.ended) {
        v.pause();
        camVideo.current?.pause();
        setPlaying(false);
        timeRef.current = Math.min(t, p.trim.end);
      }
      const cam = camVideo.current;
      if (cam) {
        const camT = t - p.webcamOffset;
        if (camT >= 0 && cam.paused && !v.paused) void cam.play().catch(() => undefined);
        if (camT >= 0 && Math.abs(cam.currentTime - camT) > 0.25) cam.currentTime = camT;
      }
      setTime(timeRef.current);
      draw();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, draw]);

  const seek = useCallback(
    (t: number) => {
      const p = projectRef.current;
      const v = screenVideo.current;
      if (!p || !v) return;
      const to = clamp(t, 0, p.duration);
      timeRef.current = to;
      setTime(to);
      v.currentTime = to;
      const cam = camVideo.current;
      if (cam) cam.currentTime = Math.max(0, to - p.webcamOffset);
      draw();
    },
    [draw],
  );

  const togglePlay = useCallback(() => {
    const v = screenVideo.current;
    const p = projectRef.current;
    if (!v || !p) return;
    if (!v.paused) {
      v.pause();
      camVideo.current?.pause();
      setPlaying(false);
      return;
    }
    if (timeRef.current >= p.trim.end - 0.05 || timeRef.current < p.trim.start) seek(p.trim.start);
    void v.play().then(() => setPlaying(true), () => setPlaying(false));
  }, [seek]);

  // ---- Zooms ----
  const runAutoZoom = useCallback(async (p: Project, screen: Blob) => {
    analyzeAbort.current?.abort();
    const controller = new AbortController();
    analyzeAbort.current = controller;
    setAnalyzing(0);
    try {
      const zooms = await autoZoom(p, screen, setAnalyzing, controller.signal);
      if (controller.signal.aborted) return;
      update((cur) => ({ ...cur, zooms: normalizeZooms([...cur.zooms.filter((z) => z.origin === 'manual'), ...zooms.filter((z) => z.origin === 'auto')], cur.duration) }));
    } catch (err) {
      if (!controller.signal.aborted) console.warn('Clipglow: auto zoom failed', err);
    } finally {
      if (analyzeAbort.current === controller) setAnalyzing(null);
    }
  }, [update]);

  const addZoom = useCallback(
    (t: number) => {
      const p = projectRef.current;
      if (!p) return;
      const inside = p.zooms.find((z) => t >= z.start && t < z.end);
      if (inside) return setSelected(inside.id);
      const slot = freeSlot(p.zooms, t, p.duration);
      if (!slot || slot.end - slot.start < MIN_ZOOM_LENGTH) return;
      let start = t;
      let end = Math.min(t + 2.5, slot.end);
      if (end - start < 1.2) start = Math.max(slot.start, end - 2.5);
      end = Math.max(end, Math.min(slot.end, start + MIN_ZOOM_LENGTH));
      const focus = (p.cursor?.length && cursorAt(p.cursor, t)) || { x: 0.5, y: 0.5 };
      const zoom = newZoom(start, end, focus, 2);
      update((cur) => ({ ...cur, zooms: normalizeZooms([...cur.zooms, zoom], cur.duration) }));
      setSelected(zoom.id);
    },
    [update],
  );

  const changeZoom = useCallback(
    (zid: string, patch: Partial<ZoomSegment>, done: boolean) => {
      update(
        (p) => ({
          ...p,
          zooms: done ? normalizeZooms(p.zooms, p.duration) : p.zooms.map((z) => (z.id === zid ? { ...z, ...patch, origin: 'manual' } : z)),
        }),
        `drag-${zid}`,
      );
      if (done) lastKey.current = null;
    },
    [update],
  );

  const deleteZoom = useCallback(
    (zid: string) => {
      update((p) => ({ ...p, zooms: p.zooms.filter((z) => z.id !== zid) }));
      setSelected(null);
    },
    [update],
  );

  const changeTrim = useCallback(
    (trim: { start: number; end: number }, done: boolean) => {
      update((p) => ({ ...p, trim }), 'trim');
      if (done) lastKey.current = null;
      else seek(trim.start !== projectRef.current?.trim.start ? trim.start : trim.end);
    },
    [update, seek],
  );

  // Clicking the preview moves the selected zoom there.
  const onPreviewClick = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = projectRef.current;
    const r = renderer.current;
    if (!p || !r) return;
    const zoom = p.zooms.find((z) => z.id === selected);
    if (!zoom) return togglePlay();
    const rect = e.currentTarget.getBoundingClientRect();
    const l = layout(p, rect.width, rect.height);
    const point = fromCanvas({ x: e.clientX - rect.left, y: e.clientY - rect.top }, r.cameraAt(timeRef.current), l.content);
    if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return;
    update((cur) => ({ ...cur, zooms: cur.zooms.map((z) => (z.id === zoom.id ? { ...z, focus: point, origin: 'manual' } : z)) }));
  };

  const onBackgroundImage = useCallback(
    async (file: File) => {
      try {
        const bitmap = await createImageBitmap(file);
        await saveAsset(id, 'background', file);
        renderer.current?.setAssets({ backgroundImage: bitmap });
        setMedia((m) => (m ? { ...m, background: bitmap } : m));
        update((p) => ({ ...p, style: { ...p.style, background: { kind: 'image' } } }));
      } catch {
        alert('That image could not be opened. Try a PNG or JPG.');
      }
    },
    [id, update],
  );

  // ---- Keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || exporting) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (mod) return;
      else if (e.key === ' ' || e.key === 'k') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'z') addZoom(timeRef.current);
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) deleteZoom(selected);
      else if (e.key === 'Escape') setSelected(null);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        seek(timeRef.current + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 1 / 30));
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [undo, redo, togglePlay, addZoom, deleteZoom, selected, seek, exporting]);

  if (error)
    return (
      <div className="editor-error">
        <p>{error}</p>
        <button type="button" className="btn" onClick={goHome}>
          Back to start
        </button>
      </div>
    );

  if (!project || !media)
    return (
      <div className="busy-overlay" role="status">
        <div className="spinner" />
        <span>Opening…</span>
      </div>
    );

  const selectedZoom = project.zooms.find((z) => z.id === selected) ?? null;
  const exportSources = async () => ({ screen: media.screen, webcam: media.webcam, assets: { backgroundImage: media.background } });

  return (
    <div className="editor">
      <header className="editor-bar">
        <button type="button" className="icon-btn" onClick={goHome} aria-label="Back to projects" title="Projects">
          <Back size={18} />
        </button>
        <Logo size={24} />
        <input
          className="name-input"
          value={project.name}
          aria-label="Project name"
          onChange={(e) => update((p) => ({ ...p, name: e.target.value }), 'name')}
        />
        <div className="bar-spacer" />
        <button type="button" className="icon-btn" onClick={undo} disabled={!past.current.length} title="Undo (Ctrl+Z)" aria-label="Undo">
          <Undo size={18} />
        </button>
        <button type="button" className="icon-btn" onClick={redo} disabled={!future.current.length} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
          <Redo size={18} />
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            screenVideo.current?.pause();
            camVideo.current?.pause();
            setPlaying(false);
            setExporting(true);
          }}
        >
          <Download size={16} /> Export
        </button>
      </header>

      <main className="editor-main">
        <section className="preview-area">
          <div className="stage" ref={stage}>
            <canvas
              ref={canvas}
              className={`preview${selectedZoom ? ' picking' : ''}`}
              onPointerDown={onPreviewClick}
              aria-label="Preview. Click to play or pause, or to move the selected zoom."
            />
          </div>
          <div className="transport">
            <button type="button" className="play-btn" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'} title="Play or pause (Space)">
              {playing ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <span className="time">
              {formatTime(time - project.trim.start, true)} <span className="muted">/ {formatTime(project.trim.end - project.trim.start, true)}</span>
            </span>
            <div className="bar-spacer" />
            <button type="button" className="btn small" onClick={() => addZoom(timeRef.current)} title="Add a zoom at the playhead (Z)">
              <ZoomIn size={16} /> Add zoom
            </button>
            <button
              type="button"
              className="btn small"
              onClick={() => {
                force((n) => n + 1);
                void runAutoZoom(project, media.screen);
              }}
              disabled={analyzing !== null}
              title="Find zoom spots automatically"
            >
              <Sparkles size={16} /> Auto zoom
            </button>
          </div>
        </section>
        <Inspector
          project={project}
          update={update}
          selected={selectedZoom}
          onDeleteZoom={deleteZoom}
          onAutoZoom={() => void runAutoZoom(project, media.screen)}
          onClearZooms={() => {
            update((p) => ({ ...p, zooms: [] }));
            setSelected(null);
          }}
          onBackgroundImage={onBackgroundImage}
          analyzing={analyzing !== null}
          video={screenVideo.current}
          time={selectedZoom ? (playing ? Math.floor(time * 4) / 4 : time) : 0}
        />
      </main>

      <Timeline
        duration={project.duration}
        time={time}
        trim={project.trim}
        zooms={project.zooms}
        selected={selected}
        filmstrip={strip}
        analyzing={analyzing}
        onSeek={seek}
        onTrim={changeTrim}
        onZoom={changeZoom}
        onSelect={setSelected}
        onAdd={addZoom}
      />

      <div className="hidden-media" aria-hidden="true">
        <video
          ref={screenVideo}
          src={media.screenUrl}
          preload="auto"
          playsInline
          onLoadedData={() => {
            seek(timeRef.current);
            force((n) => n + 1);
          }}
          onSeeked={() => !playing && draw()}
        />
        {media.webcamUrl && <video ref={camVideo} src={media.webcamUrl} preload="auto" muted playsInline onSeeked={() => !playing && draw()} />}
      </div>

      {exporting && <ExportDialog project={project} sources={exportSources} onClose={() => setExporting(false)} />}
    </div>
  );
}
