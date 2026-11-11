/**
 * One Less Thing! — Google Sheet backend (Apps Script web app).
 *
 * Paste this into the Sheet's Extensions → Apps Script editor, set the
 * ADMIN_PASSCODE script property, and deploy as a web app
 * (Execute as: Me, Who has access: Anyone). See README.md.
 *
 * Who can do what is decided here, on Google's servers:
 *   - anyone:  read The list, submit, read their own submissions (by their private browser key)
 *   - admin:   (passcode → 6-hour session) read every submission, change The list, set items aside
 * The Sheet itself stays private to you.
 */

const TABS = {
  responses: ["id", "at", "text", "why", "time", "owner"],
  list:      ["id", "title", "status", "sources", "note", "createdAt", "doneAt"],
  setaside:  ["responseId"],
};
const SESSION_SECONDS = 6 * 60 * 60;
const MAX_FAILS = 10;              // wrong passcodes allowed per 10 minutes before sign-in pauses
const LIMITS = { text: 600, why: 1200, title: 200, note: 300 };
const TIMES = ["", "lt15", "15to60", "1to3", "3plus"];
const STATUSES = ["open", "working", "done"];

/* ---------- entry points ---------- */
function doGet() {
  return json_({ ok: true, list: readList_() });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: "bad-request" }); }
  try {
    switch (req.action) {
      case "list":   return json_({ ok: true, list: readList_() });
      case "submit": return json_(submit_(req));
      case "mine":   return json_({ ok: true, items: mine_(req.owner) });
      case "login":  return json_(login_(req.passcode));
      case "logout": CacheService.getScriptCache().remove("adm_" + String(req.session || "")); return json_({ ok: true });
    }
    // Everything below needs an admin session.
    if (!isAdmin_(req.session)) return json_({ ok: false, error: "unauthorized" });
    switch (req.action) {
      case "admin":      return json_({ ok: true, responses: readResponses_(), list: readList_(), setaside: readSetAside_() });
      case "addList":    return json_(addList_(req.data));
      case "updateList": return json_(updateList_(req.id, req.patch));
      case "deleteList": return json_(deleteList_(req.id));
      case "setAside":   return json_(setAside_(req.ids));
    }
    return json_({ ok: false, error: "unknown-action" });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: "server-error" });
  }
}

/* ---------- teachers ---------- */
function submit_(req) {
  const owner = String(req.owner || "");
  const it = req.item || {};
  const text = clip_(it.text, LIMITS.text);
  if (owner.length < 20 || !text) return { ok: false, error: "bad-request" };
  const row = {
    id: cleanIds_([it.id])[0] || Utilities.getUuid().slice(0, 12),
    at: Date.now(),
    text: text,
    why: clip_(it.why, LIMITS.why),
    time: TIMES.indexOf(it.time) >= 0 ? it.time : "",
    owner: hash_(owner),
  };
  withLock_(() => append_("responses", row));
  return { ok: true, item: strip_(row) };
}

function mine_(owner) {
  owner = String(owner || "");
  if (owner.length < 20) return [];
  const h = hash_(owner);
  return rows_("responses").filter(r => r.owner === h).map(strip_);
}

/* ---------- admin sign-in ---------- */
function login_(passcode) {
  const props = PropertiesService.getScriptProperties();
  const real = props.getProperty("ADMIN_PASSCODE");
  if (!real) return { ok: false, error: "not-set-up" };
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get("fails") || 0);
  if (fails >= MAX_FAILS) return { ok: false, error: "too-many-tries" };
  if (String(passcode || "") !== real) {
    cache.put("fails", String(fails + 1), 600);
    return { ok: false, error: "wrong-passcode" };
  }
  const session = Utilities.getUuid() + Utilities.getUuid();
  cache.put("adm_" + session, "1", SESSION_SECONDS);
  return { ok: true, session: session };
}

function isAdmin_(session) {
  session = String(session || "");
  return session.length > 40 && CacheService.getScriptCache().get("adm_" + session) === "1";
}

