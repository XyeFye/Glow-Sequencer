// Glow Theme for Online Sequencer — "My comments": search the comments you've left on sequences.
import { all, putMany, addSeqs, mergeSequenceComments, kvGet, kvSet } from "./db.js";
import { sequenceMeta } from "./lib.js";

const SITE = "https://onlinesequencer.net";
const siteFetch = (u, o) => (globalThis.__osgNet ? globalThis.__osgNet.fetch(u, o, 1) : fetch(u, o));   // the polite queue (net.js)
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const send = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, (r) => { void chrome.runtime.lastError; res(r || null); }));
const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const absUrl = (u) => { try { return new URL(u, SITE).href; } catch (e) { return ""; } };
const fmtDate = (ts) => ts ? new Date(ts).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
const ago = (ts) => { if (!ts) return "—"; const s = (Date.now() - ts) / 1000; return s < 90 ? "just now" : s < 5400 ? Math.round(s / 60) + " min ago" : s < 129600 ? Math.round(s / 3600) + " h ago" : Math.round(s / 86400) + " d ago"; };

// theme accent from the extension's settings
chrome.storage.local.get({ accent: "#7c5cff" }, ({ accent }) => {
  const h = accent.replace("#", ""), f = h.length === 3 ? h.split("").map((c) => c + c).join("") : h, n = parseInt(f, 16);
  document.documentElement.style.setProperty("--accent", accent);
  document.documentElement.style.setProperty("--accent-rgb", [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(", "));
});

// ---------- state ----------
let comments = [], seqs = new Map(), accounts = [], uids = [];
let picked = new Set(), shownCount = 0, lastResults = [];
const PAGE = 150;

async function loadAll() {
  [comments, accounts, uids] = await Promise.all([all("comments"), send({ type: "acc:list" }).then((r) => (r && r.accounts) || []), send({ type: "cm:uids" }).then((r) => (Array.isArray(r) ? r : []))]);
  seqs = new Map((await all("seqs")).map((s) => [s.id, s]));
  renderAccounts(); renderStats(); search();
}
const nameOf = (uid) => accounts.find((a) => a.uid === uid)?.name || comments.find((c) => c.uid === uid)?.name || "#" + uid;
const avatarOf = (uid) => accounts.find((a) => a.uid === uid)?.avatar || "";
const avatarHtml = (uid) => { const a = avatarOf(uid); return a ? `<span class="av" style="background-image:url('${esc(absUrl(a))}')"></span>` : `<span class="av">${esc(nameOf(uid).replace(/^#/, "").slice(0, 1).toUpperCase())}</span>`; };

function renderAccounts() {
  const ids = [...new Set([...uids, ...comments.map((c) => c.uid)])];
  const counts = new Map(); for (const c of comments) if (!c.gone || $("#gone").checked) counts.set(c.uid, (counts.get(c.uid) || 0) + 1);
  $("#accounts").innerHTML = ids.length > 1 ? `<button type="button" class="chip plain${picked.size ? "" : " on"}" data-uid="">All accounts</button>` + ids.map((u) => `<button type="button" class="chip${picked.has(u) ? " on" : ""}" data-uid="${esc(u)}">${avatarHtml(u)}${esc(nameOf(u))} <small>${counts.get(u) || 0}</small></button>`).join("") : "";
  $("#acctList").innerHTML = ids.length ? ids.map((u) => { const a = accounts.find((x) => x.uid === u); return `<div class="acct">${avatarHtml(u)}<span>${esc(nameOf(u))}</span><small>${a ? (a.current ? "signed in" : a.signedOut ? "signed out" : "saved") : "seen"}</small></div>`; }).join("")
    : `<p class="note" style="margin:0">No account yet — open Online Sequencer while signed in once, and it will be picked up.</p>`;
}
$("#accounts").addEventListener("click", (e) => {
  const b = e.target.closest(".chip"); if (!b) return; const u = b.dataset.uid;
  if (!u) picked.clear(); else if (picked.has(u)) picked.delete(u); else picked.add(u);
  renderAccounts(); search();
});

function renderStats() {
  const list = [...seqs.values()], checked = list.filter((s) => s.scannedAt), todo = list.filter((s) => !s.scannedAt || uids.some((u) => !(s.scannedFor || []).includes(u)));
  $("#sComments").textContent = comments.filter((c) => !c.gone).length.toLocaleString();
  $("#sSeqs").textContent = checked.length.toLocaleString();
  $("#sTodo").textContent = todo.length.toLocaleString();
  $("#sLast").textContent = ago(Math.max(0, ...checked.map((s) => s.scannedAt)));
  const visited = list.filter((s) => (s.sources || []).includes("visited")).length;
  $("#nVisited").textContent = `${visited.toLocaleString()} recorded so far, as you browse.`;
}

// ---------- search ----------
function terms(q) {   // words and "quoted phrases"
  const out = []; String(q || "").replace(/["“”]([^"“”]+)["“”]|(\S+)/g, (_, ph, w) => { const t = fold((ph || w).trim()); if (t) out.push(t); });
  return out;
}
function highlight(text, ts) {
  if (!ts.length) return esc(text);
  const f = fold(text); if (f.length !== text.length) return esc(text);   // (folding changed the length: no safe offsets)
  const marks = []; for (const t of ts) { let i = 0; while ((i = f.indexOf(t, i)) > -1) { marks.push([i, i + t.length]); i += t.length; } }
  marks.sort((a, b) => a[0] - b[0]); let out = "", at = 0;
  for (const [s, e] of marks) { if (s < at) continue; out += esc(text.slice(at, s)) + "<mark>" + esc(text.slice(s, e)) + "</mark>"; at = e; }
  return out + esc(text.slice(at));
}
function search() {
  const ts = terms($("#q").value), kind = $("#kind").value, sort = $("#sort").value, withGone = $("#gone").checked;
  const from = $("#from").value ? new Date($("#from").value + "T00:00").getTime() : 0, to = $("#to").value ? new Date($("#to").value + "T23:59:59").getTime() : Infinity;
  let res = comments.filter((c) => (withGone || !c.gone) && (!picked.size || picked.has(c.uid)) && (kind === "all" || (kind === "reply") === !!c.parent) && (!c.ts || (c.ts >= from && c.ts <= to)) && (!$("#from").value && !$("#to").value || c.ts));
  if (ts.length) res = res.filter((c) => { const hay = fold(c.text + "\n" + (seqs.get(c.seq)?.title || "") + "\n" + c.seq); return ts.every((t) => hay.includes(t)); });
  const byNew = (a, b) => (b.ts || 0) - (a.ts || 0) || +b.id - +a.id;
  res.sort(sort === "old" ? (a, b) => -byNew(a, b) : sort === "seq" ? (a, b) => (seqs.get(a.seq)?.title || a.seq).localeCompare(seqs.get(b.seq)?.title || b.seq) || +a.seq - +b.seq || (a.ts - b.ts) : byNew);
  lastResults = res; shownCount = 0; $("#results").innerHTML = "";
  const seqCount = new Set(res.map((c) => c.seq)).size;
  $("#count").textContent = comments.length ? `${res.length.toLocaleString()} comment${res.length === 1 ? "" : "s"} on ${seqCount.toLocaleString()} sequence${seqCount === 1 ? "" : "s"}` : "";
  if (!res.length) {
    $("#results").innerHTML = comments.length ? `<div class="empty"><b>No matching comments</b>Try fewer words, another account, or a wider date range.</div>`
      : `<div class="empty"><b>Nothing indexed yet</b>Pick where to look on the right and press <em>Scan</em>. Browser history finds the most.</div>`;
    $("#more").hidden = true; return;
  }
  showMore(ts);
}
function showMore(ts = terms($("#q").value)) {
  const slice = lastResults.slice(shownCount, shownCount + PAGE); shownCount += slice.length;
  const frag = document.createDocumentFragment(); const needTitles = [];
  for (const c of slice) {
    const s = seqs.get(c.seq), title = s?.title || ""; if (!title || s.creatorUid === undefined || (s.creatorUid && !s.creatorName)) needTitles.push(c.seq);
    const el = document.createElement("article"); el.className = "card" + (c.gone ? " gone" : ""); el.dataset.seq = c.seq;
    el.innerHTML = `<a class="pic" href="${SITE}/${esc(c.seq)}" target="_blank" rel="noopener" title="Open the sequence"><img loading="lazy" alt="" src="${SITE}/preview.php?id=${esc(c.seq)}&amp;t=0&amp;s=1"></a>
      <div class="main">
      <div class="seqline"><a class="seq" href="${SITE}/${esc(c.seq)}" target="_blank" rel="noopener">${title ? highlight(title, ts) : `Sequence <span class="seqid">${esc(c.seq)}</span>`}</a>${s?.creatorName ? `<span class="by">by ${s.creatorUid ? `<a href="${SITE}/members/${esc(s.creatorUid)}" target="_blank" rel="noopener">${esc(s.creatorName)}</a>` : esc(s.creatorName)}</span>` : ""}</div>
      <div class="meta">${avatarHtml(c.uid)}<b>${esc(c.name || nameOf(c.uid))}</b><span>·</span><span title="${esc(c.date)}">${esc(fmtDate(c.ts) || c.date)}</span>${c.parent ? `<span class="badge">Reply</span>` : ""}${c.gone ? `<span class="badge gone">Deleted</span>` : ""}</div>
      ${c.parent ? `<div class="reply">↳ to <b>${esc(c.parentName || "a comment")}</b>${c.parentText ? `: ${esc(c.parentText.length > 160 ? c.parentText.slice(0, 160) + "…" : c.parentText)}` : ""}</div>` : ""}
      <div class="text">${highlight(c.text, ts)}</div>
      ${c.links && c.links.length ? `<div class="links">${c.links.map((l) => `<a href="${esc(absUrl(l))}" target="_blank" rel="noopener nofollow">${esc(absUrl(l))}</a>`).join("")}</div>` : ""}
      <div class="tools"><button type="button" data-copy="${esc(c.id)}">Copy text</button><button type="button" data-save="${esc(c.seq)}" title="Save this sequence's data to your library">★ Save sequence</button><a href="${SITE}/${esc(c.seq)}" target="_blank" rel="noopener">Open ↗</a></div>
      </div>`;
    frag.appendChild(el);
  }
  $("#results").appendChild(frag);
  $("#more").hidden = shownCount >= lastResults.length; $("#more").textContent = `Show more (${(lastResults.length - shownCount).toLocaleString()} left)`;
  fetchTitles([...new Set(needTitles)].slice(0, 40));
}
$("#more").addEventListener("click", () => showMore());
$("#results").addEventListener("click", async (e) => {
  const sv = e.target.closest("[data-save]");
  if (sv) { sv.disabled = true; sv.textContent = "Saving…"; const r = await send({ type: "lib:saveSite", seqId: sv.dataset.save }); sv.textContent = r && r.ok ? (r.duplicate ? "✓ In library" : "✓ Saved") : "Failed"; if (!(r && r.ok)) sv.disabled = false; return; }
  const b = e.target.closest("[data-copy]"); if (!b) return; const c = comments.find((x) => x.id === b.dataset.copy); if (!c) return;
  try { await navigator.clipboard.writeText(c.text); b.textContent = "Copied"; setTimeout(() => (b.textContent = "Copy"), 1200); } catch (err) {}
});
let qT = 0; $("#q").addEventListener("input", () => { clearTimeout(qT); qT = setTimeout(() => { search(); history.replaceState(null, "", $("#q").value ? "#q=" + encodeURIComponent($("#q").value) : location.pathname); }, 120); });
for (const id of ["kind", "sort", "from", "to"]) $("#" + id).addEventListener("change", search);
$("#gone").addEventListener("change", () => { renderAccounts(); search(); });
document.addEventListener("keydown", (e) => { if (e.key === "/" && !e.target.closest("input, textarea, select")) { e.preventDefault(); $("#q").focus(); $("#q").select(); } });
$("#export").addEventListener("click", () => {
  const rows = [["date", "account", "sequence", "sequence title", "reply to", "comment", "link", "deleted"]].concat(lastResults.map((c) => [c.ts ? new Date(c.ts).toISOString() : c.date, c.name || nameOf(c.uid), c.seq, seqs.get(c.seq)?.title || "", c.parentName || "", c.text, `${SITE}/${c.seq}`, c.gone ? "yes" : ""]));
  const csv = rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" })); a.download = `my-online-sequencer-comments-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});

// sequence titles for results that don't have one yet (a few at a time, remembered)
const titleBusy = new Set();
async function fetchTitles(ids) {
  ids = ids.filter((id) => !titleBusy.has(id)); ids.forEach((id) => titleBusy.add(id));
  await pool(ids, 3, async (id) => {
    try {
      await learnSequence(id);
      const s = seqs.get(id);
      for (const card of document.querySelectorAll(`.card[data-seq="${id}"]`)) {
        card.querySelector(".seq").innerHTML = highlight(s.title, terms($("#q").value));
        if (s.creatorName && !card.querySelector(".by")) card.querySelector(".seqline").insertAdjacentHTML("beforeend", `<span class="by">by ${s.creatorUid ? `<a href="${SITE}/members/${esc(s.creatorUid)}" target="_blank" rel="noopener">${esc(s.creatorName)}</a>` : esc(s.creatorName)}</span>`);
      }
    } catch (e) {}
  });
}

// title and creator of a sequence (from its page), remembered in the index
async function learnSequence(id) {
  const m = await sequenceMeta(id);
  const s = seqs.get(id) || (await all("seqs")).find((x) => x.id === id) || { id, scannedAt: 0, scannedFor: [], sources: [] };
  if (m.title) s.title = m.title; else if (!s.title) s.title = "Untitled";
  s.creatorUid = m.creatorUid || ""; s.creatorName = m.creatorName || "";
  seqs.set(id, s); await putMany("seqs", [s]); return s;
}

// ---------- scanning ----------
let stopFlag = false, scanning = false, pendingRescan = false;
const toast2 = (t) => { $("#progressText").textContent = t; };
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length && !stopFlag) { const it = items[i++]; await fn(it); } })); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function progress(done, total, text) { $("#liveText").textContent = text; $("#progress").classList.add("on"); $("#barFill").style.width = total ? Math.round(done / total * 100) + "%" : "0"; $("#progressText").textContent = text; }

