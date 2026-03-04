import { Router, type Request } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// Uploads are stored on disk (server/uploads). The files are served at /uploads/<name>.

import type { File as MulterFile } from "multer";

export type UploadedAttachmentDTO = {
  kind: 'IMAGE' | 'PDF' | 'AUDIO';
  url: string;
  mimeType: string;
  fileName: string;
  size: number;
};

const router = Router();

const uploadsDir = path.resolve(process.cwd(), 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req: Request, _file: MulterFile, cb: (error: Error | null, destination: string) => void) =>
    cb(null, uploadsDir),
  filename: (_req: Request, file: MulterFile, cb: (error: Error | null, filename: string) => void) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeExt = ext && ext.length <= 10 ? ext : '';
    const id = crypto.randomBytes(16).toString('hex');
    cb(null, `${Date.now()}-${id}${safeExt}`);
  },
});

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25MB
const MAX_FILES_PER_REQUEST = 8;

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES_PER_REQUEST },
  fileFilter: (_req: Request, file: MulterFile, cb: multer.FileFilterCallback) => {
    const mime = String(file.mimetype || '').toLowerCase();

    const okImage = mime.startsWith('image/');
    const okPdf = mime === 'application/pdf';
    const okAudio = mime.startsWith('audio/');

    if (okImage || okPdf || okAudio) return cb(null, true);
    return cb(new Error('Unsupported file type'));
  },
});

function kindFromMime(mimeType: string): UploadedAttachmentDTO['kind'] {
  const m = mimeType.toLowerCase();
  if (m === 'application/pdf') return 'PDF';
  if (m.startsWith('audio/')) return 'AUDIO';
  return 'IMAGE';
}

// POST /api/uploads  (multipart/form-data; field name: "files")
router.post('/', upload.array('files', MAX_FILES_PER_REQUEST), (req, res) => {
  const files = (((req as any).files as MulterFile[]) ?? []) as MulterFile[];

  const out: UploadedAttachmentDTO[] = files.map((f) => ({
    kind: kindFromMime(f.mimetype),
    url: `/uploads/${encodeURIComponent(f.filename)}`,
    mimeType: f.mimetype,
    fileName: f.originalname,
    size: f.size,
  }));

  res.json({ attachments: out });
});

export default router;
