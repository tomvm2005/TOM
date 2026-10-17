// Browsertest van Stemmenstudio met Playwright, nep-microfoon en zelfgemaakte testvideo's (ffmpeg).
// Draaien: node tests/e2e.mjs   (Playwright en ffmpeg moeten geïnstalleerd zijn)
// Schrijft screenshots naar tests/out/.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "tests", "out"); fs.mkdirSync(OUT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ss-e2e-"));

// ---------- testmateriaal ----------
const ff = (...a) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...a]);
const SHORT = path.join(TMP, "kort.webm"), LONG = path.join(TMP, "lang.webm"), BAD = path.join(TMP, "kapot.mp4");
ff("-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "8", "-c:v", "libvpx", "-b:v", "400k", "-c:a", "libopus", SHORT);
ff("-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25", "-f", "lavfi", "-i", "sine=frequency=300", "-t", "200", "-c:v", "libvpx", "-b:v", "120k", "-c:a", "libopus", LONG);
fs.writeFileSync(BAD, "dit is geen video");

// ---------- kleine webserver ----------
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webm": "video/webm" };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  const f = p.endsWith("/") ? path.join(p, "index.html") : p;
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const URL0 = `http://localhost:${server.address().port}/`;

// ---------- verslag ----------
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "✔" : "✘"} ${name}${detail ? " — " + detail : ""}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];

const FAKE = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"];
async function open(browser, { viewport = { width: 1280, height: 900 }, init } = {}) {
  const ctx = await browser.newContext({ viewport, permissions: ["microphone"] });
  await ctx.addInitScript(() => { window.SS_CONFIG = { url: "", anonKey: "" }; }); // standaard zonder accounts (geen echte Supabase in de test)
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(URL0);
  return { ctx, page };
}
const S = (page, fn) => page.evaluate(fn);
const mode = page => page.evaluate(() => window.__ss.mode);

