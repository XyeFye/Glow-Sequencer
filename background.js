// Glow Theme for Online Sequencer — background worker.
//
// Account switcher. The site keeps you signed in with cookies (MyBB's "remember me" sign-in plus a session id). When a
// page reports that you are signed in, the extension keeps a copy of the site's cookies for that account, in its own
// database. Switching clears the site's cookies, puts that account's copy back and reloads; adding an account clears them
// so you can sign in to another one. It does not depend on the cookies' names, so it keeps working if the site renames
// them. The site's own Log out is never used for switching, so saved sign-ins stay valid. Passwords are never seen or
// stored: you sign in to each account yourself, once. If you use the site's Log out, that account's saved sign-in is
// forgotten (you meant to sign out). Nothing here is ever sent anywhere but onlinesequencer.net.
//
// Comment index. Content scripts report the comments they see; the index lives in db.js.
import { kvGet, kvSet, mergeSequenceComments, addSeqs, byIndex, del } from "./db.js";
import { saveEntry, saveFromSite, sequenceMeta, fetchPreview, getEntry, toB64, fromB64 } from "./lib.js";
import { makeBackup, summary, FILE as BACKUP_FILE, isEmpty } from "./backup.js";

const SITE = "https://onlinesequencer.net/";
const SITE_RE = /^https:\/\/([a-z0-9-]+\.)?onlinesequencer\.net\//i;
const DOMAIN = "onlinesequencer.net";

// ---------- cookies ----------
// In current Chromium-based browsers (seen in Opera 138 / Chromium 154) chrome.cookies.getAll() returns nothing for a
// site, while get / set / remove of a cookie *by name* work, HttpOnly ones included. So the extension keeps a list of the
// site's cookie names — the MyBB ones the site is known to use, plus every name it sees in the Cookie header your browser
// sends to onlinesequencer.net (names only; values are read with chrome.cookies.get when an account is saved).
const KNOWN = ["mybbuser", "sid", "loginattempts", "failedlogin", "mybb[lastvisit]", "mybb[lastactive]", "mybb[threadread]", "mybb[forumread]", "mybb[announcements]", "PHPSESSID"];
const PATHS = ["/", "/forum/", "/ajax/"];
let learned = null;   // Set of names, kept in kv "cookieNames"
async function names() { if (!learned) learned = new Set((await kvGet("cookieNames", [])) || []); return [...new Set([...KNOWN, ...learned])]; }
let learnT = 0;
async function learnNames(list) {
  await names(); let added = false;
  for (const n of list) { const x = String(n || "").trim(); if (x && x.length < 120 && !learned.has(x) && learned.size < 300) { learned.add(x); added = true; } }
  if (added) { clearTimeout(learnT); learnT = setTimeout(() => kvSet("cookieNames", [...learned]), 500); }
}
if (chrome.webRequest && chrome.webRequest.onSendHeaders) {
  try {
    chrome.webRequest.onSendHeaders.addListener((d) => {
      const h = (d.requestHeaders || []).find((x) => x.name.toLowerCase() === "cookie"); if (!h || !h.value) return;
      learnNames(h.value.split(";").map((part) => part.split("=")[0]));
    }, { urls: ["https://onlinesequencer.net/*", "https://*.onlinesequencer.net/*"], types: ["main_frame", "sub_frame", "xmlhttprequest"] }, ["requestHeaders", "extraHeaders"]);
    // …and the moment the site sets one (signing in sets the sign-in cookies before any request has carried them)
    chrome.webRequest.onHeadersReceived.addListener((d) => {
      const set = (d.responseHeaders || []).filter((x) => x.name.toLowerCase() === "set-cookie"); if (!set.length) return;
      learnNames(set.flatMap((x) => String(x.value || "").split("\n")).map((line) => line.split("=")[0]));
    }, { urls: ["https://onlinesequencer.net/*", "https://*.onlinesequencer.net/*"], types: ["main_frame", "sub_frame", "xmlhttprequest"] }, ["responseHeaders", "extraHeaders"]);
  } catch (e) {}
}
const siteCookies = async () => {
  const out = new Map(), add = (c) => { if (c && /(^|\.)onlinesequencer\.net$/i.test(String(c.domain).replace(/^\./, ""))) out.set(c.name + "|" + c.domain + "|" + c.path, c); };
  for (const n of await names()) for (const p of PATHS) { try { add(await chrome.cookies.get({ url: "https://onlinesequencer.net" + p, name: n })); } catch (e) {} }
  try { for (const c of await chrome.cookies.getAll({ domain: DOMAIN })) add(c); } catch (e) {}   // where the browser still lists them
  return [...out.values()];
};
const cookieUrl = (c) => `https://${String(c.domain || DOMAIN).replace(/^\./, "")}${c.path || "/"}`;
const keep = (c) => ({ name: c.name, value: c.value, domain: c.domain, hostOnly: c.hostOnly, path: c.path, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite, session: c.session, expirationDate: c.expirationDate });
async function snapshot() { return (await siteCookies()).map(keep); }
async function clearSite() {
  let failed = 0;
  for (const c of await siteCookies()) { try { const r = await chrome.cookies.remove({ url: cookieUrl(c), name: c.name }); if (!r) failed++; } catch (e) { failed++; } }
  return failed;
}
async function restore(jar) {
  const now = Date.now() / 1000; let failed = 0;
  for (const c of jar || []) {
    if (!c.session && c.expirationDate && c.expirationDate < now) continue;
    const d = { url: cookieUrl(c), name: c.name, value: c.value, path: c.path || "/", secure: !!c.secure, httpOnly: !!c.httpOnly };
    if (!c.hostOnly && c.domain) d.domain = c.domain;
    if (c.sameSite) d.sameSite = c.sameSite;
    if (!c.session && c.expirationDate) d.expirationDate = c.expirationDate;
    try { if (!(await chrome.cookies.set(d))) failed++; } catch (e) { failed++; }
  }
  return failed;
}
async function switchJar(jar) { await clearSite(); return restore(jar); }

