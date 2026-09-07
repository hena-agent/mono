import { HenaRpc } from "@hena-dev/rpc";
import { Layer } from "effect";
import { HttpStaticServer } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import { StatusHandlers } from "./status.ts";

export const routes = (webRoot: string): ReturnType<typeof HttpStaticServer.layer> =>
  Layer.mergeAll(
    RpcServer.layerHttp({ group: HenaRpc, path: "/rpc" }).pipe(
      Layer.provide([StatusHandlers, RpcSerialization.layerNdjson]),
    ),
    HttpStaticServer.layer({ root: webRoot, spa: true, cacheControl: "no-cache" }),
  );
