import { SupabaseClient } from "@supabase/supabase-js";
import { Context } from "@ubiquity-os/ubiquity-os-kernel";
import { Access } from "./supabase/helpers/tables/access";
import { Label } from "./supabase/helpers/tables/label";
import { Super } from "./supabase/helpers/tables/super";
import { User } from "./supabase/helpers/tables/user";

export function createAdapters(supabaseClient: SupabaseClient, context: Context) {
  return {
    supabase: {
      access: new Access(supabaseClient, context),
      user: new User(supabaseClient, context),
      label: new Label(supabaseClient, context),
      super: new Super(supabaseClient, context),
    },
  };
}
