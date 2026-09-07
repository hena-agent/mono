import { expect, test } from "@playwright/test";

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
