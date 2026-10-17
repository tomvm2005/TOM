/* Stemmenstudio-engine: de spelregels als pure functies.
   Geen DOM, geen video, geen microfoon, geen opslag en geen Math.random: alles wat toeval nodig heeft krijgt een rng mee.
   Werkt als gewoon <script> in de browser (window.Engine) en als CommonJS-module in Node (voor de tests). */
(function (root, factory) {
  const E = factory();
  if (typeof module === "object" && module.exports) module.exports = E; else root.Engine = E;
})(typeof self !== "undefined" ? self : this, function () {
"use strict";

// ---------- Regels en constanten: alles op één plek ----------
const RULES = Object.freeze({
  clipLengths: Object.freeze([10, 30, 60, 90, 120]),   // seconden
  defaultClip: 90,
  scoreMin: 1, scoreMax: 5,
  roundOptions: Object.freeze([0, 1, 3, 5]),   // 0 = vrij spelen, zonder einde
  defaultRounds: 3,
  maxPlayers: 8,
  maxName: 24,
  freeStep: 5,             // stapgrootte (s) bij het zoeken naar een stuk dat nog niet gespeeld is
  clipMatchTolerance: 1,   // twee clips met een begin binnen 1 s van elkaar zijn dezelfde clip
  placeholderName: "Speler 1",
  teamName: "Team",        // vrij spelen met één naam: iedereen samen
  styles: Object.freeze(["beurt", "personage"]), // beurt = om de beurt een clip; personage = elke naam is een personage uit de video
  defaultStyle: "beurt",
  minSegment: 0.5,         // s: korter dan dit aan het einde van de video telt niet meer als nieuw stuk
});

const CHALLENGES = Object.freeze([
  "Natuurdocumentaire: alles wat je ziet is een zeldzaam wild dier","Sportcommentator bij de laatste minuut van de finale",
  "Spreek alles in als een piraat","Fluister alles, alsof iemand slaapt","Nieuwslezer met heel slecht nieuws",
  "Alles is een reclame. Verkoop het!","Iedereen in beeld is een robot","Praat alleen in rijm",
  "Je bent heel erg verliefd op iets in beeld","Horrortrailer: het wordt steeds enger","Spreek in als je opa of oma",
  "Alleen geluidseffecten, geen woorden","Kookprogramma: alles wat je ziet is een recept","Je bent de gps van de hoofdpersoon",
  "Dramatische musical: zing alles","Je bent een kat die niet onder de indruk is","Elke zin begint met 'Wist je dat...'",
  "Iedereen in beeld is jouw beste vriend","Spreek in als een superheld die alles overdrijft","Alles gaat in slow motion, praat ook zo",
]);

// ---------- Toeval met seed (mulberry32) ----------
function rng(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Spelstatus ----------
// { v:2, players:[{id,name,pts}], turn, rounds (0 = vrij), round (vanaf 1), done, style ("beurt" of "personage") }
function newState(opts = {}) {
  const players = (opts.players && opts.players.length ? opts.players : [{ id: "p1", name: RULES.placeholderName }])
    .map(p => ({ id: String(p.id), name: cleanName(p.name), pts: 0 }));
  const style = RULES.styles.includes(opts.style) ? opts.style : RULES.defaultStyle;
  const rounds = style === "personage" ? 0 : RULES.roundOptions.includes(opts.rounds) ? opts.rounds : RULES.defaultRounds;
  return { v: 2, players, turn: 0, rounds, round: 1, done: false, style };
}
const isPersonage = s => s.style === "personage";

const cleanName = n => String(n == null ? "" : n).replace(/\s+/g, " ").trim().slice(0, RULES.maxName);
const isInt = n => typeof n === "number" && Number.isInteger(n);
const isScore = n => isInt(n) && n >= RULES.scoreMin && n <= RULES.scoreMax;

// Waarom een actie niet mag, als zin voor de speler. Lege string = mag wel.
function whyNot(s, a) {
  switch (a && a.type) {
    case "addPlayer": {
      const n = cleanName(a.name);
      if (!n) return "Vul eerst een naam in.";
      if (!a.id) return "Speler zonder id.";
      const real = s.players.filter(p => !isPlaceholder(s, p));
      if (real.length >= RULES.maxPlayers) return `Er kunnen maximaal ${RULES.maxPlayers} spelers meedoen.`;
      if (real.some(p => p.name.toLowerCase() === n.toLowerCase())) return `${n} doet al mee.`;
      if (s.players.some(p => p.id === String(a.id))) return "Deze speler bestaat al.";
      return "";
    }
    case "removePlayer":
      if (!s.players.some(p => p.id === a.id)) return "Deze speler doet niet mee.";
      if (s.players.length <= 1) return "Er moet minstens één speler overblijven.";
      return "";
    case "renamePlayer": {
      const n = cleanName(a.name);
      if (!s.players.some(p => p.id === a.id)) return "Deze speler doet niet mee.";
      if (!n) return "Vul eerst een naam in.";
      if (s.players.some(p => p.id !== a.id && p.name.toLowerCase() === n.toLowerCase())) return `${n} doet al mee.`;
      return "";
    }
    case "setTurn":
      if (s.done) return "De partij is afgelopen.";
      if (!isInt(a.index) || a.index < 0 || a.index >= s.players.length) return "Die speler bestaat niet.";
      return "";
    case "rate":
      if (!isScore(a.score)) return `Geef ${RULES.scoreMin} tot ${RULES.scoreMax} punten.`;
      if (a.prev != null && !isScore(a.prev)) return "Ongeldige vorige score.";
      return "";
    case "unrate":
      if (a.score != null && !isScore(a.score)) return "Ongeldige score.";
      return "";
    case "setRounds":
      if (!RULES.roundOptions.includes(a.rounds)) return "Kies vrij spelen, 1, 3 of 5 rondes.";
      if (isPersonage(s) && a.rounds) return "Met personages speel je door tot de video af is.";
      return "";
    case "pass":
      if (s.done) return "De partij is afgelopen.";
      return "";
    case "rewind":
      if (!isInt(a.turn) || a.turn < 0 || a.turn >= s.players.length) return "Die speler bestaat niet.";
      if (!isInt(a.round) || a.round < 1) return "Ongeldige ronde.";
      return "";
    case "team":
      if (!a.id) return "Speler zonder id.";
      return "";
    case "newGame":
      if (a.style != null && !RULES.styles.includes(a.style)) return "Onbekende spelvorm.";
      return "";
    case "resetScores": case "endGame":
      return "";
    default:
      return "Onbekende actie.";
  }
}

function isPlaceholder(s, p) { return s.players.length === 1 && p.name === RULES.placeholderName && !p.pts; }

// state + actie -> nieuwe state. Een ongeldige actie geeft precies dezelfde state terug.
function reduce(s, a) {
  if (whyNot(s, a)) return s;
  const players = s.players.map(p => ({ ...p }));
  const next = { ...s, players };
  switch (a.type) {
    case "addPlayer": {
      // De standaardspeler "Speler 1" (zonder punten) maakt plaats voor de eerste echte naam.
      if (isPlaceholder(s, s.players[0])) { next.players = []; next.turn = 0; }
      next.players.push({ id: String(a.id), name: cleanName(a.name), pts: 0 });
      return next;
    }
    case "removePlayer": {
      const i = players.findIndex(p => p.id === a.id);
      players.splice(i, 1);
      if (i < s.turn) next.turn = s.turn - 1;
      else if (i === s.turn && s.turn >= players.length) return wrapRound(next); // de laatste in de rij viel weg: volgende ronde
      return next;
    }
    case "renamePlayer":
      players.find(p => p.id === a.id).name = cleanName(a.name);
      return next;
    case "setTurn":
      next.turn = a.index;
      return next;
    case "rate": {
      const p = players.find(x => x.id === a.playerId);
      if (p) p.pts += a.score - (a.prev || 0);
      // Alleen de eerste beoordeling van een take van wie aan de beurt is, geeft de beurt door.
      // Met personages gaat de beurt al door als de opname stopt, dus punten geven doet dat nooit.
      const isTurnTake = !s.done && !isPersonage(s) && a.prev == null && s.players[s.turn] && s.players[s.turn].id === a.playerId;
      return isTurnTake ? advance(next) : next;
    }
    case "unrate": {
      const p = players.find(x => x.id === a.playerId);
      if (p && a.score) p.pts -= a.score;
      return next;
    }
    case "resetScores":
      players.forEach(p => { p.pts = 0; });
      return next;
    case "setRounds":
      next.rounds = a.rounds;
      next.done = a.rounds > 0 && s.round > a.rounds;
      return next;
    case "newGame": {
      players.forEach(p => { p.pts = 0; });
      const style = a.style || s.style || RULES.defaultStyle;
      const rounds = style === "personage" ? 0 : RULES.roundOptions.includes(a.rounds) ? a.rounds : s.rounds;
      return { ...next, turn: 0, round: 1, done: false, rounds, style };
    }
    case "pass": // volgend personage (of volgende speler) zonder punten te geven
      return advance(next);
    case "rewind": // terug naar een eerdere beurt, bijvoorbeeld als een take opnieuw gedaan wordt
      return { ...next, turn: a.turn, round: s.rounds ? Math.min(a.round, s.rounds) : a.round, done: false };
    case "team": // vrij spelen als één groep: alleen de naam Team
      return { ...next, players: [{ id: String(a.id), name: RULES.teamName, pts: 0 }], turn: 0, round: 1, done: false, rounds: 0, style: RULES.defaultStyle };
    case "endGame":
      return { ...next, done: true };
  }
  return s;
}

function advance(s) {
  const t = s.turn + 1;
  if (t < s.players.length) return { ...s, turn: t };
  return wrapRound(s);
}
function wrapRound(s) {
  const round = s.round + 1;
  const done = s.rounds > 0 && round > s.rounds;
  return { ...s, turn: 0, round: done ? s.rounds : round, done };
}

// ---------- Uitslag ----------
function standings(s) {
  const sorted = s.players.map((p, i) => ({ ...p, order: i })).sort((a, b) => b.pts - a.pts || a.order - b.order);
  let rank = 0, last = null;
  sorted.forEach((p, i) => { if (p.pts !== last) { rank = i + 1; last = p.pts; } p.rank = rank; });
  const winners = sorted.filter(p => p.rank === 1);
  return { list: sorted, winners, tie: winners.length > 1 };
}
const current = s => s.players[s.turn] || s.players[0];

// ---------- Spelstatus veilig herstellen (uit localStorage) ----------
function restore(raw) {
  try {
    if (!raw || !Array.isArray(raw.players) || !raw.players.length) return null;
    const seen = new Set();
    const players = [];
    for (const p of raw.players.slice(0, RULES.maxPlayers)) {
      const name = cleanName(p && p.name); const id = p && p.id != null ? String(p.id) : "";
      if (!name || !id || seen.has(id)) continue;
      seen.add(id); players.push({ id, name, pts: isInt(p.pts) ? p.pts : 0 });
    }
    if (!players.length) return null;
    const v1 = raw.v !== 2; // oude opslag: alleen spelers en beurt, nog geen rondes
    const rounds = !v1 && RULES.roundOptions.includes(raw.rounds) ? raw.rounds : 0;
    const turn = isInt(raw.turn) && raw.turn >= 0 && raw.turn < players.length ? raw.turn : 0;
    let round = !v1 && isInt(raw.round) && raw.round >= 1 ? raw.round : 1;
    if (rounds) round = Math.min(round, rounds);
    const style = !v1 && RULES.styles.includes(raw.style) ? raw.style : RULES.defaultStyle;
    return { v: 2, players, turn, rounds: style === "personage" ? 0 : rounds, round, done: !v1 && raw.done === true, style, legacy: v1 };
  } catch { return null; }
}

// ---------- Clips ----------
function clampStart(start, len, dur) {
  const s = Math.round(Number(start) || 0);
  if (!(dur > 0)) return Math.max(0, s);
  return Math.max(0, Math.min(s, Math.max(0, dur - len)));
}
function clipEnd(start, len, dur) { return dur > 0 ? Math.min(start + len, dur) : start + len; }
function usedRanges(clips, srcKey) {
  return clips.filter(c => c.srcKey === srcKey && c.played).map(c => [c.start, c.start + c.len]);
}
function overlaps(s, len, used) { return used.some(([a, b]) => s < b && s + len > a); }
function freeStarts(dur, len, used) {
  const out = [];
  for (let s = 0; s <= dur - len; s += RULES.freeStep) if (!overlaps(s, len, used)) out.push(s);
  return out;
}
// Kies een willekeurig stuk dat nog niet gespeeld is. allPlayed = er was geen vrij stuk meer.
function pickClip(rand, dur, len, used) {
  if (!(dur > 0) || dur <= len) return { start: 0, allPlayed: used.length > 0 };
  const free = freeStarts(dur, len, used);
  if (!free.length) return { start: Math.round(rand() * (dur - len)), allPlayed: true };
  return { start: free[Math.floor(rand() * free.length)], allPlayed: false };
}
function findClip(clips, srcKey, start) {
  return clips.find(c => c.srcKey === srcKey && Math.abs(c.start - start) < RULES.clipMatchTolerance) || null;
}
// Waar begint de clip van de volgende speler? Precies waar de vorige take ophield (zo spreken jullie samen de video in).
// atEnd = de video is af, er is geen stuk meer over.
function nextClipStart(prevEnd, dur) {
  const t = Math.round(Math.max(0, Number(prevEnd) || 0) * 10) / 10;
  if (dur > 0 && t >= dur - RULES.minSegment) return { start: null, atEnd: true };
  return { start: t, atEnd: false };
}
// Een bewaard begin precies overnemen (op 0,1 s), maar wel binnen de video.
function exactStart(start, dur) {
  const t = Math.round(Math.max(0, Number(start) || 0) * 10) / 10;
  return dur > 0 ? Math.min(t, Math.max(0, Math.round((dur - RULES.minSegment) * 10) / 10)) : t;
}
function pickChallenge(rand, currentChallenge, list = CHALLENGES) {
  if (list.length < 2) return list[0] || null;
  let c;
  do { c = list[Math.floor(rand() * list.length)]; } while (c === currentChallenge);
  return c;
}

// ---------- Mag je nu opnemen? ----------
// ctx: { hasSource, watched, mode, done, exporting, personage }
function recordBlock(ctx) {
  if (!ctx.hasSource) return "Laad eerst een video.";
  if (ctx.mode === "countdown" || ctx.mode === "recording") return "";
  if (ctx.exporting) return "Even wachten: de video wordt gemaakt.";
  if (ctx.mode === "playing") return "Even wachten: er wordt een take afgespeeld.";
  if (ctx.mode && ctx.mode !== "idle" && ctx.mode !== "preview") return "Even wachten…"; // tijdens bekijken mag je meteen opnemen
  if (ctx.done) return "De partij is afgelopen. Start een nieuwe partij.";
  if (!ctx.watched && !ctx.personage) return "Bekijk eerst de clip, dan weet je waar je overheen praat.";
  return "";
}

// ---------- Synchroon afspelen ----------
// Waar in de opname hoort de stem te zijn als de video op videoTime staat?
function voicePos(take, videoTime) { return take.offset + (videoTime - take.start); }

return { RULES, CHALLENGES, rng, newState, whyNot, reduce, standings, current, restore,
  isPersonage, nextClipStart, exactStart, clampStart, clipEnd, usedRanges, freeStarts, pickClip, findClip, pickChallenge, recordBlock, voicePos, cleanName };
});
