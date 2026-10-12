/* Nep-Supabase voor de browsertests: praat via window.__remote met een geheugen-backend in de test (Node). */
(() => {
  const call = (op, a) => window.__remote(JSON.stringify({ op, a })).then(JSON.parse);
  const b64 = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result.split(",")[1]); f.readAsDataURL(b); });
  let sess = null; try { sess = JSON.parse(localStorage.getItem("fake.sess")); } catch {}
  const subs = [];
  const setS = u => { sess = u ? { user: u } : null; localStorage.setItem("fake.sess", JSON.stringify(sess)); subs.forEach(f => f(u ? "SIGNED_IN" : "SIGNED_OUT", sess)); };
  const q = (t, kind) => { const f = {}; const o = { eq: (k, v) => { f[k] = v; return o; }, then: (res, rej) => call(kind, { t, f }).then(res, rej) }; return o; };
  window.supabase = { createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: sess } }),
      onAuthStateChange: f => { subs.push(f); return { data: {} }; },
      signUp: async ({ email, password, options }) => { const r = await call("signUp", { email, password, name: options?.data?.name }); return r.error ? { data: {}, error: { message: r.error } } : { data: { session: null, user: r.user }, error: null }; },
      signInWithPassword: async ({ email, password }) => { const r = await call("signIn", { email, password }); if (r.error) return { data: {}, error: { message: r.error } }; setS(r.user); return { data: { user: r.user }, error: null }; },
      signOut: async () => { setS(null); return { error: null }; },
    },
    from: t => ({ upsert: async row => call("upsert", { t, row }), select: () => q(t, "select"), delete: () => q(t, "delete") }),
    storage: { from: () => ({
      upload: async (path, blob) => call("up", { path, b64: await b64(blob), type: blob.type }),
      download: async path => { const r = await call("down", { path }); if (r.error) return { data: null, error: { message: r.error } }; const bin = atob(r.b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return { data: new Blob([u], { type: r.type }), error: null }; },
      remove: async paths => call("rm", { paths }),
    }) },
  }) };
})();
