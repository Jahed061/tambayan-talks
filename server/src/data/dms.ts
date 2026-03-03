// server/src/data/dms.ts
import prisma from '../prisma/client';
import { getAvatarUrlMap } from '../services/profileStore';

/**
 * Start (or reuse) a DM thread between `meId` and `otherUserEmail`.
 * Returns the thread id + basic info about the "other" user.
 */
export async function startDm(meId: string, otherUserEmail: string) {
  if (!otherUserEmail || typeof otherUserEmail !== 'string') {
    throw new Error('otherUserEmail is required');
  }

  // Ensure "me" (Demo Teacher) exists, just like before
  const me = await prisma.user.upsert({
    where: { id: meId },
    update: {},
    create: {
      id: meId,
      email: 'demo.teacher@example.com',
      password: 'demo-password',
      displayName: 'Demo Teacher',
      role: 'TEACHER',
    },
  });

  // Ensure the other user exists (create them if not)
  const trimmedEmail = otherUserEmail.trim().toLowerCase();

  const other = await prisma.user.upsert({
    where: { email: trimmedEmail },
    update: {},
    create: {
      email: trimmedEmail,
      password: 'demo-password',
      displayName: trimmedEmail.split('@')[0] || 'New Student',
      role: 'STUDENT',
    },
  });

  // Keep pair order stable so we don't create duplicate threads
  const [userAId, userBId] =
    me.id < other.id ? [me.id, other.id] : [other.id, me.id];

  // Look for an existing thread between these two users
  let thread = await prisma.dMThread.findFirst({
    where: { userAId, userBId },
    include: { userA: true, userB: true },
  });

  // If none exists, create it
  if (!thread) {
    thread = await prisma.dMThread.create({
      data: {
        userAId,
        userBId,
      },
      include: { userA: true, userB: true },
    });
  }

  // Decide who the "other user" is from the client's perspective
  const otherUser =
    thread.userAId === me.id ? thread.userB : thread.userA;

  // This shape is what your frontend expects
  const avatarMap = await getAvatarUrlMap([otherUser.id]);
  return {
    threadId: thread.id,
    otherUser: {
      id: otherUser.id,
      displayName: otherUser.displayName,
      avatarUrl: avatarMap[otherUser.id] ?? null,
    },
  };
}

// 🔹 NEW: this MUST be exported with this exact name
export async function sendDmMessage(
  senderId: string,
  threadId: string,
  content: string,
  attachments?: Array<{
    kind: 'IMAGE' | 'PDF' | 'AUDIO';
    url: string;
    mimeType: string;
    fileName: string;
    size: number;
    width?: number | null;
    height?: number | null;
    durationMs?: number | null;
  }>
) {
  const safeThreadId = String(threadId || '').trim();
  const safeText = String(content ?? '').trim();
  const safeAttachments = Array.isArray(attachments) ? attachments.slice(0, 8) : [];

  if (!safeThreadId) throw new Error('threadId is required');
  if (!safeText && safeAttachments.length === 0) throw new Error('content or attachments are required');

  // Ensure sender is part of the thread (basic safety).
  const thread = await prisma.dMThread.findUnique({ where: { id: safeThreadId }, select: { userAId: true, userBId: true } });
  if (!thread) throw new Error('Thread not found');
  if (thread.userAId !== senderId && thread.userBId !== senderId) throw new Error('Forbidden');

  // Store attachments inside `DMMessage.content` so we don't need a DB schema change.
  // (Keeps Prisma generation offline-friendly.)
  const DM_PREFIX = '__TTDM__';
  const packedContent =
    safeAttachments.length > 0
      ? `${DM_PREFIX}${JSON.stringify({ t: safeText, a: safeAttachments })}`
      : safeText;

  const message = await prisma.dMMessage.create({
    data: {
      threadId: safeThreadId,
      senderId,
      content: packedContent,
    },
    include: {
      sender: true,
    },
  });

  const avatarMap = await getAvatarUrlMap([message.senderId]);

  // Unpack on the way out.
  let outText = message.content;
  let outAttachments: typeof safeAttachments = [];
  if (typeof message.content === 'string' && message.content.startsWith(DM_PREFIX)) {
    try {
      const parsed = JSON.parse(message.content.slice(DM_PREFIX.length));
      outText = String(parsed?.t ?? '');
      outAttachments = Array.isArray(parsed?.a) ? parsed.a : [];
    } catch {
      // If parsing fails, fall back to raw content.
      outText = message.content;
      outAttachments = [];
    }
  }

  return {
    id: message.id,
    content: outText,
    attachments: outAttachments,
    createdAt: message.createdAt,
    senderId: message.senderId,
    senderName: message.sender.displayName,
    senderAvatarUrl: avatarMap[message.senderId] ?? null,
  };
}