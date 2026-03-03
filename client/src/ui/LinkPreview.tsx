import React, { useEffect, useMemo, useState } from 'react';
import { linkPreview, type LinkPreviewDTO } from '../api/http';

// Very small cache to avoid refetching the same URL repeatedly.
const cache = new Map<string, { atMs: number; value: LinkPreviewDTO }>();
const CACHE_TTL_MS = 10 * 60 * 1000;

function extractUrls(text: string): string[] {
  // Find http/https URLs.
  const re = /https?:\/\/[^\s<>()]+/gi;
  const out: string[] = [];
  const seen = new Set<string>();

  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    let url = m[0];
    // Trim common trailing punctuation
    url = url.replace(/[),.;!?]+$/g, '');
    if (!seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
    // avoid UI spam; also avoids rate-limiting
    if (out.length >= 4) break;
  }
  return out;
}

export default function LinkPreview({ text, inverted }: { text: string; inverted?: boolean }) {
  const urls = useMemo(() => extractUrls(text), [text]);
  const [previews, setPreviews] = useState<Record<string, LinkPreviewDTO | null>>({});
  const [loadingByUrl, setLoadingByUrl] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;

    // When text changes, prune old previews/loads.
    setPreviews((prev) => {
      const next: Record<string, LinkPreviewDTO | null> = {};
      for (const u of urls) if (u in prev) next[u] = prev[u];
      return next;
    });
    setLoadingByUrl((prev) => {
      const next: Record<string, boolean> = {};
      for (const u of urls) if (u in prev) next[u] = prev[u];
      return next;
    });

    (async () => {
      for (const url of urls) {
        // cached?
        const cached = cache.get(url);
        if (cached && Date.now() - cached.atMs < CACHE_TTL_MS) {
          if (cancelled) return;
          setPreviews((prev) => ({ ...prev, [url]: cached.value }));
          continue;
        }

        // already loaded?
        if (previews[url] !== undefined) continue;

        try {
          if (cancelled) return;
          setLoadingByUrl((prev) => ({ ...prev, [url]: true }));
          const p = await linkPreview(url);
          if (cancelled) return;
          cache.set(url, { atMs: Date.now(), value: p });
          setPreviews((prev) => ({ ...prev, [url]: p }));
        } catch {
          if (cancelled) return;
          setPreviews((prev) => ({ ...prev, [url]: null }));
        } finally {
          if (cancelled) return;
          setLoadingByUrl((prev) => ({ ...prev, [url]: false }));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urls.join('|')]);

  if (!urls.length) return null;

  const cards = urls
    .map((url) => {
      const data = previews[url];
      const loading = Boolean(loadingByUrl[url]);

      if (data && !data.title && !data.description && !data.imageUrl) return null;
      if (data === null) return null;

      let host = '';
      try {
        host = new URL(data?.url ?? url).hostname;
      } catch {
        host = url;
      }

      const frameBorder = inverted ? '1px solid rgba(255,255,255,0.28)' : '1px solid var(--tt-border)';
      const frameBg = inverted ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.72)';
      const textMuted = inverted ? 'rgba(255,255,255,0.82)' : 'var(--tt-muted)';
      const textStrong = inverted ? 'rgba(255,255,255,0.96)' : 'var(--tt-text)';
      const textBody = inverted ? 'rgba(255,255,255,0.90)' : 'rgba(15, 23, 42, 0.78)';

      return (
        <a
          key={url}
          href={data?.url ?? url}
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'flex',
            gap: 12,
            marginTop: 10,
            textDecoration: 'none',
            border: frameBorder,
            borderRadius: 16,
            overflow: 'hidden',
            background: frameBg,
            boxShadow: inverted ? undefined : '0 12px 28px rgba(15, 23, 42, 0.08)',
            backdropFilter: 'blur(8px)',
          }}
          title={data?.url ?? url}
        >
          {data?.imageUrl ? (
            <img
              src={data.imageUrl}
              alt=""
              style={{
                width: 132,
                height: 88,
                objectFit: 'cover',
                flex: '0 0 auto',
                background: inverted ? 'rgba(255,255,255,0.10)' : '#eef2ff',
              }}
            />
          ) : (
            <div
              style={{
                width: 132,
                height: 88,
                background: inverted ? 'rgba(255,255,255,0.10)' : '#eef2ff',
                flex: '0 0 auto',
              }}
            />
          )}

          <div style={{ padding: '0.6rem 0.75rem', minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 12,
                color: textMuted,
                fontWeight: 800,
                marginBottom: 6,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {data?.siteName ?? host}
              </span>
              {loading && <span style={{ fontWeight: 700 }}>Loading…</span>}
            </div>

            {data?.title && (
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 900,
                  color: textStrong,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  marginBottom: data.description ? 4 : 0,
                }}
              >
                {data.title}
              </div>
            )}

            {data?.description && (
              <div
                style={{
                  fontSize: 12,
                  color: textBody,
                  overflow: 'hidden',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                }}
              >
                {data.description}
              </div>
            )}
          </div>
        </a>
      );
    })
    .filter(Boolean);

  if (cards.length === 0) return null;

  return <div>{cards}</div>;
}
