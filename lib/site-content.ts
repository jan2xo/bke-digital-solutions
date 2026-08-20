import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";

export const SITE_CONTENT_GROUPS = {
  brand: ["siteName"],
  hero: ["heroEyebrow", "heroHeadline", "heroDescription", "heroPrimaryLabel", "heroPrimaryHref", "heroSecondaryLabel", "heroSecondaryHref"],
  solutions: ["solutionsEyebrow", "solutionsHeading", "solutionsAccent", "solutionsLinkLabel"],
  footer: ["footerText", "supportEmail"],
} as const;
export const SITE_CONTENT_KEYS = Object.values(SITE_CONTENT_GROUPS).flat() as [string, ...string[]];
export type SiteContentKey = (typeof SITE_CONTENT_KEYS)[number];
const relativeOrHttpsUrl = z.string().trim().refine((value) => value.startsWith("/") || /^https:\/\//.test(value), "Use a relative path or HTTPS URL");
const valuesSchema = z.object({
  siteName: z.string().trim().min(1).max(80),
  heroEyebrow: z.string().trim().min(1).max(120), heroHeadline: z.string().trim().min(1).max(220), heroDescription: z.string().trim().min(1).max(600),
  heroPrimaryLabel: z.string().trim().min(1).max(60), heroPrimaryHref: relativeOrHttpsUrl.max(300), heroSecondaryLabel: z.string().trim().min(1).max(60), heroSecondaryHref: relativeOrHttpsUrl.max(300),
  solutionsEyebrow: z.string().trim().min(1).max(120), solutionsHeading: z.string().trim().min(1).max(180), solutionsAccent: z.string().trim().min(1).max(100), solutionsLinkLabel: z.string().trim().min(1).max(80),
  footerText: z.string().trim().max(300), supportEmail: z.string().trim().email().max(160),
}).strict();
export const siteContentInput = z.object({ values: valuesSchema }).strict();
export type SiteContentValues = z.infer<typeof valuesSchema>;
export const DEFAULT_SITE_CONTENT: SiteContentValues = {
  siteName: "BKE Digital Solutions", heroEyebrow: "BKE DIGITAL SOLUTIONS", heroHeadline: "Your workflow, backed up, and ready to grow.", heroDescription: "Secure products, flexible subscriptions, and practical software for teams that need to keep moving.", heroPrimaryLabel: "Explore products", heroPrimaryHref: "/products", heroSecondaryLabel: "Contact us", heroSecondaryHref: "/contact", solutionsEyebrow: "WHAT WE BUILD", solutionsHeading: "Tools for the work", solutionsAccent: "that matters.", solutionsLinkLabel: "View all products", footerText: "Software, SaaS, and licensing for modern organizations.", supportEmail: "support@example.com",
};
export async function getSiteContent(): Promise<SiteContentValues> { const rows = await db.siteContent.findMany({ where: { key: { in: SITE_CONTENT_KEYS } } }); const defaults = DEFAULT_SITE_CONTENT as Record<SiteContentKey, string>; return SITE_CONTENT_KEYS.reduce((result, item) => ({ ...result, [item]: rows.find((row) => row.key === item)?.value ?? defaults[item] }), {} as SiteContentValues); }
export async function saveSiteContent(actorId: string, values: Partial<SiteContentValues>) { const parsed = valuesSchema.parse({ ...DEFAULT_SITE_CONTENT, ...values }); await db.$transaction(async (tx) => { for (const [key, value] of Object.entries(parsed)) { const group = Object.entries(SITE_CONTENT_GROUPS).find(([, keys]) => keys.includes(key as never))?.[0] ?? "other"; await tx.siteContent.upsert({ where: { key }, update: { value, group, updatedBy: actorId }, create: { key, value, group, updatedBy: actorId } }); } await tx.auditLog.create({ data: { actorId, action: "SITE_CONTENT_UPDATED", targetType: "SiteContent", metadata: { keys: Object.keys(parsed) } } }); }); }
export async function resetSiteContent(actorId: string) { await db.$transaction(async (tx) => { await tx.siteContent.deleteMany({ where: { key: { in: SITE_CONTENT_KEYS } } }); await tx.auditLog.create({ data: { actorId, action: "SITE_CONTENT_RESET", targetType: "SiteContent" } }); }); }
