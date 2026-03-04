import type {
  Message,
  MessageAttachment,
  MessageReaction,
  MessageReceipt,
  User,
} from '../generated/prisma/client';
import { prisma } from '../prisma/client';
import { getAvatarUrlMap } from '../services/profileStore';

/**
 * Reactions are stored as arbitrary strings in the DB.
 *
 * Supported formats:
 *  - Any unicode emoji (e.g. "😂")
 *  - Custom emoji names in the form :my_custom:
 */
export type ReactionEmoji = string;

/**
 * Used by the UI as convenient quick reactions.
 * (Not a server-side validation list.)
 */
export const DEFAULT_REACTION_EMOJIS: string[] = ['👍', '❤️', '😂', '🎉', '😮', '😢', '👀'];

export type ReactionSummary = {
  emoji: ReactionEmoji;
  count: number;
  me: boolean;
};

export type ReplyPreviewDTO = {
  id: string;
  content: string;
  createdAt: Date;
  isDeleted: boolean;
  sender: { id: string; displayName: string; avatarUrl: string | null };
};

export type MessageAttachmentDTO = {
  id: string;
  kind: 'IMAGE' | 'PDF' | 'AUDIO';
  url: string;
  mimeType: string;
  fileName: string;
  size: number;
  createdAt: Date;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
};

type MessageWithRelations = Message & {
  sender: User;
  replyTo: (Message & { sender: User }) | null;
  pinnedBy: User | null;
  attachments: MessageAttachment[];
  reactions: MessageReaction[];
  receipts: (MessageReceipt & { user: User })[];
};

function buildReactionSummary(reactions: MessageReaction[], currentUserId: string): ReactionSummary[] {
  const byEmoji = new Map<string, ReactionSummary>();

  for (const r of reactions ?? []) {
    const key = String(r.emoji);
    const existing = byEmoji.get(key) ?? { emoji: key, count: 0, me: false };
    existing.count += 1;
    if (r.userId === currentUserId) existing.me = true;
    byEmoji.set(key, existing);
  }

  return Array.from(byEmoji.values())
    .filter((x) => x.count > 0)
    .sort((a, b) => {
      // Highest count first; then stable-ish by emoji string.
      if (b.count !== a.count) return b.count - a.count;
      return a.emoji.localeCompare(b.emoji);
    });
}

function computeStatusForSender(deliveredCount: number, seenCount: number) {
  if (seenCount > 0) return 'seen' as const;
  if (deliveredCount > 0) return 'delivered' as const;
  return 'sent' as const;
}

export function buildMessageDto(
  message: MessageWithRelations,
  currentUserId: string,
  avatarUrlByUserId: Record<string, string | null> = {},
) {
  const receipts = message.receipts ?? [];
  const myReceipt = receipts.find((r) => r.userId === currentUserId) ?? null;

  const others = receipts.filter((r) => r.userId !== message.senderId);

  const deliveredCount = others.filter((r) => r.deliveredAt).length;
  const seenRows = others
    .filter((r) => r.seenAt)
    .sort((a, b) => a.seenAt!.getTime() - b.seenAt!.getTime());

  const seenCount = seenRows.length;
  const lastSeenAt = seenCount ? seenRows[seenCount - 1].seenAt! : null;

  const seenBy = seenRows.slice(Math.max(0, seenRows.length - 5)).map((r) => ({
    id: r.userId,
    displayName: r.user.displayName,
    seenAt: r.seenAt!,
  }));

  return {
    id: message.id,
    content: message.content,
    channelId: message.channelId,
    createdAt: message.createdAt,
    editedAt: message.editedAt,
    isDeleted: message.isDeleted,
    deletedAt: message.deletedAt,

    isPinned: message.isPinned,
    isAnnouncement: message.isAnnouncement,
    pinnedAt: message.pinnedAt,
    pinnedBy: message.pinnedBy
      ? { id: message.pinnedBy.id, displayName: message.pinnedBy.displayName }
      : null,

    replyTo: message.replyTo
      ? ({
          id: message.replyTo.id,
          content: message.replyTo.content,
          createdAt: message.replyTo.createdAt,
          isDeleted: message.replyTo.isDeleted,
          sender: {
            id: message.replyTo.sender.id,
            displayName: message.replyTo.sender.displayName,
            avatarUrl: avatarUrlByUserId[message.replyTo.sender.id] ?? null,
          },
        } satisfies ReplyPreviewDTO)
      : null,

    sender: {
      id: message.sender.id,
      displayName: message.sender.displayName,
      avatarUrl: avatarUrlByUserId[message.sender.id] ?? null,
    },

    attachments: (message.attachments ?? []).map(
      (a) =>
        ({
          id: a.id,
          kind: a.kind,
          url: a.url,
          mimeType: a.mimeType,
          fileName: a.fileName,
          size: a.size,
          createdAt: a.createdAt,
          width: a.width,
          height: a.height,
          durationMs: a.durationMs,
        }) satisfies MessageAttachmentDTO,
    ),

    reactions: buildReactionSummary(message.reactions, currentUserId),

    // ✅ Receipts
    receipt: {
      myDeliveredAt: myReceipt?.deliveredAt ?? null,
      mySeenAt: myReceipt?.seenAt ?? null,

      deliveredCount,
      seenCount,
      lastSeenAt,
      seenBy,

      // only meaningful to show if you are the sender
      statusForSender: currentUserId === message.senderId ? computeStatusForSender(deliveredCount, seenCount) : null,
    },
  };
}

export async function getMessageDtoById(messageId: string, currentUserId: string) {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: {
      sender: true,
      replyTo: { include: { sender: true } },
      pinnedBy: true,
      attachments: true,
      reactions: true,
      receipts: { include: { user: true } },
    },
  });

  if (!message) return null;
  const ids = [
    message.senderId,
    (message as any).replyTo?.senderId,
    (message as any).pinnedById,
  ].filter(Boolean) as string[];
  const avatarMap = await getAvatarUrlMap(ids);
  return buildMessageDto(message as unknown as MessageWithRelations, currentUserId, avatarMap);
} 
