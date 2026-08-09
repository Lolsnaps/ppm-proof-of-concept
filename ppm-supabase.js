// JavaScript source code
(function () {
  const SUPABASE_URL = "https://qmfigesgkoirirgpgmse.supabase.co";
  const SUPABASE_KEY = "sb_publishable_l7G-k06ZfHtlY8wfBUHl4A_pBYc32ng";

  window.PPMSupabase = supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: window.sessionStorage
      }
    }
  );
})();
