import { expect, test } from "@playwright/test";

test("anonymous landing starts unified Google entry and exposes the public catalog", async ({ page }) => {
  await page.goto("/");
  const title = page.getByRole("heading", { name: "One platform. Every BKE solution." });
  await expect(title).toBeVisible();
  await expect(title.locator("span")).toHaveText("solution");
  await expect(page.getByRole("banner")).toHaveCount(0);
  await expect(page.locator('a[href^="mailto:"]')).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Legal" }).getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/legal/privacy");

  const google = page.getByRole("button", { name: "Continue with Google", exact: true });
  const explore = page.getByRole("link", { name: "Explore", exact: true });
  await expect(google).toBeEnabled();
  await expect(explore).toHaveAttribute("href", "/products");

  const scripts = page.getByRole("button", { name: /Scripts Workflows/ });
  await scripts.click();
  await expect(scripts).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: /Cloud workflows/ })).toBeVisible();

  await explore.click();
  await expect(page).toHaveURL(/\/products$/);
  await expect(page.getByRole("heading", { name: "Software for work that matters." })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("banner")).toHaveCount(0);

  let startBody: unknown;
  await page.route("**/api/auth/google/start", async (route) => {
    startBody = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ authorizationUrl: new URL("/login?simulated=oidc", page.url()).toString() }) });
  });
  await google.click();
  await expect(page).toHaveURL(/\/login\?simulated=oidc$/);
  expect(startBody).toMatchObject({ flow: "unified" });
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create an account" })).toHaveCount(0);
});

test("desktop descriptions reveal on hover or focus, including reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  const features = page.getByRole("region", { name: /Not everything digital/ });
  const cards = features.getByRole("article");
  const firstDescription = cards.first().locator("p");
  const secondDescription = cards.nth(1).locator("p");

  await expect(firstDescription).toHaveCSS("opacity", "0");
  await cards.first().hover();
  await expect(firstDescription).toHaveCSS("opacity", "1");
  await expect(secondDescription).toHaveCSS("opacity", "0");

  await features.getByRole("link", { name: "Explore the catalog" }).focus();
  await page.keyboard.press("Tab");
  await expect(cards.first()).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(cards.nth(1)).toBeFocused();
  await expect(secondDescription).toHaveCSS("opacity", "1");
  await expect(secondDescription).toHaveCSS("transition-duration", "0s");
  await expect(page.locator("html")).toHaveCSS("scroll-behavior", "auto");
});

test("touch storefront displays category descriptions at rest", async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const page = await context.newPage();
    await page.goto("/");
    const descriptions = page.getByRole("region", { name: /Not everything digital/ }).getByRole("article").locator("p");
    await expect(descriptions).toHaveCount(3);
    for (const description of await descriptions.all()) {
      await expect(description).toBeVisible();
      await expect(description).toHaveCSS("opacity", "1");
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  } finally {
    await context.close();
  }
});
