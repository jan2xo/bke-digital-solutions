import { expect, test } from "@playwright/test";

test("public brand and navigation are visible", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Software that moves/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Explore products" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
});

test("public navigation remains keyboard accessible with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  const productsLink = navigation.getByRole("link", { name: "Products" });
  await expect(productsLink).toBeVisible();
  await productsLink.focus();
  await expect(productsLink).toBeFocused();

  const motion = await page.evaluate(() => {
    const root = document.documentElement;
    const card = document.querySelector(".solution-card");
    const rootStyles = getComputedStyle(root);
    const cardStyles = card ? getComputedStyle(card) : null;
    return {
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      transitionDuration: cardStyles?.transitionDuration,
      animationDuration: cardStyles?.animationDuration,
      scrollBehavior: rootStyles.scrollBehavior,
    };
  });

  expect(motion.reducedMotion).toBe(true);
  expect(motion.transitionDuration).toBe("0.01ms");
  expect(motion.animationDuration).toBe("0.01ms");
  expect(motion.scrollBehavior).toBe("auto");
});
