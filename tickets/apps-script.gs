/**
 * One Less Thing! Tickets — Google Sheet backend (Apps Script web app).
 *
 * Teachers sign in on the page with "Sign in with Google". This script asks
 * Google to confirm each sign-in, accepts only accounts from the school domain,
 * and enforces every rule: ticket balances, the 24-hour notice, and admin-only
 * actions. The Sheet itself stays private.
 *
 * Setup: paste into the Sheet's Extensions → Apps Script, run setup(), fill in
 * the `settings` tab, and deploy as a web app (Execute as: Me, Who has access:
 * Anyone). See README.md.
 */

const TABS = {
  tickets:  ["id", "name", "allowance", "active"],
  requests: ["id", "email", "name", "ticketId", "date", "note", "status", "createdAt", "decidedAt", "decidedBy", "adminNote"],
  settings: ["key", "value", "what it does"],
};
const DEFAULT_TICKETS = [
  ["leave330",  "Leave at 3:30",                   2, "yes"],
  ["lunch",     "Take off a lunch duty",           2, "yes"],
  ["break",     "Take off a break duty",           2, "yes"],
  ["community", "Take off a community time duty",  2, "yes"],
];
const DEFAULT_SETTINGS = [
  ["client_id",      "",           "Google OAuth Client ID (from Google Cloud Console). Needed for Sign in with Google."],
  ["allowed_domain", "",           "Only Google accounts ending in @this domain can sign in, e.g. myschool.org"],
  ["admin_emails",   "",           "Admins who approve requests. Separate several with commas."],
  ["period_start",   "2026-08-01", "Tickets used on or after this date count against balances. Change it to reset everyone."],
  ["deadline_time",  "08:00",      "Requests must be made 24 hours before this time on the requested day (24-hour clock)."],
  ["notify",         "yes",        "yes = email admins about new requests and teachers about decisions. no = no emails."],
  ["page_url",       "",           "Link to the tickets page, included in emails."],
];
const SESSION_SECONDS = 6 * 60 * 60;
const ACTIVE = ["pending", "approved"];
const LIMITS = { note: 300, adminNote: 300 };

/* ---------- entry points ---------- */
function doGet() {
  // Public: only what the sign-in button needs.
  const s = settings_();
  return json_({ ok: true, client_id: s.client_id || "", ready: !!(s.client_id && s.allowed_domain && s.admin_emails) });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: "bad-request" }); }
  try {
    if (req.action === "login") return json_(login_(req.credential));
    if (req.action === "logout") { CacheService.getScriptCache().remove("s_" + String(req.session || "")); return json_({ ok: true }); }

    const me = who_(req.session);
    if (!me) return json_({ ok: false, error: "unauthorized" });
    switch (req.action) {
      case "me":      return json_(mine_(me));
      case "request": return json_(request_(me, req));
      case "cancel":  return json_(cancel_(me, req.id));
    }
    if (!me.isAdmin) return json_({ ok: false, error: "unauthorized" });
    switch (req.action) {
      case "admin":  return json_(admin_());
      case "decide": return json_(decide_(me, req));
    }
    return json_({ ok: false, error: "unknown-action" });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: "server-error" });
  }
}

/* ---------- sign-in ---------- */
function login_(credential) {
  const s = settings_();
  if (!s.client_id || !s.allowed_domain) return { ok: false, error: "not-set-up" };
  // Ask Google whether this sign-in token is genuine.
  const res = UrlFetchApp.fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(String(credential || "")), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return { ok: false, error: "bad-sign-in" };
  const t = JSON.parse(res.getContentText());
  const email = String(t.email || "").toLowerCase();
  const domain = s.allowed_domain.toLowerCase().replace(/^@/, "");
  if (t.aud !== s.client_id) return { ok: false, error: "bad-sign-in" };
  if (String(t.email_verified) !== "true") return { ok: false, error: "bad-sign-in" };
  if (Number(t.exp) * 1000 < Date.now()) return { ok: false, error: "bad-sign-in" };
  if (!email.endsWith("@" + domain)) return { ok: false, error: "wrong-domain" };

  const session = Utilities.getUuid() + Utilities.getUuid();
  const me = { email: email, name: String(t.name || email.split("@")[0]) };
  CacheService.getScriptCache().put("s_" + session, JSON.stringify(me), SESSION_SECONDS);
  return { ok: true, session: session, me: Object.assign({}, me, { isAdmin: isAdminEmail_(email) }) };
}

