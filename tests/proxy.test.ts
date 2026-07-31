import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

const originalDeployment = process.env.DEPLOYMENT_ENV;
const originalDestructive = process.env.ALLOW_DESTRUCTIVE_ADMIN;
afterEach(() => {
  if (originalDeployment === undefined) delete process.env.DEPLOYMENT_ENV; else process.env.DEPLOYMENT_ENV = originalDeployment;
  if (originalDestructive === undefined) delete process.env.ALLOW_DESTRUCTIVE_ADMIN; else process.env.ALLOW_DESTRUCTIVE_ADMIN = originalDestructive;
});

describe("production proxy baseline", () => {
  it("blocks destructive admin deletes unless explicitly owner-enabled", async () => {
    process.env.DEPLOYMENT_ENV = "production";
    process.env.ALLOW_DESTRUCTIVE_ADMIN = "false";
    const response = proxy(new NextRequest("https://commerce.bke.example/api/admin/customers/customer-id", { method: "DELETE" }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "NOT_FOUND" });
  });
  it("emits the production security-header baseline without localhost HSTS", () => {
    process.env.DEPLOYMENT_ENV = "production";
    const production = proxy(new NextRequest("https://commerce.bke.example/products"));
    expect(production.headers.get("strict-transport-security")).toContain("max-age=63072000");
    expect(production.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(production.headers.get("x-content-type-options")).toBe("nosniff");
    process.env.DEPLOYMENT_ENV = "development";
    const local = proxy(new NextRequest("http://localhost:3000/products"));
    expect(local.headers.has("strict-transport-security")).toBe(false);
  });
});
