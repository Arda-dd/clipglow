import type { SVGProps } from 'react';

type Props = SVGProps<SVGSVGElement> & { size?: number };

function make(paths: React.ReactNode, fill = false) {
  return function Icon({ size = 18, ...rest }: Props) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={fill ? 'currentColor' : 'none'}
        stroke={fill ? 'none' : 'currentColor'}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...rest}
      >
        {paths}
      </svg>
    );
  };
}

export const Play = make(<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z" />, true);
export const Pause = make(
  <>
    <rect x="6" y="4" width="4" height="16" rx="1.2" />
    <rect x="14" y="4" width="4" height="16" rx="1.2" />
  </>,
  true,
);
export const ZoomIn = make(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-4-4M11 8v6M8 11h6" />
  </>,
);
export const Sparkles = make(
  <>
    <path d="M12 3.5 13.6 8a2 2 0 0 0 1.3 1.3L19.5 11l-4.6 1.6a2 2 0 0 0-1.3 1.3L12 18.5l-1.6-4.6a2 2 0 0 0-1.3-1.3L4.5 11l4.6-1.6A2 2 0 0 0 10.4 8L12 3.5Z" />
    <path d="M19 3v4M17 5h4M5 17v3M3.5 18.5h3" />
  </>,
);
export const Undo = make(<path d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" />);
export const Redo = make(<path d="m15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h3" />);
export const Download = make(<path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14" />);
export const Trash = make(<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />);
export const Close = make(<path d="M6 6l12 12M18 6 6 18" />);
export const Back = make(<path d="M15 18 9 12l6-6" />);
export const Mic = make(
  <>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </>,
);
export const Camera = make(
  <>
    <rect x="3" y="6" width="13" height="12" rx="2.5" />
    <path d="m16 10 5-3v10l-5-3" />
  </>,
);
export const Monitor = make(
  <>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </>,
);
export const Upload = make(<path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 20h14" />);
export const ImageIcon = make(
  <>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <circle cx="9" cy="10" r="1.8" />
    <path d="m21 16-5-5-9 9" />
  </>,
);
export const Layout = make(
  <>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <rect x="7" y="8" width="10" height="8" rx="1" />
  </>,
);
export const Pointer = make(<path d="M5 3.5v15l4.2-3.9 2.9 6.2 2.6-1.2-2.9-6.1H18L5 3.5Z" />);
export const Webcam = make(
  <>
    <circle cx="12" cy="10" r="6.5" />
    <circle cx="12" cy="10" r="2.2" />
    <path d="M8 20h8" />
  </>,
);
export const Check = make(<path d="m5 12.5 4.5 4.5L19 7.5" />);
export const Github = make(
  <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.6 9.6 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" />,
  true,
);
export const Scissors = make(
  <>
    <circle cx="6" cy="6" r="2.5" />
    <circle cx="6" cy="18" r="2.5" />
    <path d="M8 7.5 20 18M8 16.5 20 6" />
  </>,
);
export const Shield = make(<path d="M12 3 5 6v5c0 4.5 3 8.2 7 10 4-1.8 7-5.5 7-10V6l-7-3Z" />);
export const Bolt = make(<path d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z" />);
export const Film = make(
  <>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
  </>,
);
export const Keyboard = make(
  <>
    <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
    <path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M8 14h8" />
  </>,
);

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="cg-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffb36b" />
          <stop offset="0.5" stopColor="#ff3d8b" />
          <stop offset="1" stopColor="#7c5cff" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="9" fill="url(#cg-logo)" />
      <rect x="7" y="9" width="18" height="13" rx="3" fill="none" stroke="#fff" strokeWidth="2.2" />
      <rect x="13.5" y="13.5" width="8" height="6" rx="1.6" fill="#fff" />
    </svg>
  );
}
