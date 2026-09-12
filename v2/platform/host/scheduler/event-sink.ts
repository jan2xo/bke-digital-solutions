import "server-only";

import { db } from "@/v2/platform/host/db";
import type { SchedulerEventSink } from "@/v2/platform/scheduler";

export const schedulerEventSink: SchedulerEventSink = Object.freeze({
  async emit(event) {
    await db.auditLog.create({
      data: {
        actorId: event.actorId,
        action: event.action,
        targetType: event.targetType,
        targetId: event.targetId,
        metadata: event.metadata ?? undefined,
      },
    });
  },
});
