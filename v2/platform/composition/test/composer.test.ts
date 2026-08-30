import { describe, expect, it } from "vitest";
import type { CapabilityModule } from "../../../contracts/capability";
import {
  ECHO_CAPABILITY_ID,
  type EchoCapabilityV1,
} from "../../../modules/echo/contracts/echo.contract";
import { echoModule } from "../../../modules/echo/module";
import { composeCapabilities } from "../composer";

const PROBE_CAPABILITY_ID = "bke.echo-probe.v1";

interface EchoProbeCapability {
  run(): string;
}

function echoProbeModule(): CapabilityModule {
  return {
    manifest: {
      moduleId: "echo-probe",
      needs: [ECHO_CAPABILITY_ID],
      provides: [PROBE_CAPABILITY_ID],
    },
    start(resolver) {
      const echo = resolver.get<EchoCapabilityV1>(ECHO_CAPABILITY_ID);
      return [
        {
          id: PROBE_CAPABILITY_ID,
          value: {
            run: () => echo.echo("probe"),
          } satisfies EchoProbeCapability,
        },
      ];
    },
  };
}

describe("V2 capability composition", () => {
  it("starts modules by declared capability dependency, not array order", async () => {
    const application = await composeCapabilities([
      echoProbeModule(),
      echoModule,
    ]);

    expect(application.moduleIds).toEqual(["echo", "echo-probe"]);
    expect(
      application.get<EchoProbeCapability>(PROBE_CAPABILITY_ID).run(),
    ).toBe("echo:probe");
  });

  it("fails closed when a required capability has no provider", async () => {
    await expect(composeCapabilities([echoProbeModule()])).rejects.toThrow(
      /cannot resolve remaining module needs/i,
    );
  });

  it("rejects duplicate capability authority", async () => {
    const duplicate: CapabilityModule = {
      manifest: {
        moduleId: "duplicate-echo",
        needs: [],
        provides: [ECHO_CAPABILITY_ID],
      },
      start() {
        return [{ id: ECHO_CAPABILITY_ID, value: {} }];
      },
    };

    await expect(composeCapabilities([echoModule, duplicate])).rejects.toThrow(
      /declared by both/i,
    );
  });

  it("prevents a module from reaching an undeclared capability", async () => {
    const undeclaredReader: CapabilityModule = {
      manifest: {
        moduleId: "undeclared-reader",
        needs: [],
        provides: ["bke.undeclared-reader.v1"],
      },
      start(resolver) {
        resolver.get(ECHO_CAPABILITY_ID);
        return [{ id: "bke.undeclared-reader.v1", value: {} }];
      },
    };

    await expect(
      composeCapabilities([echoModule, undeclaredReader]),
    ).rejects.toThrow(/undeclared capability access/i);
  });
});
