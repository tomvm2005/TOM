# Stemmenstudio — projectbrief

We verbeteren het bestaande spel **Stemmenstudio** in fasen. Deze brief geldt in elke fase.
Fasen: 0 brief (deze), 1 engine + tests, 2 opnemen/afspelen/opslag betrouwbaar, 3 UI + onboarding, 4 game feel + afronding.
Na elke fase stoppen; Tom beoordeelt voordat de volgende begint.

## Context
- Wat het is: een voice-over party game (zoals thechoicervoicer.app). Spelers kiezen om de beurt een stuk video, bekijken het, en spreken er hun eigen grappige voice-over overheen. De groep geeft punten.
- Huidige stand: `index.html` (opmaak en CSS), `js/engine.js` (spelregels), `js/app.js` (interface). Geen build. Opslag in IndexedDB (clips, takes, bestanden) met geheugen als terugval, voorkeuren en spelers in localStorage.
- Publicatie: GitHub Pages publiceert de repository zoals hij is (`.github/workflows/static.yml`, geen buildstap). Live link: https://tomvm2005.github.io/TOM/. YouTube en Vimeo werken alleen via https, niet via `file://`.
- Stack (keuze): vanilla JavaScript zonder build, zodat Pages blijft werken zoals nu. Gewone `<script>`-bestanden (geen ES-modules), zodat de pagina ook als los bestand opent. Tests met de ingebouwde testrunner van Node; browsertests met Playwright. Geen framework.
- Spelers: 1 tot 8 spelers lokaal op één apparaat (hot-seat), ook solo spelen moet werken.
- Interfacetaal: Nederlands.

