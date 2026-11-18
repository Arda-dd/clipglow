import { memo, useEffect, useRef, useState } from 'react';
import { clamp, formatTime, MIN_ZOOM_LENGTH } from '../core/project';
import type { ZoomSegment } from '../core/types';

interface Props {
  duration: number;
  time: number;
  trim: { start: number; end: number };
  zooms: ZoomSegment[];
  selected: string | null;
  filmstrip: string[];
  analyzing: number | null;
  onSeek: (t: number) => void;
  onTrim: (trim: { start: number; end: number }, done: boolean) => void;
  onZoom: (id: string, patch: Partial<ZoomSegment>, done: boolean) => void;
  onSelect: (id: string | null) => void;
  onAdd: (t: number) => void;
}

const STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
const MIN_TRIM = 0.5;

type Drag =
  | { kind: 'seek' }
  | { kind: 'trim-start' | 'trim-end' }
  | { kind: 'zoom-move' | 'zoom-start' | 'zoom-end'; id: string; x0: number; start: number; end: number; min: number; max: number };

export const Timeline = memo(function Timeline(props: Props) {
  const { duration, time, trim, zooms, selected, filmstrip, analyzing } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<number | null>(null);
  const drag = useRef<Drag | null>(null);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const pps = width / Math.max(duration, 0.001);
  const toX = (t: number) => t * pps;
  const timeAt = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect();
    return clamp((clientX - rect.left) / pps, 0, duration);
  };

  const step = STEPS.find((s) => s * pps >= 70) ?? 600;
  const ticks: number[] = [];
  for (let t = 0; t <= duration + 1e-6; t += step) ticks.push(t);

  const begin = (e: React.PointerEvent, d: Drag) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = d;
  };

  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    const p = latest.current;
    if (!d) return;
    const t = timeAt(e.clientX);
    if (d.kind === 'seek') p.onSeek(t);
    else if (d.kind === 'trim-start') p.onTrim({ start: clamp(t, 0, p.trim.end - MIN_TRIM), end: p.trim.end }, false);
    else if (d.kind === 'trim-end') p.onTrim({ start: p.trim.start, end: clamp(t, p.trim.start + MIN_TRIM, duration) }, false);
    else if (d.kind === 'zoom-move' || d.kind === 'zoom-start' || d.kind === 'zoom-end') {
      const dt = (e.clientX - d.x0) / pps;
      if (d.kind === 'zoom-move') {
        const len = d.end - d.start;
        const start = clamp(d.start + dt, d.min, d.max - len);
        p.onZoom(d.id, { start, end: start + len }, false);
      } else if (d.kind === 'zoom-start') p.onZoom(d.id, { start: clamp(d.start + dt, d.min, d.end - MIN_ZOOM_LENGTH) }, false);
      else p.onZoom(d.id, { end: clamp(d.end + dt, d.start + MIN_ZOOM_LENGTH, d.max) }, false);
    }
  };

  const end = () => {
    const d = drag.current;
    drag.current = null;
    const p = latest.current;
    if (!d) return;
    if (d.kind === 'trim-start' || d.kind === 'trim-end') p.onTrim(p.trim, true);
    if (d.kind.startsWith('zoom')) {
      const z = p.zooms.find((z) => 'id' in d && z.id === d.id);
      if (z) p.onZoom(z.id, {}, true);
    }
  };

  /** Neighbours limit how far a zoom can move or grow. */
  const limits = (z: ZoomSegment) => {
    const min = zooms.filter((o) => o.id !== z.id && o.end <= z.start + 1e-6).reduce((m, o) => Math.max(m, o.end), 0);
    const max = zooms.filter((o) => o.id !== z.id && o.start >= z.end - 1e-6).reduce((m, o) => Math.min(m, o.start), duration);
    return { min, max };
  };

  const hoverFree = hover !== null && !zooms.some((z) => hover >= z.start && hover < z.end);

  return (
    <div className="timeline" onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      <div className="timeline-inner" ref={ref}>
        <div className="ruler" onPointerDown={(e) => {
          begin(e, { kind: 'seek' });
          props.onSeek(timeAt(e.clientX));
        }}>
          {ticks.map((t) => (
            <span key={t} className="tick" style={{ left: toX(t) }}>
              {formatTime(t)}
            </span>
          ))}
        </div>

        <div
          className="track video-track"
          onPointerDown={(e) => {
            begin(e, { kind: 'seek' });
            props.onSeek(timeAt(e.clientX));
          }}
        >
          <div className="filmstrip">
            {filmstrip.map((src, i) => (
              <img key={i} src={src} alt="" draggable={false} />
            ))}
          </div>
          <div className="trimmed" style={{ left: 0, width: toX(trim.start) }} />
          <div className="trimmed" style={{ left: toX(trim.end), right: 0 }} />
          <div className="trim-range" style={{ left: toX(trim.start), width: toX(trim.end - trim.start) }}>
            <div
              className="trim-handle start"
              role="slider"
              aria-label="Trim start"
              aria-valuemin={0}
              aria-valuemax={duration}
              aria-valuenow={trim.start}
              onPointerDown={(e) => begin(e, { kind: 'trim-start' })}
            />
            <div
              className="trim-handle end"
              role="slider"
              aria-label="Trim end"
              aria-valuemin={0}
              aria-valuemax={duration}
              aria-valuenow={trim.end}
              onPointerDown={(e) => begin(e, { kind: 'trim-end' })}
            />
          </div>
        </div>

        <div
          className="track zoom-track"
          onPointerMove={(e) => !drag.current && setHover(timeAt(e.clientX))}
          onPointerLeave={() => setHover(null)}
          onPointerDown={(e) => {
            if (e.target !== e.currentTarget) return;
            const t = timeAt(e.clientX);
            props.onSelect(null);
            props.onAdd(t);
          }}
        >
          {analyzing !== null && (
            <div className="analyzing">
              <div className="analyzing-bar" style={{ width: `${Math.round(analyzing * 100)}%` }} />
              <span>Finding the moments worth zooming into… {Math.round(analyzing * 100)}%</span>
            </div>
          )}
          {zooms.length === 0 && analyzing === null && hover === null && (
            <span className="track-hint">Click here to add a zoom, or use Auto zoom</span>
          )}
          {hoverFree && hover !== null && (
            <div className="zoom-ghost" style={{ left: toX(hover) }}>
              + Zoom
            </div>
          )}
          {zooms.map((z) => {
            const w = toX(z.end - z.start);
            return (
              <div
                key={z.id}
                className={`zoom-block${z.id === selected ? ' selected' : ''}${z.origin === 'auto' ? ' auto' : ''}`}
                style={{ left: toX(z.start), width: w }}
                onPointerDown={(e) => {
                  props.onSelect(z.id);
                  begin(e, { kind: 'zoom-move', id: z.id, x0: e.clientX, start: z.start, end: z.end, ...limits(z) });
                }}
                title={`${z.scale.toFixed(1)}× zoom, ${formatTime(z.start, true)} to ${formatTime(z.end, true)}`}
              >
                <div
                  className="zoom-edge start"
                  onPointerDown={(e) => {
                    props.onSelect(z.id);
                    begin(e, { kind: 'zoom-start', id: z.id, x0: e.clientX, start: z.start, end: z.end, ...limits(z) });
                  }}
                />
                {w > 34 && <span className="zoom-label">{z.scale.toFixed(1)}×</span>}
                {w > 90 && z.origin === 'auto' && <span className="zoom-badge">auto</span>}
                <div
                  className="zoom-edge end"
                  onPointerDown={(e) => {
                    props.onSelect(z.id);
                    begin(e, { kind: 'zoom-end', id: z.id, x0: e.clientX, start: z.start, end: z.end, ...limits(z) });
                  }}
                />
              </div>
            );
          })}
        </div>

        <div className="playhead" style={{ left: toX(time) }}>
          <div className="playhead-knob" onPointerDown={(e) => begin(e, { kind: 'seek' })} />
        </div>
      </div>
    </div>
  );
});
