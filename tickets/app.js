// One Less Thing! Tickets — page logic.
// Every rule (who you are, balances, the 24-hour notice, admin-only actions)
// is enforced by apps-script.gs. This page only shows what the script returns.

// The Apps Script web app URL (Deploy → Manage deployments → Web app URL).
const API_URL = window.TICKETS_API || "";

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const store = {
  get(k){ try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v){ try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};
const S = { session: store.get("olt-tix-session"), me: null, tickets: [], requests: [], rules: {}, admin: null, ui: { deny: null, confirmCancel: null } };

const ERR = {
  "not-set-up": "The ticket system isn't set up yet. The admin needs to fill in the settings tab.",
  "bad-sign-in": "Google sign-in didn't go through. Try again.",
  "wrong-domain": "Please sign in with your school Google account.",
  "unauthorized": "Your sign-in has ended. Please sign in again.",
  "bad-date": "Choose a day.",
  "bad-ticket": "Choose a ticket.",
  "weekend": "Tickets can only be used on weekdays.",
  "too-late": "That day is less than 24 hours away. Choose a later day so your duty can be covered.",
  "duplicate": "You've already requested that ticket for that day.",
  "none-left": "You don't have any of that ticket left.",
  "not-found": "That request couldn't be found. It may have changed; refresh to see the latest.",
  "not-active": "That request is no longer active.",
  "not-pending": "That request has already been decided.",
  "past": "That day has already passed.",
};
const errMsg = e => ERR[e && e.code] || "Something went wrong. Try again.";

/* ---------- server ---------- */
async function call(body){
  const res = await fetch(API_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) });
  if (!res.ok) throw Object.assign(new Error("network"), { code: "network" });
  const out = await res.json();
  if (!out.ok) {
    if (out.error === "unauthorized" && body.action !== "decide") signedOut(ERR.unauthorized);
    throw Object.assign(new Error(out.error), { code: out.error });
  }
  return out;
}
const api = (action, extra = {}) => call({ action, session: S.session, ...extra });

/* ---------- dates ---------- */
const parseD = d => { const [y, m, dd] = d.split("-").map(Number); return new Date(y, m - 1, dd); };
const fmtD = (d, o) => parseD(d).toLocaleDateString(undefined, o || { weekday: "long", month: "long", day: "numeric" });

/* ---------- sign-in ---------- */
let clientId = "";
async function boot(){
  if (!API_URL) { $("#signin-msg").textContent = "This page isn't connected yet. The admin needs to add the Apps Script URL in app.js."; return; }
  if (S.session) {
    try { await loadMine(); showApp(); return; }
    catch (e) { if (e.code === "unauthorized") return; /* signedOut() already showed the sign-in */ $("#signin-msg").textContent = errMsg(e); }
  }
  await showSignIn();
}

async function showSignIn(){
  $("#signin").hidden = false; $("#tabs").hidden = true; $("#who").hidden = true;
  for (const p of document.querySelectorAll(".panel")) p.hidden = true;
  if (!clientId) {
    try {
      const cfg = await (await fetch(API_URL, { cache: "no-store" })).json();
      clientId = cfg.client_id;
      if (!cfg.ready) { $("#signin-msg").textContent = ERR["not-set-up"]; if (!clientId) return; }
    } catch { $("#signin-msg").textContent = "Can't reach the ticket system right now. Check your connection and refresh."; return; }
  }
  await loadGoogle();
  google.accounts.id.initialize({ client_id: clientId, callback: onCredential, auto_select: true, ux_mode: "popup" });
  google.accounts.id.renderButton($("#gbtn"), { theme: "outline", size: "large", text: "signin_with", shape: "pill" });
}

function loadGoogle(){
  if (window.google && google.accounts && google.accounts.id) return Promise.resolve();
  return new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client"; s.async = true; s.onload = ok; s.onerror = fail;
    document.head.appendChild(s);
  });
}

async function onCredential(resp){
  $("#signin-msg").textContent = "Signing in…";
  try {
    const out = await call({ action: "login", credential: resp.credential });
    S.session = out.session; store.set("olt-tix-session", S.session);
    await loadMine(); showApp();
    $("#signin-msg").textContent = "";
  } catch (e) { $("#signin-msg").textContent = errMsg(e); }
}

function signedOut(msg){
  S.session = null; S.me = null; S.admin = null; store.set("olt-tix-session", null);
  if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
  $("#signin-msg").textContent = msg || "";
  showSignIn();
}

