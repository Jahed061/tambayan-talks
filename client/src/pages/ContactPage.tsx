import React from 'react';
import { PublicShell } from './LandingPage';

export default function ContactPage() {
  return (
    <PublicShell>
      <div style={{ marginTop: 8 }}>
        <a href="#home" style={{ fontSize: 12, textDecoration: 'underline', color: 'rgba(15,23,42,0.7)' }}>← Back</a>
        <h2 style={{ marginTop: 10, fontSize: 18, fontWeight: 900 }}>Contact</h2>
        <div style={{ marginTop: 10, fontSize: 13, color: 'rgba(15,23,42,0.75)', lineHeight: 1.7 }}>
          <p>
            For support, feedback, or data requests, please reach out via your preferred channel:
          </p>
          <ul style={{ marginTop: 8, paddingLeft: 18 }}>
            <li>Email: <span style={{ fontWeight: 700 }}>support@tambayan-talks.onrender.com</span> (placeholder)</li>
            <li>Or add a Google Form link here if you have one.</li>
          </ul>
          <p style={{ marginTop: 10, fontSize: 12, color: 'rgba(15,23,42,0.6)' }}>
            Tip: If you don’t have an email, replace this page with a Google Form link.
          </p>
        </div>
      </div>
    </PublicShell>
  );
}
