/* Stemmenstudio: de interface. Spelregels zitten in js/engine.js (window.Engine);
   dit bestand regelt video-spelers, microfoon, opslag, schermen en feedback. */
(() => {
"use strict";
const E = window.Engine, R = E.RULES;
const $ = id => document.getElementById(id);

// ---------- Constanten ----------
const TIMING = {
  countdownStep: 800,   // ms per tel van 3-2-1
  nextTakeGap: 700,     // ms pauze tussen takes bij "alle takes"
  tick: 100,            // ms: klok, voortgangsbalk en controle op uitlopen
  deleteConfirm: 2500,  // ms dat "Zeker?" blijft staan
  toast: 2800,          // ms
  confetti: 1500,       // ms
  playEndSlack: 0.3,    // s na het einde van een take stoppen
  recEndSlack: 0.05,    // s voor het einde van de clip stoppen met opnemen
  resyncTolerance: 0.08,// s: meer afwijking tussen stem en beeld = stem opnieuw uitlijnen
  resyncEvery: 1000,    // ms minimaal tussen twee keer uitlijnen
  durationPolls: 40, durationPoll: 150, // wachten tot de videolengte bekend is
  playerTimeout: 15000, // ms om de YouTube-speler te laden
  doubleClick: 450,     // ms: een tweede klik op Opnemen binnen deze tijd telt niet (geen per ongeluk gestopte opname)
};
const KEYS = { len: "ss.len", game: "ss.players", sound: "ss.sound", help: "ss.helpSeen", recVol: "ss.recVol", voiceVol: "ss.voiceVol" };
const FACES = [["🥱","1"],["🙂","2"],["😄","3"],["😂","4"],["🤣","5"]];
const BIG_SCORE = 4; // vanaf zoveel punten: confetti
const BUSY = new Set(["arming","countdown","recording","preview","playing"]);
const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// ---------- Kleine opslag (localStorage, nooit crashen) ----------
const LS = {
  get(k, d){ try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
let CLIP = R.clipLengths.includes(LS.get(KEYS.len)) ? LS.get(KEYS.len) : R.defaultClip;

const S = {
  src:null, srcInfo:null, srcKey:null, clipStart:0, clipId:null, mode:"idle", // idle|arming|countdown|recording|preview|playing
  stream:null, rec:null, chunks:[], t0:0, offset:null, recStart:0, recEnd:0, recPlayerId:null, challenge:null, currentChallenge:null,
  takes:[], clips:[], watched:new Set(), ctx:null, analyser:null, voiceGain:null, voiceSrc:null, voiceAt:null, lastResync:0,
  drift:[], playing:null, queue:[], rateTake:null, exporting:null, sound: LS.get(KEYS.sound, true) !== false,
};
let G = E.newState(); // spelstatus (spelers, beurt, rondes)

// ---------- Opslag (IndexedDB, met geheugen als terugval) ----------
// put() geeft true als het echt op dit apparaat bewaard is, false als het alleen in het geheugen staat.
const DB = (() => {
  let dbp = null;
  const mem = {clips:new Map(), takes:new Map(), files:new Map()};
  function open(){
    if (dbp) return dbp;
    dbp = new Promise(res => {
      try {
        const r = indexedDB.open("stemmenstudio",1);
        r.onupgradeneeded = () => { const d=r.result; for (const s of ["clips","takes","files"]) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s,{keyPath:"id"}); };
        r.onsuccess = () => res(r.result); r.onerror = () => res(null); r.onblocked = () => res(null);
      } catch { res(null); }
    });
    return dbp;
  }
  async function tx(store, mode, fn){
    const d = await open();
    if (!d) throw new Error("no-db");
    return new Promise((res,rej)=>{
      let t; try { t=d.transaction(store,mode); } catch(e){ return rej(e); }
      const r=fn(t.objectStore(store)); let out;
      if (r) r.onsuccess=()=>{ out=r.result; };
      t.oncomplete=()=>res(out); t.onerror=()=>rej(t.error); t.onabort=()=>rej(t.error||new Error("abort"));
    });
  }
  return {
    async put(store,obj){ try { await tx(store,"readwrite",s=>s.put(obj)); mem[store].delete(obj.id); return true; }
      catch(e){ mem[store].set(obj.id,obj); storageProblem(e); return false; } },
    async del(store,id){ mem[store].delete(id); try { await tx(store,"readwrite",s=>s.delete(id)); } catch {} },
    async all(store){ let v=[]; try { v=(await tx(store,"readonly",s=>s.getAll()))||[]; } catch(e){ storageProblem(e); } return [...v, ...mem[store].values()]; },
    async get(store,id){ try { const v=await tx(store,"readonly",s=>s.get(id)); if (v) return v; } catch {} return mem[store].get(id); },
  };
})();
let storageWarned = false;
function storageProblem(e){
  if (storageWarned) return; storageWarned = true;
  const full = e && (e.name==="QuotaExceededError" || /quota/i.test(e.message||""));
  showErr(full ? "De opslag van je browser is vol. Nieuwe takes blijven alleen bewaard tot je de pagina sluit. Download takes die je wilt houden, of verwijder oude clips."
               : "Je browser laat Stemmenstudio niets bewaren (bijvoorbeeld in een privévenster). Spelen kan gewoon, maar takes verdwijnen als je de pagina sluit. Download takes die je wilt houden.");
  sfx("error");
}

// ---------- Spelstatus: alle wijzigingen via de engine ----------
function dispatch(a, {quiet=false}={}){
  const why = E.whyNot(G, a);
  if (why){ if (!quiet) toast(why); return why; }
  const prev = G; G = E.reduce(G, a); saveGame(); afterChange(prev);
  return "";
}
function saveGame(){ const {legacy, ...g} = G; LS.set(KEYS.game, g); }
function afterChange(prev){
  renderGame();
  if (!prev.done && G.done){ setTimeout(showResults, TIMING.nextTakeGap); return; }
  if (G.done) return;
  const who = E.current(G).name;
  if (G.round > prev.round) toast(`Ronde ${G.round}${G.rounds ? " van " + G.rounds : ""}: ${who} begint!`);
  else if (prev.turn !== G.turn || E.current(prev).id !== E.current(G).id) toast(`🎤 ${who} is aan de beurt!`);
  if (E.current(prev).id !== E.current(G).id || G.round !== prev.round){ bump($("nowTurn")); S.currentChallenge = null; resetChallenge(); }
}

// ---------- Bronnen herkennen ----------
function parseSource(raw){
  raw=(raw||"").trim(); if (!raw) return null;
  if (/^[\w-]{11}$/.test(raw)) return {kind:"yt",id:raw,t:0};
  let u; try { u = new URL(/^https?:\/\//i.test(raw)?raw:"https://"+raw); } catch { return {kind:"bad"}; }
  const h = u.hostname.replace(/^www\.|^m\./,"");
  if (/\s/.test(raw) || !h.includes(".")) return {kind:"bad"};
  const t = parseT(u.searchParams.get("t")||u.searchParams.get("start")||(u.hash.match(/t=([\dhms]+)/)||[])[1]);
  if (/(^|\.)youtube(-nocookie)?\.com$/.test(h) || h==="youtu.be"){
    const m = raw.match(/(?:[?&]v=|youtu\.be\/|\/shorts\/|\/embed\/|\/live\/|\/v\/)([\w-]{11})/);
    return m ? {kind:"yt",id:m[1],t} : {kind:"bad"};
  }
  if (h==="vimeo.com" || h==="player.vimeo.com"){
    const m = u.pathname.match(/(\d{6,})/); return m ? {kind:"vimeo",id:m[1],t,hash:(u.pathname.match(/\/\d+\/([\da-f]{6,})/)||[])[1]||u.searchParams.get("h")} : {kind:"bad"};
  }
  if (/(tiktok|instagram|facebook|fb\.watch|twitter|x\.com|twitch|snapchat|netflix|disneyplus|videoland|npostart)/.test(h)) return {kind:"blocked",host:h};
  return {kind:"url",url:u.href,t};
}
function parseT(v){ if (!v) return 0; if (/^\d+(\.\d+)?$/.test(v)) return +v; const g=r=>{const m=v.match(r);return m?+m[1]:0}; return g(/(\d+)h/)*3600+g(/(\d+)m/)*60+g(/(\d+)s/); }

// ---------- Videospelers met één gezamenlijke interface ----------
const loaded = {};
function loadScript(src){ return loaded[src] ||= new Promise((res,rej)=>{ const s=document.createElement("script"); s.src=src; s.onload=res; s.onerror=()=>{ delete loaded[src]; rej(new Error("script")); }; document.head.appendChild(s); }); }
function ytReady(){ return loaded.ytapi ||= new Promise((res,rej)=>{ if (window.YT?.Player) return res(); window.onYouTubeIframeAPIReady=res; loadScript("https://www.youtube.com/iframe_api").catch(e=>{ delete loaded.ytapi; rej(e); }); setTimeout(()=>{ delete loaded.ytapi; rej(new Error("timeout")); },TIMING.playerTimeout); }); }

class Clock { // vloeiende tijd voor spelers die tijd alleen af en toe melden
  constructor(){ this.t=0; this.at=performance.now(); this.run=false; }
  set(t,run=this.run){ this.t=t; this.at=performance.now(); this.run=run; }
  now(){ return this.run ? this.t+(performance.now()-this.at)/1000 : this.t; }
}

async function makeYouTube(info, host, emit){
  await ytReady();
  const div=document.createElement("div"); host.appendChild(div);
  return new Promise((res,rej)=>{
    let p;
    p = new YT.Player(div,{ videoId:info.id, playerVars:{rel:0,playsinline:1,modestbranding:1,cc_load_policy:0,iv_load_policy:3,start:Math.floor(info.t||0)},
      events:{
        onReady:()=>{ try{ p.unloadModule("captions"); p.unloadModule("cc"); }catch{} res(api); },
        onStateChange:e=>emit(e.data===1?"playing":e.data===0?"ended":"paused"),
        onError:e=>{ const c=e.data; const msg = c===101||c===150 ? "De eigenaar van deze YouTube-video staat afspelen op andere sites niet toe. Kies een andere video, of upload hem zelf."
          : c===153 ? "YouTube weigert de video omdat de pagina niet via een webadres geopend is. Open Stemmenstudio via de online link."
          : c===100 ? "Deze YouTube-video bestaat niet (meer) of is privé." : "De YouTube-video kon niet geladen worden (foutcode "+c+")."; emit("error",msg); rej(new Error(msg)); }
      }});
    const api = { kind:"yt", canExport:false,
      play:()=>p.playVideo(), pause:()=>p.pauseVideo(), seek:s=>p.seekTo(s,true), time:()=>p.getCurrentTime?.()||0,
      duration:()=>p.getDuration?.()||0, setVolume:v=>{ p.unMute(); p.setVolume(v); }, destroy:()=>{ try{p.destroy();}catch{} },
      title:()=>p.getVideoData?.().title||"YouTube-video", thumb:"https://i.ytimg.com/vi/"+info.id+"/mqdefault.jpg" };
  });
}

async function makeVimeo(info, host, emit){
  await loadScript("https://player.vimeo.com/api/player.js");
  const div=document.createElement("div"); host.appendChild(div);
  const opts={id:+info.id,playsinline:true,dnt:true,responsive:false,width:640}; if (info.hash) opts.h=info.hash;
  const p = new Vimeo.Player(div,opts);
  const clk=new Clock(); let dur=0, title="Vimeo-video";
  p.on("timeupdate",d=>clk.set(d.seconds)); p.on("seeked",d=>clk.set(d.seconds));
  p.on("play",()=>{ clk.set(clk.now(),true); }); p.on("playing",d=>{ clk.set(d?.seconds??clk.now(),true); emit("playing"); });
  p.on("pause",d=>{ clk.set(d?.seconds??clk.now(),false); emit("paused"); }); p.on("bufferstart",()=>{ clk.set(clk.now(),false); emit("paused"); });
  p.on("bufferend",()=>{ p.getPaused().then(ps=>{ if(!ps){ clk.set(clk.now(),true); emit("playing"); } }); });
  p.on("ended",()=>{ clk.set(clk.now(),false); emit("ended"); });
  try { await p.ready(); dur=await p.getDuration(); title=await p.getVideoTitle().catch(()=>title); }
  catch { throw new Error("Deze Vimeo-video kan niet ingesloten worden. Hij is privé of de maker staat het niet toe."); }
  div.querySelector("iframe")?.setAttribute("style","width:100%;height:100%");
  p.disableTextTrack().catch(()=>{});
  return { kind:"vimeo", canExport:false,
    play:()=>p.play().catch(()=>{}), pause:()=>p.pause().catch(()=>{}), seek:s=>{ clk.set(s); p.setCurrentTime(s).catch(()=>{}); },
    time:()=>clk.now(), duration:()=>dur, setVolume:v=>p.setVolume(v/100).catch(()=>{}), destroy:()=>p.destroy().catch(()=>{}),
    title:()=>title, thumb:"" };
}

function makeFile(info, host, emit){
  return new Promise((res,rej)=>{
    const v=document.createElement("video"); v.playsInline=true; v.preload="auto"; v.controls=true;
    let tried=false; const url = info.blob ? URL.createObjectURL(info.blob) : info.url;
    if (!info.blob) v.crossOrigin="anonymous";
    v.addEventListener("playing",()=>emit("playing")); v.addEventListener("pause",()=>emit("paused"));
    v.addEventListener("waiting",()=>emit("paused")); v.addEventListener("ended",()=>emit("ended"));
    v.addEventListener("loadedmetadata",()=>res(api),{once:true});
    v.addEventListener("error",()=>{
      if (!info.blob && !tried){ tried=true; v.removeAttribute("crossorigin"); api.canExport=false; v.src=url; return; }
      const msg = info.blob ? "Dit videobestand kan je browser niet afspelen. Probeer een .mp4-bestand." : "Op deze link staat geen video die de browser kan afspelen. Gebruik een directe link naar een videobestand (eindigt meestal op .mp4), of download de video en upload hem hier.";
      emit("error",msg); rej(new Error(msg));
    });
    v.src=url; host.appendChild(v);
    const noSubs=()=>[...v.textTracks].forEach(t=>t.mode="disabled"); noSubs(); v.textTracks.addEventListener?.("addtrack",noSubs);
    const gain = { node:null };
    const api = { kind:"file", el:v, canExport:true, gain,
      play:()=>v.play().catch(()=>{}), pause:()=>v.pause(), seek:s=>{ v.currentTime=s; }, time:()=>v.currentTime,
      duration:()=>isFinite(v.duration)?v.duration:0, setVolume:x=>{ if (gain.node) gain.node.gain.value=x/100; else v.volume=x/100; },
      destroy:()=>{ v.pause(); v.removeAttribute("src"); v.load(); if (info.blob) URL.revokeObjectURL(url); },
      title:()=>info.name || decodeURIComponent((info.url||"").split("/").pop().split("?")[0]) || "Video", thumb:"" };
  });
}

const EMPTY_HTML = '<div class="orb"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg></div><b>Kies een video om te beginnen</b>Plak hierboven een link of upload een video.';
let loadSeq = 0;
async function loadSource(info, opts={}){
  if (!info) return showErr("Plak eerst een videolink.");
  if (S.mode !== "idle") stopEverything();
  hideErr(); hideInfo();
  if (info.kind==="bad") return showErr("Dit lijkt geen werkende videolink. Plak een YouTube-, Vimeo- of directe videolink, of upload een bestand.");
  if (info.kind==="blocked") return showErr(`${info.host} laat video's niet op andere sites afspelen. Download de video (bijvoorbeeld via de deelknop in de app) en upload hem hier met Upload video.`);
  if ((info.kind==="yt"||info.kind==="vimeo") && location.protocol==="file:") showInfo("Je hebt Stemmenstudio als bestand geopend. YouTube en Vimeo werken alleen via de online link. Eigen videobestanden werken wel gewoon.");
  const seq = ++loadSeq; // een nieuwere laadactie wint van een oudere die nog bezig is
  if (S.src){ S.src.destroy(); S.src=null; }
  const host=$("stage"); host.innerHTML="";
  $("empty").hidden=false; $("empty").firstElementChild.innerHTML='<div class="orb loading"></div><b>Video laden…</b>';
  refreshButtons();
  const emit=(st,msg)=>{ if (seq===loadSeq) onState(st,msg); };
  let src;
  try {
    src = await (info.kind==="yt" ? makeYouTube(info,host,emit) : info.kind==="vimeo" ? makeVimeo(info,host,emit) : makeFile(info,host,emit));
  } catch(e){
    if (seq!==loadSeq) return;
    host.innerHTML=""; $("empty").firstElementChild.innerHTML=EMPTY_HTML;
    return showErr(e.message==="timeout"||e.message==="script" ? "De videospeler kon niet geladen worden. Controleer je internetverbinding." : e.message);
  }
  if (seq!==loadSeq){ src.destroy(); return; }
  S.src = src; $("empty").hidden=true;
  S.srcInfo = info; S.srcKey = keyOf(info);
  if (info.kind==="file" && info.blob && !opts.fromLib) DB.put("files",{id:S.srcKey,blob:info.blob,name:info.name});
  await waitDuration();
  if (seq!==loadSeq) return;
  const used = E.usedRanges(S.clips, S.srcKey);
  if (opts.start!=null) setClipStart(opts.start, opts.clipId);
  else if (info.t) setClipStart(info.t);
  else newClip(false);
  if (used.length && !opts.fromLib) showInfo(`Deze video hebben jullie al eerder gespeeld (${used.length} ${used.length===1?"clip":"clips"}, rood gearceerd). Er is automatisch een stuk gekozen dat nog niet gespeeld is.`);
  refreshButtons(); renderTakes(); renderLib();
}
function keyOf(i){ return i.kind==="yt"?"yt:"+i.id : i.kind==="vimeo"?"vimeo:"+i.id : i.blob?"file:"+i.name+":"+i.blob.size : "url:"+i.url; }
async function waitDuration(){ for (let i=0;i<TIMING.durationPolls && S.src && !(S.src.duration()>0);i++) await wait(TIMING.durationPoll); }
const dur = () => S.src?.duration() || 0;
const clipEnd = () => E.clipEnd(S.clipStart, CLIP, dur());
const clipKey = () => `${S.srcKey}@${S.clipStart}@${CLIP}`;
const isWatched = () => S.watched.has(clipKey()) || clipTakes().length > 0;

// ---------- Clipkiezer ----------
function setClipStart(s, clipId=null){
  S.clipStart = E.clampStart(s, CLIP, dur());
  S.clipId = clipId || E.findClip(S.clips, S.srcKey, S.clipStart)?.id || null;
  renderTrack(); renderTakes(); renderLib(); refreshButtons();
  if (S.src && S.mode==="idle") S.src.seek(S.clipStart);
}
function newClip(announce=true){
  const {start, allPlayed} = E.pickClip(Math.random, dur(), CLIP, E.usedRanges(S.clips, S.srcKey));
  if (allPlayed && dur() > CLIP) toast("Alle stukken van deze video zijn al gespeeld. Je krijgt een willekeurige clip.");
  setClipStart(start);
  if (announce){ sfx("tick"); if (!allPlayed) toast("Nieuwe clip: "+fmtS(S.clipStart)+" – "+fmtS(clipEnd())); }
}
function renderTrack(){
  const tr=$("track"), d=dur();
  tr.querySelectorAll(".used,.win,.head").forEach(n=>n.remove());
  $("durLbl").textContent = d ? fmtS(d) : "–";
  $("range").textContent = S.src ? `${fmtS(S.clipStart)} – ${fmtS(clipEnd())}` : "–";
  if (!d) return;
  for (const [a,b] of E.usedRanges(S.clips, S.srcKey)){ const u=document.createElement("div"); u.className="used"; u.style.left=(a/d*100)+"%"; u.style.width=(Math.min(b,d)-a)/d*100+"%"; u.title="Al gespeeld"; tr.appendChild(u); }
  const w=document.createElement("div"); w.className="win"; w.style.left=(S.clipStart/d*100)+"%"; w.style.width=((clipEnd()-S.clipStart)/d*100)+"%"; w.textContent = d>CLIP*2.5 ? fmtS(CLIP) : ""; tr.appendChild(w);
  const h=document.createElement("div"); h.className="head"; h.id="phead"; tr.appendChild(h);
}
(() => {
  const tr=$("track"); let drag=null;
  const at = e => { const r=tr.getBoundingClientRect(); return Math.max(0,Math.min(1,(e.clientX-r.left)/r.width))*dur(); };
  tr.addEventListener("pointerdown",e=>{
    if (!S.src || S.mode!=="idle" || !dur()) return;
    tr.setPointerCapture(e.pointerId); tr.classList.add("dragging");
    const t=at(e); const inside = t>=S.clipStart && t<=clipEnd();
    drag = {grab: inside ? t-S.clipStart : Math.min(CLIP,dur())/2};
    setClipStart(t-drag.grab);
  });
  tr.addEventListener("pointermove",e=>{ if (drag) setClipStart(at(e)-drag.grab); });
  const end=()=>{ if (drag){ drag=null; tr.classList.remove("dragging"); S.src?.seek(S.clipStart); } };
  tr.addEventListener("pointerup",end); tr.addEventListener("pointercancel",end);
  tr.addEventListener("keydown",e=>{ if (!S.src||S.mode!=="idle") return;
    if (e.key==="ArrowLeft"){ e.preventDefault(); setClipStart(S.clipStart-(e.shiftKey?30:5)); }
    if (e.key==="ArrowRight"){ e.preventDefault(); setClipStart(S.clipStart+(e.shiftKey?30:5)); } });
})();

// ---------- Audio en geluidseffecten ----------
function audioCtx(){
  if (!S.ctx){ S.ctx=new (window.AudioContext||window.webkitAudioContext)(); S.voiceGain=S.ctx.createGain(); S.voiceGain.connect(S.ctx.destination); }
  if (S.ctx.state==="suspended") S.ctx.resume();
  return S.ctx;
}
async function getMic(){
  if (S.stream && S.stream.getAudioTracks().some(t=>t.readyState==="live")) return S.stream;
  if (!navigator.mediaDevices?.getUserMedia) throw new Error(location.protocol==="http:"&&location.hostname!=="localhost" ? "De microfoon werkt alleen via een beveiligde (https) link." : "Deze browser kan geen microfoon gebruiken. Probeer Chrome, Edge, Safari of Firefox.");
  S.stream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
  const ctx=audioCtx(); S.analyser=ctx.createAnalyser(); S.analyser.fftSize=512; ctx.createMediaStreamSource(S.stream).connect(S.analyser);
  if (!S.meterOn){ S.meterOn=true; meterLoop(); }
  return S.stream;
}
function meterLoop(){
  const buf=new Uint8Array(512);
  const tick=()=>{ let peak=0; if (S.analyser){ S.analyser.getByteTimeDomainData(buf); for (const v of buf) peak=Math.max(peak,Math.abs(v-128)); }
    $("meter").style.width=(S.mode==="recording"||S.mode==="countdown"?Math.min(100,peak/90*100):0)+"%"; requestAnimationFrame(tick); };
  tick();
}
function tone(f,d=.12,v=.15,at=0){
  const ctx=audioCtx(),o=ctx.createOscillator(),g=ctx.createGain(), t=ctx.currentTime+at;
  o.frequency.value=f; g.gain.setValueAtTime(v,t); g.gain.exponentialRampToValueAtTime(.001,t+d); o.connect(g).connect(ctx.destination); o.start(t); o.stop(t+d);
}
// Alle geluidseffecten op één plek. Ze zijn uit te zetten in Instellingen.
const SFX = {
  tick:   ()=>tone(1200,.04,.06),
  count:  ()=>tone(660),
  go:     ()=>tone(990,.2),
  done:   ()=>{ tone(880,.1,.12); tone(660,.16,.12,.11); },
  score:  n=>{ for (let i=0;i<n;i++) tone(500+i*120,.08,.15,i*.09); },
  fanfare:()=>[523,659,784,1047].forEach((f,i)=>tone(f,i===3?.45:.14,.14,i*.13)),
  error:  ()=>{ tone(220,.12,.1); tone(180,.18,.1,.13); },
};
// Geluid pas na de volgende frame: eerst zie je de reactie, dan hoor je hem (audio opstarten kan even duren).
function sfx(name, arg){ if (!S.sound) return; requestAnimationFrame(()=>setTimeout(()=>{ try { SFX[name](arg); } catch {} },0)); }

// ---------- Status van de video ----------
function onState(st,msg){
  if (st==="error"){
    if (S.mode==="recording"||S.mode==="countdown") stopRecording();
    else if (S.mode==="playing") finishPlayback(false);
    showErr(msg); return;
  }
  if (S.mode==="recording"){
    if (st==="playing" && S.offset===null){ S.offset=(performance.now()-S.t0)/1000; S.recStart=S.src.time(); }
    if (st==="ended") stopRecording();
  }
  if (S.mode==="playing"){ if (st==="playing") startVoice(); else stopVoice(); if (st==="ended") finishPlayback(true); }
  if (S.mode==="preview" && st==="ended") stopPreview();
}

// ---------- Opnemen ----------
async function startRecording(){
  if (!S.src || S.mode!=="idle") return;
  const why = recordWhy();
  if (why){ nudgeHint(why); return; }
  hideErr(); closeRate();
  S.mode="arming"; refreshButtons(); // direct zichtbaar, en een tweede klik doet niets
  await nextFrame(); // eerst de reactie tekenen, dan pas de (soms trage) microfoon opstarten
  try { await getMic(); }
  catch(err){
    S.mode="idle"; refreshButtons(); sfx("error");
    showErr(err.name==="NotAllowedError" ? "Je browser geeft geen toegang tot de microfoon. Klik op het slotje of het camera-icoon in de adresbalk en sta de microfoon toe."
      : err.name==="NotFoundError" ? "Er is geen microfoon gevonden. Sluit er een aan of gebruik een ander apparaat."
      : (err.message||"De microfoon kon niet gestart worden."));
    return;
  }
  if (S.mode!=="arming") return; // intussen gestopt
  S.mode="countdown"; S.offset=null; S.chunks=[]; S.challenge=S.currentChallenge; S.recPlayerId=E.current(G).id;
  S.src.pause(); S.src.seek(S.clipStart);
  const mime=["audio/webm;codecs=opus","audio/webm","audio/mp4","audio/ogg"].find(m=>window.MediaRecorder?.isTypeSupported?.(m))||"";
  try { S.rec=new MediaRecorder(S.stream, mime?{mimeType:mime}:undefined); } catch { S.mode="idle"; refreshButtons(); showErr("Opnemen wordt niet ondersteund in deze browser."); return; }
  S.rec.ondataavailable=e=>{ if (e.data.size) S.chunks.push(e.data); };
  S.rec.onstop=saveTake; S.rec.start(); S.t0=performance.now();
  refreshButtons();
  for (const n of [3,2,1]){ if (S.mode!=="countdown") return; $("overlay").innerHTML=`<div class="count">${n}</div>`; sfx("count"); await wait(TIMING.countdownStep); }
  if (S.mode!=="countdown") return;
  $("overlay").innerHTML=""; sfx("go");
  S.mode="recording"; S.src.setVolume(+$("recVol").value); S.src.play(); refreshButtons();
}
function stopRecording(){
  if (S.mode==="arming"){ S.mode="idle"; refreshButtons(); return; }
  if (S.mode==="countdown"){ S.mode="idle"; $("overlay").innerHTML=""; S.rec.onstop=null; try{ S.rec.stop(); }catch{} refreshButtons(); return; }
  if (S.mode!=="recording") return;
  S.recEnd=Math.min(S.src.time(), clipEnd()); S.src.pause(); S.mode="idle"; try{ S.rec.stop(); }catch{} refreshButtons(); sfx("done");
}
async function saveTake(){
  const blob=new Blob(S.chunks,{type:S.rec.mimeType||"audio/webm"});
  if (S.offset===null) return showErr("De video is niet gaan spelen, dus er is geen take bewaard. Probeer het opnieuw.");
  let buffer; try { buffer=await audioCtx().decodeAudioData(await blob.arrayBuffer()); } catch { return showErr("De opname kon niet verwerkt worden. Probeer het nog een keer."); }
  const clip = await ensureClip(true);
  const p=G.players.find(x=>x.id===S.recPlayerId) || E.current(G);
  const take={ id:"t"+Date.now(), clipId:clip.id, who:p.name, playerId:p.id, blob, offset:S.offset, start:S.recStart,
    end:Math.max(S.recEnd,S.recStart+.5), challenge:S.challenge, score:null, created:Date.now() };
  S.takes.push(take);
  const saved = await DB.put("takes",take);
  if (saved && navigator.storage?.persist) navigator.storage.persist().catch(()=>{}); // vraag de browser de takes niet zomaar op te ruimen
  take.buffer=buffer;
  renderTakes(); renderLib(); renderTrack();
  playTake(take,{rate:true});
}
async function ensureClip(played){
  let c = S.clips.find(x=>x.id===S.clipId) || E.findClip(S.clips, S.srcKey, S.clipStart);
  if (!c){
    c={ id:"c"+Date.now(), srcKey:S.srcKey, info:storableInfo(), title:S.src.title(), start:S.clipStart, len:clipEnd()-S.clipStart, played:false, created:Date.now(), thumb:S.src.thumb||grabThumb() };
    S.clips.push(c);
  }
  if (played && !c.played){ c.played=true; c.playedAt=Date.now(); }
  S.clipId=c.id; await DB.put("clips",c); return c;
}
function storableInfo(){ const i=S.srcInfo; return i.kind==="file"&&i.blob ? {kind:"file",fileKey:S.srcKey,name:i.name} : {...i}; }
function grabThumb(){
  try { const v=S.src.el; if (!v||!v.videoWidth) return ""; const c=document.createElement("canvas"); c.width=320; c.height=180;
    const g=c.getContext("2d"); g.fillStyle="#000"; g.fillRect(0,0,320,180); const r=Math.min(320/v.videoWidth,180/v.videoHeight);
    g.drawImage(v,(320-v.videoWidth*r)/2,(180-v.videoHeight*r)/2,v.videoWidth*r,v.videoHeight*r); return c.toDataURL("image/jpeg",.7); } catch { return ""; }
}

// ---------- Bekijken en afspelen ----------
function startPreview(){
  if (!S.src||S.mode!=="idle") return;
  hideErr(); closeRate(); S.mode="preview"; S.watched.add(clipKey());
  S.src.setVolume(100); S.src.seek(S.clipStart); S.src.play(); refreshButtons();
}
function stopPreview(){ if (S.mode!=="preview") return; S.src.pause(); S.mode="idle"; S.src.seek(S.clipStart); refreshButtons(); }

async function decoded(t){ if (!t.buffer) t.buffer=await audioCtx().decodeAudioData(await t.blob.arrayBuffer()); return t.buffer; }
async function playTake(take,{rate=false,queue=null}={}){
  if (!S.src || S.mode!=="idle") return;
  hideErr(); closeRate(); audioCtx();
  try { await decoded(take); } catch { return showErr("Deze opname kan niet meer afgespeeld worden."); }
  if (S.mode!=="idle") return;
  S.playing=take; take.rateAfter=rate; S.queue=queue||[]; S.mode="playing"; S.drift=[];
  S.voiceGain.gain.value=+$("voiceVol").value/100;
  S.src.setVolume(0); /* terugkijken en exporteren: alleen jouw stem, nooit het geluid van de originele video */
  S.src.seek(take.start); S.src.play();
  refreshButtons(); renderTakes();
}
function startVoice(){
  stopVoice(); const t=S.playing; if (!t?.buffer) return;
  const pos=E.voicePos(t, S.src.time()); if (pos>=t.buffer.duration) return;
  const n=S.ctx.createBufferSource(); n.buffer=t.buffer; n.connect(S.voiceGain);
  const now=S.ctx.currentTime;
  if (pos<0) n.start(now-pos,0); else n.start(now,pos);
  S.voiceSrc=n; S.voiceAt={ctx:now, pos}; S.lastResync=performance.now();
}
function stopVoice(){ if (S.voiceSrc){ try{S.voiceSrc.stop();}catch{} S.voiceSrc.disconnect(); S.voiceSrc=null; S.voiceAt=null; } }
// Houdt stem en beeld gelijk: meet de afwijking en lijn de stem opnieuw uit als die te groot wordt.
function checkSync(){
  if (S.mode!=="playing" || !S.voiceAt || !S.playing) return;
  const expected=E.voicePos(S.playing, S.src.time()), actual=S.voiceAt.pos+(S.ctx.currentTime-S.voiceAt.ctx);
  if (expected<0 || actual<0) return;
  const drift=actual-expected; S.drift.push(drift);
  if (Math.abs(drift)>TIMING.resyncTolerance && performance.now()-S.lastResync>TIMING.resyncEvery) startVoice();
}
function finishPlayback(natural){
  if (S.mode!=="playing") return;
  const t=S.playing; stopVoice(); S.src.pause(); S.mode="idle"; S.playing=null;
  if (S.exporting) endExport(natural);
  refreshButtons(); renderTakes();
  if (natural && S.queue.length){ const next=S.queue.shift(); const q=S.queue; setTimeout(()=>playTake(next,{queue:q}),TIMING.nextTakeGap); return; }
  S.queue=[];
  if (natural && t?.rateAfter) openRate(t);
  if (S.src) S.src.seek(S.clipStart);
}

// ---------- Exporteren als video (alleen eigen bestanden en directe links) ----------
async function exportTake(take){
  if (!S.src?.canExport || S.mode!=="idle") return;
  const v=S.src.el, ctx=audioCtx();
  if (!S.src.gain.node){ try { const n=ctx.createMediaElementSource(v); S.src.gain.node=ctx.createGain(); n.connect(S.src.gain.node).connect(ctx.destination); } catch { return showErr("Deze video kan niet geëxporteerd worden."); } }
  const W=1280,H=720, c=document.createElement("canvas"); c.width=W; c.height=H; const g=c.getContext("2d");
  const dest=ctx.createMediaStreamDestination(); S.src.gain.node.connect(dest); S.voiceGain.connect(dest);
  const stream=new MediaStream([...c.captureStream(30).getVideoTracks(),...dest.stream.getAudioTracks()]);
  const mime=["video/webm;codecs=vp9,opus","video/webm;codecs=vp8,opus","video/webm","video/mp4"].find(m=>MediaRecorder.isTypeSupported(m))||"";
  const rec=new MediaRecorder(stream,mime?{mimeType:mime,videoBitsPerSecond:4e6}:undefined); const chunks=[];
  rec.ondataavailable=e=>e.data.size&&chunks.push(e.data);
  let raf; const draw=()=>{ g.fillStyle="#000"; g.fillRect(0,0,W,H);
    if (v.videoWidth){ const r=Math.min(W/v.videoWidth,H/v.videoHeight); g.drawImage(v,(W-v.videoWidth*r)/2,(H-v.videoHeight*r)/2,v.videoWidth*r,v.videoHeight*r); }
    g.font="600 22px sans-serif"; g.fillStyle="rgba(255,255,255,.8)"; g.fillText("Stemmenstudio · "+take.who,24,H-24); raf=requestAnimationFrame(draw); };
  S.exporting={rec,chunks,dest,take,stop:()=>cancelAnimationFrame(raf)};
  rec.onstop=()=>{
    S.src?.gain.node?.disconnect(dest); S.voiceGain.disconnect(dest); S.voiceGain.connect(ctx.destination);
    const ok=S.exporting?.ok; S.exporting=null; refreshButtons();
    if (!ok) return toast("Export gestopt.");
    const b=new Blob(chunks,{type:rec.mimeType||"video/webm"});
    download(b,`stemmenstudio-${slug(take.who)}-${fmtS(take.start).replace(":","m")}.${b.type.includes("mp4")?"mp4":"webm"}`);
    toast("Video met jouw stem is gedownload.");
  };
  draw(); rec.start(); toast("Video wordt gemaakt. Laat de clip uitspelen.");
  playTake(take);
}
function endExport(natural){ const e=S.exporting; if (!e) return; e.ok=natural; e.stop(); try{ e.rec.stop(); }catch{} }

// ---------- Punten ----------
function openRate(t){
  S.rateTake=t; $("rateQ").textContent=`Hoe grappig was de take van ${t.who}? (toets 1 t/m 5)`; $("faces").innerHTML="";
  FACES.forEach(([f,n])=>{ const b=document.createElement("button"); b.type="button"; b.innerHTML=`${f}<small>${n}</small>`; b.setAttribute("aria-label",n+" punten"); b.onclick=()=>rate(t,+n); $("faces").appendChild(b); });
  $("rate").hidden=false; refreshButtons();
  $("rate").scrollIntoView({block:"nearest",behavior:reduceMotion()?"auto":"smooth"});
  $("faces").firstElementChild?.focus({preventScroll:true});
}
function closeRate(){ if ($("rate").hidden && !S.rateTake) return; $("rate").hidden=true; S.rateTake=null; refreshButtons(); }
function rate(t,n){
  if (S.rateTake!==t) return; // dubbele klik: het puntenpaneel is al dicht
  const prev = t.score ?? null;
  closeRate();
  if (dispatch({type:"rate", playerId:t.playerId, score:n, prev})) return;
  t.score=n; DB.put("takes",stripTake(t));
  sfx("score",n); bump(document.querySelector(`.player[data-id="${CSS.escape(t.playerId)}"]`));
  if (n>=BIG_SCORE) confetti(n===R.scoreMax?60:30);
  renderTakes();
}
const stripTake = t => { const {buffer,rateAfter,...r}=t; return r; };

// ---------- Spelers en partij ----------
const SEEN=new Set(); // alleen nieuwe items krijgen een binnenkomst-animatie
function enter(el,key){ if (!SEEN.has(key)){ SEEN.add(key); el.classList.add("enter"); } }
function renderPlayerList(box, {inGame}){
  box.innerHTML=""; const ranks=E.standings(G).list; const best=ranks[0]?.pts||0;
  const locked = inGame && BUSY.has(S.mode);
  G.players.forEach((p,i)=>{
    const on = inGame && i===G.turn && !G.done;
    const d=document.createElement("div"); d.className="player"+(on?" active":"")+(locked?" locked":""); d.dataset.id=p.id; d.setAttribute("role","listitem");
    d.innerHTML=`<button type="button" class="nm"></button>${on?'<span class="turn">aan de beurt</span>':""}${inGame?`<span class="pts">${p.pts>0&&p.pts===best?"👑 ":""}${p.pts}</span>`:""}`;
    const nm=d.querySelector(".nm"); nm.textContent=p.name;
    if (inGame && !G.done){ nm.setAttribute("aria-label",`${p.name}, ${p.pts} punten. Zet aan de beurt`); nm.title="Zet deze speler aan de beurt"; nm.onclick=()=>{ if (!BUSY.has(S.mode)) dispatch({type:"setTurn",index:i}); }; }
    else if (inGame){ nm.disabled=true; nm.setAttribute("aria-label",`${p.name}, ${p.pts} punten`); }
    else { nm.title="Naam wijzigen"; nm.setAttribute("aria-label",`${p.name}. Naam wijzigen`); nm.onclick=()=>renamePrompt(p); }
    if (G.players.length>1){ const x=document.createElement("button"); x.className="x"; x.type="button"; x.textContent="✕"; x.setAttribute("aria-label","Verwijder "+p.name);
      x.onclick=ev=>{ ev.stopPropagation(); if (inGame && BUSY.has(S.mode)) return; dispatch({type:"removePlayer",id:p.id}); renderStart(); }; d.appendChild(x); }
    enter(d,(inGame?"p:":"sp:")+p.id); box.appendChild(d);
  });
}
function renamePrompt(p){ const n=prompt("Nieuwe naam voor "+p.name, p.name); if (n!=null){ dispatch({type:"renamePlayer",id:p.id,name:n}); renderStart(); } }
function renderGame(){
  renderPlayerList($("players"), {inGame:true});
  $("roundLbl").textContent = G.done ? "Afgelopen" : G.rounds ? `Ronde ${G.round} van ${G.rounds}` : `Ronde ${G.round} · vrij spelen`;
  const nt=$("nowTurn"); nt.classList.toggle("over",G.done);
  nt.firstElementChild.textContent = G.done ? "Partij afgelopen" : "Aan de beurt";
  $("turnName").textContent = G.done ? E.standings(G).winners.map(w=>w.name).join(" & ")+(E.standings(G).tie?" (gelijk)":" wint") : E.current(G).name;
  $("endGameBtn").textContent = G.done ? "🏆 Uitslag" : "🏁 Partij afronden";
  const mb=$("mobibar"); mb.innerHTML="";
  const head=document.createElement("span"); head.innerHTML = G.done ? "🏁 <b>Afgelopen</b>" : "🎤 <b></b> aan de beurt"; if (!G.done) head.querySelector("b").textContent=E.current(G).name;
  const rnd=document.createElement("span"); rnd.className="sc"; rnd.textContent = G.rounds ? `ronde ${G.round}/${G.rounds}` : `ronde ${G.round}`;
  const sc=document.createElement("span"); sc.className="sc"; sc.textContent=G.players.map(p=>`${p.name} ${p.pts}`).join(" · ");
  mb.append(head,rnd,sc);
  refreshButtons();
}
function addPlayer(input, why){
  const n=input.value; const res=dispatch({type:"addPlayer", id:"p"+Date.now()+Math.floor(Math.random()*1e3), name:n},{quiet:true});
  if (why) why.textContent=res; else if (res) toast(res);
  if (!res){ input.value=""; renderStart(); }
  input.focus();
}

// ---------- Dialogen: start, uitslag, instellingen, uitleg ----------
function seg(box, options, value, label, onPick){
  box.innerHTML=""; box.setAttribute("role","group");
  for (const o of options){ const b=document.createElement("button"); b.type="button"; b.textContent=label(o); b.classList.toggle("on",o===value); b.setAttribute("aria-pressed",o===value);
    b.onclick=()=>onPick(o); box.appendChild(b); }
}
let startRounds = R.defaultRounds;
const roundLabel = r => r ? `${r} ${r===1?"ronde":"rondes"}` : "Vrij spelen";
function renderStart(){
  if (!$("startDlg").open) return;
  renderPlayerList($("startPlayers"), {inGame:false});
  seg($("roundSeg"), R.roundOptions, startRounds, roundLabel, r=>{ startRounds=r; renderStart(); });
  seg($("lenSeg"), R.clipLengths, CLIP, fmtS, l=>{ setClipLen(l); renderStart(); });
}
function openStart(){
  if (BUSY.has(S.mode)) stopEverything();
  closeDialogs(); startRounds = G.rounds || R.defaultRounds; $("startWhy").textContent="";
  $("startDlg").showModal(); renderStart();
}
function showResults(){
  if (!G.done) return;
  closeDialogs();
  const st=E.standings(G); const ol=$("podium"); ol.innerHTML="";
  $("resultTitle").textContent = st.tie ? `Gelijkspel: ${st.winners.map(w=>w.name).join(" & ")}!` : `${st.winners[0].name} wint!`;
  for (const p of st.list){ const li=document.createElement("li"); li.className=p.rank===1?"win":"";
    li.innerHTML=`<span class="pl">${p.rank===1?"🥇":p.rank===2?"🥈":p.rank===3?"🥉":p.rank+"."}</span><span class="nm"></span><span class="pts">${p.pts} ${p.pts===1?"punt":"punten"}</span>`;
    li.querySelector(".nm").textContent=p.name; ol.appendChild(li); }
  $("resultDlg").showModal(); sfx("fanfare"); confetti(90);
}
function openSettings(){
  closeDialogs(); $("soundOn").checked=S.sound; renderSettings(); $("setDlg").showModal();
}
function renderSettings(){
  seg($("setRoundSeg"), R.roundOptions, G.rounds, roundLabel, r=>{ dispatch({type:"setRounds",rounds:r}); renderSettings(); });
  seg($("setLenSeg"), R.clipLengths, CLIP, fmtS, l=>{ setClipLen(l); renderSettings(); });
}
function openHelp(){ closeDialogs(); $("helpDlg").showModal(); }
function closeDialogs(){ document.querySelectorAll("dialog[open]").forEach(d=>d.close()); }

$("startAdd").onclick=()=>addPlayer($("startName"),$("startWhy"));
$("startName").addEventListener("keydown",e=>{ if (e.key==="Enter"){ e.preventDefault(); addPlayer($("startName"),$("startWhy")); } });
$("startGo").onclick=e=>{
  e.preventDefault();
  dispatch({type:"newGame", rounds:startRounds});
  // nieuwe partij: nog niets gespeeld, dus ook geen uitslag
  $("startDlg").close(); closeRate(); renderTakes();
  toast(`🎤 ${E.current(G).name} begint!${G.rounds?` ${roundLabel(G.rounds)}.`:""}`); bump($("nowTurn"));
};
$("resultDlg").addEventListener("close",()=>{ if ($("resultDlg").returnValue==="again") openStart(); });
$("helpDlg").addEventListener("close",()=>{ const first=!LS.get(KEYS.help,false); LS.set(KEYS.help,true); if (first && !S.resumed) openStart(); });
$("soundOn").onchange=()=>{ S.sound=$("soundOn").checked; LS.set(KEYS.sound,S.sound); if (S.sound) sfx("tick"); };
$("replayHelp").onclick=openHelp;
$("helpBtn").onclick=openHelp; $("setBtn").onclick=openSettings;
$("newGameBtn").onclick=openStart;
$("endGameBtn").onclick=()=>{
  if (G.done) return showResults();
  const b=$("endGameBtn");
  if (b.dataset.sure!=="1"){ b.dataset.sure="1"; b.textContent="Zeker? Klik nog eens"; setTimeout(()=>{ b.dataset.sure=""; renderGame(); },TIMING.deleteConfirm); return; }
  b.dataset.sure=""; if (BUSY.has(S.mode)) stopEverything(); dispatch({type:"endGame"});
};
$("resetScores").onclick=()=>{ dispatch({type:"resetScores"}); S.takes.forEach(t=>{ if (t.score!=null){ t.score=null; DB.put("takes",stripTake(t)); } }); renderTakes(); toast("Alle scores staan weer op nul."); };

// ---------- Takes en bibliotheek ----------
function clipTakes(){ return S.takes.filter(t=>t.clipId===S.clipId && S.clipId).sort((a,b)=>b.created-a.created); }
function renderTakes(){
  const box=$("takes"), list=S.src?clipTakes():[];
  $("takeCount").textContent=list.length; $("showAll").hidden=list.length<2;
  if (!list.length){ box.innerHTML=`<p class="none-yet">${S.src?"Nog geen takes voor deze clip.":"Laad eerst een video."}</p>`; refreshButtons(); return; }
  box.innerHTML="";
  list.forEach((t,i)=>{
    const d=document.createElement("div"); d.className="take"+(S.playing===t?" now":"");
    d.innerHTML=`<div class="top"><span class="t"></span><span class="meta">${new Date(t.created).toLocaleTimeString("nl-NL",{hour:"2-digit",minute:"2-digit"})} · ${fmtS(t.end-t.start)}</span></div>
      ${t.challenge?'<div class="ch"></div>':""}
      <div class="row"><button class="play" type="button">▶ Opnieuw afspelen</button><button type="button" class="rt">${t.score?FACES[t.score-1][0]+" "+t.score+" punten":"Punten geven"}</button>
      ${S.src?.canExport?'<button type="button" class="ex">🎬 Download video</button>':""}<button type="button" class="dl">⬇ Stem</button><button type="button" class="del" aria-label="Verwijder take">🗑</button></div>`;
    d.querySelector(".t").textContent=`Take ${list.length-i} · ${t.who}`;
    if (t.challenge) d.querySelector(".ch").textContent="🎲 "+t.challenge;
    const busy=BUSY.has(S.mode)||!!S.exporting;
    d.querySelectorAll("button").forEach(b=>{ if (!b.classList.contains("dl")) b.disabled=busy; });
    d.querySelector(".play").onclick=()=>playTake(t,{rate:t.score==null});
    d.querySelector(".rt").onclick=()=>openRate(t);
    d.querySelector(".ex")?.addEventListener("click",()=>exportTake(t));
    d.querySelector(".dl").onclick=()=>download(t.blob,`stemmenstudio-stem-${slug(t.who)}.${t.blob.type.includes("mp4")?"m4a":t.blob.type.includes("ogg")?"ogg":"webm"}`);
    const del=d.querySelector(".del");
    del.onclick=()=>{
      if (del.dataset.sure!=="1"){ del.dataset.sure="1"; del.textContent="Zeker?"; setTimeout(()=>{ del.dataset.sure=""; del.textContent="🗑"; },TIMING.deleteConfirm); return; }
      if (S.playing===t) finishPlayback(false);
      if (S.rateTake===t) closeRate();
      if (t.score) dispatch({type:"unrate", playerId:t.playerId, score:t.score});
      S.takes=S.takes.filter(x=>x!==t); DB.del("takes",t.id); renderTakes(); renderLib();
    };
    enter(d,"t:"+t.id); box.appendChild(d);
  });
  refreshButtons();
}
function renderLib(){
  const box=$("lib"); const cl=[...S.clips].sort((a,b)=>(b.playedAt||b.created)-(a.playedAt||a.created));
  if (!cl.length){ box.innerHTML='<p class="none-yet">Nog niets bewaard. Elke clip waarop je inspreekt komt hier te staan, met al zijn takes.</p>'; return; }
  box.innerHTML="";
  for (const c of cl){
    const n=S.takes.filter(t=>t.clipId===c.id).length;
    const b=document.createElement("button"); b.type="button"; b.className="clip"+(c.id===S.clipId&&S.srcKey===c.srcKey?" cur":"");
    b.innerHTML=`<div class="th">${c.played?'<span class="badge">GESPEELD</span>':""}<span class="len">${fmtS(c.start)}–${fmtS(c.start+c.len)}</span></div><div class="bd"><span class="nm"></span><span class="sub">${n} ${n===1?"take":"takes"}${c.playedAt?" · "+new Date(c.playedAt).toLocaleDateString("nl-NL",{day:"numeric",month:"short"}):""}</span></div>`;
    if (c.thumb) b.querySelector(".th").style.backgroundImage=`url("${c.thumb}")`;
    b.querySelector(".nm").textContent=c.title||"Clip";
    b.disabled=BUSY.has(S.mode);
    b.onclick=()=>openClip(c);
    enter(b,"c:"+c.id); box.appendChild(b);
  }
}
async function openClip(c){
  if (S.mode!=="idle") return;
  if (c.len && c.len!==CLIP && R.clipLengths.includes(Math.round(c.len))) setClipLen(Math.round(c.len), true);
  if (c.srcKey===S.srcKey && S.src){ setClipStart(c.start,c.id); window.scrollTo({top:0,behavior:reduceMotion()?"auto":"smooth"}); return; }
  let info=c.info;
  if (info.kind==="file"){ const f=await DB.get("files",info.fileKey); if (!f) return showErr("Het videobestand van deze clip is niet meer bewaard. Upload de video opnieuw."); info={kind:"file",blob:f.blob,name:f.name}; }
  window.scrollTo({top:0,behavior:reduceMotion()?"auto":"smooth"});
  await loadSource(info,{start:c.start,clipId:c.id,fromLib:true});
}
function setClipLen(l, silent=false){
  if (S.mode!=="idle" || !R.clipLengths.includes(l)) return;
  CLIP=l; LS.set(KEYS.len,CLIP);
  S.clipId=null; if (S.src) setClipStart(S.clipStart); renderLens(); refreshButtons();
  if (!silent) toast("Clips duren nu "+fmtS(CLIP)+" minuten.");
}

// ---------- Knoppen, hints en weergave ----------
const recCtx = () => ({ hasSource:!!S.src, watched:isWatched(), mode:S.mode, done:G.done, exporting:!!S.exporting });
const recordWhy = () => E.recordBlock(recCtx());
function nextStep(){
  const who=E.current(G).name;
  if (G.done) return "🏁 De partij is afgelopen. Bekijk de uitslag of start een nieuwe partij.";
  switch (S.mode){
    case "arming": return "🎙️ Microfoon aanzetten…";
    case "countdown": return `🎙️ ${who}, maak je klaar…`;
    case "recording": return `🔴 ${who} neemt op. Druk op Stop opname (of spatie) om te stoppen.`;
    case "preview": return "👀 Kijk goed: waar ga je zo overheen praten?";
    case "playing": return S.exporting ? "🎬 De video wordt gemaakt. Laat de clip uitspelen." : "▶ Terugkijken…";
  }
  if (!S.src) return `👉 ${who} is aan de beurt. Plak eerst een videolink of upload een video.`;
  if (S.rateTake) return `😂 Geef ${S.rateTake.who} punten: hoe grappig was het? (1 t/m 5)`;
  const why=recordWhy();
  if (why) return `👉 ${who}: ${why}`;
  return `👉 ${who}: druk op Opnemen (of de spatiebalk) en praat over de clip heen.`;
}
// Laat even zien waarom iets niet kan; daarna toont de hint weer de volgende stap.
let hintHold=0;
function nudgeHint(msg){ const h=$("hint"); h.textContent="👉 "+msg; h.classList.remove("attn"); void h.offsetWidth; h.classList.add("attn"); sfx("error");
  hintHold=performance.now()+TIMING.toast; setTimeout(()=>{ h.classList.remove("attn"); refreshButtons(); },TIMING.toast); }
function refreshButtons(){
  const m=S.mode, rec=m==="recording"||m==="countdown", busy=BUSY.has(m);
  const why = recordWhy();
  const rb=$("recBtn");
  rb.disabled = !S.src || m==="playing" || m==="preview" || m==="arming" || !!S.exporting || (!rec && G.done);
  rb.classList.toggle("blocked", !rec && !!why && !rb.disabled);
  rb.title = rec ? "Stop de opname (spatie)" : why || "Opnemen (spatie)";
  rb.classList.toggle("stop",rec); $("recLabel").textContent = m==="arming" ? "Even geduld…" : rec ? "Stop opname" : "Opnemen";
  $("playLast").disabled=busy||!S.src||!clipTakes().length;
  $("stopBtn").disabled=!busy||m==="arming";
  for (const id of ["randClip","preview","saveClip"]) $(id).disabled=!S.src||busy;
  $("preview").classList.toggle("btn-cue", !!S.src && !isWatched());
  $("showAll").disabled=busy;
  $("pname").disabled=busy; $("newGameBtn").disabled=rec||m==="arming"; $("endGameBtn").disabled=rec||m==="arming";
  $("lamp").classList.toggle("on",m==="recording");
  $("screen").classList.toggle("rec",rec); $("screen").classList.toggle("play",m==="playing"||m==="preview");
  $("tag").hidden=!(m==="recording"||m==="playing"||m==="preview");
  $("tag").textContent=S.exporting?"⏺ VIDEO MAKEN":m==="playing"?"▶ TERUGKIJKEN":m==="preview"?"👀 VOORBEELD":"● OPNAME";
  $("tag").classList.toggle("play",m!=="recording");
  $("remain").hidden=!(rec||m==="playing"||m==="preview");
  $("tc").classList.toggle("live",m==="recording");
  $("track").style.opacity=busy?.6:1; renderLens();
  if (S.src?.el) S.src.el.controls=!busy;
  $("players").querySelectorAll(".player").forEach(p=>p.classList.toggle("locked",busy));
  $("lib").querySelectorAll(".clip").forEach(b=>{ b.disabled=busy; });
  if (performance.now()>=hintHold){ const txt=nextStep(); if ($("hint").textContent!==txt) $("hint").textContent=txt; }
}
function rollDice(){
  if (BUSY.has(S.mode)) return;
  const c=E.pickChallenge(Math.random, S.currentChallenge);
  S.currentChallenge=c; const el=$("challenge"); el.classList.remove("none","flip"); el.textContent=c; void el.offsetWidth; el.classList.add("flip");
  $("dice").classList.remove("roll"); void $("dice").offsetWidth; $("dice").classList.add("roll"); sfx("tick");
}
function resetChallenge(){ const el=$("challenge"); el.className="challenge none"; el.textContent="Dobbel voor een gekke opdracht, of spreek gewoon vrij in."; }
function stopEverything(){ if (S.mode==="playing") finishPlayback(false); else if (S.mode==="preview") stopPreview(); else stopRecording(); S.queue=[]; }

// ---------- Invoer ----------
$("urlForm").addEventListener("submit",e=>{ e.preventDefault(); const i=parseSource($("url").value); $("url").blur(); loadSource(i); });
$("pickFile").onclick=()=>$("file").click();
$("file").onchange=()=>{ const f=$("file").files[0]; if (f) loadSource({kind:"file",blob:f,name:f.name}); $("file").value=""; };
const srcBox=$("source");
["dragenter","dragover"].forEach(ev=>srcBox.addEventListener(ev,e=>{ e.preventDefault(); srcBox.classList.add("drag"); }));
["dragleave","drop"].forEach(ev=>srcBox.addEventListener(ev,()=>srcBox.classList.remove("drag")));
srcBox.addEventListener("drop",e=>{ e.preventDefault(); const f=[...e.dataTransfer.files].find(f=>f.type.startsWith("video/")||/\.(mp4|webm|mov|m4v|mkv|ogv)$/i.test(f.name));
  if (f) loadSource({kind:"file",blob:f,name:f.name}); else { const t=e.dataTransfer.getData("text/uri-list")||e.dataTransfer.getData("text"); if (t){ $("url").value=t; loadSource(parseSource(t)); } else showErr("Sleep een videobestand of een videolink hierheen."); } });
document.addEventListener("paste",e=>{ if (e.target.closest("input")||document.querySelector("dialog[open]")) return; const t=e.clipboardData?.getData("text"); if (t&&/^https?:\/\//.test(t.trim())){ $("url").value=t.trim(); loadSource(parseSource(t)); } });

$("recBtn").onclick=()=>{
  const now=performance.now(); if (now-(S.recClickAt||0)<TIMING.doubleClick) return; S.recClickAt=now;
  (S.mode==="recording"||S.mode==="countdown") ? stopRecording() : startRecording();
};
$("stopBtn").onclick=stopEverything;
$("playLast").onclick=()=>{ const t=clipTakes()[0]; if (t) playTake(t,{rate:t.score==null}); };
$("showAll").onclick=()=>{ const l=clipTakes().reverse(); if (l.length) playTake(l[0],{queue:l.slice(1)}); };
$("randClip").onclick=()=>newClip(true);
$("preview").onclick=startPreview;
$("saveClip").onclick=async()=>{ await ensureClip(false); renderLib(); toast("Clip bewaard onder Bewaarde clips."); };
$("dice").onclick=rollDice;
function renderLens(){ document.querySelectorAll("#lens button").forEach(b=>{ const on=+b.dataset.len===CLIP; b.classList.toggle("on",on); b.setAttribute("aria-pressed",on); b.disabled=S.mode!=="idle"; }); }
document.querySelectorAll("#lens button").forEach(b=>b.onclick=()=>setClipLen(+b.dataset.len));
[["recVol","v1"],["voiceVol","v3"]].forEach(([i,o])=>{ $(i).value=LS.get(KEYS[i],$(i).value); $(o).textContent=$(i).value+"%";
  $(i).oninput=()=>{ $(o).textContent=$(i).value+"%"; LS.set(KEYS[i],$(i).value);
    if (i==="recVol"&&S.mode==="recording") S.src.setVolume(+$(i).value);
    if (i==="voiceVol"&&S.voiceGain) S.voiceGain.gain.value=+$(i).value/100; }; });
$("addPlayer").addEventListener("submit",e=>{ e.preventDefault(); if (!BUSY.has(S.mode)) addPlayer($("pname")); });
document.addEventListener("keydown",e=>{
  if (e.target.closest("input,textarea,select")||e.metaKey||e.ctrlKey||e.altKey||document.querySelector("dialog[open]")) return;
  const k=e.key.toLowerCase();
  if (e.code==="Space"){ if (e.target.closest("button:not(#recBtn)")) return; e.preventDefault(); if (e.repeat) return;
    if (S.mode==="playing"||S.mode==="preview") stopEverything(); else if (!$("recBtn").disabled) $("recBtn").click(); }
  else if (k==="w"&&!$("preview").disabled) $("preview").click();
  else if (k==="p"&&!$("playLast").disabled) $("playLast").click();
  else if (k==="n"&&!$("randClip").disabled) $("randClip").click();
  else if (k==="d") rollDice();
  else if (k>="1"&&k<="5"&&S.rateTake) rate(S.rateTake,+k);
  else if (k==="escape"&&BUSY.has(S.mode)) stopEverything();
});
// Tab sluiten of herladen tijdens een opname: eerst waarschuwen.
window.addEventListener("beforeunload",e=>{ if (S.mode==="recording"||S.mode==="countdown"||S.exporting){ e.preventDefault(); e.returnValue=""; } });
// Naar een andere app of tab tijdens het opnemen: netjes stoppen, dan blijft de take bewaard.
document.addEventListener("visibilitychange",()=>{ if (document.hidden && (S.mode==="recording"||S.mode==="countdown"||S.mode==="arming")) stopRecording(); });

setInterval(()=>{
  if (!S.src) return; const now=S.src.time(), d=dur(); let rel=0, len=clipEnd()-S.clipStart;
  if (S.mode==="recording"){ rel=S.offset===null?0:now-S.recStart; if (now>=clipEnd()-TIMING.recEndSlack) stopRecording(); }
  else if (S.mode==="playing"&&S.playing){ rel=now-S.playing.start; len=S.playing.end-S.playing.start; checkSync(); if (now>=S.playing.end+TIMING.playEndSlack) finishPlayback(true); }
  else if (S.mode==="preview"){ rel=now-S.clipStart; if (now>=clipEnd()) stopPreview(); }
  else rel=now-S.clipStart;
  rel=Math.max(0,Math.min(rel,len));
  $("tc").textContent=fmt(rel)+" / "+fmtS(len);
  $("remain").textContent=fmtS(Math.ceil(len-rel));
  $("prog").style.width=(S.mode==="idle"||S.mode==="countdown"||S.mode==="arming"?0:rel/len*100)+"%";
  const h=$("phead"); if (h&&d) h.style.left=(now/d*100)+"%";
},TIMING.tick);

// ---------- Feedback-effecten ----------
function bump(el){ if (!el) return; el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); }
function confetti(n){
  if (reduceMotion()) return;
  const box=$("confetti"), colors=["#2f86ff","#5fb2ff","#ff4d61","#20c08a","#ffc83d","#ffffff"];
  for (let i=0;i<n;i++){ const c=document.createElement("i");
    c.style.left=Math.random()*100+"%"; c.style.background=colors[i%colors.length];
    c.style.setProperty("--dx",(Math.random()*160-80)+"px"); c.style.setProperty("--r",(Math.random()*720-360)+"deg");
    c.style.animationDelay=Math.random()*.25+"s"; box.appendChild(c); }
  setTimeout(()=>{ box.innerHTML=""; },TIMING.confetti+300);
}

// ---------- Hulpjes ----------
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
function nextFrame(){ return new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0))); }
function fmt(s){ const m=Math.floor(s/60),r=s-m*60; return m+":"+r.toFixed(1).padStart(4,"0"); }
function fmtS(s){ s=Math.max(0,Math.round(s)); const h=Math.floor(s/3600), m=Math.floor(s%3600/60), r=s%60; return (h?h+":"+String(m).padStart(2,"0"):m)+":"+String(r).padStart(2,"0"); }
function slug(s){ return (s||"take").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"take"; }
function download(blob,name){ const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),10000); }
function showErr(m){ const el=$("err"); el.textContent=m; el.hidden=false; el.classList.remove("shake"); void el.offsetWidth; el.classList.add("shake"); }
function hideErr(){ $("err").hidden=true; }
function showInfo(m){ $("info").textContent=m; $("info").hidden=false; }
function hideInfo(){ $("info").hidden=true; }
let tt; function toast(m){ const t=$("toast"); t.textContent=m; t.hidden=false; clearTimeout(tt); tt=setTimeout(()=>t.hidden=true,TIMING.toast); }

// ---------- Start ----------
(async()=>{
  const saved=E.restore(LS.get(KEYS.game,null));
  if (saved){ const {legacy,...g}=saved; G=g; }
  // Een partij die al bezig was, gaat gewoon verder. Anders begint het spel met het startscherm.
  S.resumed = !!saved && !saved.legacy && !saved.done && (saved.round>1 || saved.turn>0 || saved.players.some(p=>p.pts));
  renderGame(); renderTakes(); renderLens();
  S.clips=await DB.all("clips"); S.takes=await DB.all("takes"); renderLib(); renderTrack(); refreshButtons();
  if (S.resumed) toast(`Je partij is hersteld. ${E.current(G).name} is aan de beurt.`);
  else if (!LS.get(KEYS.help,false)) openHelp();
  else openStart();
})();
window.__ss=S; window.__game=()=>G; // voor de tests
})();
