# Accounts instellen (Supabase, eenmalig)

Stemmenstudio gebruikt Supabase voor accounts en om clips en takes online te bewaren. Zolang `js/config.js` leeg is, werkt het spel zonder inloggen, precies zoals voorheen.

1. Maak een gratis account op https://supabase.com en een nieuw project (regio bijvoorbeeld Frankfurt).
2. Open in het project **SQL Editor > New query**, plak de inhoud van `supabase/schema.sql` en klik **Run**. Dit maakt de tabellen, de opslag voor stemopnames en de regels dat iedereen alleen zijn eigen gegevens ziet.
3. **Authentication > URL Configuration**:
   - Site URL: `https://tomvm2005.github.io/TOM/`
   - Redirect URLs: voeg toe `https://tomvm2005.github.io/TOM/` en `https://tomvm2005.github.io/TOM/preview/`
   Dan brengt de link in de bevestigingsmail je terug naar het spel.
4. **Project Settings > API**: kopieer de **Project URL** en de **anon public**-sleutel naar `js/config.js`. Nooit de `service_role`-sleutel gebruiken: die geeft volledige toegang.

Wat er online staat: per account de clips (videolink, stuk, titel, plaatje) en de takes (stemopname, wie, punten, opdracht). Geüploade videobestanden blijven op het apparaat waar ze geüpload zijn; op een ander apparaat vraagt het spel om de video opnieuw te uploaden.
