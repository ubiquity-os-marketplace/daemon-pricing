import { StaticDecode, Type as T } from "@sinclair/typebox";

export const commandSchema = T.Object({
  name: T.Literal("time", {
    description: "Sets the time label for the given task. If no duration is provided, it estimates the time automatically.",
    examples: ["/time"],
  }),
  parameters: T.Object({
    duration: T.Optional(T.String()),
  }),
});

export type Command = StaticDecode<typeof commandSchema>;
