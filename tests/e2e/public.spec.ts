import { test,expect } from "@playwright/test";
test("public brand and navigation are visible",async({page})=>{await page.goto("/");await expect(page.getByRole("heading",{name:/Software that moves/})).toBeVisible();await expect(page.getByRole("link",{name:"Explore products"})).toBeVisible()});
