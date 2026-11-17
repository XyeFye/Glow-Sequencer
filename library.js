// Glow Theme for Online Sequencer — Sequence library page.
import { count } from "./db.js";
import { SITE, listLibrary, getEntry, deleteEntries, renameEntry, saveEntry, saveFromSite, toB64, fromB64, fixOldThumbs } from "./lib.js";
const siteFetch = (u, o) => (globalThis.__osgNet ? globalThis.__osgNet.fetch(u, o, 1) : fetch(u, o));   // the polite queue (net.js)

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const send = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, (r) => { void chrome.runtime.lastError; res(r || null); }));
const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const kb = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
const fileName = (t) => (String(t || "sequence").replace(/[\\/:*?"<>|]+/g, "_").trim().slice(0, 100) || "sequence");
let toastT = 0; const toast = (t) => { const el = $("#toast"); el.textContent = t; el.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("show"), Math.max(3000, t.length * 60)); };

chrome.storage.local.get({ accent: "#7c5cff" }, ({ accent }) => {
  const h = accent.replace("#", ""), f = h.length === 3 ? h.split("").map((c) => c + c).join("") : h, n = parseInt(f, 16);
  document.documentElement.style.setProperty("--accent", accent);
  document.documentElement.style.setProperty("--accent-rgb", [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(", "));
});

let items = [], urls = new Map();
async function load() {
  items = await listLibrary();
  for (const [k, u] of urls) if (!items.some((x) => x.key === k)) { URL.revokeObjectURL(u); urls.delete(k); }
  for (const x of items) if (x.thumb && !urls.has(x.key)) urls.set(x.key, URL.createObjectURL(x.thumb));
  $("#sCount").textContent = items.length.toLocaleString(); $("#sSize").textContent = kb(items.reduce((a, x) => a + (x.size || 0), 0));
  render();
  try { chrome.runtime.sendMessage({ type: "backup:dirty" }); } catch (e) {}   // the automatic backup picks up changes made here
  // pictures saved by older versions still show the site's badge: crop them (once each), then show the new ones
  if (!fixing && items.some((x) => x.thumb && x.thumbV !== 2)) {
    fixing = true; let n = 0;
    fixOldThumbs(items.filter((x) => x.thumbV !== 2), (x) => { n++; if (x.thumb) { const old = urls.get(x.key); if (old) URL.revokeObjectURL(old); urls.set(x.key, URL.createObjectURL(x.thumb)); } })
      .finally(() => { fixing = false; if (n) render(); });
  }
}
let fixing = false;
function render() {
  const q = fold($("#q").value).split(/\s+/).filter(Boolean), sort = $("#sort").value;
  let list = items.filter((x) => { const hay = fold(`${x.title} ${x.creatorName} ${x.seqId}`); return q.every((t) => hay.includes(t)); });
  const by = { new: (a, b) => b.savedAt - a.savedAt, old: (a, b) => a.savedAt - b.savedAt, title: (a, b) => a.title.localeCompare(b.title), creator: (a, b) => (a.creatorName || "~").localeCompare(b.creatorName || "~") || b.savedAt - a.savedAt, notes: (a, b) => (b.notes || 0) - (a.notes || 0) };
  list.sort(by[sort] || by.new);
  // one card per sequence: its newest saved version, with the rest in its history
  const grouped = $("#group").checked, vers = new Map();
  for (const x of items) if (x.seqId) { const a = vers.get(x.seqId) || []; a.push(x); vers.set(x.seqId, a); }
  if (grouped) {
    const newest = new Map(); for (const [k, a] of vers) newest.set(k, a.reduce((p, q) => (q.savedAt > p.savedAt ? q : p)).key);
    const hit = new Set(list.filter((x) => x.seqId).map((x) => x.seqId));
    list = list.filter((x) => !x.seqId || x.key === newest.get(x.seqId));
    for (const sid of hit) if (!list.some((x) => x.seqId === sid)) list.push(items.find((x) => x.key === newest.get(sid)));
    list.sort(by[sort] || by.new);
  }
  $("#count").textContent = items.length ? `${list.length.toLocaleString()} of ${items.length.toLocaleString()} sequences` : "";
  if (!list.length) { $("#grid").innerHTML = items.length ? `<div class="empty"><b>Nothing matches</b>Try another word.</div>` : `<div class="empty"><b>Your library is empty</b>Save the sequence you're editing from ▾ next to your name on the site, or paste links on the right.</div>`; return; }
  $("#grid").innerHTML = list.map((x) => {
    const u = urls.get(x.key), nv = x.seqId ? (vers.get(x.seqId) || []).length : 1;
    return `<article class="card" data-key="${esc(x.key)}">
      <button type="button" class="thumb${u ? "" : " none"}" data-act="open" ${u ? `style="background-image:url('${u}')"` : ""} title="Open in the editor"><span class="play">▶ Open in editor</span></button>
      <div class="body"><div class="title" title="${esc(x.title)}">${esc(x.title)}</div>
        <div class="meta">${x.creatorName ? `<span>by ${x.creatorUid ? `<a href="${SITE}/members/${esc(x.creatorUid)}" target="_blank" rel="noopener">${esc(x.creatorName)}</a>` : esc(x.creatorName)}</span>` : ""}${x.seqId ? `<a href="${SITE}/${esc(x.seqId)}" target="_blank" rel="noopener">#${esc(x.seqId)}</a>` : `<span class="tag">${x.source === "file" ? "file" : "unsaved"}</span>`}</div>
        <div class="meta"><span>${(x.notes || 0).toLocaleString()} notes</span><span>${kb(x.size || 0)}</span><span title="${new Date(x.savedAt).toLocaleString()}">saved ${new Date(x.savedAt).toLocaleDateString()}</span>${nv > 1 ? `<span class="tag ver">${nv} versions</span>` : ""}</div></div>
      <div class="actions"><button type="button" class="primary" data-act="open">Open</button>${x.seqId ? `<button type="button" data-act="history" title="Every saved version of this sequence">History</button>` : ""}<button type="button" data-act="download" title="Download as a .sequence file (drop it on the editor to open it)">Download</button><span class="grow"></span><button type="button" data-act="rename" title="Rename">✎</button><button type="button" class="danger" data-act="delete" title="Delete from the library">✕</button></div>
    </article>`;
  }).join("");
}
$("#q").addEventListener("input", render); $("#sort").addEventListener("change", render); $("#group").addEventListener("change", render);

// ---------- a sequence's history: every saved version, newest first ----------
let histSeq = "";
const SOURCE = { save: "saved on the site", seen: "as it was when you opened it", site: "from the site", recovered: "recovered", file: "from a file", editor: "saved to library" };
function openHistory(seqId) {
  seqId = String(seqId || "").replace(/\D/g, ""); if (!seqId) return;
  const list = items.filter((x) => x.seqId === seqId).sort((a, b) => b.savedAt - a.savedAt);
  histSeq = seqId;
  $("#histTitle").textContent = `History — ${list.length ? list[0].title : "#" + seqId}`;
  $("#histSub").textContent = list.length ? `${list.length} version${list.length === 1 ? "" : "s"} of #${seqId}, kept on this computer. Saving on the site adds one automatically.` : `Nothing kept for #${seqId} yet. Saving it on the site adds a version automatically — or look for older ones below.`;
  $("#histList").innerHTML = (list.length ? "" : `<div class="ver-empty">No versions yet.</div>`) + list.map((x, i) => {
    const older = list[i + 1], diff = older ? (x.notes || 0) - (older.notes || 0) : 0, u = urls.get(x.key), d = new Date(x.savedAt);
    return `<div class="ver-row" data-key="${esc(x.key)}" style="--i:${Math.min(i, 14)}">
      <span class="vthumb"${u ? ` style="background-image:url('${u}')"` : ""}></span>
      <div><div class="vwhen">${esc(d.toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" }))} · ${esc(d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }))}${i === 0 ? `<span class="tag ver latest">latest</span>` : ""}</div>
        <div class="vmeta"><span>${(x.notes || 0).toLocaleString()} notes${older ? ` <b class="${diff > 0 ? "up" : diff < 0 ? "down" : ""}">(${diff > 0 ? "+" : diff < 0 ? "−" : "±"}${Math.abs(diff).toLocaleString()})</b>` : ""}</span><span>${kb(x.size || 0)}</span><span>${esc(SOURCE[x.source] || "saved to library")}</span>${x.fromId && x.fromId !== x.seqId ? `<span>copy <a href="${SITE}/${esc(x.fromId)}" target="_blank" rel="noopener">#${esc(x.fromId)}</a>${x.fromTitle && x.fromTitle !== list[0].title ? ` “${esc(x.fromTitle)}”` : ""}</span>` : ""}${x.title !== list[0].title && !x.fromId ? `<span>“${esc(x.title)}”</span>` : ""}</div></div>
      <div class="vact"><button type="button" class="primary" data-act="open" title="Open this version in the editor">Open</button><button type="button" data-act="download">Download</button><button type="button" data-act="delete" title="Delete this version">✕</button></div>
    </div>`;
  }).join("");
  $("#hist").hidden = false;
}

// ---- finding older versions ----
// The site keeps only the newest data of each sequence (older saves are overwritten), so older versions are looked for
// where they can still be found: copies on the site — the sequences this one was "based on", and your other sequences
// with the same name — plus the version on the site now. Everything goes through the polite queue, a page at a time.
const normT = (t) => fold(t).replace(/[^a-z0-9]+/g, "");
const sameTitle = (a, b) => { a = normT(a); b = normT(b); if (!a || !b) return false; if (a === b) return true; const [x, y] = a.length < b.length ? [a, b] : [b, a]; return x.length >= 5 && y.startsWith(x) && y.length - x.length <= 8; };
async function seqPage(id) {
  const r = await siteFetch(`${SITE}/${id}`); if (!r.ok) return null; const html = await r.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const det = doc.querySelector(".info-sidebar-details"); if (!det) return null;
  const by = det.querySelector(':scope > a[href^="/members/"]'), based = [...det.querySelectorAll(".inspired")].find((x) => /based on/i.test(x.textContent));
  const ba = based && based.querySelector('a[href^="/"]:not([href^="/members/"])'), bby = based && based.querySelector('a[href^="/members/"]');
  return { id: String(id), title: (doc.querySelector('meta[property="og:title"]')?.getAttribute("content") || "").trim(), owner: (html.match(/\bowner = (\d+);/) || [])[1] || (by?.getAttribute("href") || "").replace(/\D/g, ""),
    by: by?.textContent.trim() || "", date: det.querySelector(".sequence-date")?.textContent.trim() || "",
    based: ba ? { id: (ba.getAttribute("href") || "").replace(/\D/g, ""), by: (bby?.getAttribute("href") || "").replace(/\D/g, "") } : null };
}
const dayOf = (d) => { const t = Date.parse(String(d || "") + "T12:00:00"); return isNaN(t) ? 0 : t; };
async function smallThumb(id) { try { const r = await siteFetch(`${SITE}/preview.php?id=${id}&t=0&s=1`); if (!r.ok) return null; const b = await r.blob(); return b.size && /^image\//.test(b.type) ? b : null; } catch (e) { return null; } }
async function findOlder(seqId, say) {
  say("Reading the sequence's page…");
  const me = await seqPage(seqId); if (!me) throw new Error("Couldn't read that sequence on the site (it may be private or deleted).");
  const owner = me.owner, pages = new Map([[me.id, me]]), found = new Map();
  const follow = async (p, hops) => {   // back along "based on", while it's the same creator's
    for (let k = 0; k < hops && p && p.based && p.based.id && !pages.has(p.based.id) && (!p.based.by || p.based.by === owner); k++) {
      const q = await seqPage(p.based.id); if (!q || q.owner !== owner) return; pages.set(q.id, q); found.set(q.id, "based on"); p = q;
    }
  };
  await follow(me, 8);
  if (owner) {
    say("Looking through the creator's sequences…");
    const r = await siteFetch(`${SITE}/members/${owner}`);
    if (r.ok) {
      const doc = new DOMParser().parseFromString(await r.text(), "text/html");
      const same = [...doc.querySelectorAll(".pager-items .preview")].map((p) => ({ id: (p.querySelector("a")?.getAttribute("href") || "").replace(/\D/g, ""), t: p.getAttribute("title") || "" }))
        .filter((x) => x.id && x.id !== me.id && !found.has(x.id) && sameTitle(x.t, me.title)).slice(0, 8);
      for (const x of same) { if (found.size >= 14) break; const q = pages.get(x.id) || await seqPage(x.id); if (!q || q.owner !== owner) continue; pages.set(q.id, q); found.set(q.id, "same name"); await follow(q, 3); }
    }
  }
  let added = 0, n = 0; const ids = [me.id, ...found.keys()];
  for (const id of ids) {
    say(`Fetching ${++n} of ${ids.length}…`);
    const p = pages.get(id), r = await siteFetch(`${SITE}/app/api/get_proto.php?v=2&id=${id}`); if (!r.ok) continue;
    const bytes = new Uint8Array(await r.arrayBuffer()); if (!bytes.length) continue;
    const res = await saveEntry({ bytes, seqId, title: me.title || "Sequence " + seqId, creatorUid: owner, creatorName: me.by, thumb: await smallThumb(id),
      source: id === me.id ? "site" : "recovered", savedAt: id === me.id ? 0 : dayOf(p.date), fromId: id === me.id ? "" : id, fromTitle: id === me.id ? "" : p.title });
    if (!res.duplicate) added++;
  }
  return { added, copies: found.size };
}
async function addFilesAsVersions(seqId, files) {
  let added = 0, dup = 0, bad = 0; const title = items.find((x) => x.seqId === seqId)?.title || "Sequence " + seqId;
  for (const f of files) { try { const r = await saveEntry({ bytes: new Uint8Array(await f.arrayBuffer()), seqId, title, source: "file", savedAt: f.lastModified || 0, fromTitle: f.name }); r.duplicate ? dup++ : added++; } catch (e) { bad++; } }
  toast(`${added} version${added === 1 ? "" : "s"} added${dup ? `, ${dup} already there` : ""}${bad ? `, ${bad} couldn't be read` : ""}.`);
  await load(); openHistory(seqId);
}
$("#histFind").addEventListener("click", async () => {
  const seq = histSeq, b = $("#histFind"); if (!seq || b.disabled) return;
  b.disabled = true; const label = b.textContent;
  try {
    const r = await findOlder(seq, (t) => { b.textContent = t; });
    await load(); if (histSeq === seq) openHistory(seq);
    toast(r.added ? `Found ${r.added} version${r.added === 1 ? "" : "s"} to add${r.copies ? ` (from ${r.copies} older cop${r.copies === 1 ? "y" : "ies"} on the site)` : ""}.` : r.copies ? "Those copies are already in the history." : "No older copies of it on the site — its history here starts from what's been kept on this computer.");
  } catch (e) { toast(String(e.message || e)); }
  b.disabled = false; b.textContent = label;
});
$("#histFile").addEventListener("change", (e) => { const f = [...e.target.files]; e.target.value = ""; if (histSeq && f.length) addFilesAsVersions(histSeq, f); });
const closeHistory = () => { $("#hist").hidden = true; histSeq = ""; if (location.hash) history.replaceState(null, "", location.pathname); };
$("#hist").addEventListener("click", async (e) => {
  if (e.target === $("#hist") || e.target.closest(".hist-x")) { closeHistory(); return; }
  const b = e.target.closest("[data-act]"); if (!b) return; const key = b.closest(".ver-row").dataset.key; const x = items.find((y) => y.key === key); if (!x) return;
  if (b.dataset.act === "delete") { if (!confirm("Delete this saved version? This can't be undone.")) return; await deleteEntries([key]); toast("Deleted that version."); await load(); if (histSeq) items.some((y) => y.seqId === histSeq) ? openHistory(histSeq) : closeHistory(); return; }
  await act(b.dataset.act, key, x);
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#hist").hidden) closeHistory(); });
$("#grid").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]"); if (!b) return; const card = b.closest(".card"), key = card.dataset.key, act = b.dataset.act;
  const x = items.find((y) => y.key === key); if (!x) return;
  if (act === "history") { openHistory(x.seqId); return; }
  await actOn(act, key, x, card);
});
async function act(a, key, x) { return actOn(a, key, x, null); }
async function actOn(act, key, x, card) {
  if (act === "open") { await send({ type: "lib:open", key }); }
  else if (act === "download") { const e2 = await getEntry(key); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([e2.bytes], { type: "application/octet-stream" })); a.download = fileName(e2.title) + ".sequence"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
  else if (act === "delete") { if (!confirm(`Delete “${x.title}” from your library? This can't be undone.`)) return; await deleteEntries([key]); toast("Deleted."); load(); }
  else if (act === "rename") {
    const t = card.querySelector(".title"); t.contentEditable = "true"; t.focus(); document.getSelection().selectAllChildren(t);
    const done = async (save) => { t.contentEditable = "false"; t.onblur = t.onkeydown = null; if (save && t.textContent.trim() && t.textContent.trim() !== x.title) { await renameEntry(key, t.textContent.trim()); load(); } else t.textContent = x.title; };
    t.onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); done(true); } if (ev.key === "Escape") done(false); };
    t.onblur = () => done(true);
  }
}

// ---------- saving from the site ----------
let stop = false, busy = false;
function progress(done, total, text) { $("#progress").hidden = false; $("#pfill").style.width = total ? Math.round(done / total * 100) + "%" : "0"; $("#ptext").textContent = text; }
async function saveMany(list, label) {
  if (busy) return; busy = true; stop = false; $("#stop").hidden = false; $("#saveLinks").disabled = $("#saveMember").disabled = true;
  let done = 0, added = 0, dup = 0, failed = 0, i = 0;
  progress(0, list.length, `${label}: 0 of ${list.length}`);
  try {
    await Promise.all([0, 1].map(async () => {
      while (i < list.length && !stop) {
        const it = list[i++];
        try { const r = await saveFromSite(it.id, it.title ? { title: it.title, creatorUid: it.creatorUid || "", creatorName: it.creatorName || "" } : {}); if (r.duplicate) dup++; else added++; } catch (e) { failed++; }
        done++; progress(done, list.length, `${label}: ${done} of ${list.length} · ${added} saved${dup ? `, ${dup} already there` : ""}${failed ? `, ${failed} failed` : ""}`);
        if (done % 10 === 0) load();
        await new Promise((r) => setTimeout(r, 250));
      }
    }));
    progress(done, list.length, `${stop ? "Stopped" : "Done"} — ${added} saved${dup ? `, ${dup} already in the library` : ""}${failed ? `, ${failed} couldn't be saved (private or deleted?)` : ""}.`);
  } finally { busy = false; $("#stop").hidden = true; $("#saveLinks").disabled = $("#saveMember").disabled = false; load(); }
}
$("#stop").addEventListener("click", () => { stop = true; });
$("#saveLinks").addEventListener("click", () => {
  const ids = [...new Set(($("#links").value.match(/(?:onlinesequencer\.net\/)?\b(\d{1,9})\b/g) || []).map((x) => x.replace(/\D/g, "")))];
  if (!ids.length) { toast("Paste one or more sequence links or numbers first."); return; }
  saveMany(ids.map((id) => ({ id })), "Saving");
});
async function memberSequences(uid, say) {
  const out = [], seen = new Set(); let start = 0, name = "";
  for (let page = 0; page < 200 && !stop; page++) {
    say(`Listing sequences… page ${page + 1}`);
    const html = await siteFetch(`${SITE}/members/${uid}?sort=4&start=${start}`).then((r) => r.text());
    const doc = new DOMParser().parseFromString(html, "text/html");
    if (!name) name = (doc.title.match(/^Profile for (.+?) - Online Sequencer/) || [])[1] || "";
    const tiles = [...doc.querySelectorAll("#page_right .pager-items .preview")]; let added = 0;
    for (const t of tiles) { const id = (t.querySelector("a")?.getAttribute("href") || "").replace(/\D/g, ""); if (!id || seen.has(id)) continue; seen.add(id); added++; out.push({ id, title: t.getAttribute("title") || "", creatorUid: uid, creatorName: name }); }
    if (!tiles.length || !added) break;
    const next = doc.querySelector('#page_right .pagelinks a[href*="start="]:last-child'); const ns = next ? +((next.getAttribute("href").match(/start=(\d+)/) || [])[1]) : NaN;
    if (!next || isNaN(ns) || ns <= start) break; start = ns;
  }
  for (const x of out) x.creatorName = name;
  return { list: out, name };
}
$("#saveMember").addEventListener("click", async () => {
  const uid = ($("#member").value.match(/members\/(\d+)|^\s*(\d+)\s*$|uid=(\d+)/) || []).slice(1).find(Boolean) || $("#myAccts").value;
  if (!uid) { toast("Enter a member link or number, or pick one of your accounts."); return; }
  if (busy) return; stop = false; $("#stop").hidden = false;
  const { list, name } = await memberSequences(uid, (t) => progress(0, 0, t));
  if (!list.length) { progress(0, 0, "No sequences found for that member."); $("#stop").hidden = true; return; }
  saveMany(list, `Saving ${name || "#" + uid}'s sequences`);
});
(async () => {
  const r = await send({ type: "acc:list" }); const accts = (r && r.accounts) || [];
  $("#myAccts").innerHTML = `<option value="">or one of your accounts…</option>` + accts.map((a) => `<option value="${esc(a.uid)}">${esc(a.name || "#" + a.uid)}</option>`).join("");
})();

// ---------- files & backup ----------
async function importFiles(files) {
  let added = 0, dup = 0, failed = 0;
  for (const f of files) {
    try {
      if (/\.json$/i.test(f.name)) { const r = await restore(JSON.parse(await f.text())); added += r.added; dup += r.dup; continue; }
      const bytes = new Uint8Array(await f.arrayBuffer());
      const r = await saveEntry({ bytes, title: f.name.replace(/\.sequence$/i, ""), source: "file" }); if (r.duplicate) dup++; else added++;
    } catch (e) { failed++; }
  }
  toast(`${added} added${dup ? `, ${dup} already there` : ""}${failed ? `, ${failed} couldn't be read` : ""}.`); load();
}
$("#files").addEventListener("change", (e) => { importFiles([...e.target.files]); e.target.value = ""; });
const drop = $("#drop");
for (const ev of ["dragenter", "dragover"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); });
for (const ev of ["dragleave", "drop"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); });
drop.addEventListener("drop", (e) => importFiles([...e.dataTransfer.files]));
const blobToDataUrl = (b) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(""); r.readAsDataURL(b); });
$("#export").addEventListener("click", async () => {
  const all = await listLibrary(); if (!all.length) { toast("The library is empty."); return; }
  const out = { format: "osg-sequence-library", version: 1, exportedAt: new Date().toISOString(), items: [] };
  for (const x of all) out.items.push({ ...x, bytes: toB64(x.bytes), thumb: x.thumb ? await blobToDataUrl(x.thumb) : "" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: "application/json" })); a.download = `online-sequencer-library-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast(`Backed up ${all.length} sequences.`);
});
async function restore(data) {
  if (!data || data.format !== "osg-sequence-library" || !Array.isArray(data.items)) throw new Error("not a library backup");
  let added = 0, dup = 0;
  for (const x of data.items) {
    let thumb = null; if (/^data:image\//.test(x.thumb || "")) { try { thumb = await (await fetch(x.thumb)).blob(); } catch (e) {} }
    const r = await saveEntry({ bytes: fromB64(x.bytes), title: x.title, seqId: x.seqId, creatorUid: x.creatorUid, creatorName: x.creatorName, thumb, source: x.source || "backup" });
    if (r.duplicate) dup++; else added++;
  }
  return { added, dup };
}
$("#restore").addEventListener("change", async (e) => { const f = e.target.files[0]; e.target.value = ""; if (!f) return; try { const r = await restore(JSON.parse(await f.text())); toast(`Restored ${r.added} sequences${r.dup ? ` (${r.dup} were already there)` : ""}.`); load(); } catch (err) { toast("That file isn't a library backup."); } });
$("#toComments").addEventListener("click", () => send({ type: "open:comments" }));
setInterval(async () => { if (document.hidden || busy) return; if ((await count("library")) !== items.length) load(); }, 4000);   // saved from another tab
load().then(() => { const m = location.hash.match(/seq=(\d+)/); if (m) openHistory(m[1]); });   // library.html#seq=123 opens that sequence's history
