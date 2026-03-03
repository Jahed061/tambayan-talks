import React from 'react';

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('');
}

export function AvatarDot({
  name,
  src,
  size = 22,
  ring,
}: {
  name: string;
  src?: string | null;
  size?: number;
  /** Optional ring color (e.g. online indicator) */
  ring?: string | null;
}) {
  const [broken, setBroken] = React.useState(false);
  const showImage = Boolean(src) && !broken;

  return (
    <div
      title={name}
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        display: 'grid',
        placeItems: 'center',
        fontSize: Math.max(10, Math.floor(size * 0.45)),
        fontWeight: 900,
        background: 'rgba(15, 23, 42, 0.06)',
        color: 'var(--tt-text)',
        border: ring ? `2px solid ${ring}` : '1px solid var(--tt-border)',
        boxShadow: ring ? '0 0 0 4px rgba(34, 197, 94, 0.12)' : undefined,
        flex: '0 0 auto',
        overflow: 'hidden',
      }}
    >
      {showImage ? (
        <img
          src={src!}
          alt={name}
          onError={() => setBroken(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        initials(name)
      )}
    </div>
  );
}

type AvatarUser =
  | { name: string; src?: string | null }
  | { displayName: string; avatarUrl?: string | null };

function normalizeUser(u: AvatarUser): { name: string; src: string | null } {
  if ('displayName' in u) return { name: u.displayName, src: u.avatarUrl ?? null };
  return { name: u.name, src: u.src ?? null };
}

export function AvatarStack({
  users,
  size = 22,
}: {
  users: AvatarUser[];
  size?: number;
}) {
  const shown = users.slice(0, 5).map(normalizeUser);

  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {shown.map((u, i) => (
        <div key={`${u.name}-${i}`} style={{ marginLeft: i === 0 ? 0 : -8 }}>
          <AvatarDot name={u.name} src={u.src} size={size} />
        </div>
      ))}
    </div>
  );
}

export function highlight(text: string, query: string) {
  const q = query.trim();
  if (!q) return text;

  const re = new RegExp(`(${escapeRegExp(q)})`, 'ig');
  const parts = text.split(re);

  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark
            key={i}
            style={{
              padding: '0 2px',
              borderRadius: 6,
              background: 'rgba(255, 79, 216, 0.22)',
            }}
          >
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
