import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import prisma from '../prisma/client';

/**
 * Profile routes
 * - Update display name (username)
 *
 * NOTE:
 * This project’s Prisma client types do not support the `mode: 'insensitive'`
 * option on string filters (older Prisma versions). To keep this buildable and
 * still enforce *practical* uniqueness, we normalize usernames to a canonical
 * lowercase form on write and compare against that canonical form.
 *
 * This makes uniqueness effectively case-insensitive without relying on Prisma
 * filter `mode`.
 */
const router = Router();

function normalizeUsername(name: string) {
  return name.trim().toLowerCase();
}

router.put('/profile', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;

    const displayNameRaw = String(req.body?.displayName ?? '').trim();
    if (!displayNameRaw) {
      return res.status(400).json({ error: 'displayName is required' });
    }

    // Basic username validation: 3-20 chars, starts with a letter, letters/numbers/_ only.
    if (!/^[a-zA-Z][a-zA-Z0-9_]{2,19}$/.test(displayNameRaw)) {
      return res.status(400).json({ error: 'Invalid username format' });
    }

    const canonical = normalizeUsername(displayNameRaw);

    // Enforce uniqueness (case-insensitive) by comparing canonicalized strings.
    // We store canonical in displayName to ensure future comparisons match.
    const existing = await prisma.user.findFirst({
      where: {
        id: { not: userId },
        displayName: canonical,
      },
      select: { id: true },
    });

    if (existing) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { displayName: canonical },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        createdAt: true,
      },
    });

    return res.json({ user: updated });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to update profile' });
  }
});

export default router;
