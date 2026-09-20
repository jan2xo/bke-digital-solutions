export function verifyRestartPolicies(compose: { services?: Record<string, { restart?: string; healthcheck?: unknown }> }): { ok: boolean; longRunning: string[]; migration?: string };
