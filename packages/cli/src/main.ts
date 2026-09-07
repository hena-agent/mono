#!/usr/bin/env bun
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import { makeCommand } from "./command.ts";
import { serve } from "./serve.ts";

Command.run(makeCommand(serve), { version: "0.0.0" }).pipe(
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
