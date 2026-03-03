import { Router } from 'express';
import { prisma } from '../prisma/client';
import bcrypt from 'bcryptjs';
import { getAvatarUrlMap } from '../services/profileStore';

type DmAttachmentDTO = {
  kind: 'IMAGE' | 'PDF' | 'AUDIO';
  url: string;
  mimeType: string;
  fileName: string;
  size: number;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
};

const DM_PREFIX = '__TTDM__';

function unpackDmContent(raw: string): { text: string; attachments: DmAttachmentDTO[] } {
  if (typeof raw !== 'string') return { text: '', attachments: [] };
  if (!raw.startsWith(DM_PREFIX)) return { text: raw, attachments: [] };
  try {
    const parsed = JSON.parse(raw.slice(DM_PREFIX.length));
    const text = String(parsed?.t ?? '');
    const attachments = Array.isArray(parsed?.a) ? (parsed.a as DmAttachmentDTO[]) : [];
    return { text, attachments };
  } catch {
    return { text: raw, attachments: [] };
  }
}

const router = Router();

/**
 * Optional: keep demo accounts available if your UI depends on them.
 * IMPORTANT: passwords must be bcrypt-hashed (your login uses bcrypt.compare).
 */
async function ensureDemoUsers() {
  const demoHash = await bcrypt.hash('demo-password', 10);

  await prisma.user.upsert({
    where: { id: 'teacher-1' },
    update: {},
    create: {
      id: 'teacher-1',
      email: 'teacher-1@example.com',
      password: demoHash,
      displayName: 'Demo Teacher',
      role: 'TEACHER',
    },
  });

  await prisma.user.upsert({
    where: { id: 'student-1' },
    update: {},
    create: {
      id: 'student-1',
      email: 'student-1@example.com',
      password: demoHash,
      displayName: 'Demo Student',
      role: 'STUDENT',
    },
  });
}

