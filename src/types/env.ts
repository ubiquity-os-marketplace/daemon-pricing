import { StaticDecode, Type as T } from "@sinclair/typebox";
import { LOG_LEVEL } from "@ubiquity-os/ubiquity-os-logger";

export const envSchema = T.Object({
  LOG_LEVEL: T.Optional(T.Enum(LOG_LEVEL)),
  KERNEL_PUBLIC_KEY: T.Optional(T.String()),
  UOS_AI_TOKEN: T.Optional(T.String()),
  ACTION_REF: T.Optional(T.String()),
  APP_ID: T.Optional(T.String()),
  APP_PRIVATE_KEY: T.Optional(T.String()),
  APP_INSTALLATION_ID: T.Optional(T.String()),
});

export type Env = StaticDecode<typeof envSchema>;
