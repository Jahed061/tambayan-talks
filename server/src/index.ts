import express from 'express';
import cors, { type CorsOptions } from 'cors';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';

import dmsRouter from './routes/dms.routes';
import videoSessionsRouter from './routes/videoSessions.routes';
import channelsRouter from './routes/channels.routes';
import uploadsRouter from './routes/uploads.routes';
import authRouter from './routes/auth.routes';
import profileRouter from './routes/profile.routes';
import linkPreviewRouter from './routes/linkPreview.routes';
import usersRouter from './routes/users.routes';
import { requireAuth, type JwtUser } from './middleware/auth';

import { prisma } from './prisma/client';

const DEFAULT_PUBLIC_CHANNEL_ID = 'public';
const DEFAULT_PUBLIC_CHANNEL_NAME = 'general';

async function ensureDefaultPublicChannel() {
  // Create a stable public channel for all testers.
  // Channel.ownerId is not a FK, but we still set it to a stable value.
  try {
    await prisma.channel.upsert({
      where: { id: DEFAULT_PUBLIC_CHANNEL_ID },
      update: {
        name: DEFAULT_PUBLIC_CHANNEL_NAME,
        description: 'Public channel for all testers (default).',
        isPrivate: false,
      },
      create: {
        id: DEFAULT_PUBLIC_CHANNEL_ID,
        name: DEFAULT_PUBLIC_CHANNEL_NAME,
        description: 'Public channel for all testers (default).',
        isPrivate: false,
        ownerId: 'system',
      },
    });
  } catch (err) {
    console.error('Failed to ensure default public channel', err);
  }
}
import { sendDmMessage } from './data/dms';
import { getMessageDtoById } from './data/messageDto';
import { upsertChannelReceipt, upsertDmReceipt } from './data/receipts';
import { ensureProfileTable, getAllLastSeenAtMsMap, setLastSeenAtMs } from './services/profileStore';

const app = express();

// ---------------- CORS ----------------
// Render deployments typically have the API on one domain and the Vite/Static site on another.
// Configure allowed origins via CORS_ORIGINS (comma-separated). If unset, we allow all.
function buildCorsOptions(): CorsOptions {
  const raw = (process.env.CORS_ORIGINS || process.env.ALLOWED_ORIGINS || '').trim();
  if (!raw || raw === '*') {
    // origin:true reflects the request Origin, which plays nicely with multiple environments.
    return {
      origin: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: false,
    };
  }

  const allow = new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

  return {
    origin(origin, cb) {
      // allow non-browser clients (no Origin header)
      if (!origin) return cb(null, true);
      return cb(null, allow.has(origin));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false,
  };
}

const corsOptions = buildCorsOptions();

// CORS: allow the Vite dev server (5173) and mobile devices on LAN.
// Also ensure preflight requests succeed (important for WebView + Authorization header).
app.use(cors(corsOptions));

// Handle preflight early for every route
// Handle preflight early for every route (Express v5/router doesn't accept '*' path)
app.options(
  /.*/,
  cors(corsOptions),
);
//app.use(
  //cors({
    //origin: 'http://localhost:5173',
    //methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    //allowedHeaders: ['Content-Type', 'Authorization'],
    //credentials: false,
  //})
//);

app.use(express.json());

// Render health checks: keep it fast and reliable.
app.get('/healthz', async (_req, res) => {
  try {
    // Lightweight DB check. If DATABASE_URL isn't set, Prisma will throw earlier anyway.
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('healthz failed', err);
    res.status(500).json({ ok: false });
  }
});

// Serve uploaded files (images, PDFs, audio) from server/uploads
const uploadsDir = path.resolve(process.cwd(), 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });
app.use(
  '/uploads',
  express.static(uploadsDir, {
    setHeaders: (res) => {
      // Helpful when running client+server on different ports during dev.
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  }),
);

// REST
app.use('/api', authRouter);
app.use('/api/profile', requireAuth, profileRouter);
app.use('/api/users', requireAuth, usersRouter);
app.use('/api/link-preview', requireAuth, linkPreviewRouter);
app.use('/api/uploads', requireAuth, uploadsRouter);
app.use('/api/dms', requireAuth, dmsRouter);
app.use('/api/video-sessions', requireAuth, videoSessionsRouter);
app.use('/api/channels', requireAuth, channelsRouter);

const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    // Socket.IO uses a different CORS shape; keep it aligned with HTTP CORS.
    origin: (origin, cb) => {
      const raw = (process.env.CORS_ORIGINS || process.env.ALLOWED_ORIGINS || '').trim();
      if (!raw || raw === '*') return cb(null, true);
      const allow = new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
      if (!origin) return cb(null, true);
      return cb(null, allow.has(origin));
    },
    methods: ['GET', 'POST'],
  },
});