/* ---------- loading ---------- */
async function loadMine(){
  const out = await api("me");
  S.me = out.me; S.tickets = out.tickets; S.requests = out.requests; S.rules = out.rules;
}
async function loadAdmin(){
  if (!S.me || !S.me.isAdmin) return;
  S.admin = await api("admin");
}
async function refresh(){
  try { await Promise.all([loadMine(), loadAdmin()]); render(); } catch (e) { if (e.code !== "unauthorized") console.error(e); }
}
setInterval(() => { if (S.session && document.visibilityState === "visible" && !busy()) refresh(); }, 60000);
document.addEventListener("visibilitychange", () => { if (S.session && document.visibilityState === "visible" && !busy()) refresh(); });
const busy = () => { const a = document.activeElement; return a && /INPUT|SELECT|TEXTAREA/.test(a.tagName) && a.value; };

async function showApp(){
  $("#signin").hidden = true; $("#tabs").hidden = !S.me.isAdmin; $("#who").hidden = false;
  for (const a of document.querySelectorAll("[data-admin]")) a.hidden = !S.me.isAdmin;
  render();
  if (S.me.isAdmin) { try { await loadAdmin(); render(); } catch (e) { console.error(e); } }
}

/* ---------- tabs ---------- */
function currentTab(){
  const h = location.hash.slice(1), admin = S.me && S.me.isAdmin;
  return ["approve", "coverage", "teachers"].includes(h) && admin ? h : "mine";
}
function showTab(){
  if (!S.me) return;
  const t = currentTab();
  for (const a of document.querySelectorAll("#tabs a")) a.dataset.tab === t ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current");
  for (const id of ["mine", "approve", "coverage", "teachers"]) $("#p-" + id).hidden = id !== t;
}
addEventListener("hashchange", showTab);

/* ---------- render ---------- */
function render(){
  if (!S.me) return;
  $("#who").innerHTML = `<span>Signed in as <b>${esc(S.me.name)}</b>${S.me.isAdmin ? " · admin" : ""}</span><button type="button" class="small link" id="signout">Sign out</button>`;
  renderTickets(); renderForm(); renderMyReqs();
  if (S.me.isAdmin) {
    const pending = S.admin ? S.admin.requests.filter(r => r.status === "pending").length : 0;
    $('#tabs a[data-tab="approve"]').innerHTML = "To approve" + (pending ? `<span class="count">${pending}</span>` : "");
    $("#p-approve").innerHTML = renderApprove();
    $("#p-coverage").innerHTML = renderCoverage();
    $("#p-teachers").innerHTML = renderTeachers();
  }
  showTab();
}

function renderTickets(){
  $("#tix").innerHTML = S.tickets.map(t => `
    <div class="tk${t.left ? "" : " out"}">
      <div class="n">${esc(t.name)}</div>
      <div><span class="left">${t.left}</span> <span class="of">of ${t.allowance} left</span></div>
      <div class="dots" aria-hidden="true">${Array.from({ length: t.allowance }, (_, i) => `<i${i < t.left ? "" : ' class="used"'}></i>`).join("")}</div>
    </div>`).join("") || `<div class="empty sm">No ticket types are set up yet.</div>`;
}

function renderForm(){
  const sel = $("#f-ticket"), keep = sel.value;
  sel.innerHTML = `<option value="">Choose a ticket…</option>` + S.tickets.map(t =>
    `<option value="${esc(t.id)}"${t.left ? "" : " disabled"}>${esc(t.name)}${t.left ? ` (${t.left} left)` : " (none left)"}</option>`).join("");
  if (keep && S.tickets.some(t => t.id === keep && t.left)) sel.value = keep;
  const r = S.rules;
  if (r.earliest) $("#f-date").min = r.earliest;
  const [h, m] = String(r.deadline_time || "08:00").split(":").map(Number);
  const time = new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  $("#f-rule").textContent = `Weekdays only. Request by ${time} the day before you want to use it.` + (r.earliest ? ` The earliest day you can choose right now is ${fmtD(r.earliest)}.` : "");
  $("#f-submit").disabled = !S.tickets.some(t => t.left);
}

function statusPill(r){
  const label = { pending: "Waiting for approval", approved: "Approved", denied: "Denied", cancelled: "Cancelled" }[r.status] || r.status;
  return `<span class="pill ${esc(r.status)}">${label}</span>`;
}
const tName = id => (S.tickets.find(t => t.id === id) || (S.admin && S.admin.tickets.find(t => t.id === id)) || { name: id }).name;

