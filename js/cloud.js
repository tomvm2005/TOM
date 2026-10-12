/* Stemmenstudio: accounts en online opslag via Supabase. Alles hier is optioneel:
   zonder instellingen in js/config.js is Cloud.enabled() false en doet de rest van het spel niets met accounts. */
(() => {
"use strict";
const cfg = window.SS_CONFIG || {};
const LIB = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js";
const BUCKET = "takes";
let client = null, user = null, readyP = null;
const subs = [];

const enabled = () => !!(cfg.url && cfg.anonKey);
const nameOf = u => u?.user_metadata?.name || (u?.email ? u.email.split("@")[0] : "");
const pub = u => u ? { id: u.id, email: u.email, name: nameOf(u) } : null;

function loadLib(){
  if (window.supabase?.createClient) return Promise.resolve();
  return new Promise((res, rej) => { const s = document.createElement("script"); s.src = LIB; s.onload = res; s.onerror = () => rej(new Error("lib")); document.head.appendChild(s); });
}
function ready(){
  if (!enabled()) return Promise.resolve(false);
  return readyP ||= (async () => {
    try {
      await loadLib();
      client = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
      const { data } = await client.auth.getSession(); user = data?.session?.user || null;
      client.auth.onAuthStateChange((_ev, s) => { const next = s?.user || null; if ((next?.id || null) !== (user?.id || null)){ user = next; subs.forEach(f => f(pub(user))); } else user = next; });
      return true;
    } catch { client = null; readyP = null; return false; }
  })();
}
// Meldingen in gewoon Nederlands.
function nl(err){
  const m = String(err?.message || err || "");
  if (/invalid login/i.test(m)) return "E-mailadres of wachtwoord klopt niet.";
  if (/already registered|already been registered/i.test(m)) return "Dit e-mailadres heeft al een account. Log in.";
  if (/not confirmed/i.test(m)) return "Bevestig eerst je e-mailadres met de link in de mail die we je stuurden.";
  if (/password/i.test(m) && /(least|short|characters)/i.test(m)) return "Kies een wachtwoord van minimaal 6 tekens.";
  if (/valid email|invalid email|email address/i.test(m)) return "Dit e-mailadres lijkt niet te kloppen.";
  if (/rate limit|too many/i.test(m)) return "Even wachten: er zijn te veel pogingen. Probeer het over een paar minuten opnieuw.";
  if (/fetch|network|failed/i.test(m)) return "Geen verbinding. Controleer je internet en probeer het opnieuw.";
  return "Dat lukte niet: " + m;
}
async function need(){ if (!(await ready()) || !client) throw new Error("Accounts zijn nu niet bereikbaar. Probeer het later opnieuw."); }

async function signUp(email, password, name){
  await need();
  const { data, error } = await client.auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: location.href.split("#")[0].split("?")[0] } });
  if (error) throw new Error(nl(error));
  user = data.session?.user || null; // zonder sessie moet het e-mailadres eerst bevestigd worden
  return { confirmMail: !data.session };
}
async function signIn(email, password){
  await need();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(nl(error));
  user = data.user; return pub(user);
}
async function signOut(){ await need(); await client.auth.signOut(); user = null; }

const uid = () => user?.id || null;
async function pushRow(table, obj){
  const { error } = await client.from(table).upsert({ user_id: user.id, id: obj.id, data: obj, updated_at: new Date().toISOString() });
  if (error) throw error;
}
// Zet een clip of take online. Bij een take hoort eventueel de opname (blob) erbij.
async function push(store, obj, blob){
  if (!user || !client) return false;
  const { blob: _b, buffer: _u, rateAfter: _r, ...row } = obj;
  if (store === "takes" && blob){
    const { error } = await client.storage.from(BUCKET).upload(`${user.id}/${obj.id}`, blob, { upsert: true, contentType: blob.type || "audio/webm" });
    if (error) throw error;
    row.mime = blob.type || "audio/webm";
  }
  await pushRow(store === "clips" ? "ss_clips" : "ss_takes", row);
  return true;
}
async function remove(store, id){
  if (!user || !client) return;
  await client.from(store === "clips" ? "ss_clips" : "ss_takes").delete().eq("user_id", user.id).eq("id", id);
  if (store === "takes") await client.storage.from(BUCKET).remove([`${user.id}/${id}`]);
}
// Alles van dit account: { clips, takes } (rijen), opnames worden pas met blob() opgehaald.
async function pull(){
  if (!user || !client) return { clips: [], takes: [] };
  const [c, t] = await Promise.all([client.from("ss_clips").select("data").eq("user_id", user.id), client.from("ss_takes").select("data").eq("user_id", user.id)]);
  if (c.error) throw c.error; if (t.error) throw t.error;
  return { clips: c.data.map(r => r.data), takes: t.data.map(r => r.data) };
}
async function blob(id){
  const { data, error } = await client.storage.from(BUCKET).download(`${user.id}/${id}`);
  if (error) throw error; return data;
}

window.Cloud = { enabled, ready, user: () => pub(user), uid, signUp, signIn, signOut, push, remove, pull, blob, onChange: f => subs.push(f) };
})();
