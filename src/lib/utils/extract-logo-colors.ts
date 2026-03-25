/**
 * Extract dominant colors from a logo image URL using canvas sampling.
 * Returns up to 5 hex colors, excluding near-white and near-black.
 * Gracefully returns empty array on CORS or load errors.
 */

interface ColorBucket {
  r: number;
  g: number;
  b: number;
  count: number;
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function colorDistance(a: ColorBucket, b: ColorBucket): number {
  return Math.sqrt(
    (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2
  );
}

function isNearWhiteOrBlack(r: number, g: number, b: number): boolean {
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 220 || luminance < 35;
}

function isNearGray(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  // Low saturation = gray
  return (max - min) < 30;
}

export async function extractLogoColors(
  imageUrl: string,
  maxColors: number = 5
): Promise<string[]> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    const timeout = setTimeout(() => resolve([]), 5000);

    img.onload = () => {
      clearTimeout(timeout);
      try {
        const canvas = document.createElement("canvas");
        const size = 64; // Sample at low resolution for speed
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve([]); return; }

        ctx.drawImage(img, 0, 0, size, size);
        const imageData = ctx.getImageData(0, 0, size, size);
        const data = imageData.data;

        // Collect color samples, skipping transparent and near-white/black pixels
        const buckets: ColorBucket[] = [];
        const minDistForNewBucket = 45;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];

          // Skip transparent, near-white/black, and gray pixels
          if (a < 128) continue;
          if (isNearWhiteOrBlack(r, g, b)) continue;
          if (isNearGray(r, g, b)) continue;

          const pixel: ColorBucket = { r, g, b, count: 1 };

          // Find nearest existing bucket
          let merged = false;
          for (const bucket of buckets) {
            if (colorDistance(pixel, bucket) < minDistForNewBucket) {
              // Weighted average toward the bucket
              const total = bucket.count + 1;
              bucket.r = Math.round((bucket.r * bucket.count + r) / total);
              bucket.g = Math.round((bucket.g * bucket.count + g) / total);
              bucket.b = Math.round((bucket.b * bucket.count + b) / total);
              bucket.count = total;
              merged = true;
              break;
            }
          }
          if (!merged) {
            buckets.push(pixel);
          }
        }

        // Sort by frequency, take top N
        buckets.sort((a, b) => b.count - a.count);
        const result = buckets
          .slice(0, maxColors)
          .filter((b) => b.count >= 3) // Minimum pixel threshold
          .map((b) => rgbToHex(b.r, b.g, b.b));

        resolve(result);
      } catch {
        resolve([]);
      }
    };

    img.onerror = () => {
      clearTimeout(timeout);
      resolve([]);
    };

    img.src = imageUrl;
  });
}
