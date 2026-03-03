/*
  Lightweight OpenGraph/Twitter card preview fetcher.

  - No extra deps (uses Node's built-in fetch)
  - Basic SSRF guard (blocks localhost + private IP ranges)
  - Caches results in-memory for a short TTL
*/

export type LinkPreview = {
  url: string; // normalized final URL
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { atMs: number; value: LinkPreview }>();

function isPrivateHost(hostname: string) {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '0.0.0.0' || h === '::1') return true;
  if (/^127\./.test(h)) return true;

  // If hostname is an IPv4, block RFC1918 + link-local.
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
  }

  return false;
}

function pickFirst(...vals: Array<string | null | undefined>) {
  for (const v of vals) {
    const s = typeof v === 'string' ? v.trim() : '';
    if (s) return s;
  }
  return null;
}

function truncate(s: string | null, max: number) {
  if (!s) return null;
  const t = s.trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

function getMeta(html: string, attr: 'property' | 'name', key: string): string | null {
  const re = new RegExp(
    `<meta[^>]+${attr}=["']${escapeRegExp(key)}["'][^>]+content=["']([^"']+)["'][^>]*>`
      .replace(/\s+/g, '\\s*'),
    'i',
  );
  const m = html.match(re);
  return m?.[1] ? decodeHtml(m[1]) : null;
}

function getTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]{1,512})<\/title>/i);
  return m?.[1] ? decodeHtml(m[1]) : null;
}

function decodeHtml(s: string) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolveMaybeRelativeUrl(baseUrl: string, maybe: string | null): string | null {
  if (!maybe) return null;
  const raw = maybe.trim();
  if (!raw) return null;

  try {
    // URL() will resolve relative to base.
    const u = new URL(raw, baseUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

export async function fetchLinkPreview(inputUrl: string): Promise<LinkPreview> {
  const key = String(inputUrl || '').trim();
  if (!key) throw new Error('Missing url');

  const cached = cache.get(key);
  if (cached && Date.now() - cached.atMs < CACHE_TTL_MS) return cached.value;

  let url: URL;
  try {
    url = new URL(key);
  } catch {
    throw new Error('Invalid url');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http/https allowed');
  if (isPrivateHost(url.hostname)) throw new Error('Blocked host');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'TambayanTalksLinkPreview/1.0',
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    const contentType = String(res.headers.get('content-type') || '').toLowerCase();
    const finalUrl = res.url || url.toString();

    // Non-HTML: return minimal.
    if (!contentType.includes('text/html')) {
      const out: LinkPreview = {
        url: finalUrl,
        title: null,
        description: null,
        imageUrl: null,
        siteName: null,
      };
      cache.set(key, { atMs: Date.now(), value: out });
      return out;
    }

    // Limit read size.
    const text = (await res.text()).slice(0, 220_000);

    const ogTitle = getMeta(text, 'property', 'og:title');
    const twTitle = getMeta(text, 'name', 'twitter:title');
    const titleTag = getTitle(text);

    const ogDesc = getMeta(text, 'property', 'og:description');
    const twDesc = getMeta(text, 'name', 'twitter:description');
    const metaDesc = getMeta(text, 'name', 'description');

    const ogImg = getMeta(text, 'property', 'og:image');
    const twImg = getMeta(text, 'name', 'twitter:image');

    const ogSite = getMeta(text, 'property', 'og:site_name');
    const siteName = pickFirst(ogSite, new URL(finalUrl).hostname);

    const out: LinkPreview = {
      url: finalUrl,
      title: truncate(pickFirst(ogTitle, twTitle, titleTag), 140),
      description: truncate(pickFirst(ogDesc, twDesc, metaDesc), 240),
      imageUrl: resolveMaybeRelativeUrl(finalUrl, pickFirst(ogImg, twImg)),
      siteName: truncate(siteName, 80),
    };

    cache.set(key, { atMs: Date.now(), value: out });
    return out;
  } finally {
    clearTimeout(timeout);
  }
}
