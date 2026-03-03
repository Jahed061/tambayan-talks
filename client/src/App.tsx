import React, { useEffect, useMemo, useState } from 'react';
import TeacherSessionsPage from './pages/TeacherSessionsPage';
import ChatPage from './pages/ChatPage';
import PrivateMessagesPage from './pages/PrivateMessagesPage';
import ProfilePage from './pages/ProfilePage';
import LoginPage from './pages/LoginPage';
import LandingPage from './pages/LandingPage';
import PrivacyPage from './pages/PrivacyPage';
import TermsPage from './pages/TermsPage';
import ContactPage from './pages/ContactPage';
import type { CurrentUserDTO } from './api/http';
import { guestLogin, me, setToken as setApiToken } from './api/http';

type View = 'sessions' | 'chat' | 'dm' | 'profile';

type PublicView = 'home' | 'login' | 'privacy' | 'terms' | 'contact';

type ChatDeepLink = { channelId?: string; messageId?: string };

function parseHash(): { view?: View; chat?: ChatDeepLink } {
  const hash = window.location.hash || '';
  // Supported:
  //  - #chat/<channelId>
  //  - #chat/<channelId>/<messageId>
  const m = hash.match(/^#chat\/(.+)$/);
  if (!m) return {};
  const parts = m[1].split('/').filter(Boolean);
  const channelId = parts[0];
  const messageId = parts[1];
  return { view: 'chat', chat: { channelId, messageId } };
}


function parsePublicHash(): PublicView {
  const raw = (window.location.hash || '').replace(/^#/, '');
  const key = raw.split('?')[0].split('/')[0].trim().toLowerCase();

  switch (key) {
    case '':
    case 'home':
      return 'home';
    case 'login':
      return 'login';
    case 'privacy':
      return 'privacy';
    case 'terms':
      return 'terms';
    case 'contact':
      return 'contact';
    default:
      return 'home';
  }
}

type IconName = 'logout' | 'profile' | 'sessions' | 'chat' | 'dm';

function Icon({ name }: { name: IconName }) {
  // Small inline SVG icons (no extra libraries needed)
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', xmlns: 'http://www.w3.org/2000/svg' as const };
  switch (name) {
    case 'logout':
      return (
        <svg {...common}>
          <path
            d="M10 7V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-1"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path d="M15 12H3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M6 9l-3 3 3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'profile':
      return (
        <svg {...common}>
          <path
            d="M20 21a8 8 0 0 0-16 0"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M12 13a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'sessions':
      return (
        <svg {...common}>
          <path
            d="M4 5h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path d="M14 9.5 17 11l-3 1.5V9.5Z" fill="currentColor" />
        </svg>
      );
    case 'chat':
      return (
        <svg {...common}>
          <path
            d="M21 12a8 8 0 0 1-8 8H8l-5 4v-4a8 8 0 1 1 18-8Z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path d="M8 12h.01M12 12h.01M16 12h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      );
    case 'dm':
      return (
        <svg {...common}>
          <path
            d="M4 6h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path d="m22 8-10 7L2 8" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        </svg>
      );
    default:
      return null;
  }
}

function App() {
  const [view, setView] = useState<View>('dm');
  const [publicView, setPublicView] = useState<PublicView>(() => parsePublicHash());

  useEffect(() => {
    const onHash = () => setPublicView(parsePublicHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);


  // Keep the top navigation visible and prevent route changes from leaving the window scrolled.
  useEffect(() => {
    try {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    } catch {
      window.scrollTo(0, 0);
    }
  }, [view]);

  const [currentUser, setCurrentUser] = useState<CurrentUserDTO | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loadingMe, setLoadingMe] = useState(true);
  const [chatDeepLink, setChatDeepLink] = useState<ChatDeepLink | null>(null);

  const handleLogout = () => {
    setApiToken(null); // clears module authToken + localStorage
    setToken(null); // clears React state
    setCurrentUser(null);
    setView('sessions');
    // Clear any deep link so we don't auto-jump back into chat on reload
    try {
      window.location.hash = '';
    } catch {}
  };

  useEffect(() => {
    const getDeviceId = () => {
      const key = 'tt_device_id';
      const existing = localStorage.getItem(key);
      if (existing) return existing;
      const id =
        (globalThis.crypto && 'randomUUID' in globalThis.crypto
          ? (globalThis.crypto as any).randomUUID()
          : `dev_${Math.random().toString(16).slice(2)}_${Date.now()}`);
      localStorage.setItem(key, id);
      return id;
    };

    const savedToken = localStorage.getItem('token');

    const run = async () => {
      try {
        if (savedToken) {
          setApiToken(savedToken);
          setToken(savedToken);
          const user = await me(savedToken);
          setCurrentUser(user);
          return;
        }

        // No token => auto-create / resume a guest account
        const deviceId = getDeviceId();
        const res = await guestLogin(deviceId);
        setApiToken(res.token);
        setToken(res.token);
        setCurrentUser(res.user);
      } catch {
        setApiToken(null);
        setToken(null);
        setCurrentUser(null);
      } finally {
        setLoadingMe(false);
      }
    };

    void run();
  }, []);

  // Deep links (message links): hashchange => jump to chat/channel/message
  useEffect(() => {
    const apply = () => {
      const parsed = parseHash();
      if (parsed.view === 'chat') {
        setChatDeepLink(parsed.chat ?? null);
        setView('chat');
      }
    };

    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, []);

  const displayRole = useMemo(() => (currentUser?.role ? String(currentUser.role).toUpperCase() : ''), [currentUser?.role]);

  const canSeeSessions = currentUser?.role === 'TEACHER' || currentUser?.role === 'ADMIN';
  useEffect(() => {
    if (!canSeeSessions && view === 'sessions') setView('dm');
  }, [canSeeSessions, view]);



  if (loadingMe) {
    return <div style={{ padding: 16 }}>Loading...</div>;
  }

  // If guest account hasn't set a username yet, ask for it.
  const needsUsername =
    !!currentUser &&
    String(currentUser.email || '').endsWith('@guest.local') &&
    String(currentUser.displayName || '').toLowerCase().startsWith('guest_');

  if (!token || !currentUser || needsUsername) {
    // token/currentUser can be present (guest), but username may still be pending.
    if (needsUsername || publicView === 'login') {
      return (
        <LoginPage
          user={currentUser}
          onProfileUpdated={(user) => setCurrentUser(user)}
        />
      );
    }

    if (publicView === 'privacy') return <PrivacyPage />;
    if (publicView === 'terms') return <TermsPage />;
    if (publicView === 'contact') return <ContactPage />;
    return <LandingPage />;
  }

  // --------- Logged in: main app layout ----------
  return (
    <div className="tt-app">
      {/* Top nav */}
      <nav className="tt-topnav" aria-label="Primary">
        <div className="tt-topnav-left">
          <div className="tt-brand" title="Tambayan Talks">
            <span className="tt-brand-mark">TT</span>
            <span className="tt-brand-text">Tambayan Talks</span>
          </div>

          <div className="tt-userbadge" title={`${currentUser.displayName} (${displayRole})`}>
            <span className="tt-userbadge-name">{currentUser.displayName}</span>
            <span className="tt-userbadge-role">{displayRole}</span>
          </div>
        </div>

        <div className="tt-topnav-actions" role="tablist" aria-label="Navigation">
          <button
            className={`tt-iconbtn ${view === 'profile' ? 'is-active' : ''}`}
            onClick={() => setView('profile')}
            title="Profile"
            aria-label="Profile"
            type="button"
          >
            <Icon name="profile" />
          </button>

          <button
            className={`tt-iconbtn ${view === 'sessions' ? 'is-active' : ''}`}
            onClick={() => setView('sessions')}
            title="Video sessions"
            aria-label="Video sessions"
            type="button"
          >
            <Icon name="sessions" />
          </button>

          <button
            className={`tt-iconbtn ${view === 'chat' ? 'is-active' : ''}`}
            onClick={() => setView('chat')}
            title="Channels & chat"
            aria-label="Channels & chat"
            type="button"
          >
            <Icon name="chat" />
          </button>

          <button
            className={`tt-iconbtn ${view === 'dm' ? 'is-active' : ''}`}
            onClick={() => setView('dm')}
            title="Private messages"
            aria-label="Private messages"
            type="button"
          >
            <Icon name="dm" />
          </button>

          <div className="tt-topnav-divider" aria-hidden="true" />

          <button className="tt-iconbtn is-danger" onClick={handleLogout} title="Logout" aria-label="Logout" type="button">
            <Icon name="logout" />
          </button>
        </div>
      </nav>

     {/* Main content */}
<div className="tt-app-main">
  {view === 'sessions' && <TeacherSessionsPage currentUser={currentUser} />}
  {view === 'chat' && <ChatPage token={token!} currentUser={currentUser} deepLink={chatDeepLink ?? undefined} />}
  {view === 'dm' && <PrivateMessagesPage currentUser={currentUser} />}
  {view === 'profile' && (
    <ProfilePage
      onProfileUpdated={(next) => {
        setCurrentUser((prev) => {
          if (!prev) return prev;
          return { ...prev, displayName: next.displayName, avatarUrl: next.avatarUrl };
        });
      }}
    />
  )}
</div>

      {/* Bottom nav (mobile) */}
      <div className="tt-bottomnav" aria-label="Bottom navigation">
        <button
          type="button"
          className={'tt-bottomnav-item ' + (view === 'dm' ? 'is-active' : '')}
          onClick={() => setView('dm')}
          aria-label="Private messages"
          title="Private messages"
        >
          <Icon name="dm" />
          <span>DMs</span>
        </button>

        <button
          type="button"
          className={'tt-bottomnav-item ' + (view === 'chat' ? 'is-active' : '')}
          onClick={() => setView('chat')}
          aria-label="Channels"
          title="Channels"
        >
          <Icon name="chat" />
          <span>Channels</span>
        </button>

        {canSeeSessions && (
          <button
            type="button"
            className={'tt-bottomnav-item ' + (view === 'sessions' ? 'is-active' : '')}
            onClick={() => setView('sessions')}
            aria-label="Sessions"
            title="Sessions"
          >
            <Icon name="sessions" />
            <span>Sessions</span>
          </button>
        )}

        <button
          type="button"
          className={'tt-bottomnav-item ' + (view === 'profile' ? 'is-active' : '')}
          onClick={() => setView('profile')}
          aria-label="Profile"
          title="Profile"
        >
          <Icon name="profile" />
          <span>Profile</span>
        </button>

        <button
          type="button"
          className="tt-bottomnav-item is-danger"
          onClick={handleLogout}
          aria-label="Logout"
          title="Logout"
        >
          <Icon name="logout" />
          <span>Logout</span>
        </button>
      </div>


    </div>
  );
}

export default App;
