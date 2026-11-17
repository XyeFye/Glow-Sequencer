// Glow Theme — the Backup & updates page: bring back a backup, write one now, and see how this copy updates.
import { makeBackup, restoreBackup, summary, FORMAT } from "./backup.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ago = (t) => { const s = (Date.now() - t) / 1000; return s < 90 ? "just now" : s < 5400 ? `${Math.round(s / 60)} minutes ago` : s < 129600 ? `${Math.round(s / 3600)} hours ago` : `${Math.round(s / 86400)} days ago`; };
const size = (n) => (n > 1e6 ? (n / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1e3)) + " KB");
const send = (m) => new Promise((res) => { try { chrome.runtime.sendMessage(m, (r) => res(chrome.runtime.lastError ? { error: chrome.runtime.lastError.message } : r)); } catch (e) { res({ error: String(e) }); } });
const say = (el, html, kind) => { el.hidden = false; el.className = "msg" + (kind ? " " + kind : ""); el.innerHTML = html; };

chrome.storage.local.get({ accent: "#7c5cff" }, ({ accent }) => {
  const h = accent.replace("#", ""), n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  document.documentElement.style.setProperty("--accent", accent); document.documentElement.style.setProperty("--accent-rgb", [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(", "));
});
$("#ver").textContent = chrome.runtime.getManifest().version;
if (/welcome/.test(location.hash)) $("#hello").hidden = false;

// ---- restoring ----
let pending = null;
const facts = (s) => `<div class="fact"><b>${s.sequences}</b><small>sequences in the library</small></div><div class="fact"><b>${s.library}</b><small>saved versions</small></div><div class="fact"><b>${s.comments}</b><small>comments indexed</small></div><div class="fact"><b>${s.settings}</b><small>settings</small></div>`;
function show(data, from) {
  if (!data || data.format !== FORMAT) { say($("#result"), "That file isn't a Glow Theme backup.", "bad"); return; }
  pending = data; const s = summary(data);
  $("#facts").innerHTML = facts(s); $("#preview").hidden = false; $("#result").hidden = true;
  say($("#found"), `Backup from <b>${esc(s.madeAt ? new Date(s.madeAt).toLocaleString() : "an unknown date")}</b>${s.extVersion ? ` (version ${esc(s.extVersion)})` : ""}${from ? ` — <span class="path">${esc(from)}</span>` : ""}`, "good");
}
async function readFile(f) { try { show(JSON.parse(await f.text()), f.name); } catch (e) { say($("#result"), "Couldn't read that file: " + esc(e.message || e), "bad"); } }
$("#file").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) readFile(f); });
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) readFile(f); });

// the newest backup in this browser's downloads list (it's still listed after the extension is reinstalled)
$("#find").addEventListener("click", async () => {
  const b = $("#find"); b.disabled = true;
  try {
    if (!chrome.downloads) { say($("#found"), "This copy can't look through your downloads — choose the file instead.", "bad"); return; }
    const list = (await chrome.downloads.search({ filenameRegex: "glow-backup[^\\\\/]*\\.json$", orderBy: ["-startTime"], limit: 20 })).filter((d) => d.state === "complete" && d.exists !== false);
    if (!list.length) { say($("#found"), `No backup listed in this browser's downloads. On another computer, copy <code>Downloads/Glow Theme backup/glow-backup.json</code> from the old one and choose it here.`); return; }
    const d = list[0], url = "file:///" + d.filename.replace(/\\/g, "/").replace(/^\/+/, "");
    try { const r = await fetch(url); if (!r.ok) throw new Error(r.status); show(await r.json(), d.filename); }
    catch (e) {
      say($("#found"), `Found it: <span class="path">${esc(d.filename)}</span> (${esc(new Date(d.startTime).toLocaleString())}).<br>Click <b>Choose a backup file…</b> and pick that file — or turn on <b>Allow access to file URLs</b> for Glow Theme on the extensions page, and this button opens it for you.`);
    }
  } finally { b.disabled = false; }
});
$("#cancel").addEventListener("click", () => { pending = null; $("#preview").hidden = true; $("#found").hidden = true; });
$("#doRestore").addEventListener("click", async () => {
  if (!pending) return; const b = $("#doRestore"); b.disabled = true; b.textContent = "Restoring…";
  try {
    const r = await restoreBackup(pending);
    $("#preview").hidden = true; pending = null;
    say($("#result"), `Done — ${r.library} library version${r.library === 1 ? "" : "s"}, ${r.comments} comment${r.comments === 1 ? "" : "s"} and ${r.settings} setting${r.settings === 1 ? "" : "s"} brought back. Reload your Online Sequencer tabs to see your settings. <a href="library.html">Open the Sequence library →</a>`, "good");
    send({ type: "backup:dirty" }); lastInfo();
  } catch (e) { say($("#result"), esc(e.message || e), "bad"); }
  b.disabled = false; b.textContent = "Restore";
});

