/**
 * Lightweight, cached artwork color extractor.
 * Samples vibrant non-extreme pixels from album art to tint the player background.
 * Runs once per artwork change, 0% CPU impact during playback.
 */

const colorCache = new Map<string, [number, number, number]>();

// Default STUXS purple [r, g, b]
export const DEFAULT_STUXS_COLOR: [number, number, number] = [124, 58, 237];

const VIBRANT_PALETTES: [number, number, number][] = [
  [225, 85, 40],   // Saffron / Coral Orange
  [215, 50, 85],   // Vibrant Crimson / Rose
  [124, 58, 237],  // Rich STUXS Violet
  [30, 130, 225],  // Ocean Blue
  [20, 160, 120],  // Mint Emerald
  [230, 140, 25],  // Golden Amber
  [145, 60, 220],  // Royal Orchid
  [240, 105, 55],  // Sunset Flame
];

function getDeterministicColor(str: string): [number, number, number] {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  const idx = Math.abs(hash) % VIBRANT_PALETTES.length;
  return VIBRANT_PALETTES[idx];
}

export async function extractArtworkColor(imageUrl?: string, trackTitle?: string): Promise<[number, number, number]> {
  const cacheKey = imageUrl || trackTitle || 'default';
  if (colorCache.has(cacheKey)) {
    return colorCache.get(cacheKey)!;
  }

  const fallback = (): [number, number, number] => {
    const color = trackTitle ? getDeterministicColor(trackTitle) : DEFAULT_STUXS_COLOR;
    colorCache.set(cacheKey, color);
    return color;
  };

  if (!imageUrl) {
    return fallback();
  }

  // Try fetching as blob first to get a same-origin Object URL (avoids Android WebView canvas taint)
  let resolvedUrl = imageUrl;
  let objectUrl: string | null = null;

  try {
    const res = await fetch(imageUrl, { mode: 'cors' });
    if (res.ok) {
      const blob = await res.blob();
      objectUrl = URL.createObjectURL(blob);
      resolvedUrl = objectUrl;
    }
  } catch {
    // Fall back to direct image loading
    resolvedUrl = imageUrl;
  }

  return new Promise((resolve) => {
    const img = new Image();
    if (!objectUrl) {
      img.crossOrigin = 'anonymous';
    }

    const cleanup = () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          cleanup();
          resolve(fallback());
          return;
        }

        ctx.drawImage(img, 0, 0, 32, 32);
        const data = ctx.getImageData(0, 0, 32, 32).data;
        cleanup();

        let totalR = 0;
        let totalG = 0;
        let totalB = 0;
        let count = 0;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];

          if (a < 128) continue;

          // Perceived brightness
          const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
          // Avoid pure whites and pure blacks
          if (brightness > 20 && brightness < 240) {
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            const saturation = max === 0 ? 0 : (max - min) / max;

            // Extra weight to rich, colorful pixels
            const weight = 1 + saturation * 3;
            totalR += r * weight;
            totalG += g * weight;
            totalB += b * weight;
            count += weight;
          }
        }

        if (count > 0) {
          const dominant: [number, number, number] = [
            Math.round(totalR / count),
            Math.round(totalG / count),
            Math.round(totalB / count),
          ];
          colorCache.set(cacheKey, dominant);
          resolve(dominant);
        } else {
          resolve(fallback());
        }
      } catch {
        cleanup();
        resolve(fallback());
      }
    };

    img.onerror = () => {
      cleanup();
      resolve(fallback());
    };

    img.src = resolvedUrl;
  });
}
