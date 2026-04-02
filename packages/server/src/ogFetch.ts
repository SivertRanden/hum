export interface LinkPreview {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
}

const URL_RE = /https?:\/\/[^\s<>"']+/g;
const FETCH_TIMEOUT_MS = 5_000;
const MAX_BODY_BYTES = 200_000;

export function extractUrls(content: string): string[] {
  const matches = content.match(URL_RE) ?? [];
  // Deduplicate and limit to 3 per message
  return [...new Set(matches)].slice(0, 3);
}

function extractMeta(html: string, property: string): string | undefined {
  // og:property or name= variants
  const ogMatch = html.match(new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']*)["']`, 'i'))
    ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${property}["']`, 'i'));
  if (ogMatch) return ogMatch[1];
  return undefined;
}

function extractTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m ? m[1].trim() : undefined;
}

export async function fetchLinkPreview(url: string): Promise<LinkPreview | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'HumBot/1.0 (link preview)' },
        redirect: 'follow',
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html')) return null;

    // Stream up to MAX_BODY_BYTES to avoid downloading huge pages
    const reader = response.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      totalBytes += value.byteLength;
      if (totalBytes >= MAX_BODY_BYTES) break;
    }
    reader.cancel().catch(() => {});
    const html = new TextDecoder().decode(
      chunks.reduce((acc, c) => {
        const merged = new Uint8Array(acc.length + c.length);
        merged.set(acc);
        merged.set(c, acc.length);
        return merged;
      }, new Uint8Array(0))
    );

    const title = extractMeta(html, 'og:title') ?? extractTitle(html);
    const description = extractMeta(html, 'og:description')
      ?? extractMeta(html, 'description');
    const image = extractMeta(html, 'og:image');
    const siteName = extractMeta(html, 'og:site_name');

    if (!title && !description && !image) return null;

    const preview: LinkPreview = { url };
    if (title) preview.title = title.slice(0, 200);
    if (description) preview.description = description.slice(0, 400);
    if (image) preview.image = image;
    if (siteName) preview.siteName = siteName.slice(0, 100);

    return preview;
  } catch {
    return null;
  }
}
