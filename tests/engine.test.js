// Tests voor de spelregels. Draaien: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../js/engine.js");

const P = (...names) => names.map((n, i) => ({ id: "p" + (i + 1), name: n }));
const game = (names, rounds = 3) => E.newState({ players: P(...names), rounds });
const rate = (s, playerId, score, prev = null) => E.reduce(s, { type: "rate", playerId, score, prev });

test("nieuwe partij: standaard 3 rondes, ronde 1, eerste speler aan de beurt", () => {
  const s = game(["Anna", "Bas"]);
  assert.equal(s.rounds, 3); assert.equal(s.round, 1); assert.equal(s.turn, 0); assert.equal(s.done, false);
  assert.deepEqual(s.players.map(p => p.pts), [0, 0]);
});

test("zonder spelers begint het spel met 'Speler 1'", () => {
  const s = E.newState();
  assert.equal(s.players.length, 1); assert.equal(s.players[0].name, "Speler 1");
});

test("speler toevoegen; 'Speler 1' maakt plaats voor de eerste echte naam", () => {
  let s = E.newState();
  s = E.reduce(s, { type: "addPlayer", id: "a", name: "  Anna  " });
  assert.deepEqual(s.players.map(p => p.name), ["Anna"]);
  s = E.reduce(s, { type: "addPlayer", id: "b", name: "Bas" });
  assert.deepEqual(s.players.map(p => p.name), ["Anna", "Bas"]);
});

test("speler toevoegen: lege naam, dubbele naam en meer dan 8 spelers mogen niet", () => {
  const s = game(["Anna"]);
  assert.match(E.whyNot(s, { type: "addPlayer", id: "x", name: "   " }), /naam/);
  assert.match(E.whyNot(s, { type: "addPlayer", id: "x", name: "anna" }), /doet al mee/);
  assert.equal(E.reduce(s, { type: "addPlayer", id: "x", name: "" }), s, "ongeldige actie geeft dezelfde state");
  let full = game(["1", "2", "3", "4", "5", "6", "7", "8"]);
  assert.match(E.whyNot(full, { type: "addPlayer", id: "x", name: "Negen" }), /maximaal 8/);
});

test("lange namen worden ingekort tot 24 tekens", () => {
  const s = E.reduce(game(["Anna"]), { type: "addPlayer", id: "x", name: "x".repeat(40) });
  assert.equal(s.players[1].name.length, 24);
});

test("punten: de groep geeft 1 tot 5 punten aan de speler van de take", () => {
  let s = game(["Anna", "Bas"]);
  s = rate(s, "p1", 4);
  assert.equal(s.players[0].pts, 4);
  assert.match(E.whyNot(s, { type: "rate", playerId: "p1", score: 0 }), /1 tot 5/);
  assert.match(E.whyNot(s, { type: "rate", playerId: "p1", score: 6 }), /1 tot 5/);
  assert.match(E.whyNot(s, { type: "rate", playerId: "p1", score: 2.5 }), /1 tot 5/);
});

test("eerste beoordeling geeft de beurt door aan de volgende speler", () => {
  let s = game(["Anna", "Bas", "Cas"]);
  s = rate(s, "p1", 3);
  assert.equal(s.turn, 1);
});

test("opnieuw beoordelen verandert de score maar geeft de beurt niet nog een keer door", () => {
  let s = game(["Anna", "Bas", "Cas"]);
  s = rate(s, "p1", 3);           // beurt naar Bas
  s = rate(s, "p1", 5, 3);        // Anna's take krijgt toch 5
  assert.equal(s.players[0].pts, 5);
  assert.equal(s.turn, 1);
});

test("een oude take van iemand anders beoordelen geeft de beurt niet door", () => {
  let s = game(["Anna", "Bas"]);
  s = rate(s, "p2", 2);           // Bas is niet aan de beurt
  assert.equal(s.turn, 0); assert.equal(s.players[1].pts, 2);
});

test("take verwijderen haalt de punten van die take weg", () => {
  let s = rate(game(["Anna", "Bas"]), "p1", 4);
  s = E.reduce(s, { type: "unrate", playerId: "p1", score: 4 });
  assert.equal(s.players[0].pts, 0);
  s = E.reduce(s, { type: "unrate", playerId: "p1", score: null }); // take zonder punten: niets verandert
  assert.equal(s.players[0].pts, 0);
});

test("na de laatste speler begint de volgende ronde", () => {
  let s = game(["Anna", "Bas"]);
  s = rate(s, "p1", 1); s = rate(s, "p2", 1);
  assert.equal(s.round, 2); assert.equal(s.turn, 0); assert.equal(s.done, false);
});

