export async function resolveProviderSource<T>(input: { source: "environment" | "database"; allowEnvironmentFallback: boolean; database: () => Promise<T>; environment: () => T | Promise<T> }) {
  if (input.source === "environment") return input.environment();
  try { return await input.database(); }
  catch (error) {
    if (input.allowEnvironmentFallback) return input.environment();
    throw error;
  }
}
