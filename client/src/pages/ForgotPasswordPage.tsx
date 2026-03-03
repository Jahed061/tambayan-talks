import React, { useState } from 'react';
import { forgotPassword } from '../api/http';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { useToast } from '../ui/toast';

type Props = { onBackToLogin: () => void };

export default function ForgotPasswordPage({ onBackToLogin }: Props) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      await forgotPassword(email);
      const m = 'If that email exists, a reset link was sent. Please check your inbox.';
      setSuccess(m);
      toast.success(m);
    } catch (err: any) {
      const msg = String(err?.message || 'Request failed');
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
                <h1 className="tt-auth-title">Forgot password</h1>
                <p className="tt-subtitle">Enter your email to receive a password reset link.</p>
              </div>
            </div>
          </div>

          {success && <div className="tt-alert tt-alert-success" style={{ marginBottom: 14 }}>{success}</div>}
          {error && <div className="tt-alert tt-alert-error" style={{ marginBottom: 14 }}>{error}</div>}

          <form onSubmit={handleSubmit} className="tt-form">
            <div className="tt-field">
              <label className="tt-label" htmlFor="forgot-email">Email</label>
              <Input
                id="forgot-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                required
                placeholder="you@example.com"
              />
            </div>

            <Button type="submit" loading={loading} className="w-full" style={{ marginTop: 4 }}>
              Send reset link
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