// ---------------- Presence (online/offline) ----------------
// userId -> set of socket ids (multiple tabs/devices)
const socketsByUserId = new Map<string, Set<string>>();
// userId -> lastSeenMs (only meaningful when offline)
const lastSeenMsByUserId = new Map<string, number>();

function markOnline(userId: string, socketId: string) {
  const set = socketsByUserId.get(userId) ?? new Set<string>();
  const wasOnline = set.size > 0;
  set.add(socketId);
  socketsByUserId.set(userId, set);
  // if this is the first socket for the user, broadcast online
  if (!wasOnline) {
    lastSeenMsByUserId.delete(userId);
    // Clear persisted last-seen (user is online again)
    void setLastSeenAtMs(userId, null);
    io.emit('presence_update', { userId, online: true, lastSeenMs: null });
  }
}

function markOffline(userId: string, socketId: string) {
  const set = socketsByUserId.get(userId);
  if (!set) return;
  set.delete(socketId);
  if (set.size > 0) {
    socketsByUserId.set(userId, set);
    return;
  }

  socketsByUserId.delete(userId);
  const lastSeenMs = Date.now();
  lastSeenMsByUserId.set(userId, lastSeenMs);
  // Persist last-seen so it survives server restarts
  void setLastSeenAtMs(userId, lastSeenMs);
  io.emit('presence_update', { userId, online: false, lastSeenMs });
}

function presenceSnapshot() {
  const onlineUserIds = Array.from(socketsByUserId.keys());
  const lastSeenMsByUserIdObj: Record<string, number> = {};
  for (const [k, v] of lastSeenMsByUserId.entries()) lastSeenMsByUserIdObj[k] = v;
  return { onlineUserIds, lastSeenMsByUserId: lastSeenMsByUserIdObj };
}

async function ensureDemoUser(userId: string) {
  const exists = await prisma.user.findUnique({ where: { id: userId } });
  if (exists) return;

  await prisma.user.create({
    data: {
      id: userId,
      email: `${userId}@example.com`,
      password: 'demo-password',
      displayName: userId === 'teacher-1' ? 'Demo Teacher' : 'Demo User',
      role: userId === 'teacher-1' ? 'TEACHER' : 'STUDENT',
    },
  });
}