/* ---------- admin actions ---------- */
function addList_(d) {
  d = d || {};
  const row = {
    id: Utilities.getUuid().slice(0, 12),
    title: clip_(d.title, LIMITS.title) || "Untitled",
    status: "open",
    sources: cleanIds_(d.sources).join(","),
    note: "",
    createdAt: Date.now(),
    doneAt: "",
  };
  withLock_(() => append_("list", row));
  return { ok: true, id: row.id };
}

function updateList_(id, patch) {
  patch = patch || {};
  return withLock_(() => {
    const sh = sheet_("list"), vals = sh.getDataRange().getValues(), head = vals[0];
    for (let i = 1; i < vals.length; i++) {
      if (String(vals[i][0]) !== String(id)) continue;
      const set = (k, v) => sh.getRange(i + 1, head.indexOf(k) + 1).setValue(v);
      if ("title" in patch) set("title", clip_(patch.title, LIMITS.title) || "Untitled");
      if ("status" in patch && STATUSES.indexOf(patch.status) >= 0) set("status", patch.status);
      if ("sources" in patch) set("sources", cleanIds_(patch.sources).join(","));
      if ("note" in patch) set("note", clip_(patch.note, LIMITS.note));
      if ("doneAt" in patch) set("doneAt", patch.doneAt ? Number(patch.doneAt) : "");
      return { ok: true };
    }
    return { ok: false, error: "not-found" };
  });
}

function deleteList_(id) {
  return withLock_(() => {
    const sh = sheet_("list"), vals = sh.getDataRange().getValues();
    for (let i = vals.length - 1; i >= 1; i--) if (String(vals[i][0]) === String(id)) { sh.deleteRow(i + 1); return { ok: true }; }
    return { ok: false, error: "not-found" };
  });
}

function setAside_(ids) {
  ids = cleanIds_(ids);
  return withLock_(() => {
    const sh = sheet_("setaside"), last = sh.getLastRow();
    if (last > 1) sh.getRange(2, 1, last - 1, 1).clearContent();
    if (ids.length) sh.getRange(2, 1, ids.length, 1).setValues(ids.map(x => [x]));
    return { ok: true };
  });
}

/* ---------- reading ---------- */
function readList_() {
  return rows_("list").map(r => ({
    id: String(r.id), title: String(r.title), status: STATUSES.indexOf(r.status) >= 0 ? r.status : "open",
    sources: String(r.sources || "").split(",").filter(String), note: String(r.note || ""),
    createdAt: Number(r.createdAt) || 0, doneAt: r.doneAt ? Number(r.doneAt) : null,
  }));
}
function readResponses_() { return rows_("responses").map(strip_); }
function readSetAside_() { return rows_("setaside").map(r => String(r.responseId)).filter(String); }

/* ---------- helpers ---------- */
function sheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, TABS[name].length).setValues([TABS[name]]).setFontWeight("bold");
    sh.setFrozenRows(1);
    sh.getRange("A:Z").setNumberFormat("@"); // keep ids and text as plain text
  }
  return sh;
}
function rows_(name) {
  const vals = sheet_(name).getDataRange().getValues(), head = vals.shift();
  return vals.filter(v => v.some(String)).map(v => Object.fromEntries(head.map((h, i) => [h, v[i]])));
}
function append_(name, obj) { sheet_(name).appendRow(TABS[name].map(k => obj[k] === undefined || obj[k] === null ? "" : String(obj[k]))); }
function strip_(r) { return { id: String(r.id), at: Number(r.at) || 0, text: String(r.text), why: String(r.why || ""), time: String(r.time || "") }; }
function clip_(s, n) { return String(s == null ? "" : s).trim().slice(0, n); }
function cleanIds_(a) { return (Array.isArray(a) ? a : []).map(x => String(x).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40)).filter(String); }
function hash_(s) { return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s)); }
function withLock_(fn) { const l = LockService.getScriptLock(); l.waitLock(20000); try { return fn(); } finally { l.releaseLock(); } }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/** Run once from the editor to create the three tabs. */
function setup() { Object.keys(TABS).forEach(sheet_); }