// ---- backing up ----
async function lastInfo() {
  const { osgLastBackup: l } = await chrome.storage.local.get({ osgLastBackup: null });
  $("#last").innerHTML = l ? `<div class="fact"><b>${esc(ago(l.at))}</b><small>last backup${l.why ? ` (${esc(l.why)})` : ""}</small></div><div class="fact"><b>${l.sequences ?? "–"}</b><small>sequences in it</small></div><div class="fact"><b>${esc(size(l.bytes || 0))}</b><small>file size</small></div>${l.path ? `<div class="fact" style="grid-column: 1 / -1"><small>saved to</small><div class="path">${esc(l.path)}</div></div>` : ""}`
    : `<div class="fact"><b>Not yet</b><small>the first one is written within the hour</small></div>`;
}
lastInfo();
$("#now").addEventListener("click", async () => {
  const b = $("#now"); b.disabled = true; b.textContent = "Backing up…";
  const r = await send({ type: "backup:now" });
  if (r && r.ok) say($("#nowMsg"), `Backed up ${r.sequences} sequence${r.sequences === 1 ? "" : "s"} (${esc(size(r.bytes))}).`, "good"); else say($("#nowMsg"), esc((r && r.error) || "Couldn't write the backup."), "bad");
  b.disabled = false; b.textContent = "Back up now"; lastInfo();
});
$("#saveAs").addEventListener("click", async () => {
  const b = $("#saveAs"); b.disabled = true;
  try {
    const data = await makeBackup(), url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
    const day = new Date().toISOString().slice(0, 10);
    if (chrome.downloads) await chrome.downloads.download({ url, filename: `glow-backup-${day}.json`, saveAs: true });
    else { const a = document.createElement("a"); a.href = url; a.download = `glow-backup-${day}.json`; a.click(); }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) { say($("#nowMsg"), esc(e.message || e), "bad"); }
  b.disabled = false;
});

// ---- updates ----
async function updates() {
  let c = {}; try { c = await (await fetch(chrome.runtime.getURL("update.json"), { cache: "no-store" })).json(); } catch (e) {}
  const { osgUpdate: u } = await chrome.storage.local.get({ osgUpdate: null });
  if (u && u.version) { $("#updNew").classList.add("on"); $("#updNewText").innerHTML = `Version <b>${esc(u.version)}</b> is out. ${c.channel === "github" ? `If this computer has the updater, it arrives on its own within the hour; otherwise <a href="https://github.com/${esc(u.repo)}" target="_blank" rel="noopener">get it from GitHub</a>.` : ""}`; }
  $("#updHow").innerHTML = c.channel === "store" ? "This copy came from the Opera add-ons store: Opera keeps it up to date."
    : c.channel === "github" && c.repo ? `This copy updates from <a href="https://github.com/${esc(c.repo)}" target="_blank" rel="noopener">github.com/${esc(c.repo)}</a>. With the updater installed (run <code>updater/Install auto-updates.cmd</code> once), new versions are copied into this folder every hour and Glow Theme reloads itself into them — your data stays.`
    : "This copy runs from a folder. When newer files land in it — copied by the updater, synced by OneDrive, or replaced by hand — Glow Theme notices within a minute or two and reloads itself into the new version. Your data stays.";
  $("#check").hidden = !(c.channel === "github" && c.repo);
}
updates();
$("#check").addEventListener("click", async () => {
  const r = await send({ type: "update:check" });
  say($("#updMsg"), r && r.update ? `Version ${esc(r.update.version)} is available.` : r && r.ok ? "You have the newest version." : "Couldn't reach GitHub right now.", r && r.update ? "good" : "");
  updates();
});
