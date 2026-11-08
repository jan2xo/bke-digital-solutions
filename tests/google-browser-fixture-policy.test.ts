import { describe, expect, it } from "vitest";
import { assertGoogleFixtureEnvironment } from "./e2e/google-fixture-policy";
const local = { NODE_ENV: "test", DEPLOYMENT_ENV: "test", BKE_E2E_DISPOSABLE_DB: "1",
  DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:5432/disposable", APP_URL: "http://127.0.0.1:3000" };
describe("disposable Google browser-fixture boundary", () => {
  it("permits explicitly selected local and existing private certification Docker targets", () => {
    expect(() => assertGoogleFixtureEnvironment(local, local.APP_URL)).not.toThrow();
    const docker = { ...local, DATABASE_URL: "postgresql://fixture:fixture@postgres:5432/disposable", APP_URL: "https://caddy" };
    expect(() => assertGoogleFixtureEnvironment(docker, docker.APP_URL)).not.toThrow();
  });
  it.each([
    { NODE_ENV: "production" }, { DEPLOYMENT_ENV: "production" }, { BKE_E2E_DISPOSABLE_DB: undefined },
    { DATABASE_URL: "postgresql://fixture:fixture@production.neon.tech:5432/customers" },
    { DATABASE_URL: "postgresql://fixture:fixture@postgres:5432/disposable", APP_URL: "https://unrelated.example" },
  ])("rejects unsafe fixture environment %j", (override) => {
    const environment = { ...local, ...override };
    expect(() => assertGoogleFixtureEnvironment(environment, environment.APP_URL!)).toThrow();
  });
  it("rejects a public app even with a local database", () => {
    expect(() => assertGoogleFixtureEnvironment(local, "https://live.example")).toThrow();
  });
});
