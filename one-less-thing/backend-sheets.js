// Google Sheet data layer for One Less Thing!, talking to apps-script.gs.
// Teachers get a private random key saved in this browser (that's how
// "What you've shared" finds their own entries). The admin enters a passcode
// through the hidden lock; the script checks it and hands back a session that
// lasts 6 hours. The Sheet itself is never exposed.

const POLL_MS = 30000;
const store = {
  get(k, s = localStorage){ try { return s.getItem(k); } catch { return null; } },
  set(k, v, s = localStorage){ try { v == null ? s.removeItem(k) : s.setItem(k, v); } catch {} },
};
const err = code => Object.assign(new Error(code), { code });

export function create({ API_URL }){
  let owner = store.get("olt-owner");
  if (!owner || owner.length < 20) {
    const a = new Uint8Array(24); crypto.getRandomValues(a);
    owner = Array.from(a, b => b.toString(16).padStart(2, "0")).join("");
    store.set("olt-owner", owner);
  }
  let session = store.get("olt-admin", sessionStorage);
  let authCb = () => {};
  const me = () => ({ uid: owner, isAnonymous: !session, email: "" });

  async function call(body){
    // text/plain keeps this a simple request, which Apps Script accepts from any site
    const res = await fetch(API_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) });
    if (!res.ok) throw err("network");
    const out = await res.json();
    if (!out.ok) {
      if (out.error === "unauthorized" && session) endSession();
      throw err(out.error || "server-error");
    }
    return out;
  }
  function endSession(){ session = null; store.set("olt-admin", null, sessionStorage); stopAdmin(); authCb(me()); }

  /* polling channels: list (everyone), mine (this browser), admin (admin session) */
  const ch = {
    list:  { subs: new Set(), fetch: () => call({ action: "list" }).then(o => o.list) },
    mine:  { subs: new Set(), fetch: () => call({ action: "mine", owner }).then(o => o.items) },
    admin: { subs: new Set(), fetch: () => call({ action: "admin", session }) },
  };
  async function refresh(...names){
    await Promise.all(names.map(async n => {
      const c = ch[n]; if (!c.subs.size) return;
      try { const v = await c.fetch(); c.subs.forEach(s => s.next(v)); }
      catch (e) { c.subs.forEach(s => s.err && s.err(e)); }
    }));
  }
  const all = () => refresh("list", "mine", "admin");
  setInterval(() => { if (document.visibilityState === "visible") all(); }, POLL_MS);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") all(); });

  function subscribe(name, next, onErr){
    const s = { next, err: onErr }; ch[name].subs.add(s);
    ch[name].fetch().then(next, e => onErr && onErr(e));
    return () => ch[name].subs.delete(s);
  }
  function stopAdmin(){ ch.admin.subs.clear(); }

  return {
    onAuth(cb){ authCb = cb; setTimeout(() => cb(me())); },
    async signInAdmin(passcode){
      const out = await call({ action: "login", passcode });
      session = out.session; store.set("olt-admin", session, sessionStorage);
      authCb(me());
    },
    async signOut(){
      const s = session; session = null; store.set("olt-admin", null, sessionStorage); stopAdmin();
      if (s) call({ action: "logout", session: s }).catch(() => {});
      authCb(me());
    },
    async checkAdmin(){
      if (!session) return false;
      try { await call({ action: "admin", session }); return true; } catch { return false; }
    },

    watchList(next, onErr){ return subscribe("list", next, onErr); },
    watchMine(_uid, next, onErr){ return subscribe("mine", next, onErr); },
    // The page expects responses as [{items:[...]}]; the admin call returns them flat.
    watchResponses(next, onErr){ return subscribe("admin", o => next([{ items: o.responses }]), onErr); },
    watchTriage(next, onErr){ return subscribe("admin", o => next(o.setaside), onErr); },

    async submit(_uid, item){ await call({ action: "submit", owner, item }); await refresh("mine"); },
    async addList(data){ await call({ action: "addList", session, data }); await refresh("list", "admin"); },
    async updateList(id, patch){ await call({ action: "updateList", session, id, patch }); await refresh("list", "admin"); },
    async deleteList(id){ await call({ action: "deleteList", session, id }); await refresh("list", "admin"); },
    async setTriage(ids){ await call({ action: "setAside", session, ids }); await refresh("admin"); },
  };
}
