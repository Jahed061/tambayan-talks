import { Router } from 'express';
import { prisma } from '../prisma/client';
import { getAvatarUrlMap } from '../services/profileStore';

const router = Router();

function getAuthedUserId(req: any) {
  const id = req?.user?.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

// GET /api/users/search?q=...
// Returns lightweight user results for DM discovery.
router.get('/search', async (req, res) => {
  try {
    const currentUserId = getAuthedUserId(req);
    if (!currentUserId) return res.status(401).json({ error: 'Not authenticated' });

    const qRaw = String(req.query.q ?? '').trim();
    const q = qRaw.toLowerCase();

    if (!q || q.length < 2) {
      return res.json([]);
    }

    // Use Prisma filters for portability (Postgres/MySQL/etc.).
    // Postgres supports case-insensitive search via `mode: 'insensitive'`.
    const rows = await prisma.user.findMany({
      where: {
        id: { not: currentUserId },
        OR: [
          { displayName: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: { id: true, email: true, displayName: true, role: true },
      orderBy: [{ displayName: 'asc' }],
      take: 20,
    });

    const ids = rows.map((r) => r.id);
    const avatarMap = await getAvatarUrlMap(ids);

    return res.json(
      rows.map((r) => ({
        id: r.id,
        email: r.email,
        displayName: r.displayName,
        role: r.role,
        avatarUrl: avatarMap[r.id] ?? null,
      })),
    );
  } catch (err) {
    console.error('Failed to search users', err);
    return res.status(500).json({ error: 'Failed to search users' });
  }
});

export default router;