## Spelregels (zoals het spel nu werkt)
- **Bron**: elke video-URL (YouTube, Vimeo, directe videolink) of een eigen upload.
- **Clip**: kies een lengte van 10 sec, 30 sec, 1:00, 1:30 of 2:00 (onthouden als voorkeur). Het spel kiest een willekeurig stuk uit de video ("Nieuwe clip"); stukken die al gespeeld zijn worden gemarkeerd en zo veel mogelijk vermeden.
- **Volgorde per take**: eerst de clip bekijken, dan pas opnemen. Opnemen start met een korte aftelling en loopt synchroon met de video. Opnemen kan al terwijl de clip speelt (de knop Opnemen stopt het kijken en start de opname); je hoeft de clip niet uit te kijken.
- **Einde van de clip bij opnemen**: de opname stopt precies aan het einde van de clip (een clip van 10 sec geeft een take van 10 sec) en de microfoon gaat meteen uit. Ook na Stop opname of afbreken gaat de microfoon uit.
- **Doorlopend spelen**: geeft de groep punten aan de take van wie aan de beurt is, dan begint de clip van de volgende speler precies waar die take ophield (speler 1 neemt 0:00–0:10 op, speler 2 krijgt 0:10–0:20). Is de video af, dan volgt een nieuwe willekeurige clip met melding. Nieuwe clip of het blauwe blok kiest nog steeds zelf een ander stuk.
- **Opnieuw**: de knop Opnieuw (toets R) naast Opnemen neemt de laatste take nog een keer op, op dezelfde plek en door dezelfde speler. De oude take (met zijn punten) wordt verwijderd zodra de nieuwe bewaard is; lukt de nieuwe niet, dan blijft de oude staan. Had de oude take de beurt al doorgegeven, dan gaat de beurt eerst terug.
- **Personages** (spelvorm in het startscherm; voorlopig alleen op de testlink): elke naam is een personage uit de video, het aantal namen is het aantal personages. Er zijn geen vaste cliplengtes of rondes: het eerste personage begint bij 0:00 en de opname loopt tot je op Stop opname drukt (als een ander personage in beeld komt) of tot de video af is. Daarna is het volgende personage aan de beurt, vanaf precies die plek; is het iemand anders, tik dan op de naam. Eerst kijken is hier niet nodig, er is geen terugkijken of punten geven tussendoor (punten geven kan nog wel bij de takes, en geeft de beurt niet door). Elk stuk wordt een eigen clip; met "Speel alle clips achter elkaar" kijk je de hele ingesproken video terug.
- **Opdracht** (optioneel): dobbel een gekke opdracht (bijv. "natuurdocumentaire", "sportcommentator") of spreek vrij in.
- **Takes**: elke opname wordt bewaard bij de clip en kan opnieuw afgespeeld, als video gedownload of als losse stem gedownload worden. Alle takes van een clip kunnen achter elkaar afgespeeld worden.
- **Geluid**: bij kijken (Bekijk clip, en na laden) speelt de video met geluid (volumeschuif onder de video). Tijdens opnemen staat het geluid van de video standaard uit (0%, instelbaar). Na opnemen of terugkijken staat het geluid weer terug op het kijkvolume.
- **Pauzeren**: tijdens bekijken, opnemen en terugkijken kan je pauzeren (knop Pauze, toets P, of klikken op het beeld zoals bij YouTube). De opname pauzeert mee, zodat de pauze niet in de take zit.
- **Klik op het beeld**: als er niets loopt, speelt een klik op het beeld de clip af (net als Bekijk clip, telt als bekeken). De clip stopt aan het eind en springt terug naar het begin; opnieuw afspelen speelt de clip weer vanaf het begin. Staat het zwarte lijntje midden in de clip, dan begint een klik op het beeld daar.
- **Cliptijd en spoelen**: linksonder in het beeld staan een afspeel/pauzeknop, de plek in de clip met de cliplengte (bijv. 0:12 / 0:30, gelijk met de timer) en klein de lengte van de hele video. Het zwarte lijntje in de clipbalk is de plek in de video; verslepen spoelt binnen de clip (niet tijdens opnemen of terugkijken). Tijdens bekijken, opnemen en terugkijken toont de clipbalk alleen de clip (of take), zodat het lijntje precies gelijk loopt met de timer naast de stopknop; bij het kiezen van een clip toont hij de hele video. Een ander stuk kies je met het blauwe blok.
- **Reclame overslaan (YouTube)**: rechtsonder in het beeld (waar YouTube de knop Overslaan toont) komt een klik door naar YouTube; de hint meldt een lopende reclame.
- **Timer en balkjes**: de timer, het balkje onder de knoppen, het balkje onder in het beeld en het zwarte lijntje worden elke frame uit dezelfde videotijd getekend en lopen dus gelijk. Het microfoonniveau zie je aan de ring om de opnameknop.
- **Video niet klikbaar**: de video is alleen om naar te kijken; er zijn geen knoppen van YouTube of de browser te bedienen (abonneren, kanaal enzovoort). Alleen geluid en ondertiteling regel je via Stemmenstudio.
- **Ondertiteling**: standaard uit (ook tijdens opnemen); een aan/uit-knop onder de video zet hem aan voor wie de ondertitels wil voorlezen. Uit = vrij inspreken, aan = napraten. Werkt alleen als de video ondertitels heeft.
- **Terugkijken en exporteren**: je hoort alleen je eigen stem, niet het originele geluid van de video. Ondertiteling staat standaard uit.
- **Punten**: na een take geeft de groep 1 tot 5 punten (gezichtjes, of toets 1 t/m 5). De punten gaan naar de speler van die take; de eerste beoordeling geeft de beurt door aan de volgende speler. Scores kunnen op nul gezet worden.
- **Bibliotheek**: bewaarde clips en hun takes blijven op dit apparaat staan, gegroepeerd per sessie (alles wat in één tabblad is opgenomen) met de datum en tijd van opnemen. Oude takes zonder sessie staan per dag. Tik op een sessie om de clips ervan te zien; "Alle clips" toont alles. De knop "Speel alle clips achter elkaar" speelt de takes van de gekozen sessie na elkaar af, op volledig scherm en zonder te stoppen tussen de clips (de video pauzeert niet, geen pauzeknop in beeld; kan de browser geen volledig scherm, dan vult het beeld het venster). Stop (rechtsonder in beeld) of Esc breekt het af. Tijdens het afspelen kan je niet opnemen.
- **Accounts** (alleen als `js/config.js` Supabase-gegevens heeft): registreren met naam, e-mail en wachtwoord (min. 6 tekens, eerst e-mail bevestigen), inloggen en uitloggen via de knop rechtsboven. Ingelogd zie je alleen de clips en takes van je account; die staan online en komen op elk apparaat terug. Zonder account speel je als gast op dit apparaat; gastclips kan je na inloggen meenemen naar je account. Geüploade videobestanden gaan niet online.
- **Uitgesloten**: Tom's eerdere Simpsons-video komt niet terug als voorbeeld of standaardclip.
- **Partij**: een aantal rondes (1, 3 of 5; standaard 3) of vrij spelen zonder einde. Elke speler doet één take per ronde; de eerste beoordeling van de take van wie aan de beurt is geeft de beurt door. Na de laatste ronde volgt de uitslag. Een partij kan ook handmatig afgerond worden.
- **Spelers**: 1 tot 8, namen uniek (hoofdletters tellen niet), maximaal 24 tekens. De knop "Samen als één Team" zet één naam, Team, en kiest vrij spelen.

### Edge cases die de engine moet afvangen
- Opnemen voordat de clip bekeken is, of zonder geladen video: niet toegestaan.
- Clip langer dan de video: clip wordt de hele video (of de kortste lengte die past).
- Alle stukken van een video al gespeeld: dan mag een gespeeld stuk terugkomen, met melding.
- Spelers toevoegen of verwijderen midden in een ronde, of 0 spelers: beurt blijft geldig.
- Een take opnieuw beoordelen verandert de score, maar geeft de beurt niet nog een keer door.
- Een take verwijderen haalt de punten van die take weer weg.
- Gelijkspel in de uitslag: gedeelde winst.

