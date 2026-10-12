# Stemmenstudio

Het voice-overspel voor vrienden en familie. Kies een video (YouTube, Vimeo, directe videolink of eigen upload), bekijk een clip van 1:00, 1:30 of 2:00, en spreek er om de beurt je eigen voice-over overheen. De groep geeft punten; na de laatste ronde zie je wie er wint.

## Starten
- Online: https://tomvm2005.github.io/TOM/ (GitHub Pages, branch `main`). YouTube en Vimeo werken alleen via een https-adres.
- Lokaal: `npm start` en open http://localhost:8080. Als los bestand openen kan ook, maar dan werken alleen eigen videobestanden.

## Zo speel je
1. Start een partij: vul de namen in en kies het aantal rondes (1, 3, 5 of vrij spelen) en de cliplengte.
2. Kies een video. Het spel kiest zelf een stuk dat nog niet gespeeld is (rood gearceerd = al gespeeld); met Nieuwe clip of door te slepen kies je een ander stuk.
3. Bekijk de clip. Pas daarna kan je opnemen.
4. Opnemen (spatiebalk): na 3, 2, 1 praat je over de video heen. Dobbel eventueel een gekke opdracht.
5. Terugkijken: je hoort alleen je eigen stem, ondertiteling staat uit. De groep geeft 1 tot 5 punten (of toets 1 t/m 5), daarna is de volgende aan de beurt.
6. Na de laatste ronde volgt de uitslag. Bij gelijke stand delen spelers de winst.

Sneltoetsen: spatie opnemen/stoppen, W bekijk clip, N nieuwe clip, D opdracht, P laatste take, Esc stoppen, 1 t/m 5 punten.

## Aannames
- Een partij heeft standaard 3 rondes; elke speler doet één take per ronde.
- Alleen de eerste beoordeling van de take van wie aan de beurt is, geeft de beurt door. Een take opnieuw beoordelen past alleen de score aan.
- Een take verwijderen haalt de punten ervan weg.
- Is de video korter dan de clip, dan is de clip de hele video. Zijn alle stukken gespeeld, dan komt er toch een (gespeeld) stuk, met melding.
- Alles wordt alleen op dit apparaat bewaard (IndexedDB en localStorage). Lukt dat niet (privévenster, opslag vol), dan zegt het spel dat.
- Een partij die bezig was, gaat na herladen gewoon verder.

## Structuur
- `index.html`: opmaak en stijl
- `js/engine.js`: spelregels (pure functies, getest)
- `js/app.js`: interface, video, microfoon, opslag, effecten
- `tests/engine.test.js`: tests voor elke spelregel (`npm test`)
- `tests/e2e.mjs`: browsertests met nep-microfoon (`node tests/e2e.mjs`)
