import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("disposable workerd concurrent dashboard transport retry", () => {
  it("uses the promise-based timer API without passing a callback", () => {
    const source = readFileSync("scripts/workers-smoke.mjs", "utf8");
    expect(source).toContain('import { setTimeout } from "node:timers/promises"');
    expect(source).toContain("await setTimeout(attempt * 250);");
    expect(source).not.toMatch(/new Promise\s*\(\s*\(resolve\)\s*=>\s*setTimeout\s*\(resolve/u);
    expect(source).toContain('code !== "UND_ERR_SOCKET" && code !== "ECONNRESET"');
    expect(source).toContain("attempt === 3");
  });

  it("preserves the concurrent two-principal and logout fail-closed assertions", () => {
    const source = readFileSync("scripts/workers-smoke.mjs", "utf8");
    expect(source).toContain("Promise.all(sessions.map");
    expect(source).toContain('assert.equal(status, 200, "Authenticated dashboard failed")');
    expect(source).toContain('assert.ok(html.includes(session.name), "Own principal missing")');
    expect(source).toContain('assert.ok(!html.includes(sessions[1 - index].name), "Cross-account data exposure")');
    expect(source).toContain('assert.ok([303, 307].includes(loggedOut.status)');
  });
});
