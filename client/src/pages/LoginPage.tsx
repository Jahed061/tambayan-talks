import React, { useMemo, useState } from 'react';
import type { CurrentUserDTO } from '../api/http';
import { updateProfile } from '../api/http';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { useToast } from '../ui/toast';

type Props = {
  /** Can be null briefly while App is bootstrapping. */
  user: CurrentUserDTO | null;
  /** Called after successful username update. */
  onProfileUpdated: (user: CurrentUserDTO) => void;
};

// Username rules (simple + mobile-friendly):
// - 3–20 chars
// - letters, numbers, underscore
// - must start with a letter
const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{2,19}$/;

export default function LoginPage({ user, onProfileUpdated }: Props) {
  const toast = useToast();
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const helper = useMemo(
    () => '3–20 chars. Start with a letter. Use letters, numbers, underscore.',
    [],
  );

  const canSubmit = useMemo(() => USERNAME_RE.test(username.trim()), [username]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const name = username.trim();
    if (!USERNAME_RE.test(name)) {
      setError(helper);
      return;
    }
    setLoading(true);
    try {
      const updated = await updateProfile({ displayName: name });
      toast.success('Username saved');
      onProfileUpdated(updated);
    } catch (err: any) {
      const msg = String(err?.message || 'Failed to save username');
      // Server returns JSON text sometimes; try parse.
      try {
        const parsed = JSON.parse(msg);
        if (parsed?.error) {
          setError(String(parsed.error));
        } else {
          setError(msg);
        }
      } catch {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="tt-auth-shell">
      <div className="tt-auth-card tt-card">
        <div className="tt-card-pad">
          <div className="tt-auth-head">
            <div className="tt-auth-brand" aria-label="Tambayan Talks">
              <span className="tt-brand-mark">TT</span>
              <div style={{ display: 'grid', gap: 2 }}>
                <h1 className="tt-auth-title">Tambayan Talks</h1>
                <p className="tt-subtitle">Choose a username to continue.</p>
              </div>
            </div>
          </div>

          {user?.email?.endsWith('@guest.local') && (
            <div className="tt-alert" style={{ marginBottom: 14 }}>
              You’re logged in as a guest. Pick a unique username.
            </div>
          )}

          {error && (
            <div className="tt-alert tt-alert-error" style={{ marginBottom: 14 }}>
              {error}
            </div>
          )}

          <form onSubmit={submit} className="tt-form">
            <div className="tt-field">
              <label className="tt-label" htmlFor="username">Username</label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="e.g. demoStudent"
                required
              />
              <div className="tt-help" style={{ marginTop: 6 }}>{helper}</div>
            </div>

            <Button type="submit" loading={loading} className="w-full" disabled={!canSubmit}>
              Continue
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
