import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ALL_EMOJIS, EMOJI_CATEGORIES } from './emojiData';
import {
  type CustomEmoji,
  customEmojiUrlForToken,
  isCustomToken,
  saveCustomEmojis,
  toCustomToken,
} from './customEmojis';

export type EmojiPickerProps = {
  onPick: (emoji: string) => void;
  customEmojis: CustomEmoji[];
  setCustomEmojis: (next: CustomEmoji[]) => void;
  title?: string;
};

export default function EmojiPicker({ onPick, customEmojis, setCustomEmojis, title }: EmojiPickerProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'emoji' | 'custom'>('emoji');
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click / escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (popoverRef.current && !popoverRef.current.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ALL_EMOJIS;
    // crude search: match unicode name isn't available; match against custom token etc.
    return ALL_EMOJIS.filter((e) => e.includes(q));
  }, [query]);

  const addCustom = () => {
    const name = newName.trim().replace(/^:+|:+$/g, '');
    const url = newUrl.trim();
    if (!name || !url) return;
    if (!/^[a-zA-Z0-9_\-]{1,32}$/.test(name)) return;
    const next = [...customEmojis.filter((c) => c.name.toLowerCase() !== name.toLowerCase()), { name, url }];
    setCustomEmojis(next);
    saveCustomEmojis(next);
    setNewName('');
    setNewUrl('');
  };

  const removeCustom = (name: string) => {
    const next = customEmojis.filter((c) => c.name !== name);
    setCustomEmojis(next);
    saveCustomEmojis(next);
  };

  const pick = (emoji: string) => {
    onPick(emoji);
    setOpen(false);
  };

  return (
    <div style={{ position: 'relative', display: 'inline-block' }} ref={popoverRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        title={title ?? 'Add reaction'}
        style={{
          border: 'none',
          cursor: 'pointer',
          padding: '0.15rem 0.45rem',
          borderRadius: 999,
          background: 'rgba(17, 24, 39, 0.08)',
          fontSize: 12,
          fontWeight: 900,
        }}
      >
        ＋
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            zIndex: 20,
            bottom: '120%',
            left: 0,
            width: 320,
            maxWidth: '80vw',
            border: '1px solid #e5e7eb',
            borderRadius: 12,
            background: '#fff',
            boxShadow: '0 12px 30px rgba(0,0,0,0.12)',
            padding: 10,
          }}
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <button
              onClick={() => setTab('emoji')}
              style={{
                border: 'none',
                cursor: 'pointer',
                padding: '0.25rem 0.55rem',
                borderRadius: 999,
                background: tab === 'emoji' ? '#2563eb' : '#e5e7eb',
                color: tab === 'emoji' ? '#fff' : '#111827',
                fontSize: 12,
                fontWeight: 800,
              }}
            >
              Emoji
            </button>
            <button
              onClick={() => setTab('custom')}
              style={{
                border: 'none',
                cursor: 'pointer',
                padding: '0.25rem 0.55rem',
                borderRadius: 999,
                background: tab === 'custom' ? '#2563eb' : '#e5e7eb',
                color: tab === 'custom' ? '#fff' : '#111827',
                fontSize: 12,
                fontWeight: 800,
              }}
            >
              Custom
            </button>

            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tab === 'emoji' ? 'Filter (optional)…' : 'Search name…'}
              style={{
                marginLeft: 'auto',
                padding: '0.25rem 0.5rem',
                borderRadius: 10,
                border: '1px solid #d1d5db',
                fontSize: 12,
                width: 140,
              }}
            />
          </div>

          {tab === 'emoji' ? (
            <div style={{ maxHeight: 240, overflow: 'auto' }}>
              {query.trim() ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 6 }}>
                  {filtered.slice(0, 96).map((e) => (
                    <button
                      key={e}
                      onClick={() => pick(e)}
                      style={{ border: 'none', background: '#f3f4f6', borderRadius: 10, padding: 6, cursor: 'pointer' }}
                      title={e}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 10 }}>
                  {EMOJI_CATEGORIES.map((cat) => (
                    <div key={cat.label}>
                      <div style={{ fontSize: 12, fontWeight: 900, color: '#374151', marginBottom: 6 }}>
                        {cat.label}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 6 }}>
                        {cat.emojis.map((e) => (
                          <button
                            key={e}
                            onClick={() => pick(e)}
                            style={{
                              border: 'none',
                              background: '#f3f4f6',
                              borderRadius: 10,
                              padding: 6,
                              cursor: 'pointer',
                            }}
                            title={e}
                          >
                            {e}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div style={{ maxHeight: 240, overflow: 'auto', display: 'grid', gap: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, alignItems: 'center' }}>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="name (e.g. party_parrot)"
                  style={{ padding: '0.25rem 0.5rem', borderRadius: 10, border: '1px solid #d1d5db', fontSize: 12 }}
                />
                <input
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  placeholder="image URL"
                  style={{ padding: '0.25rem 0.5rem', borderRadius: 10, border: '1px solid #d1d5db', fontSize: 12 }}
                />
                <button
                  onClick={addCustom}
                  style={{
                    border: 'none',
                    cursor: 'pointer',
                    padding: '0.25rem 0.55rem',
                    borderRadius: 10,
                    background: '#2563eb',
                    color: '#fff',
                    fontSize: 12,
                    fontWeight: 900,
                  }}
                >
                  Add
                </button>
              </div>

              {customEmojis.length === 0 ? (
                <div style={{ fontSize: 12, color: '#6b7280' }}>
                  No custom emojis yet. Add one above, then react with <b>{toCustomToken('your_name')}</b>.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
                  {customEmojis
                    .filter((c) => (!query.trim() ? true : c.name.toLowerCase().includes(query.trim().toLowerCase())))
                    .slice(0, 60)
                    .map((c) => {
                      const token = toCustomToken(c.name);
                      const url = customEmojiUrlForToken(token, customEmojis);
                      return (
                        <div key={c.name} style={{ display: 'grid', gap: 4, justifyItems: 'center' }}>
                          <button
                            onClick={() => pick(token)}
                            style={{
                              border: 'none',
                              background: '#f3f4f6',
                              borderRadius: 12,
                              padding: 6,
                              cursor: 'pointer',
                              width: '100%',
                              display: 'grid',
                              placeItems: 'center',
                            }}
                            title={token}
                          >
                            {url ? (
                              <img src={url} alt={token} style={{ width: 22, height: 22, objectFit: 'contain' }} />
                            ) : (
                              token
                            )}
                          </button>
                          <div style={{ fontSize: 10, color: '#6b7280', textAlign: 'center' }}>{c.name}</div>
                          <button
                            onClick={() => removeCustom(c.name)}
                            style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 10, color: '#991b1b' }}
                            title="Remove"
                          >
                            Remove
                          </button>
                        </div>
                      );
                    })}
                </div>
              )}

              <div style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.35 }}>
                Tip: custom reactions use the token{' '}
                <code style={{ background: '#f3f4f6', padding: '1px 4px', borderRadius: 6 }}>:name:</code>.
                {isCustomToken(':party_parrot:') ? null : null}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
