export type DeploymentCompose = {
  services?: Record<string, {
    restart?: string;
    healthcheck?: unknown;
    networks?: string[] | Record<string, unknown>;
    depends_on?: Record<string, { condition?: string }>;
    ports?: Array<number | string | { published?: number | string; target?: number | string }>;
    volumes?: string[];
  }>;
};

export function verifyTopology(
  compose: DeploymentCompose,
  caddyfile: string,
  dockerfile: string,
): { required: string[]; checks: string[] };

export function loadAndVerify(options?: {
  composePath?: string;
  environmentPath?: string;
  caddyPath?: string;
  dockerfilePath?: string;
}): { required: string[]; checks: string[] };
