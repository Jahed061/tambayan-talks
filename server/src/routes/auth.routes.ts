import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import prisma from '../prisma/client';
import { requireAuth, requireRole, getOptionalAuthUser, type UserRole } from '../middleware/auth';
import { createTokenPair, sha256 } from '../services/tokens';
import { sendMail } from '../services/mailer';
import {
  getEmailVerified,
  setEmailVerified,
  createAuthToken,
  consumeAuthToken,
} from '../services/authStore';
import { getAvatarUrl } from '../services/profileStore';

const router = Router();

function signToken(user: { id: string; role: UserRole }) {
  const secret = process.env.JWT_SECRET!;
  return jwt.sign({ id: user.id, role: user.role }, secret, { expiresIn: '7d' });
}

function requireEmailVerification() {
  return String(process.env.REQUIRE_EMAIL_VERIFICATION ?? 'true').toLowerCase() !== 'false';
}

function appBaseUrl() {
  return process.env.APP_BASE_URL || 'http://localhost:5173';
}

/**
 * POST /api/guest
 * 
 * Auto-login / auto-provision a unique user per device.
 * Client provides a stable deviceId stored in localStorage.
 *
 * Returns: { token, user }
 */
router.post('/guest', async (req, res) => {
  const { deviceId } = req.body as { deviceId?: string };
  const raw = typeof deviceId === 'string' ? deviceId.trim() : '';
  if (!raw) return res.status(400).json({ error: 'deviceId required' });

  // Make a stable, safe identifier for email.
  const digest = sha256(raw).slice(0, 24);
  const email = `guest_${digest}@guest.local`;
  const fallbackName = `guest_${digest.slice(0, 8)}`;

  // Find or create the user
  let user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, displayName: true, role: true },
  });

  if (!user) {
    const hashed = await bcrypt.hash(`guest-${digest}`, 10);
    user = await prisma.user.create({
      data: {
        email,
        password: hashed,
        displayName: fallbackName,
        role: 'STUDENT',
      },
      select: { id: true, email: true, displayName: true, role: true },
    });

    // Guests don't need email verification.
    await setEmailVerified(user.id, true);
  }

  const token = signToken(user);
  const avatarUrl = await getAvatarUrl(user.id);
  return res.json({
    token,
    user: { ...user, avatarUrl },
  });
});

// who am i?
router.get('/me', requireAuth, async (req, res) => {
  const userId = (req as any).user.id as string;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, displayName: true, role: true },
  });

  if (!user) return res.status(404).json({ error: 'User not found' });
  const avatarUrl = await getAvatarUrl(userId);
  res.json({ ...user, avatarUrl });
});

/**
 * POST /api/signup
 *
 * - Students can self-signup.
 * - Teachers are admin-only: either provide an ADMIN JWT in Authorization header,
 *   or provide adminKey that matches ADMIN_CREATE_TEACHER_KEY (useful for first-time setup).
 *
 * Email verification:
 * - If REQUIRE_EMAIL_VERIFICATION=true (default), signup creates the account but does not log in.
 * - If REQUIRE_EMAIL_VERIFICATION=false, signup returns a JWT immediately.
 */
router.post('/signup', async (req, res) => {
  const { email, password, displayName, role, adminKey } = req.body as {
    email?: string;
    password?: string;
    displayName?: string;
    role?: UserRole;
    adminKey?: string;
  };

  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  const trimmedEmail = email.trim().toLowerCase();
  if (!trimmedEmail) return res.status(400).json({ error: 'email required' });

  if (typeof password !== 'string' || password.trim().length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const desiredRole: UserRole = role === 'TEACHER' ? 'TEACHER' : 'STUDENT';

  // Teacher accounts are admin-only.
  if (desiredRole === 'TEACHER') {
    const jwtUser = getOptionalAuthUser(req);
    const envKey = process.env.ADMIN_CREATE_TEACHER_KEY;

    const authorizedByJwt = jwtUser?.role === 'ADMIN';
    const authorizedByKey = !!envKey && typeof adminKey === 'string' && adminKey === envKey;

    if (!authorizedByJwt && !authorizedByKey) {
      return res.status(403).json({ error: 'Teacher accounts can only be created by an admin' });
    }
  }

  const name =
    typeof displayName === 'string' && displayName.trim().length
      ? displayName.trim()
      : trimmedEmail.split('@')[0];

  const hashed = await bcrypt.hash(password, 10);

  try {
    const user = await prisma.user.create({
      data: {
        email: trimmedEmail,
        password: hashed,
        displayName: name,
        role: desiredRole,
      },
      select: { id: true, email: true, displayName: true, role: true },
    });

    const needsVerification = requireEmailVerification();
    await setEmailVerified(user.id, !needsVerification);

    if (needsVerification) {
      const { token, tokenHash } = createTokenPair();
      const expiresAtMs = Date.now() + 24 * 60 * 60 * 1000; // 24h

      await createAuthToken({
        userId: user.id,
        type: 'EMAIL_VERIFY',
        tokenHash,
        expiresAtMs,
      });

      const verifyUrl = `${appBaseUrl()}/#verify-email?token=${encodeURIComponent(token)}`;

      await sendMail({
        to: user.email,
        subject: 'Verify your email - Tambayan Talks',
        text: `Hi ${user.displayName},\n\nPlease verify your email by opening this link:\n${verifyUrl}\n\nIf you did not create this account, you can ignore this email.`,
      });

      return res.json({ ok: true, requiresEmailVerification: true });
    }

    const token = signToken(user);
    const avatarUrl = await getAvatarUrl(user.id);
    return res.json({
      token,
      user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role, avatarUrl },
    });
  } catch (e: any) {
    if (e.code === 'P2002') return res.status(409).json({ error: 'Email already exists' });
    return res.status(500).json({ error: 'Failed to sign up' });
  }
});

