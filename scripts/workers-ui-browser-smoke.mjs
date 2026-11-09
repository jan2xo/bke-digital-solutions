import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";

const baseURL = "http://127.0.0.1:8787";

function browserBinary() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    chromium.executablePath(),
  ];
  const found = candidates.find((path) => path && existsSync(path));
  if (found) return found;
  // CI-only disposable browser installation: no real user profile, login,
  // credentials, remote provider, Staging or production.
  const install = spawnSync("npx", ["--no-install", "playwright", "install", "chromium"], {
    stdio: "inherit",
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || undefined },
  });
  if (install.status !== 0) throw new Error("CHROMIUM_CERTIFICATION_INSTALL_FAILED");
  const downloaded = chromium.executablePath();
  if (!existsSync(downloaded)) throw new Error("CHROMIUM_CERTIFICATION_NOT_AVAILABLE");
  return downloaded;
}

const browser = await chromium.launch({
  headless: true, executablePath: browserBinary(),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const errors = [];
try {
  for (const width of [320, 390, 768, 1024, 1440]) {
    const mobile = width <= 390;
    const context = await browser.newContext({
      baseURL,
      viewport: { width, height: mobile ? 844 : 900 },
      isMobile: mobile,
      hasTouch: mobile,
      reducedMotion: "reduce",
    });
    try {
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(`${width}: ${error.message}`));
      const response = await page.goto("/", { waitUntil: "networkidle", timeout: 45000 });
      assert.equal(response?.status(), 200, `Rendered Sonnet homepage failed at ${width}px`);
      await page.getByRole("heading", { name: /One platform.*Every BKE.*solution/ }).waitFor();
      assert.equal(await page.getByRole("banner").count(), 0, "Anonymous navigation must be absent");
      assert.equal(await page.getByRole("link", { name: "Explore", exact: true }).count(), 1);
      const actualWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(actualWidth <= width + 1,
        `Horizontal overflow at ${width}px: content width ${actualWidth}`);
      const features = page.getByRole("region", { name: /Not everything digital/ });
      const cards = features.getByRole("article");
      assert.equal(await cards.count(), 3);
      if (mobile) {
        const description = cards.first().locator("p");
        assert.equal(await description.evaluate((node) => getComputedStyle(node).opacity),
          "1", "Touch cards must reveal their descriptions without hover");
      }
      if (width === 1440) {
        const first = cards.first();
        const description = first.locator("p");
        assert.equal(await description.evaluate((node) => getComputedStyle(node).opacity),
          "0", "Desktop cards must conceal descriptions at rest");
        await first.hover();
        await page.waitForFunction(() => {
          const card = document.querySelector("article[tabindex='0']");
          const description = card?.querySelector("p");
          return !!description && getComputedStyle(description).opacity === "1";
        });
      }
      if (width === 390 || width === 1440) {
        const scripts = page.getByRole("button", { name: /Scripts Workflows/ });
        await scripts.click();
        assert.equal(await scripts.getAttribute("aria-pressed"), "true",
          "Console Scripts mode did not respond to actual browser click");
        await page.getByRole("heading", { name: /Cloud workflows/ }).waitFor();
      }
      if (width === 390) {
        await page.getByRole("link", { name: "Explore", exact: true }).click();
        await page.waitForURL("**/products", { timeout: 15000 });
        await page.getByRole("heading", { name: "Software for work that matters." }).waitFor();
      }
      if (width === 390 || width === 1440) {
        let postedFlow;
        await page.route("**/api/auth/google/start", async (route) => {
          postedFlow = route.request().postDataJSON();
          await route.fulfill({ status: 200, contentType: "application/json",
            body: JSON.stringify({ authorizationUrl: new URL("/login?simulated=oidc", baseURL).toString() }) });
        });
        await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
        await page.waitForURL("**/login?simulated=oidc");
        assert.equal(postedFlow?.flow, "unified",
          "Sonnet CTA must initiate unified server-owned OIDC");
        assert.equal(await page.getByRole("button", { name: "Continue with Google" }).count(), 1,
          "Login should expose the same Google entry without an account creation choice");
        assert.equal(await page.getByRole("link", { name: "Create an account" }).count(), 0);
      }
      assert.deepEqual(errors, [], `Browser runtime errors detected at ${width}px`);
      console.log(`PASS: real workerd Chromium viewport ${width}px, mobile=${mobile}`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
console.log("PASS: hydrated Sonnet UI on actual disposable Workers application");