// ---------- the saved accounts ----------
async function accounts() {
  const a = (await kvGet("accounts", null)) || { list: [] };
  for (const x of a.list) if (x.cookie && !x.jar) { x.jar = [x.cookie]; delete x.cookie; }   // 2.21.0 kept one cookie only
  return a;
}
const saveAccounts = (a) => kvSet("accounts", a);
const currentUid = async () => (await kvGet("current", "")) || "";
const forPage = (a, curUid) => a.list.map((x) => ({ uid: x.uid, name: x.name, avatar: x.avatar || "", signedOut: !x.jar, current: x.uid === curUid, usedAt: x.usedAt || 0 }));
async function listForPage() { const cur = await currentUid(); return { accounts: forPage(await accounts(), cur), current: cur }; }
async function upsert(uid, fields) {
  const a = await accounts(); let x = a.list.find((y) => y.uid === uid);
  if (!x) { x = { uid, name: "", avatar: "", jar: null, addedAt: Date.now() }; a.list.push(x); }
  for (const k in fields) if (fields[k] !== undefined && !(k !== "jar" && fields[k] === "")) x[k] = fields[k];
  await saveAccounts(a); return x;
}
async function captureCurrent(uid, name, avatar) {   // the site's cookies, as they are while `uid` is signed in → saved
  const jar = await snapshot(); await kvSet("current", uid);
  if (!jar.length) { await logProblem("signed in as #" + uid + " but the browser shows no cookies for onlinesequencer.net"); return null; }
  await upsert(uid, { jar, name, avatar }); return uid;
}
async function knownUids() {
  const a = await accounts(); const s = await chrome.storage.local.get({ meUid: "" });
  return [...new Set([...a.list.map((x) => x.uid), s.meUid].filter((u) => /^\d+$/.test(u) && u !== "0"))];
}
async function logProblem(text) { const l = (await kvGet("problems", [])) || []; l.unshift({ at: new Date().toISOString(), text: String(text).slice(0, 300) }); await kvSet("problems", l.slice(0, 20)); }