function who_(session) {
  session = String(session || "");
  if (session.length < 40) return null;
  const v = CacheService.getScriptCache().get("s_" + session);
  if (!v) return null;
  const me = JSON.parse(v);
  me.isAdmin = isAdminEmail_(me.email); // checked every time, so removing an admin takes effect at once
  return me;
}

function isAdminEmail_(email) {
  return settings_().admin_emails.toLowerCase().split(/[\s,;]+/).filter(String).indexOf(String(email).toLowerCase()) >= 0;
}

/* ---------- teachers ---------- */
function mine_(me) {
  const tickets = tickets_(), reqs = requests_(), s = settings_();
  const mineReqs = reqs.filter(r => r.email === me.email);
  return {
    ok: true,
    me: me,
    tickets: balances_(tickets, mineReqs, s.period_start),
    requests: mineReqs.sort((a, b) => b.createdAt - a.createdAt),
    rules: { deadline_time: s.deadline_time, earliest: earliestDate_(s.deadline_time), today: today_() },
  };
}

function request_(me, req) {
  const s = settings_();
  const date = String(req.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "bad-date" };
  const ticket = tickets_().filter(t => t.id === String(req.ticketId) && t.active)[0];
  if (!ticket) return { ok: false, error: "bad-ticket" };
  const tz = Session.getScriptTimeZone();
  const start = Utilities.parseDate(date + " " + s.deadline_time, tz, "yyyy-MM-dd HH:mm");
  const weekday = Number(Utilities.formatDate(start, tz, "u")); // 1 = Monday … 7 = Sunday
  if (weekday > 5) return { ok: false, error: "weekend" };
  if (Date.now() > start.getTime() - 24 * 3600 * 1000) return { ok: false, error: "too-late" };

  return withLock_(() => {
    const mineReqs = requests_().filter(r => r.email === me.email);
    if (mineReqs.some(r => r.ticketId === ticket.id && r.date === date && ACTIVE.indexOf(r.status) >= 0)) return { ok: false, error: "duplicate" };
    const bal = balances_([ticket], mineReqs, s.period_start)[0];
    if (date >= s.period_start && bal.left <= 0) return { ok: false, error: "none-left" };
    const row = {
      id: Utilities.getUuid().slice(0, 12), email: me.email, name: me.name, ticketId: ticket.id, date: date,
      note: clip_(req.note, LIMITS.note), status: "pending", createdAt: Date.now(), decidedAt: "", decidedBy: "", adminNote: "",
    };
    append_("requests", row);
    notifyAdmins_(s, "New ticket request: " + ticket.name + " on " + niceDate_(date),
      me.name + " (" + me.email + ") asked to use \"" + ticket.name + "\" on " + niceDate_(date) + "." +
      (row.note ? "\n\nNote: " + row.note : "") + "\n\nApprove or deny it on the tickets page" + (s.page_url ? ": " + s.page_url : "."));
    return { ok: true, id: row.id };
  });
}

