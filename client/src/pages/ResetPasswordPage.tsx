import React, { useMemo, useState } from 'react';
import { resetPassword } from '../api/http';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { useToast } from '../ui/toast';

function getTokenFromHash(): string | null {
  const hash = window.location.hash || '';
  const q = hash.includes('?') ? hash.split('?')[1] : '';
  const params = new URLSearchParams(q);
  return params.get('token');
}

type Props = { onBackToLogin: () => void };

export default function ResetPasswordPage({ onBackToLogin }: Props) {
  const token = useMemo(() => getTokenFromHash(), []);
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!token) {
      setError('Missing reset token. Please use the link from your email.');
      return;
    }

    if (newPassword.trim().length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    if (newPassword !== confirm) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      await resetPassword(token, newPassword);
      const m = 'Password updated! You can now sign in.';
      setSuccess(m);
      toast.success(m);
    } catch (err: any) {
      const msg = String(err?.message || 'Reset failed');
      try {
        const parsed = JSON.parse(msg);
        setError(parsed?.error || msg);
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
            <div className="tt-auth-brand">
              <span className="tt-brand-mark">TT</span>
              <div style={{ display: 'grid', gap: 2 }}>
                <h1 className="tt-auth-title">Reset password</h1>
                <p className="tt-subtitle">Enter a new password.</p>
              </div>
            </div>
          </div>

          {success && <div className="tt-alert tt-alert-success" style={{ marginBottom: 14 }}>{success}</div>}
          {error && <div className="tt-alert tt-alert-error" style={{ marginBottom: 14 }}>{error}</div>}

          <form onSubmit={handleSubmit} className="tt-form">
            <div className="tt-field">
              <label className="tt-label" htmlFor="reset-new">New password</label>
              <Input
                id="reset-new"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                type="password"
                required
                minLength={6}
                placeholder="Create a new password"
              />
            </div>

            <div className="tt-field">
              <label className="tt-label" htmlFor="reset-confirm">Confirm password</label>
              <Input
                id="reset-confirm"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                type="password"
                required
                minLength={6}
                placeholder="Repeat password"
              />
            </div>

            <Button type="submit" loading={loading} className="w-full" style={{ marginTop: 4 }}>
              Update password
            </Button>

            <Button type="button" onClick={onBackToLogin} variant="link" className="mt-2">
              Back to sign in
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