// POST /api/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const trimmedEmail = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: trimmedEmail } });
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

  if (requireEmailVerification()) {
    const verified = await getEmailVerified(user.id);
    if (!verified) {
      return res.status(403).json({
        error: 'Email not verified',
        code: 'EMAIL_NOT_VERIFIED',
        canResend: true,
      });
    }
  }

  const token = signToken(user);
  const avatarUrl = await getAvatarUrl(user.id);
  return res.json({
    token,
    user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role, avatarUrl },
  });
});

// GET /api/verify-email?token=...
router.get('/verify-email', async (req, res) => {
  const token = String(req.query.token ?? '');
  if (!token) return res.status(400).json({ error: 'Missing token' });

  const tokenHash = sha256(token);
  const consumed = await consumeAuthToken({ type: 'EMAIL_VERIFY', tokenHash });
  if (!consumed) return res.status(400).json({ error: 'Invalid or expired token' });

  await setEmailVerified(consumed.userId, true);
  return res.json({ ok: true });
});

// POST /api/verify-email/resend
router.post('/verify-email/resend', async (req, res) => {
  const { email } = req.body as { email?: string };
  if (!email) return res.status(400).json({ error: 'email required' });

  const trimmedEmail = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: trimmedEmail } });

  // Don't leak whether user exists
  if (!user) return res.json({ ok: true });

  // If already verified, nothing to do
  const verified = await getEmailVerified(user.id);
  if (verified) return res.json({ ok: true });

  const { token, tokenHash } = createTokenPair();
  const expiresAtMs = Date.now() + 24 * 60 * 60 * 1000;

  await createAuthToken({
    userId: user.id,
    type: 'EMAIL_VERIFY',
    tokenHash,
    expiresAtMs,
  });

  const verifyUrl = `${appBaseUrl()}/#verify-email?token=${encodeURIComponent(token)}`;

  await sendMail({
    to: user.email,
    subject: 'Verify your email - Tambayan Talks',
    text: `Hi ${user.displayName},\n\nPlease verify your email by opening this link:\n${verifyUrl}\n\nIf you did not request this, you can ignore this email.`,
  });

  return res.json({ ok: true });
});

// POST /api/forgot-password
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body as { email?: string };
  if (!email) return res.status(400).json({ error: 'email required' });

  const trimmedEmail = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: trimmedEmail } });

  // Always return ok to avoid email enumeration
  if (!user) return res.json({ ok: true });

  const { token, tokenHash } = createTokenPair();
  const expiresAtMs = Date.now() + 60 * 60 * 1000; // 1h

  await createAuthToken({
    userId: user.id,
    type: 'PASSWORD_RESET',
    tokenHash,
    expiresAtMs,
  });

  const resetUrl = `${appBaseUrl()}/#reset-password?token=${encodeURIComponent(token)}`;

  await sendMail({
    to: user.email,
    subject: 'Reset your password - Tambayan Talks',
    text: `Hi ${user.displayName},\n\nYou can reset your password using this link (valid for 1 hour):\n${resetUrl}\n\nIf you did not request a password reset, you can ignore this email.`,
  });

  return res.json({ ok: true });
});

// POST /api/reset-password
router.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body as { token?: string; newPassword?: string };
  if (!token) return res.status(400).json({ error: 'token required' });

  if (typeof newPassword !== 'string' || newPassword.trim().length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const tokenHash = sha256(token);
  const consumed = await consumeAuthToken({ type: 'PASSWORD_RESET', tokenHash });
  if (!consumed) return res.status(400).json({ error: 'Invalid or expired token' });

  const hashed = await bcrypt.hash(newPassword, 10);

  await prisma.user.update({
    where: { id: consumed.userId },
    data: { password: hashed },
  });

  return res.json({ ok: true });
});

// POST /api/admin/create-teacher (requires ADMIN)
router.post('/admin/create-teacher', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const { email, password, displayName } = req.body as {
    email?: string;
    password?: string;
    displayName?: string;
  };

  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  if (typeof password !== 'string' || password.trim().length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const trimmedEmail = email.trim().toLowerCase();
  const name =
    typeof displayName === 'string' && displayName.trim().length
      ? displayName.trim()
      : trimmedEmail.split('@')[0];

  const hashed = await bcrypt.hash(password, 10);

  try {
    const user = await prisma.user.create({
      data: {
        email: trimmedEmail,
        password: hashed,
        displayName: name,
        role: 'TEACHER',
      },
      select: { id: true, email: true, displayName: true, role: true },
    });

    const needsVerification = requireEmailVerification();
    await setEmailVerified(user.id, !needsVerification);

    if (needsVerification) {
      const { token, tokenHash } = createTokenPair();
      const expiresAtMs = Date.now() + 24 * 60 * 60 * 1000;

      await createAuthToken({
        userId: user.id,
        type: 'EMAIL_VERIFY',
        tokenHash,
        expiresAtMs,
      });

      const verifyUrl = `${appBaseUrl()}/#verify-email?token=${encodeURIComponent(token)}`;

      await sendMail({
        to: user.email,
        subject: 'Verify your email - Tambayan Talks',
        text: `Hi ${user.displayName},\n\nAn admin created a teacher account for you. Verify your email here:\n${verifyUrl}\n`,
      });

      return res.json({ ok: true, createdUser: user, requiresEmailVerification: true });
    }

    return res.json({ ok: true, createdUser: user });
  } catch (e: any) {
    if (e.code === 'P2002') return res.status(409).json({ error: 'Email already exists' });
    return res.status(500).json({ error: 'Failed to create teacher' });
  }
});

export default router;
