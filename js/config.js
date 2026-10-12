/* Instellingen voor accounts (Supabase). Zolang url en anonKey leeg zijn, werkt het spel zoals voorheen zonder inloggen.
   Vul hier de "Project URL" en de "anon public"-sleutel van je Supabase-project in (Project Settings > API).
   Die sleutel is bedoeld om openbaar te zijn; de regels in supabase/schema.sql zorgen dat iedereen alleen zijn eigen gegevens ziet.
   Zet hier NOOIT de "service_role"-sleutel. */
window.SS_CONFIG = window.SS_CONFIG || { url: "", anonKey: "" };