function renderMyReqs(){
  const today = S.rules.today || "";
  const list = S.requests.slice().sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : b.createdAt - a.createdAt));
  $("#my-reqs").innerHTML = list.map(r => {
    const canCancel = ["pending", "approved"].includes(r.status) && r.date >= today;
    let side = statusPill(r);
    if (canCancel) side += S.ui.confirmCancel === r.id
      ? `<span class="row"><button class="small knock" data-act="cancelDo" data-id="${esc(r.id)}">Cancel it</button><button class="small" data-act="keep">Keep</button></span>`
      : `<button class="small link" data-act="cancel" data-id="${esc(r.id)}">Cancel</button>`;
    return `<li><div class="x"><span class="d">${esc(tName(r.ticketId))}</span><span class="sm">${esc(fmtD(r.date))}</span>
      ${r.note ? `<span class="sm">Your note: ${esc(r.note)}</span>` : ""}${r.adminNote ? `<span class="sm">Admin: ${esc(r.adminNote)}</span>` : ""}</div>
      <div class="side">${side}</div></li>`;
  }).join("") || `<li><span class="muted">No requests yet.</span></li>`;
}

/* ---------- admin views ---------- */
function reqCard(r, { actions }){
  let h = `<div class="req"><div class="top"><span class="t">${esc(r.name)} · ${esc(tName(r.ticketId))}</span></div>`;
  h += `<div class="rnote">${esc(r.email)}${r.note ? ` · “${esc(r.note)}”` : ""}</div>`;
  if (actions === "pending") {
    if (S.ui.deny === r.id) h += `<div class="row"><input type="text" id="dn-${esc(r.id)}" maxlength="300" placeholder="Reason (optional, the teacher sees this)">
      <button class="small knock" data-act="denyDo" data-id="${esc(r.id)}">Deny</button><button class="small" data-act="keep">Cancel</button></div>`;
    else h += `<div class="row"><button class="small primary" data-act="approve" data-id="${esc(r.id)}">Approve</button><button class="small" data-act="deny" data-id="${esc(r.id)}">Deny</button></div>`;
  } else if (actions === "approved") {
    if (S.ui.deny === r.id) h += `<div class="row"><input type="text" id="dn-${esc(r.id)}" maxlength="300" placeholder="Reason (the teacher sees this)">
      <button class="small knock" data-act="denyDo" data-id="${esc(r.id)}">Withdraw approval</button><button class="small" data-act="keep">Keep it</button></div>`;
    else h += `<div class="row">${statusPill(r)}<button class="small link" data-act="deny" data-id="${esc(r.id)}">Withdraw approval</button></div>`;
  }
  return h + `</div>`;
}
function byDay(reqs){
  const m = new Map(); for (const r of reqs) { if (!m.has(r.date)) m.set(r.date, []); m.get(r.date).push(r); } return [...m];
}
function renderApprove(){
  if (!S.admin) return `<div class="empty">Loading…</div>`;
  const today = S.admin.today, p = S.admin.requests.filter(r => r.status === "pending");
  const upcoming = p.filter(r => r.date >= today), past = p.filter(r => r.date < today);
  let h = `<div class="group-h"><h2>To approve</h2><span class="muted">${upcoming.length} waiting</span></div>
    <p class="muted">Approve once coverage is arranged. Denying returns the ticket to the teacher. Soonest days are first.</p>`;
  if (!upcoming.length) h += `<div class="note ok">Nothing waiting. New requests show up here.</div>`;
  for (const [d, rs] of byDay(upcoming)) h += `<div class="day"><h3>${esc(fmtD(d))}${d === today ? ' <span class="today-tag">Today</span>' : ""}</h3>${rs.map(r => reqCard(r, { actions: "pending" })).join("")}</div>`;
  if (past.length) h += `<details><summary>Never decided, day has passed (${past.length})</summary><div class="panel" style="margin-top:10px">${past.map(r => reqCard(r, { actions: "pending" })).join("")}</div></details>`;
  return h;
}
function renderCoverage(){
  if (!S.admin) return `<div class="empty">Loading…</div>`;
  const today = S.admin.today, a = S.admin.requests.filter(r => r.status === "approved" && r.date >= today);
  let h = `<div class="group-h"><h2>Coverage</h2><span class="muted">${a.length} upcoming</span></div>
    <p class="muted">Approved tickets by day, so you know which duties need someone.</p>`;
  if (!a.length) h += `<div class="empty sm">No approved tickets coming up.</div>`;
  for (const [d, rs] of byDay(a)) h += `<div class="day"><h3>${esc(fmtD(d))}${d === today ? ' <span class="today-tag">Today</span>' : ""} <span class="muted">${rs.length}</span></h3>${rs.map(r => reqCard(r, { actions: "approved" })).join("")}</div>`;
  return h;
}
function renderTeachers(){
  if (!S.admin) return `<div class="empty">Loading…</div>`;
  const ts = S.admin.tickets.filter(t => t.active), rows = S.admin.teachers;
  let h = `<div class="group-h"><h2>Teachers</h2><span class="muted">${rows.length}</span></div>
    <p class="muted">Tickets left for everyone who has made a request since ${esc(fmtD(S.admin.period_start, { month: "long", day: "numeric", year: "numeric" }))}. Teachers who haven't made a request have all of theirs.</p>`;
  if (!rows.length) return h + `<div class="empty sm">No requests yet.</div>`;
  h += `<div class="scroll"><table class="bal"><thead><tr><th>Teacher</th>${ts.map(t => `<th class="num">${esc(t.name)}</th>`).join("")}</tr></thead><tbody>`;
  for (const r of rows) {
    h += `<tr><td>${esc(r.name)}<div class="muted" style="font-size:.8rem">${esc(r.email)}</div></td>` +
      ts.map(t => { const b = r.tickets.find(x => x.id === t.id) || { left: t.allowance, allowance: t.allowance };
        return `<td class="num${b.left ? "" : " zero"}">${b.left} / ${b.allowance}</td>`; }).join("") + `</tr>`;
  }
  return h + `</tbody></table></div>`;
}