async function ownSequences(uid, say) {   // every sequence on a member's profile, walking its pages
  const out = [], seen = new Set(); let start = 0, name = "";
  for (let page = 0; page < 80 && !stopFlag; page++) {
    say(`Listing ${nameOf(uid)}'s sequences… page ${page + 1}`);
    const html = await siteFetch(`${SITE}/members/${uid}?sort=4&start=${start}`).then((r) => r.text());
    const doc = new DOMParser().parseFromString(html, "text/html");
    if (!name) name = (doc.title.match(/^Profile for (.+?) - Online Sequencer/) || [])[1] || "";
    const tiles = [...doc.querySelectorAll("#page_right .pager-items .preview")]; let added = 0;
    for (const t of tiles) { const id = (t.querySelector("a")?.getAttribute("href") || "").replace(/\D/g, ""); if (!id || seen.has(id)) continue; seen.add(id); added++; out.push({ id, title: t.getAttribute("title") || "", creatorUid: uid }); }
    if (!tiles.length || !added) break;
    const next = doc.querySelector('#page_right .pagelinks a[href*="start="]:last-child'); const ns = next ? +((next.getAttribute("href").match(/start=(\d+)/) || [])[1]) : NaN;
    if (!next || isNaN(ns) || ns <= start) break; start = ns;
  }
  for (const x of out) x.creatorName = name;
  return out;
}
const SEQ_URL = /^https:\/\/(?:www\.)?onlinesequencer\.net\/(\d{1,9})(?:[/?#].*)?$/i;
const cleanTitle = (t) => String(t || "").replace(/\s*\|\s*[^|]*-\s*Online Sequencer\s*$/i, "").replace(/\s*-\s*Online Sequencer\s*$/i, "").trim();
async function historySequences() {
  const items = await chrome.history.search({ text: "onlinesequencer.net", startTime: 0, maxResults: 100000 });
  const out = new Map(); for (const h of items) { const m = (h.url || "").match(SEQ_URL); if (m && !out.has(m[1])) out.set(m[1], { id: m[1], title: cleanTitle(h.title) }); }
  return [...out.values()];
}
async function hasHistory() { try { return await chrome.permissions.contains({ permissions: ["history"] }); } catch (e) { return false; } }
let historyInit = false;
async function refreshHistoryUi() {
  const ok = await hasHistory(); $("#grant").hidden = ok;
  if (!historyInit) { historyInit = true; $("#srcHistory").checked = ok; }
  if (ok) { try { const n = (await historySequences()).length; $("#nHistory").textContent = `${n.toLocaleString()} sequence${n === 1 ? "" : "s"} in this browser's history. Only sequence links are read.`; } catch (e) {} }
}
$("#grant").addEventListener("click", async () => {
  let ok = false; try { ok = await chrome.permissions.request({ permissions: ["history"] }); } catch (e) {}
  if (ok) $("#srcHistory").checked = true; refreshHistoryUi();
});
$("#srcHistory").addEventListener("change", async (e) => { if (e.target.checked && !(await hasHistory())) { e.target.checked = false; $("#grant").hidden = false; $("#grant").focus(); } });
$("#paste").addEventListener("input", () => { $("#srcPaste").checked = !!$("#paste").value.trim(); });

async function scanOne(id, lookFor) {
  const html = await siteFetch(`${SITE}/ajax/get_comments.php?id=0&id=${id}&page=1`).then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); });
  const list = osgComments.parseHtml(html);
  if (!list.length && !/no comments yet/i.test(html)) throw new Error("unexpected reply");
  const mine = list.filter((c) => lookFor.includes(c.uid)).map((c) => ({ id: c.id, uid: c.uid, name: c.name, date: c.date, ts: c.ts, text: c.text, links: c.links, parent: c.parent, parentName: c.parentName, parentUid: c.parentUid, parentText: c.parentText }));
  await mergeSequenceComments(id, lookFor, mine, {});
  // who you interact with, for the deep scan: people commenting on your sequences, replying to you, or that you reply to
  const mineSeq = lookFor.includes(seqs.get(id)?.creatorUid || "");
  for (const c of list) {
    if (lookFor.includes(c.uid)) { if (c.parentUid && !lookFor.includes(c.parentUid)) bump(c.parentUid, 3); continue; }
    if (mineSeq) bump(c.uid, 1);
    if (lookFor.includes(c.parentUid)) bump(c.uid, 3);
  }
  if (mine.length) liveRefresh();
  return mine.length;
}
// interaction scores (kept between runs)
let people = null, peopleT = 0;
async function loadPeople() { if (!people) people = (await kvGet("people", {})) || {}; return people; }
function bump(uid, n) { if (!/^\d+$/.test(uid || "") || uid === "0" || !people) return; people[uid] = (people[uid] || 0) + n; clearTimeout(peopleT); peopleT = setTimeout(() => kvSet("people", people), 2000); }
// results appear while a scan runs (at most every 1.5 s)
let liveT = 0, liveAt = 0;
function liveRefresh() {
  if (liveT) return; const wait = Math.max(0, 1500 - (Date.now() - liveAt));
  liveT = setTimeout(async () => { liveT = 0; liveAt = Date.now(); comments = await all("comments"); seqs = new Map((await all("seqs")).map((s) => [s.id, s])); renderAccounts(); renderStats(); const keep = Math.max(shownCount, PAGE); search(); while (shownCount < Math.min(keep, lastResults.length)) showMore(); }, wait);
}
async function popularSequences(pages, say) {   // /sequences?sort=2 — 30 a page, with their creators
  const out = [];
  for (let p = 1; p <= pages && !stopFlag; p++) {
    say(`Listing popular sequences… page ${p} of ${pages}`);
    const doc = new DOMParser().parseFromString(await siteFetch(`${SITE}/sequences?sort=2&page=${p}`).then((r) => r.text()), "text/html");
    const cards = [...doc.querySelectorAll(".sequence-card")]; if (!cards.length) break;
    for (const c of cards) {
      const id = (c.querySelector("a")?.getAttribute("href") || "").replace(/\D/g, ""); if (!id) continue;
      const a = c.querySelector(".sequence-author a[href*='/members/']");
      out.push({ id, title: c.querySelector(".sequence-title")?.getAttribute("title") || "", creatorUid: a ? a.getAttribute("href").replace(/\D/g, "") : undefined, creatorName: a ? a.textContent.trim() : undefined });
    }
    await sleep(150);
  }
  return out;
}
const needsCheck = (s, rescan) => rescan || !s.scannedAt || uids.some((u) => !(s.scannedFor || []).includes(u));
let totals = { done: 0, found: 0, failed: 0 };
async function checkList(ids, label) {   // read the comments of each sequence, 3 at a time, politely
  let done = 0;
  await pool(ids, 4, async (id) => {
    try { const n = await scanOne(id, uids); totals.found += n; } catch (e) { totals.failed++; }   // (not `x += await …`: workers run side by side)
    done++; totals.done++;
    progress(done, ids.length, `${label}: ${done.toLocaleString()} of ${ids.length.toLocaleString()} sequences · ${totals.found.toLocaleString()} of your comments so far${totals.failed ? ` · ${totals.failed} couldn't be read` : ""}`);
    if (done % 25 === 0) renderStats();
    await sleep(100);
  });
}
const DEEP_MAX = 25000;   // sequences a single deep scan will check before stopping (press Scan again to continue)
async function deepScan(rescan, say) {
  const expanded = (await kvGet("expandedPeople", {})) || {}; let checked = 0; await loadPeople();
  for (let round = 1; !stopFlag && checked < DEEP_MAX; round++) {
    comments = await all("comments"); seqs = new Map((await all("seqs")).map((s) => [s.id, s]));
    // who made the sequences you commented on
    const mineSeqs = [...new Set(comments.filter((c) => !c.gone).map((c) => c.seq))];
    const unknown = mineSeqs.filter((id) => !seqs.get(id) || seqs.get(id).creatorUid === undefined);
    let k = 0; await pool(unknown, 4, async (id) => { try { await learnSequence(id); } catch (e) {} k++; say(`Finding who made the sequences you commented on (${k}/${unknown.length})…`); await sleep(100); });
    // everyone you've interacted with, most first
    const score = { ...people };
    for (const c of comments) { if (c.gone) continue; const u = seqs.get(c.seq)?.creatorUid; if (u) score[u] = (score[u] || 0) + 5; if (c.parentUid) score[c.parentUid] = (score[c.parentUid] || 0) + 3; }
    for (const u of uids) delete score[u];
    const fresh = Object.keys(score).filter((u) => (rescan && round === 1) || !expanded[u]).sort((p, q) => score[q] - score[p]);
    if (!fresh.length) break;
    let n = 0;
    for (const u of fresh) {
      if (stopFlag || checked >= DEEP_MAX) break; n++;
      let list = [];
      try { list = await ownSequences(u, (t) => say(`Deep scan: person ${n} of ${fresh.length} — ${t}`)); await addSeqs(list, "people"); } catch (e) { continue; }
      expanded[u] = Date.now(); if (n % 5 === 0) kvSet("expandedPeople", expanded);
      seqs = new Map((await all("seqs")).map((s) => [s.id, s]));
      const todo = list.map((x) => x.id).filter((id) => seqs.get(id) && needsCheck(seqs.get(id), false)).slice(0, DEEP_MAX - checked);
      checked += todo.length;
      if (todo.length) await checkList(todo, `Deep scan: person ${n} of ${fresh.length}${list[0] && list[0].creatorName ? ` (${list[0].creatorName})` : ""}`);
    }
    await kvSet("expandedPeople", expanded);
  }
  return checked;
}
$("#scan").addEventListener("click", async () => {
  if (scanning) return; scanning = true; stopFlag = false; totals = { done: 0, found: 0, failed: 0 };
  $("#scan").disabled = true; $("#stop").hidden = false; $("#live").hidden = false; $("#live").classList.remove("paused"); $("#livePause").textContent = "Pause";
  const say = (t) => progress(0, 0, t);
  try {
    uids = (await send({ type: "cm:uids" })) || uids;
    if (!uids.length) { say("No account known yet — open Online Sequencer while signed in, then scan."); return; }
    const rescan = $("#rescan").checked;
    // 1. gather candidates
    await loadPeople();
    if ($("#srcOwn").checked) for (const u of uids) { if (stopFlag) break; try { const own = await ownSequences(u, say); await addSeqs(own.map((x) => ({ ...x, creatorUid: u, force: true })), "own"); } catch (e) {} }
    if ($("#srcHistory").checked && await hasHistory()) { say("Reading browser history…"); try { await addSeqs(await historySequences(), "history"); } catch (e) {} }
    if ($("#srcPopular").checked && !stopFlag) { try { await addSeqs(await popularSequences(+$("#popPages").value, say), "popular"); } catch (e) {} }
    let pasted = [];
    if ($("#srcPaste").checked) { pasted = [...new Set(($("#paste").value.match(/(?:onlinesequencer\.net\/)?\b(\d{2,9})\b/g) || []).map((x) => x.replace(/\D/g, "")))]; await addSeqs(pasted.map((id) => ({ id })), "pasted"); }
    seqs = new Map((await all("seqs")).map((s) => [s.id, s]));
    // 2. check the chosen sources (sequences not yet checked for every account, or all of them when rechecking)
    const want = new Set([...($("#srcVisited").checked ? ["visited"] : []), ...($("#srcOwn").checked ? ["own"] : []), ...($("#srcHistory").checked ? ["history"] : []), ...($("#srcPopular").checked ? ["popular"] : []), ...($("#srcPaste").checked ? ["pasted"] : [])]);
    const pastedSet = new Set(pasted);
    const rank = (s) => ((s.sources || []).includes("own") ? 0 : (s.sources || []).includes("visited") ? 1 : 2);
    const todo = [...seqs.values()].filter((s) => (s.sources || []).some((x) => want.has(x)) && (pastedSet.has(s.id) || needsCheck(s, rescan))).sort((a, b) => rank(a) - rank(b) || +b.id - +a.id).map((s) => s.id);
    if (todo.length && !stopFlag) await checkList(todo, "Checking");
    // 3. deep scan: everyone you've talked to, round after round
    if ($("#srcDeep").checked && !stopFlag) await deepScan(rescan, say);
    if (!totals.done && !stopFlag) { say("Everything chosen is already checked. Tick “Check again” to refresh."); return; }
    progress(1, 1, `${stopFlag ? "Stopped" : "Done"} — checked ${totals.done.toLocaleString()} sequences, ${totals.found.toLocaleString()} of your comments in them${totals.failed ? `, ${totals.failed} couldn't be read (try again later)` : ""}.${stopFlag ? " Press Scan to carry on where it left off." : ""}`);
  } finally {
    scanning = false; $("#scan").disabled = false; $("#stop").hidden = true;
    $("#live").classList.add("paused"); $("#livePause").textContent = stopFlag ? "Resume" : "Scan again";
    if (!stopFlag && totals.done === 0) $("#live").hidden = true;   // nothing new to check: no need for the strip
    await loadAll();
    if (pendingRescan && !stopFlag) { pendingRescan = false; setTimeout(() => $("#scan").click(), 300); }
  }
});
$("#stop").addEventListener("click", () => { stopFlag = true; });
$("#livePause").addEventListener("click", () => { if (scanning) { stopFlag = true; $("#livePause").textContent = "Pausing…"; } else $("#scan").click(); });

// live: comments added in other tabs while this page is open
let otherT = 0; setInterval(async () => { if (scanning || document.hidden) return; const n = (await all("comments")).length; if (n !== comments.length) { clearTimeout(otherT); otherT = setTimeout(loadAll, 200); } }, 4000);

$("#toLibrary").addEventListener("click", () => send({ type: "open:library" }));

// ---------- start ----------
const hq = new URLSearchParams(location.hash.slice(1)).get("q"); if (hq) $("#q").value = hq;
refreshHistoryUi();
loadAll().then(async () => {
  $("#q").focus();
  // scan by itself: the first time it goes through the whole account; after that it only checks what's new
  if (uids.length) { $("#autoNote").hidden = false; $("#scan").click(); }
  if (!(await hasHistory())) $("#historyHint").hidden = false;
});
$("#historyGrant").addEventListener("click", async () => { let ok = false; try { ok = await chrome.permissions.request({ permissions: ["history"] }); } catch (e) {} if (ok) { $("#historyHint").hidden = true; $("#srcHistory").checked = true; refreshHistoryUi(); if (!scanning) $("#scan").click(); else toast2("History will be included in the next scan — it starts again by itself when this one finishes."), (pendingRescan = true); } });