// ---------- switching ----------
async function siteTab(preferId) {
  if (preferId != null) { try { const t = await chrome.tabs.get(preferId); if (SITE_RE.test(t.url || "")) return t; } catch (e) {} }
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true, url: ["https://onlinesequencer.net/*", "https://*.onlinesequencer.net/*"] });
  if (active) return active;
  const any = await chrome.tabs.query({ url: ["https://onlinesequencer.net/*", "https://*.onlinesequencer.net/*"] });
  return any.sort((p, q) => (q.lastAccessed || 0) - (p.lastAccessed || 0))[0] || null;
}
// reload the site tab (or open one), with `pending` recorded for it first so its next report can be matched
async function reloadOrOpen(tab, pending) {
  if (tab) { await kvSet("pending", { ...pending, tabId: tab.id, at: Date.now() }); await chrome.tabs.reload(tab.id); return tab.id; }
  const t = await chrome.tabs.create({ url: SITE, active: true }); await kvSet("pending", { ...pending, tabId: t.id, at: Date.now() }); return t.id;
}
async function pendingNow() {   // a switch settles within seconds; an add waits for you to sign in (10 minutes at most)
  const p = await kvGet("pending", null); if (!p) return null;
  if (Date.now() - p.at > (p.kind === "add" ? 10 : 3) * 60e3) { await kvSet("pending", null); return null; }
  return p;
}
async function tellOtherTabs(exceptId, message) {
  const tabs = await chrome.tabs.query({ url: ["https://onlinesequencer.net/*", "https://*.onlinesequencer.net/*"] });
  for (const t of tabs) if (t.id !== exceptId) chrome.tabs.sendMessage(t.id, message).catch(() => {});
}
async function switchTo(uid, tabId) {
  const a = await accounts(), x = a.list.find((y) => y.uid === uid);
  if (!x) return { error: "That account isn't saved any more." };
  if (!x.jar) return { error: `${x.name || "That account"} is signed out. Use “Add account” and sign in to it again.` };
  const curUid = await currentUid();
  if (curUid === uid) return { ok: true, same: true };
  const failed = await switchJar(x.jar);
  if (failed) await logProblem(`switch to #${uid}: ${failed} cookie(s) could not be set`);
  x.usedAt = Date.now(); await saveAccounts(a);
  const id = await reloadOrOpen(await siteTab(tabId), { kind: "switch", target: uid, prev: curUid });
  tellOtherTabs(id, { type: "acc:changed", name: x.name || "another account" });
  return { ok: true };
}
async function beginAdd(tabId) {
  const curUid = await currentUid();
  const failed = await clearSite();
  const left = (await siteCookies()).length;
  if (failed || left) await logProblem(`add: ${failed} cookie(s) could not be removed, ${left} left afterwards`);
  const id = await reloadOrOpen(await siteTab(tabId), { kind: "add", prev: curUid });
  tellOtherTabs(id, { type: "acc:changed", name: "" });
  return { ok: true };
}
async function cancelAdd(tabId) {
  const p = await pendingNow(); await kvSet("pending", null);
  if (p && p.kind === "add" && p.prev) return switchTo(p.prev, tabId);
  return { ok: true };
}
async function removeAccount(uid) { const a = await accounts(); a.list = a.list.filter((y) => y.uid !== uid); await saveAccounts(a); return { ok: true }; }

