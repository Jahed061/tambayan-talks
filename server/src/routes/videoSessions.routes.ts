import { Router } from 'express';
import { prisma } from '../prisma/client';

const router = Router();

// POST /api/video-sessions
router.post('/', async (req, res) => { 
  try {
    const user = (req as any).user;

    // Basic auth check
    if (!user || user.role !== 'TEACHER') {
      return res.status(403).json({ error: 'Only teachers can create sessions' });
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

    // 🔹 make sure the teacher exists in the DB
    const teacherId = String(user.id);

    const teacher = await prisma.user.upsert({
      where: { id: teacherId },
      update: {},
      create: {
        id: teacherId,
        email: `${teacherId}@example.com`,
        password: 'demo-password',
        displayName: 'Demo Teacher',
        role: 'TEACHER',
      },
    });

    console.log('Using teacher:', teacher.id);

    const randomSlug = Math.random().toString(36).slice(2, 8);
    const videoLink = `https://meet.jit.si/tambayan-${randomSlug}`;

    const session = await prisma.videoSession.create({
      data: {
        title,
        description: description || null,
        startTime: start,
        endTime: end,
        videoLink,
        teacherId: teacher.id,        // ✅ definitely exists now
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
