import React from 'react';
import { PublicShell } from './LandingPage';

export default function PrivacyPage() {
  return (
    <PublicShell>
      <div style={{ marginTop: 8 }}>
        <a href="#home" style={{ fontSize: 12, textDecoration: 'underline', color: 'rgba(15,23,42,0.7)' }}>← Back</a>
        <h2 style={{ marginTop: 10, fontSize: 18, fontWeight: 900 }}>Privacy Policy</h2>
        <div style={{ marginTop: 10, fontSize: 13, color: 'rgba(15,23,42,0.75)', lineHeight: 1.7 }}>
          <p>
            Tambayan Talks stores only what is necessary to operate the service: account identifiers, profile details you set
            (like a display name), and messages you send.
          </p>
          <p>
            We do not sell personal data. Access to your account is controlled by your session token. Please keep it private.
          </p>
          <p>
            If you have questions or want data removed, use the Contact page.
          </p>
          <p style={{ marginTop: 10, fontSize: 12, color: 'rgba(15,23,42,0.6)' }}>
            Last updated: {new Date().toLocaleDateString()}
          </p>
        </div>
      </div>
    </PublicShell>
  );
}
