import React from 'react';
import { PublicShell } from './LandingPage';

export default function TermsPage() {
  return (
    <PublicShell>
      <div style={{ marginTop: 8 }}>
        <a href="#home" style={{ fontSize: 12, textDecoration: 'underline', color: 'rgba(15,23,42,0.7)' }}>← Back</a>
        <h2 style={{ marginTop: 10, fontSize: 18, fontWeight: 900 }}>Terms of Service</h2>
        <div style={{ marginTop: 10, fontSize: 13, color: 'rgba(15,23,42,0.75)', lineHeight: 1.7 }}>
          <p>
            Use Tambayan Talks respectfully. Don’t post illegal content, harassment, or spam. Don’t attempt to break,
            overload, or scrape the service.
          </p>
          <p>
            Your messages may be stored to provide the service. You are responsible for what you post.
          </p>
          <p>
            The service is provided “as is” with no warranties. Availability may vary on free hosting.
          </p>
          <p style={{ marginTop: 10, fontSize: 12, color: 'rgba(15,23,42,0.6)' }}>
            Last updated: {new Date().toLocaleDateString()}
          </p>
        </div>
      </div>
    </PublicShell>
  );
}