// A page reports who is signed in. That keeps the saved sign-in fresh and settles a pending switch / add.
async function onState(msg, tab) {
  if (Array.isArray(msg.cookieNames)) await learnNames(msg.cookieNames.slice(0, 100));
  const name = String(msg.name || "").slice(0, 80), avatar = String(msg.avatar || "").slice(0, 300);
  const p = await pendingNow();
  let notice = (await kvGet("notice", null)); if (notice && Date.now() - notice.at > 60e3) notice = null; if (notice) await kvSet("notice", null);
  let adding = false;
  if (msg.state === "member" && /^\d+$/.test(msg.uid || "") && msg.uid !== "0") {
    const uid = msg.uid;
    if (p && p.kind === "add" && p.tabId === tab.id && uid === p.prev) {
      // still signed in after the cookies were cleared: the site kept the session some other way
      await kvSet("pending", null); await kvSet("current", uid);
      await logProblem("add: still signed in as #" + uid + " after clearing cookies");
      notice = { text: `Couldn't sign you out to add an account — the site kept ${name} signed in. Try Add account once more; if it still happens, use “Copy troubleshooting info” in the extension's popup and send it over.` };
      return { ...(await listForPage()), adding: false, notice: notice.text };
    }
    await captureCurrent(uid, name, avatar);
    if (p && p.kind === "switch" && p.tabId === tab.id) { await kvSet("pending", null); if (uid === p.target && !p.revert) notice = { text: `Signed in as ${name}.` }; }
    if (p && p.kind === "add" && p.tabId === tab.id && uid !== p.prev) { await kvSet("pending", null); notice = { text: `Added ${name}. Switch between accounts from your name at the top.` }; }
  } else if (msg.state === "guest") {
    await kvSet("current", "");
    if (p && p.kind === "switch" && p.tabId === tab.id) {
      // the saved sign-in no longer works (signed out elsewhere, or the site reset it): forget it, go back
      await kvSet("pending", null);
      const a = await accounts(), x = a.list.find((y) => y.uid === p.target); if (x) { x.jar = null; await saveAccounts(a); }
      await logProblem(`switch to #${p.target}: the site showed you signed out`);
      const back = p.prev && a.list.find((y) => y.uid === p.prev && y.jar);
      await kvSet("notice", { text: `${x?.name || "That account"}'s saved sign-in has expired — use “Add account” to sign in to it again.`, at: Date.now() });
      if (back) { await switchJar(back.jar); await kvSet("pending", { kind: "switch", target: back.uid, prev: "", revert: true, tabId: tab.id, at: Date.now() }); chrome.tabs.reload(tab.id); return { reloading: true }; }
      notice = await kvGet("notice", null); await kvSet("notice", null);
    } else if (p && p.kind === "add") adding = true;
  }
  return { ...(await listForPage()), adding, notice: notice ? notice.text : "" };
}
async function onLoggedOut(uid) {   // the site's own Log out: that account is meant to be signed out
  await kvSet("current", "");
  if (await pendingNow()) return { ok: true };
  const a = await accounts(), x = a.list.find((y) => y.uid === uid); if (x) { x.jar = null; await saveAccounts(a); }
  return { ok: true };
}
// What to send when something doesn't work: cookie names and flags only — never their values.
async function diagnostics() {
  const describe = (c) => `${c.name} @${c.domain}${c.path}${c.httpOnly ? " httpOnly" : ""}${c.secure ? " secure" : ""}${c.session ? " session" : ""}${c.sameSite ? " " + c.sameSite : ""}`;
  const a = await accounts(), now = await siteCookies();
  return [
    `Glow Theme ${chrome.runtime.getManifest().version} · ${navigator.userAgent}`,
    `current account: ${(await currentUid()) || "none"}`,
    `cookie names known: ${(await names()).length} · browser lists: ${(await chrome.cookies.getAll({ domain: DOMAIN }).catch(() => [])).length}`,
    `pending: ${JSON.stringify(await kvGet("pending", null))}`,
    `saved accounts:`, ...a.list.map((x) => `  #${x.uid} ${x.name} — ${x.jar ? x.jar.length + " cookies: " + x.jar.map((c) => c.name).join(", ") : "signed out"}`),
    `cookies now (${now.length}):`, ...now.map((c) => "  " + describe(c)),
    `recent problems:`, ...((await kvGet("problems", [])) || []).map((x) => `  ${x.at} ${x.text}`),
  ].join("\n");
}

