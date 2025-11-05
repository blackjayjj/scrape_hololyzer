import { createClient } from "jsr:@supabase/supabase-js@2";
import { load } from "https://deno.land/std@0.224.0/dotenv/mod.ts";

const env = await load();
const SUPABASE_URL = env["SUPABASE_URL"];
const SUPABASE_KEY = env["SUPABASE_SECRET_KEY"];

export const supabase = createClient(SUPABASE_URL!, SUPABASE_KEY!);