/* ---------- actions ---------- */
function flash(msg, ok){
  const p = $("#p-" + currentTab()), d = document.createElement("div");
  d.className = "note" + (ok ? " ok" : ""); d.setAttribute("role", "alert"); d.textContent = msg; p.prepend(d); setTimeout(() => d.remove(), 6000);
}

document.addEventListener("click", async e => {
  if (e.target.id === "signout") { const s = S.session; signedOut(); call({ action: "logout", session: s }).catch(() => {}); return; }
  const b = e.target.closest("[data-act]"); if (!b) return;
  const { act, id } = b.dataset;
  const go = async (fn, okMsg) => {
    b.disabled = true;
    try { await fn(); S.ui.deny = S.ui.confirmCancel = null; await refresh(); if (okMsg) flash(okMsg, true); }
    catch (err) { flash(errMsg(err)); b.disabled = false; }
  };
  switch (act) {
    case "keep": S.ui.deny = S.ui.confirmCancel = null; render(); break;
    case "cancel": S.ui.confirmCancel = id; render(); break;
    case "cancelDo": go(() => api("cancel", { id }), "Request cancelled. The ticket is back in your balance."); break;
    case "approve": go(() => api("decide", { id, status: "approved" })); break;
    case "deny": S.ui.deny = id; render(); { const f = $("#dn-" + id); f && f.focus(); } break;
    case "denyDo": go(() => api("decide", { id, status: "denied", adminNote: ($("#dn-" + id) || {}).value || "" })); break;
  }
});
document.addEventListener("keydown", e => {
  if (e.key === "Enter" && e.target.matches('.req input[type="text"]')) { e.preventDefault(); const b = e.target.parentElement.querySelector('[data-act="denyDo"]'); b && b.click(); }
});

$("#form").addEventListener("submit", async e => {
  e.preventDefault();
  const st = $("#f-status"), ticketId = $("#f-ticket").value, date = $("#f-date").value;
  if (!ticketId) { st.textContent = "Choose a ticket."; $("#f-ticket").focus(); return; }
  if (!date) { st.textContent = "Choose a day."; $("#f-date").focus(); return; }
  const btn = $("#f-submit"); btn.disabled = true; st.textContent = "Sending…";
  try {
    await api("request", { ticketId, date, note: $("#f-note").value.trim() });
    $("#form").reset(); st.textContent = "";
    await refresh();
    flash(`Request sent for ${fmtD(date)}. It will show as Approved below once the admin approves it.`, true);
  } catch (err) { st.textContent = errMsg(err); }
  finally { btn.disabled = !S.tickets.some(t => t.left); }
});

boot();
