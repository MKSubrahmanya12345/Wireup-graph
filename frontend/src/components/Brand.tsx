/**
 * Wireup brand mark — a bolt in a rounded square, used everywhere the
 * product identifies itself.
 */
export function WireupMark({ size = 34 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      className="wireup-mark"
    >
      <rect x="2" y="2" width="44" height="44" rx="12" fill="url(#wg-body)" />
      <rect x="2" y="2" width="44" height="44" rx="12" stroke="url(#wg-stroke)" strokeWidth="1.5" />
      <path
        d="M26.5 9 15 27h8l-2.5 12L33 21h-8l1.5-12Z"
        fill="url(#wg-bolt)"
        stroke="#0b1120"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <defs>
        <linearGradient id="wg-body" x1="2" y1="2" x2="46" y2="46">
          <stop stopColor="#0e7490" />
          <stop offset="1" stopColor="#6d28d9" />
        </linearGradient>
        <linearGradient id="wg-stroke" x1="2" y1="46" x2="46" y2="2">
          <stop stopColor="#67e8f9" stopOpacity="0.9" />
          <stop offset="1" stopColor="#a78bfa" stopOpacity="0.9" />
        </linearGradient>
        <linearGradient id="wg-bolt" x1="15" y1="9" x2="33" y2="39">
          <stop stopColor="#fef9c3" />
          <stop offset="1" stopColor="#facc15" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function WireupWordmark({ size = 34 }: { size?: number }) {
  return (
    <span className="wordmark">
      <WireupMark size={size} />
      <span className="wordmark-text">
        Wireup
        <small>prompt &rarr; plan &rarr; shipped hardware</small>
      </span>
    </span>
  );
}
