import { useEffect, useRef, useState } from 'react';
import { formatTime } from '../core/project';
import type { RecordingResult, RecordingSession } from '../core/record';
import { Pause, Play, Trash } from './icons';

interface Props {
  session: RecordingSession;
  onDone: (result: RecordingResult) => void;
  onCancel: () => void;
}

export function RecordingOverlay({ session, onDone, onCancel }: Props) {
  const [count, setCount] = useState(3);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const preview = useRef<HTMLVideoElement>(null);
  const stopping = useRef(false);

  // 3, 2, 1, go.
  useEffect(() => {
    if (count <= 0) return;
    const id = setTimeout(() => {
      if (count === 1) session.start();
      setCount(count - 1);
    }, 1000);
    return () => clearTimeout(id);
  }, [count, session]);

  useEffect(() => {
    if (count > 0 || paused) return;
    const started = performance.now() - elapsed * 1000;
    const id = setInterval(() => setElapsed((performance.now() - started) / 1000), 250);
    return () => clearInterval(id);
  }, [count, paused]);

  useEffect(() => {
    if (preview.current) preview.current.srcObject = session.display;
  }, [session]);

  const stop = async () => {
    if (stopping.current) return;
    stopping.current = true;
    if (session.state === 'inactive') {
      session.close();
      onCancel();
      return;
    }
    onDone(await session.stop());
  };

  // "Stop sharing" in the browser's own bar.
  useEffect(() => {
    const off = session.onEnded(() => void stop());
    return () => void off();
  });

  const discard = () => {
    stopping.current = true;
    session.close();
    onCancel();
  };

  return (
    <div className="record-overlay">
      {count > 0 ? (
        <div className="countdown" key={count}>
          {count}
          <button type="button" className="btn ghost" onClick={discard}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="record-panel">
          <video ref={preview} className="record-preview" muted autoPlay playsInline />
          <div className="record-status">
            <span className={`rec-dot${paused ? ' paused' : ''}`} />
            <span className="record-time">{formatTime(elapsed)}</span>
            <span className="muted">{paused ? 'Paused' : 'Recording'}</span>
          </div>
          <p className="muted small">Switch to the window you are recording. Come back here, or use the browser's sharing bar, to stop.</p>
          <div className="record-actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (paused) session.resume();
                else session.pause();
                setPaused(!paused);
              }}
            >
              {paused ? <Play size={16} /> : <Pause size={16} />} {paused ? 'Resume' : 'Pause'}
            </button>
            <button type="button" className="btn primary" onClick={() => void stop()}>
              <span className="stop-square" /> Stop and edit
            </button>
            <button type="button" className="icon-btn" onClick={discard} title="Discard" aria-label="Discard recording">
              <Trash size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