// Socket auth via token (optional: allow unauthenticated demo)
io.use((socket, next) => {
  const token = (socket.handshake.auth as any)?.token;
  if (!token) return next();

  const secret = process.env.JWT_SECRET;
  if (!secret) return next(new Error('Server misconfigured: JWT_SECRET missing'));

  try {
    const payload = jwt.verify(token, secret) as JwtUser;
    (socket.data as any).user = payload;
    return next();
  } catch {
    return next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  console.log('Socket connected', socket.id);

  // If authenticated, join a per-user room so we can deliver notifications (mentions, etc.).
  const authedUserId = (socket.data as any).user?.id as string | undefined;
  if (authedUserId) {
    socket.join(`user:${authedUserId}`);
    markOnline(authedUserId, socket.id);
  }

  // Send presence snapshot on connect (works even for unauthenticated clients, but will be empty).
  socket.emit('presence_snapshot', presenceSnapshot());

  socket.on('who_is_online', () => {
    socket.emit('presence_snapshot', presenceSnapshot());
  });

  socket.on('disconnect', () => {
    if (authedUserId) markOffline(authedUserId, socket.id);
  });

  // Helper: normalize display names to the @mention token format (lowercase, no spaces)
  const normalizeMentionKey = (name: string) => name.toLowerCase().replace(/\s+/g, '');

  // Helper: extract @tokens (e.g. "@DemoTeacher") from content
  const extractMentionKeys = (text: string) => {
    const out = new Set<string>();
    const re = /@([a-zA-Z0-9_][a-zA-Z0-9_-]{0,31})/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      out.add(String(m[1]).toLowerCase());
    }
    return out;
  };

  // ---------- Channel rooms ----------
  socket.on('join_channel', (channelId: string) => {
    socket.join(channelId);
  });

  // ---------- Channel typing ----------
  socket.on('typing', (payload: { channelId: string; userId: string; displayName: string; avatarUrl?: string | null }) => {
    io.to(payload.channelId).emit('typing', payload);
  });

  socket.on('stop_typing', (payload: { channelId: string; userId: string; displayName: string; avatarUrl?: string | null }) => {
    io.to(payload.channelId).emit('stop_typing', payload);
  });

  // ---------- DM typing ----------
  socket.on('dm_typing', (payload: { threadId: string; userId: string; displayName: string; avatarUrl?: string | null }) => {
    io.to(`dm:${payload.threadId}`).emit('dm_typing', payload);
  });

  socket.on('dm_stop_typing', (payload: { threadId: string; userId: string }) => {
    io.to(`dm:${payload.threadId}`).emit('dm_stop_typing', payload);
  });

  // ---------- Receipts: Channels ----------
  socket.on('message_delivered', async (payload: { channelId: string; messageId: string }) => {
    try {
      const userId = (socket.data as any).user?.id;
      if (!userId) return;

      const msg = await prisma.message.findUnique({
        where: { id: payload.messageId },
        select: { id: true, channelId: true, senderId: true },
      });
      if (!msg || msg.channelId !== payload.channelId) return;
      if (msg.senderId === userId) return;

      const { mine, aggregate } = await upsertChannelReceipt({
        messageId: msg.id,
        actorUserId: userId,
        senderId: msg.senderId,
        delivered: true,
      });

      io.to(payload.channelId).emit('message_receipt', {
        channelId: payload.channelId,
        messageId: msg.id,
        actorUserId: userId,
        mine,
        aggregate,
      });
    } catch (err) {
      console.error('message_delivered error', err);
    }
  });

  socket.on('message_seen', async (payload: { channelId: string; messageId: string }) => {
    try {
      const userId = (socket.data as any).user?.id;
      if (!userId) return;

      const msg = await prisma.message.findUnique({
        where: { id: payload.messageId },
        select: { id: true, channelId: true, senderId: true },
      });
      if (!msg || msg.channelId !== payload.channelId) return;
      if (msg.senderId === userId) return;

      const { mine, aggregate } = await upsertChannelReceipt({
        messageId: msg.id,
        actorUserId: userId,
        senderId: msg.senderId,
        seen: true,
      });

      io.to(payload.channelId).emit('message_receipt', {
        channelId: payload.channelId,
        messageId: msg.id,
        actorUserId: userId,
        mine,
        aggregate,
      });
    } catch (err) {
      console.error('message_seen error', err);
    }
  });

  socket.on('bulk_delivered', async (payload: { channelId: string; messageIds: string[] }) => {
    try {
      const userId = (socket.data as any).user?.id;
      if (!userId) return;
      const ids = Array.isArray(payload.messageIds) ? payload.messageIds.slice(0, 250) : [];
      if (!ids.length) return;

      const msgs = await prisma.message.findMany({
        where: { id: { in: ids }, channelId: payload.channelId },
        select: { id: true, senderId: true },
      });

      for (const msg of msgs) {
        if (msg.senderId === userId) continue;

        const { mine, aggregate } = await upsertChannelReceipt({
          messageId: msg.id,
          actorUserId: userId,
          senderId: msg.senderId,
          delivered: true,
        });

        io.to(payload.channelId).emit('message_receipt', {
          channelId: payload.channelId,
          messageId: msg.id,
          actorUserId: userId,
          mine,
          aggregate,
        });
      }
    } catch (err) {
      console.error('bulk_delivered error', err);
    }
  });

  socket.on('bulk_seen', async (payload: { channelId: string; messageIds: string[] }) => {
    try {
      const userId = (socket.data as any).user?.id;
      if (!userId) return;
      const ids = Array.isArray(payload.messageIds) ? payload.messageIds.slice(0, 250) : [];
      if (!ids.length) return;

      const msgs = await prisma.message.findMany({
        where: { id: { in: ids }, channelId: payload.channelId },
        select: { id: true, senderId: true },
      });

      for (const msg of msgs) {
        if (msg.senderId === userId) continue;

        const { mine, aggregate } = await upsertChannelReceipt({
          messageId: msg.id,
          actorUserId: userId,
          senderId: msg.senderId,
          seen: true,
        });

        io.to(payload.channelId).emit('message_receipt', {
          channelId: payload.channelId,
          messageId: msg.id,
          actorUserId: userId,
          mine,
          aggregate,
        });
      }
    } catch (err) {
      console.error('bulk_seen error', err);
    }
  });

  // ---------- Receipts: DMs ----------
  socket.on('dm_delivered', async (payload: { threadId: string; messageId: string }) => {
    try {
      const userId = (socket.data as any).user?.id;
      if (!userId) return;

      const msg = await prisma.dMMessage.findUnique({
        where: { id: payload.messageId },
        select: { id: true, threadId: true, senderId: true },
      });
      if (!msg || msg.threadId !== payload.threadId) return;
      if (msg.senderId === userId) return;

      const { mine, aggregate } = await upsertDmReceipt({
        dmMessageId: msg.id,
        actorUserId: userId,
        senderId: msg.senderId,
        delivered: true,
      });

      io.to(`dm:${payload.threadId}`).emit('dm_receipt', {
        threadId: payload.threadId,
        messageId: msg.id,
        actorUserId: userId,
        mine,
        aggregate,
      });
    } catch (err) {
      console.error('dm_delivered error', err);
    }
  });

  socket.on('dm_seen', async (payload: { threadId: string; messageId: string }) => {
    try {
      const userId = (socket.data as any).user?.id;
      if (!userId) return;

      const msg = await prisma.dMMessage.findUnique({
        where: { id: payload.messageId },
        select: { id: true, threadId: true, senderId: true },
      });
      if (!msg || msg.threadId !== payload.threadId) return;
      if (msg.senderId === userId) return;

      const { mine, aggregate } = await upsertDmReceipt({
        dmMessageId: msg.id,
        actorUserId: userId,
        senderId: msg.senderId,
        seen: true,
      });

      io.to(`dm:${payload.threadId}`).emit('dm_receipt', {
        threadId: payload.threadId,
        messageId: msg.id,
        actorUserId: userId,
        mine,
        aggregate,
      });
    } catch (err) {
      console.error('dm_seen error', err);
    }
  });

  socket.on('dm_bulk_delivered', async (payload: { threadId: string; messageIds: string[] }) => {
    try {
      const userId = (socket.data as any).user?.id;
      if (!userId) return;

      const ids = Array.isArray(payload.messageIds) ? payload.messageIds.slice(0, 250) : [];
      if (!ids.length) return;

      const msgs = await prisma.dMMessage.findMany({
        where: { id: { in: ids }, threadId: payload.threadId },
        select: { id: true, senderId: true },
      });

      for (const msg of msgs) {
        if (msg.senderId === userId) continue;

        const { mine, aggregate } = await upsertDmReceipt({
          dmMessageId: msg.id,
          actorUserId: userId,
          senderId: msg.senderId,
          delivered: true,
        });

        io.to(`dm:${payload.threadId}`).emit('dm_receipt', {
          threadId: payload.threadId,
          messageId: msg.id,
          actorUserId: userId,
          mine,
          aggregate,
        });
      }
    } catch (err) {
      console.error('dm_bulk_delivered error', err);
    }
  });

  socket.on('dm_bulk_seen', async (payload: { threadId: string; messageIds: string[] }) => {
    try {
      const userId = (socket.data as any).user?.id;
      if (!userId) return;

      const ids = Array.isArray(payload.messageIds) ? payload.messageIds.slice(0, 250) : [];
      if (!ids.length) return;

      const msgs = await prisma.dMMessage.findMany({
        where: { id: { in: ids }, threadId: payload.threadId },
        select: { id: true, senderId: true },
      });

      for (const msg of msgs) {
        if (msg.senderId === userId) continue;

        const { mine, aggregate } = await upsertDmReceipt({
          dmMessageId: msg.id,
          actorUserId: userId,
          senderId: msg.senderId,
          seen: true,
        });

        io.to(`dm:${payload.threadId}`).emit('dm_receipt', {
          threadId: payload.threadId,
          messageId: msg.id,
          actorUserId: userId,
          mine,
          aggregate,
        });
      }
    } catch (err) {
      console.error('dm_bulk_seen error', err);
    }
  });

  socket.on('join_dm', (payload: { threadId?: string } | string) => {
    const threadId = typeof payload === 'string' ? payload : payload.threadId;
    if (!threadId) return;
    socket.join(`dm:${threadId}`);
  });

  socket.on(
    'send_dm',
    async (payload: {
      threadId: string;
      content?: string;
      attachments?: Array<{
        kind: 'IMAGE' | 'PDF' | 'AUDIO';
        url: string;
        mimeType: string;
        fileName: string;
        size: number;
        width?: number | null;
        height?: number | null;
        durationMs?: number | null;
      }>;
    }) => {
      const { threadId, content, attachments } = payload;
      const senderId = (socket.data as any).user?.id;
      if (!senderId) {
        socket.emit('dm_error', { error: 'Missing token' });
        return;
      }

      await ensureDemoUser(senderId);

      try {
        const message = await sendDmMessage(senderId, threadId, String(content ?? ''), attachments);

        io.to(`dm:${threadId}`).emit('dm_message', {
          id: message.id,
          content: message.content,
          attachments: (message as any).attachments ?? message.attachments ?? [],
          createdAt: message.createdAt,
          senderId: message.senderId,
          senderName: message.senderName,
          senderAvatarUrl: (message as any).senderAvatarUrl ?? message.senderAvatarUrl ?? null,
          threadId,
        });
      } catch (err) {
        console.error('Error sending DM:', err);
        socket.emit('dm_error', { error: 'Failed to send message' });
      }
    },
  );

  // ---------- Channel messages ----------
  socket.on(
    'send_message',
    async (payload: {
      channelId: string;
      content?: string;
      replyToId?: string | null;
      isAnnouncement?: boolean;
      attachments?: Array<{
        kind: 'IMAGE' | 'PDF' | 'AUDIO';
        url: string;
        mimeType: string;
        fileName: string;
        size: number;
        width?: number | null;
        height?: number | null;
        durationMs?: number | null;
      }>;
    }) => {
      try {
        const { channelId, content, replyToId, isAnnouncement, attachments } = payload;

        const user =
          ((socket.data as any).user as JwtUser | undefined) ||
          ({ id: 'teacher-1', role: 'TEACHER' } as const);

        const userId = user.id || 'teacher-1';
        await ensureDemoUser(userId);

        // validate reply target (must be in same channel)
        let safeReplyToId: string | null = null;
        if (replyToId) {
          const parent = await prisma.message.findUnique({ where: { id: replyToId } });
          if (parent && parent.channelId === channelId) safeReplyToId = parent.id;
        }

        const safeContent = String(content ?? '').trim();
        const safeAttachments = Array.isArray(attachments) ? attachments.slice(0, 8) : [];

        if (!safeContent && safeAttachments.length === 0) {
          return; // nothing to send
        }

        const message = await prisma.message.create({
          data: {
            content: safeContent,
            channelId,
            senderId: userId,
            replyToId: safeReplyToId,
            isAnnouncement: user.role === 'TEACHER' || user.role === 'ADMIN' ? Boolean(isAnnouncement) : false,
            attachments: safeAttachments.length
              ? {
                  create: safeAttachments.map((a) => ({
                    kind: a.kind,
                    url: a.url,
                    mimeType: a.mimeType,
                    fileName: a.fileName,
                    size: a.size,
                    width: a.width ?? null,
                    height: a.height ?? null,
                    durationMs: a.durationMs ?? null,
                  })),
                }
              : undefined,
          },
        });

        const dto = await getMessageDtoById(message.id, userId);
        if (dto) io.to(channelId).emit('new_message', dto);

        // ---------- Mentions (@name) notifications ----------
        // Mentions are of the form: @DisplayNameWithoutSpaces
        // Example: displayName "Demo Teacher" => @demoteacher
        const mentionKeys = extractMentionKeys(safeContent);
        if (mentionKeys.size > 0) {
          const sender = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, displayName: true } });
          const users = await prisma.user.findMany({ select: { id: true, displayName: true } });

          for (const u of users) {
            if (u.id === userId) continue;
            const key = normalizeMentionKey(u.displayName);
            if (!mentionKeys.has(key)) continue;

            io.to(`user:${u.id}`).emit('mention', {
              channelId,
              messageId: message.id,
              from: sender ? { id: sender.id, displayName: sender.displayName } : { id: userId, displayName: userId },
              snippet: safeContent.slice(0, 180),
            });
          }
        }
      } catch (err) {
        console.error('Error handling send_message', err);
        socket.emit('message_error', { error: 'Failed to send message' });
      }
    }
  );

  socket.on('edit_message', async (payload: { channelId: string; messageId: string; content: string }) => {
    try {
      const user =
        ((socket.data as any).user as JwtUser | undefined) ||
        ({ id: 'teacher-1', role: 'TEACHER' } as const);
      const userId = user.id || 'teacher-1';

      const { channelId, messageId, content } = payload;

      const existing = await prisma.message.findUnique({ where: { id: messageId } });
      if (!existing || existing.channelId !== channelId) return;

      const canEdit = existing.senderId === userId || user.role === 'TEACHER' || user.role === 'ADMIN';
      if (!canEdit || existing.isDeleted) return;

      await prisma.message.update({
        where: { id: messageId },
        data: { content, editedAt: new Date() },
      });

      const dto = await getMessageDtoById(messageId, userId);
      if (dto) io.to(channelId).emit('message_updated', dto);
    } catch (err) {
      console.error('Error handling edit_message', err);
      socket.emit('message_error', { error: 'Failed to edit message' });
    }
  });

  socket.on('delete_message', async (payload: { channelId: string; messageId: string }) => {
    try {
      const user =
        ((socket.data as any).user as JwtUser | undefined) ||
        ({ id: 'teacher-1', role: 'TEACHER' } as const);
      const userId = user.id || 'teacher-1';

      const { channelId, messageId } = payload;

      const existing = await prisma.message.findUnique({ where: { id: messageId } });
      if (!existing || existing.channelId !== channelId) return;

      const canDelete = existing.senderId === userId || user.role === 'TEACHER' || user.role === 'ADMIN';
      if (!canDelete) return;

      await prisma.message.update({
        where: { id: messageId },
        data: { isDeleted: true, deletedAt: new Date(), content: '' },
      });

      const dto = await getMessageDtoById(messageId, userId);
      if (dto) io.to(channelId).emit('message_updated', dto);
    } catch (err) {
      console.error('Error handling delete_message', err);
      socket.emit('message_error', { error: 'Failed to delete message' });
    }
  });

  socket.on('react_message', async (payload: { channelId: string; messageId: string; emoji: string }) => {
    try {
      const user =
        ((socket.data as any).user as JwtUser | undefined) ||
        ({ id: 'teacher-1', role: 'TEACHER' } as const);
      const userId = user.id || 'teacher-1';

      const channelId = String(payload.channelId);
      const messageId = String(payload.messageId);
      const emoji = String(payload.emoji ?? '').trim();
      // Allow arbitrary emojis + custom :name: tokens, but keep it bounded/safe.
      if (!emoji) return;
      if (emoji.length > 64) return;
      if (/\s/.test(emoji)) return;

      const existing = await prisma.message.findUnique({ where: { id: messageId } });
      if (!existing || existing.channelId !== channelId) return;

      const existingReaction = await prisma.messageReaction.findUnique({
        where: { messageId_userId_emoji: { messageId, userId, emoji } },
      });

      if (existingReaction) {
        await prisma.messageReaction.delete({ where: { id: existingReaction.id } });
      } else {
        await prisma.messageReaction.create({ data: { messageId, userId, emoji } });
      }

      const dto = await getMessageDtoById(messageId, userId);
      if (dto) io.to(channelId).emit('message_updated', dto);
    } catch (err) {
      console.error('Error handling react_message', err);
      socket.emit('message_error', { error: 'Failed to react' });
    }
  });

  socket.on(
    'pin_message',
    async (payload: { channelId: string; messageId: string; isPinned?: boolean; isAnnouncement?: boolean }) => {
      try {
        const user =
          ((socket.data as any).user as JwtUser | undefined) ||
          ({ id: 'teacher-1', role: 'TEACHER' } as const);
        const userId = user.id || 'teacher-1';

        if (!(user.role === 'TEACHER' || user.role === 'ADMIN')) return;

        const { channelId, messageId, isPinned, isAnnouncement } = payload;

        const existing = await prisma.message.findUnique({ where: { id: messageId } });
        if (!existing || existing.channelId !== channelId) return;

        const setPinned = typeof isPinned === 'boolean' ? isPinned : existing.isPinned;
        const setAnnouncement = typeof isAnnouncement === 'boolean' ? isAnnouncement : existing.isAnnouncement;

        await prisma.message.update({
          where: { id: messageId },
          data: {
            isPinned: setPinned,
            isAnnouncement: setAnnouncement,
            pinnedAt: setPinned || setAnnouncement ? new Date() : null,
            pinnedById: setPinned || setAnnouncement ? userId : null,
          },
        });

        const dto = await getMessageDtoById(messageId, userId);
        if (dto) io.to(channelId).emit('message_updated', dto);
      } catch (err) {
        console.error('Error handling pin_message', err);
        socket.emit('message_error', { error: 'Failed to pin' });
      }
    }
  );

  socket.on('disconnect', () => {
    console.log('Socket disconnected', socket.id);
  });
});

const PORT = Number(process.env.PORT) || 4000;

async function start() {
  // Ensure the auxiliary profile table exists (avatar + lastSeen) and hydrate last-seen cache.
  await ensureProfileTable();
  await ensureDefaultPublicChannel();
  const persisted = await getAllLastSeenAtMsMap();
  for (const [userId, ms] of Object.entries(persisted)) {
    if (typeof ms === 'number') lastSeenMsByUserId.set(userId, ms);
  }

  server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on http://0.0.0.0:${PORT}`);
});
}

start().catch((err) => {
  console.error('Failed to start server', err);
  process.exit(1);
});
