import { describe, expect, it } from "vitest";
import { normalizeEmailFailure } from "@/lib/email/failures";

describe("email provider failure normalization", () => {
  it.each([
    [{ statusCode: 429, message: "too many requests" }, "RATE_LIMITED"],
    [{ statusCode: 401, message: "invalid api key" }, "AUTHENTICATION_FAILED"],
    [{ statusCode: 408, message: "timeout" }, "PROVIDER_TIMEOUT"],
    [{ statusCode: 503, message: "unavailable" }, "PROVIDER_UNAVAILABLE"],
    [{ statusCode: 422, message: "invalid recipient" }, "INVALID_RECIPIENT"],
    [{ message: "unrecognized provider failure" }, "UNKNOWN_PROVIDER_ERROR"],
  ] as const)("normalizes %j", (error, category) => {
    expect(normalizeEmailFailure(error).category).toBe(category);
  });

  it("does not retain raw provider details", () => {
    const result = normalizeEmailFailure({ statusCode: 429, message: "Bearer super-secret-key" });
    expect(result).not.toHaveProperty("message");
    expect(JSON.stringify(result)).not.toContain("super-secret-key");
  });
});
