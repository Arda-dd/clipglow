import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { PRESETS, presetThumbnail } from '../core/backgrounds';
import { clampFocus } from '../core/camera';
import { clamp, formatTime } from '../core/project';
import type { Aspect, CameraSpeed, Corner, Project, WindowFrame, ZoomSegment } from '../core/types';
import { Camera, ImageIcon, Layout, Pointer, Sparkles, Trash, ZoomIn } from './icons';

export type Update = (fn: (p: Project) => Project, mergeKey?: string) => void;

type Tab = 'background' | 'layout' | 'zoom' | 'webcam' | 'cursor';

interface Props {
  project: Project;
  update: Update;
  selected: ZoomSegment | null;
  onDeleteZoom: (id: string) => void;
  onAutoZoom: () => void;
  onClearZooms: () => void;
  onBackgroundImage: (file: File) => void;
  analyzing: boolean;
  video: HTMLVideoElement | null;
  time: number;
}

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const { label, value, min, max, step, format, onChange } = props;
  return (
    <label className="field slider">
      <span className="field-row">
        <span>{label}</span>
        <span className="field-value">{format ? format(value) : value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ '--fill': `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties}
      />
    </label>
  );
}

function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="field toggle">
      <span>
        {label}
        {hint && <span className="hint">{hint}</span>}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map(([v, text]) => (
          <button key={v} type="button" role="radio" aria-checked={v === value} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

const SOLIDS = ['#0b0b0f', '#ffffff', '#f4f1ea', '#1e293b', '#4f46e5', '#0ea5e9', '#16a34a', '#f59e0b', '#ef4444', '#ec4899'];

const ASPECTS: [Aspect, string, string][] = [
  ['auto', 'Original', ''],
  ['16:9', '16:9', 'YouTube'],
  ['9:16', '9:16', 'Reels, Shorts'],
  ['1:1', '1:1', 'Square'],
  ['4:5', '4:5', 'LinkedIn, Instagram'],
  ['4:3', '4:3', 'Classic'],
];

function BackgroundPanel({ project, update, onBackgroundImage }: Pick<Props, 'project' | 'update' | 'onBackgroundImage'>) {
  const thumbs = useMemo(() => Object.fromEntries(PRESETS.map((p) => [p.id, presetThumbnail(p)])), []);
  const bg = project.style.background;
  const file = useRef<HTMLInputElement>(null);
  const set = (background: Project['style']['background']) => update((p) => ({ ...p, style: { ...p.style, background } }));
  return (
    <>
      <div className="field">
        <span className="field-label">Wallpaper</span>
        <div className="swatches">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`swatch${bg.kind === 'preset' && bg.id === p.id ? ' on' : ''}`}
              style={{ backgroundImage: `url(${thumbs[p.id]})` }}
              onClick={() => set({ kind: 'preset', id: p.id })}
              title={p.name}
              aria-label={p.name}
            />
          ))}
        </div>
      </div>
      <div className="field">
        <span className="field-label">Color</span>
        <div className="colors">
          {SOLIDS.map((c) => (
            <button
              key={c}
              type="button"
              className={`color${bg.kind === 'solid' && bg.color === c ? ' on' : ''}`}
              style={{ background: c }}
              onClick={() => set({ kind: 'solid', color: c })}
              aria-label={c}
            />
          ))}
          <label className="color custom" title="Pick any color">
            <input
              type="color"
              value={bg.kind === 'solid' ? bg.color : '#6d28d9'}
              onChange={(e) => update((p) => ({ ...p, style: { ...p.style, background: { kind: 'solid', color: e.target.value } } }), 'bg-color')}
            />
          </label>
        </div>
      </div>
      <div className="field">
        <span className="field-label">Image</span>
        <button type="button" className={`btn wide${bg.kind === 'image' ? ' on' : ''}`} onClick={() => file.current?.click()}>
          <ImageIcon size={16} /> {bg.kind === 'image' ? 'Change image' : 'Use your own image'}
        </button>
        <input
          ref={file}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onBackgroundImage(f);
            e.target.value = '';
          }}
        />
      </div>
      {bg.kind === 'image' && (
        <Slider
          label="Blur"
          value={project.style.backgroundBlur}
          min={0}
          max={1}
          step={0.01}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => update((p) => ({ ...p, style: { ...p.style, backgroundBlur: v } }), 'bg-blur')}
        />
      )}
    </>
  );
}

function LayoutPanel({ project, update }: Pick<Props, 'project' | 'update'>) {
  const s = project.style;
  const set = (patch: Partial<Project['style']>, key?: string) => update((p) => ({ ...p, style: { ...p.style, ...patch } }), key);
  return (
    <>
      <div className="field">
        <span className="field-label">Size</span>
        <div className="aspects">
          {ASPECTS.map(([a, name, use]) => {
            const [w, h] = a === 'auto' ? [project.width, project.height] : a.split(':').map(Number);
            const k = 22 / Math.max(w, h);
            return (
              <button key={a} type="button" className={`aspect${s.aspect === a ? ' on' : ''}`} onClick={() => set({ aspect: a })} title={use || name}>
                <span className="aspect-shape" style={{ width: w * k, height: h * k }} />
                <span>{name}</span>
              </button>
            );
          })}
        </div>
      </div>
      <Slider label="Padding" value={s.padding} min={0} max={0.2} step={0.005} format={(v) => `${Math.round(v * 500)}%`} onChange={(v) => set({ padding: v }, 'padding')} />
      <Slider label="Corners" value={s.radius} min={0} max={48} step={1} format={(v) => `${v}px`} onChange={(v) => set({ radius: v }, 'radius')} />
      <Slider label="Shadow" value={s.shadow} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ shadow: v }, 'shadow')} />
      <Segmented<WindowFrame>
        label="Window frame"
        value={s.frame}
        options={[
          ['none', 'None'],
          ['macos', 'macOS'],
          ['browser', 'Browser'],
        ]}
        onChange={(frame) => set({ frame })}
      />
      {s.frame !== 'none' && (
        <label className="field">
          <span className="field-label">{s.frame === 'browser' ? 'Address' : 'Title'}</span>
          <input
            className="text"
            value={s.frameTitle}
            placeholder={s.frame === 'browser' ? 'yourapp.com' : 'Window title'}
            maxLength={80}
            onChange={(e) => set({ frameTitle: e.target.value }, 'frame-title')}
          />
        </label>
      )}
    </>
  );
}

/** A small, unzoomed view of the current frame with the zoomed area drawn on it. Drag to move the zoom. */
function FocusPicker({ project, zoom, update, video, time }: { project: Project; zoom: ZoomSegment; update: Update; video: HTMLVideoElement | null; time: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const width = 264;
  const height = Math.round((width / project.width) * project.height);
  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    c.width = width * dpr;
    c.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    if (video && video.readyState >= 2) ctx.drawImage(video, 0, 0, width, height);
    const f = clampFocus(zoom.focus, zoom.scale);
    const vw = width / zoom.scale;
    const vh = height / zoom.scale;
    const x = f.x * width - vw / 2;
    const y = f.y * height - vh / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, width, y);
    ctx.fillRect(0, y + vh, width, height - y - vh);
    ctx.fillRect(0, y, x, vh);
    ctx.fillRect(x + vw, y, width - x - vw, vh);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, vw, vh);
    ctx.beginPath();
    ctx.arc(f.x * width, f.y * height, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ff3d8b';
    ctx.fill();
  }, [project.width, project.height, zoom.focus, zoom.scale, video, time, height]);

  const setFrom = (e: React.PointerEvent<HTMLCanvasElement>, done: boolean) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const focus = clampFocus({ x: clamp((e.clientX - rect.left) / rect.width, 0, 1), y: clamp((e.clientY - rect.top) / rect.height, 0, 1) }, zoom.scale);
    update((p) => ({ ...p, zooms: p.zooms.map((z) => (z.id === zoom.id ? { ...z, focus, origin: 'manual' } : z)) }), done ? undefined : `focus-${zoom.id}`);
  };

  return (
    <div className="field">
      <span className="field-label">Zoom into</span>
      <canvas
        ref={canvas}
        className="focus-picker"
        style={{ width, height }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setFrom(e, false);
        }}
        onPointerMove={(e) => e.buttons && setFrom(e, false)}
      />
      <span className="hint">Drag the box, or click anywhere on the big preview.</span>
    </div>
  );
}

function ZoomPanel(props: Props) {
  const { project, update, selected, onDeleteZoom, onAutoZoom, onClearZooms, analyzing, video, time } = props;
  const setZoom = (patch: Partial<ZoomSegment>, key?: string) =>
    update((p) => ({ ...p, zooms: p.zooms.map((z) => (z.id === selected?.id ? { ...z, ...patch, origin: 'manual' } : z)) }), key);
  return (
    <>
      {selected ? (
        <>
          <div className="zoom-head">
            <strong>Zoom</strong>
            <span className="muted small">
              {formatTime(selected.start, true)} – {formatTime(selected.end, true)}
            </span>
          </div>
          <Slider label="Zoom level" value={selected.scale} min={1.1} max={4} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => setZoom({ scale: v }, `scale-${selected.id}`)} />
          <FocusPicker project={project} zoom={selected} update={update} video={video} time={time} />
          {!!project.cursor?.length && (
            <Toggle label="Follow the cursor" hint="Move with the pointer instead of staying put." checked={selected.follow} onChange={(follow) => setZoom({ follow })} />
          )}
          <button type="button" className="btn wide danger" onClick={() => onDeleteZoom(selected.id)}>
            <Trash size={16} /> Delete this zoom
          </button>
        </>
      ) : (
        <div className="empty-panel">
          <ZoomIn size={26} />
          <p>Select a zoom on the timeline to change it.</p>
          <p className="muted small">
            Click the zoom track to add one, or press <kbd>Z</kbd> to add one at the playhead.
          </p>
        </div>
      )}
      <hr />
      <button type="button" className="btn wide" onClick={onAutoZoom} disabled={analyzing}>
        <Sparkles size={16} /> {analyzing ? 'Looking for zoom spots…' : project.zooms.some((z) => z.origin === 'auto') ? 'Run auto zoom again' : 'Auto zoom'}
      </button>
      <p className="hint">
        {project.clicks?.length
          ? 'Zooms in where you clicked. Your own zooms are kept.'
          : 'Looks for places where something changes on screen, like typing or a menu opening. Your own zooms are kept.'}
      </p>
      <Segmented<CameraSpeed>
        label="Camera speed"
        value={project.cameraSpeed}
        options={[
          ['slow', 'Slow'],
          ['normal', 'Normal'],
          ['fast', 'Fast'],
        ]}
        onChange={(cameraSpeed) => update((p) => ({ ...p, cameraSpeed }))}
      />
      {project.zooms.length > 0 && (
        <button type="button" className="link-button danger small" onClick={onClearZooms}>
          Remove all zooms
        </button>
      )}
    </>
  );
}

function WebcamPanel({ project, update }: Pick<Props, 'project' | 'update'>) {
  const w = project.webcam;
  const set = (patch: Partial<Project['webcam']>, key?: string) => update((p) => ({ ...p, webcam: { ...p.webcam, ...patch } }), key);
  return (
    <>
      <Toggle label="Show webcam" checked={w.show} onChange={(show) => set({ show })} />
      <div className="field">
        <span className="field-label">Corner</span>
        <div className="corners">
          {(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as Corner[]).map((c) => (
            <button key={c} type="button" className={`corner ${c}${w.corner === c ? ' on' : ''}`} onClick={() => set({ corner: c })} aria-label={c.replace('-', ' ')}>
              <span />
            </button>
          ))}
        </div>
      </div>
      <Slider label="Size" value={w.size} min={0.1} max={0.45} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ size: v }, 'cam-size')} />
      <Segmented
        label="Shape"
        value={w.shape}
        options={[
          ['circle', 'Circle'],
          ['rounded', 'Rounded'],
          ['square', 'Square'],
        ]}
        onChange={(shape) => set({ shape })}
      />
      <Toggle label="Mirror" checked={w.mirror} onChange={(mirror) => set({ mirror })} />
      <Toggle label="Smaller while zoomed in" checked={w.shrinkOnZoom} onChange={(shrinkOnZoom) => set({ shrinkOnZoom })} />
    </>
  );
}

function CursorPanel({ project, update }: Pick<Props, 'project' | 'update'>) {
  const c = project.cursorStyle;
  const set = (patch: Partial<Project['cursorStyle']>, key?: string) => update((p) => ({ ...p, cursorStyle: { ...p.cursorStyle, ...patch } }), key);
  return (
    <>
      <Toggle label="Show cursor" checked={c.show} onChange={(show) => set({ show })} />
      <Slider label="Size" value={c.size} min={0.8} max={3} step={0.05} format={(v) => `${v.toFixed(1)}×`} onChange={(v) => set({ size: v }, 'cursor-size')} />
      <Slider label="Smoothing" value={c.smoothing} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ smoothing: v }, 'cursor-smooth')} />
      <Toggle label="Click effect" checked={c.clicks} onChange={(clicks) => set({ clicks })} />
    </>
  );
}

export const Inspector = memo(function Inspector(props: Props) {
  const { project } = props;
  const [tab, setTab] = useState<Tab>('background');
  useEffect(() => {
    if (props.selected) setTab('zoom');
  }, [props.selected?.id]);
  const tabs: [Tab, string, typeof ImageIcon][] = [
    ['background', 'Background', ImageIcon],
    ['layout', 'Layout', Layout],
    ['zoom', 'Zoom', ZoomIn],
  ];
  if (project.hasWebcam) tabs.push(['webcam', 'Webcam', Camera]);
  if (project.cursor?.length) tabs.push(['cursor', 'Cursor', Pointer]);
  return (
    <aside className="inspector">
      <nav className="tabs" role="tablist">
        {tabs.map(([id, label, Icon]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            <Icon size={17} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="panel" role="tabpanel">
        {tab === 'background' && <BackgroundPanel {...props} />}
        {tab === 'layout' && <LayoutPanel {...props} />}
        {tab === 'zoom' && <ZoomPanel {...props} />}
        {tab === 'webcam' && <WebcamPanel {...props} />}
        {tab === 'cursor' && <CursorPanel {...props} />}
      </div>
    </aside>
  );
});