// ---------- comments ----------
async function onComments(msg) {
  const seq = String(msg.seq || ""); if (!/^\d+$/.test(seq) || !Array.isArray(msg.comments)) return { ok: false };
  const uids = await knownUids(); if (!uids.length) return { ok: true, mine: 0 };
  const clean = (c) => ({ id: String(c.id), uid: String(c.uid), name: String(c.name || "").slice(0, 80), date: String(c.date || "").slice(0, 40), ts: +c.ts || 0, text: String(c.text || "").slice(0, 5000), links: (c.links || []).slice(0, 20).map(String), parent: String(c.parent || ""), parentName: String(c.parentName || "").slice(0, 80), parentUid: String(c.parentUid || ""), parentText: String(c.parentText || "").slice(0, 200) });
  const mine = msg.comments.filter((c) => uids.includes(String(c.uid)) && /^\d+$/.test(String(c.id))).map(clean);
  await mergeSequenceComments(seq, uids, mine, { title: String(msg.title || "").slice(0, 200), force: true, source: "visited" });
  // the comment list also shows each of your accounts' current avatar
  const a = await accounts(); let ch = false;
  for (const c of msg.comments) { const x = a.list.find((y) => y.uid === String(c.uid)); if (x && c.avatar && x.avatar !== c.avatar) { x.avatar = String(c.avatar).slice(0, 300); ch = true; } }
  if (ch) await saveAccounts(a);
  return { ok: true, mine: mine.length };
}

