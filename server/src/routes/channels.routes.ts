import { Router } from 'express';
import { prisma } from '../prisma/client';
import { buildMessageDto } from '../data/messageDto';
import type { JwtUser } from '../middleware/auth';
import { getAvatarUrlMap } from '../services/profileStore';

const router = Router();

const DEFAULT_PUBLIC_CHANNEL_ID = 'public';
const DEFAULT_PUBLIC_CHANNEL_NAME = 'general';
const RESERVED_CHANNEL_NAMES = new Set([DEFAULT_PUBLIC_CHANNEL_NAME, 'public']);

// GET /api/channels  -> list all channels
router.get('/', async (_req, res) => {
  try {
    const channels = await prisma.channel.findMany({ orderBy: { createdAt: 'asc' } });
    // ensure default public channel shows first
    channels.sort((a, b) => {
      if (a.id === DEFAULT_PUBLIC_CHANNEL_ID) return -1;
      if (b.id === DEFAULT_PUBLIC_CHANNEL_ID) return 1;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
    res.json(channels);
  } catch (err) {
    console.error('Failed to load channels', err);
    res.status(500).json({ error: 'Failed to load channels' });
  }
});

// POST /api/channels  -> create a new channel
router.post('/', async (req, res) => {
  try {
    const user = (req as any).user as JwtUser | undefined; // requireAuth attaches this

    const { name, description } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Channel name is required' });
    }

    // Only TEACHER/ADMIN can create channels during the study
    if (!user || (user.role !== 'TEACHER' && user.role !== 'ADMIN')) {
      return res.status(403).json({ error: 'Only teachers/admins can create channels' });
    }

    const normalized = String(name).trim();
    const lower = normalized.toLowerCase();
    if (RESERVED_CHANNEL_NAMES.has(lower) || lower === DEFAULT_PUBLIC_CHANNEL_ID) {
      return res.status(400).json({ error: 'That channel name is reserved' });
    }

    // Make sure the "owner" user exists
    const creatorId = String(user?.id || 'teacher-1');
    await prisma.user.upsert({
      where: { id: creatorId },
      update: {},
      create: {
        id: creatorId,
        email: `${creatorId}@example.com`,
        password: 'demo-password',
        displayName: 'Demo Teacher',
        role: 'TEACHER',
      },
    });

    // IMPORTANT: ownerId is required by your Channel model
    const channel = await prisma.channel.create({
      data: {
        name: normalized,
        description: description || null,
        ownerId: creatorId,
      },
    });

    res.status(201).json(channel);
  } catch (err) {
    console.error('Failed to create channel', err);
    res.status(500).json({ error: 'Failed to create channel' });
  }
});

// GET /api/channels/:id/messages  -> list recent messages in a channel
router.get('/:id/messages', async (req, res) => {
  try {
    const channelId = req.params.id;
    const user = (req as any).user as JwtUser | undefined;
    const currentUserId = String(user?.id || 'teacher-1');

    const messages = await prisma.message.findMany({
      where: { channelId },
      orderBy: { createdAt: 'asc' },
      include: {
        sender: true,
        replyTo: {
          include: { sender: true },
        },
        pinnedBy: true,
        attachments: true,
        reactions: true,
        receipts: { include: { user: true } },
      },
      take: 200,
    });

    const userIds: string[] = [];
    for (const m of messages) {
      userIds.push(m.senderId);
      if ((m as any).replyTo?.senderId) userIds.push((m as any).replyTo.senderId);
      if ((m as any).pinnedById) userIds.push((m as any).pinnedById);
    }
    const avatarMap = await getAvatarUrlMap(userIds);
    res.json(messages.map((m) => buildMessageDto(m as any, currentUserId, avatarMap)));
  } catch (err) {
    console.error('Failed to load messages', err);
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

export default router;
