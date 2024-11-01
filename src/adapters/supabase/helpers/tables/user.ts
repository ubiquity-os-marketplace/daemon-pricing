import { SupabaseClient } from "@supabase/supabase-js";
import { Context } from "@ubiquity-os/ubiquity-os-kernel";
import { Super } from "./super";

export class User extends Super {
  constructor(supabase: SupabaseClient, context: Context) {
    super(supabase, context);
  }

  public async getUserId(context: Context, username: string): Promise<number> {
    const { data } = await context.octokit.rest.users.getByUsername({ username });
    return data.id;
  }
}
