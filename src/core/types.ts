/** A point in the source video, from 0 to 1 on both axes. */
export interface Point {
  x: number;
  y: number;
}

export interface ZoomSegment {
  id: string;
  /** Seconds in the source video. */
  start: number;
  end: number;
  /** 1 is no zoom, 2 shows half the width and height. */
  scale: number;
  /** The point the zoom centers on. */
  focus: Point;
  /** Follow the cursor instead of staying on `focus`. Only has an effect when the recording has cursor data. */
  follow: boolean;
  /** How the segment was made, so "Auto zoom" can replace its own segments but keep the ones you made. */
  origin: 'auto' | 'manual';
}

export interface CursorSample {
  t: number;
  x: number;
  y: number;
}

export interface Click {
  t: number;
  x: number;
  y: number;
}

export type Background =
  | { kind: 'preset'; id: string }
  | { kind: 'solid'; color: string }
  | { kind: 'image' };

export type Aspect = 'auto' | '16:9' | '9:16' | '1:1' | '4:5' | '4:3';
export type WindowFrame = 'none' | 'macos' | 'browser';
export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type CameraSpeed = 'slow' | 'normal' | 'fast';

export interface Style {
  background: Background;
  /** Blur for image backgrounds, 0 to 1. */
  backgroundBlur: number;
  /** Space around the video, as a share of the shorter output side. 0 to 0.2. */
  padding: number;
  /** Corner radius in pixels of a 1080p output. */
  radius: number;
  /** Shadow strength, 0 to 1. */
  shadow: number;
  aspect: Aspect;
  frame: WindowFrame;
  /** Text in the address bar of the browser frame. */
  frameTitle: string;
}

export interface CursorStyle {
  show: boolean;
  /** 1 is the normal size. */
  size: number;
  /** 0 follows the real movement, 1 is very smooth. */
  smoothing: number;
  clicks: boolean;
}

export interface WebcamStyle {
  show: boolean;
  corner: Corner;
  /** Share of the shorter output side. */
  size: number;
  shape: 'circle' | 'rounded' | 'square';
  mirror: boolean;
  /** Shrink the webcam while zoomed in, so it covers less of what you are showing. */
  shrinkOnZoom: boolean;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Source video. */
  width: number;
  height: number;
  duration: number;
  hasAudio: boolean;
  hasWebcam: boolean;
  /** Seconds the webcam recording started after the screen recording. */
  webcamOffset: number;
  trim: { start: number; end: number };
  zooms: ZoomSegment[];
  cameraSpeed: CameraSpeed;
  /** Only present for recordings made with the Chrome extension or the sample. */
  cursor?: CursorSample[];
  clicks?: Click[];
  style: Style;
  cursorStyle: CursorStyle;
  webcam: WebcamStyle;
}

/** Media stored next to a project. */
export type AssetKind = 'screen' | 'webcam' | 'background' | 'thumbnail';
