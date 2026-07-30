import { z } from "zod";

export const emailSchema = z.email().max(254).transform((v) => v.trim().toLowerCase());
export const passwordSchema = z.string().min(12).max(128).regex(/[a-z]/).regex(/[A-Z]/).regex(/[0-9]/);
export const registerSchema = z.object({ email: emailSchema, name: z.string().trim().min(2).max(100), password: passwordSchema });
export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128) });
export const checkoutSchema = z.object({ purchasePlanId: z.string().cuid() }).strict();
export const activationSchema = z.object({ licenseKey: z.string().regex(/^BKE-[A-F0-9-]{40,}$/), deviceId: z.string().min(16).max(256), label: z.string().trim().max(100).optional(), operatingSystem:z.string().trim().max(80).optional(),architecture:z.string().trim().max(80).optional() });
