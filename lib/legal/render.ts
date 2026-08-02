import "server-only";
import { createHash } from "node:crypto";
import { env } from "@/lib/env";

export type LegalVariables = Record<"company_name" | "support_email" | "website" | "business_address", string>;

export function legalVariables(): LegalVariables {
  return {
    company_name: "BKE Digital Solutions",
    support_email: env.SUPPORT_EMAIL,
    website: env.APP_URL,
    business_address: env.BUSINESS_ADDRESS,
  };
}

export function applyLegalVariables(markdown: string, variables: LegalVariables) {
  return markdown.replace(/\{\{([a-z_]+)\}\}/g, (match, name: string) => Object.hasOwn(variables, name) ? variables[name as keyof LegalVariables] : match);
}

const escapeHtml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const safeHref = (value: string) => {
  try {
    if (value.startsWith("/")) return value;
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "#";
  } catch { return "#"; }
};
function inline(value: string) {
  return escapeHtml(value)
    .replace(/\[([^\]]{1,300})\]\(([^)\s]{1,1000})\)/g, (_all, label: string, href: string) => `<a href="${escapeHtml(safeHref(href))}" rel="noopener noreferrer">${label}</a>`)
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>");
}

export function renderLegalMarkdown(markdown: string, variables = legalVariables()) {
  const source = applyLegalVariables(markdown.replaceAll("\r\n", "\n"), variables);
  const lines = source.split("\n");
  const output: string[] = [];
  let listOpen = false;
  const closeList = () => { if (listOpen) { output.push("</ul>"); listOpen = false; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { closeList(); continue; }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) { closeList(); const level = heading[1].length; output.push(`<h${level}>${inline(heading[2])}</h${level}>`); continue; }
    const item = /^[-*]\s+(.+)$/.exec(line);
    if (item) { if (!listOpen) { output.push("<ul>"); listOpen = true; } output.push(`<li>${inline(item[1])}</li>`); continue; }
    closeList();
    output.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return output.join("\n");
}

export const legalContentHash = (html: string) => createHash("sha256").update(html).digest("hex");
