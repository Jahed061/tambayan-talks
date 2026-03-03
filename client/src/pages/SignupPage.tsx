import React, { useMemo, useState } from 'react';
import { signup, type CurrentUserDTO, type SignupResponse } from '../api/http';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { useToast } from '../ui/toast';

type Props = {
  onSignupSuccess: (user: CurrentUserDTO, token: string) => void;
  onBackToLogin: () => void;
};

export default function SignUpPage({ onSignupSuccess, onBackToLogin }: Props) {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'STUDENT' | 'TEACHER'>('STUDENT');
  const [adminKey, setAdminKey] = useState('');

  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  const isTeacher = role === 'TEACHER';

  const roleHint = useMemo(() => {
    if (role === 'STUDENT') return 'Students can create accounts anytime.';
    return 'Teacher accounts are admin-only. Enter the admin key (or ask an admin to create your teacher account).';
  }, [role]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setLoading(true);

    try {
      const res: SignupResponse = await signup(email, password, displayName || undefined, role, adminKey || undefined);

      if ('token' in res) {
        onSignupSuccess(res.user, res.token);
        return;
      }

      // Email verification required
      const m = 'Account created! Please check your email to verify your address, then sign in.';
      setSuccessMsg(m);
      toast.success(m);
    } catch (err: any) {
      const msg = String(err?.message || 'Signup failed');
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
                <h1 className="tt-auth-title">Create account</h1>
                <p className="tt-subtitle">Sign up to start chatting.</p>
              </div>
            </div>
          </div>

          {successMsg && <div className="tt-alert tt-alert-success" style={{ marginBottom: 14 }}>{successMsg}</div>}
          {error && <div className="tt-alert tt-alert-error" style={{ marginBottom: 14 }}>{error}</div>}

          <form onSubmit={handleSubmit} className="tt-form">
            <div className="tt-field">
              <label className="tt-label" htmlFor="signup-role">I am a…</label>
              <select id="signup-role" value={role} onChange={(e) => setRole(e.target.value as any)} className="tt-select">
                <option value="STUDENT">Student</option>
                <option value="TEACHER">Teacher (admin-only)</option>
              </select>
              <div className="tt-help">{roleHint}</div>
            </div>

            {isTeacher && (
              <div className="tt-field">
                <label className="tt-label" htmlFor="signup-admin">Admin key (required for Teacher)</label>
                <Input
                  id="signup-admin"
                  value={adminKey}
                  onChange={(e) => setAdminKey(e.target.value)}
                  placeholder="Ask your admin for the key"
                />
              </div>
            )}

            <div className="tt-field">
              <label className="tt-label" htmlFor="signup-name">Display name</label>
              <Input
                id="signup-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Mojayhid"
              />
            </div>

            <div className="tt-field">
              <label className="tt-label" htmlFor="signup-email">Email</label>
              <Input
                id="signup-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                required
                placeholder="you@example.com"
              />
            </div>

            <div className="tt-field">
              <label className="tt-label" htmlFor="signup-password">Password (min 6 chars)</label>
              <Input
                id="signup-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                required
                minLength={6}
                placeholder="Create a password"
              />
            </div>

            <Button type="submit" loading={loading} className="w-full" style={{ marginTop: 4 }}>
              Create account
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
