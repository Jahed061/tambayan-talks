import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { socket as sharedSocket } from '../socket';
import {
  DMMessageDTO,
  DMThreadDTO,
  ReactionEmoji,
  ReactionSummaryDTO,
  createDmThread,
  getDmMessages,
  getDmThreads,
  searchUsers,
  UserSearchDTO,
  sendDmMessage,
  uploadAttachments,
  MessageAttachmentDTO,
  CurrentUserDTO,
  api,
} from '../api/http';

import LinkPreview from '../ui/LinkPreview';
import { AvatarDot, AvatarStack } from '../ui/chatUi';

import EmojiPicker from '../ui/EmojiPicker';
import {
  type CustomEmoji,
  customEmojiUrlForToken,
  loadCustomEmojis,
} from '../ui/customEmojis';

type Props = { currentUser: CurrentUserDTO };


type Toast = { id: string; title: string; body: string; kind?: 'error' | 'success' };

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

function getStoredToken(): string | null {
  // Prefer sessionStorage, but fallback to localStorage
  return sessionStorage.getItem('token') || localStorage.getItem('token');
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlight(text: string, query: string): React.ReactNode {
  const q = query.trim();
  if (!q) return text;

  const re = new RegExp(`(${escapeRegExp(q)})`, 'ig');
  const parts = text.split(re);

  return (
    <>
      {parts.map((p, i) => {
        const isHit = i % 2 === 1;
        return isHit ? (
          <mark key={i} style={{ padding: 0, borderRadius: 4 }}>
            {p}
          </mark>
        ) : (
          <React.Fragment key={i}>{p}</React.Fragment>
        );
      })}
    </>
  );
}

type ReceiptDTO = {
  deliveredCount: number;
  seenCount: number;
  lastSeenAt: string | null;
  seenBy: { id: string; displayName: string; seenAt: string }[];
};

type DMMessageWithReceipt = DMMessageDTO & { receipt?: ReceiptDTO };

const PrivateMessagesPage: React.FC<Props> = ({ currentUser }) => {
  const [threads, setThreads] = useState<DMThreadDTO[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 768px)').matches : false,
  );
  const [mobilePane, setMobilePane] = useState<'list' | 'chat'>('list');

  useEffect(() => {
    const mql = window.matchMedia('(max-width: 768px)');
    const onChange = () => setIsMobile(mql.matches);
    onChange();
    mql.addEventListener?.('change', onChange);
    return () => mql.removeEventListener?.('change', onChange);
  }, []);

  
  // Mark this screen as "messages view" so the app shell doesn't become the scroll container on mobile.
  useEffect(() => {
    document.documentElement.classList.add('tt-in-messages');
    return () => document.documentElement.classList.remove('tt-in-messages');
  }, []);

// When switching to desktop, show the split view (keep chat open if selected)
  useEffect(() => {
    if (!isMobile) setMobilePane('chat');
    if (isMobile && !activeThreadId) setMobilePane('list');
  }, [isMobile, activeThreadId]);

  const [messages, setMessages] = useState<DMMessageWithReceipt[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingThreads, setIsLoadingThreads] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = (t: Omit<Toast, 'id'>) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts((prev) => [{ id, ...t }, ...prev].slice(0, 4));
    window.setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 4500);
  };

  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  // ✅ reply + reactions (DM parity with channel chat)
  const [replyingTo, setReplyingTo] = useState<DMMessageWithReceipt | null>(null);
  const [customEmojis, setCustomEmojis] = useState<CustomEmoji[]>(() => loadCustomEmojis());
  const [newDmEmail, setNewDmEmail] = useState('');
  const [unreadByThread, setUnreadByThread] = useState<Record<string, number>>({});

  // ✅ search
  const [searchQuery, setSearchQuery] = useState('');
  const [threadFilter, setThreadFilter] = useState('');

  // User discovery (search by username/email to start a DM)
  const [userQuery, setUserQuery] = useState('');
  const [userResults, setUserResults] = useState<UserSearchDTO[]>([]);
  const [isSearchingUsers, setIsSearchingUsers] = useState(false);
  const userSearchTimerRef = useRef<number | null>(null);

  const filteredThreads = useMemo(() => {
    const q = threadFilter.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((t) => (t.otherUser?.displayName ?? '').toLowerCase().includes(q));
  }, [threads, threadFilter]);

  // Debounced user search (min 2 chars)
  useEffect(() => {
    const q = userQuery.trim();

    if (userSearchTimerRef.current) {
      window.clearTimeout(userSearchTimerRef.current);
      userSearchTimerRef.current = null;
    }

    if (q.length < 2) {
      setUserResults([]);
      setIsSearchingUsers(false);
      return;
    }

    setIsSearchingUsers(true);
    userSearchTimerRef.current = window.setTimeout(async () => {
      try {
        const list = await searchUsers(q);
        setUserResults(list);
      } catch (err: any) {
        console.error('User search failed', err);
        setUserResults([]);
      } finally {
        setIsSearchingUsers(false);
      }
    }, 250);

    return () => {
      if (userSearchTimerRef.current) {
        window.clearTimeout(userSearchTimerRef.current);
        userSearchTimerRef.current = null;
      }
    };
  }, [userQuery]);

  // ✅ typing
  const [typingUsers, setTypingUsers] = useState<{ userId: string; displayName: string; avatarUrl?: string | null }[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const typingTimeoutRef = useRef<number | null>(null);

  // ✅ scroll + new message indicator
  const [stickToBottom, setStickToBottom] = useState(true);
  const stickToBottomRef = useRef(true);
  const [newMsgCount, setNewMsgCount] = useState(0);

  const socketRef = useRef<Socket | null>(null);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(() => new Set());
  const [lastSeenMsByUserId, setLastSeenMsByUserId] = useState<Record<string, number>>({});
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const lastMsgIdRef = useRef<string>('');

  const scrollToBottom = (behavior: ScrollBehavior = 'auto') => {
    const el = messagesContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  };


  const activeThreadIdRef = useRef<string | null>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  useEffect(() => {
    stickToBottomRef.current = stickToBottom;
    if (stickToBottom) setNewMsgCount(0);
  }, [stickToBottom]);

  // Track scroll position (stick-to-bottom)
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

  const stopTypingNow = () => {
    const socket = socketRef.current;
    if (!socket || !activeThreadId) return;

    socket.emit('dm_stop_typing', { threadId: activeThreadId, userId: currentUser.id });

    setIsTyping(false);
    if (typingTimeoutRef.current) {
      window.clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
  };

  const handleTypingEvent = () => {
    const socket = socketRef.current;
    if (!socket || !activeThreadId) return;

    if (!isTyping) {
      socket.emit('dm_typing', {
        threadId: activeThreadId,
        userId: currentUser.id,
        displayName: currentUser.displayName,
        avatarUrl: currentUser.avatarUrl ?? null,
      });
      setIsTyping(true);
    }

    if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);

    typingTimeoutRef.current = window.setTimeout(() => {
      socket.emit('dm_stop_typing', { threadId: activeThreadId, userId: currentUser.id });
      setIsTyping(false);
    }, 900);
  };

  // ---------- Attachments + voice (DMs) ----------
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
    durationMs?: number | null;
  };

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);

  const pendingFilesRef = useRef<PendingLocalAttachment[]>([]);
  const pendingVoiceRef = useRef<PendingVoiceNote | null>(null);

  const [pendingFiles, setPendingFiles] = useState<PendingLocalAttachment[]>([]);
  const [pendingVoice, setPendingVoice] = useState<PendingVoiceNote | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);

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

      const preferred = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/ogg'];
      const mimeType = preferred.find((t) => MediaRecorder.isTypeSupported?.(t)) ?? '';

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      recordChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recordChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
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

  const scrollToMessage = (id: string) => {
    const el = messageRefs.current[id];
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return messages
      .filter((m) => `${m.content} ${m.senderName}`.toLowerCase().includes(q))
      .slice(-50)
      .reverse();
  }, [messages, searchQuery]);

  // ---------- Socket: SINGLE authenticated connection ----------
  useEffect(() => {
    setError(null);

    const token = getStoredToken();
    if (!token) {
      // REST fallback still works, but realtime won't
      console.warn('[DM] No token in storage; realtime socket disabled.');
      socketRef.current?.disconnect();
      socketRef.current = null;
      return;
    }

    // Keep sessionStorage in sync (optional)
    if (!sessionStorage.getItem('token')) {
      sessionStorage.setItem('token', token);
    }

    socketRef.current?.disconnect();

    const socket: Socket = sharedSocket;
    socket.auth = { token };
    if (!socket.connected) socket.connect();
    socketRef.current = socket;

    const handleDmMessage = (dto: DMMessageDTO) => {
      const currentActive = activeThreadIdRef.current;

      if (dto.threadId === currentActive) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === dto.id)) return prev;
          return [...prev, dto as DMMessageWithReceipt];
        });

        // ✅ mark delivered/seen for messages from other user
        if (dto.senderId !== currentUser.id) {
          socket.emit('dm_delivered', { threadId: dto.threadId, messageId: dto.id });
          if (stickToBottomRef.current) socket.emit('dm_seen', { threadId: dto.threadId, messageId: dto.id });
        }

        if (!stickToBottomRef.current) setNewMsgCount((c) => c + 1);
      } else {
        setUnreadByThread((prev) => ({
          ...prev,
          [dto.threadId]: (prev[dto.threadId] ?? 0) + 1,
        }));
      }

      // Update thread preview
      const previewContent =
        dto.content?.trim()
          ? dto.content
          : dto.attachments && dto.attachments.length
            ? dto.attachments.some((a) => a.kind === 'AUDIO')
              ? '🎙️ Voice message'
              : dto.attachments.some((a) => a.kind === 'IMAGE')
                ? '📷 Photo'
                : '📎 Attachment'
            : '';

      setThreads((prev) =>
        prev.map((t) => {
          if (t.id !== dto.threadId) return t;
          return {
            ...t,
            lastMessage: {
              id: dto.id,
              content: previewContent,
              createdAt: dto.createdAt,
              senderId: dto.senderId,
              senderName: dto.senderName,
            },
          };
        }),
      );
    };

    const handleDmMessageUpdated = (dto: DMMessageDTO) => {
      if (dto.threadId !== activeThreadIdRef.current) return;
      setMessages((prev) => prev.map((m) => (m.id === dto.id ? ({ ...m, ...dto } as DMMessageWithReceipt) : m)));
    };

    const handleDmTyping = (payload: { threadId: string; userId: string; displayName: string; avatarUrl?: string | null }) => {
      if (payload.threadId !== activeThreadIdRef.current) return;
      if (payload.userId === currentUser.id) return;

      setTypingUsers((prev) => {
        if (prev.some((x) => x.userId === payload.userId)) return prev;
        return [...prev, { userId: payload.userId, displayName: payload.displayName, avatarUrl: payload.avatarUrl ?? null }];
      });
    };

    const handleDmStopTyping = (payload: { threadId: string; userId: string }) => {
      if (payload.threadId !== activeThreadIdRef.current) return;
      setTypingUsers((prev) => prev.filter((x) => x.userId !== payload.userId));
    };

    const handleDmReceipt = (payload: any) => {
      if (payload.threadId !== activeThreadIdRef.current) return;

      setMessages((prev) =>
        prev.map((m) =>
          m.id !== payload.messageId
            ? m
            : ({
                ...m,
                receipt: {
                  deliveredCount: payload.aggregate?.deliveredCount ?? m.receipt?.deliveredCount ?? 0,
                  seenCount: payload.aggregate?.seenCount ?? m.receipt?.seenCount ?? 0,
                  lastSeenAt: payload.aggregate?.lastSeenAt ?? m.receipt?.lastSeenAt ?? null,
                  seenBy: payload.aggregate?.seenBy ?? m.receipt?.seenBy ?? [],
                },
              } as DMMessageWithReceipt),
        ),
      );
    };

    const handleDmError = (payload: any) => {
      console.error('[DM] dm_error', payload);
      setError(payload?.error || 'DM socket error');
    };

    socket.on('dm_message', handleDmMessage);
    socket.on('dm_message_updated', handleDmMessageUpdated);
    socket.on('dm_typing', handleDmTyping);
    socket.on('dm_stop_typing', handleDmStopTyping);
    socket.on('dm_receipt', handleDmReceipt);
    socket.on('dm_error', handleDmError);

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

    return () => {
      socket.off('dm_message', handleDmMessage);
      socket.off('dm_message_updated', handleDmMessageUpdated);
      socket.off('dm_typing', handleDmTyping);
      socket.off('dm_stop_typing', handleDmStopTyping);
      socket.off('dm_receipt', handleDmReceipt);
      socket.off('dm_error', handleDmError);
      socket.off('presence_snapshot');
      socket.off('presence_update');
      socket.disconnect();
      socketRef.current = null;
    };
  }, [currentUser.id, currentUser.displayName]);

  // Join the room for the active thread (realtime)
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !activeThreadId) return;

    socket.emit('join_dm', { threadId: activeThreadId });
  }, [activeThreadId]);

  // ---------- Load threads initially ----------
  useEffect(() => {
    (async () => {
      setIsLoadingThreads(true);
      try {
        setError(null);
        const list = await getDmThreads();
        setThreads(list);
        if (list.length > 0) setActiveThreadId(list[0].id);
      } catch (err: any) {
        const msg = err?.message || 'Failed to load DM threads';
        setError(msg);
        toast({ title: 'Error', body: msg, kind: 'error' });
      } finally {
        setIsLoadingThreads(false);
      }
    })();
  }, []);

  // ---------- Load messages when thread changes ----------
  useEffect(() => {
    if (!activeThreadId) return;

    (async () => {
      setIsLoadingMessages(true);
      try {
        setError(null);
        const list = (await getDmMessages(activeThreadId)) as unknown as DMMessageWithReceipt[];
        setMessages(list);
        setTypingUsers([]);
        setSearchQuery('');
        setReplyingTo(null);
        setNewMsgCount(0);

        setUnreadByThread((prev) => ({ ...prev, [activeThreadId]: 0 }));

        // ✅ mark delivered (and optionally seen if already at bottom)
        const socket = socketRef.current;
        if (socket && socket.connected) {
          const ids = list.filter((m) => m.senderId !== currentUser.id).map((m) => m.id);
          socket.emit('dm_bulk_delivered', { threadId: activeThreadId, messageIds: ids });
          if (stickToBottomRef.current) socket.emit('dm_bulk_seen', { threadId: activeThreadId, messageIds: ids });
        }
      } catch (err: any) {
        const msg = err?.message || 'Failed to load DM messages';
        setError(msg);
        toast({ title: 'Error', body: msg, kind: 'error' });
      } finally {
        setIsLoadingMessages(false);
      }
    })();

    // If socket exists, no need to poll
    if (socketRef.current) return;

    const interval = setInterval(async () => {
      setIsLoadingMessages(true);
      try {
        const list = (await getDmMessages(activeThreadId)) as unknown as DMMessageWithReceipt[];
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          const merged = [...prev];
          for (const m of list) {
            if (!seen.has(m.id)) merged.push(m);
          }
          merged.sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
          return merged;
        });
      } catch {
        // ignore polling errors
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [activeThreadId, currentUser.id]);

  // When user reaches bottom, mark visible incoming messages as seen (realtime)
  useEffect(() => {
    if (!stickToBottom || !activeThreadId) return;
    const socket = socketRef.current;
    if (!socket || !socket.connected) return;

    const ids = messages.filter((m) => m.senderId !== currentUser.id).map((m) => m.id);
    if (ids.length) socket.emit('dm_bulk_seen', { threadId: activeThreadId, messageIds: ids });
  }, [stickToBottom, activeThreadId, messages, currentUser.id]);

  // Auto-scroll ONLY when a new message arrives AND the user was already at bottom
  useEffect(() => {
    if (!activeThreadId) return;

    const last = messages[messages.length - 1];
    const lastId = last?.id ?? '';

    // No message / same message (polling refresh etc.) → don't scroll
    if (!lastId || lastId === lastMsgIdRef.current) return;

    lastMsgIdRef.current = lastId;

    if (stickToBottomRef.current) {
      requestAnimationFrame(() => scrollToBottom('auto'));
    } else {
      // user is reading history; show jump badge
      setNewMsgCount((c) => c + 1);
    }
  }, [messages, activeThreadId]);

// ---------- Start DM by email ----------
  const handleStartDm = async () => {
    if (!newDmEmail.trim()) return;

    try {
      setError(null);

      const data = await api<{
        threadId: string;
        otherUser: { id: string; displayName: string };
      }>(`/api/dms/start`, {
        method: 'POST',
        body: JSON.stringify({ otherUserEmail: newDmEmail.trim() }),
      });

      const list = await getDmThreads();
      setThreads(list);
      setActiveThreadId(data.threadId);
      setUnreadByThread((prev) => ({ ...prev, [data.threadId]: 0 }));
      setNewDmEmail('');
    } catch (err: any) {
      setError(err.message || 'Failed to start DM');
    }
  };

  // ---------- Start DM by user selection (username/email search) ----------
  const handleStartDmWithUser = async (u: UserSearchDTO) => {
    try {
      setError(null);
      const data = await createDmThread(u.id);
      const list = await getDmThreads();
      setThreads(list);
      setActiveThreadId(data.threadId);
      setUnreadByThread((prev) => ({ ...prev, [data.threadId]: 0 }));
      setUserQuery('');
      setUserResults([]);
      if (isMobile) setMobilePane('chat');
    } catch (err: any) {
      setError(err.message || 'Failed to start DM');
    }
  };

  const beginReply = (m: DMMessageWithReceipt) => {
    setReplyingTo(m);
    // focus the input so replying feels instant
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const renderReactionFace = (emoji: string) => {
    const url = customEmojiUrlForToken(emoji, customEmojis);
    if (url) return <img src={url} alt={emoji} style={{ width: 16, height: 16, objectFit: 'contain' }} />;
    return <span>{emoji}</span>;
  };

  const toggleDmReaction = (messageId: string, emoji: ReactionEmoji) => {
    if (!activeThreadId) return;

    // optimistic UI
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId) return m;

        const list: ReactionSummaryDTO[] = [...(m.reactions ?? [])];
        const idx = list.findIndex((r) => r.emoji === emoji);
        if (idx >= 0) {
          const r = list[idx];
          const nextCount = r.me ? r.count - 1 : r.count + 1;
          const nextMe = !r.me;
          if (nextCount <= 0) {
            list.splice(idx, 1);
          } else {
            list[idx] = { ...r, count: nextCount, me: nextMe };
          }
        } else {
          list.push({ emoji, count: 1, me: true });
        }

        return { ...m, reactions: list };
      }),
    );

    // realtime (if supported by server)
    const socket = socketRef.current;
    if (socket && socket.connected) {
      socket.emit('dm_react_message', { threadId: activeThreadId, messageId, emoji });
    }
  };

  // ---------- Send message ----------
  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeThreadId) return;
    if (isRecording || isUploading) return;

    const text = input.trim();
    const hasPending = pendingFiles.length > 0 || Boolean(pendingVoice);
    if (!text && !hasPending) return;

    setInput('');

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

    // Carry over duration if we have it (upload API may not return duration)
    const attachmentsWithDur = uploaded.map((a) =>
      a.kind === 'AUDIO' && pendingVoice?.durationMs ? { ...a, durationMs: pendingVoice.durationMs } : a,
    );

    const socket = socketRef.current;
    const replyToId = replyingTo?.id ?? null;

    try {
      if (socket && socket.connected) {
        socket.emit('send_dm', {
          threadId: activeThreadId,
          content: text,
          attachments: attachmentsWithDur,
          replyToId,
        });
        clearPendingUploads();
        setReplyingTo(null);
        stopTypingNow();
        return;
      }

      // REST fallback
      const created = (await sendDmMessage(activeThreadId, text, attachmentsWithDur, replyToId)) as unknown as DMMessageWithReceipt;

      setMessages((prev) => {
        if (prev.some((m) => m.id === created.id)) return prev;
        return [...prev, created];
      });

      const previewContent =
        created.content?.trim()
          ? created.content
          : created.attachments && created.attachments.length
            ? created.attachments.some((a) => a.kind === 'AUDIO')
              ? '🎙️ Voice message'
              : created.attachments.some((a) => a.kind === 'IMAGE')
                ? '📷 Photo'
                : '📎 Attachment'
            : '';

      setThreads((prev) =>
        prev.map((t) => {
          if (t.id !== activeThreadId) return t;
          return {
            ...t,
            lastMessage: {
              id: created.id,
              content: previewContent,
              createdAt: created.createdAt,
              senderId: created.senderId,
              senderName: created.senderName,
            },
          };
        }),
      );

      clearPendingUploads();
      setReplyingTo(null);
      stopTypingNow();
    } catch (err: any) {
      setError(err.message || 'Failed to send DM');
    }
  };

  const activeThread = threads.find((t) => t.id === activeThreadId) || null;

  const renderAttachments = (attachments: MessageAttachmentDTO[] | undefined, isMine: boolean) => {
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
    <div className="tt-dm-shell">
      {/* Sidebar */}
      {(!isMobile || mobilePane === 'list') && (
      <aside className="tt-panel tt-dm-listPane">
        <h2 style={{ fontSize: 16, fontWeight: 900 }}>Direct Messages</h2>

        <div style={{ display: 'grid', gap: 6 }}>
          <input
            type="email"
            value={newDmEmail}
            onChange={(e) => setNewDmEmail(e.target.value)}
            placeholder="Start DM by email…"
	            className="tt-input"
          />
        </div>

        <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
          <input
            value={userQuery}
            onChange={(e) => setUserQuery(e.target.value)}
            placeholder="Search people (username/email)…"
            className="tt-input"
          />
        </div>

        {(isSearchingUsers || userResults.length > 0) && (
          <div
            className="tt-scroll"
            style={{
              maxHeight: 220,
              overflow: 'auto',
              padding: 6,
              marginTop: 6,
              borderRadius: 14,
              border: '1px solid rgba(15, 23, 42, 0.08)',
              background: 'rgba(255,255,255,0.72)',
            }}
          >
            {isSearchingUsers ? (
              <div style={{ padding: 10, fontSize: 13, fontWeight: 800, color: 'rgba(15,23,42,0.65)' }}>
                Searching…
              </div>
            ) : userResults.length === 0 ? (
              <div style={{ padding: 10, fontSize: 13, fontWeight: 800, color: 'rgba(15,23,42,0.65)' }}>
                No users found
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 6 }}>
                {userResults.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => handleStartDmWithUser(u)}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '10px 10px',
                      borderRadius: 12,
                      border: 'none',
                      background: 'rgba(0, 132, 255, 0.08)',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                      <AvatarDot name={u.displayName} src={u.avatarUrl ?? null} size={34} />                    
                      <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                      <div style={{ fontWeight: 950, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {highlight(u.displayName, userQuery)}
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 800, color: 'rgba(15,23,42,0.60)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {highlight(u.email, userQuery)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

	        <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
          <input
            value={threadFilter}
            onChange={(e) => setThreadFilter(e.target.value)}
            placeholder="Filter existing DMs…"
            className="tt-input"
          />
        </div>

        <div className="tt-scroll" style={{ flex: 1, minHeight: 0, display: 'grid', gap: 6 }}>
          {isLoadingThreads ? (
            <div style={{ display: 'grid', gap: 8, padding: 4 }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="tt-skeleton" style={{ height: 64, borderRadius: 16 }} />
              ))}
            </div>
          ) : (
          filteredThreads.map((t) => {
            const last = t.lastMessage;

            const preview =
              last && last.content
                ? last.content.length > 30
                  ? last.content.slice(0, 30) + '…'
                  : last.content
                : 'No messages yet';

            const timeLabel =
              last && last.createdAt
                ? new Date(last.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : '';

            const unread = unreadByThread[t.id] ?? 0;
            const otherUserName = t.otherUser?.displayName ?? 'Unknown user';

            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setActiveThreadId(t.id);
                  if (isMobile) setMobilePane('chat');
                  setTypingUsers([]);
                  setSearchQuery('');
                  setNewMsgCount(0);
                  setUnreadByThread((prev) => ({ ...prev, [t.id]: 0 }));
                  stopTypingNow();
                }}
                style={{
                  width: '100%',
                  padding: '0.5rem 0.75rem',
                  borderRadius: 16,
                  border: 'none',
                  background: t.id === activeThreadId ? 'rgba(0, 132, 255, 0.14)' : 'transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ position: 'relative', flex: '0 0 auto' }}>
                    <AvatarDot name={otherUserName} src={t.otherUser?.avatarUrl ?? null} size={34} />
                    {t.otherUser?.id && onlineUserIds.has(t.otherUser.id) && (
                      <span
                        title="Online"
                        style={{
                          position: 'absolute',
                          right: -1,
                          bottom: -1,
                          width: 10,
                          height: 10,
                          borderRadius: 999,
                          background: '#22c55e',
                          border: '2px solid #fff',
                        }}
                      />
                    )}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ fontWeight: 800, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {otherUserName}
                      </div>
                      {t.otherUser?.id && !onlineUserIds.has(t.otherUser.id) && lastSeenMsByUserId[t.otherUser.id] && (
                        <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 700 }} title={new Date(lastSeenMsByUserId[t.otherUser.id]).toLocaleString()}>
                          {lastSeenLabel(lastSeenMsByUserId[t.otherUser.id])}
                        </div>
                      )}
                      {timeLabel && (
                        <div style={{ marginLeft: 'auto', fontSize: 11, color: '#6b7280' }}>{timeLabel}</div>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                      <div
                        style={{
                          fontSize: 12,
                          color: 'var(--tt-muted)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {preview}
                      </div>

                  {unread > 0 && (
                    <span
                      style={{
                        marginLeft: 'auto',
                        minWidth: 20,
                        padding: '0 0.4rem',
                        borderRadius: 999,
                        fontSize: 12,
                        fontWeight: 700,
                        background: 'var(--tt-accent)',
                        color: '#fff',
                        textAlign: 'center',
                      }}
                    >
                      {unread}
                    </span>
                  )}
                    </div>
                  </div>
                </div>
              </button>
            );
          })
          )}

{threads.length === 0 && (
  <p style={{ fontSize: 13, color: '#6b7280' }}>No conversations yet.</p>
)}
        </div>
	      </aside>
	      )}
	      
	    {/* Main */}
	      {(!isMobile || mobilePane === 'chat') && (
	      <main className="tt-panel tt-dm-chatPane" style={{ minHeight: 0 }}>
        <header className="tt-dm-chatHeader">
          {isMobile && mobilePane === 'chat' && (
            <button
              type="button"
              onClick={() => setMobilePane('list')}
              className="tt-pill"
              style={{ marginBottom: 8, alignSelf: 'flex-start' }}
            >
              ← Back
            </button>
          )}
          <h1 style={{ fontSize: '1.3rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>{activeThread ? activeThread.otherUser.displayName : 'No conversation selected'}</span>
            {activeThread && onlineUserIds.has(activeThread.otherUser.id) && (
              <span title="Online" style={{ fontSize: 12, color: '#22c55e', fontWeight: 900 }}>
                ●
              </span>
            )}
            {activeThread &&
              !onlineUserIds.has(activeThread.otherUser.id) &&
              lastSeenMsByUserId[activeThread.otherUser.id] && (
                <span
                  title={new Date(lastSeenMsByUserId[activeThread.otherUser.id]).toLocaleString()}
                  style={{ fontSize: 12, color: '#9ca3af', fontWeight: 700 }}
                >
                  · {lastSeenLabel(lastSeenMsByUserId[activeThread.otherUser.id])}
                </span>
              )}
          </h1>

          {/* ✅ Search + jump */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search in this DM…"
              disabled={!activeThread}
              style={{
                padding: '0.35rem 0.6rem',
                borderRadius: 16,
                border: '1px solid var(--tt-border)',
                fontSize: 14,
                width: '100%',
                maxWidth: 420,
              }}
            />
          </div>

          {searchQuery.trim() && searchResults.length > 0 && (
            <div
              style={{
                width: '100%',
                maxWidth: 420,
                border: '1px solid #e5e7eb',
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
                    onClick={() => scrollToMessage(m.id)}
                    style={{
                      border: 'none',
                      textAlign: 'left',
                      cursor: 'pointer',
                      padding: '6px 8px',
                      borderRadius: 16,
                      background: '#f9fafb',
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 800, color: '#111827' }}>
                      {m.senderName}{' '}
                      <span style={{ fontWeight: 600, color: '#6b7280' }}>
                        · {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: '#374151' }}>{highlight(m.content.slice(0, 80), searchQuery)}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </header>

        {error && (
          <div
            style={{
              marginBottom: '0.5rem',
              padding: '0.5rem 0.75rem',
              borderRadius: 16,
              background: '#fee2e2',
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
          className="scroll-column tt-scroll"
          style={{
            flex: 1,
            minHeight: 0,
            padding: 12,
            paddingTop: 28,
            scrollPaddingTop: 28,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            background: 'rgba(255,255,255,0.32)',
            borderRadius: 16,
            border: '1px solid rgba(15, 23, 42, 0.06)',
          }}
        >
          {activeThreadId && messages.length === 0 && (
            <p style={{ fontSize: 14, color: '#6b7280' }}>No messages yet. Say hi 👋</p>
          )}

          {newMsgCount > 0 && !stickToBottom && (
            <button
              onClick={() => {
                setNewMsgCount(0);
                scrollToBottom('smooth');
              }}
              style={{
                alignSelf: 'center',
                marginBottom: 8,
                padding: '0.35rem 0.75rem',
                borderRadius: 999,
                border: '1px solid var(--tt-border)',
                background: 'rgba(255,255,255,0.78)',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {newMsgCount} new message{newMsgCount === 1 ? '' : 's'} — Jump to latest
            </button>
          )}

          {isLoadingMessages ? (
            <div style={{ display: 'grid', gap: 10 }}>
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
          ) : (
          messages.map((m) => {
            const isMine = m.senderId === currentUser.id;
            const receipt = m.receipt;

            const status = receipt?.seenCount ? 'Seen' : receipt?.deliveredCount ? 'Delivered' : 'Sent';

            return (
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
                  {!isMine && <AvatarDot name={m.senderName} src={m.senderAvatarUrl ?? null} size={30} />}

                  <div
                    style={{
                      maxWidth: '70%',
                      padding: '0.55rem 0.75rem',
                      borderRadius: 18,
                      borderBottomRightRadius: isMine ? 10 : 18,
                      borderBottomLeftRadius: isMine ? 18 : 10,
                      background: isMine ? 'var(--tt-bubble-out)' : 'var(--tt-bubble-in)',
                      color: isMine ? '#ffffff' : '#111827',
                    }}
                  >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      gap: 8,
                      marginBottom: 2,
                    }}
                  >
                    <span style={{ fontWeight: 600, fontSize: 13 }}>
                      {m.senderName}
                      {!isMine && onlineUserIds.has(m.senderId) && (
                        <span title="Online" style={{ marginLeft: 6, fontSize: 10, color: '#22c55e', verticalAlign: 'middle' }}>
                          ●
                        </span>
                      )}
                      {!isMine && !onlineUserIds.has(m.senderId) && lastSeenMsByUserId[m.senderId] && (
                        <span
                          title={new Date(lastSeenMsByUserId[m.senderId]).toLocaleString()}
                          style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: isMine ? 'rgba(249,250,251,0.8)' : '#9ca3af' }}
                        >
                          · {lastSeenLabel(lastSeenMsByUserId[m.senderId])}
                        </span>
                      )}
                    </span>
                    <span style={{ fontSize: 11, color: isMine ? 'rgba(249,250,251,0.8)' : '#9ca3af' }}>
                      {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  {/* Reply preview */}
                  {m.replyTo ? (
                    <button
                      type="button"
                      onClick={() => scrollToMessage(m.replyTo!.id)}
                      title="Jump to replied message"
                      style={{
                        width: '100%',
                        border: 'none',
                        textAlign: 'left',
                        cursor: 'pointer',
                        padding: '0.35rem 0.5rem',
                        borderRadius: 10,
                        marginBottom: 6,
                        background: isMine ? 'rgba(255,255,255,0.18)' : 'rgba(15, 23, 42, 0.06)',
                        color: isMine ? 'rgba(255,255,255,0.92)' : '#374151',
                        fontSize: 12,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 800, marginBottom: 2 }}>
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
                    </button>
                  ) : null}

                  {m.content?.trim() ? (
                    <div style={{ fontSize: 14, wordBreak: 'break-word' }}>{highlight(m.content, searchQuery)}</div>
                  ) : null}

                  <LinkPreview text={m.content} inverted={isMine} />

                  {renderAttachments(m.attachments, isMine)}

                  {/* Actions (reply + reactions) */}
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
                    {(m.reactions ?? [])
                      .filter((r) => r.count > 0)
                      .map((r) => (
                        <button
                          key={r.emoji}
                          type="button"
                          onClick={() => toggleDmReaction(m.id, r.emoji)}
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

                    <EmojiPicker
                      onPick={(emoji) => toggleDmReaction(m.id, emoji)}
                      customEmojis={customEmojis}
                      setCustomEmojis={setCustomEmojis}
                      title="Add reaction"
                    />

                    <button
                      type="button"
                      onClick={() => beginReply(m)}
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
                      title="Reply"
                    >
                      ↩ Reply
                    </button>
                  </div>

                  {/* ✅ delivered/seen status for my messages */}
                  {isMine && (
                    <div style={{ marginTop: 6, fontSize: 11, color: 'rgba(249,250,251,0.85)' }}>
                      {status}
                      {receipt?.lastSeenAt && status === 'Seen' ? (
                        <span style={{ marginLeft: 6, opacity: 0.9 }}>
                          · {new Date(receipt.lastSeenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            </div>
            );
          })
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* ✅ Typing indicator with avatars */}
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

        {/* Input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,application/pdf"
          style={{ display: 'none' }}
          onChange={(e) => addPickedFiles(e.target.files)}
        />

        {(pendingFiles.length > 0 || pendingVoice || isRecording) && (
          <div
            style={{
              borderTop: '1px solid var(--tt-border)',
              paddingTop: '0.5rem',
              marginTop: '0.5rem',
              display: 'grid',
              gap: 8,
            }}
          >
            {isRecording && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#ef4444' }}>
                  ● Recording… {recordSeconds}s
                </div>
                <button
                  type="button"
                  onClick={stopRecording}
                  style={{
                    padding: '0.25rem 0.6rem',
                    borderRadius: 999,
                    border: '1px solid var(--tt-border)',
                    background: 'transparent',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  Stop
                </button>
              </div>
            )}

            {(pendingFiles.length > 0 || pendingVoice) && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {pendingFiles.map((p) => (
                  <div
                    key={p.id}
                    style={{
                      position: 'relative',
                      width: 64,
                      height: 64,
                      borderRadius: 12,
                      overflow: 'hidden',
                      border: '1px solid var(--tt-border)',
                      background: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                    title={p.file.name}
                  >
                    {p.kind === 'IMAGE' ? (
                      <img src={p.previewUrl} alt={p.file.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <div style={{ fontSize: 11, fontWeight: 900, color: '#111827' }}>PDF</div>
                    )}
                    <button
                      type="button"
                      onClick={() => removePendingFile(p.id)}
                      style={{
                        position: 'absolute',
                        top: 4,
                        right: 4,
                        width: 20,
                        height: 20,
                        borderRadius: 999,
                        border: 'none',
                        background: 'rgba(17,24,39,0.75)',
                        color: '#fff',
                        fontWeight: 900,
                        cursor: 'pointer',
                      }}
                      aria-label="Remove"
                    >
                      ×
                    </button>
                  </div>
                ))}

                {pendingVoice && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '0.35rem 0.5rem',
                      borderRadius: 12,
                      border: '1px solid var(--tt-border)',
                    }}
                  >
                    <audio controls src={pendingVoice.previewUrl} style={{ height: 34 }} />
                    <button
                      type="button"
                      onClick={() => setPendingVoice((prev) => {
                        if (prev) revokeUrl(prev.previewUrl);
                        return null;
                      })}
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 999,
                        border: '1px solid var(--tt-border)',
                        background: 'transparent',
                        fontWeight: 900,
                        cursor: 'pointer',
                      }}
                      aria-label="Remove voice note"
                    >
                      ×
                    </button>
                  </div>
                )}
              </div>
            )}

            {(pendingFiles.length > 0 || pendingVoice) && (
              <button
                type="button"
                onClick={clearPendingUploads}
                style={{
                  alignSelf: 'flex-start',
                  padding: '0.25rem 0.6rem',
                  borderRadius: 999,
                  border: '1px solid var(--tt-border)',
                  background: 'transparent',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                Clear
              </button>
            )}
          </div>
        )}

        {replyingTo && (
          <div
            style={{
              borderTop: '1px solid var(--tt-border)',
              marginTop: '0.5rem',
              paddingTop: '0.5rem',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: '#111827' }}>
                Replying to {replyingTo.senderName}
              </div>
              <div style={{ fontSize: 12, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {replyingTo.content?.trim() ? replyingTo.content : replyingTo.attachments?.length ? '📎 Attachment' : ''}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setReplyingTo(null)}
              style={{
                width: 28,
                height: 28,
                borderRadius: 999,
                border: '1px solid var(--tt-border)',
                background: 'transparent',
                fontWeight: 900,
                cursor: 'pointer',
              }}
              aria-label="Cancel reply"
              title="Cancel reply"
            >
              ×
            </button>
          </div>
        )}

        <form
          onSubmit={handleSend}
          className="tt-chat-composer"
          style={{
            borderTop: '1px solid var(--tt-border)',
            paddingTop: '0.5rem',
            marginTop: '0.5rem',
            display: 'flex',
            gap: '0.5rem',
            alignItems: 'center',
          }}
        >
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!activeThread || isUploading || isRecording}
            title="Attach image or PDF"
            style={{
              width: 44,
              height: 44,
              borderRadius: 999,
              border: '1px solid var(--tt-border)',
              background: 'transparent',
              fontWeight: 900,
              cursor: !activeThread || isUploading || isRecording ? 'not-allowed' : 'pointer',
              opacity: !activeThread || isUploading || isRecording ? 0.6 : 1,
            }}
          >
            📎
          </button>

          <button
            type="button"
            onClick={() => (isRecording ? stopRecording() : startRecording())}
            disabled={!activeThread || isUploading}
            title={isRecording ? 'Stop recording' : 'Record voice note'}
            style={{
              width: 44,
              height: 44,
              borderRadius: 999,
              border: '1px solid var(--tt-border)',
              background: isRecording ? 'rgba(239,68,68,0.12)' : 'transparent',
              fontWeight: 900,
              cursor: !activeThread || isUploading ? 'not-allowed' : 'pointer',
              opacity: !activeThread || isUploading ? 0.6 : 1,
            }}
          >
            {isRecording ? '■' : '🎤'}
          </button>

          <input
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              handleTypingEvent();
            }}
            placeholder={activeThread ? 'Message this person' : 'Select a conversation first'}
            disabled={!activeThread || isUploading}
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
            disabled={!activeThread || (input.trim().length === 0 && pendingFiles.length === 0 && !pendingVoice) || isUploading || isRecording}
            style={{
              padding: '0.4rem 1rem',
              borderRadius: 999,
              border: 'none',
              background: 'var(--tt-accent)',
              color: '#fff',
              fontWeight: 700,
              fontSize: 14,
              cursor: !activeThread || (input.trim().length === 0 && pendingFiles.length === 0 && !pendingVoice) || isUploading || isRecording ? 'not-allowed' : 'pointer',
              opacity: !activeThread || (input.trim().length === 0 && pendingFiles.length === 0 && !pendingVoice) || isUploading || isRecording ? 0.6 : 1,
            }}
          >
            {isUploading ? 'Uploading…' : 'Send'}
          </button>
        </form>
	      </main>
	      )}

      {/* Toasts */}
      <div className="tt-toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={`tt-toast ${t.kind === 'error' ? 'tt-toast--error' : t.kind === 'success' ? 'tt-toast--success' : ''}`}> 
            <div style={{ fontWeight: 800 }}>{t.title}</div>
            <div style={{ fontWeight: 600, opacity: 0.9 }}>{t.body}</div>
          </div>
        ))}
      </div>

    </div>
  );
};

export default PrivateMessagesPage;