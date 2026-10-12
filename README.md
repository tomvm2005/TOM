# Stemmenstudio

Het voice-overspel voor vrienden en familie. Kies een video (YouTube, Vimeo, directe videolink of eigen upload), bekijk een clip van 10 seconden tot 2 minuten, en spreek er om de beurt je eigen voice-over overheen. De groep geeft punten; na de laatste ronde zie je wie er wint.

## Starten
- Online: https://tomvm2005.github.io/TOM/ (GitHub Pages, branch `main`). YouTube en Vimeo werken alleen via een https-adres.
- Lokaal: `npm start` en open http://localhost:8080. Als los bestand openen kan ook, maar dan werken alleen eigen videobestanden.

## Zo speel je
1. Start een partij: vul de namen in en kies het aantal rondes (1, 3, 5 of vrij spelen) en de cliplengte.
2. Kies een video (de video speelt met geluid, en klikken op de video zelf doet niets). Het spel kiest zelf een stuk dat nog niet gespeeld is (rood gearceerd = al gespeeld); met Nieuwe clip of door te slepen kies je een ander stuk.
3. Bekijk de clip (met geluid; je kan pauzeren, ook door op het beeld te klikken). Pas daarna kan je opnemen. Een klik op het beeld speelt de clip af en stopt aan het eind. Linksonder in het beeld zie je hoe ver je in de clip bent en hoe lang de video duurt; met het zwarte lijntje spoel je binnen de clip. Bij een YouTube-reclame klik je rechtsonder in het beeld op Overslaan.
4. Opnemen (spatiebalk): na 3, 2, 1 praat je over de video heen, zonder geluid van de video. Je kan pauzeren; de pauze zit niet in de opname. Dobbel eventueel een gekke opdracht, of praat gewoon vrij.
5. Terugkijken: je hoort alleen je eigen stem, ondertiteling staat uit. De groep geeft 1 tot 5 punten (of toets 1 t/m 5), daarna is de volgende aan de beurt.
6. Na de laatste ronde volgt de uitslag. Bij gelijke stand delen spelers de winst.

Ondertiteling staat standaard uit; met de knop onder de video zet je hem aan (alleen als de video ondertitels heeft), bijvoorbeeld om ze voor te lezen.

Sneltoetsen: spatie opnemen/stoppen, W bekijk clip, P pauze (of laatste take als er niets speelt), N nieuwe clip, D opdracht, Esc stoppen, 1 t/m 5 punten.

## Aannames
- Een partij heeft standaard 3 rondes; elke speler doet één take per ronde.
- Alleen de eerste beoordeling van de take van wie aan de beurt is, geeft de beurt door. Een take opnieuw beoordelen past alleen de score aan.
- Een take verwijderen haalt de punten ervan weg.
- Is de video korter dan de clip, dan is de clip de hele video. Zijn alle stukken gespeeld, dan komt er toch een (gespeeld) stuk, met melding.
- Alles wordt alleen op dit apparaat bewaard (IndexedDB en localStorage). Lukt dat niet (privévenster, opslag vol), dan zegt het spel dat.
- Wijzigingen aan het spel komen vanzelf bij spelers: de pagina ververst zichzelf als er een nieuwe versie online staat (niet tijdens spelen of opnemen).
- Accounts: met een account (knop rechtsboven) staan je clips en takes online en zie je ze op elk apparaat terug. Dit staat aan zodra `js/config.js` is ingevuld; zie `supabase/README.md`.
- Een partij die bezig was, gaat na herladen gewoon verder.
- De opname stopt precies aan het einde van de clip en de microfoon gaat dan meteen uit.
- "Deze sessie" onder Bewaarde clips = clips die in dit tabblad zijn gemaakt of gebruikt sinds het openen. De knop "Speel alle clips achter elkaar" speelt alle takes van die clips na elkaar af.

## Structuur
- `index.html`: opmaak en stijl
- `js/engine.js`: spelregels (pure functies, getest)
- `js/app.js`: interface, video, microfoon, opslag, effecten
- `tests/engine.test.js`: tests voor elke spelregel (`npm test`)
- `tests/e2e.mjs`: browsertests met nep-microfoon (`node tests/e2e.mjs`)