// ---------- the sequence library ----------
async function libSaveFromEditor(m) {
  const bytes = fromB64(String(m.data || "")); const seqId = /^\d+$/.test(String(m.seqId || "")) ? String(m.seqId) : "";
  let thumb = null; if (/^data:image\/png;base64,/.test(String(m.picture || ""))) { try { thumb = await (await fetch(m.picture)).blob(); } catch (e) {} }
  if (!thumb && seqId) thumb = await fetchPreview(seqId);
  const meta = seqId ? await sequenceMeta(seqId).catch(() => ({})) : {};
  const r = await saveEntry({ bytes, title: String(m.title || meta.title || "Untitled"), seqId, creatorUid: meta.creatorUid || "", creatorName: meta.creatorName || "", thumb, source: "editor" });
  return { ok: true, duplicate: r.duplicate, title: r.entry.title, notes: r.entry.notes };
}
// a save on the site: keep it as a version of that sequence (exact repeats are skipped; the newest 50 saves of each are kept)
const KEEP_VERSIONS = 50;
// ---------- keeping your data safe, and the extension up to date ----------
// Backups: once a day, a few minutes after the library changes, and right after the extension updates, everything it
// keeps (but never saved sign-ins — see backup.js) is written to Downloads/"Glow Theme backup/glow-backup.json".
// The file is made in a hidden extension page (a service worker can't hand a large file to the downloads list).
async function blobUrlFor(text) {
  if (!chrome.offscreen) return null;
  try { if (!(await chrome.offscreen.hasDocument())) await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["BLOBS"], justification: "Write the backup file of your settings and Sequence library" }); }
  catch (e) { if (!/single offscreen|already/i.test(String(e && e.message))) return null; }
  const r = await chrome.runtime.sendMessage({ type: "osg-offscreen:blob", text }); return r && r.url ? r.url : null;
}
let backingUp = null;
async function backupNow(why) {
  if (backingUp) return backingUp;
  backingUp = (async () => {
    if (!chrome.downloads) return { error: "The extension needs its Downloads permission to write backups — reload it on the extensions page." };
    const b = await makeBackup(), text = JSON.stringify(b), info = summary(b);
    let url = await blobUrlFor(text);
    if (!url) { if (text.length > 1.5e6) return { error: "Couldn't write the backup file here." }; url = "data:application/json;base64," + toB64(new TextEncoder().encode(text)); }
    let ui = false; try { if (chrome.downloads.setUiOptions) { await chrome.downloads.setUiOptions({ enabled: false }); ui = true; } } catch (e) {}
    try {
      const id = await chrome.downloads.download({ url, filename: BACKUP_FILE, conflictAction: "overwrite", saveAs: false });
      await new Promise((res) => { const t = setTimeout(res, 20000); const on = (d) => { if (d.id === id && d.state && /complete|interrupted/.test(d.state.current)) { clearTimeout(t); chrome.downloads.onChanged.removeListener(on); res(); } }; chrome.downloads.onChanged.addListener(on); });
      const [d] = await chrome.downloads.search({ id });
      // keep the downloads list tidy: only the newest backup stays listed (the restore page finds it there after a reinstall)
      try { for (const o of await chrome.downloads.search({ filenameRegex: "glow-backup\\.json$" })) if (o.id !== id && o.byExtensionId === chrome.runtime.id) await chrome.downloads.erase({ id: o.id }); } catch (e) {}
      const rec = { at: Date.now(), why: why || "", bytes: text.length, path: d && d.filename || "", ...info };
      await chrome.storage.local.set({ osgLastBackup: rec, osgBackupDirty: false });
      return { ok: true, ...rec };
    } finally {
      if (ui) try { await chrome.downloads.setUiOptions({ enabled: true }); } catch (e) {}
      if (/^blob:/.test(url)) try { await chrome.runtime.sendMessage({ type: "osg-offscreen:revoke", url }); await chrome.offscreen.closeDocument(); } catch (e) {}
    }
  })().catch((e) => ({ error: String(e && e.message || e) })).finally(() => { backingUp = null; });
  return backingUp;
}
function backupSoon() { try { chrome.storage.local.set({ osgBackupDirty: true }); chrome.alarms && chrome.alarms.create("osg-backup-soon", { delayInMinutes: 3 }); } catch (e) {} }

