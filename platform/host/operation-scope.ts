import { AsyncLocalStorage } from "node:async_hooks";

type Resource = { value: unknown; dispose?: () => Promise<void> };
type OperationScope = {
  databaseUrl: string;
  resources: Map<string, Resource>;
  pending: Set<Promise<unknown>>;
  closed: boolean;
};

// OpenNext's application chunks and the Worker wrapper have separate module
// graphs. Share only the ALS carrier; request data stays in its async context.
const globals = globalThis as typeof globalThis & {
  __bkeOperationStorage?: AsyncLocalStorage<OperationScope>;
};
const storage = globals.__bkeOperationStorage ??= new AsyncLocalStorage<OperationScope>();

export function currentOperationDatabaseUrl(): string | undefined {
  return storage.getStore()?.databaseUrl;
}

export function operationResource<T>(
  key: string,
  create: () => T,
  dispose?: (value: T) => Promise<void>,
): T {
  const scope = storage.getStore();
  if (!scope || scope.closed) throw new Error("WORKER_OPERATION_SCOPE_REQUIRED");
  const existing = scope.resources.get(key);
  if (existing) return existing.value as T;
  const value = create();
  scope.resources.set(key, { value, dispose: dispose ? () => dispose(value) : undefined });
  return value;
}

export async function withOperationResponse(
  databaseUrl: string,
  operation: (track: (promise: Promise<unknown>) => void) => Promise<Response>,
  waitUntil: (promise: Promise<unknown>) => void,
): Promise<Response> {
  if (!databaseUrl.trim()) throw new Error("WORKER_DATABASE_BINDING_REQUIRED");
  const scope: OperationScope = {
    databaseUrl, resources: new Map(), pending: new Set(), closed: false,
  };
  let closing: Promise<void> | undefined;
  function close(): Promise<void> {
    return closing ??= (async () => {
      // after()/waitUntil work may still use the same scoped clients.
      while (scope.pending.size) await Promise.allSettled([...scope.pending]);
      scope.closed = true;
      const results = await Promise.allSettled(
        [...scope.resources.values()].map((entry) => entry.dispose?.()),
      );
      scope.resources.clear();
      if (results.some((result) => result.status === "rejected")) {
        throw new Error("WORKER_RESOURCE_CLEANUP_FAILED");
      }
    })();
  }
  function track(promise: Promise<unknown>): void {
    if (scope.closed) throw new Error("WORKER_OPERATION_CLOSED");
    scope.pending.add(promise);
    void promise.then(
      () => { scope.pending.delete(promise); },
      () => { scope.pending.delete(promise); },
    );
  }
  return storage.run(scope, async () => {
    try {
      const response = await operation(track);
      if (!response.body) {
        waitUntil(close());
        return response;
      }
      const reader = response.body.getReader();
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const result = await storage.run(scope, () => reader.read());
            if (result.done) {
              controller.close();
              waitUntil(close());
            } else {
              controller.enqueue(result.value);
            }
          } catch (error) {
            controller.error(error);
            waitUntil(close());
          }
        },
        async cancel(reason) {
          try {
            await storage.run(scope, () => reader.cancel(reason));
          } finally {
            waitUntil(close());
          }
        },
      });
      return new Response(body, {
        status: response.status, statusText: response.statusText, headers: response.headers,
      });
    } catch (error) {
      waitUntil(close());
      throw error;
    }
  });
}
