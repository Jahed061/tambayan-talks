import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import prisma from '../prisma/client';
import { getAvatarUrl, setAvatarUrl } from '../services/profileStore';

const router = Router();

function normalizeUsername(name: string) {
  return name.trim().toLowerCase();
}

// GET /api/profile
router.get('/', requireAuth, async (req, res) => {
  const userId = req.user!.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, displayName: true, role: true },
  });

  if (!user) return res.status(404).json({ error: 'User not found' });

  const avatarUrl = await getAvatarUrl(userId);
  return res.json({ ...user, avatarUrl });
});

// PUT /api/profile
router.put('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;

    const displayNameRaw =
      req.body?.displayName !== undefined ? String(req.body.displayName).trim() : undefined;

    const avatarUrl =
      req.body?.avatarUrl !== undefined ? (req.body.avatarUrl as string | null) : undefined;

    // Update displayName if provided
    let updatedUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, displayName: true, role: true },
    });

    if (!updatedUser) return res.status(404).json({ error: 'User not found' });

    if (displayNameRaw !== undefined) {
      if (!displayNameRaw) return res.status(400).json({ error: 'displayName is required' });

      if (!/^[a-zA-Z][a-zA-Z0-9_]{2,19}$/.test(displayNameRaw)) {
        return res.status(400).json({ error: 'Invalid username format' });
      }

      const canonical = normalizeUsername(displayNameRaw);

      const existing = await prisma.user.findFirst({
        where: { id: { not: userId }, displayName: canonical },
        select: { id: true },
      });

      if (existing) return res.status(409).json({ error: 'Username already taken' });

      updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { displayName: canonical },
        select: { id: true, email: true, displayName: true, role: true },
      });
    }

    // Update avatarUrl if provided (supports null to clear)
    if (avatarUrl !== undefined) {
      await setAvatarUrl(userId, avatarUrl);
    }

    const finalAvatarUrl = await getAvatarUrl(userId);
    return res.json({ ...updatedUser, avatarUrl: finalAvatarUrl });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to update profile' });
  }
});

export default router;