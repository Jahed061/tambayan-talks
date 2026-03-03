import React, { useEffect, useMemo, useState } from 'react';
import { verifyEmail } from '../api/http';
import { Button } from '../ui/Button';
import { useToast } from '../ui/toast';

function getTokenFromHash(): string | null {
  const hash = window.location.hash || '';
  const q = hash.includes('?') ? hash.split('?')[1] : '';
  const params = new URLSearchParams(q);
  return params.get('token');
}

type Props = { onBackToLogin: () => void };

export default function VerifyEmailPage({ onBackToLogin }: Props) {
  const token = useMemo(() => getTokenFromHash(), []);
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState<string>('');
  const toast = useToast();

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('Missing token in link.');
      return;
    }

    verifyEmail(token)
      .then(() => {
        setStatus('success');
        const m = 'Email verified! You can now sign in.';
        setMessage(m);
        toast.success(m);
      })
      .catch((err: any) => {
        const msg = String(err?.message || 'Verification failed');
        try {
          const parsed = JSON.parse(msg);
          setMessage(parsed?.error || msg);
        } catch {
          setMessage(msg);
        }
        // Use local msg instead of stale state
        toast.error((() => {
          try {
            const parsed = JSON.parse(msg);
            return parsed?.error || msg;
          } catch {
            return msg;
          }
        })());
        setStatus('error');
      });
  }, [token, toast]);

  return (
    <div className="tt-auth-shell">
      <div className="tt-auth-card tt-card">
        <div className="tt-card-pad">
          <div className="tt-auth-head">
            <div className="tt-auth-brand">
              <span className="tt-brand-mark">TT</span>
              <div style={{ display: 'grid', gap: 2 }}>
                <h1 className="tt-auth-title">Verify email</h1>
                <p className="tt-subtitle">{status === 'loading' ? 'Verifying your email…' : message}</p>
              </div>
            </div>
          </div>

          <Button
            onClick={() => {
              window.location.hash = '';
              onBackToLogin();
            }}
            className="w-full"
          >
            Back to sign in
          </Button>
        </div>
      </div>
    </div>
  );
}
