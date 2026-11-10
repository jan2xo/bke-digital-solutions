import { describe, expect, it, vi } from "vitest";
import { createPostgresEmailOutboxStore } from "@/apps/web/email";

describe("verified-paid invoice targeted outbox SQL", () => {
  it("only selects the order-scoped purchase confirmation and leaves generic cron scans broad", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const store = createPostgresEmailOutboxStore(() => ({ query }) as never);
    await store.listDispatchable({
      limit: 1, maxAttempts: 5, deduplicationKey: "purchase-confirmed:order-paid-1",
    });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, args] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('"deduplicationKey" = $4');
    expect(sql).toContain('"type" = $5');
    expect(sql).toContain('"status" IN (\'PENDING\', \'FAILED\')');
    expect(args).toEqual(expect.arrayContaining([5, 1, "purchase-confirmed:order-paid-1", "PURCHASE_CONFIRMED"]));

    await store.listDispatchable({ limit: 20, maxAttempts: 5 });
    expect(query).toHaveBeenCalledTimes(2);
    expect((query.mock.calls[1] as unknown as [string, unknown[]])[1][3]).toBeNull();
  });
});
