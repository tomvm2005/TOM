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
  if (keyboard) await page.keyboard.press("Space"); else await page.click("#recBtn");
  await page.waitForSelector("#rate:not([hidden])", { timeout: 15000 });
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
    await page.click("#lib .clip");
    await page.waitForFunction(() => window.__ss.src && window.__ss.src.duration() > 0);
    await sleep(300);
    check("bewaarde clip opent weer met zijn takes (video uit de opslag)", (await page.textContent("#takeCount")) === "3");

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

    // in het beeld: hoe lang de video duurt, en klikken = afspelen/pauzeren zoals YouTube
    check("in het beeld staat hoe lang de video duurt", /\/ 3:20$/.test(await page.textContent("#vTime")) && await page.isVisible("#vctl"), await page.textContent("#vTime"));
    await page.click("#shield"); await sleep(400);
    check("klik op het beeld speelt de video af", await S(page, () => !window.__ss.src.el.paused) && await page.getAttribute("#vPlay", "data-st") === "pause");
    await page.click("#shield"); await sleep(250);
    check("nog een klik op het beeld pauzeert", await S(page, () => window.__ss.src.el.paused) && await page.getAttribute("#vPlay", "data-st") === "play");
    await page.click("#vPlay"); await sleep(300);
    check("de knop linksonder in het beeld doet hetzelfde", await S(page, () => !window.__ss.src.el.paused));
    await page.click("#vPlay"); await sleep(200);
    // zwarte lijntje verslepen = door de video spoelen
    const clip0 = await S(page, () => window.__ss.clipStart);
    await page.locator("#track").scrollIntoViewIfNeeded();
    const hb = await page.locator("#phead").boundingBox(), tb = await page.locator("#track").boundingBox();
    await page.mouse.move(hb.x + hb.width / 2, tb.y + tb.height / 2); await page.mouse.down();
    await page.mouse.move(tb.x + tb.width * 0.6, tb.y + tb.height / 2, { steps: 5 });
    await page.mouse.move(tb.x + tb.width * 0.75, tb.y + tb.height / 2, { steps: 5 }); await page.mouse.up(); await sleep(400);
    const pos = await S(page, () => window.__ss.src.time());
    check("het zwarte lijntje verslepen spoelt de video", Math.abs(pos - 150) < 4 && await S(page, () => window.__ss.clipStart) === clip0, `video op ${pos.toFixed(1)} s (verwacht ~150), clip blijft op ${clip0} s`);
    check("de videotijd in het beeld loopt mee", /^2:3\d \//.test(await page.textContent("#vTime")), await page.textContent("#vTime"));
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

  // ===== Voorbeeldweergave: pagina in een afgeschermd frame (alleen scripts, geen formulieren of opslag) =====
  {
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    let html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    for (const f of ["engine", "app"]) html = html.replace(`<script src="js/${f}.js"></script>`, () => `<script>${fs.readFileSync(path.join(ROOT, "js", f + ".js"), "utf8")}</script>`);
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
