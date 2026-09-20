import "dotenv/config";
import { describe, expect, it } from "vitest";
const configured = Boolean(process.env.RESEND_API_KEY && process.env.RESEND_SANDBOX_TO && process.env.EMAIL_PROVIDER === "resend");
describe("Resend delivery sandbox", () => {
  it.skipIf(!configured)("delivers from the verified domain through the configured provider abstraction", async () => {
    expect(process.env.EMAIL_FROM).toMatch(/@jl-bke\.com>?$/);
    expect(process.env.APP_URL).toMatch(/^https:\/\//);
    const { emailProvider } = await import("@/lib/email");
    await expect(emailProvider.send({
      to: process.env.RESEND_SANDBOX_TO!,
      subject: "BKE Digital Solutions delivery certification",
      text: `This owner-requested delivery check uses the configured origin: ${process.env.APP_URL}/login`,
    })).resolves.toBeUndefined();
  });
});