// Updates. The extension runs from a folder, so new versions arrive as new files in it — copied by the GitHub updater
// (updater/), synced by OneDrive, or replaced by hand. Every minute it checks the manifest on disk; once the same newer
// version shows up twice in a row (so a copy in progress is finished), it reloads itself into the new version. Your data
// stays: it belongs to the extension, not to its files. With a GitHub repo set in update.json it also checks GitHub every
// few hours and says when a newer version is out. A copy installed from the Opera add-ons store does neither (Opera
// updates it).
let channel = null;
async function updateChannel() { if (channel) return channel; try { channel = await (await fetch(chrome.runtime.getURL("update.json"), { cache: "no-store" })).json(); } catch (e) { channel = {}; } return channel; }
const newer = (a, b) => { const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
let diskSeen = "";
async function checkDisk() {
  if ((await updateChannel()).channel === "store") return;
  let v = ""; try { v = (await (await fetch(chrome.runtime.getURL("manifest.json"), { cache: "no-store" })).json()).version || ""; } catch (e) { return; }
  const running = chrome.runtime.getManifest().version;
  if (!v || v === running) { diskSeen = ""; return; }
  if (diskSeen !== v) { diskSeen = v; await chrome.storage.local.set({ osgDiskSeen: v }); return; }   // seen once: wait for the next check
  chrome.runtime.reload();
}
async function checkGitHub() {
  const c = await updateChannel(); if (c.channel === "store" || !/^[\w.-]+\/[\w.-]+$/.test(String(c.repo || ""))) return null;
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${c.repo}/${c.branch || "main"}/manifest.json`, { cache: "no-store" }); if (!r.ok) return null;
    const v = String((await r.json()).version || ""), running = chrome.runtime.getManifest().version;
    const info = newer(v, running) ? { version: v, repo: c.repo, at: Date.now() } : null;
    await chrome.storage.local.set({ osgUpdate: info });
    try { chrome.action.setBadgeText({ text: info ? "NEW" : "" }); if (info) chrome.action.setBadgeBackgroundColor({ color: "#7c5cff" }); } catch (e) {}
    return info;
  } catch (e) { return null; }
}
if (chrome.alarms) {
  chrome.alarms.create("osg-backup", { periodInMinutes: 1440, delayInMinutes: 60 });
  chrome.alarms.create("osg-disk", { periodInMinutes: 1 });
  chrome.alarms.create("osg-github", { periodInMinutes: 360, delayInMinutes: 2 });
  chrome.alarms.onAlarm.addListener((a) => {
    if (a.name === "osg-backup") backupNow("daily");
    else if (a.name === "osg-backup-soon") chrome.storage.local.get({ osgBackupDirty: false }, (v) => { if (v.osgBackupDirty) backupNow("library changed"); });
    else if (a.name === "osg-disk") checkDisk();
    else if (a.name === "osg-github") checkGitHub();
  });
}
chrome.runtime.onInstalled.addListener(async (d) => {
  if (d.reason === "update") { setTimeout(() => backupNow(`updated to ${chrome.runtime.getManifest().version}`), 15000); checkGitHub(); }
  if (d.reason === "install") { try { if (await isEmpty()) chrome.tabs.create({ url: chrome.runtime.getURL("restore.html#welcome") }); } catch (e) {} }
});

async function libSaveVersion(m) {
  const bytes = fromB64(String(m.data || "")); const seqId = /^\d+$/.test(String(m.seqId || "")) ? String(m.seqId) : ""; if (!seqId) return { error: "no sequence" };
  let thumb = null; if (/^data:image\/png;base64,/.test(String(m.picture || ""))) { try { thumb = await (await fetch(m.picture)).blob(); } catch (e) {} }
  const r = await saveEntry({ bytes, title: String(m.title || "Untitled"), seqId, creatorUid: String(m.creatorUid || "").replace(/\D/g, ""), creatorName: String(m.creatorName || "").slice(0, 80), thumb, source: m.source === "seen" ? "seen" : "save" });
  const all = await byIndex("library", "seqId", seqId);
  const saves = all.filter((e) => e.source === "save").sort((a, b) => b.savedAt - a.savedAt);
  if (saves.length > KEEP_VERSIONS) await del("library", saves.slice(KEEP_VERSIONS).map((e) => e.key));
  return { ok: true, duplicate: r.duplicate, title: r.entry.title, versions: all.length - Math.max(0, saves.length - KEEP_VERSIONS) };
}
async function libVersions(seqId) { seqId = String(seqId || "").replace(/\D/g, ""); if (!seqId) return { ok: true, count: 0 }; const all = await byIndex("library", "seqId", seqId); return { ok: true, count: all.length, last: all.reduce((a, e) => Math.max(a, e.savedAt || 0), 0) }; }
async function libGet(key) { const e = await getEntry(String(key)); if (!e) return { error: "That sequence isn't in your library any more." }; return { ok: true, data: toB64(e.bytes), title: e.title }; }

// ---------- messages ----------
const fromSite = (sender) => sender.id === chrome.runtime.id && sender.tab && SITE_RE.test(sender.url || sender.tab.url || "");
const fromExtension = (sender) => sender.id === chrome.runtime.id && String(sender.url || "").startsWith(chrome.runtime.getURL(""));
const handlers = {
  "acc:state": (m, s) => fromSite(s) && onState(m, s.tab),
  "acc:list": (m, s) => (fromSite(s) || fromExtension(s)) && listForPage(),
  "acc:switch": (m, s) => (fromSite(s) || fromExtension(s)) && switchTo(String(m.uid), s.tab ? s.tab.id : null),
  "acc:add": (m, s) => (fromSite(s) || fromExtension(s)) && beginAdd(s.tab ? s.tab.id : null),
  "acc:cancelAdd": (m, s) => (fromSite(s) || fromExtension(s)) && cancelAdd(s.tab ? s.tab.id : null),
  "acc:remove": (m, s) => (fromSite(s) || fromExtension(s)) && removeAccount(String(m.uid)),
  "acc:loggedOut": (m, s) => fromSite(s) && onLoggedOut(String(m.uid)),
  "acc:diag": (m, s) => fromExtension(s) && diagnostics().then((text) => ({ text })),
  "cm:found": (m, s) => fromSite(s) && onComments(m),
  "cm:seen": (m, s) => fromSite(s) && addSeqs([{ id: String(m.seq), title: String(m.title || "").slice(0, 200), force: true }], "visited").then(() => ({ ok: true })),
  "lib:saveEditor": (m, s) => fromSite(s) && libSaveFromEditor(m).then((r) => (backupSoon(), r)),
  "lib:saveSite": (m, s) => (fromSite(s) || fromExtension(s)) && saveFromSite(String(m.seqId)).then((r) => (backupSoon(), { ok: true, duplicate: r.duplicate, title: r.entry.title })),
  "lib:get": (m, s) => fromSite(s) && libGet(m.key),
  "lib:saveVersion": (m, s) => fromSite(s) && libSaveVersion(m).then((r) => { if (r && r.ok && !r.duplicate) backupSoon(); return r; }),
  "lib:versions": (m, s) => fromSite(s) && libVersions(m.seqId),
  "lib:history": (m, s) => fromSite(s) && chrome.tabs.create({ url: chrome.runtime.getURL("library.html") + "#seq=" + String(m.seqId || "").replace(/\D/g, "") }).then(() => ({ ok: true })),
  "lib:open": (m, s) => fromExtension(s) && chrome.tabs.create({ url: SITE + "#osglib=" + encodeURIComponent(String(m.key)) }).then(() => ({ ok: true })),
  "open:library": (m, s) => (fromSite(s) || fromExtension(s)) && chrome.tabs.create({ url: chrome.runtime.getURL("library.html") }).then(() => ({ ok: true })),
  "open:backup": (m, s) => (fromSite(s) || fromExtension(s)) && chrome.tabs.create({ url: chrome.runtime.getURL("restore.html") }).then(() => ({ ok: true })),
  "backup:now": (m, s) => fromExtension(s) && backupNow("by hand"),
  "backup:dirty": (m, s) => fromExtension(s) && (backupSoon(), { ok: true }),
  "update:check": (m, s) => fromExtension(s) && checkGitHub().then((u) => ({ ok: true, update: u })),
  "cm:uids": (m, s) => (fromSite(s) || fromExtension(s)) && knownUids(),
  "open:comments": (m, s) => (fromSite(s) || fromExtension(s)) && chrome.tabs.create({ url: chrome.runtime.getURL("comments.html") + (m.q ? "#q=" + encodeURIComponent(String(m.q).slice(0, 200)) : "") }).then(() => ({ ok: true })),
};
const NO_COOKIES = "The extension isn't allowed to manage cookies yet, so it can't switch accounts. Open the extensions page, find Glow Theme for Online Sequencer and allow its new permission (or remove it and load it again).";
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const h = msg && handlers[msg.type]; if (!h) return false;
  if (/^acc:(state|switch|add|cancelAdd)$/.test(msg.type) && !chrome.cookies) { reply({ error: NO_COOKIES }); return false; }
  Promise.resolve().then(() => h(msg, sender)).then((r) => reply(r === false ? { error: "not allowed" } : r), (e) => reply({ error: String(e && e.message || e) }));
  return true;
});
