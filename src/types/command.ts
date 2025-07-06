import { StaticDecode, Type as T } from "@sinclair/typebox";

export const commandSchema = T.Object({
  name: T.Literal("time"),
  parameters: T.Object({
    duration: T.String(),
  }),
});

export type Command = StaticDecode<typeof commandSchema>;
