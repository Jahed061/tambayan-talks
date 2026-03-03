// client/src/pages/ChatPage.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { createChannel, getChannels, getMessages, uploadAttachments } from '../api/http';
import type { Channel, ChatMessageDTO, CurrentUserDTO, ReactionEmoji, MessageAttachmentDTO } from '../api/http';
import { AvatarDot, AvatarStack, highlight } from '../ui/chatUi';
import EmojiPicker from '../ui/EmojiPicker';
import LinkPreview from '../ui/LinkPreview';
import {
  customEmojiUrlForToken,
  loadCustomEmojis,
  type CustomEmoji,
  toCustomToken,
} from '../ui/customEmojis';

type ChatPageProps = {
  currentUser: CurrentUserDTO;
  token: string;
  deepLink?: { channelId?: string; messageId?: string };
};
const DEFAULT_PUBLIC_CHANNEL_ID = 'public';
const DEFAULT_PUBLIC_CHANNEL_NAME = 'general';


function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function dayLabel(d: Date) {
  const now = new Date();
  const today = startOfDay(now);
  const yesterday = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const ts = startOfDay(d);

  if (ts === today) return 'Today';
  if (ts === yesterday) return 'Yesterday';

  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function timeLabel(d: Date) {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function lastSeenLabel(lastSeenMs: number) {
  const deltaMs = Date.now() - lastSeenMs;
  const sec = Math.max(0, Math.floor(deltaMs / 1000));
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  if (sec < 60) return 'last seen just now';
  if (min < 60) return `last seen ${min}m ago`;
  if (hr < 24) return `last seen ${hr}h ago`;
  if (day < 7) return `last seen ${day}d ago`;
  return `last seen ${new Date(lastSeenMs).toLocaleDateString()}`;
}

const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL ??
  `http://${window.location.hostname}:4000`;

function normalizeMentionKey(name: string) {
  return name.toLowerCase().replace(/\s+/g, '');
}

function extractMentionKeys(text: string): Set<string> {
  const out = new Set<string>();
  const re = /@([a-zA-Z0-9_][a-zA-Z0-9_-]{0,31})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.add(String(m[1]).toLowerCase());
  }
  return out;
}

function mentionTokenForUser(displayName: string) {
  return `@${normalizeMentionKey(displayName)}`;
}

function containsMentionForUser(text: string, displayName: string) {
  const key = normalizeMentionKey(displayName);
  return extractMentionKeys(text).has(key);
}

function renderTextWithMentionsAndSearch(text: string, searchQuery: string) {
  const q = searchQuery.trim();
  const mentionRe = /@([a-zA-Z0-9_][a-zA-Z0-9_-]{0,31})/g;
  const searchRe = q ? new RegExp(`(${escapeRegExp(q)})`, 'ig') : null;

  // Split by mentions first, then highlight search within each part.
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = mentionRe.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    const before = text.slice(lastIndex, start);
    if (before) parts.push(searchRe ? highlight(before, q) : before);

    const token = match[0];
    parts.push(
      <span
        key={`m-${start}`}
        style={{
          padding: '1px 6px',
          borderRadius: 999,
          background: 'rgba(255, 79, 216, 0.18)',
          color: 'var(--tt-accent-2)',
          fontWeight: 800,
          fontSize: '0.95em',
        }}
        title="Mention"
      >
        {token}
      </span>,
    );

    lastIndex = end;
  }

  const rest = text.slice(lastIndex);
  if (rest) parts.push(searchRe ? highlight(rest, q) : rest);
  if (parts.length === 0) return searchRe ? highlight(text, q) : text;
  return <>{parts}</>;
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

type Toast = {
  id: string;
  title: string;
  body: string;
  onClick?: () => void;
};

const ChatPage: React.FC<ChatPageProps> = ({ currentUser, token, deepLink }) => {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessageDTO[]>([]);
  const [newChannelName, setNewChannelName] = useState('');
  const [channelSearch, setChannelSearch] = useState('');
  const [chatInput, setChatInput] = useState('');

  // Mobile: toggle between Channels and Chat
const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);
const [mobilePane, setMobilePane] = useState<'channels' | 'chat'>('chat');

useEffect(() => {
  const onResize = () => setIsMobile(window.innerWidth <= 768);
  window.addEventListener('resize', onResize);
  return () => window.removeEventListener('resize', onResize);
}, []);

useEffect(() => {
  // If user goes back to desktop size, always show full layout
  if (!isMobile) setMobilePane('chat');
}, [isMobile]);

  // --- Attachments + voice notes ---
  type PendingLocalAttachment = {
    id: string;
    file: File;
    kind: 'IMAGE' | 'PDF';
    previewUrl: string;
  };

  type PendingVoiceNote = {
    id: string;
    blob: Blob;
    mimeType: string;
    fileName: string;
    previewUrl: string;
    durationMs?: number;
  };

  const [pendingFiles, setPendingFiles] = useState<PendingLocalAttachment[]>([]);
  const [pendingVoice, setPendingVoice] = useState<PendingVoiceNote | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordTimerRef = useRef<number | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);

  const pendingFilesRef = useRef<PendingLocalAttachment[]>([]);
  const pendingVoiceRef = useRef<PendingVoiceNote | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [isLoadingChannels, setIsLoadingChannels] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [unreadByChannel, setUnreadByChannel] = useState<Record<string, number>>({});

  // typing users as objects
  const [typingUsers, setTypingUsers] = useState<{ userId: string; displayName: string; avatarUrl?: string | null }[]>([]);
  const [isTyping, setIsTyping] = useState(false);

  const [stickToBottom, setStickToBottom] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [newMsgCount, setNewMsgCount] = useState(0);

  // Reply / edit
  const [replyingTo, setReplyingTo] = useState<ChatMessageDTO | null>(null);
  const [editing, setEditing] = useState<ChatMessageDTO | null>(null);

  // Teacher-only
  const [sendAsAnnouncement, setSendAsAnnouncement] = useState(false);

  // Deep-link + flashes
  const [flashMessageId, setFlashMessageId] = useState<string | null>(null);
  const pendingJumpRef = useRef<{ channelId?: string; messageId?: string } | null>(deepLink ?? null);

  // Unread divider (since last visit)
  const [firstUnreadMessageId, setFirstUnreadMessageId] = useState<string | null>(null);
  const [lastReadAtMs, setLastReadAtMs] = useState<number | null>(null);

  // Mentions + emoji custom
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [customEmojis, setCustomEmojis] = useState<CustomEmoji[]>(() => loadCustomEmojis());

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(() => new Set());
  const [lastSeenMsByUserId, setLastSeenMsByUserId] = useState<Record<string, number>>({});

  const activeChannelIdRef = useRef<string | null>(null);
  const stickToBottomRef = useRef(true);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const isTeacher = currentUser.role === 'TEACHER' || currentUser.role === 'ADMIN';

  const toast = (t: Omit<Toast, 'id'>) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts((prev) => [{ id, ...t }, ...prev].slice(0, 4));
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, 4500);
  };

  const handleTypingEvent = () => {
    const socket = socketRef.current;
    if (!socket || !activeChannelId) return;

    if (!isTyping) {
      socket.emit('typing', {
        channelId: activeChannelId,
        userId: currentUser.id,
        displayName: currentUser.displayName,
        avatarUrl: currentUser.avatarUrl ?? null,
      });
      setIsTyping(true);
    }

    if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);

    typingTimeoutRef.current = window.setTimeout(() => {
      socket.emit('stop_typing', {
        channelId: activeChannelId,
        userId: currentUser.id,
        displayName: currentUser.displayName,
      });
      setIsTyping(false);
    }, 3000);
  };

  const lastReadKey = (channelId: string) => `tt:lastRead:${currentUser.id}:${channelId}`;

  const computeUnreadDivider = (list: ChatMessageDTO[], channelId: string) => {
    const raw = localStorage.getItem(lastReadKey(channelId));
    const ms = raw ? new Date(raw).getTime() : null;
    setLastReadAtMs(ms);

    if (!ms) {
      setFirstUnreadMessageId(null);
      return;
    }

    const first = list.find((m) => new Date(m.createdAt).getTime() > ms);
    setFirstUnreadMessageId(first?.id ?? null);
  };

  const markReadNow = (channelId: string) => {
    const now = Date.now();
    localStorage.setItem(lastReadKey(channelId), new Date(now).toISOString());
    setLastReadAtMs(now);
    setFirstUnreadMessageId(null);
  };

  // --- Socket connect ---
  useEffect(() => {
    if (!token) return;

    socketRef.current?.disconnect();

    const socket = io(SOCKET_URL, { auth: { token } });
    socketRef.current = socket;

    socket.on('connect', () => console.log('[socket] connected', socket.id));
    socket.on('connect_error', (err) => console.error('[socket] connect_error', err.message));
    socket.on('message_error', (payload: any) => setError(payload?.error || 'Message error'));

    // Presence
    socket.on('presence_snapshot', (payload: { onlineUserIds: string[]; lastSeenMsByUserId?: Record<string, number> }) => {
      setOnlineUserIds(new Set(payload?.onlineUserIds ?? []));
      setLastSeenMsByUserId(payload?.lastSeenMsByUserId ?? {});
    });

    socket.on('presence_update', (payload: { userId: string; online: boolean; lastSeenMs?: number | null }) => {
      setOnlineUserIds((prev) => {
        const next = new Set(prev);
        if (payload?.online) next.add(payload.userId);
        else next.delete(payload.userId);
        return next;
      });

      // Track last-seen only when user goes offline.
      if (payload?.online) {
        setLastSeenMsByUserId((prev) => {
          const next = { ...prev };
          delete next[payload.userId];
          return next;
        });
      } else if (typeof payload.lastSeenMs === 'number') {
        setLastSeenMsByUserId((prev) => ({ ...prev, [payload.userId]: payload.lastSeenMs! }));
      }
    });

    // Mention notifications (server-side)
    socket.on(
      'mention',
      (payload: { channelId: string; messageId: string; from: { id: string; displayName: string }; snippet: string }) => {
        const go = () => {
          // update hash to deep-link into the message
          window.location.hash = `#chat/${payload.channelId}/${payload.messageId}`;
        };

        toast({
          title: `@${normalizeMentionKey(currentUser.displayName)} mentioned by ${payload.from.displayName}`,
          body: payload.snippet,
          onClick: go,
        });

        // If not in the channel, bump unread count as a nudge.
        if (payload.channelId !== activeChannelIdRef.current) {
          setUnreadByChannel((prev) => ({
            ...prev,
            [payload.channelId]: (prev[payload.channelId] ?? 0) + 1,
          }));
        }
      },
    );

    return () => {
      socket.off('connect');
      socket.off('connect_error');
      socket.off('message_error');
      socket.off('mention');
      socket.off('presence_snapshot');
      socket.off('presence_update');
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token, currentUser.displayName]);

  // Scroll tracking
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;

    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setStickToBottom(distanceFromBottom < 40);
    };

    el.addEventListener('scroll', onScroll);
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    activeChannelIdRef.current = activeChannelId;
  }, [activeChannelId]);

  useEffect(() => {
    stickToBottomRef.current = stickToBottom;
    if (stickToBottom) setNewMsgCount(0);

    // When user is at the bottom, consider the channel "read".
    if (stickToBottom && activeChannelId) markReadNow(activeChannelId);
  }, [stickToBottom, activeChannelId]);

  // Load channels (and honor deep link channel if present)
  useEffect(() => {
    (async () => {
      setIsLoadingChannels(true);
      try {
        const list = await getChannels();
        setChannels(list);

        const preferred = pendingJumpRef.current?.channelId;
        if (preferred && list.some((c) => c.id === preferred)) {
          setActiveChannelId(preferred);
          return;
        }

        const pub = list.find((c) => c.id === DEFAULT_PUBLIC_CHANNEL_ID) || list.find((c) => (c.name || '').toLowerCase() === DEFAULT_PUBLIC_CHANNEL_NAME);
        if (pub) {
          setActiveChannelId(pub.id);
        } else if (list.length > 0) {
          setActiveChannelId(list[0].id);
        }
      } catch (err: any) {
        const msg = err?.message || 'Failed to load channels';
        setError(msg);
        toast({ title: 'Error', body: msg });
      } finally {
        setIsLoadingChannels(false);
      }
    })();
  }, []);

  // If deepLink changes while mounted (hashchange), honor it.
  useEffect(() => {
    if (!deepLink) return;
    pendingJumpRef.current = deepLink;
    if (deepLink.channelId) {
      setActiveChannelId(deepLink.channelId);
    }
  }, [deepLink?.channelId, deepLink?.messageId]);

  // Load messages when active channel changes
  useEffect(() => {
    if (!activeChannelId) return;

    (async () => {
      setIsLoadingMessages(true);
      try {
        setError(null);
        const list = await getMessages(activeChannelId);
        setMessages(list);
        setSearchQuery('');
        setNewMsgCount(0);
        setTypingUsers([]);
        setReplyingTo(null);
        setEditing(null);

        computeUnreadDivider(list, activeChannelId);

        // Keep hash pointing at the active channel for shareable links.
        const pendingMsgId = pendingJumpRef.current?.messageId;
        window.history.replaceState(null, '', `#chat/${activeChannelId}${pendingMsgId ? `/${pendingMsgId}` : ''}`);

        socketRef.current?.emit('join_channel', activeChannelId);

        // mark delivered (and optionally seen if already at bottom)
        const socket = socketRef.current;
        if (socket && activeChannelId) {
          const ids = list.filter((m) => m.sender.id !== currentUser.id).map((m) => m.id);
          socket.emit('bulk_delivered', { channelId: activeChannelId, messageIds: ids });
          if (stickToBottomRef.current) socket.emit('bulk_seen', { channelId: activeChannelId, messageIds: ids });
        }
      } catch (err: any) {
        setError(err?.message || 'Failed to load messages');
        // surface in UI (ToastProvider already present)
        try {
          toast({ title: 'Error', body: err?.message || 'Failed to load messages' });
        } catch {}
      } finally {
        setIsLoadingMessages(false);
      }
    })();
  }, [activeChannelId, currentUser.id]);

  // New message listener + receipts
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    const onNew = (msg: ChatMessageDTO) => {
      const currentActive = activeChannelIdRef.current;

      if (!currentActive || msg.channelId !== currentActive) {
        setUnreadByChannel((prev) => ({
          ...prev,
          [msg.channelId]: (prev[msg.channelId] ?? 0) + 1,
        }));
        return;
      }

      setMessages((prev) => [...prev, msg]);

      // mention nudge (client-side in case server mention event isn't used)
      if (msg.sender.id !== currentUser.id && containsMentionForUser(msg.content, currentUser.displayName)) {
        toast({
          title: `Mentioned by ${msg.sender.displayName}`,
          body: msg.content.slice(0, 180),
          onClick: () => scrollToMessage(msg.id, { updateHash: true }),
        });
      }

      // emit delivered/seen for incoming messages
      if (msg.sender.id !== currentUser.id) {
        socketRef.current?.emit('message_delivered', { channelId: msg.channelId, messageId: msg.id });
        if (stickToBottomRef.current)
          socketRef.current?.emit('message_seen', { channelId: msg.channelId, messageId: msg.id });
      }

      if (!stickToBottomRef.current) setNewMsgCount((c) => c + 1);
    };

    const onUpdated = (msg: ChatMessageDTO) => {
      const currentActive = activeChannelIdRef.current;
      if (!currentActive || msg.channelId !== currentActive) return;

      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === msg.id);
        if (idx === -1) return [...prev, msg];
        const next = [...prev];
        next[idx] = msg;
        return next;
      });
    };

    // receipt updates
    const onReceipt = (payload: any) => {
      if (payload.channelId !== activeChannelIdRef.current) return;

      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== payload.messageId) return m;

          const next: ChatMessageDTO = {
            ...m,
            receipt: {
              ...(m as any).receipt,
              deliveredCount: payload.aggregate?.deliveredCount ?? (m as any).receipt?.deliveredCount ?? 0,
              seenCount: payload.aggregate?.seenCount ?? (m as any).receipt?.seenCount ?? 0,
              lastSeenAt: payload.aggregate?.lastSeenAt ?? (m as any).receipt?.lastSeenAt ?? null,
              seenBy: payload.aggregate?.seenBy ?? (m as any).receipt?.seenBy ?? [],
              myDeliveredAt:
                payload.actorUserId === currentUser.id
                  ? payload.mine?.deliveredAt ?? (m as any).receipt?.myDeliveredAt ?? null
                  : (m as any).receipt?.myDeliveredAt ?? null,
              mySeenAt:
                payload.actorUserId === currentUser.id
                  ? payload.mine?.seenAt ?? (m as any).receipt?.mySeenAt ?? null
                  : (m as any).receipt?.mySeenAt ?? null,
              statusForSender: (m as any).receipt?.statusForSender ?? null,
            } as any,
          };

          // keep statusForSender server-like
          if (m.sender.id === currentUser.id) {
            (next as any).receipt.statusForSender =
              (next as any).receipt.seenCount > 0
                ? 'seen'
                : (next as any).receipt.deliveredCount > 0
                  ? 'delivered'
                  : 'sent';
          }

          return next;
        }),
      );
    };

    socket.on('new_message', onNew);
    socket.on('message_updated', onUpdated);
    socket.on('message_receipt', onReceipt);

    return () => {
      socket.off('new_message', onNew);
      socket.off('message_updated', onUpdated);
      socket.off('message_receipt', onReceipt);
    };
  }, [currentUser.id, currentUser.displayName]);

  // Typing indicators
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    const handleTyping = (payload: { channelId: string; userId: string; displayName: string; avatarUrl?: string | null }) => {
      if (payload.channelId !== activeChannelId) return;
      if (payload.userId === currentUser.id) return;

      setTypingUsers((prev) => {
        if (prev.some((x) => x.userId === payload.userId)) return prev;
        return [...prev, { userId: payload.userId, displayName: payload.displayName, avatarUrl: payload.avatarUrl ?? null }];
      });
    };

    const handleStopTyping = (payload: { channelId: string; userId: string }) => {
      if (payload.channelId !== activeChannelId) return;
      setTypingUsers((prev) => prev.filter((x) => x.userId !== payload.userId));
    };

    socket.on('typing', handleTyping);
    socket.on('stop_typing', handleStopTyping);

    return () => {
      socket.off('typing', handleTyping);
      socket.off('stop_typing', handleStopTyping);
    };
  }, [activeChannelId, currentUser.id]);

  // Auto scroll
  useEffect(() => {
    if (!stickToBottom) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, stickToBottom]);

  const activeChannel = channels.find((c) => c.id === activeChannelId) || null;

  const filteredChannels = useMemo(() => {
    const q = channelSearch.trim().toLowerCase();
    const sorted = [...channels].sort((a, b) => {
      if (a.id === DEFAULT_PUBLIC_CHANNEL_ID) return -1;
      if (b.id === DEFAULT_PUBLIC_CHANNEL_ID) return 1;
      return a.createdAt.localeCompare(b.createdAt);
    });
    if (!q) return sorted;
    return sorted.filter((c) => (c.name || '').toLowerCase().includes(q) || (c.description || '').toLowerCase().includes(q));
  }, [channels, channelSearch]);

  // do NOT filter list; we highlight + jump
  const filteredMessages = useMemo(() => messages, [messages]);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return messages
      .filter((m) => `${m.content} ${m.sender.displayName}`.toLowerCase().includes(q))
      .slice(-50)
      .reverse();
  }, [messages, searchQuery]);

  const highlights = useMemo(() => {
    const list = messages.filter((m) => m.isAnnouncement || m.isPinned);
    return list.sort((a, b) => {
      // announcements first, then pinned; newest pin time first
      if (a.isAnnouncement !== b.isAnnouncement) return a.isAnnouncement ? -1 : 1;
      const at = a.pinnedAt ? new Date(a.pinnedAt).getTime() : 0;
      const bt = b.pinnedAt ? new Date(b.pinnedAt).getTime() : 0;
      return bt - at;
    });
  }, [messages]);

  const scrollToMessage = (id: string, opts?: { updateHash?: boolean }) => {
    const el = messageRefs.current[id];
    if (!el || !messagesContainerRef.current || !activeChannelId) return;

    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlashMessageId(id);
    window.setTimeout(() => setFlashMessageId((cur) => (cur === id ? null : cur)), 1800);
    if (opts?.updateHash) window.history.replaceState(null, '', `#chat/${activeChannelId}/${id}`);
  };

  // After messages load, honor deep-link message id
  useEffect(() => {
    const pending = pendingJumpRef.current?.messageId;
    if (!pending) return;
    // Wait a tick for refs to register
    window.setTimeout(() => {
      scrollToMessage(pending, { updateHash: true });
      pendingJumpRef.current = { ...pendingJumpRef.current, messageId: undefined };
    }, 60);
  }, [messages, activeChannelId]);

  const handleCreateChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChannelName.trim()) return;

    if (!isTeacher) {
      setError('Only teachers/admins can create channels for this study.');
      return;
    }

    const proposed = newChannelName.trim();
    const lower = proposed.toLowerCase();
    if (lower === DEFAULT_PUBLIC_CHANNEL_NAME || lower === 'public') {
      setError('That channel name is reserved.');
      return;
    }

    try {
      const channel = await createChannel(newChannelName.trim());
      setChannels((prev) => [...prev, channel]);
      if (!activeChannelId) setActiveChannelId(channel.id);
      setNewChannelName('');
    } catch (err: any) {
      setError(err.message || 'Failed to create channel');
    }
  };

  const stopTypingNow = () => {
    if (!activeChannelId) return;
    const socket = socketRef.current;
    if (!socket) return;

    socket.emit('stop_typing', {
      channelId: activeChannelId,
      userId: currentUser.id,
      displayName: currentUser.displayName,
    });

    setIsTyping(false);
    if (typingTimeoutRef.current) {
      window.clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
  };

  // ---------- Attachments helpers ----------
  const revokeUrl = (url: string) => {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // no-op
    }
  };

  useEffect(() => {
    pendingFilesRef.current = pendingFiles;
  }, [pendingFiles]);

  useEffect(() => {
    pendingVoiceRef.current = pendingVoice;
  }, [pendingVoice]);

  useEffect(() => {
    return () => {
      // cleanup object URLs on unmount
      pendingFilesRef.current.forEach((p) => revokeUrl(p.previewUrl));
      if (pendingVoiceRef.current) revokeUrl(pendingVoiceRef.current.previewUrl);
    };
  }, []);

  const addPickedFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const next: PendingLocalAttachment[] = [];
    for (const f of Array.from(files)) {
      const mime = String(f.type || '').toLowerCase();
      const kind: PendingLocalAttachment['kind'] = mime === 'application/pdf' ? 'PDF' : 'IMAGE';
      // Limit to images + pdf
      if (!(mime.startsWith('image/') || mime === 'application/pdf')) continue;
      const previewUrl = URL.createObjectURL(f);
      next.push({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        file: f,
        kind,
        previewUrl,
      });
    }

    setPendingFiles((prev) => [...prev, ...next].slice(0, 8));

    // allow re-picking the same file
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removePendingFile = (id: string) => {
    setPendingFiles((prev) => {
      const hit = prev.find((p) => p.id === id);
      if (hit) revokeUrl(hit.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  };

  const clearPendingUploads = () => {
    setPendingFiles((prev) => {
      prev.forEach((p) => revokeUrl(p.previewUrl));
      return [];
    });
    setPendingVoice((prev) => {
      if (prev) revokeUrl(prev.previewUrl);
      return null;
    });
  };

  const startRecording = async () => {
    if (isRecording) return;
    if (typeof MediaRecorder === 'undefined') {
       alert('Voice recording is not supported in this browser.');
       return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Prefer opus/webm; fallback to whatever the browser supports.
      const preferred = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/ogg'];
      const mimeType = preferred.find((t) => MediaRecorder.isTypeSupported?.(t)) ?? '';

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      recordChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recordChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        // stop mic
        stream.getTracks().forEach((t) => t.stop());

        const blob = new Blob(recordChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const previewUrl = URL.createObjectURL(blob);

        const ext = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'm4a' : 'webm';
        const fileName = `voice-note-${Date.now()}.${ext}`;

        setPendingVoice({
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          blob,
          mimeType: blob.type || 'audio/webm',
          fileName,
          previewUrl,
          durationMs: recordSeconds * 1000,
        });
      };

      recorder.start(250);
      setIsRecording(true);
      setRecordSeconds(0);
      if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = window.setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    } catch (err: any) {
      console.error('startRecording error', err);
      window.alert(err?.message || 'Could not start recording.');
    }
  };

  const stopRecording = () => {
    if (!isRecording) return;
    setIsRecording(false);
    if (recordTimerRef.current) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    try {
      recorderRef.current?.stop();
    } catch {
      // no-op
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeChannelId) return;

    const socket = socketRef.current;
    if (!socket) return;

    const text = chatInput.trim();
    const hasPending = pendingFiles.length > 0 || Boolean(pendingVoice);

    // Editing only supports text updates (no attachments)
    if (editing) {
      if (!text) return;
      socket.emit('edit_message', {
        channelId: activeChannelId,
        messageId: editing.id,
        content: text,
      });
      setEditing(null);
      setChatInput('');
      stopTypingNow();
      return;
    }

    if (!text && !hasPending) return;

    let uploaded: MessageAttachmentDTO[] = [];
    if (hasPending) {
      setIsUploading(true);
      try {
        const files: File[] = pendingFiles.map((p) => p.file);
        if (pendingVoice) {
          files.push(new File([pendingVoice.blob], pendingVoice.fileName, { type: pendingVoice.mimeType }));
        }
        uploaded = await uploadAttachments(files);
      } catch (err: any) {
        setError(err?.message || 'Failed to upload files');
        setIsUploading(false);
        return;
      } finally {
        setIsUploading(false);
      }
    }

    socket.emit('send_message', {
      channelId: activeChannelId,
      content: text,
      replyToId: replyingTo?.id ?? null,
      isAnnouncement: isTeacher ? sendAsAnnouncement : false,
      attachments: uploaded.map((a) => ({
        kind: a.kind,
        url: a.url,
        mimeType: a.mimeType,
        fileName: a.fileName,
        size: a.size,
        width: a.width ?? null,
        height: a.height ?? null,
        durationMs: a.durationMs ?? (pendingVoice?.durationMs ?? null),
      })),
    });

    setChatInput('');
    setReplyingTo(null);
    setSendAsAnnouncement(false);
    clearPendingUploads();
    stopTypingNow();
  };

  const toggleReaction = (messageId: string, emoji: ReactionEmoji) => {
    if (!activeChannelId) return;
    socketRef.current?.emit('react_message', { channelId: activeChannelId, messageId, emoji });
  };

  const requestDelete = (m: ChatMessageDTO) => {
    if (!activeChannelId) return;
    if (!window.confirm('Delete this message?')) return;
    socketRef.current?.emit('delete_message', { channelId: activeChannelId, messageId: m.id });
  };

  const beginEdit = (m: ChatMessageDTO) => {
    if (m.isDeleted) return;
    setEditing(m);
    setReplyingTo(null);
    setChatInput(m.content);
  };

  const beginReply = (m: ChatMessageDTO) => {
    setReplyingTo(m);
    setEditing(null);
  };

  const togglePinned = (m: ChatMessageDTO) => {
    if (!activeChannelId) return;
    socketRef.current?.emit('pin_message', {
      channelId: activeChannelId,
      messageId: m.id,
      isPinned: !m.isPinned,
    });
  };

  const toggleAnnouncement = (m: ChatMessageDTO) => {
    if (!activeChannelId) return;
    socketRef.current?.emit('pin_message', {
      channelId: activeChannelId,
      messageId: m.id,
      isAnnouncement: !m.isAnnouncement,
    });
  };

  const copyMessageLink = async (m: ChatMessageDTO) => {
    if (!activeChannelId) return;
    const url = `${window.location.origin}${window.location.pathname}#chat/${activeChannelId}/${m.id}`;

    try {
      await navigator.clipboard.writeText(url);
      toast({ title: 'Link copied', body: url, onClick: () => window.open(url, '_blank') });
    } catch {
      // Fallback
      window.prompt('Copy this link:', url);
    }

    scrollToMessage(m.id, { updateHash: true });
  };

  const renderReactionFace = (emoji: string) => {
    const url = customEmojiUrlForToken(emoji, customEmojis);
    if (url) return <img src={url} alt={emoji} style={{ width: 16, height: 16, objectFit: 'contain' }} />;
    return <span>{emoji}</span>;
  };

  const renderAttachments = (attachments: MessageAttachmentDTO[], isMine: boolean) => {
    const list = (attachments ?? []).filter(Boolean);
    if (list.length === 0) return null;

    return (
      <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
        {list.map((a, idx) => {
          if (a.kind === 'IMAGE') {
            return (
              <a
                key={(a.id ?? a.url) + idx}
                href={a.url}
                target="_blank"
                rel="noreferrer"
                title={a.fileName}
                style={{ textDecoration: 'none' }}
              >
                <img
                  src={a.url}
                  alt={a.fileName}
                  style={{
                    maxWidth: '100%',
                    width: 280,
                    borderRadius: 10,
                    display: 'block',
                    objectFit: 'cover',
                    border: isMine ? '1px solid rgba(255,255,255,0.18)' : '1px solid #e5e7eb',
                  }}
                />
              </a>
            );
          }

          if (a.kind === 'PDF') {
            return (
              <div key={(a.id ?? a.url) + idx} style={{ display: 'grid', gap: 6 }}>
                <a
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    color: isMine ? 'rgba(255,255,255,0.95)' : '#111827',
                    fontWeight: 800,
                    fontSize: 12,
                    textDecoration: 'underline',
                    overflowWrap: 'anywhere',
                  }}
                >
                  📄 {a.fileName || 'PDF'}
                </a>
                <embed
                  src={a.url}
                  type="application/pdf"
                  style={{
                    width: 280,
                    maxWidth: '100%',
                    height: 220,
                    borderRadius: 10,
                    border: isMine ? '1px solid rgba(255,255,255,0.18)' : '1px solid #e5e7eb',
                    background: 'rgba(255,255,255,0.78)',
                  }}
                />
              </div>
            );
          }

          // AUDIO
          return (
            <div key={(a.id ?? a.url) + idx} style={{ display: 'grid', gap: 6 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 800,
                  color: isMine ? 'rgba(255,255,255,0.92)' : '#111827',
                  overflowWrap: 'anywhere',
                }}
              >
                🎙️ {a.fileName || 'Voice note'}
              </div>
              <audio controls src={a.url} style={{ width: 280, maxWidth: '100%' }} />
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="tt-chat-shell" style={{ flexDirection: isMobile ? 'column' : 'row' }}>
    {/* Mobile toggle header */}
    {isMobile && (
      <div className="tt-row" style={{ gap: 8 }}>
        <button
          type="button"
          onClick={() => setMobilePane('channels')}
          className={`tt-pill ${mobilePane === 'channels' ? 'tt-pill-primary' : ''}`}
        >
          Channels
        </button>

        <button
          type="button"
          onClick={() => setMobilePane('chat')}
          className={`tt-pill ${mobilePane === 'chat' ? 'tt-pill-primary' : ''}`}
        >
          Chat
        </button>

        <span className="tt-small" style={{ marginLeft: 'auto', fontWeight: 900 }}>
          {activeChannel ? `#${activeChannel.name}` : ''}
        </span>
      </div>
    )}

    {/* Sidebar */}
    {(!isMobile || mobilePane === 'channels') && (
      <aside
        className="tt-panel scroll-column tt-chat-sidebar"
        style={{
          flex: isMobile ? 1 : undefined,
          overflow: 'auto',
          width: isMobile ? '100%' : 320,
        }}
      >
        <h2 className="tt-chat-title">Channels</h2>

        
        <div style={{ display: 'grid', gap: 8 }}>
          <input
            value={channelSearch}
            onChange={(e) => setChannelSearch(e.target.value)}
            placeholder="Search channels…"
            className="tt-input"
          />

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              overflow: 'auto',
              paddingRight: 2,
              minHeight: 0,
              maxHeight: isMobile ? 'none' : '60vh',
            }}
          >
            {isLoadingChannels ? (
            <div style={{ display: 'grid', gap: 8, padding: 8 }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="tt-skeleton" style={{ height: 44, borderRadius: 14 }} />
              ))}
            </div>
          ) : (
            filteredChannels.map((ch) => {
              const unread = unreadByChannel[ch.id] ?? 0;
              const isLockedPublic = ch.id === DEFAULT_PUBLIC_CHANNEL_ID;
              const isActive = ch.id === activeChannelId;

              return (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => {
                    setActiveChannelId(ch.id);
                    setNewMsgCount(0);
                    setTypingUsers([]);
                    setUnreadByChannel((prev) => ({ ...prev, [ch.id]: 0 }));
                    if (isMobile) setMobilePane('chat');
                  }}
                  className={`tt-listbtn ${isActive ? 'tt-listbtn-active' : ''}`}
                  title={isLockedPublic ? 'Public default channel (locked)' : undefined}
                >
                  <AvatarDot name={`#${ch.name}`} size={24} />
                  <div style={{ display: 'grid', lineHeight: 1.1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontWeight: 900, fontSize: 13, color: '#0f172a' }}>#{ch.name}</span>
                      {isLockedPublic && (
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 900,
                            padding: '2px 8px',
                            borderRadius: 999,
                            background: 'rgba(15, 23, 42, 0.06)',
                            border: '1px solid rgba(15, 23, 42, 0.10)',
                            color: 'rgba(15, 23, 42, 0.70)',
                          }}
                        >
                          🔒 public
                        </span>
                      )}
                    </div>
                    {ch.description ? (
                      <span style={{ fontSize: 12, color: 'rgba(15,23,42,0.55)' }}>{ch.description}</span>
                    ) : null}
                  </div>

                  {unread > 0 && (
                    <span className="tt-badge" style={{ marginLeft: 'auto' }}>
                      {unread}
                    </span>
                  )}
                </button>
              );
            })
          )}

            {filteredChannels.length === 0 && (
              <div style={{ fontSize: 13, color: 'rgba(15,23,42,0.55)', padding: '0.35rem 0.2rem' }}>
                No channels match your search.
              </div>
            )}
          </div>
        </div>

        {/* Create channel (Teacher/Admin only). Default public channel is locked. */}
        {isTeacher && (
          <form onSubmit={handleCreateChannel} style={{ display: 'grid', gap: 6, marginTop: 6 }}>
            <div style={{ fontSize: 12, color: 'rgba(15,23,42,0.55)', fontWeight: 700 }}>
              Create a new channel (reserved: <b>general</b>, <b>public</b>)
            </div>
            <input
              placeholder="New channel name"
              value={newChannelName}
              onChange={(e) => setNewChannelName(e.target.value)}
              style={{
                padding: '0.4rem 0.6rem',
                borderRadius: 14,
                border: '1px solid var(--tt-border)',
                fontSize: 14,
                background: 'rgba(255,255,255,0.72)',
              }}
            />
            <button
              type="submit"
              style={{
                padding: '0.4rem 0.7rem',
                borderRadius: 999,
                border: 'none',
                background: 'var(--tt-accent)',
                color: '#fff',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              + Create channel
            </button>
          </form>
        )}

        {!isTeacher && (
          <div style={{ fontSize: 12, color: 'rgba(15,23,42,0.55)', marginTop: 6 }}>
            Only teachers/admins can create channels for this study.
          </div>
        )}

      </aside>
    )}

    {/* Main chat */}
    {(!isMobile || mobilePane === 'chat') && (
      <main
        className="tt-panel tt-chat-main"
        style={{
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <header className="tt-chat-header">
          <h1 className="tt-chat-title">
            {activeChannel ? `#${activeChannel.name}` : 'No channel selected'}
          </h1>

          <div className="tt-row-wrap" style={{ justifyContent: 'flex-end' }}>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search in this channel…"
              disabled={!activeChannel}
              className="tt-input"
              style={{ width: '100%', maxWidth: 420 }}
            />

            <div className="tt-small">
              Mention format: <b>{mentionTokenForUser(currentUser.displayName)}</b>
            </div>

            {isTeacher && !editing && (
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, color: '#374151' }}>
                <input
                  type="checkbox"
                  checked={sendAsAnnouncement}
                  onChange={(e) => setSendAsAnnouncement(e.target.checked)}
                />
                Send as announcement
              </label>
            )}
          </div>

          {/* Search results panel (jump-to-message) */}
          {searchQuery.trim() && searchResults.length > 0 && (
            <div
              style={{
                width: '100%',
                maxWidth: 420,
                border: '1px solid var(--tt-border)',
                borderRadius: 10,
                background: 'rgba(255,255,255,0.78)',
                padding: 8,
                marginTop: 8,
              }}
            >
              <div style={{ fontSize: 12, color: 'var(--tt-muted)', fontWeight: 700, marginBottom: 6 }}>
                {searchResults.length} match{searchResults.length === 1 ? '' : 'es'} (click to jump)
              </div>

              <div style={{ maxHeight: 180, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {searchResults.slice(0, 12).map((m) => (
                  <button
                    key={m.id}
                    onClick={() => scrollToMessage(m.id, { updateHash: true })}
                    style={{
                      border: 'none',
                      textAlign: 'left',
                      cursor: 'pointer',
                      padding: '6px 8px',
                      borderRadius: 8,
                      background: 'rgba(15, 23, 42, 0.04)',
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 800, color: '#111827' }}>
                      {m.sender.displayName}{' '}
                      <span style={{ fontWeight: 600, color: '#6b7280' }}>
                        · {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: '#374151' }}>
                      {highlight(m.content.slice(0, 80), searchQuery)}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {highlights.length > 0 && (
            <div
              style={{
                marginTop: 10,
                padding: '0.5rem 0.75rem',
                borderRadius: 10,
                border: '1px solid var(--tt-border)',
                background: 'rgba(255,255,255,0.78)',
                display: 'grid',
                gap: 6,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>Pinned / announcements</div>
              {highlights.slice(0, 3).map((m) => (
                <button
                  key={m.id}
                  onClick={() => scrollToMessage(m.id, { updateHash: true })}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    textAlign: 'left',
                    padding: 0,
                    cursor: 'pointer',
                    fontSize: 13,
                    color: '#111827',
                  }}
                >
                  <span style={{ fontWeight: 700, marginRight: 6 }}>{m.isAnnouncement ? '📣' : '📌'}</span>
                  <span style={{ color: '#6b7280' }}>{m.sender.displayName}:</span>{' '}
                  <span>{m.isDeleted ? 'This message was deleted' : m.content}</span>
                </button>
              ))}
            </div>
          )}
        </header>

        {error && (
          <div
            style={{
              marginBottom: '0.5rem',
              padding: '0.5rem 0.75rem',
              borderRadius: 8,
              background: 'rgba(239, 68, 68, 0.12)',
              color: '#991b1b',
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        {/* Messages */}
        <div
          ref={messagesContainerRef}
          className="scroll-column"
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: 12,
            paddingTop: 28,
            scrollPaddingTop: 28,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'stretch',
            gap: 10,
            background: 'rgba(255,255,255,0.32)',
            borderRadius: 16,
            border: '1px solid rgba(15, 23, 42, 0.06)',
          }}
        >
          {activeChannel && messages.length === 0 && (
            <p style={{ fontSize: 14, color: '#6b7280' }}>No messages in this channel yet. Start the conversation 👋</p>
          )}

          {newMsgCount > 0 && !stickToBottom && (
            <button
              onClick={() => {
                setNewMsgCount(0);
                messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
              }}
              style={{
                alignSelf: 'center',
                marginBottom: 8,
                padding: '0.35rem 0.75rem',
                borderRadius: 999,
                border: '1px solid var(--tt-border)',
                background: '#ffffff',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {newMsgCount} new message{newMsgCount === 1 ? '' : 's'} — Jump to latest
            </button>
          )}

          {/* Render with date separators + unread divider */}
          {(() => {
            if (isLoadingMessages) {
              return (
                <div style={{ display: 'grid', gap: 10, padding: '8px 2px' }}>
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div
                      key={i}
                      className="tt-skeleton"
                      style={{
                        height: 56,
                        borderRadius: 18,
                        width: '100%',
                        maxWidth: 640,
                        justifySelf: i % 3 === 0 ? 'end' : 'start',
                      }}
                    />
                  ))}
                </div>
              );
            }
            const rows: React.ReactNode[] = [];
            let lastDay: number | null = null;
            let unreadInserted = false;

            for (const m of filteredMessages) {
              const d = new Date(m.createdAt);
              const day = startOfDay(d);
              if (lastDay !== day) {
                rows.push(
                  <div
                    key={`day-${day}`}
                    style={{
                      alignSelf: 'center',
                      margin: '6px 0',
                      padding: '0.2rem 0.7rem',
                      borderRadius: 999,
                      background: 'rgba(255,255,255,0.72)',
                      color: 'var(--tt-muted)',
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    {dayLabel(d)}
                  </div>,
                );
                lastDay = day;
              }

              if (!unreadInserted && firstUnreadMessageId && m.id === firstUnreadMessageId) {
                unreadInserted = true;
                rows.push(
                  <div
                    key="unread-divider"
                    style={{
                      alignSelf: 'center',
                      margin: '10px 0 4px',
                      padding: '0.25rem 0.75rem',
                      borderRadius: 999,
                      background: '#fff7ed',
                      color: '#9a3412',
                      fontSize: 12,
                      fontWeight: 900,
                      border: '1px solid rgba(234, 88, 12, 0.25)',
                    }}
                    title={lastReadAtMs ? `Since ${new Date(lastReadAtMs).toLocaleString()}` : undefined}
                  >
                    New messages
                  </div>,
                );
              }

              const isMine = m.sender.id === currentUser.id;
              const canManage = isMine || isTeacher;
              const isMentioned = !m.isDeleted && containsMentionForUser(m.content, currentUser.displayName);
              const isFlashing = flashMessageId === m.id;

              rows.push(
                <div
                  key={m.id}
                  ref={(el) => {
                    messageRefs.current[m.id] = el;
                  }}
                  style={{
                    width: '100%',
                    maxWidth: 920,
                    display: 'flex',
                    justifyContent: isMine ? 'flex-end' : 'flex-start',
                  }}
                >
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                    {!isMine && (
                      <AvatarDot name={m.sender.displayName} src={m.sender.avatarUrl ?? null} size={30} />
                    )}

                    <div
                      style={{
                        maxWidth: '75%',
                        padding: '0.55rem 0.75rem',
                        borderRadius: 18,
                        borderBottomRightRadius: isMine ? 10 : 18,
                        borderBottomLeftRadius: isMine ? 18 : 10,
                        background: isMine ? 'var(--tt-bubble-out)' : 'var(--tt-bubble-in)',
                        color: isMine ? 'var(--tt-bubble-out-text)' : 'var(--tt-bubble-in-text)',
                        position: 'relative',
                        border: m.isAnnouncement
                          ? '2px solid rgba(245, 158, 11, 0.55)'
                          : m.isPinned
                            ? '2px solid rgba(37, 99, 235, 0.35)'
                            : isMentioned
                              ? '2px solid rgba(234, 88, 12, 0.35)'
                              : 'none',
                        transition: 'box-shadow 200ms ease',
                        boxShadow: isFlashing ? '0 0 0 4px rgba(0, 132, 255, 0.18)' : '0 10px 22px rgba(15, 23, 42, 0.06)',
                      }}
                    >
                    {/* Name + time */}
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'baseline',
                        gap: 8,
                        marginBottom: 4,
                      }}
                    >
                      <span style={{ fontWeight: 700, fontSize: 13 }}>
                        {m.sender.displayName}
                        {!isMine && onlineUserIds.has(m.sender.id) && (
                          <span
                            title="Online"
                            style={{ marginLeft: 6, fontSize: 10, color: '#22c55e', verticalAlign: 'middle' }}
                          >
                            ●
                          </span>
                        )}
                        {!isMine && !onlineUserIds.has(m.sender.id) && lastSeenMsByUserId[m.sender.id] && (
                          <span
                            title={new Date(lastSeenMsByUserId[m.sender.id]).toLocaleString()}
                            style={{ marginLeft: 6, fontSize: 11, fontWeight: 600, color: isMine ? 'rgba(249,250,251,0.8)' : '#9ca3af' }}
                          >
                            · {lastSeenLabel(lastSeenMsByUserId[m.sender.id])}
                          </span>
                        )}
                        {m.isAnnouncement && <span style={{ marginLeft: 6, fontSize: 12 }}>📣</span>}
                        {m.isPinned && !m.isAnnouncement && <span style={{ marginLeft: 6, fontSize: 12 }}>📌</span>}
                        {isMentioned && !isMine && <span style={{ marginLeft: 6, fontSize: 12 }}>@</span>}
                      </span>

                      <span style={{ fontSize: 11, color: isMine ? 'rgba(249,250,251,0.8)' : '#9ca3af' }}>
                        {timeLabel(d)}
                        {m.editedAt ? ' • edited' : ''}
                      </span>
                    </div>

                    {/* Reply preview */}
                    {m.replyTo && (
                      <div
                        style={{
                          padding: '0.35rem 0.5rem',
                          borderRadius: 10,
                          background: isMine ? 'rgba(255,255,255,0.18)' : 'rgba(15, 23, 42, 0.06)',
                          color: isMine ? 'rgba(255,255,255,0.92)' : '#374151',
                          fontSize: 12,
                          marginBottom: 6,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, marginBottom: 2 }}>
                          <AvatarDot
                            name={m.replyTo.sender.displayName}
                            src={m.replyTo.sender.avatarUrl ?? null}
                            size={18}
                          />
                          <span>Replying to {m.replyTo.sender.displayName}</span>
                        </div>
                        <div style={{ opacity: 0.9 }}>
                          {m.replyTo.isDeleted ? 'This message was deleted' : m.replyTo.content}
                        </div>
                      </div>
                    )}

                    {/* Message text */}
                    <div style={{ fontSize: 14, wordBreak: 'break-word' }}>
                      {m.isDeleted ? <i>This message was deleted</i> : renderTextWithMentionsAndSearch(m.content, searchQuery)}
                    </div>

                    {/* Link preview */}
                    {!m.isDeleted && <LinkPreview text={m.content} inverted={isMine} />}

                    {/* Attachments */}
                    {!m.isDeleted && renderAttachments(m.attachments ?? [], isMine)}

                    {/* Actions */}
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 6,
                        marginTop: 8,
                        justifyContent: isMine ? 'flex-end' : 'flex-start',
                        alignItems: 'center',
                      }}
                    >
                      {/* Existing reactions */}
                      {(m.reactions ?? [])
                        .filter((r) => r.count > 0)
                        .map((r) => (
                          <button
                            key={r.emoji}
                            onClick={() => toggleReaction(m.id, r.emoji)}
                            style={{
                              border: 'none',
                              cursor: 'pointer',
                              padding: '0.15rem 0.45rem',
                              borderRadius: 999,
                              background: r.me
                                ? isMine
                                  ? 'rgba(255,255,255,0.22)'
                                  : 'rgba(0, 132, 255, 0.14)'
                                : isMine
                                  ? 'rgba(255,255,255,0.12)'
                                  : 'rgba(15, 23, 42, 0.06)',
                              color: isMine ? '#fff' : '#111827',
                              fontSize: 12,
                              fontWeight: 800,
                              display: 'flex',
                              gap: 6,
                              alignItems: 'center',
                            }}
                            title={r.emoji}
                          >
                            {renderReactionFace(r.emoji)}
                            <span style={{ opacity: 0.95 }}>{r.count}</span>
                          </button>
                        ))}

                      {/* Emoji picker (full reactions + custom) */}
                      <EmojiPicker
                        onPick={(emoji) => toggleReaction(m.id, emoji)}
                        customEmojis={customEmojis}
                        setCustomEmojis={setCustomEmojis}
                        title="Add reaction"
                      />

                      {/* Share link */}
                      <button
                        onClick={() => copyMessageLink(m)}
                        style={{
                          border: 'none',
                          cursor: 'pointer',
                          padding: '0.15rem 0.45rem',
                          borderRadius: 999,
                          background: isMine ? 'rgba(255,255,255,0.12)' : 'rgba(15, 23, 42, 0.06)',
                          color: isMine ? '#fff' : '#111827',
                          fontSize: 12,
                          fontWeight: 800,
                        }}
                        title="Copy link to this message"
                      >
                        🔗 Link
                      </button>

                      {/* Reply */}
                      {!m.isDeleted && (
                        <button
                          onClick={() => beginReply(m)}
                          style={{
                            border: 'none',
                            cursor: 'pointer',
                            padding: '0.15rem 0.45rem',
                            borderRadius: 999,
                            background: isMine ? 'rgba(255,255,255,0.12)' : 'rgba(15, 23, 42, 0.06)',
                            color: isMine ? '#fff' : '#111827',
                            fontSize: 12,
                            fontWeight: 700,
                          }}
                        >
                          Reply
                        </button>
                      )}

                      {/* Edit / Delete */}
                      {canManage && !m.isDeleted && (
                        <>
                          <button
                            onClick={() => beginEdit(m)}
                            style={{
                              border: 'none',
                              cursor: 'pointer',
                              padding: '0.15rem 0.45rem',
                              borderRadius: 999,
                              background: isMine ? 'rgba(255,255,255,0.12)' : 'rgba(15, 23, 42, 0.06)',
                              color: isMine ? '#fff' : '#111827',
                              fontSize: 12,
                              fontWeight: 700,
                            }}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => requestDelete(m)}
                            style={{
                              border: 'none',
                              cursor: 'pointer',
                              padding: '0.15rem 0.45rem',
                              borderRadius: 999,
                              background: 'rgba(239, 68, 68, 0.14)',
                              color: isMine ? '#fff' : '#991b1b',
                              fontSize: 12,
                              fontWeight: 800,
                            }}
                          >
                            Delete
                          </button>
                        </>
                      )}

                      {/* Pin / Announcement (teacher) */}
                      {isTeacher && (
                        <>
                          <button
                            onClick={() => togglePinned(m)}
                            style={{
                              border: 'none',
                              cursor: 'pointer',
                              padding: '0.15rem 0.45rem',
                              borderRadius: 999,
                              background: m.isPinned
                                ? 'rgba(37, 99, 235, 0.26)'
                                : isMine
                                  ? 'rgba(255,255,255,0.12)'
                                  : 'rgba(15, 23, 42, 0.06)',
                              color: isMine ? '#fff' : '#111827',
                              fontSize: 12,
                              fontWeight: 800,
                            }}
                          >
                            {m.isPinned ? 'Unpin' : 'Pin'}
                          </button>

                          <button
                            onClick={() => toggleAnnouncement(m)}
                            style={{
                              border: 'none',
                              cursor: 'pointer',
                              padding: '0.15rem 0.45rem',
                              borderRadius: 999,
                              background: m.isAnnouncement
                                ? 'rgba(245, 158, 11, 0.24)'
                                : isMine
                                  ? 'rgba(255,255,255,0.12)'
                                  : 'rgba(15, 23, 42, 0.06)',
                              color: isMine ? '#fff' : '#111827',
                              fontSize: 12,
                              fontWeight: 800,
                            }}
                          >
                            {m.isAnnouncement ? 'Unannounce' : 'Announce'}
                          </button>
                        </>
                      )}
                    </div>

                    {/* Status: Sent/Delivered/Seen by X (only on my messages) */}
                    {isMine && (m as any).receipt?.statusForSender && (
                      <div style={{ marginTop: 6, fontSize: 11, color: 'rgba(249,250,251,0.85)' }}>
                        {(m as any).receipt.statusForSender === 'sent' && 'Sent'}
                        {(m as any).receipt.statusForSender === 'delivered' && 'Delivered'}
                        {(m as any).receipt.statusForSender === 'seen' && (
                          <>
                            Seen
                            {(m as any).receipt.seenBy?.length ? (
                              <> by {(m as any).receipt.seenBy.map((x: any) => x.displayName).join(', ')}</>
                            ) : null}
                            {(m as any).receipt.lastSeenAt ? (
                              <span style={{ marginLeft: 6, opacity: 0.9 }}>
                                ·{' '}
                                {new Date((m as any).receipt.lastSeenAt).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            ) : null}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  </div>
                </div>,
              );
            }

            return rows;
          })()}

          <div ref={messagesEndRef} />
        </div>

        {/* Typing indicator with avatars */}
        {typingUsers.length > 0 && (
          <div
            style={{
              margin: '0.25rem 0',
              color: 'var(--tt-muted)',
              fontSize: 13,
              display: 'flex',
              gap: 10,
              alignItems: 'center',
            }}
          >
            <AvatarStack users={typingUsers.map((u) => ({ displayName: u.displayName, avatarUrl: u.avatarUrl ?? null }))} />
            <div>
              {typingUsers.length === 1
                ? `${typingUsers[0].displayName} is typing…`
                : `${typingUsers
                    .map((u) => u.displayName)
                    .slice(0, 2)
                    .join(', ')}${typingUsers.length > 2 ? ` +${typingUsers.length - 2}` : ''} are typing…`}
            </div>
          </div>
        )}

        {/* Reply / Edit banners */}
        {(replyingTo || editing) && (
          <div
            style={{
              marginTop: 10,
              marginBottom: 6,
              padding: '0.5rem 0.75rem',
              borderRadius: 10,
              background: 'rgba(255,255,255,0.72)',
              border: '1px solid var(--tt-border)',
              display: 'flex',
              justifyContent: 'space-between',
              gap: 10,
              alignItems: 'center',
            }}
          >
            <div style={{ fontSize: 13, color: '#111827' }}>
              {editing ? (
                <>
                  <b>Editing</b>: {editing.isDeleted ? 'This message was deleted' : editing.content}
                </>
              ) : (
                <>
                  <b>Replying to {replyingTo?.sender.displayName}</b>:{' '}
                  {replyingTo?.isDeleted ? 'This message was deleted' : replyingTo?.content}
                </>
              )}
            </div>
            <button
              onClick={() => {
                setReplyingTo(null);
                setEditing(null);
                setChatInput('');
              }}
              style={{
                border: 'none',
                cursor: 'pointer',
                padding: '0.35rem 0.6rem',
                borderRadius: 999,
                background: '#ffffff',
                borderColor: '#d1d5db',
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              Cancel
            </button>
          </div>
        )}

        {/* Pending attachments / voice preview */}
        {(pendingFiles.length > 0 || pendingVoice) && (
          <div
            style={{
              borderTop: '1px solid var(--tt-border)',
              paddingTop: '0.5rem',
              marginTop: '0.5rem',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              alignItems: 'center',
            }}
          >
            {pendingFiles.map((p) =>
              p.kind === 'IMAGE' ? (
                <div key={p.id} style={{ position: 'relative' }}>
                  <img
                    src={p.previewUrl}
                    alt={p.file.name}
                    style={{ width: 74, height: 74, objectFit: 'cover', borderRadius: 18, border: '1px solid var(--tt-border)' }}
                  />
                  <button
                    type="button"
                    onClick={() => removePendingFile(p.id)}
                    title="Remove"
                    style={{
                      position: 'absolute',
                      top: -6,
                      right: -6,
                      width: 22,
                      height: 22,
                      borderRadius: 999,
                      border: '1px solid var(--tt-border)',
                      background: 'rgba(255,255,255,0.78)',
                      cursor: 'pointer',
                      fontWeight: 900,
                    }}
                  >
                    ×
                  </button>
                </div>
              ) : (
                <div
                  key={p.id}
                  style={{
                    position: 'relative',
                    border: '1px solid var(--tt-border)',
                    background: 'rgba(255,255,255,0.78)',
                    borderRadius: 18,
                    padding: '0.35rem 0.55rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    maxWidth: '55vw',
                  }}
                >
                  <span style={{ fontWeight: 900 }}>📄</span>
                  <span style={{ fontSize: 12, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p.file.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => removePendingFile(p.id)}
                    title="Remove"
                    style={{
                      marginLeft: 4,
                      width: 22,
                      height: 22,
                      borderRadius: 999,
                      border: '1px solid var(--tt-border)',
                      background: 'rgba(255,255,255,0.78)',
                      cursor: 'pointer',
                      fontWeight: 900,
                    }}
                  >
                    ×
                  </button>
                </div>
              ),
            )}

            {pendingVoice && (
              <div
                style={{
                  border: '1px solid var(--tt-border)',
                  background: 'rgba(255,255,255,0.78)',
                  borderRadius: 18,
                  padding: '0.35rem 0.55rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span style={{ fontWeight: 900 }}>🎙️</span>
                <audio controls src={pendingVoice.previewUrl} style={{ width: 220, maxWidth: '55vw' }} />
                <button
                  type="button"
                  onClick={() =>
                    setPendingVoice((prev) => {
                      if (prev) revokeUrl(prev.previewUrl);
                      return null;
                    })
                  }
                  title="Remove"
                  style={{
                    marginLeft: 4,
                    width: 22,
                    height: 22,
                    borderRadius: 999,
                    border: '1px solid var(--tt-border)',
                    background: 'rgba(255,255,255,0.78)',
                    cursor: 'pointer',
                    fontWeight: 900,
                  }}
                >
                  ×
                </button>
              </div>
            )}
          </div>
        )}

        {/* Hidden file picker */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => addPickedFiles(e.target.files)}
        />

        {/* Input */}
        <form
          onSubmit={handleSend}
          style={{
            borderTop: pendingFiles.length === 0 && !pendingVoice ? '1px solid var(--tt-border)' : 'none',
            paddingTop: '0.5rem',
            marginTop: '0.5rem',
            display: 'flex',
            gap: '0.5rem',
            alignItems: 'center',
          }}
        >
          {/* Attach */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!activeChannel || Boolean(editing) || isUploading || isRecording}
            title={editing ? 'Finish editing before attaching' : 'Attach image or PDF'}
            style={{
              width: 40,
              height: 40,
              borderRadius: 999,
              border: '1px solid var(--tt-border)',
              background: 'rgba(255,255,255,0.78)',
              cursor: !activeChannel || editing || isUploading || isRecording ? 'not-allowed' : 'pointer',
              opacity: !activeChannel || editing || isUploading || isRecording ? 0.6 : 1,
              fontWeight: 900,
            }}
          >
            📎
          </button>

          {/* Record */}
          <button
            type="button"
            onClick={() => (isRecording ? stopRecording() : startRecording())}
            disabled={!activeChannel || Boolean(editing) || isUploading}
            title={isRecording ? 'Stop recording' : 'Record voice note'}
            style={{
              width: 40,
              height: 40,
              borderRadius: 999,
              border: isRecording ? '1px solid rgba(220,38,38,0.6)' : '1px solid #d1d5db',
              background: isRecording ? 'rgba(220,38,38,0.06)' : '#fff',
              cursor: !activeChannel || editing || isUploading ? 'not-allowed' : 'pointer',
              opacity: !activeChannel || editing || isUploading ? 0.6 : 1,
              fontWeight: 900,
            }}
          >
            {isRecording ? '⏹' : '🎙️'}
          </button>

          <input
            value={chatInput}
            onChange={(e) => {
              setChatInput(e.target.value);
              handleTypingEvent();
            }}
            placeholder={
              activeChannel
                ? `Message this channel (mention: ${toCustomToken('optional_custom')}, ${mentionTokenForUser(currentUser.displayName)})`
                : 'Select a channel first'
            }
            disabled={!activeChannel || isUploading}
            style={{
              flex: 1,
              padding: '0.5rem 0.75rem',
              borderRadius: 999,
              border: '1px solid var(--tt-border)',
              fontSize: 14,
            }}
          />

          <button
            type="submit"
            disabled={!activeChannel || isUploading || isRecording || (!chatInput.trim() && pendingFiles.length === 0 && !pendingVoice)}
            style={{
              padding: '0.4rem 1rem',
              borderRadius: 999,
              border: 'none',
              background: 'var(--tt-accent)',
              color: '#fff',
              fontWeight: 700,
              fontSize: 14,
              cursor:
                !activeChannel || isUploading || isRecording || (!chatInput.trim() && pendingFiles.length === 0 && !pendingVoice)
                  ? 'not-allowed'
                  : 'pointer',
              opacity:
                !activeChannel || isUploading || isRecording || (!chatInput.trim() && pendingFiles.length === 0 && !pendingVoice) ? 0.6 : 1,
            }}
          >
            {isUploading ? 'Uploading…' : editing ? 'Save' : 'Send'}
          </button>
        </form>

        {/* Recording indicator */}
        {isRecording && (
          <div style={{ marginTop: 6, fontSize: 12, fontWeight: 800, color: '#dc2626' }}>
            Recording… {recordSeconds}s
          </div>
        )}

        {/* Toasts (mentions, link copied) */}
        {toasts.length > 0 && (
          <div style={{ position: 'absolute', right: 12, bottom: 12, display: 'grid', gap: 8, zIndex: 50 }}>
            {toasts.map((t) => (
              <button
                key={t.id}
                onClick={() => t.onClick?.()}
                style={{
                  border: '1px solid var(--tt-border)',
                  background: 'rgba(255,255,255,0.78)',
                  borderRadius: 18,
                  boxShadow: '0 18px 45px rgba(15, 23, 42, 0.14)',
                  padding: '10px 12px',
                  cursor: t.onClick ? 'pointer' : 'default',
                  width: 320,
                  maxWidth: '80vw',
                  textAlign: 'left',
                }}
                title={t.onClick ? 'Click to jump' : undefined}
              >
                <div style={{ fontWeight: 900, fontSize: 12, color: '#111827', marginBottom: 4 }}>{t.title}</div>
                <div style={{ fontSize: 12, color: '#374151' }}>{t.body}</div>
              </button>
            ))}
          </div>
        )}
      </main>
    )}
  </div>
);
};

export default ChatPage;
