import React from 'react';

interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
}

/**
 * 1. Shuffle
 * Clean crossing S-curves with right-pointing arrowheads matching reference image.
 */
export const PlayerShuffleIcon: React.FC<IconProps> = ({ size = 20, className = '', ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    {/* Bottom-left to top-right path */}
    <path d="M 3.5 17.5 H 6 C 9 17.5 10.5 12 13.5 8.5 C 15.5 6.5 17 6.5 20.5 6.5" />
    {/* Top arrowhead */}
    <path d="M 17 3.5 L 20.5 6.5 L 17 9.5" />
    {/* Top-left to bottom-right path */}
    <path d="M 3.5 6.5 H 6 C 9 6.5 10.5 12 13.5 15.5 C 15.5 17.5 17 17.5 20.5 17.5" />
    {/* Bottom arrowhead */}
    <path d="M 17 14.5 L 20.5 17.5 L 17 20.5" />
  </svg>
);

/**
 * 2. Previous
 * Vertical bar on left + solid left-pointing triangle on right matching reference image.
 */
export const PlayerPreviousIcon: React.FC<IconProps> = ({ size = 24, className = '', ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    {...props}
  >
    {/* Left vertical bar with rounded ends */}
    <rect x="3.5" y="4.5" width="2.2" height="15" rx="1.1" />
    {/* Right solid triangle pointing left */}
    <path d="M 19.5 5.2 C 20.3 4.7 21 5.1 21 6.1 L 21 17.9 C 21 18.9 20.3 19.3 19.5 18.8 L 9 12.8 C 8.2 12.4 8.2 11.6 9 11.2 Z" />
  </svg>
);

/**
 * 3. Play / Pause
 * Clean white icons inside the circular black Play/Pause button matching reference image.
 */
export const PlayerPauseIcon: React.FC<IconProps> = ({ size = 28, className = '', ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    {...props}
  >
    <rect x="6" y="4.5" width="3.5" height="15" rx="1.5" />
    <rect x="14.5" y="4.5" width="3.5" height="15" rx="1.5" />
  </svg>
);

export const PlayerPlayIcon: React.FC<IconProps> = ({ size = 28, className = '', ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    {...props}
  >
    <path d="M 8.5 5.2 C 7.7 4.7 7 5.1 7 6.1 L 7 17.9 C 7 18.9 7.7 19.3 8.5 18.8 L 18.5 12.8 C 19.3 12.4 19.3 11.6 18.5 11.2 Z" />
  </svg>
);

/**
 * 4. Next
 * Solid right-pointing triangle on left + vertical bar on right matching reference image.
 */
export const PlayerNextIcon: React.FC<IconProps> = ({ size = 24, className = '', ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    {...props}
  >
    {/* Left solid triangle pointing right */}
    <path d="M 4.5 5.2 C 3.7 4.7 3 5.1 3 6.1 L 3 17.9 C 3 18.9 3.7 19.3 4.5 18.8 L 15 12.8 C 15.8 12.4 15.8 11.6 15 11.2 Z" />
    {/* Right vertical bar with rounded ends */}
    <rect x="18.3" y="4.5" width="2.2" height="15" rx="1.1" />
  </svg>
);

/**
 * 5. Repeat
 * Oval looping track with arrows and central indicator pill matching reference image.
 */
export const PlayerRepeatIcon: React.FC<IconProps & { mode?: 'off' | 'all' | 'one' }> = ({
  size = 20,
  className = '',
  mode = 'off',
  ...props
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    {/* Top looping track */}
    <path d="M 6.5 14 C 4.5 14 3 12.5 3 10 C 3 7.5 4.5 6 6.5 6 H 18" />
    {/* Top arrow tip */}
    <path d="M 15 3.5 L 18.5 6 L 15 8.5" />
    {/* Bottom looping track */}
    <path d="M 17.5 10 C 19.5 10 21 11.5 21 14 C 21 16.5 19.5 18 17.5 18 H 6" />
    {/* Bottom arrow tip */}
    <path d="M 9 15.5 L 5.5 18 L 9 20.5" />
    {/* Center indicator: '1' for single track repeat, solid pill for loop/off */}
    {mode === 'one' ? (
      <text
        x="12"
        y="14.5"
        textAnchor="middle"
        fontSize="7.5"
        fontWeight="bold"
        fontFamily="system-ui, -apple-system, sans-serif"
        fill="currentColor"
        stroke="none"
      >
        1
      </text>
    ) : (
      <rect x="8.5" y="10" width="7" height="4" rx="2" fill="currentColor" stroke="none" />
    )}
  </svg>
);
