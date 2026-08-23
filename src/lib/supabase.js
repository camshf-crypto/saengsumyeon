import { createClient } from "@supabase/supabase-js";

// .env.local
// VITE_SUPABASE_URL=...
// VITE_SUPABASE_ANON_KEY=...
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);
