import { StaticDecode, Type as T } from "@sinclair/typebox";
import { LOG_LEVEL } from "@ubiquity-os/ubiquity-os-logger";

export const envSchema = T.Object({
  SUPABASE_URL: T.String(),
  SUPABASE_KEY: T.String(),
  LOG_LEVEL: T.Optional(T.Enum(LOG_LEVEL)),
  KERNEL_PUBLIC_KEY: T.Optional(T.String()),
});

export type Env = StaticDecode<typeof envSchema>;
