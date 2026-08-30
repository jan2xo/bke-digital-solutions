import type { EchoCapabilityV1 } from "../contracts/echo.contract";

export function createEchoCapability(): EchoCapabilityV1 {
  return Object.freeze({
    echo(input: string): string {
      return `echo:${input}`;
    },
  });
}
