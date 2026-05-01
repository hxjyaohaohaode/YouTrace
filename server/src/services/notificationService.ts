import prisma from '../utils/prisma.js';

export async function createNotification(params: {
  userId: string;
  type: string;
  title: string;
  content: string;
  actionUrl?: string;
}) {
  const notification = await prisma.notification.create({
    data: {
      userId: params.userId,
      type: params.type,
      title: params.title,
      content: params.content,
      actionUrl: params.actionUrl || null,
    },
  });
  return notification;
}

export async function getNotifications(userId: string, page = 1, pageSize = 20) {
  const skip = (page - 1) * pageSize;
  const [items, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.notification.count({ where: { userId } }),
    prisma.notification.count({ where: { userId, isRead: false } }),
  ]);

  return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize), unreadCount };
}

export async function markAsRead(userId: string, notificationId: string) {
  const notification = await prisma.notification.findFirst({
    where: { id: notificationId, userId },
  });
  if (!notification) return null;

  return prisma.notification.update({
    where: { id: notificationId },
    data: { isRead: true },
  });
}

export async function markAllAsRead(userId: string) {
  return prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  });
}

export async function deleteNotification(userId: string, notificationId: string) {
  const notification = await prisma.notification.findFirst({
    where: { id: notificationId, userId },
  });
  if (!notification) return false;

  await prisma.notification.delete({ where: { id: notificationId } });
  return true;
}