test("na de laatste ronde is de partij afgelopen", () => {
  let s = game(["Anna", "Bas"], 1);
  s = rate(s, "p1", 2); s = rate(s, "p2", 5);
  assert.equal(s.done, true); assert.equal(s.round, 1);
  assert.match(E.whyNot(s, { type: "setTurn", index: 0 }), /afgelopen/);
});

test("na het einde geeft een nieuwe beoordeling geen beurt meer door", () => {
  let s = game(["Anna"], 1);
  s = rate(s, "p1", 2);
  assert.equal(s.done, true);
  const t = rate(s, "p1", 4, 2);
  assert.equal(t.done, true); assert.equal(t.players[0].pts, 4);
});

test("solo spelen: elke take is een ronde", () => {
  let s = game(["Anna"], 3);
  s = rate(s, "p1", 3); assert.equal(s.round, 2);
  s = rate(s, "p1", 3); s = rate(s, "p1", 3);
  assert.equal(s.done, true); assert.equal(s.players[0].pts, 9);
});

test("vrij spelen (0 rondes) heeft geen einde", () => {
  let s = game(["Anna", "Bas"], 0);
  for (let i = 0; i < 40; i++) s = rate(s, s.players[s.turn].id, 3);
  assert.equal(s.done, false); assert.equal(s.round, 21);
});

test("partij handmatig beëindigen", () => {
  const s = E.reduce(game(["Anna"], 0), { type: "endGame" });
  assert.equal(s.done, true);
});

test("speler aan de beurt kiezen", () => {
  let s = game(["Anna", "Bas", "Cas"]);
  s = E.reduce(s, { type: "setTurn", index: 2 });
  assert.equal(s.turn, 2);
  assert.equal(E.reduce(s, { type: "setTurn", index: 9 }), s);
});

test("speler verwijderen vóór wie aan de beurt is: dezelfde speler blijft aan de beurt", () => {
  let s = E.reduce(game(["Anna", "Bas", "Cas"]), { type: "setTurn", index: 2 });
  s = E.reduce(s, { type: "removePlayer", id: "p1" });
  assert.equal(E.current(s).name, "Cas");
});

test("speler verwijderen die aan de beurt is: de volgende is aan de beurt", () => {
  let s = E.reduce(game(["Anna", "Bas", "Cas"]), { type: "setTurn", index: 1 });
  s = E.reduce(s, { type: "removePlayer", id: "p2" });
  assert.equal(E.current(s).name, "Cas"); assert.equal(s.round, 1);
});

test("laatste speler in de rij verwijderen terwijl die aan de beurt is: volgende ronde", () => {
  let s = E.reduce(game(["Anna", "Bas", "Cas"]), { type: "setTurn", index: 2 });
  s = E.reduce(s, { type: "removePlayer", id: "p3" });
  assert.equal(s.turn, 0); assert.equal(s.round, 2);
});

test("de laatste speler kan niet weg", () => {
  const s = game(["Anna"]);
  assert.match(E.whyNot(s, { type: "removePlayer", id: "p1" }), /minstens één/);
});

test("speler toevoegen midden in een ronde: komt achteraan in de rij", () => {
  let s = rate(game(["Anna", "Bas"]), "p1", 2);
  s = E.reduce(s, { type: "addPlayer", id: "c", name: "Cas" });
  s = rate(s, "p2", 2);
  assert.equal(E.current(s).name, "Cas"); assert.equal(s.round, 1);
});

test("naam wijzigen", () => {
  let s = E.reduce(game(["Anna", "Bas"]), { type: "renamePlayer", id: "p1", name: "Anouk" });
  assert.equal(s.players[0].name, "Anouk");
  assert.match(E.whyNot(s, { type: "renamePlayer", id: "p1", name: "bas" }), /doet al mee/);
});

test("scores op nul en nieuwe partij", () => {
  let s = rate(rate(game(["Anna", "Bas"], 1), "p1", 4), "p2", 2);
  assert.equal(s.done, true);
  const r = E.reduce(s, { type: "resetScores" });
  assert.deepEqual(r.players.map(p => p.pts), [0, 0]);
  const n = E.reduce(s, { type: "newGame", rounds: 5 });
  assert.equal(n.done, false); assert.equal(n.round, 1); assert.equal(n.turn, 0); assert.equal(n.rounds, 5);
  assert.deepEqual(n.players.map(p => p.name), ["Anna", "Bas"]);
});

test("aantal rondes aanpassen; minder rondes dan al gespeeld beëindigt de partij", () => {
  let s = game(["Anna"], 5);
  s = rate(rate(s, "p1", 1), "p1", 1); // ronde 3
  assert.equal(E.reduce(s, { type: "setRounds", rounds: 1 }).done, true);
  assert.equal(E.reduce(s, { type: "setRounds", rounds: 3 }).done, false);
  assert.match(E.whyNot(s, { type: "setRounds", rounds: 2 }), /rondes/);
});

