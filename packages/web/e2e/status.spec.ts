import { expect, test, type WebSocketRoute } from "@playwright/test";

test("the built SPA connects to hena serve over WebSocket on desktop and mobile", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`${page.url()}: ${error.message}`));
  const websocket = page.waitForEvent("websocket", (socket) => socket.url().endsWith("/rpc"));
  await page.goto("/");
  expect((await websocket).url()).toMatch(/\/rpc$/);
  await expect(page.getByRole("heading", { name: "A small beginning." })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Server ready");
  expect(errors).toEqual([]);
  await page.getByRole("link", { name: "System" }).click();
  await expect(page).toHaveURL(/\/system$/);
  await expect(page.getByRole("heading", { name: "System status" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("status")).toHaveText("Server ready");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});

test("recovers after the RPC websocket disconnects without reloading the page", async ({
  page,
}) => {
  const connections: WebSocketRoute[] = [];
  const errors: string[] = [];
  let online = true;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.routeWebSocket("**/rpc", (socket) => {
    connections.push(socket);
    if (online) socket.connectToServer();
    else socket.close({ code: 1013, reason: "test outage" });
  });
  await page.goto("/");
  await expect(page.getByRole("status")).toHaveText("Server ready");
  online = false;
  for (const connection of connections)
    await connection.close({ code: 1013, reason: "test outage" });
  await expect
    .poll(async () => {
      await page.getByRole("button", { name: "Check connection" }).click();
      return page.getByRole("status").textContent();
    })
    .toBe("Server unavailable");
  online = true;
  await expect
    .poll(async () => {
      await page.getByRole("button", { name: "Check connection" }).click();
      return page.getByRole("status").textContent();
    })
    .toBe("Server ready");
  expect(errors).toEqual([]);
});
