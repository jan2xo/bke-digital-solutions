import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  projectProductBroadcast,
} from "@/apps/web/notifications/product-broadcast-contract";

const publicRoute = readFileSync(
  "app/api/licensing-agent/notifications/route.ts",
  "utf8",
);
const adminRoute = readFileSync(
  "app/api/admin/notifications/product-broadcasts/route.ts",
  "utf8",
);
const service = readFileSync(
  "apps/web/notifications/product-broadcasts.ts",
  "utf8",
);

describe("product broadcast authority", () => {
  it("projects only exact-version active broadcasts into the Agent contract", () => {
    const now = new Date("2026-10-02T00:00:00.000Z");
    expect(projectProductBroadcast({
      sourceReference: "550e8400-e29b-41d4-a716-446655440000",
      sourceEvent: "BETA_ENDED",
      priority: "HIGH",
      attributes: {
        productVersion: "1.0.3",
        deliveryMode: "EVERY_LAUNCH",
        startsAt: "2026-10-01T00:00:00.000Z",
      },
      createdAt: new Date("2026-10-01T00:00:00.000Z"),
      expiresAt: new Date("2026-10-03T00:00:00.000Z"),
    }, "1.0.3", now)).toEqual({
      broadcastId: "550e8400-e29b-41d4-a716-446655440000",
      code: "BETA_ENDED",
      audience: "ALL_ACTIVE_CLIENTS",
      priority: "HIGH",
      deliveryMode: "EVERY_LAUNCH",
      publishedAt: "2026-10-01T00:00:00.000Z",
      startsAt: "2026-10-01T00:00:00.000Z",
      endsAt: "2026-10-03T00:00:00.000Z",
    });

    expect(projectProductBroadcast({
      sourceReference: "550e8400-e29b-41d4-a716-446655440000",
      sourceEvent: "BETA_ENDED",
      priority: "HIGH",
      attributes: {
        productVersion: "1.0.2",
        deliveryMode: "ONCE",
        startsAt: "2026-10-01T00:00:00.000Z",
      },
      createdAt: new Date("2026-10-01T00:00:00.000Z"),
      expiresAt: null,
    }, "1.0.3", now)).toBeNull();
  });

  it("fails closed for malformed, future, expired, or unsupported broadcast rows", () => {
    const now = new Date("2026-10-02T00:00:00.000Z");
    const base = {
      sourceReference: "550e8400-e29b-41d4-a716-446655440000",
      sourceEvent: "TRIAL_ENDED",
      priority: "NORMAL",
      attributes: {
        productVersion: "1.0.3",
        deliveryMode: "ONCE",
        startsAt: "2026-10-01T00:00:00.000Z",
      },
      createdAt: new Date("2026-10-01T00:00:00.000Z"),
      expiresAt: null,
    };

    expect(projectProductBroadcast({
      ...base,
      sourceReference: "not-a-uuid",
    }, "1.0.3", now)).toBeNull();
    expect(projectProductBroadcast({
      ...base,
      attributes: { ...base.attributes, startsAt: "2026-10-03T00:00:00.000Z" },
    }, "1.0.3", now)).toBeNull();
    expect(projectProductBroadcast({
      ...base,
      expiresAt: new Date("2026-10-01T23:59:59.000Z"),
    }, "1.0.3", now)).toBeNull();
    expect(projectProductBroadcast({
      ...base,
      sourceEvent: "UNSUPPORTED",
    }, "1.0.3", now)).toBeNull();
  });

  it("wires Digital Solutions durable notifications to the Agent product-broadcast contract", () => {
    for (const marker of [
      'capabilityId: "bke.product-broadcasts"',
      'contractVersion: 1',
      'source: "bke-digital-solutions"',
      "listProductBroadcasts",
      '"cache-control": "no-store"',
    ]) {
      expect(publicRoute).toContain(marker);
    }

    for (const marker of [
      "requireRecentAdmin",
      "publishProductBroadcast",
      "endProductBroadcast",
      "PRODUCT_BROADCAST_CODES",
    ]) {
      expect(adminRoute).toContain(marker);
    }

    for (const marker of [
      "persistNotification",
      'audience: { kind: "ALL_ACTIVE_CLIENTS" }',
      'sourceModule: "notifications"',
      'action: "PRODUCT_BROADCAST_PUBLISHED"',
      'action: "PRODUCT_BROADCAST_ENDED"',
    ]) {
      expect(service).toContain(marker);
    }
  });
});