test("uitslag: hoogste score wint", () => {
  let s = rate(rate(game(["Anna", "Bas", "Cas"]), "p1", 3), "p2", 5);
  const r = E.standings(s);
  assert.deepEqual(r.list.map(p => p.name), ["Bas", "Anna", "Cas"]);
  assert.deepEqual(r.list.map(p => p.rank), [1, 2, 3]);
  assert.equal(r.tie, false); assert.equal(r.winners[0].name, "Bas");
});

test("uitslag: gelijkspel wordt gedeelde winst", () => {
  let s = rate(rate(rate(game(["Anna", "Bas", "Cas"]), "p1", 4), "p2", 4), "p3", 1);
  const r = E.standings(s);
  assert.equal(r.tie, true);
  assert.deepEqual(r.winners.map(p => p.name), ["Anna", "Bas"]);
  assert.deepEqual(r.list.map(p => p.rank), [1, 1, 3]);
});

test("herstellen: geldige opslag komt terug", () => {
  const s = rate(game(["Anna", "Bas"]), "p1", 3);
  const r = E.restore(JSON.parse(JSON.stringify(s)));
  assert.deepEqual({ ...r, legacy: undefined }, { ...s, legacy: undefined });
});

test("herstellen: oude opslag (alleen spelers en beurt) wordt vrij spelen", () => {
  const r = E.restore({ players: [{ id: "p1", name: "Anna", pts: 7 }, { id: "p2", name: "Bas", pts: 2 }], turn: 1 });
  assert.equal(r.rounds, 0); assert.equal(r.turn, 1); assert.equal(r.players[0].pts, 7); assert.equal(r.legacy, true);
});

test("herstellen: kapotte opslag geeft null of wordt gerepareerd", () => {
  assert.equal(E.restore(null), null);
  assert.equal(E.restore("onzin"), null);
  assert.equal(E.restore({ players: [] }), null);
  assert.equal(E.restore({ players: [{ id: "", name: "" }] }), null);
  const r = E.restore({ v: 2, players: [{ id: "a", name: "Anna", pts: "veel" }, { id: "a", name: "Dubbel" }], turn: 9, rounds: 7, round: -2 });
  assert.equal(r.players.length, 1); assert.equal(r.players[0].pts, 0); assert.equal(r.turn, 0); assert.equal(r.rounds, 0); assert.equal(r.round, 1);
});

test("clip: begin blijft binnen de video", () => {
  assert.equal(E.clampStart(-5, 90, 300), 0);
  assert.equal(E.clampStart(250, 90, 300), 210);
  assert.equal(E.clampStart(12.4, 90, 300), 12);
  assert.equal(E.clampStart(50, 90, 0), 50, "zonder bekende lengte alleen niet negatief");
});

test("clip langer dan de video wordt de hele video", () => {
  assert.equal(E.clampStart(10, 90, 40), 0);
  assert.equal(E.clipEnd(0, 90, 40), 40);
  assert.equal(E.clipEnd(0, 90, 0), 90);
  assert.deepEqual(E.pickClip(E.rng(1), 40, 90, []), { start: 0, allPlayed: false });
});

test("cliplengtes zijn 10 sec, 30 sec, 1:00, 1:30 en 2:00", () => {
  assert.deepEqual([...E.RULES.clipLengths], [10, 30, 60, 90, 120]);
  assert.equal(E.RULES.defaultClip, 90);
});

test("nieuwe clip: kiest een stuk dat nog niet gespeeld is", () => {
  const clips = [{ srcKey: "yt:a", start: 0, len: 90, played: true }, { srcKey: "yt:a", start: 200, len: 90, played: false }, { srcKey: "yt:b", start: 100, len: 90, played: true }];
  const used = E.usedRanges(clips, "yt:a");
  assert.deepEqual(used, [[0, 90]]);
  const rand = E.rng(42);
  for (let i = 0; i < 50; i++) {
    const { start, allPlayed } = E.pickClip(rand, 300, 90, used);
    assert.equal(allPlayed, false); assert.ok(start >= 90 && start <= 210, "start " + start);
  }
});

test("korte clips van 10 en 30 seconden: past in de video en blijft vrij van gespeelde stukken", () => {
  for (const len of [10, 30]) {
    const used = [[0, len], [100, 100 + len]];
    const rand = E.rng(len);
    for (let i = 0; i < 50; i++) {
      const { start, allPlayed } = E.pickClip(rand, 200, len, used);
      assert.equal(allPlayed, false); assert.ok(start >= 0 && start <= 200 - len);
      assert.ok(start >= len || start + len <= 0 || start >= 100 + len || start + len <= 100, "start " + start);
    }
    assert.equal(E.clampStart(195, len, 200), 200 - len);
    assert.equal(E.clipEnd(0, len, 8), 8, "video korter dan de clip");
  }
});

