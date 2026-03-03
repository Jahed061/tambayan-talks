import { prisma } from '../prisma/client';

export type ReceiptAggregate = {
  deliveredCount: number;
  seenCount: number;
  seenBy: { id: string; displayName: string; seenAt: Date }[];
  lastSeenAt: Date | null;
};

function computeAggregate(
  senderId: string,
  rows: { userId: string; deliveredAt: Date | null; seenAt: Date | null; user: { displayName: string } }[],
): ReceiptAggregate {
  const others = rows.filter((r) => r.userId !== senderId);

  const delivered = others.filter((r) => r.deliveredAt);
  const seen = others
    .filter((r) => r.seenAt)
    .sort((a, b) => (a.seenAt!.getTime() - b.seenAt!.getTime()));

  const lastSeenAt = seen.length ? seen[seen.length - 1].seenAt! : null;

  // send last 5 seen users for UI (“Seen by …”)
  const seenBy = seen.slice(Math.max(0, seen.length - 5)).map((r) => ({
    id: r.userId,
    displayName: r.user.displayName,
    seenAt: r.seenAt!,
  }));

  return {
    deliveredCount: delivered.length,
    seenCount: seen.length,
    seenBy,
    lastSeenAt,
  };
}

export async function upsertChannelReceipt(args: {
  messageId: string;
  actorUserId: string;
  senderId: string;
  delivered?: boolean;
  seen?: boolean;
}) {
  const now = new Date();

  // if seen => also delivered
  const deliveredAt = args.seen ? now : args.delivered ? now : undefined;
  const seenAt = args.seen ? now : undefined;

  await prisma.messageReceipt.upsert({
    where: { messageId_userId: { messageId: args.messageId, userId: args.actorUserId } },
    create: {
      messageId: args.messageId,
      userId: args.actorUserId,
      deliveredAt: deliveredAt ?? null,
      seenAt: seenAt ?? null,
    },
    update: {
      ...(deliveredAt ? { deliveredAt } : {}),
      ...(seenAt ? { seenAt } : {}),
      // ensure delivered exists if we set seen
      ...(args.seen ? { deliveredAt: now } : {}),
    },
  });

  const rows = await prisma.messageReceipt.findMany({
    where: { messageId: args.messageId },
    include: { user: { select: { displayName: true } } },
  });

  const mine = rows.find((r) => r.userId === args.actorUserId) ?? null;
  const aggregate = computeAggregate(args.senderId, rows as any);

  return {
    mine: { deliveredAt: mine?.deliveredAt ?? null, seenAt: mine?.seenAt ?? null },
    aggregate,
  };
}

export async function upsertDmReceipt(args: {
  dmMessageId: string;
  actorUserId: string;
  senderId: string;
  delivered?: boolean;
  seen?: boolean;
}) {
  const now = new Date();

  const deliveredAt = args.seen ? now : args.delivered ? now : undefined;
  const seenAt = args.seen ? now : undefined;

  await prisma.dMMessageReceipt.upsert({
    where: { dmMessageId_userId: { dmMessageId: args.dmMessageId, userId: args.actorUserId } },
    create: {
      dmMessageId: args.dmMessageId,
      userId: args.actorUserId,
      deliveredAt: deliveredAt ?? null,
      seenAt: seenAt ?? null,
    },
    update: {
      ...(deliveredAt ? { deliveredAt } : {}),
      ...(seenAt ? { seenAt } : {}),
      ...(args.seen ? { deliveredAt: now } : {}),
    },
  });

  const rows = await prisma.dMMessageReceipt.findMany({
    where: { dmMessageId: args.dmMessageId },
    include: { user: { select: { displayName: true } } },
  });

  const mine = rows.find((r) => r.userId === args.actorUserId) ?? null;
  const aggregate = computeAggregate(args.senderId, rows as any);

  return {
    mine: { deliveredAt: mine?.deliveredAt ?? null, seenAt: mine?.seenAt ?? null },
    aggregate,
  };
}
