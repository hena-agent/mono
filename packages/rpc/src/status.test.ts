import { expect, it } from "@effect/vitest";
import { Schema } from "effect";

import { ServerStatus, StatusRpc } from "./status.ts";

it("defines the status wire contract with Effect Schema", () => {
  expect(Schema.decodeSync(ServerStatus)({ id: "server", status: "ready" })).toEqual({
    id: "server",
    status: "ready",
  });
  expect(() =>
    Schema.decodeUnknownSync(ServerStatus)({ id: "server", status: "offline" }),
  ).toThrow();
  expect(() => Schema.decodeUnknownSync(ServerStatus)({ id: "other", status: "ready" })).toThrow();
  expect(StatusRpc["_tag"]).toBe("server.status");
  expect(StatusRpc.successSchema).toBe(ServerStatus);
});
