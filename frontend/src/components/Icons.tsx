interface IconProps {
  className?: string;
}

const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  viewBox: '0 0 24 24',
};

export const GridIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} aria-hidden="true">
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);

export const WaveformIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} aria-hidden="true">
    <path d="M3 12h3l2-7 4 14 2-7h7" />
  </svg>
);

export const ChipIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} aria-hidden="true">
    <rect x="6" y="6" width="12" height="12" rx="2" />
    <path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M18 9h4M2 15h4M18 15h4" />
  </svg>
);

export const CodeIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} aria-hidden="true">
    <path d="m8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14" />
  </svg>
);

export const DownloadIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} aria-hidden="true">
    <path d="M12 3v12M7 10l5 5 5-5M4 20h16" />
  </svg>
);

export const CrosshairIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} aria-hidden="true">
    <circle cx="12" cy="12" r="7" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </svg>
);

export const LayersIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} aria-hidden="true">
    <path d="m12 3 9 5-9 5-9-5 9-5Z" />
    <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
  </svg>
);

export const SlidersIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} aria-hidden="true">
    <path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h10M18 18h2" />
    <circle cx="16" cy="6" r="2" />
    <circle cx="8" cy="12" r="2" />
    <circle cx="16" cy="18" r="2" />
  </svg>
);

export const ShieldIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} aria-hidden="true">
    <path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6l7-3Z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

export const RocketIcon = ({ className }: IconProps) => (
  <svg {...base} className={className} aria-hidden="true">
    <path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2 0-2.8-.8-.7-2.2-.7-3 .8Z" />
    <path d="m12 15 6-6" />
    <path d="M14 3c2 0 4 0 7 0 0 3 0 5 0 7-2 3-6 5-9 5l-3-3c0-3 2-7 5-9Z" />
    <path d="M9 12 7 10c-2 1-3 3-3 5 2 0 4-1 5-3Z" />
    <circle cx="14" cy="8" r="1.2" />
  </svg>
);