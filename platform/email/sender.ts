import { z } from "zod";

const address = z.email().max(254);
export type EmailSender = Readonly<{ email: string; name?: string }>;

/** One server-owned sender format for both the binding and fallback provider. */
export function parseEmailSender(value: unknown): EmailSender | undefined {
  if (typeof value !== "string" || value.length > 512 || /[\r\n\0]/.test(value)) return undefined;
  const text = value.trim();
  const display = /^([^<>]*)<([^<>]+)>$/.exec(text);
  const email = (display ? display[2] : text)?.trim();
  if (!email || !address.safeParse(email).success) return undefined;
  const name = display?.[1]?.trim();
  if (name && name.length > 128) return undefined;
  return Object.freeze({ email, ...(name ? { name } : {}) });
}
