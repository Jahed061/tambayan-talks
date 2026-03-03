import React from 'react';

function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="tt-login-wrap">
      <div className="tt-login-card">
        <div className="tt-login-header">
          <div className="tt-login-title">Tambayan Talks</div>
          <div className="tt-login-subtitle">A lightweight chat space for your community.</div>
        </div>

        {children}

        <div style={{ marginTop: 18, fontSize: 12, color: 'rgba(15,23,42,0.65)', lineHeight: 1.6 }}>
          <a href="#privacy" style={{ color: 'inherit', textDecoration: 'underline', marginRight: 12 }}>Privacy</a>
          <a href="#terms" style={{ color: 'inherit', textDecoration: 'underline', marginRight: 12 }}>Terms</a>
          <a href="#contact" style={{ color: 'inherit', textDecoration: 'underline' }}>Contact</a>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <PublicShell>
      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 14, color: 'rgba(15,23,42,0.75)', lineHeight: 1.6 }}>
          • Join channels and private messages<br />
          • Guest access (no password required)<br />
          • Built with privacy in mind
        </div>

        <div style={{ marginTop: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <a
            href="#login"
            className="tt-btn-primary"
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '12px 16px', borderRadius: 12, textDecoration: 'none' }}
          >
            Continue
          </a>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, color: 'rgba(15,23,42,0.6)' }}>
          By continuing, you agree to the Terms.
        </div>
      </div>
    </PublicShell>
  );
}

export { PublicShell };
