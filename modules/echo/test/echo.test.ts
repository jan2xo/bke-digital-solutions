import { describe, expect, it } from "vitest";
import { ECHO_CAPABILITY_ID } from "../contracts/echo.contract";
import { createEchoCapability } from "../logic/echo-capability";
import { echoModuleManifest } from "../module.manifest";

describe("echo capability", () => {
  it("owns a deterministic capability implementation", () => {
    expect(createEchoCapability().echo("hello")).toBe("echo:hello");
  });

  it("declares exactly what it needs and gives", () => {
    expect(echoModuleManifest.needs).toEqual([]);
    expect(echoModuleManifest.provides).toEqual([ECHO_CAPABILITY_ID]);
  });
});
