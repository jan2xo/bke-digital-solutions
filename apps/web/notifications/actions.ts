"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/apps/web/auth/session";
import {
  dismissNotification,
  markNotificationRead,
} from "@/apps/web/notifications/center";

function notificationId(formData: FormData): string {
  const value = formData.get("notificationId");
  if (typeof value !== "string" || !value.trim() || value.length > 160) {
    throw new Error("INVALID_NOTIFICATION_ID");
  }
  return value.trim();
}

function refreshNotificationSurfaces() {
  revalidatePath("/dashboard/notifications");
  revalidatePath("/admin/notifications");
  revalidatePath("/dashboard");
  revalidatePath("/admin");
}

export async function markNotificationReadAction(formData: FormData) {
  const user = await requireUser();
  await markNotificationRead({
    userId: user.id,
    role: user.role,
    notificationId: notificationId(formData),
  });
  refreshNotificationSurfaces();
}

export async function dismissNotificationAction(formData: FormData) {
  const user = await requireUser();
  await dismissNotification({
    userId: user.id,
    role: user.role,
    notificationId: notificationId(formData),
  });
  refreshNotificationSurfaces();
}
