import { Effect } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

export const openBrowser: (
  url: string,
  platform?: NodeJS.Platform,
) => Effect.Effect<void, never, ChildProcessSpawner.ChildProcessSpawner> = Effect.fnUntraced(
  function* (url: string, platform = process.platform) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const command = platform === "darwin" ? "open" : "xdg-open";
    const fallback = Effect.logWarning(`Open ${url} in your browser.`);
    yield* spawner.exitCode(ChildProcess.make(command, [url])).pipe(
      Effect.flatMap((code) => (code === 0 ? Effect.void : fallback)),
      Effect.catch(() => fallback),
    );
  },
);
