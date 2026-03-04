import { Router } from 'express';
import prisma from '../prisma/client';
import { getAvatarUrl, setAvatarUrl } from '../services/profileStore';

const router = Router();

// GET /api/profile
router.get('/', async (req, res) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, displayName: true, role: true },
  });

  if (!user) return res.status(404).json({ error: 'User not found' });

  const avatarUrl = await getAvatarUrl(userId);
  return res.json({ ...user, avatarUrl });
});

// PUT /api/profile
router.put('/', async (req, res) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { displayName, avatarUrl } = req.body as {
    displayName?: string;
    avatarUrl?: string | null;
  };

  const updates: { displayName?: string } = {};

  if (typeof displayName === 'string') {
    const name = displayName.trim();
    if (name.length < 3 || name.length > 20) {
      return res.status(400).json({ error: 'Username must be 3–20 characters' });
    }
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)) {
      return res
        .status(400)
        .json({ error: 'Username must start with a letter and use letters, numbers, underscore' });
    }

    // Uniqueness (case-insensitive) without Prisma `mode` support:
    // Pull existing displayNames and compare in JS.
    const normalized = name.toLowerCase();
    const others = await prisma.user.findMany({
      where: { id: { not: userId } },
      select: { id: true, displayName: true },
      take: 1000,
    });

    const taken = others.some((u) => (u.displayName ?? '').toLowerCase() === normalized);
    if (taken) return res.status(409).json({ error: 'Username already taken' });

    updates.displayName = name;
  }

  // avatarUrl is optional and stored separately.
  if (avatarUrl !== undefined) {
    const v = avatarUrl === null ? null : String(avatarUrl).trim();
    if (v && v.length > 400) return res.status(400).json({ error: 'Avatar URL too long' });
    await setAvatarUrl(userId, v || null);
  }

  if (Object.keys(updates).length) {
    await prisma.user.update({ where: { id: userId }, data: updates });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, displayName: true, role: true },
  });
  if (!user) return res.status(404).json({ error: 'User not found' });

  const newAvatarUrl = await getAvatarUrl(userId);
  return res.json({ ...user, avatarUrl: newAvatarUrl });
});
 
export default router;
