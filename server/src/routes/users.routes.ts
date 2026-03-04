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

    // SQLite + Prisma in this repo doesn't support case-insensitive `mode` filters reliably.
    // Use a small, safe raw query with LOWER() to make search case-insensitive.
    const like = `%${q}%`;

    const rows = (await prisma.$queryRaw`
      SELECT id, email, displayName, role
      FROM User
      WHERE id != ${currentUserId}
        AND (LOWER(displayName) LIKE ${like} OR LOWER(email) LIKE ${like})
      ORDER BY displayName ASC
      LIMIT 20
    `) as Array<{ id: string; email: string; displayName: string; role: string }>;

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