test("alle stukken gespeeld: er komt toch een clip, met melding", () => {
  const used = [[0, 300]];
  const r = E.pickClip(E.rng(7), 300, 90, used);
  assert.equal(r.allPlayed, true); assert.ok(r.start >= 0 && r.start <= 210);
});

test("met dezelfde seed kiest het spel dezelfde clips en opdrachten", () => {
  const a = E.rng(99), b = E.rng(99);
  for (let i = 0; i < 10; i++) assert.equal(E.pickClip(a, 600, 60, []).start, E.pickClip(b, 600, 60, []).start);
  assert.equal(E.pickChallenge(E.rng(5), null), E.pickChallenge(E.rng(5), null));
});

test("opdracht dobbelen geeft nooit twee keer achter elkaar dezelfde", () => {
  const rand = E.rng(3); let cur = null;
  for (let i = 0; i < 200; i++) { const c = E.pickChallenge(rand, cur); assert.notEqual(c, cur); assert.ok(E.CHALLENGES.includes(c)); cur = c; }
});

test("bestaande clip terugvinden op begin (binnen 1 seconde)", () => {
  const clips = [{ id: "c1", srcKey: "yt:a", start: 30, len: 90 }];
  assert.equal(E.findClip(clips, "yt:a", 30.6).id, "c1");
  assert.equal(E.findClip(clips, "yt:a", 32), null);
  assert.equal(E.findClip(clips, "yt:b", 30), null);
});

test("opnemen mag pas als er een video is en de clip bekeken is", () => {
  const ok = { hasSource: true, watched: true, mode: "idle", done: false };
  assert.equal(E.recordBlock(ok), "");
  assert.match(E.recordBlock({ ...ok, hasSource: false }), /Laad eerst/);
  assert.match(E.recordBlock({ ...ok, watched: false }), /Bekijk eerst/);
  assert.match(E.recordBlock({ ...ok, mode: "playing" }), /afgespeeld/);
  assert.equal(E.recordBlock({ ...ok, mode: "preview" }), "", "opnemen mag ook terwijl de clip speelt");
  assert.equal(E.RULES.tailSecs, undefined, "de opname stopt precies aan het einde van de clip");
  assert.match(E.recordBlock({ ...ok, done: true }), /afgelopen/);
  assert.equal(E.recordBlock({ ...ok, mode: "recording" }), "", "tijdens opnemen kan je altijd stoppen");
});

test("synchroon afspelen: stempositie volgt de videotijd", () => {
  const take = { offset: 2.4, start: 30 };
  assert.equal(E.voicePos(take, 30), 2.4);
  assert.ok(Math.abs(E.voicePos(take, 45.5) - 17.9) < 1e-9);
});

function playGame(seed) {
  const rand = E.rng(seed);
  let s = E.newState({ players: P("Anna", "Bas", "Cas"), rounds: 3 });
  const clips = [], takes = []; let ch = null, n = 0;
  while (!s.done) {
    const who = E.current(s);
    const { start } = E.pickClip(rand, 1200, 90, E.usedRanges(clips, "yt:demo"));
    clips.push({ id: "c" + n, srcKey: "yt:demo", start, len: 90, played: true });
    ch = E.pickChallenge(rand, ch);
    const score = 1 + Math.floor(rand() * 5);
    takes.push({ who: who.id, score, ch });
    s = rate(s, who.id, score);
    if (++n > 50) throw new Error("partij eindigt niet");
  }
  return { s, clips, takes };
}

test("volledige partij met vaste seed: 3 spelers, 3 rondes", () => {
  const { s, clips, takes } = playGame(2026);
  assert.equal(takes.length, 9, "3 spelers × 3 rondes = 9 takes");
  assert.deepEqual(takes.map(t => t.who), ["p1", "p2", "p3", "p1", "p2", "p3", "p1", "p2", "p3"]);
  for (let i = 0; i < clips.length; i++) for (let j = 0; j < i; j++)
    assert.ok(clips[i].start >= clips[j].start + 90 || clips[i].start + 90 <= clips[j].start, "clips overlappen niet");
  const totals = { p1: 0, p2: 0, p3: 0 }; takes.forEach(t => { totals[t.who] += t.score; });
  assert.deepEqual(s.players.map(p => p.pts), [totals.p1, totals.p2, totals.p3]);
  assert.equal(E.standings(s).winners[0].pts, Math.max(...Object.values(totals)));
  assert.deepEqual(playGame(2026), { s, clips, takes }, "dezelfde seed geeft precies dezelfde partij");
});