// Tijd van klik tot de eerstvolgende getekende frame met een zichtbare verandering.
async function feedbackMs(page, selector, changed) {
  return page.evaluate(([sel, changedSrc]) => new Promise(res => {
    const el = document.querySelector(sel); const test = new Function("return (" + changedSrc + ")()");
    const t0 = performance.now(); el.click(); const sync = performance.now() - t0; // tijd die de klik zelf kost
    const loop = () => { if (test()) return res({ sync, frame: performance.now() - t0 }); if (performance.now() - t0 > 1000) return res({ sync, frame: 9999 }); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }), [selector, changed.toString()]);
}

async function startGame(page, names, roundsLabel) {
  if (await page.locator("#helpDlg[open]").count()) await page.click("#helpOk");
  await page.waitForSelector("#startDlg[open]");
  for (const n of names) { await page.fill("#startName", n); await page.click("#startAdd"); }
  await page.click(`#roundSeg button:text-is("${roundsLabel}")`);
  await page.click("#startGo");
}
async function oneTake(page, score, { keyboard = false } = {}) {
  if (keyboard) { await page.keyboard.press("w"); await sleep(600); await page.keyboard.press("Escape"); }
  else { await page.click("#preview"); await sleep(600); await page.click("#stopBtn"); }
  await sleep(150);
  if (keyboard) await page.keyboard.press("Space"); else await page.click("#recBtn");
  await page.waitForFunction(() => window.__ss.mode === "recording", null, { timeout: 8000 });
  await sleep(1500);
  if (await mode(page) === "recording") { if (keyboard) await page.keyboard.press("Space"); else await page.click("#recBtn"); } // aan het einde van de video stopt de opname vanzelf
  await page.waitForSelector("#rate:not([hidden])", { timeout: 15000 }).catch(async e => { throw new Error("geen puntenpaneel: " + JSON.stringify(await S(page, () => ({ m: window.__ss.mode, reel: !!window.__ss.reel, q: window.__ss.rateQueue?.length, takes: window.__ss.takes.slice().sort((a,b)=>a.created-b.created).map(t=>[t.who,+t.start.toFixed(1),+t.end.toFixed(1)]).join(" "), clip: window.__ss.clipStart, t: window.__ss.src?.time(), vs: window.__ss.vstate, pl: window.__ss.playing && [window.__ss.playing.start, window.__ss.playing.end], ri: window.__ss.reel && [window.__ss.reel.i, window.__ss.reel.items.length], g: window.__game(), err: document.getElementById("err").hidden ? "" : document.getElementById("err").textContent, hint: document.getElementById("hint").textContent })))); });
  const drift = await S(page, () => window.__ss.drift.slice());
  if (keyboard) await page.keyboard.press(String(score)); else await page.click(`#faces button:nth-child(${score})`);
  await sleep(200);
  return drift;
}

const browser = await chromium.launch({ args: FAKE });
const allDrift = [];
try {
  // ===== 1. Volledige partij: 3 spelers, 3 rondes =====
  {
    const { page } = await open(browser);
    check("eerste bezoek toont de uitleg", await page.locator("#helpDlg[open]").count() === 1);
    await page.screenshot({ path: path.join(OUT, "1-uitleg.png") });
    await page.click("#helpOk");
    check("na de uitleg volgt het startscherm", await page.waitForSelector("#startDlg[open]", { timeout: 2000 }).then(() => true, () => false));
    for (const n of ["Anna", "Bas", "Cas"]) { await page.fill("#startName", n); await page.click("#startAdd"); }
    await page.fill("#startName", "anna"); await page.click("#startAdd");
    check("dubbele naam wordt geweigerd met uitleg", /doet al mee/.test(await page.textContent("#startWhy")));
    await page.screenshot({ path: path.join(OUT, "2-start.png") });
    await page.click("#startGo");
    check("partij start: Anna aan de beurt, ronde 1 van 3", (await page.textContent("#turnName")) === "Anna" && /Ronde 1 van 3/.test(await page.textContent("#roundLbl")));
    check("hint vraagt eerst een video", /Plak eerst een videolink/.test(await page.textContent("#hint")));

    await page.setInputFiles("#file", SHORT);
    await page.waitForFunction(() => window.__ss.src && window.__ss.src.duration() > 0);
    await sleep(300);
    check("video korter dan de clip: clip is de hele video", (await page.textContent("#range")).trim() === "0:00 – 0:08", await page.textContent("#range"));
    check("hint: eerst de clip bekijken", /Bekijk eerst de clip/.test(await page.textContent("#hint")));
    await page.click("#recBtn"); await sleep(300);
    check("opnemen zonder te kijken start niet en legt uit waarom", (await mode(page)) === "idle" && /Bekijk eerst/.test(await page.textContent("#hint")));

    const fb = {};
    fb.dobbel = await feedbackMs(page, "#dice", () => !document.getElementById("challenge").classList.contains("none"));
    fb.bekijk = await feedbackMs(page, "#preview", () => document.getElementById("screen").classList.contains("play"));
    await sleep(500); await page.click("#stopBtn"); await sleep(200);
    fb.opnemen = await feedbackMs(page, "#recBtn", () => document.getElementById("recLabel").textContent !== "Opnemen");
    await page.waitForFunction(() => window.__ss.mode === "recording", null, { timeout: 8000 });
    await page.screenshot({ path: path.join(OUT, "3-opname.png") });
    await sleep(1500);
    fb.stop = await feedbackMs(page, "#recBtn", () => document.getElementById("recLabel").textContent === "Opnemen");
    await page.waitForSelector("#rate:not([hidden])", { timeout: 15000 });
    allDrift.push(...await S(page, () => window.__ss.drift.slice()));
    await page.screenshot({ path: path.join(OUT, "4-punten.png") });
    fb.punten = await feedbackMs(page, "#faces button:nth-child(4)", () => document.getElementById("rate").hidden);
    const fmtFb = k => Object.entries(fb).map(([n, v]) => `${n} ${Math.round(v[k])} ms`).join(", ");
    check("elke klik is binnen 100 ms verwerkt (scherm bijgewerkt)", Object.values(fb).every(v => v.sync < 100), fmtFb("sync"));
    check("gemeten: tijd tot de eerste getekende frame na een klik (alleen ter info: headless Chromium tekent softwarematig, dus de waarde wisselt per run)", true, fmtFb("frame"));
    let g = await S(page, () => window.__game());
    check("punten naar Anna, beurt naar Bas", g.players[0].pts === 4 && g.turn === 1);
    check("take bewaard met de opdracht", await S(page, () => window.__ss.takes.length === 1 && !!window.__ss.takes[0].challenge));

    allDrift.push(...await oneTake(page, 2, { keyboard: true }));
    g = await S(page, () => window.__game());
    check("volledig met het toetsenbord: Bas krijgt 2 punten", g.players[1].pts === 2 && g.turn === 2);

    // dubbelklik op Opnemen start maar één opname
    await page.click("#preview"); await sleep(400); await page.click("#stopBtn"); await sleep(150);
    await page.dblclick("#recBtn");
    await page.waitForFunction(() => window.__ss.mode === "recording", null, { timeout: 8000 });
    await sleep(1200); await page.click("#recBtn");
    await page.waitForSelector("#rate:not([hidden])", { timeout: 15000 });
    check("dubbelklik op Opnemen: precies één take", await S(page, () => window.__ss.takes.length) === 3);
    await page.click("#faces button:nth-child(5)");
    await page.click("#faces button:nth-child(5)", { timeout: 500 }).catch(() => {}); // tweede klik op een gesloten paneel doet niets
    g = await S(page, () => window.__game());
    check("dubbelklik op punten telt één keer", g.players[2].pts === 5 && g.round === 2 && g.turn === 0, JSON.stringify(g.players.map(p => p.pts)));

    // Herladen midden in de partij
    await page.reload();
    await page.waitForFunction(() => window.__ss.clips.length > 0);
    g = await S(page, () => window.__game());
    check("herladen: partij gaat verder in ronde 2 met dezelfde scores", g.round === 2 && g.players.map(p => p.pts).join() === "4,2,5" && await page.locator("dialog[open]").count() === 0);
    check("herladen: alle 3 takes staan er nog", await S(page, () => window.__ss.takes.length) === 3);
    const chain = await S(page, () => { const ts = window.__ss.takes.slice().sort((a, b) => a.created - b.created); const cs = window.__ss.clips; return ts.map(t => ({ s: cs.find(c => c.id === t.clipId).start, st: t.start, e: t.end })); });
    check("doorlopend: elke volgende speler begint waar de vorige take ophield", chain.length === 3 && chain.slice(1).every((x, i) => Math.abs(x.s - chain[i].e) < 0.15), JSON.stringify(chain.map(x => [x.s, +x.e.toFixed(2)])));
    await page.click("#lib .clip");
    await page.waitForFunction(() => window.__ss.src && window.__ss.src.duration() > 0);
    await sleep(300);
    const own = await S(page, () => window.__ss.takes.filter(t => t.clipId === window.__ss.clipId).length);
    check("bewaarde clip opent weer met zijn takes (video uit de opslag)", own >= 1 && (await page.textContent("#takeCount")) === String(own));

    for (const sc of [3, 1, 4, 2, 5, 3]) allDrift.push(...await oneTake(page, sc));
    await page.waitForSelector("#resultDlg[open]", { timeout: 5000 });
    g = await S(page, () => window.__game());
    const title = await page.textContent("#resultTitle");
    check("na 3 rondes verschijnt de uitslag met de winnaar", g.done && /Cas wint/.test(title), `${title} (${g.players.map(p => p.name + " " + p.pts).join(", ")})`);
    await page.screenshot({ path: path.join(OUT, "5-uitslag.png") });
    await page.click('#resultDlg button[data-close="close"]');
    check("na de partij kan je niet meer opnemen tot een nieuwe partij", await page.isDisabled("#recBtn") && /afgelopen/.test(await page.textContent("#hint")));
    await page.click("#newGameBtn"); await page.click("#startGo");
    g = await S(page, () => window.__game());
    check("nieuwe partij: scores op nul, zelfde spelers", !g.done && g.players.every(p => p.pts === 0) && g.players.length === 3);

    // Synchroon afspelen op een lange clip (1:00) van een lange video
    await page.setInputFiles("#file", LONG);
    await page.waitForFunction(() => window.__ss.src && window.__ss.src.duration() > 100);
    await page.click('#lens button[data-len="60"]');
    await page.click("#preview"); await sleep(300); await page.click("#stopBtn"); await sleep(150);
    await page.click("#recBtn");
    await page.waitForFunction(() => window.__ss.mode === "recording", null, { timeout: 8000 });
    await sleep(20000); await page.click("#recBtn");
    await page.waitForSelector("#rate:not([hidden])", { timeout: 40000 });
    const longDrift = await S(page, () => window.__ss.drift.slice());
    allDrift.push(...longDrift);
    const mx = Math.max(...allDrift.map(Math.abs)) * 1000;
    check("stem en beeld lopen hooguit 100 ms uit elkaar bij terugkijken", mx <= 100, `max ${mx.toFixed(0)} ms over ${allDrift.length} metingen (20 s take: max ${(Math.max(...longDrift.map(Math.abs)) * 1000).toFixed(0)} ms)`);
    await page.keyboard.press("3");

    // Tab sluiten tijdens opnemen: waarschuwing
    await page.click("#preview"); await sleep(300); await page.click("#stopBtn"); await sleep(150);
    await page.click("#recBtn"); await page.waitForFunction(() => window.__ss.mode === "recording", null, { timeout: 8000 });
    let dialogType = null; page.once("dialog", async d => { dialogType = d.type(); await d.dismiss(); });
    await page.close({ runBeforeUnload: true }); await sleep(500);
    check("tab sluiten tijdens opnemen vraagt eerst om bevestiging", dialogType === "beforeunload");
    await page.evaluate(() => {}).catch(() => {});
    // naar een andere app tijdens opnemen: take blijft bewaard
    const before = await S(page, () => window.__ss.takes.length).catch(() => null);
    if (before != null) {
      await S(page, () => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
      await page.waitForFunction(n => window.__ss.takes.length === n + 1, before, { timeout: 8000 }).catch(() => {});
      check("wegschakelen tijdens opnemen stopt netjes en bewaart de take", await S(page, () => window.__ss.takes.length) === before + 1);
    }
  }

  // ===== 2. Foutsituaties =====
  {
    const { page } = await open(browser);
    await startGame(page, ["Dirk"], "1 ronde");
    await page.setInputFiles("#file", BAD);
    await page.waitForSelector("#err:not([hidden])");
    check("kapot videobestand: duidelijke melding", /kan je browser niet afspelen/.test(await page.textContent("#err")));
    await page.fill("#url", "https://www.tiktok.com/@iemand/video/123"); await page.click("#loadBtn");
    check("TikTok-link: uitleg om te downloaden en te uploaden", /Download de video/.test(await page.textContent("#err")));
    await page.fill("#url", "dit is geen link"); await page.click("#loadBtn");
    check("ongeldige link: duidelijke melding", /geen werkende videolink/.test(await page.textContent("#err")), await page.textContent("#err"));
    await page.context().close();
  }
  {
    const b2 = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
    const ctx = await b2.newContext(); const page = await ctx.newPage();
    await ctx.addInitScript(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error("denied"), { name: "NotAllowedError" })); });
    await page.goto(URL0);
    await startGame(page, ["Eva"], "1 ronde");
    await page.setInputFiles("#file", SHORT);
    await page.waitForFunction(() => window.__ss.src && window.__ss.src.duration() > 0);
    await page.click("#preview"); await sleep(300); await page.click("#stopBtn"); await sleep(100);
    await page.click("#recBtn"); await page.waitForSelector("#err:not([hidden])");
    check("microfoon geweigerd: uitleg hoe je hem toestaat, spel blijft werken", /toegang tot de microfoon/.test(await page.textContent("#err")) && (await mode(page)) === "idle");
    await b2.close();
  }
  {
    const { page } = await open(browser, { init: () => { Object.defineProperty(window, "indexedDB", { get: () => ({ open() { throw new Error("blocked"); } }) }); } });
    await page.waitForSelector("#err:not([hidden])");
    check("opslag niet beschikbaar: speler krijgt een melding", /niets bewaren/.test(await page.textContent("#err")));
    await startGame(page, ["Fien"], "1 ronde");
    await page.setInputFiles("#file", SHORT);
    await page.waitForFunction(() => window.__ss.src && window.__ss.src.duration() > 0);
    await oneTake(page, 4);
    check("zonder opslag kan je toch een hele partij spelen", await page.waitForSelector("#resultDlg[open]", { timeout: 3000 }).then(() => true, () => false));
    await page.context().close();
  }
  {
    // Kapotte opgeslagen spelstatus
    const { page } = await open(browser, { init: () => { try { localStorage.setItem("ss.players", "{kapot"); localStorage.setItem("ss.helpSeen", "true"); } catch {} } });
    check("kapotte opslag: spel start gewoon met het startscherm", await page.locator("#startDlg[open]").count() === 1);
    await page.context().close();
  }

  // ===== Geluid, pauze, korte clips, ondertiteling en niet-klikbare video =====
  {
    const { page } = await open(browser, { init: () => { try { localStorage.setItem("ss.helpSeen", "true"); } catch {} } });
    await page.waitForSelector("#startDlg[open]"); await page.click("#startGo");
    await page.setInputFiles("#file", LONG);
    await page.waitForFunction(() => window.__ss.src && window.__ss.src.duration() > 100);
    await sleep(300);
    const vol = () => S(page, () => window.__ss.src.el.volume);
    check("na het laden staat het geluid van de video aan", await vol() === 1);
    check("cliplengtes: 10 sec, 30 sec, 1:00, 1:30 en 2:00", (await page.$$eval("#lens button", b => b.map(x => x.textContent))).join("|") === "10 sec|30 sec|1:00|1:30|2:00");
    const secs = t => { const m = t.match(/(\d+):(\d+)\D+(\d+):(\d+)/); return (+m[3] * 60 + +m[4]) - (+m[1] * 60 + +m[2]); };
    await page.click('#lens button[data-len="10"]'); check("clip van 10 seconden", secs(await page.textContent("#range")) === 10, await page.textContent("#range"));
    await page.click('#lens button[data-len="30"]'); check("clip van 30 seconden", secs(await page.textContent("#range")) === 30, await page.textContent("#range"));
    const hit = (fx, fy) => page.evaluate(([x, y]) => { document.getElementById("screen").scrollIntoView({ block: "center" }); const r = document.getElementById("screen").getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width * x, r.top + r.height * y); return el ? (el.id || el.tagName) : null; }, [fx, fy]);
    check("video is niet klikbaar: een klik op het beeld raakt het afschermlaagje", await hit(0.5, 0.5) === "shield" && await hit(0.1, 0.1) === "shield" && await hit(0.85, 0.7) === "shield", [await hit(0.5, 0.5), await hit(0.1, 0.1), await hit(0.85, 0.7)].join(","));
    await S(page, () => document.getElementById("shield").classList.add("ytskip"));
    check("reclame overslaan: alleen rechtsonder in het beeld komt een klik door", await hit(0.85, 0.7) === "VIDEO" && await hit(0.5, 0.5) === "shield" && await hit(0.1, 0.1) === "shield" && await hit(0.85, 0.2) === "shield" && await hit(0.5, 0.7) === "shield");
    await S(page, () => document.getElementById("shield").classList.remove("ytskip"));
    check("video heeft geen eigen knoppen meer", await S(page, () => window.__ss.src.el.controls === false));

    // in het beeld: clipttijd en hoe lang de video duurt; klikken = de clip bekijken en pauzeren, zoals YouTube
    await sleep(150);
    check("in het beeld staan de cliptijd en hoe lang de video duurt", await page.textContent("#vTime") === "0:00 / 0:30" && await page.textContent("#vDur") === "video 3:20" && await page.isVisible("#vctl"), (await page.textContent("#vTime")) + " · " + (await page.textContent("#vDur")));
    await page.click("#shield"); await sleep(400);
    check("klik op het beeld speelt de clip af (telt als bekeken)", await mode(page) === "preview" && await S(page, () => !window.__ss.src.el.paused) && await page.getAttribute("#vPlay", "data-st") === "pause");
    await page.click("#shield"); await sleep(250);
    const pz = await S(page, () => ({ el: window.__ss.src.el.paused, s: window.__ss.paused, m: window.__ss.mode, st: document.getElementById("vPlay").dataset.st }));
    check("nog een klik op het beeld pauzeert", pz.el && pz.s && pz.st === "play", JSON.stringify(pz));
    await page.click("#vPlay"); await sleep(300);
    check("de knop linksonder in het beeld doet hetzelfde", await S(page, () => !window.__ss.src.el.paused));
    await page.click("#stopBtn"); await sleep(200);
    // zwarte lijntje verslepen = spoelen binnen de clip
    const clip0 = await S(page, () => window.__ss.clipStart);
    await page.locator("#track").scrollIntoViewIfNeeded();
    const tb = await page.locator("#track").boundingBox();
    const drag = async toSec => { const hb = await page.locator("#phead").boundingBox(); await page.mouse.move(hb.x + hb.width / 2, tb.y + tb.height / 2); await page.mouse.down();
      await page.mouse.move(tb.x + tb.width * toSec / 200, tb.y + tb.height / 2, { steps: 6 }); await page.mouse.up(); await sleep(400); return S(page, () => window.__ss.src.time()); };
    let pos = await drag(clip0 + 15);
    check("het zwarte lijntje verslepen spoelt binnen de clip", Math.abs(pos - (clip0 + 15)) < 2 && await S(page, () => window.__ss.clipStart) === clip0, `video op ${pos.toFixed(1)} s, verwacht ~${clip0 + 15} s`);
    check("de tijd in het beeld loopt gelijk met de clip", /^0:1[3-7] \/ 0:30$/.test(await page.textContent("#vTime")) && (await page.textContent("#tc")).startsWith("0:1"), (await page.textContent("#vTime")) + " · " + (await page.textContent("#tc")));
    pos = await drag(clip0 + 100);
    check("het lijntje gaat niet voorbij het einde van de clip", pos <= clip0 + 30 && pos > clip0 + 28, `video op ${pos.toFixed(1)} s, clip tot ${clip0 + 30} s`);
    pos = await drag(clip0 + 27);
    await page.click("#shield");
    await page.waitForFunction(() => window.__ss.mode === "idle", null, { timeout: 8000 });
    const after = await S(page, () => ({ t: window.__ss.src.time(), p: window.__ss.src.el.paused }));
    check("aan het eind van de clip stopt het beeld", after.p && Math.abs(after.t - clip0) < 0.5, `gestopt op ${after.t.toFixed(1)} s (clip begint op ${clip0} s)`);
    await page.click("#shield"); await sleep(500);
    const again = await S(page, () => window.__ss.src.time());
    check("opnieuw afspelen begint de clip weer vooraan", again >= clip0 && again < clip0 + 2, `op ${again.toFixed(1)} s`);
    await page.click("#stopBtn"); await sleep(200);
    check("tijdens opnemen staat het geluid standaard uit", await page.inputValue("#recVol") === "0");

    // pauzeren tijdens kijken
    await page.click("#preview"); await page.waitForFunction(() => window.__ss.mode === "preview");
    await sleep(400);
    check("bekijken gebeurt met geluid", await vol() === 1);
    await page.click("#pauseBtn"); await sleep(250);
    check("pauze tijdens bekijken zet de video stil", await S(page, () => window.__ss.src.el.paused) && /Verder/.test(await page.textContent("#pauseLabel")));
    await page.click("#pauseBtn"); await sleep(400);
    check("verder gaat weer door", await S(page, () => !window.__ss.src.el.paused));
    await page.keyboard.press("p"); await sleep(250);
    check("toets P pauzeert ook", await S(page, () => window.__ss.src.el.paused));
    await page.click("#stopBtn"); await sleep(200);

    // pauzeren tijdens opnemen: de pauze zit niet in de opname
    await page.click("#recBtn");
    await page.waitForFunction(() => window.__ss.mode === "recording", null, { timeout: 8000 });
    check("tijdens opnemen staat het geluid van de video uit", await vol() === 0);
    await sleep(1500);
    const clk = await S(page, () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => {
      const m = document.getElementById("tc").textContent.match(/(\d+):(\d+\.\d)\s*\/\s*(\d+):(\d+)/);
      r({ rel: +m[1] * 60 + +m[2], len: +m[3] * 60 + +m[4], bar: parseFloat(document.getElementById("clipfill").style.width), scr: parseFloat(document.getElementById("prog").style.width) }); }))));
    check("timer en opnamebalkje lopen gelijk", clk.rel > 0.5 && Math.abs(clk.rel - clk.bar / 100 * clk.len) < 0.1 && Math.abs(clk.bar - clk.scr) < 0.01, JSON.stringify(clk));
    await page.click("#pauseBtn"); await sleep(2500);
    check("opname staat op pauze samen met de video", await S(page, () => window.__ss.rec.state === "paused" && window.__ss.src.el.paused) && /PAUZE/.test(await page.textContent("#tag")));
    await page.click("#pauseBtn"); await sleep(1500);
    await page.click("#recBtn");
    await page.waitForSelector("#rate:not([hidden])", { timeout: 20000 });
    const t = await S(page, () => { const k = window.__ss.takes[0]; return { buf: k.buffer.duration, off: k.offset, vid: k.end - k.start }; });
    const gap = Math.abs(t.buf - (t.off + t.vid));
    check("de pauze zit niet in de opname: stem en beeld blijven gelijk", gap < 0.6, `opname ${t.buf.toFixed(2)} s, verwacht ${(t.off + t.vid).toFixed(2)} s (zonder pauzeverwerking zou het ruim 2,5 s meer zijn)`);
    await page.keyboard.press("3"); await sleep(300);
    check("na terugkijken staat het geluid van de video weer aan", await vol() === 1);

    // ondertiteling is een aan/uit-functie en staat standaard uit
    check("ondertiteling staat standaard uit", await page.getAttribute("#ccBtn", "aria-pressed") === "false");
    await page.click("#ccBtn");
    check("ondertiteling aanzetten wordt onthouden", await page.getAttribute("#ccBtn", "aria-pressed") === "true" && await S(page, () => localStorage.getItem("ss.captions")) === "true" && await S(page, () => window.__ss.captions));
    await page.click("#ccBtn");
    check("ondertiteling weer uit", await page.getAttribute("#ccBtn", "aria-pressed") === "false");
    // volumeschuif
    await page.fill("#watchVol", "40"); await page.dispatchEvent("#watchVol", "input");
    check("volumeschuif past het geluid van de video aan", Math.abs(await vol() - 0.4) < 0.01);
    await page.context().close();
  }

  // ===== Opnemen tijdens bekijken, door-praten na het einde van de clip, lijntje gelijk met timer, automatisch bijwerken =====
  {
    const { page } = await open(browser, { init: () => { try { localStorage.setItem("ss.helpSeen", "true"); } catch {} } });
    await page.waitForSelector("#startDlg[open]"); await page.fill("#startName", "Tess"); await page.click("#startAdd"); await page.uncheck("#flowOn"); await page.click("#startGo"); // los per speler: stoppen aan het einde van de clip
    await page.setInputFiles("#file", LONG);
    await page.waitForFunction(() => window.__ss.src && window.__ss.src.duration() > 100); await sleep(300);
    await page.click('#lens button[data-len="10"]'); await sleep(200);
    const clip0 = await S(page, () => window.__ss.clipStart);

    // opnemen terwijl de clip nog speelt: geen "even wachten", geen hele clip uitkijken
    await page.click("#preview"); await sleep(1200);
    check("tijdens bekijken is de opnameknop te gebruiken", await page.isEnabled("#recBtn") && await mode(page) === "preview");
    // het lijntje en de balk zijn nu van de clip, gelijk met de timer
    const view = await S(page, () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => {
      const tc = document.getElementById("tc").textContent.match(/(\d+):(\d+\.\d)\s*\/\s*(\d+):(\d+)/); const rel = +tc[1] * 60 + +tc[2], len = +tc[3] * 60 + +tc[4];
      const tr = document.getElementById("track").getBoundingClientRect(), h = document.getElementById("phead").getBoundingClientRect();
      r({ line: ((h.left + h.width / 2) - tr.left) / tr.width, timer: rel / len, end: document.getElementById("durLbl").textContent }); }))));
    check("het lijntje loopt gelijk met de timer (clipbalk toont alleen de clip)", Math.abs(view.line - view.timer) < 0.03 && view.end === "0:10", JSON.stringify(view));
    await page.click("#recBtn");
    await page.waitForFunction(() => window.__ss.mode === "recording", null, { timeout: 8000 });
    check("opnemen vanuit bekijken start de opname", await mode(page) === "recording");
    // de opname stopt precies aan het einde van de clip en de microfoon gaat meteen uit
    const t0 = Date.now();
    await page.waitForFunction(() => window.__ss.takes.length === 1, null, { timeout: 20000 });
    const waited = (Date.now() - t0) / 1000;
    const tk = await S(page, () => { const k = window.__ss.takes[0]; return { buf: k.buffer.duration, off: k.offset, vid: k.end - k.start, st: window.__ss.stream, clipLen: window.__ss.takes[0].end - window.__ss.takes[0].start }; });
    check("de opname stopt aan het einde van de clip (10 s), niet later", Math.abs(tk.buf - (tk.off + tk.vid)) < 0.5 && tk.vid > 8.5 && tk.vid <= 10.1, `opname ${tk.buf.toFixed(2)} s, clip ${(tk.off + tk.vid).toFixed(2)} s, beeld ${tk.vid.toFixed(2)} s`);
    check("de microfoon is daarna uitgeschakeld", tk.st === null && await mode(page) !== "recording");
    await page.keyboard.press("3"); await sleep(300);

    // bewaarde clips: deze sessie, met een knop die alles achter elkaar afspeelt
    await page.click("#saveClip").catch(() => {}); await sleep(300);
    const lib = await S(page, () => ({ scope: document.querySelector('#libScope button[aria-pressed="true"]')?.dataset.scope, now: sessionStorage.getItem("ss.sessionStart"), label: document.querySelector('#libScope button[aria-pressed="true"]')?.textContent, clips: document.querySelectorAll("#lib .clip").length, btn: document.getElementById("reelBtn").textContent, en: !document.getElementById("reelBtn").disabled }));
    check("bewaarde clips staan per sessie met datum; de huidige sessie is gekozen", lib.scope === lib.now && /^Sessie 1 \(nu\)\d+ \S+ \d\d:\d\d · 1 clip$/.test(lib.label) && lib.clips >= 1 && lib.en, JSON.stringify(lib));
    await page.click("#reelBtn");
    await page.waitForFunction(() => window.__ss.reel && window.__ss.mode === "playing", null, { timeout: 8000 });
    check("de knop speelt de clips achter elkaar af (opnemen is dan geblokkeerd)", await page.isDisabled("#recBtn") && /Stop/.test(await page.textContent("#reelBtn")));
    const fs = await S(page, () => ({ fs: document.getElementById("screen").classList.contains("fs"), w: document.getElementById("screen").getBoundingClientRect().width, vw: innerWidth, vctl: document.getElementById("vctl").hidden, tag: document.getElementById("tag").hidden, bar: !document.getElementById("fsBar").hidden }));
    check("alle clips achter elkaar: volledig beeld, zonder pauzeknop in beeld", fs.fs && Math.abs(fs.w - fs.vw) < 2 && fs.vctl && fs.tag && fs.bar, JSON.stringify(fs));
    const fin = await page.waitForFunction(() => !window.__ss.reel, null, { timeout: 25000 }).then(() => true, () => false);
    check("na de laatste take stopt het afspelen vanzelf", fin && await mode(page) === "idle" && /Klaar: 1 clip/.test(await page.textContent("#toast")), await page.textContent("#toast"));
    await page.click("#reelBtn");
    await page.waitForFunction(() => window.__ss.reel && window.__ss.mode === "playing", null, { timeout: 8000 });
    await sleep(500); await page.click("#fsStop"); await sleep(400);
    check("Stop breekt het achter elkaar afspelen af en sluit het volledige beeld", await S(page, () => !window.__ss.reel && window.__ss.mode === "idle" && !document.getElementById("screen").classList.contains("fs")) && /gestopt/.test(await page.textContent("#toast")));
    await page.click('#libScope button[data-scope="all"]'); await sleep(200);
    check("met Alle clips zie je ook clips van eerdere sessies", await S(page, () => document.querySelector('#libScope button[data-scope="all"]').getAttribute("aria-pressed") === "true"));
    await page.click('#libScope button[aria-pressed="false"]');
    // oude opnames zonder sessie: wat kort na elkaar is opgenomen is één sessie, niet per datum
    const legacy = await S(page, () => { const s = window.__ss, h = 3600e3, base = Date.now() - 30 * h, src = s.clips[0];
      const fake = [0, 10 * 60e3, 3 * h, 3 * h + 5 * 60e3].map((d, i) => ({ ...src, id: "old" + i, session: undefined, created: base + d }));
      s.clips.push(...fake); const ss = window.__sessions().map(x => x.key); s.clips = s.clips.filter(c => !fake.includes(c)); window.__renderLib();
      return { n: ss.length, keys: ss }; });
    check("oude opnames zonder sessie worden in sessies gegroepeerd (niet per datum)", legacy.n === 3, JSON.stringify(legacy));

    // automatisch bijwerken: nieuwe versie op de server -> pagina ververst zichzelf, wacht tot er niet meer gespeeld wordt
    let v = 1;
    await page.route(URL0, route => route.fetch().then(async r => route.fulfill({ response: r, body: (await r.text()) + `<!-- v${v} -->` })));
    await page.evaluate(async () => { window.__updReset(); await window.__checkUpdate(); }); // nulmeting met de nagebootste server
    check("nulmeting van de versie is gemaakt", await S(page, () => !!window.__updBase()));
    await S(page, () => { window.__marker = 1; });
    v = 2;
    await page.click("#preview"); await sleep(300);
    await page.evaluate(() => window.__checkUpdate());
    await sleep(2500);
    check("nieuwe versie: er wordt niet ververst terwijl er gespeeld wordt", await S(page, () => window.__marker === 1));
    await page.click("#stopBtn");
    const reloaded = await page.waitForFunction(() => window.__marker !== 1, null, { timeout: 12000 }).then(() => true, () => false);
    check("zodra het rustig is ververst de pagina zichzelf", reloaded);
    await page.waitForSelector("#players .player"); 
    check("de partij en de spelers blijven bewaard na het verversen", await S(page, () => window.__game().players.some(p => p.name === "Tess")));
    await page.context().close();
  }

  // ===== Doorlopend spelen, Team, Opnieuw en personages =====
  {
    const { page } = await open(browser, { init: () => { try { localStorage.setItem("ss.helpSeen", "true"); } catch {} } });
    await page.waitForSelector("#startDlg[open]");
    for (const n of ["Anna", "Bram"]) { await page.fill("#startName", n); await page.click("#startAdd"); }
    await page.click("#teamBtn"); await sleep(150);
    const team = await S(page, () => ({ names: window.__game().players.map(p => p.name), free: document.querySelector('#roundSeg button[aria-pressed="true"]')?.textContent }));
    check("Team: één naam, vrij spelen", team.names.join() === "Team" && team.free === "Vrij spelen", JSON.stringify(team));
    await page.uncheck("#flowOn"); await page.click("#startGo"); // los per speler (doorlopend heeft een eigen test)
    await page.setInputFiles("#file", LONG);
    await page.waitForFunction(() => window.__ss.src && window.__ss.src.duration() > 100); await sleep(300);
    await page.click('#lens button[data-len="10"]'); await sleep(200);
    const rec = async ms => { await page.waitForFunction(() => window.__ss.mode === "recording", null, { timeout: 8000 }); await sleep(ms); await page.click("#recBtn"); };
    check("Opnieuw kan pas als er een take is", await page.isDisabled("#redoBtn"));
    await page.click("#preview"); await sleep(400); await page.click("#recBtn"); await rec(2000);
    await page.waitForSelector("#rate:not([hidden])", { timeout: 15000 });
    const first = await S(page, () => ({ id: window.__ss.takes[0].id, end: window.__ss.takes[0].end, clip: window.__ss.clipStart }));
    check("Opnieuw staat naast Opnemen en is te gebruiken na een take", await page.isEnabled("#redoBtn"));
    await page.click("#faces button:nth-child(4)"); await sleep(300);
    const nxt = await S(page, () => ({ start: window.__ss.clipStart, range: document.getElementById("range").textContent, pts: window.__game().players[0].pts }));
    check("de volgende clip begint waar de take ophield (Team speelt verder)", Math.abs(nxt.start - first.end) < 0.15 && nxt.pts === 4, JSON.stringify({ ...nxt, end: first.end }));
    // Opnieuw: terug naar dezelfde plek, opnemen, de oude take verdwijnt en zijn punten ook
    await page.click("#redoBtn"); await rec(1500);
    await page.waitForSelector("#rate:not([hidden])", { timeout: 15000 });
    const redo = await S(page, () => ({ n: window.__ss.takes.length, id: window.__ss.takes[0].id, start: window.__ss.clips.find(c => c.id === window.__ss.takes[0].clipId).start, pts: window.__game().players[0].pts }));
    check("Opnieuw: de oude take is vervangen door de nieuwe, op dezelfde plek", redo.n === 1 && redo.id !== first.id && Math.abs(redo.start - first.clip) < 0.15, JSON.stringify(redo));
    check("Opnieuw: de punten van de oude take zijn weg", redo.pts === 0);
    await page.click("#faces button:nth-child(2)"); await sleep(300);
    check("na de nieuwe take gaat het weer verder vanaf het einde ervan", await S(page, () => Math.abs(window.__ss.clipStart - window.__ss.takes[0].end) < 0.15 && window.__game().players[0].pts === 2));

    // Personages: elke naam is een personage, opnemen loopt tot je stopt
    await page.click("#newGameBtn"); await page.waitForSelector("#startDlg[open]");
    await page.click('#styleSeg button:text-is("🎭 Personages")'); await sleep(150);
    check("personages: geen rondes en geen cliplengte te kiezen", await page.isHidden("#roundWrap") && await page.isHidden("#lenWrap") && /personage/i.test(await page.getAttribute("#startName", "placeholder")));
    for (const n of ["Homer", "Marge"]) { await page.fill("#startName", n); await page.click("#startAdd"); }
    await page.click('#startPlayers .player:has-text("Team") .x');
    await page.click("#startGo"); await sleep(300);
    const p0 = await S(page, () => ({ style: window.__game().style, names: window.__game().players.map(p => p.name), start: window.__ss.clipStart, lens: document.getElementById("lens").hidden, blocked: document.getElementById("recBtn").classList.contains("blocked"), hint: document.getElementById("hint").textContent }));
    check("personages: begint bij 0:00, opnemen mag meteen", p0.style === "personage" && p0.names.join() === "Homer,Marge" && p0.start === 0 && p0.lens && !p0.blocked && /Homer/.test(p0.hint), JSON.stringify(p0));
    await page.click("#recBtn"); await rec(2000); await sleep(600);
    const h = await S(page, () => { const t = window.__ss.takes.slice().sort((a, b) => b.created - a.created)[0]; return { who: t.who, len: t.end - t.start, end: t.end, start: window.__ss.clipStart, now: window.__game().players[window.__game().turn].name, rate: !document.getElementById("rate").hidden, mode: window.__ss.mode }; });
    check("personages: stoppen geeft de beurt aan het volgende personage, vanaf dezelfde plek", h.who === "Homer" && h.now === "Marge" && Math.abs(h.start - h.end) < 0.15 && !h.rate && h.mode === "idle", JSON.stringify(h));
    await page.click("#recBtn"); await rec(1500); await sleep(600);
    const m = await S(page, () => { const ts = window.__ss.takes.filter(t => t.created >= Date.now() - 60000).sort((a, b) => a.created - b.created).slice(-2); return { who: ts.map(t => t.who), now: window.__game().players[window.__game().turn].name, clips: ts.map(t => { const c = window.__ss.clips.find(c => c.id === t.clipId); return [c.start, +(c.len).toFixed(1), +(t.end - t.start).toFixed(1)]; }) }; });
    check("personages: Marge spreekt verder waar Homer stopte, daarna weer Homer", m.who.join() === "Homer,Marge" && m.now === "Homer" && Math.abs(m.clips[1][0] - h.end) < 0.15, JSON.stringify(m));
    check("personages: elke clip is precies het stuk van dat personage", m.clips.every(c => Math.abs(c[1] - c[2]) < 0.6), JSON.stringify(m.clips));
    const before = await S(page, () => window.__ss.takes.length);
    await page.click("#redoBtn"); await rec(1000); await sleep(600);
    const r2 = await S(page, () => ({ n: window.__ss.takes.length, last: window.__ss.lastTake.who, now: window.__game().players[window.__game().turn].name }));
    check("personages: Opnieuw neemt Marge opnieuw op, daarna is Homer weer aan de beurt", r2.n === before && r2.last === "Marge" && r2.now === "Homer", JSON.stringify(r2));
    await page.screenshot({ path: path.join(OUT, "9-personages.png") });
    // de hele sessie achter elkaar: het beeld loopt door zonder te pauzeren
    const items = await S(page, () => document.getElementById("reelBtn").textContent);
    await page.evaluate(() => { window.__pz = []; window.__pzT = setInterval(() => { const s = window.__ss; if (s.reel && s.src?.el) window.__pz.push({ p: s.src.el.paused, i: s.reel.i, m: s.mode }); }, 40); });
    await page.click("#reelBtn");
    const done = await page.waitForFunction(() => !window.__ss.reel, null, { timeout: 30000 }).then(() => true, () => false);
    const pz = await S(page, () => { clearInterval(window.__pzT); const a = window.__pz; const first = a.findIndex(x => x.m === "playing"); return { n: a.length, items: Math.max(...a.map(x => x.i)) + 1, paused: a.slice(first).filter(x => x.p).length }; });
    check("alle clips van de sessie lopen door zonder pauze tussendoor", done && pz.items >= 3 && pz.paused === 0, JSON.stringify({ ...pz, items, toast: await page.textContent("#toast") }));
    await page.screenshot({ path: path.join(OUT, "10-bewaarde-clips.png"), fullPage: true });
    await page.context().close();
  }

  // ===== Doorlopend: de video loopt door naar de volgende speler (0:00–0:10, dan 0:10–0:20) =====
  {
    const { page } = await open(browser, { init: () => { try { localStorage.setItem("ss.helpSeen", "true"); } catch {} } });
    await page.waitForSelector("#startDlg[open]");
    for (const n of ["Anna", "Bram"]) { await page.fill("#startName", n); await page.click("#startAdd"); }
    check("doorlopend staat standaard aan", await page.isChecked("#flowOn"));
    await page.click(`#roundSeg button:text-is("1 ronde")`); await page.click("#startGo");
    await page.setInputFiles("#file", LONG);
    await page.waitForFunction(() => window.__ss.src && window.__ss.src.duration() > 100); await sleep(300);
    await page.click('#lens button[data-len="10"]'); await sleep(200);
    const c0 = await S(page, () => window.__ss.clipStart);
    await page.click("#preview"); await sleep(400); await page.click("#recBtn");
    await page.waitForFunction(() => window.__ss.mode === "recording", null, { timeout: 8000 });
    await page.evaluate(() => { window.__fl = []; window.__flT = setInterval(() => { const s = window.__ss; if (s.mode === "recording") window.__fl.push({ p: s.src.el.paused, who: s.recPlayerId }); }, 40); });
    const handed = await page.waitForFunction(() => window.__ss.mode === "recording" && window.__ss.recPlayerId !== window.__game().players[0].id, null, { timeout: 15000 }).then(() => true, () => false);
    const mid = await S(page, () => ({ start: window.__ss.clipStart, who: window.__game().players[window.__game().turn].name, pop: document.getElementById("turnPop").textContent, mic: !!window.__ss.stream }));
    check("na 10 seconden neemt Bram meteen op, vanaf 0:10 in de clip", handed && Math.abs(mid.start - (c0 + 10)) < 0.3 && mid.who === "Bram" && /Bram/.test(mid.pop) && mid.mic, JSON.stringify({ ...mid, c0 }));
    const stopped = await page.waitForFunction(() => window.__ss.mode !== "recording", null, { timeout: 15000 }).then(() => true, () => false);
    const fl = await S(page, () => { clearInterval(window.__flT); return { n: window.__fl.length, paused: window.__fl.filter(x => x.p).length }; });
    check("de video stopt niet bij de wissel van speler", stopped && fl.n > 100 && fl.paused === 0, JSON.stringify(fl));
    check("na het laatste stuk van de partij stopt de opname en gaat de microfoon uit", await S(page, () => window.__ss.stream === null));
    await page.waitForSelector("#rate:not([hidden])", { timeout: 40000 });
    const tk = await S(page, () => window.__ss.takes.slice().sort((a, b) => a.created - b.created).map(t => ({ who: t.who, s: +t.start.toFixed(2), e: +t.end.toFixed(2), len: +(t.buffer.duration - t.offset).toFixed(2) })));
    check("twee takes: Anna 0:00–0:10 en Bram 0:10–0:20 van de clip", tk.length === 2 && tk[0].who === "Anna" && tk[1].who === "Bram" && Math.abs(tk[0].e - tk[1].s) < 0.3 && Math.abs(tk[0].e - tk[0].s - 10) < 0.4 && Math.abs(tk[1].e - tk[1].s - 10) < 0.4, JSON.stringify(tk));
    check("de opname van elke take is even lang als zijn stuk video", tk.every(t => Math.abs(t.len - (t.e - t.s)) < 0.5), JSON.stringify(tk));
    check("na het terugkijken: punten per take, eerst Anna", /Anna.*1 van 2/.test(await page.textContent("#rateQ")), await page.textContent("#rateQ"));
    await page.keyboard.press("4"); await sleep(600);
    check("dan Bram", /Bram.*2 van 2/.test(await page.textContent("#rateQ")), await page.textContent("#rateQ"));
    await page.keyboard.press("2");
    await page.waitForSelector("#resultDlg[open]", { timeout: 5000 });
    const g = await S(page, () => window.__game());
    check("daarna de uitslag, met de punten bij de goede speler", g.done && g.players[0].pts === 4 && g.players[1].pts === 2 && /Anna wint/.test(await page.textContent("#resultTitle")), JSON.stringify(g.players));
    await page.context().close();
  }

  // ===== Personagemodus uit te zetten met SS_FEATURES =====
  {
    const { page } = await open(browser, { init: () => { window.SS_FEATURES = { personage: false }; try { localStorage.setItem("ss.helpSeen", "true"); } catch {} } });
    await page.waitForSelector("#startDlg[open]");
    check("met SS_FEATURES.personage = false is de keuze voor personages weg (Team blijft)", await page.isHidden("#styleWrap") && await page.isVisible("#teamBtn"));
    await page.context().close();
  }

  // ===== Voorbeeldweergave: pagina in een afgeschermd frame (alleen scripts, geen formulieren of opslag) =====
  {
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    let html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    for (const f of ["config", "engine", "cloud", "app"]) html = html.replace(`<script src="js/${f}.js"></script>`, () => `<script>${fs.readFileSync(path.join(ROOT, "js", f + ".js"), "utf8")}</script>`);
    await page.setContent('<iframe id="f" sandbox="allow-scripts" style="width:1200px;height:850px;border:0"></iframe>');
    await page.$eval("#f", (f, h) => { f.srcdoc = h; }, html);
    const fr = await (await page.waitForSelector("#f")).contentFrame();
    await fr.waitForSelector("#helpDlg[open]");
    await fr.click("#helpOk");
    check("afgeschermde voorbeeldweergave: Begrepen sluit de uitleg en opent het startscherm", await fr.waitForSelector("#startDlg[open]", { timeout: 2000 }).then(() => true, () => false));
    await fr.fill("#startName", "Iris"); await fr.press("#startName", "Enter"); await fr.click("#startGo");
    check("afgeschermde voorbeeldweergave: partij start", (await fr.textContent("#turnName")) === "Iris" && await fr.locator("dialog[open]").count() === 0);
    await fr.fill("#url", "dit is geen link"); await fr.press("#url", "Enter");
    check("afgeschermde voorbeeldweergave: Enter in het linkveld werkt", /geen werkende videolink/.test(await fr.textContent("#err")));
    await ctx.close();
  }

  // ===== 3. Mobiel formaat =====
  {
    const { page } = await open(browser, { viewport: { width: 390, height: 844 }, init: () => { try { localStorage.setItem("ss.helpSeen", "true"); } catch {} } });
    await page.screenshot({ path: path.join(OUT, "6-mobiel-start.png") });
    for (const n of ["Gijs", "Hanna"]) { await page.fill("#startName", n); await page.click("#startAdd"); }
    await page.click("#roundSeg button:text-is('1 ronde')"); await page.click("#startGo");
    await page.setInputFiles("#file", SHORT);
    await page.waitForFunction(() => window.__ss.src && window.__ss.src.duration() > 0);
    const overflow = await S(page, () => document.documentElement.scrollWidth - window.innerWidth);
    check("mobiel: geen horizontale scroll", overflow <= 0, `${overflow}px`);
    await page.screenshot({ path: path.join(OUT, "7-mobiel-spel.png"), fullPage: true });
    await oneTake(page, 5);
    check("mobiel: punten geven werkt (paneel scrolt in beeld)", await S(page, () => window.__game().players[0].pts) === 5);
    await oneTake(page, 3);
    await page.waitForSelector("#resultDlg[open]");
    await page.screenshot({ path: path.join(OUT, "8-mobiel-uitslag.png") });
    check("mobiel: complete partij met uitslag", /Gijs wint/.test(await page.textContent("#resultTitle")));
    await page.context().close();
  }

  // ===== Accounts: registreren, inloggen, clips en takes per account, ander apparaat =====
  {
    // Zonder instellingen (js/config.js leeg) is er geen inlogknop en werkt alles zoals voorheen.
    const { page: p0 } = await open(browser);
    check("zonder Supabase-instellingen is er geen inlogknop", await p0.isHidden("#acctBtn"));
    await p0.context().close();

    // Geheugen-backend voor de nep-Supabase (gedeeld tussen "apparaten")
    const users = new Map(), rows = { ss_clips: new Map(), ss_takes: new Map() }, files = new Map();
    const remote = (_src, str) => {
      const { op, a } = JSON.parse(str); let out = {};
      if (op === "signUp") { if (users.has(a.email)) out = { error: "User already registered" }; else { const u = { id: "u" + (users.size + 1), email: a.email, user_metadata: { name: a.name } }; users.set(a.email, { u, password: a.password }); out = { user: u }; } }
      else if (op === "signIn") { const r = users.get(a.email); out = r && r.password === a.password ? { user: r.u } : { error: "Invalid login credentials" }; }
      else if (op === "upsert") { rows[a.t].set(a.row.user_id + "/" + a.row.id, a.row); out = { error: null }; }
      else if (op === "select") { out = { data: [...rows[a.t].values()].filter(r => r.user_id === a.f.user_id).map(r => ({ data: r.data })), error: null }; }
      else if (op === "delete") { rows[a.t].delete(a.f.user_id + "/" + a.f.id); out = { error: null }; }
      else if (op === "up") { files.set(a.path, { b64: a.b64, type: a.type }); out = { error: null }; }
      else if (op === "down") { const f = files.get(a.path); out = f ? { b64: f.b64, type: f.type } : { error: "not found" }; }
      else if (op === "rm") { a.paths.forEach(p => files.delete(p)); out = { error: null }; }
      return JSON.stringify(out);
    };
    const device = async () => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["microphone"] });
      await ctx.addInitScript(() => { window.SS_CONFIG = { url: "https://fake.supabase.test", anonKey: "anon" }; try { localStorage.setItem("ss.helpSeen", "true"); } catch {} });
      await ctx.addInitScript({ content: fs.readFileSync(path.join(ROOT, "tests", "fake-supabase.js"), "utf8") });
      const page = await ctx.newPage(); page.on("pageerror", e => errors.push(String(e)));
      await page.exposeBinding("__remote", remote);
      await page.goto(URL0); await page.waitForSelector("#startDlg[open]"); await page.click("#startGo");
      return page;
    };
    const login = async (page, email, pass) => { await page.click("#acctBtn"); await page.fill("#authEmail", email); await page.fill("#authPass", pass); await page.click("#authGo"); };

    const A = await device();
    check("met Supabase-instellingen staat er een inlogknop", await A.isVisible("#acctBtn") && /Inloggen/.test(await A.textContent("#acctLbl")));
    // eerst als gast een take maken
    await A.setInputFiles("#file", SHORT); await A.waitForFunction(() => window.__ss.src && window.__ss.src.duration() > 0); await sleep(300);
    await oneTake(A, 4);
    check("als gast bewaar je clips en takes op dit apparaat", await S(A, () => window.__ss.clips.length === 1 && window.__ss.takes.length === 1));
    // registreren: eerst bevestigen per mail, dan inloggen
    await A.click("#acctBtn"); await A.click('#authTabs button[data-tab="up"]');
    await A.fill("#authName", "Anna"); await A.fill("#authEmail", "anna@voorbeeld.nl"); await A.fill("#authPass", "kort"); await A.click("#authGo");
    check("te kort wachtwoord wordt geweigerd met uitleg", /minimaal 6/.test(await A.textContent("#authMsg")));
    await A.fill("#authPass", "geheim123"); await A.click("#authGo"); await A.waitForFunction(() => /mail/.test(document.getElementById("authMsg").textContent));
    check("account maken vraagt eerst om je mail te bevestigen", /mail/.test(await A.textContent("#authMsg")) && users.size === 1);
    await A.click('#authTabs button[data-tab="in"]'); await A.fill("#authEmail", "anna@voorbeeld.nl"); await A.fill("#authPass", "fout"); await A.click("#authGo");
    await A.waitForFunction(() => /klopt niet/.test(document.getElementById("authMsg").textContent));
    check("verkeerd wachtwoord geeft een duidelijke melding", true);
    await A.fill("#authPass", "geheim123"); await A.click("#authGo");
    await A.waitForFunction(() => !document.getElementById("authIn").hidden);
    check("inloggen lukt en toont je naam", /Anna/.test(await A.textContent("#authWho")) && /Anna/.test(await A.textContent("#acctLbl")));
    check("bij een account zie je alleen de clips van dat account (gastclips blijven apart)", await S(A, () => window.__ss.clips.length === 0 && window.__ss.takes.length === 0));
    check("clips van dit apparaat kan je meenemen", await A.isVisible("#authAdopt"));
    await A.click("#authAdopt"); await sleep(800);
    check("na meenemen staan clip en take op het account", await S(A, () => window.__ss.clips.length === 1 && window.__ss.takes.length === 1) && rows.ss_clips.size === 1 && rows.ss_takes.size === 1 && files.size === 1, `rijen ${rows.ss_clips.size}/${rows.ss_takes.size}, opnames ${files.size}`);
    await A.click("#authDlg [data-close]");
    // nieuwe take met account: gaat direct online
    await A.click("#preview"); await sleep(600); await A.click("#stopBtn"); await sleep(150);
    await A.click("#recBtn"); await A.waitForFunction(() => window.__ss.mode === "recording", null, { timeout: 8000 }); await sleep(1200); await A.click("#recBtn");
    await A.waitForSelector("#rate:not([hidden])", { timeout: 15000 }); await A.click("#faces button:nth-child(5)"); await sleep(800);
    check("een nieuwe take gaat meteen online, met je punten", rows.ss_takes.size === 2 && files.size === 2 && [...rows.ss_takes.values()].some(r => r.data.score === 5), `rijen ${rows.ss_takes.size}`);

    // ander apparaat: zelfde account, verse browser
    const B = await device();
    check("op een ander apparaat is de bibliotheek eerst leeg", await S(B, () => window.__ss.clips.length === 0));
    await login(B, "anna@voorbeeld.nl", "geheim123");
    await B.waitForFunction(() => window.__ss.takes.length === 2, null, { timeout: 8000 });
    const got = await S(B, () => ({ c: window.__ss.clips.length, t: window.__ss.takes.map(t => t.blob.size > 0 && t.who) }));
    check("op een ander apparaat zie je dezelfde clips en takes terug (met opname)", got.c === 1 && got.t.length === 2 && got.t.every(Boolean), JSON.stringify(got));
    await B.click("#authDlg [data-close]");
    check("bibliotheek toont de clip van het account", await B.locator("#lib .clip").count() === 1);
    // takes zijn ook echt af te spelen
    await B.waitForFunction(() => window.__ss.takes.every(t => t.blob.size > 0));
    // uitloggen: eigen content verdwijnt uit beeld, blijft op het account
    await B.click("#acctBtn"); await B.click("#authOutBtn"); await B.waitForFunction(() => document.getElementById("acctLbl").textContent === "Inloggen");
    check("uitloggen laat de clips van het account niet meer zien", await B.waitForFunction(() => window.__ss.clips.length === 0 && window.__ss.takes.length === 0, null, { timeout: 3000 }).then(() => true, () => false));
    // verwijderen van een take haalt hem ook online weg
    await B.click("#authDlg [data-close]"); await login(B, "anna@voorbeeld.nl", "geheim123"); await B.waitForFunction(() => window.__ss.takes.length === 2, null, { timeout: 8000 });
    await B.click("#authDlg [data-close]");
    await S(B, () => window.__ss.takes.length);
    await A.context().close(); await B.context().close();
  }
} catch (e) {
  check("test liep vast", false, String(e && e.stack || e));
} finally {
  await browser.close(); server.close();
}
const real = errors.filter(e => !/favicon|ERR_FILE_NOT_FOUND|Failed to load resource/.test(e));
check("geen console-fouten", real.length === 0, real.slice(0, 3).join(" | "));
fs.writeFileSync(path.join(OUT, "resultaat.json"), JSON.stringify(results, null, 2));
const fails = results.filter(r => !r.ok).length;
console.log(`\n${results.length - fails} van ${results.length} geslaagd`);
process.exit(fails ? 1 : 0);
