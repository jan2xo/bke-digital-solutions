import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const account = readFileSync("app/dashboard/accounts/[accountId]/page.tsx", "utf8");
const styles = readFileSync("app/globals.css", "utf8");
const license = readFileSync("components/customer-license-card.tsx", "utf8");

describe("Customer account yellow/white hierarchy", () => {
  it("uses the existing BKE yellow token for the account role label and section markers", () => {
    expect(account).toContain('<p className="account-role-eyebrow">{account.type} · {account.effectiveRole}</p>');
    expect(styles).toMatch(/\.account-role-eyebrow\s*\{[^}]*color:\s*var\(--yellow\)/s);
    expect(styles).toMatch(/\.account-section-heading::before\s*\{[^}]*background:\s*var\(--yellow\)/s);
    expect(styles).toMatch(/\.account-section-heading\s*\{[^}]*color:\s*var\(--text\)/s);
  });

  it("marks Products and licenses and Product trials, while keeping order and subscription panels neutral", () => {
    expect(account).toContain('<h2 className="account-section-heading text-2xl font-black">My Software</h2>');
    expect(account).toContain('<h2 className="account-section-heading mb-3 text-2xl font-black">Product trials</h2>');
    expect(account).toContain('<Panel title="Order history">');
    expect(account).toContain('<Panel title="Subscriptions">');
  });

  it("uses a compact no-trial message without altering live trial cards or license key behavior", () => {
    expect(account).toContain('trials.length ? <div className="grid gap-3">');
    expect(account).toContain('<p className="account-trials-empty">No active trials.</p>');
    expect(account).toContain('trial.license.status');
    expect(account).toContain('trial.graceEndsAt.toLocaleString("en-PH", { timeZone: "Asia/Manila" })');
    expect(license).not.toContain("Reveal license key");
    expect(license).not.toContain("/api/licenses/");
    expect(account).toContain('AccountNotificationHighlights accountId={accountId}');
  });
});
