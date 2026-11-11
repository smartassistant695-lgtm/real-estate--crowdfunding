/**
 * next/image loader. Unsplash's CDN resizes and re-encodes on request, so we ask it for exactly
 * the width the browser needs (AVIF/WebP via auto=format) instead of proxying through the app.
 */
export default function imageLoader({ src, width, quality }: { src: string; width: number; quality?: number }): string {
  if (src.startsWith("https://images.unsplash.com/")) {
    const base = src.split("?")[0];
    return `${base}?auto=format&fit=crop&w=${width}&q=${quality ?? 70}`;
  }
  return src;
}
