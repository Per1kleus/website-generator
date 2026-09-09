/**
 * Inline SVG icons. Bundling a whole icon library would cost a phone user
 * hundreds of KB for a dozen glyphs (requirement 17), so these are hand-rolled.
 * Every icon is aria-hidden — the label always lives in adjacent text.
 */
type P = { className?: string; size?: number };

const base = (size = 24) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
});

export const IconProjects = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="3" y="4" width="18" height="7" rx="2" />
    <rect x="3" y="14" width="18" height="6" rx="2" />
  </svg>
);
export const IconPlus = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const IconUser = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" />
  </svg>
);
export const IconBack = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M15 5l-7 7 7 7" />
  </svg>
);
export const IconMore = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="5" r="1.6" fill="currentColor" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" />
    <circle cx="12" cy="19" r="1.6" fill="currentColor" />
  </svg>
);
export const IconMenu = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M3 6h18M3 12h18M3 18h18" />
  </svg>
);
export const IconClose = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
export const IconCheck = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M20 6L9 17l-5-5" />
  </svg>
);
export const IconSparkles = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z" />
    <path d="M18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9L18 15z" />
  </svg>
);
export const IconPhone = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M6 3h3l2 5-2.5 1.5a12 12 0 006 6L16 13l5 2v3a2 2 0 01-2.2 2A17 17 0 014 5.2 2 2 0 016 3z" />
  </svg>
);
export const IconTablet = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="4" y="2" width="16" height="20" rx="2" />
    <path d="M10.5 18.5h3" />
  </svg>
);
export const IconDesktop = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="2" y="4" width="20" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </svg>
);
export const IconUp = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);
export const IconDown = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 5v14M19 12l-7 7-7-7" />
  </svg>
);
export const IconDrag = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="9" cy="6" r="1.4" fill="currentColor" />
    <circle cx="15" cy="6" r="1.4" fill="currentColor" />
    <circle cx="9" cy="12" r="1.4" fill="currentColor" />
    <circle cx="15" cy="12" r="1.4" fill="currentColor" />
    <circle cx="9" cy="18" r="1.4" fill="currentColor" />
    <circle cx="15" cy="18" r="1.4" fill="currentColor" />
  </svg>
);
export const IconEye = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
export const IconEyeOff = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M3 3l18 18" />
    <path d="M10.6 6.2A9.8 9.8 0 0112 6c6.5 0 10 6 10 6a17 17 0 01-3.6 4.3M6.5 7.7A17 17 0 002 12s3.5 6 10 6a9.9 9.9 0 003.4-.6" />
  </svg>
);
export const IconImage = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="8.5" cy="9.5" r="1.5" />
    <path d="M21 16l-5-5-9 9" />
  </svg>
);
export const IconCamera = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 7h3l1.5-2h7L17 7h3a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V8a1 1 0 011-1z" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
);
export const IconFile = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" />
    <path d="M14 3v5h5" />
  </svg>
);
export const IconPalette = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 3a9 9 0 100 18c1.4 0 2-.9 2-1.8 0-1.4-1.3-1.8-1.3-3 0-.8.7-1.4 1.6-1.4H16a5 5 0 005-5c0-3.9-4-6.8-9-6.8z" />
    <circle cx="7.5" cy="11" r="1.2" fill="currentColor" />
    <circle cx="10" cy="7.5" r="1.2" fill="currentColor" />
    <circle cx="14.5" cy="7.5" r="1.2" fill="currentColor" />
  </svg>
);
export const IconLayers = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 3l9 5-9 5-9-5 9-5z" />
    <path d="M3 13l9 5 9-5" />
  </svg>
);
export const IconDownload = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 3v12M7 11l5 5 5-5" />
    <path d="M4 20h16" />
  </svg>
);
export const IconRocket = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M13.5 3.5c3.5 0 7 3.5 7 7 0 4-3.7 7.6-7.5 9.5L11 17l-4-4 2.9-2c1.9-3.8 5.5-7.5 3.6-7.5z" />
    <circle cx="15" cy="9" r="1.6" />
    <path d="M7 17c-1.5 1.5-1.5 4-1.5 4s2.5 0 4-1.5" />
  </svg>
);
export const IconSettings = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 110-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z" />
  </svg>
);
export const IconPencil = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 20h4L19 9a2.8 2.8 0 10-4-4L4 16v4z" />
  </svg>
);
export const IconExternal = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M14 4h6v6M20 4l-9 9" />
    <path d="M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" />
  </svg>
);
export const IconCopy = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15V5a2 2 0 012-2h10" />
  </svg>
);
export const IconTrash = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 7h16M10 11v6M14 11v6" />
    <path d="M6 7l1 13a1 1 0 001 1h8a1 1 0 001-1l1-13M9 7V4h6v3" />
  </svg>
);
export const IconSend = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M5 12l14-7-5.5 14L11 13z" />
  </svg>
);
export const IconAlert = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v6M12 16.5v.5" />
  </svg>
);
export const IconGlobe = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" />
  </svg>
);
export const IconSheet = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
  </svg>
);
