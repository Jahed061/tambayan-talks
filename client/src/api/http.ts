function resolveApiBaseUrl(): string {
  const envApi = import.meta.env.VITE_API_URL as string | undefined;
  if (envApi) return envApi;

  // Heuristic for Render free hosting: frontend <name>.onrender.com -> api <name>-api.onrender.com
  try {
    const origin = window.location.origin;
    const u = new URL(origin);

    if (u.hostname.endsWith(".onrender.com") && !u.hostname.includes("-api")) {
      return `${u.protocol}//${u.hostname.replace(".onrender.com", "-api.onrender.com")}`;
    }

    return origin;
  } catch {
    return "";
  }
}

const API_BASE_URL = resolveApiBaseUrl();
// Keep token in memory + storage (supports both localStorage and localStorage)
let authToken: string | null =
  localStorage.getItem('token') ?? null;

export function setToken(token: string | null) {
  authToken = token;

  if (token) {
    localStorage.setItem('token', token);
  } else {
    localStorage.removeItem('token');
  }
}

function buildHeaders(input?: HeadersInit): Headers {
  // ✅ This safely accepts Headers | string[][] | Record<string,string>
  const headers = new Headers(input);

  // Default JSON if caller didn't set it
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  // ✅ Only set Authorization when we actually have a token
  if (authToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }

  return headers;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: buildHeaders(options.headers),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `${res.status} ${res.statusText}`);
  }

  // Most endpoints return JSON
  return res.json() as Promise<T>;
}

// ---------------- Types ----------------

export type CurrentUserDTO = {
  id: string;
  email: string;
  displayName: string;
  role: 'TEACHER' | 'STUDENT' | 'ADMIN';
  avatarUrl?: string | null;
};

export type UserSearchDTO = {
  id: string;
  email: string;
  displayName: string;
  role: 'TEACHER' | 'STUDENT' | 'ADMIN';
  avatarUrl?: string | null;
};

export type ProfileDTO = {
  id: string;
  email: string;
  displayName: string;
  role: 'TEACHER' | 'STUDENT' | 'ADMIN';
  avatarUrl: string | null;
};

export type LinkPreviewDTO = {
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
};

export type AuthResponse = {
  token: string;
  user: CurrentUserDTO;
};

export type GuestAuthResponse = AuthResponse;

export type SignupResponse =
  | AuthResponse
  | { ok: true; requiresEmailVerification: true };

export type Channel = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
};

// Reactions are arbitrary strings (unicode emoji, or custom :name: tokens)
export type ReactionEmoji = string;

export type ReactionSummaryDTO = {
  emoji: ReactionEmoji;
  count: number;
  me: boolean;
};

export type ReplyPreviewDTO = {
  id: string;
  content: string;
  createdAt: string;
  isDeleted: boolean;
  sender: {
    id: string;
    displayName: string;
    avatarUrl?: string | null;
  };
};

export type ChatMessageDTO = {
  id: string;
  content: string;
  channelId: string;
  createdAt: string;
  editedAt: string | null;
  isDeleted: boolean;
  deletedAt: string | null;

  attachments: MessageAttachmentDTO[];

  isPinned: boolean;
  isAnnouncement: boolean;
  pinnedAt: string | null;
  pinnedBy: { id: string; displayName: string } | null;

  replyTo: ReplyPreviewDTO | null;

  sender: {
    id: string;
    displayName: string;
    avatarUrl?: string | null;
  };

  reactions: ReactionSummaryDTO[];

  receipt: {
    myDeliveredAt: string | null;
    mySeenAt: string | null;

    deliveredCount: number;
    seenCount: number;
    lastSeenAt: string | null;
    seenBy: { id: string; displayName: string; seenAt: string }[];

    statusForSender: 'sent' | 'delivered' | 'seen' | null;
  };
};

export type MessageAttachmentDTO = {
  // id is present for messages loaded from the DB
  id?: string;
  kind: 'IMAGE' | 'PDF' | 'AUDIO';
  url: string;
  mimeType: string;
  fileName: string;
  size: number;
  createdAt?: string;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
};

// ---------- Direct Messages ----------

export type DMThreadDTO = {
  id: string;
  otherUser: {
    id: string;
    displayName: string;
    avatarUrl?: string | null;
  };
  unreadCount?: number;
  lastMessage?: {
    id: string;
    content: string;
    createdAt: string;
    senderId: string;
    senderName: string;
  } | null;
};

export type DMMessageDTO = {
  id: string;
  content: string;
  attachments: MessageAttachmentDTO[];
  createdAt: string;
  senderId: string;
  senderName: string;
  senderAvatarUrl?: string | null;
  threadId: string;

  // Optional (parity with channel messages)
  replyTo?: ReplyPreviewDTO | null;
  reactions?: ReactionSummaryDTO[];
};

// ---------------- Auth ----------------

