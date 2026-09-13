import "server-only";

import { db } from "@/v2/platform/host/db";
import type { SchedulerEventSink } from "@/v2/platform/scheduler";

const eventSink: SchedulerEventSink = {
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
};

export const schedulerEventSink: SchedulerEventSink = Object.freeze(eventSink);
