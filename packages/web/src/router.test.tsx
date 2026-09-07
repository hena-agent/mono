// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { HenaRpc } from "@hena-dev/rpc";
import { Effect, Layer, ManagedRuntime } from "effect";
import { RpcTest } from "effect/unstable/rpc";
import { expect, it, vi } from "vitest";
import { StrictMode } from "react";

vi.mock("./rpc-client.ts", async (original) => {
  const actual = await original<typeof import("./rpc-client.ts")>();
  return {
    ...actual,
    createClient: vi.fn((url: Effect.Effect<string>) =>
      ManagedRuntime.make(
        Layer.effect(
          actual.Client,
          Effect.gen(function* () {
            expect(yield* url).toBe("ws://localhost:3000/rpc");
            return yield* RpcTest.makeClient(HenaRpc);
          }),
        ).pipe(
          Layer.provide(
            HenaRpc.toLayer({
              "server.status": () =>
                Effect.suspend(() =>
                  online
                    ? Effect.succeed({ id: "server" as const, status: "ready" as const })
                    : Effect.die("offline"),
                ),
            }),
          ),
        ),
      ),
    ),
  };
});

import { getRouter } from "./router.tsx";
let online = true;

it("navigates instantly with shared state, displays failures, and releases resources", async () => {
  window.scrollTo = vi.fn();
  const router = getRouter();
  router.update({
    context: router.options.context!,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const context = router.options.context!;
  const dispose = vi.spyOn(context.runtime, "dispose");
  const clear = vi.spyOn(context.queryClient, "clear");
  const cleanup = vi.spyOn(context.collection, "cleanup");
  const runPromise = vi.spyOn(context.runtime, "runPromise");
  const view = render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
    { container: document },
  );
  await screen.findByRole("heading", { name: "A small beginning." });
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Server ready"));
  expect(router.options.defaultPreload).toBe("intent");
  expect(router.options.defaultPreloadDelay).toBe(0);
  expect(router.options.scrollRestoration).toBe(true);
  expect(document.title).toBe("hena / A small beginning");
  expect(document.querySelector("meta[charset]")?.getAttribute("charset")).toBe("utf-8");
  expect(document.querySelector('link[rel="stylesheet"]')).not.toBeNull();
  expect(runPromise.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  expect(document.querySelector('meta[name="viewport"]')?.getAttribute("content")).toBe(
    "width=device-width, initial-scale=1",
  );
  fireEvent.click(screen.getByRole("link", { name: "System" }));
  await screen.findByRole("heading", { name: "System status" });
  online = false;
  fireEvent.click(screen.getByRole("button", { name: "Check connection" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Server unavailable"));
  online = true;
  fireEvent.click(screen.getByRole("button", { name: "Check connection" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Server ready"));
  const replacement = getRouter().options.context!;
  const nextDispose = vi.spyOn(replacement.runtime, "dispose");
  await act(async () => {
    router.update({ context: replacement });
    await router.invalidate();
  });
  await waitFor(() => expect(dispose).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Server ready"));
  await act(() => router.navigate({ to: "/missing" as "/" }));
  await screen.findByRole("heading", { name: "This page is not here." });
  view.unmount();
  await waitFor(() => expect(nextDispose).toHaveBeenCalledOnce());
  expect(dispose).toHaveBeenCalledOnce();
  expect(clear).toHaveBeenCalledOnce();
  expect(cleanup).toHaveBeenCalledOnce();
});