function getAuthedUserId(req: any) {
  const id = req?.user?.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

// GET /api/dms/threads  -> list DM threads for current user
router.get('/threads', async (req, res) => {
  try {
    const currentUserId = getAuthedUserId(req);
    if (!currentUserId) return res.status(401).json({ error: 'Not authenticated' });

    // Optional demo support
    await ensureDemoUsers();

    const threads = await prisma.dMThread.findMany({
      where: {
        OR: [{ userAId: currentUserId }, { userBId: currentUserId }],
      },
      include: {
        userA: true,
        userB: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const otherUserIds: string[] = [];
    for (const t of threads as any[]) {
      const otherUser = t.userAId === currentUserId ? t.userB : t.userA;
      if (otherUser?.id) otherUserIds.push(otherUser.id);
    }
    const avatarMap = await getAvatarUrlMap(otherUserIds);

    const result = threads.map((t: any) => {
      const otherUser = t.userAId === currentUserId ? t.userB : t.userA;
      return {
        id: t.id,
        otherUser: {
          id: otherUser.id,
          displayName: otherUser.displayName,
          avatarUrl: avatarMap[otherUser.id] ?? null,
        },
      };
    });

    res.json(result);
  } catch (err) {
    console.error('Failed to load DM threads', err);
    res.status(500).json({ error: 'Failed to load DM threads' });
  }
});

// POST /api/dms/threads  -> create / get DM thread with recipientId (optional/legacy)
router.post('/threads', async (req, res) => {
  try {
    const currentUserId = getAuthedUserId(req);
    if (!currentUserId) return res.status(401).json({ error: 'Not authenticated' });

    const { recipientId } = req.body as { recipientId?: string };
    if (!recipientId) return res.status(400).json({ error: 'recipientId is required' });
    if (recipientId === currentUserId) return res.status(400).json({ error: 'Cannot DM yourself' });

    await ensureDemoUsers();

    const [userAId, userBId] =
      currentUserId < recipientId ? [currentUserId, recipientId] : [recipientId, currentUserId];

    let thread = await prisma.dMThread.findFirst({
      where: { userAId, userBId },
      include: { userA: true, userB: true },
    });

    if (!thread) {
      thread = await prisma.dMThread.create({
        data: { userAId, userBId },
        include: { userA: true, userB: true },
      });
    }

    const otherUser = thread.userAId === currentUserId ? thread.userB : thread.userA;

    const avatarMap = await getAvatarUrlMap([otherUser.id]);
    res.json({
      threadId: thread.id,
      otherUser: {
        id: otherUser.id,
        displayName: otherUser.displayName,
        avatarUrl: avatarMap[otherUser.id] ?? null,
      },
    });
  } catch (err) {
    console.error('Failed to create/get DM thread', err);
    res.status(500).json({ error: 'Failed to create/get DM thread' });
  }
});

// GET /api/dms/threads/:id/messages  -> DM messages in a thread
router.get('/threads/:id/messages', async (req, res) => {
  try {
    const currentUserId = getAuthedUserId(req);
    if (!currentUserId) return res.status(401).json({ error: 'Not authenticated' });

    const threadId = req.params.id;

    // Ensure user belongs to this thread
    const thread = await prisma.dMThread.findUnique({ where: { id: threadId } });
    if (!thread) return res.status(404).json({ error: 'Thread not found' });

    const allowed = thread.userAId === currentUserId || thread.userBId === currentUserId;
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });

    const messages = await prisma.dMMessage.findMany({
      where: { threadId },
      orderBy: { createdAt: 'asc' },
      include: { sender: true, receipts: { include: { user: true } } },
      take: 200,
    });

    const senderIds = messages.map((m) => m.senderId);
    const avatarMap = await getAvatarUrlMap(senderIds);

const result = messages.map((m) => {
  const unpacked = unpackDmContent(String(m.content ?? ''));
  return {
  id: m.id,
  content: unpacked.text,
  attachments: unpacked.attachments,
  threadId: m.threadId,
  createdAt: m.createdAt,
  senderId: m.senderId,
  senderName: m.sender.displayName,
  senderAvatarUrl: avatarMap[m.senderId] ?? null,

  receipt: {
    deliveredCount: (m.receipts ?? []).filter((r) => r.userId !== m.senderId && r.deliveredAt).length,
    seenCount: (m.receipts ?? []).filter((r) => r.userId !== m.senderId && r.seenAt).length,
    lastSeenAt: (() => {
      const seen = (m.receipts ?? [])
        .filter((r) => r.userId !== m.senderId && r.seenAt)
        .sort((a, b) => a.seenAt!.getTime() - b.seenAt!.getTime());
      return seen.length ? seen[seen.length - 1].seenAt : null;
    })(),
    seenBy: (() => {
      const seen = (m.receipts ?? [])
        .filter((r) => r.userId !== m.senderId && r.seenAt)
        .sort((a, b) => a.seenAt!.getTime() - b.seenAt!.getTime());
      return seen.slice(Math.max(0, seen.length - 5)).map((r) => ({
        id: r.userId,
        displayName: r.user.displayName,
        seenAt: r.seenAt!,
      }));
    })(),
  },
  };
});

    res.json(result);
  } catch (err) {
    console.error('Failed to load DM messages', err);
    res.status(500).json({ error: 'Failed to load DM messages' });
  }
});

// POST /api/dms/threads/:id/messages  -> create a DM message
router.post('/threads/:id/messages', async (req, res) => {
  try {
    const currentUserId = getAuthedUserId(req);
    if (!currentUserId) return res.status(401).json({ error: 'Not authenticated' });

    const threadId = req.params.id;
    const { content, attachments } = req.body as { content?: string; attachments?: DmAttachmentDTO[] };

    const safeText = String(content ?? '').trim();
    const safeAttachments = Array.isArray(attachments) ? attachments.slice(0, 8) : [];

    if (!safeText && safeAttachments.length === 0) {
      return res.status(400).json({ error: 'Content or attachments are required' });
    }

    // Ensure user belongs to this thread
    const thread = await prisma.dMThread.findUnique({ where: { id: threadId } });
    if (!thread) return res.status(404).json({ error: 'Thread not found' });

    const allowed = thread.userAId === currentUserId || thread.userBId === currentUserId;
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });

    const packedContent = safeAttachments.length
      ? `${DM_PREFIX}${JSON.stringify({ t: safeText, a: safeAttachments })}`
      : safeText;

    const message = await prisma.dMMessage.create({
      data: {
        threadId,
        senderId: currentUserId,
        content: packedContent,
      },
      include: { sender: true },
    });

    // Keep this response in the same shape as the realtime `dm_message` payload
    // and what the frontend expects.
    const avatarMap = await getAvatarUrlMap([message.senderId]);
    const unpacked = unpackDmContent(String(message.content ?? ''));
    return res.status(201).json({
      id: message.id,
      content: unpacked.text,
      attachments: unpacked.attachments,
      createdAt: message.createdAt,
      senderId: message.senderId,
      senderName: message.sender.displayName,
      senderAvatarUrl: avatarMap[message.senderId] ?? null,
      threadId: message.threadId,
    });
  } catch (err) {
    console.error('Failed to create DM message', err);
    res.status(500).json({ error: 'Failed to create DM message' });
  }
});

/**
 * POST /api/dms/start
 * Body: { otherUserEmail: string }
 * Start (or reuse) a DM thread with another existing user by email.
 */
router.post('/start', async (req, res) => {
  try {
    const currentUserId = getAuthedUserId(req);
    if (!currentUserId) return res.status(401).json({ error: 'Not authenticated' });

    const { otherUserEmail } = req.body as { otherUserEmail?: string };
    if (!otherUserEmail || typeof otherUserEmail !== 'string') {
      return res.status(400).json({ error: 'otherUserEmail is required' });
    }

    const trimmedEmail = otherUserEmail.trim().toLowerCase();

    const other = await prisma.user.findUnique({ where: { email: trimmedEmail } });
    if (!other) return res.status(404).json({ error: 'No user with that email' });

    if (other.id === currentUserId) return res.status(400).json({ error: 'Cannot DM yourself' });

    const [userAId, userBId] =
      currentUserId < other.id ? [currentUserId, other.id] : [other.id, currentUserId];

    let thread = await prisma.dMThread.findFirst({
      where: { userAId, userBId },
      include: { userA: true, userB: true },
    });

    if (!thread) {
      thread = await prisma.dMThread.create({
        data: { userAId, userBId },
        include: { userA: true, userB: true },
      });
    }

    const otherUser = thread.userAId === currentUserId ? thread.userB : thread.userA;

    const avatarMap = await getAvatarUrlMap([otherUser.id]);
    return res.json({
      threadId: thread.id,
      otherUser: {
        id: otherUser.id,
        displayName: otherUser.displayName,
        avatarUrl: avatarMap[otherUser.id] ?? null,
      },
    });
  } catch (err) {
    console.error('Error starting DM', err);
    return res.status(500).json({ error: 'Failed to start DM' });
  }
});

export default router;
