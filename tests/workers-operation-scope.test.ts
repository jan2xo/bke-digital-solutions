import { describe, expect, it } from "vitest";
import { currentOperationDatabaseUrl, operationResource, withOperationResponse } from "../platform/host/operation-scope";

describe("Workers operation lifetime", () => {
  it("isolates concurrent operations and disposes only their own resources", async () => {
    const closed: string[] = [];
    const cleanup: Promise<unknown>[] = [];
    const serve = (id: string) => withOperationResponse(id, async () => {
      const value = operationResource("same-key", () => ({ id }), async (resource) => { closed.push(resource.id); });
      await new Promise((resolve) => setTimeout(resolve, id === "first" ? 5 : 1));
      expect(currentOperationDatabaseUrl()).toBe(id);
      expect(operationResource("same-key", () => ({ id: "wrong" }))).toBe(value);
      return new Response(value.id);
    }, (promise) => { cleanup.push(promise); });
    const [first, second] = await Promise.all([serve("first"), serve("second")]);
    expect(await first.text()).toBe("first");
    expect(await second.text()).toBe("second");
    await Promise.all(cleanup);
    expect(closed.sort()).toEqual(["first", "second"]);
    expect(currentOperationDatabaseUrl()).toBeUndefined();
  });

  it("keeps resources alive through streamed data and tracked background work", async () => {
    let disposed = false;
    let finish!: () => void;
    const background = new Promise<void>((resolve) => { finish = resolve; });
    const cleanup: Promise<unknown>[] = [];
    const response = await withOperationResponse("database", async (track) => {
      operationResource("client", () => ({}), async () => { disposed = true; });
      track(background.then(() => {
        expect(currentOperationDatabaseUrl()).toBe("database");
        expect(disposed).toBe(false);
      }));
      let sent = false;
      return new Response(new ReadableStream({
        pull(controller) {
          expect(disposed).toBe(false);
          if (sent) controller.close();
          else { sent = true; controller.enqueue(new TextEncoder().encode("stream")); }
        },
      }));
    }, (promise) => { cleanup.push(promise); });
    expect(await response.text()).toBe("stream");
    expect(disposed).toBe(false);
    finish();
    await Promise.all(cleanup);
    expect(disposed).toBe(true);
  });

  it("cleans up when the handler fails", async () => {
    let disposed = false;
    const cleanup: Promise<unknown>[] = [];
    await expect(withOperationResponse("database", async () => {
      operationResource("client", () => ({}), async () => { disposed = true; });
      throw new Error("handler failed");
    }, (promise) => { cleanup.push(promise); })).rejects.toThrow("handler failed");
    await Promise.all(cleanup);
    expect(disposed).toBe(true);
  });

  it("cleans up on response cancellation", async () => {
    let disposed = false;
    const cleanup: Promise<unknown>[] = [];
    const response = await withOperationResponse("database", async () => {
      operationResource("client", () => ({}), async () => { disposed = true; });
      return new Response(new ReadableStream({ pull() {} }));
    }, (promise) => { cleanup.push(promise); });
    await response.body!.cancel();
    await Promise.all(cleanup);
    expect(disposed).toBe(true);
  });

  it("fails closed without an active operation or database binding", async () => {
    expect(() => operationResource("client", () => ({}))).toThrow("WORKER_OPERATION_SCOPE_REQUIRED");
    await expect(withOperationResponse("", async () => new Response(), () => {}))
      .rejects.toThrow("WORKER_DATABASE_BINDING_REQUIRED");
  });
});
