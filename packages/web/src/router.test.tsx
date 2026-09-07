// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { Effect, Layer, ManagedRuntime } from "effect";
import { RpcClientError } from "effect/unstable/rpc/RpcClientError";
import { Socket } from "effect/unstable/socket";
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
            return {
              "server.status": () =>
                Effect.suspend(() =>
                  online
                    ? Effect.succeed({ id: "server" as const, status: "ready" as const })
                    : Effect.fail(
                        new RpcClientError({
                          reason: new Socket.SocketOpenError({ kind: "Unknown", cause: "offline" }),
                        }),
                      ),
                ),
            } as typeof actual.Client.Service;
          }),
        ),
      ),
    ),
  };
});

import { getRouter } from "./router.tsx";
import { createClient } from "./rpc-client.ts";
let online = true;

it("navigates instantly with shared state, displays failures, and releases resources", async () => {
  const errors = vi.spyOn(console, "error");
  window.scrollTo = vi.fn();
  const router = getRouter();
  router.update({
    context: router.options.context!,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const context = router.options.context!;
  const runtime = vi.mocked(createClient).mock.results[0]!.value;
  const dispose = vi.spyOn(runtime, "dispose");
  const runPromise = vi.spyOn(runtime, "runPromise");
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
  expect(runPromise.mock.calls[0]?.[1]).toEqual({ signal: expect.any(AbortSignal) });
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
  await act(() => router.navigate({ to: "/missing" as "/" }));
  await screen.findByRole("heading", { name: "This page is not here." });
  view.unmount();
  cleanup();
  expect(dispose).not.toHaveBeenCalled();
  // A route remount does not end the router's lifetime or invalidate its shared client.
  const remount = render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
    { container: document },
  );
  await act(() => router.navigate({ to: "/" }));
  await screen.findByRole("heading", { name: "A small beginning." });
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Server ready"));
  expect(dispose).not.toHaveBeenCalled();
  remount.unmount();
  await context.dispose();
  expect(dispose).toHaveBeenCalledOnce();
  expect(
    errors.mock.calls.filter(([message]) => String(message).includes("[Live Query Error]")),
  ).toEqual([]);
  errors.mockRestore();
});