export async function login(email: string, password: string): Promise<AuthResponse> {
  // Use api() so headers are consistent
  return api<AuthResponse>('/api/login', {
    method: 'POST',
    // IMPORTANT: login endpoint should NOT require auth token
    headers: new Headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ email, password }),
  });
}

// ---------------- Guest auth ----------------

export async function guestLogin(deviceId: string): Promise<GuestAuthResponse> {
  return api<GuestAuthResponse>('/api/guest', {
    method: 'POST',
    // IMPORTANT: guest endpoint should NOT require auth token
    headers: new Headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ deviceId }),
  });
}

export async function signup(
  email: string,
  password: string,
  displayName?: string,
  role: 'STUDENT' | 'TEACHER' = 'STUDENT',
  adminKey?: string,
): Promise<SignupResponse> {
  return api<SignupResponse>("/api/signup", {
    method: "POST",
    headers: new Headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ email, password, displayName, role, adminKey }),
  });
}

export async function me(token: string): Promise<CurrentUserDTO> {
  // Bypass authToken and use explicit token provided
  const res = await fetch(`${API_BASE_URL}/api/me`, {
    headers: new Headers({ Authorization: `Bearer ${token}` }),
  });

  if (!res.ok) throw new Error('Not logged in');
  return res.json();
}

export async function verifyEmail(token: string): Promise<{ ok: true }> {
  return api<{ ok: true }>(`/api/verify-email?token=${encodeURIComponent(token)}`, {
    method: 'GET',
    headers: new Headers({ 'Content-Type': 'application/json' }),
  });
}

export async function resendVerification(email: string): Promise<{ ok: true }> {
  return api<{ ok: true }>('/api/verify-email/resend', {
    method: 'POST',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ email }),
  });
}

export async function forgotPassword(email: string): Promise<{ ok: true }> {
  return api<{ ok: true }>('/api/forgot-password', {
    method: 'POST',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ email }),
  });
}

export async function resetPassword(token: string, newPassword: string): Promise<{ ok: true }> {
  return api<{ ok: true }>('/api/reset-password', {
    method: 'POST',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ token, newPassword }),
  });
}

// ---------------- Profile ----------------

export function getProfile() {
  return api<ProfileDTO>('/api/profile');
}

export function updateProfile(input: { displayName?: string; avatarUrl?: string | null }) {
  return api<ProfileDTO>('/api/profile', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

// ---------------- Link previews ----------------

export function linkPreview(url: string) {
  return api<LinkPreviewDTO>('/api/link-preview', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
}

// ---------------- Channels ----------------

export function getChannels() {
  return api<Channel[]>('/api/channels');
}

export function createChannel(name: string, description?: string) {
  return api<Channel>('/api/channels', {
    method: 'POST',
    body: JSON.stringify({ name, description }),
  });
}

export function getMessages(channelId: string) {
  return api<ChatMessageDTO[]>(`/api/channels/${channelId}/messages`);
}

// ---------------- Uploads ----------------

export async function uploadAttachments(files: File[]): Promise<MessageAttachmentDTO[]> {
  const token = authToken ?? localStorage.getItem('token') ?? localStorage.getItem('token');
  if (!token) throw new Error('Not authenticated');
  if (!files.length) return [];

  const form = new FormData();
  for (const f of files) form.append('files', f);

  const res = await fetch(`${API_BASE_URL}/api/uploads`, {
    method: 'POST',
    headers: new Headers({ Authorization: `Bearer ${token}` }),
    body: form,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as { attachments: MessageAttachmentDTO[] };
  // Server returns relative URLs; normalize to absolute so <img>/<audio> works.
  return (json.attachments ?? []).map((a) => ({
    ...a,
    url: a.url.startsWith('http') ? a.url : `${API_BASE_URL}${a.url}`,
  }));
}

// ---------------- DMs ----------------

// ---------------- Users ----------------

// Lightweight user search for DM discovery
export function searchUsers(q: string) {
  const qs = new URLSearchParams({ q });
  return api<UserSearchDTO[]>(`/api/users/search?${qs.toString()}`);
}

// ---------------- DMs ----------------

export function getDmThreads() {
  return api<DMThreadDTO[]>('/api/dms/threads');
}

export function createDmThread(recipientId: string) {
  return api<{ threadId: string; otherUser: { id: string; displayName: string } }>('/api/dms/threads', {
    method: 'POST',
    body: JSON.stringify({ recipientId }),
  });
}

export function getDmMessages(threadId: string) {
  return api<DMMessageDTO[]>(`/api/dms/threads/${threadId}/messages`);
}

export function sendDmMessage(
  threadId: string,
  content: string,
  attachments: MessageAttachmentDTO[] = [],
  replyToId: string | null = null,
) {
  return api<DMMessageDTO>(`/api/dms/threads/${threadId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content, attachments, replyToId }),
  });
}
