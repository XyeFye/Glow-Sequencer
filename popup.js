const DEFAULTS = { accent: "#7c5cff", style: "glow", tint: 1, animations: true, hideAds: true, gridTheme: true };

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(", ");
}

function renderAccent(accent) {
  document.documentElement.style.setProperty("--accent", accent);
  document.documentElement.style.setProperty("--accent-rgb", hexToRgb(accent));
  document.querySelectorAll(".swatch").forEach((s) => {
    s.classList.toggle("active", s.dataset.color.toLowerCase() === accent.toLowerCase());
  });
  document.getElementById("customColor").value = accent;
}

function renderStyle(style) {
  document.querySelectorAll(".style").forEach((s) => s.classList.toggle("active", s.dataset.style === style));
}

chrome.storage.local.get(DEFAULTS, (opts) => {
  renderAccent(opts.accent);
  renderStyle(opts.style);
  document.getElementById("animations").checked = opts.animations;
  document.getElementById("hideAds").checked = opts.hideAds;
  document.getElementById("gridTheme").checked = opts.gridTheme;
  document.getElementById("tint").value = opts.tint;
  document.getElementById("tintVal").textContent = Math.round(opts.tint * 100) + "%";
});

document.getElementById("tint").addEventListener("input", (e) => {
  const v = +e.target.value;
  document.getElementById("tintVal").textContent = Math.round(v * 100) + "%";
  chrome.storage.local.set({ tint: v });
});

document.getElementById("styles").addEventListener("click", (e) => {
  const s = e.target.closest(".style");
  if (!s) return;
  chrome.storage.local.set({ style: s.dataset.style });
  renderStyle(s.dataset.style);
});
document.getElementById("swatches").addEventListener("click", (e) => {
  const s = e.target.closest(".swatch");
  if (!s) return;
  chrome.storage.local.set({ accent: s.dataset.color });
  renderAccent(s.dataset.color);
});
document.getElementById("customColor").addEventListener("input", (e) => {
  chrome.storage.local.set({ accent: e.target.value });
  renderAccent(e.target.value);
});
["animations", "hideAds", "gridTheme"].forEach((id) => {
  document.getElementById(id).addEventListener("change", (e) => {
    chrome.storage.local.set({ [id]: e.target.checked });
  });
});

// ---------- quality of life extras (read by site.js, applied live) ----------
const QOL_DEFAULTS = { ytLayout: true, scPlaylists: true, scRecs: true, autoNext: true, backupSaves: true, banners: true, profileBrowser: true, quickActions: true, endless: true, sticky: true, backToTop: true, recent: true, shortcuts: true, seqSize: "m", profileSize: "m", featuredSize: "m" };
const qolBoxes = [...document.querySelectorAll("[data-qol]")], segs = [...document.querySelectorAll(".seg[data-size]")];
let qol = { ...QOL_DEFAULTS };
function renderQol() {
  qolBoxes.forEach((b) => { b.checked = qol[b.dataset.qol] !== false; });
  segs.forEach((g) => g.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === qol[g.dataset.size])));
  document.getElementById("qolAll").textContent = qolBoxes.some((b) => b.checked) ? "Turn all off" : "Turn all on";
}
function saveQol() { qolBoxes.forEach((b) => { qol[b.dataset.qol] = b.checked; }); delete qol.bigCards; chrome.storage.local.set({ qol }); renderQol(); }
chrome.storage.local.get({ qol: {} }, (v) => { qol = { ...QOL_DEFAULTS, ...v.qol }; if (v.qol.bigCards === false && !v.qol.seqSize) qol.seqSize = "classic"; renderQol(); });
chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.qol) { qol = { ...QOL_DEFAULTS, ...(ch.qol.newValue || {}) }; renderQol(); } });
qolBoxes.forEach((b) => b.addEventListener("change", saveQol));
segs.forEach((g) => g.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; qol[g.dataset.size] = b.dataset.v; saveQol(); }));
document.getElementById("qolAll").addEventListener("click", () => { const on = !qolBoxes.some((b) => b.checked); qolBoxes.forEach((b) => { b.checked = on; }); saveQol(); });

// ---------- accounts & comments ----------
const sendMsg = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, (r) => { void chrome.runtime.lastError; res(r || null); }));
const escHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
async function renderAccounts() {
  const r = await sendMsg({ type: "acc:list" }); const list = (r && r.accounts) || [];
  if (r && r.error) document.getElementById("acctNote").textContent = r.error;
  list.sort((p, q) => (q.current - p.current) || (q.usedAt - p.usedAt) || p.name.localeCompare(q.name));
  document.getElementById("accts").innerHTML = list.map((x) => {
    const av = x.avatar ? `<span class="av" style="background-image:url('${escHtml(new URL(x.avatar, "https://onlinesequencer.net").href)}')"></span>` : `<span class="av">${escHtml((x.name || "?").slice(0, 1).toUpperCase())}</span>`;
    return `<button type="button" class="acct${x.current ? " current" : ""}${x.signedOut ? " out" : ""}" data-uid="${escHtml(x.uid)}">${av}<span class="nm">${escHtml(x.name || "Account " + x.uid)}</span><small>${x.current ? "signed in" : x.signedOut ? "signed out" : "switch"}</small></button>`;
  }).join("");
  document.getElementById("acctNote").textContent = list.length ? (list.length === 1 ? "Add another account to switch between them in one click." : "") : "Open Online Sequencer while signed in and your account appears here.";
}
document.getElementById("accts").addEventListener("click", async (e) => {
  const b = e.target.closest(".acct"); if (!b || b.classList.contains("current")) return;
  if (b.classList.contains("out")) { document.getElementById("acctNote").textContent = "That account is signed out — use Add account and sign in to it again."; return; }
  document.getElementById("acctNote").textContent = "Switching…";
  const r = await sendMsg({ type: "acc:switch", uid: b.dataset.uid });
  if (r && r.error) document.getElementById("acctNote").textContent = r.error; else window.close();
});
document.getElementById("addAcct").addEventListener("click", async () => { const r = await sendMsg({ type: "acc:add" }); if (r && r.error) document.getElementById("acctNote").textContent = r.error; else window.close(); });
document.getElementById("myComments").addEventListener("click", async () => { await sendMsg({ type: "open:comments" }); window.close(); });
document.getElementById("myLibrary").addEventListener("click", async () => { await sendMsg({ type: "open:library" }); window.close(); });
document.getElementById("diag").addEventListener("click", async () => {
  const r = await sendMsg({ type: "acc:diag" }); const note = document.getElementById("acctNote");
  if (!r || !r.text) { note.textContent = (r && r.error) || "Couldn't collect it."; return; }
  try { await navigator.clipboard.writeText(r.text); note.textContent = "Copied — cookie names only, no values or passwords. Paste it in the chat."; } catch (e) { note.textContent = "Couldn't copy to the clipboard."; }
});
renderAccounts();

// Backup & updates
const openBackup = () => { chrome.tabs.create({ url: chrome.runtime.getURL("restore.html") }); window.close(); };
document.getElementById("backupPage").addEventListener("click", openBackup);
chrome.storage.local.get({ osgUpdate: null }, ({ osgUpdate: u }) => {
  if (!u || !u.version) return; const n = document.getElementById("updNote");
  n.hidden = false; n.textContent = `Version ${u.version} is out — see Backup & updates`; n.addEventListener("click", openBackup);
});