## Game design
- Kernlus: clip kiezen, kijken, opnemen, samen terugkijken en lachen, punten geven, volgende speler.
- Gewenste spelervaring: de lach bij het terugkijken is het hoogtepunt. Alles daaromheen moet snel en zonder gedoe gaan.
- Doelgroep: vrienden en familie samen op de bank of aan tafel, ook kinderen. Casual.
- Sessieduur: een partij van 3 rondes met 3 spelers in ongeveer 15 tot 20 minuten.
- Visuele richting: het huidige lichtblauwe ontwerp (licht ijsblauw, glazen panelen, zachte diepte, rustige verende animaties; lettertypen Bricolage Grotesque, Plus Jakarta Sans, JetBrains Mono). Dit blijft de basis.

## Meetbare doelen
- Stem en beeld lopen bij terugkijken en exporteren hooguit 100 ms uit elkaar.
- Er gaat geen opgeslagen take of clip verloren bij herladen, tab sluiten of een fout bij het opslaan; als opslaan echt niet kan, krijgt de speler een duidelijke melding.
- Buiten de clip zelf kost een beurt (kiezen, opnemen, punten geven) hooguit 20 seconden klikwerk.
- Een nieuwe speler snapt binnen 30 seconden wat te doen.
- Elke interactie geeft binnen 100 ms zichtbare feedback.
- Werkt in actuele Chrome, Safari en Firefox, op telefoon en desktop.
- Elke spelregel hierboven heeft minstens één test.

## Werkafspraken
- Scheid een pure, deterministische engine (state + actie → nieuwe state, injecteerbare seed voor clipkeuze en opdrachten) van de UI en van browser-API's (video-spelers, microfoon, MediaRecorder, opslag).
- Regels en constanten (cliplengtes, punten, aantal rondes, opdrachten) staan op één plek.
- Bestaande functies en eerdere wensen van Tom niet kwijtraken; bij twijfel liever behouden.
- Bestaande opgeslagen data van spelers (IndexedDB `stemmenstudio`, localStorage `ss.*`) moet blijven werken of netjes gemigreerd worden.
- Vraag alleen iets als het echt blokkeert; kies anders een verstandige default en noteer die hier of in de README.
- Draai tests en de app echt, claim niets wat je niet hebt uitgevoerd, en rapporteer eerlijk wat niet kon (bijv. YouTube is vanuit de sandbox mogelijk niet bereikbaar, een echte microfoon ontbreekt).
- Commit per logische stap.
- Stop na elke fase en wacht op Tom.

## Commando's
- Spelregeltests: `npm test` (of `node --test 'tests/*.test.js'`)
- Browsertests: `node tests/e2e.mjs` (Playwright + Chromium + ffmpeg nodig; screenshots en `resultaat.json` in `tests/out/`)
- Lokaal starten: `npm start` en open http://localhost:8080 (YouTube werkt pas via https of localhost)

## Architectuur
- `js/engine.js`: pure functies (`reduce`, `whyNot`, `standings`, `restore`, clipkeuze, `recordBlock`, `voicePos`). Werkt als `window.Engine` en als CommonJS in Node. Alle regels en constanten in `RULES` en `CHALLENGES`.
- `js/app.js`: video-spelers (YouTube, Vimeo, bestand) achter één interface, microfoon en MediaRecorder, opslag (IndexedDB met melding als dat niet lukt), schermen en feedback. Spelstatus verandert alleen via `dispatch(actie)` naar de engine. Tijden staan in `TIMING`, opslagsleutels in `KEYS`, geluiden in `SFX`.
- Spelstatus staat in localStorage `ss.players` (versie 2: spelers, beurt, rondes, ronde, klaar, spelvorm `style` = "beurt" of "personage"; zonder spelvorm = om de beurt).
- Personagemodus aan/uit: `PERSONAGE_ON` in `js/app.js` (uit op de hoofdlink /TOM/, aan op /TOM/preview/ en lokaal; `window.SS_FEATURES.personage` overschrijft dat). Oude opslag (alleen spelers en beurt) wordt vrij spelen.
- `js/config.js` (Supabase-URL en anon-sleutel, leeg = geen accounts) en `js/cloud.js` (`window.Cloud`: inloggen en online opslag; laadt supabase-js 2.45.4 van jsDelivr pas als er instellingen zijn). Elke clip en take heeft een `owner` (account-id of "gast"; oude data zonder owner = gast). Database-opzet: `supabase/schema.sql`, uitleg in `supabase/README.md`. Los testbestand maken: `python3 tools/build-preview.py uitvoer.html`.
- Automatisch bijwerken: elke minuut (en bij terugkeer naar de tab) vergelijkt het spel de bestanden op de server met die van het openen. Is er een nieuwe versie, dan haalt het die vers op en ververst de pagina zodra er niet gespeeld, opgenomen of beoordeeld wordt (en geen inlogvenster openstaat). Een video-link blijft geladen; gekozen bestanden niet. Niet bij `file://`. Tijden in `TIMING.update*`.
- Synchroon terugkijken: de stem wordt elke 100 ms vergeleken met de videotijd en opnieuw uitgelijnd bij meer dan 80 ms verschil.
