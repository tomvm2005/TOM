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
- **Clip**: kies een lengte van 1:00, 1:30 of 2:00 (onthouden als voorkeur). Het spel kiest een willekeurig stuk uit de video ("Nieuwe clip"); stukken die al gespeeld zijn worden gemarkeerd en zo veel mogelijk vermeden.
- **Volgorde per take**: eerst de clip bekijken, dan pas opnemen. Opnemen start met een korte aftelling en loopt synchroon met de video.
- **Opdracht** (optioneel): dobbel een gekke opdracht (bijv. "natuurdocumentaire", "sportcommentator") of spreek vrij in.
- **Takes**: elke opname wordt bewaard bij de clip en kan opnieuw afgespeeld, als video gedownload of als losse stem gedownload worden. Alle takes van een clip kunnen achter elkaar afgespeeld worden.
- **Terugkijken en exporteren**: je hoort alleen je eigen stem, niet het originele geluid van de video. Ondertiteling staat uit.
- **Punten**: na een take geeft de groep 1 tot 5 punten (gezichtjes, of toets 1 t/m 5). De punten gaan naar de speler van die take; de eerste beoordeling geeft de beurt door aan de volgende speler. Scores kunnen op nul gezet worden.
- **Bibliotheek**: bewaarde clips en hun takes blijven op dit apparaat staan.
- **Uitgesloten**: Tom's eerdere Simpsons-video komt niet terug als voorbeeld of standaardclip.
- **Partij**: een aantal rondes (1, 3 of 5; standaard 3) of vrij spelen zonder einde. Elke speler doet één take per ronde; de eerste beoordeling van de take van wie aan de beurt is geeft de beurt door. Na de laatste ronde volgt de uitslag. Een partij kan ook handmatig afgerond worden.
- **Spelers**: 1 tot 8, namen uniek (hoofdletters tellen niet), maximaal 24 tekens.

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
- Spelstatus staat in localStorage `ss.players` (versie 2: spelers, beurt, rondes, ronde, klaar). Oude opslag (alleen spelers en beurt) wordt vrij spelen.
- Synchroon terugkijken: de stem wordt elke 100 ms vergeleken met de videotijd en opnieuw uitgelijnd bij meer dan 80 ms verschil.
