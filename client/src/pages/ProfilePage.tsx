import React, { useEffect, useMemo, useState } from 'react';
import { getProfile, updateProfile, type ProfileDTO, uploadAttachments } from '../api/http';

type Props = {
  onProfileUpdated: (next: { displayName: string; avatarUrl: string | null }) => void;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? '?';
  const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (a + b).toUpperCase();
}

export default function ProfilePage({ onProfileUpdated }: Props) {
  const [profile, setProfile] = useState<ProfileDTO | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    getProfile()
      .then((p) => {
        setProfile(p);
        setDisplayName(p.displayName ?? '');
        setAvatarUrl(p.avatarUrl ?? null);
      })
      .catch((e) => setError(String(e?.message || 'Failed to load profile')));
  }, []);

  const canSave = useMemo(() => {
    const name = displayName.trim();
    if (name.length < 2 || name.length > 60) return false;
    return true;
  }, [displayName]);

  const handleAvatarPick = async (file: File) => {
    setUploading(true);
    setError(null);
    setStatus(null);
    try {
      const atts = await uploadAttachments([file]);
      const first = atts[0];
      if (!first || first.kind !== 'IMAGE') throw new Error('Please upload an image file');
      setAvatarUrl(first.url);
      setStatus('Avatar uploaded (remember to click Save)');
    } catch (e: any) {
      setError(String(e?.message || 'Upload failed'));
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const updated = await updateProfile({ displayName: displayName.trim(), avatarUrl });
      setProfile(updated);
      setDisplayName(updated.displayName);
      setAvatarUrl(updated.avatarUrl ?? null);
      setStatus('Profile saved');
      onProfileUpdated({ displayName: updated.displayName, avatarUrl: updated.avatarUrl ?? null });
    } catch (e: any) {
      setError(String(e?.message || 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="tt-page-scroll">
      <div className="tt-container py-6" style={{ maxWidth: 760 }}>
        <div className="tt-page-header">
          <h1 className="tt-h1">Profile</h1>
          <p className="tt-subtitle">Update your display name and avatar.</p>
        </div>

        {error && <div className="tt-alert tt-alert-error" style={{ marginBottom: 12 }}>{error}</div>}

        {status && <div className="tt-alert tt-alert-success" style={{ marginBottom: 12 }}>{status}</div>}

        <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-4 items-start">
        <div className="tt-card tt-card-pad">
          <div
            style={{
              width: 120,
              height: 120,
              borderRadius: 999,
              overflow: 'hidden',
              background: '#f3f4f6',
              display: 'grid',
              placeItems: 'center',
              margin: '0 auto',
            }}
            title={profile?.email ?? ''}
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div style={{ fontSize: 28, fontWeight: 900, color: '#111827' }}>
                {initials(displayName || profile?.displayName || '?')}
              </div>
            )}
          </div>

          <div style={{ marginTop: 10 }}>
            <label className="tt-label">Avatar image</label>
            <input
              type="file"
              accept="image/*"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleAvatarPick(f);
                e.currentTarget.value = '';
              }}
            />

            <button
              type="button"
              onClick={() => setAvatarUrl(null)}
              className="tt-btn tt-btn-ghost"
              style={{ marginTop: 10, width: '100%' }}
            >
              Remove avatar
            </button>
          </div>
        </div>

        <div className="tt-card tt-card-pad">
          <div className="tt-field">
            <label className="tt-label" htmlFor="profile-display">Display name</label>
          <input
            id="profile-display"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Your name"
            className="tt-input"
          />
            <div className="tt-help">2–60 characters. This appears in chats.</div>
          </div>

          <div className="mt-4 flex flex-wrap gap-3 items-center">
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave || saving || uploading}
              className="tt-btn tt-btn-primary"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>

            <div className="tt-help">
              {profile ? (
                <span>
                  Signed in as <b>{profile.email}</b> ({profile.role})
                </span>
              ) : (
                'Loading…'
              )}
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
