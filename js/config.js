/* Instellingen voor accounts (Supabase). Zolang url en anonKey leeg zijn, werkt het spel zoals voorheen zonder inloggen.
   Vul hier de "Project URL" en de "anon public"-sleutel van je Supabase-project in (Project Settings > API).
   Die sleutel is bedoeld om openbaar te zijn; de regels in supabase/schema.sql zorgen dat iedereen alleen zijn eigen gegevens ziet.
   Zet hier NOOIT de "service_role"-sleutel. */
window.SS_CONFIG = window.SS_CONFIG || {
  url: "https://kuricbnzttrlogqipstv.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt1cmljYm56dHRybG9ncWlwc3R2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4MzM0NDQsImV4cCI6MjEwNzQwOTQ0NH0.P0wn5HGidqcAIllVNUl15bHV7sQ6mEzqUqhuQEj7LPs",
};