function cancel_(me, id) {
  const s = settings_();
  return withLock_(() => {
    const hit = findRequest_(id);
    if (!hit || hit.r.email !== me.email) return { ok: false, error: "not-found" };
    if (ACTIVE.indexOf(hit.r.status) < 0) return { ok: false, error: "not-active" };
    if (hit.r.date < today_()) return { ok: false, error: "past" };
    setFields_(hit.row, { status: "cancelled", decidedAt: Date.now(), decidedBy: me.email });
    if (hit.r.status === "approved") {
      notifyAdmins_(s, "Ticket cancelled: " + ticketName_(hit.r.ticketId) + " on " + niceDate_(hit.r.date),
        hit.r.name + " cancelled \"" + ticketName_(hit.r.ticketId) + "\" on " + niceDate_(hit.r.date) + ". Coverage is no longer needed.");
    }
    return { ok: true };
  });
}

/* ---------- admins ---------- */
function admin_() {
  const tickets = tickets_(), reqs = requests_(), s = settings_();
  const byTeacher = {};
  reqs.forEach(r => { (byTeacher[r.email] = byTeacher[r.email] || { email: r.email, name: r.name, reqs: [] }).reqs.push(r); });
  const teachers = Object.keys(byTeacher).sort().map(k => ({
    email: byTeacher[k].email, name: byTeacher[k].name, tickets: balances_(tickets, byTeacher[k].reqs, s.period_start),
  }));
  return { ok: true, tickets: tickets, requests: reqs.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt), teachers: teachers, today: today_(), period_start: s.period_start };
}

function decide_(me, req) {
  const s = settings_();
  const status = req.status === "approved" ? "approved" : req.status === "denied" ? "denied" : "";
  if (!status) return { ok: false, error: "bad-request" };
  return withLock_(() => {
    const hit = findRequest_(req.id);
    if (!hit) return { ok: false, error: "not-found" };
    if (hit.r.status !== "pending" && !(hit.r.status === "approved" && status === "denied")) return { ok: false, error: "not-pending" };
    const adminNote = clip_(req.adminNote, LIMITS.adminNote);
    setFields_(hit.row, { status: status, decidedAt: Date.now(), decidedBy: me.email, adminNote: adminNote });
    if (yes_(s.notify)) {
      const name = ticketName_(hit.r.ticketId);
      mail_(hit.r.email, "Your ticket was " + status + ": " + name + " on " + niceDate_(hit.r.date),
        "Your request to use \"" + name + "\" on " + niceDate_(hit.r.date) + " was " + status + "." +
        (status === "denied" ? " The ticket has been returned to you." : "") +
        (adminNote ? "\n\nNote: " + adminNote : "") + (s.page_url ? "\n\n" + s.page_url : ""));
    }
    return { ok: true };
  });
}

/* ---------- data ---------- */
function tickets_() {
  return rows_("tickets").map(r => ({ id: String(r.id).trim(), name: String(r.name).trim(), allowance: Math.max(0, Number(r.allowance) || 0), active: !/^(no|false|0)$/i.test(String(r.active).trim()) }))
    .filter(t => t.id && t.name);
}
function requests_() {
  return rows_("requests").map(r => ({
    id: String(r.id), email: String(r.email).toLowerCase(), name: String(r.name), ticketId: String(r.ticketId), date: String(r.date),
    note: String(r.note || ""), status: String(r.status), createdAt: Number(r.createdAt) || 0,
    decidedAt: Number(r.decidedAt) || null, decidedBy: String(r.decidedBy || ""), adminNote: String(r.adminNote || ""),
  }));
}
function balances_(tickets, reqs, periodStart) {
  return tickets.filter(t => t.active).map(t => {
    const used = reqs.filter(r => r.ticketId === t.id && r.date >= periodStart && ACTIVE.indexOf(r.status) >= 0).length;
    return { id: t.id, name: t.name, allowance: t.allowance, used: used, left: Math.max(0, t.allowance - used) };
  });
}
function settings_() {
  const out = {};
  DEFAULT_SETTINGS.forEach(d => { out[d[0]] = String(d[1]); });
  rows_("settings").forEach(r => { if (r.key) out[String(r.key).trim()] = String(r.value == null ? "" : r.value).trim(); });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.period_start)) out.period_start = "2000-01-01";
  if (!/^\d{1,2}:\d{2}$/.test(out.deadline_time)) out.deadline_time = "08:00";
  return out;
}
function findRequest_(id) {
  const sh = sheet_("requests"), vals = sh.getDataRange().getValues();
  for (let i = 1; i < vals.length; i++) if (String(vals[i][0]) === String(id)) {
    return { row: i + 1, r: requests_().filter(r => r.id === String(id))[0] };
  }
  return null;
}
function setFields_(row, fields) {
  const sh = sheet_("requests"), head = TABS.requests;
  Object.keys(fields).forEach(k => sh.getRange(row, head.indexOf(k) + 1).setValue(String(fields[k])));
}
function ticketName_(id) { const t = tickets_().filter(x => x.id === id)[0]; return t ? t.name : id; }

