export const ECHO_CAPABILITY_ID = "bke.echo.v1" as const;

export interface EchoCapabilityV1 {
  echo(input: string): string;
}
