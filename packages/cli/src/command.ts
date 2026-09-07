import { Effect, Schema } from "effect";
import { Command, Flag } from "effect/unstable/cli";

export interface ServeOptions {
  readonly host: string;
  readonly port: number;
  readonly cwd: string;
  readonly open: boolean;
}

export const makeCommand = <E, R>(
  serve: (options: ServeOptions) => Effect.Effect<void, E, R>,
): Command.Command<"hena", {}, {}, E, R> =>
  Command.make("hena").pipe(
    Command.withSubcommands([
      Command.make(
        "serve",
        {
          host: Flag.string("host").pipe(Flag.withDefault("127.0.0.1")),
          port: Flag.integer("port").pipe(
            Flag.withSchema(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }))),
            Flag.withDefault(4400),
          ),
          cwd: Flag.directory("cwd", { mustExist: true }).pipe(Flag.withDefault(".")),
          open: Flag.boolean("open").pipe(Flag.withDefault(false)),
        },
        serve,
      ),
    ]),
  );
