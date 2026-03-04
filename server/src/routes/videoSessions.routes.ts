import { Router } from 'express';
import { prisma } from '../prisma/client';

const router = Router();

// POST /api/video-sessions
router.post('/', async (req, res) => { 
  try {
    const user = (req as any).user;

    // Basic auth check (allow any logged-in user, including STUDENT)
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { title, description, channelId, startTime, endTime } = req.body;

    if (!title || !startTime || !endTime) {
      return res
        .status(400)
        .json({ error: 'Title, start time, and end time are required' });
    }

    const start = new Date(startTime);
    const end = new Date(endTime);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({ error: 'Invalid start or end time' });
    }
    
    // Make sure the user exists in DB (no fake user creation)
      const teacherId = String(user.id);

    const existing = await prisma.user.findUnique({ where: { id: teacherId } });
      if (!existing) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const randomSlug = Math.random().toString(36).slice(2, 8);
    const videoLink = `https://meet.jit.si/tambayan-${randomSlug}`;

    const session = await prisma.videoSession.create({
      data: {
        title,
        description: description || null,
        startTime: start,
        endTime: end,
        videoLink,
        teacherId: teacherId,        // ✅ definitely exists now
        channelId: channelId || null, // nullable FK is okay
      },
    });

    return res.status(201).json(session);
  } catch (err) {
    console.error('Failed to create session', err);
    return res.status(500).json({ error: 'Failed to create session' });
  }
});

// GET /api/video-sessions/upcoming
router.get('/upcoming', async (_req, res) => {
  try {
    const now = new Date();

    const sessions = await prisma.videoSession.findMany({
      where: { endTime: { gt: now } },
      orderBy: { startTime: 'asc' },
    });

    return res.json(sessions);
  } catch (err) {
    console.error('Failed to fetch sessions', err);
    return res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

export default router;
