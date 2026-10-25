/** Mack's mark: an electric-yellow bolt (the same drawing as build/icon.svg). */
export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="100 40 312 432" aria-hidden="true">
      <defs>
        <linearGradient id="mack-bolt" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFF04D" />
          <stop offset="1" stopColor="#FFD000" />
        </linearGradient>
      </defs>
      <path fill="url(#mack-bolt)" d="M298 58 L126 292 H236 L206 454 L388 204 H272 Z" />
    </svg>
  );
}
