import { createClient } from "jsr:@supabase/supabase-js@2";
import { load } from "https://deno.land/std@0.224.0/dotenv/mod.ts";

const env = await load();
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || env["SUPABASE_URL"];
const SUPABASE_KEY =  Deno.env.get("SUPABASE_SECRET_KEY") || env["SUPABASE_SECRET_KEY"];

if (!SUPABASE_URL) {
    throw new Error("Missing SUPABASE_URL environment variable. Check your GitHub Actions workflow 'env:' section.");
}

if (!SUPABASE_KEY) {
    throw new Error("Missing SUPABASE_SECRET_KEY environment variable. Check your GitHub Actions workflow 'env:' section.");
}

export const supabase = createClient(SUPABASE_URL!, SUPABASE_KEY!);
