import { createHmac } from "node:crypto";
import type { Page } from "@playwright/test";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function decode(value: string) { let bits = ""; for (const char of value) bits += alphabet.indexOf(char).toString(2).padStart(5, "0"); const bytes = []; for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(bytes); }
export function totpCode(secret: string) { const message = Buffer.alloc(8); message.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000))); const digest = createHmac("sha1", decode(secret)).update(message).digest(); const offset = digest[digest.length - 1] & 15; const binary = ((digest[offset] & 127) << 24) | ((digest[offset + 1] & 255) << 16) | ((digest[offset + 2] & 255) << 8) | (digest[offset + 3] & 255); return String(binary % 1_000_000).padStart(6, "0"); }

export async function enrollAndLoginAdmin(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").first().fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Begin secure setup" }).click();
  const secret = (await page.locator("code").first().textContent())!.trim();
  await page.getByLabel("Six-digit code").fill(totpCode(secret));
  await page.getByRole("button", { name: "Enable MFA" }).click();
  const recoveryCodes = ((await page.locator("pre").textContent()) ?? "").trim().split("\n");
  await page.getByRole("button", { name: "I saved these codes" }).click();
  await page.waitForURL(/admin\/security/);
  return { secret, recoveryCodes };
}