/* ---------- dates ---------- */
function today_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd"); }
// The first weekday that can still be requested right now.
function earliestDate_(deadlineTime) {
  const tz = Session.getScriptTimeZone();
  for (let i = 0; i < 14; i++) {
    const d = Utilities.formatDate(new Date(Date.now() + i * 864e5), tz, "yyyy-MM-dd");
    const start = Utilities.parseDate(d + " " + deadlineTime, tz, "yyyy-MM-dd HH:mm");
    if (Number(Utilities.formatDate(start, tz, "u")) <= 5 && Date.now() <= start.getTime() - 864e5) return d;
  }
  return "";
}
function niceDate_(d) {
  const tz = Session.getScriptTimeZone();
  return Utilities.formatDate(Utilities.parseDate(d + " 12:00", tz, "yyyy-MM-dd HH:mm"), tz, "EEEE, MMMM d");
}

/* ---------- email ---------- */
function notifyAdmins_(s, subject, body) {
  if (!yes_(s.notify)) return;
  s.admin_emails.split(/[\s,;]+/).filter(String).forEach(a => mail_(a, subject, body));
}
function mail_(to, subject, body) {
  try { MailApp.sendEmail({ to: to, subject: subject, body: body + "\n\n— One Less Thing! Tickets" }); }
  catch (err) { console.error("Email failed", err); }
}

/* ---------- helpers ---------- */
function sheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, TABS[name].length).setValues([TABS[name]]).setFontWeight("bold");
    sh.setFrozenRows(1);
    sh.getRange("A:Z").setNumberFormat("@"); // keep dates and ids as plain text
  }
  return sh;
}
function rows_(name) {
  const vals = sheet_(name).getDataRange().getValues(), head = vals.shift();
  return vals.filter(v => v.some(String)).map(v => Object.fromEntries(head.map((h, i) => [h, v[i]])));
}
function append_(name, obj) { sheet_(name).appendRow(TABS[name].map(k => obj[k] === undefined || obj[k] === null ? "" : String(obj[k]))); }
function clip_(s, n) { return String(s == null ? "" : s).trim().slice(0, n); }
function yes_(v) { return /^(yes|true|on|1)$/i.test(String(v).trim()); }
function withLock_(fn) { const l = LockService.getScriptLock(); l.waitLock(20000); try { return fn(); } finally { l.releaseLock(); } }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/** Run once from the editor: creates the tabs and fills in the starting ticket types and settings. */
function setup() {
  const t = sheet_("tickets");
  if (t.getLastRow() < 2) t.getRange(2, 1, DEFAULT_TICKETS.length, 4).setValues(DEFAULT_TICKETS.map(r => r.map(String)));
  sheet_("requests");
  const s = sheet_("settings");
  if (s.getLastRow() < 2) s.getRange(2, 1, DEFAULT_SETTINGS.length, 3).setValues(DEFAULT_SETTINGS);
  // Ask for email permission now, while you're in the editor.
  MailApp.getRemainingDailyQuota();
}
