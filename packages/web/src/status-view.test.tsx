// @vitest-environment jsdom
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { StatusView } from "./status-view.tsx";

afterEach(cleanup);

it("renders ready, unchecked and failed states without blocking UI", () => {
  const retry = vi.fn();
  const view = render(<StatusView status={undefined} retry={retry} />);
  expect(screen.getByRole("status").textContent).toBe("Local connection");
  view.rerender(<StatusView status="ready" retry={retry} />);
  expect(screen.getByRole("status").textContent).toBe("Server ready");
  expect(
    screen.queryByText("Start the server with bun run hena serve, then check again."),
  ).toBeNull();
  view.rerender(<StatusView status="unavailable" retry={retry} />);
  expect(screen.getByRole("status").textContent).toBe("Server unavailable");
  expect(
    screen.getByText("Start the server with bun run hena serve, then check again."),
  ).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Check connection" }));
  expect(retry).toHaveBeenCalledOnce();
});
