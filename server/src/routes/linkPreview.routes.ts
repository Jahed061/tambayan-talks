import { Router } from 'express';
import { fetchLinkPreview } from '../services/linkPreview';

const router = Router();

// POST /api/link-preview  { url }
router.post('/', async (req, res) => {
  try {
    const url = String((req.body as any)?.url ?? '').trim();
    if (!url) return res.status(400).json({ error: 'Missing url' });

    const preview = await fetchLinkPreview(url);
    return res.json(preview);
  } catch (err: any) {
    const msg = String(err?.message || 'Failed to fetch preview');
    return res.status(400).json({ error: msg });
  }
});

export default router;
