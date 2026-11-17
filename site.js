// Glow Theme for Online Sequencer — profile banners, a better profile sequence browser, and site-wide quality of life:
// bigger cards + endless scrolling on the Sequences pages, a compact sticky header, back-to-top, keyboard shortcuts and
// a "Recently viewed" menu. Runs in the extension's isolated world in the top frame; the page's scripts can't see it.
(function () {
  "use strict";
  if (window.top !== window || window.__osgSite) return; window.__osgSite = true;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const unesc = (s) => { const t = document.createElement("textarea"); t.innerHTML = s; return t.value; };
  const send = (msg) => new Promise((res) => { try { chrome.runtime.sendMessage(msg, (r) => { void chrome.runtime.lastError; res(r || null); }); } catch (e) { res(null); } });
  const store = { get: (k, d) => new Promise((res) => { try { chrome.storage.local.get({ [k]: d }, (v) => res(chrome.runtime.lastError ? d : v[k])); } catch (e) { res(d); } }), set: (k, v) => { try { chrome.storage.local.set({ [k]: v }); } catch (e) {} } };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // every request to the site goes through the extension's polite queue (net.js); pri 0 = you asked, 1 = soon, 2 = background
  const net = (u, o, pri) => (window.__osgNet ? window.__osgNet.fetch(u, o, pri) : fetch(u, o));
  // a small cache that outlives the page (this site's IndexedDB): sequence pictures and the player's meters, so seeing
  // a sequence again doesn't download it again. Keeps the 300 most recent.
  const cache = (() => {
    let dbp = null; const IDX = "osg-cache-keys", MAXN = 300;
    const open = () => dbp || (dbp = new Promise((res) => { try { const r = indexedDB.open("osg-cache", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => res(r.result); r.onerror = () => res(null); } catch (e) { res(null); } }));
    const run = async (mode, fn) => { const d = await open(); if (!d) return null; return new Promise((res) => { try { const t = d.transaction("kv", mode), q = fn(t.objectStore("kv")); t.oncomplete = () => res(q && q.result !== undefined ? q.result : null); t.onerror = t.onabort = () => res(null); } catch (e) { res(null); } }); };
    const idx = () => { try { return JSON.parse(localStorage.getItem(IDX) || "{}"); } catch (e) { return {}; } };
    return {
      async get(k, maxAge) { const v = await run("readonly", (st) => st.get(k)); return v && (!maxAge || Date.now() - v.at < maxAge) ? v.v : null; },
      put(k, v) {
        run("readwrite", (st) => st.put({ v, at: Date.now() }, k));
        const ix = idx(); ix[k] = Date.now(); const ks = Object.keys(ix);
        if (ks.length > MAXN) { const old = ks.sort((a, b) => ix[a] - ix[b]).slice(0, ks.length - MAXN); old.forEach((x) => delete ix[x]); run("readwrite", (st) => { old.forEach((x) => st.delete(x)); return null; }); }
        try { localStorage.setItem(IDX, JSON.stringify(ix)); } catch (e) {}
      },
    };
  })();
  // the site asked the extension to slow down: say so once, so a quiet pause doesn't look broken
  let pauseToldAt = 0;
  document.addEventListener("osg:net-pause", (e) => {
    if (Date.now() - pauseToldAt < 60000) return; pauseToldAt = Date.now();
    let ms = 15000; try { ms = JSON.parse(e.detail).ms || ms; } catch (err) {}
    setTimeout(() => toast(`Online Sequencer asked to slow down — Glow Theme is pausing its extra loading for ${Math.round(ms / 1000)} s, then carries on.`), 0);
  });
  // which extras are on (popup → Quality of life); all on unless switched off
  const QOL_DEFAULTS = { ytLayout: true, scPlaylists: true, banners: true, profileBrowser: true, quickActions: true, endless: true, sticky: true, backToTop: true, recent: true, shortcuts: true, seqSize: "m", profileSize: "m", featuredSize: "m" };
  const readQ = (v) => { const q = { ...QOL_DEFAULTS, ...(v || {}) }; if (v && v.bigCards === false && !v.seqSize) q.seqSize = "classic"; return q; };   // 2.24's "Bigger cards" switch
  let Q = { ...QOL_DEFAULTS };
  const eligibleYt = () => page() !== "page_view" && !!$("#header #nav") && !!$("#main");
  // card size picker (S / M / L, plus the site's own look where that makes sense); writes the same setting as the popup
  function sizePicker(key, withClassic) {
    const el = document.createElement("div"); el.className = "osg-size"; el.setAttribute("role", "group"); el.setAttribute("aria-label", "Card size");
    const opts = [...(withClassic ? [["classic", "Site", "The site's own cards"]] : []), ["s", "S", "Small cards"], ["m", "M", "Medium cards"], ["l", "L", "Large cards"]];
    el.innerHTML = opts.map(([v, t, title]) => `<button type="button" data-v="${v}" title="${title}">${t}</button>`).join("");
    const mark = () => el.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === Q[key]));
    el.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; Q = { ...Q, [key]: b.dataset.v }; store.set("qol", Q); apply(); });
    el.osgMark = mark; mark(); return el;
  }
  const fmtN = (n) => (n == null || isNaN(n) ? "–" : Number(n).toLocaleString());
  const num = (s) => +String(s || "").replace(/[^\d]/g, "") || 0;
  const page = () => document.body ? document.body.id : "";
  const seqIdHere = () => (location.pathname.match(/^\/(\d+)\/?$/) || [])[1] || "";
  const memberIdHere = () => (location.pathname.match(/^\/members\/(\d+)/) || [])[1] || "";

  let toastEl = null, toastT = 0;
  window.__osgToast = (t, secs) => toast(t, secs);
  function toast(text, secs) {
    if (!toastEl) { toastEl = document.createElement("div"); toastEl.id = "osg-site-toast"; toastEl.setAttribute("role", "status"); document.body.appendChild(toastEl); }
    toastEl.textContent = text; toastEl.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove("show"), (secs || Math.max(3, text.length / 16)) * 1000);
  }

  // ---------- small facts about sequences (title, plays, date), fetched once and remembered in this browser ----------
  const META_KEY = "osg-seq-meta2";
  let metaCache = null;
  function metaAll() { if (!metaCache) { try { metaCache = JSON.parse(localStorage.getItem(META_KEY) || "{}"); } catch (e) { metaCache = {}; } } return metaCache; }
  let metaSaveT = 0;
  function metaPut(id, m) {
    const all = metaAll(); all[id] = { ...m, at: Date.now() };
    clearTimeout(metaSaveT); metaSaveT = setTimeout(() => { const keys = Object.keys(all); if (keys.length > 4000) keys.sort((a, b) => all[a].at - all[b].at).slice(0, keys.length - 3500).forEach((k) => delete all[k]); try { localStorage.setItem(META_KEY, JSON.stringify(all)); } catch (e) {} }, 800);
  }
  const metaQueue = [], metaWaiters = new Map(); let metaActive = 0;
  function seqMeta(id) {
    const m = metaAll()[id]; if (m && Date.now() - m.at < 7 * 86400e3) return Promise.resolve(m);
    if (metaWaiters.has(id)) return metaWaiters.get(id);
    const p = new Promise((res) => metaQueue.push({ id, res })); metaWaiters.set(id, p); pumpMeta(); return p;
  }
  function pumpMeta() {
    while (metaActive < 1 && metaQueue.length) {
      const { id, res } = metaQueue.shift(); metaActive++;
      net("/" + id, null, 2).then((r) => (r.ok ? r.text() : "")).then((html) => {
        const og = (html.match(/property="og:title" content="([^"]*)"/) || [])[1];
        if (og == null) { res(null); return; }   // not a sequence page (busy server, removed sequence…): don't remember anything
        const m = { t: unesc(og).trim() || "Untitled", p: num((html.match(/class="playcount"[^>]*>([\d,]+) plays?/) || [])[1]), d: (html.match(/title="created (\d{4}-\d{2}-\d{2})"/) || [])[1] || "" };
        metaPut(id, m); res(m);
      }).catch(() => res(null)).finally(() => { metaActive--; metaWaiters.delete(id); setTimeout(pumpMeta, 250); });
    }
  }
  // comment counts are remembered for a day (with the other card details), so a profile you come back to asks nothing
  const commentCounts = new Map();
  function commentCount(id) {
    const m = metaAll()[id]; if (m && m.c != null && Date.now() - (m.ca || 0) < 86400e3) return Promise.resolve(m.c);
    if (!commentCounts.has(id)) commentCounts.set(id, net(`/ajax/get_comments.php?id=0&id=${id}&page=1`, null, 2).then((r) => (r.ok ? r.text() : Promise.reject(r.status))).then((h) => {
      const c = (h.match(/class="chat comment-\d+"/g) || []).length; const all = metaAll(); all[id] = { ...(all[id] || { at: Date.now() }), c, ca: Date.now() };
      try { localStorage.setItem(META_KEY, JSON.stringify(all)); } catch (e) {} return c;
    }).catch(() => { commentCounts.delete(id); return null; }));
    return commentCounts.get(id);
  }

  // ---------- quick actions on a sequence (cards on profiles and on the Sequences pages) ----------
  function quickActions(id, { comments } = {}) {
    const bar = document.createElement("div"); bar.className = "osg-qa";
    bar.innerHTML = `<a href="/${id}" title="Open">▶</a><button type="button" data-qa="save" title="Save this sequence to your library">★</button><button type="button" data-qa="pl" data-osg-grp title="Add to a playlist">＋</button><button type="button" data-qa="copy" title="Copy link">⧉</button>${comments === undefined ? `<button type="button" data-qa="comments" title="Comments">💬 <span>…</span></button>` : ""}`;
    bar.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-qa]"); if (!b) return; e.preventDefault(); e.stopPropagation();
      if (b.dataset.qa === "copy") { try { await navigator.clipboard.writeText(`${location.origin}/${id}`); toast("Link copied."); } catch (err) { toast("Couldn't copy."); } }
      else if (b.dataset.qa === "pl") { if (window.__osgGroups) window.__osgGroups.open(b, id, ""); }
      else if (b.dataset.qa === "save") { b.disabled = true; b.textContent = "…"; const r = await send({ type: "lib:saveSite", seqId: id }); b.textContent = r && r.ok ? "✓" : "★"; b.disabled = false; toast(r && r.ok ? (r.duplicate ? `“${r.title}” is already in your library.` : `Saved “${r.title}” to your library.`) : "Couldn't save it" + (r && r.error ? ": " + r.error : ".")); }
      else if (b.dataset.qa === "comments") location.href = `/${id}`;
    });
    const loadCount = () => { const sp = bar.querySelector('[data-qa="comments"] span'); if (sp && sp.textContent === "…") commentCount(id).then((n) => { sp.textContent = n == null ? "?" : n; }); };
    bar.addEventListener("mouseenter", loadCount, { once: true }); bar.addEventListener("focusin", loadCount, { once: true });
    bar.osgLoadCount = loadCount;
    return bar;
  }

  // ======================================================================================================
  // Profile banners
  // ======================================================================================================
  // A banner is a short tag in the profile's bio — [banner: 1234567] (that sequence's art), [banner: aurora] (a colour
  // preset) or [banner: https://…/image.png] — so everyone with the extension sees it; people without it see the tag text.
  // Profiles without one get their most popular sequence's art.
  const PRESETS = {
    aurora: "linear-gradient(120deg, #0f2027, #203a43 40%, #2c5364 60%, #3ad59f)",
    sunset: "linear-gradient(120deg, #2b1055, #7597de 0%, #ff6a88 50%, #ff99ac 100%)",
    ocean: "linear-gradient(135deg, #021b79, #0575e6)",
    neon: "linear-gradient(120deg, #12002b, #7c5cff 45%, #00d4ff)",
    ember: "linear-gradient(135deg, #200122, #6f0000 45%, #ff7a18)",
    forest: "linear-gradient(135deg, #0b3d2e, #1d976c 55%, #93f9b9)",
    candy: "linear-gradient(120deg, #ff9a9e, #fad0c4 40%, #a18cd1)",
    midnight: "linear-gradient(160deg, #000000, #1a1a2e 50%, #16213e)",
    gold: "linear-gradient(135deg, #3a2a00, #b8860b 50%, #ffe082)",
    mono: "linear-gradient(135deg, #1b1b1f, #3a3a44)",
  };
  // [banner: 1234567] · [banner: 1234567 y30 tall] · [banner: neon] · [banner: https://…/x.png whole short]
  //   options: fill (default) | whole — z20…z300 = zoom (100 = as wide as the banner) — x0…x100 / y0…y100 = position — short | tall (height)
  const TAG_RE = /\[banner:\s*([^\]\s]+)((?:\s+[a-z0-9]+)*)\s*\]/i;
  const IMG_RE = /^https:\/\/[^\s"'<>]+\.(?:png|jpe?g|gif|webp|avif)(?:\?[^\s"'<>]*)?$/i;
  function parseBanner(v, extra) {
    v = String(v || "").trim(); let b = null;
    if (/^\d{1,9}$/.test(v)) b = { kind: "seq", id: v };
    else if (PRESETS[v.toLowerCase()]) b = { kind: "preset", name: v.toLowerCase() };
    else if (IMG_RE.test(v)) b = { kind: "image", url: v };
    if (!b) return null;
    b.fit = "fill"; b.x = 50; b.y = 50; b.z = 100; b.size = "medium";
    for (const o of String(extra || "").toLowerCase().split(/\s+/).filter(Boolean)) {
      if (o === "whole" || o === "fill") b.fit = o;
      else if (o === "short" || o === "tall" || o === "medium") b.size = o;
      else if (/^y\d{1,3}$/.test(o)) b.y = Math.max(0, Math.min(100, +o.slice(1)));
      else if (/^x\d{1,3}$/.test(o)) b.x = Math.max(0, Math.min(100, +o.slice(1)));
      else if (/^z\d{1,3}$/.test(o)) b.z = Math.max(ZMIN, Math.min(ZMAX, +o.slice(1)));
    }
    return b;
  }
  const ZMIN = 20, ZMAX = 300;
  const bannerOpts = (b) => [b.fit !== "fill" ? b.fit : "", (b.z ?? 100) !== 100 ? "z" + b.z : "", (b.x ?? 50) !== 50 ? "x" + b.x : "", (b.y ?? 50) !== 50 ? "y" + b.y : "", b.size !== "medium" ? b.size : ""].filter(Boolean).join(" ");
  function hideTagIn(el) {   // hide the [banner: …] text in the shown bio (it may span an auto-made link)
    const text = el.textContent, m = TAG_RE.exec(text); if (!m) return;
    const start = m.index, end = m.index + m[0].length; let pos = 0, sNode = null, sOff = 0, eNode = null, eOff = 0;
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) { const len = n.nodeValue.length; if (!sNode && start < pos + len) { sNode = n; sOff = start - pos; } if (end <= pos + len) { eNode = n; eOff = end - pos; break; } pos += len; }
    if (!sNode || !eNode) return;
    const r = document.createRange(); r.setStart(sNode, sOff); r.setEnd(eNode, eOff);
    const span = document.createElement("span"); span.className = "osg-banner-tag"; span.title = "Profile banner tag (Glow Theme)"; span.appendChild(r.extractContents()); r.insertNode(span);
  }
  async function autoBannerSeq(uid) {
    const key = "osg-auto-banner-" + uid; try { const c = JSON.parse(sessionStorage.getItem(key) || "null"); if (c && Date.now() - c.at < 3600e3) return c.id; } catch (e) {}
    try {
      const doc = new DOMParser().parseFromString(await net(`/members/${uid}?sort=2`, null, 1).then((r) => r.text()), "text/html");
      const id = (doc.querySelector("#page_right .pager-items .preview a")?.getAttribute("href") || "").replace(/\D/g, "");
      try { sessionStorage.setItem(key, JSON.stringify({ id, at: Date.now() })); } catch (e) {}
      return id;
    } catch (e) { return ""; }
  }
  // a sequence picture drawn from its notes (the whole song, square cells, the site's instrument colours) —
  // crisper than the site's preview image and it doesn't stop part way like the preview does
  const askPage = (kind, payload = {}, ms = 4000) => new Promise((res) => {
    const id = Math.random().toString(36).slice(2);
    const on = (e) => { if (e.source !== window || !e.data || e.data["osg-lib"] !== "reply" || e.data.id !== id) return; removeEventListener("message", on); clearTimeout(t); res(e.data); };
    const t = setTimeout(() => { removeEventListener("message", on); res({ ok: false }); }, ms);
    addEventListener("message", on); window.postMessage({ "osg-lib": kind, id, ...payload }, location.origin);
  });
  function pb(b, a = 0, e = b.length) {   // tiny protobuf reader: [field, wire, value | [start, end]]
    const out = []; let p = a;
    const vint = () => { let r = 0, s = 0, x; do { x = b[p++]; r += (x & 127) * 2 ** s; s += 7; } while (x & 128 && p < e); return r; };
    while (p < e) {
      const k = vint(), f = Math.floor(k / 8), t = k & 7;
      if (t === 0) out.push([f, 0, vint()]);
      else if (t === 5) { out.push([f, 5, new DataView(b.buffer, b.byteOffset + p, 4).getFloat32(0, true)]); p += 4; }
      else if (t === 1) { out.push([f, 1, new DataView(b.buffer, b.byteOffset + p, 8).getFloat64(0, true)]); p += 8; }
      else if (t === 2) { const l = vint(); out.push([f, 2, [p, p + l]]); p += l; }
      else break;
    }
    return out;
  }
  // a sequence's notes and custom instrument colours, read straight from its saved data (shared with the playlist player)
  // live: on a playlist page the site is loading the playing sequence itself — read its notes from the site once it has
  // them (asking the page), rather than downloading the same file a second time alongside it
  const noteCache = new Map();
  async function liveNotes(id) {
    const until = Date.now() + 9000;
    while (Date.now() < until) {
      const r = await askPage("song", { seq: id }, 3000);
      if (r && r.ok) return { notes: r.notes.map(([type, time, len, inst, vol]) => ({ type, time, len, inst, vol })).filter((n) => n.vol > 0.002 && n.len > 0), custom: {}, bpm: r.bpm > 0 ? r.bpm : 110, timeSig: r.timeSig > 0 ? r.timeSig : 4, tempo: (r.tempo || []).map(([time, value, blend]) => ({ time, value, blend })).sort((a, b) => a.time - b.time) };
      if (!r || r.none) return null;   // no sequencer on this page
      await sleep(400);   // still loading that one
    }
    return null;
  }
  function seqNotes(id, opt = {}) {
    if (noteCache.has(id)) return noteCache.get(id);
    const job = (async () => {
      if (opt.live && (page() === "page_playlist" || page() === "page_view")) { const d = await liveNotes(id); if (d && d.notes.length) return d; }
      const r = await net(`/app/api/get_proto.php?v=2&id=${id}`, null, opt.pri ?? 1);
      if (!r.ok) { noteCache.delete(id); return null; }   // not remembered, so a later look can try again
      const buf = new Uint8Array(await r.arrayBuffer()), top = pb(buf), custom = {}, notes = [], tempo = [];
      let bpm = 110, timeSig = 4;
      for (const [f, w, v] of top) {
        if (f === 1 && w === 2) for (const [f2, w2, v2] of pb(buf, v[0], v[1])) {   // settings: tempo, time signature, custom colours
          if (f2 === 1 && w2 === 0 && v2 > 0) bpm = v2; else if (f2 === 1 && w2 === 5 && v2 > 0) bpm = v2;
          if (f2 === 2 && w2 === 0 && v2 > 0) timeSig = v2;
          if (f2 !== 3 || w2 !== 2) continue; let inst = 0, col = null;
          for (const [f3, w3, v3] of pb(buf, v2[0], v2[1])) { if (f3 === 1 && w3 === 0) inst = v3; if (f3 === 2 && w3 === 2) for (const [f4, w4, v4] of pb(buf, v3[0], v3[1])) if (f4 === 17 && w4 === 0) col = v4; }
          if (col != null) custom[inst] = [255, Math.floor(col / 65536) % 256, Math.floor(col / 256) % 256, col % 256];
        } else if (f === 2 && w === 2) {
          const n = { type: 0, time: 0, len: 1, inst: 0, vol: 1 };
          for (const [g, wg, val] of pb(buf, v[0], v[1])) { if (g === 1 && wg === 0) n.type = val; else if (g === 2 && wg === 5) n.time = val; else if (g === 3 && wg === 5) n.len = val; else if (g === 4 && wg === 0) n.inst = val; else if (g === 5 && wg === 5) n.vol = val; }
          if (n.vol > 0.002 && n.len > 0) notes.push(n);
        } else if (f === 3 && w === 2) {   // markers: tempo changes are setting 0 on instrument 0 (time in steps, value in BPM, blend = ramp)
          const m = { time: 0, setting: 0, inst: 0, value: 0, blend: false };
          for (const [g, wg, val] of pb(buf, v[0], v[1])) { if (g === 1 && wg === 5) m.time = val; else if (g === 2 && wg === 0) m.setting = val; else if (g === 3 && wg === 0) m.inst = val; else if (g === 4 && wg === 5) m.value = val; else if (g === 5 && wg === 0) m.blend = !!val; }
          if (m.setting === 0 && m.inst === 0) tempo.push({ time: m.time, value: m.value, blend: m.blend });
        }
      }
      tempo.sort((x, y) => x.time - y.time);
      return { notes, custom, bpm, timeSig, tempo };
    })().catch(() => { noteCache.delete(id); return null; });
    noteCache.set(id, job); return job;
  }
  const artCache = new Map();
  const ART_V = "art3:";
  function seqArt(id, opt = {}) {
    if (artCache.has(id)) return artCache.get(id);
    const job = (async () => {
      const hit = await cache.get(ART_V + id, 3 * 86400e3);
      if (hit && hit.blob) return { url: URL.createObjectURL(hit.blob), w: hit.w, h: hit.h, art: hit.art };
      const d = await seqNotes(id, opt); if (!d) { artCache.delete(id); return null; }
      const custom = d.custom, notes = d.notes.slice();
      if (!notes.length) return null;
      // note-art sequences keep their picture in one solid block: a long run of columns that each hold the same number of
      // short notes (one per row of the picture, 16 rows or more). Show just that block when there is one. (Music right
      // next to it can make one column busier, so it looks for that steady count rather than the busiest column.)
      const per = new Map(); for (const n of notes) if (n.len <= 2) { const t = Math.floor(n.time); per.set(t, (per.get(t) || 0) + 1); }
      let win = null;
      if (per.size) {
        const freq = new Map(); for (const v of per.values()) if (v >= 16) freq.set(v, (freq.get(v) || 0) + 1);
        const cand = [...freq.entries()].filter(([, k]) => k >= 8).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([v]) => v);
        const ts = [...per.keys()].sort((a, b) => a - b);
        for (const v of cand) {
          const runs = []; let cur = null, gap = 0;
          for (let t = ts[0]; t <= ts[ts.length - 1] + 3; t++) {
            if ((per.get(t) || 0) >= v * 0.9) { if (!cur) cur = { a: t, b: t }; cur.b = t; gap = 0; }
            else if (cur && ++gap > 2) { runs.push(cur); cur = null; gap = 0; }
          }
          if (cur) runs.push(cur);
          for (const r of runs) {
            const len = r.b - r.a + 1; if (len < 15) continue;
            let steady = 0; for (let t = r.a; t <= r.b; t++) { const x = per.get(t) || 0; if (x >= v * 0.9 && x <= v * 1.25) steady++; }
            if (steady / len >= 0.6 && (!win || len * v > (win.b - win.a + 1) * win.v)) win = { a: r.a, b: r.b, v };
          }
        }
      }
      let isArt = false;
      if (win) { const inside = notes.filter((n) => n.time < win.b + 1 && n.time + n.len > win.a); if (inside.length >= notes.length * 0.15 || inside.length >= 500) { isArt = true; notes.length = 0; notes.push(...inside.map((n) => ({ ...n, time: Math.max(n.time, win.a), len: Math.min(n.time + n.len, win.b + 1) - Math.max(n.time, win.a) }))); } }
      const ids = [...new Set(notes.map((n) => n.inst))].filter((i) => !custom[i]);
      const pal = ids.length ? await askPage("palette", { ids }) : { colors: {} };
      let t0 = Infinity, t1 = -Infinity, lo = Infinity, hi = -Infinity;
      for (const n of notes) { t0 = Math.min(t0, n.time); t1 = Math.max(t1, n.time + n.len); lo = Math.min(lo, n.type); hi = Math.max(hi, n.type); }
      // squished into a square, like the site's own thumbnails — note artists draw for that shape
      const cols = t1 - t0, rows = hi - lo + 1, S = Math.max(64, Math.min(1600, Math.ceil(Math.max(cols, rows) / 2) * 16));
      const X = (t) => Math.round(((t - t0) / cols) * S), Y = (r) => Math.round((r / rows) * S);
      const c = document.createElement("canvas"); c.width = S; c.height = S;
      const g = c.getContext("2d"); g.fillStyle = "#000"; g.fillRect(0, 0, c.width, c.height);
      const fill = {}; const colour = (i) => fill[i] || (fill[i] = (() => { const a = custom[i] || (pal.colors && pal.colors[i]) || [255, 124, 92, 255]; return `rgb(${Math.min(255, a[1])},${Math.min(255, a[2])},${Math.min(255, a[3])})`; })());
      for (const n of notes) { const x = X(n.time), y = Y(hi - n.type); g.fillStyle = colour(n.inst); g.fillRect(x, y, Math.max(1, X(n.time + n.len) - x), Math.max(1, Y(hi - n.type + 1) - y)); }
      const blob = await new Promise((res) => c.toBlob(res, "image/png")); if (!blob) return null;
      cache.put(ART_V + id, { blob, w: c.width, h: c.height, art: isArt });
      return { url: URL.createObjectURL(blob), w: c.width, h: c.height, art: isArt };   // art: false = no picture block, the whole song drawn
    })().catch(() => null);
    artCache.set(id, job); return job;
  }
  // each instrument's colour in a sequence (its own custom colours first, then the site's) as [r, g, b]
  const colCache = new Map();
  function seqColours(id) {
    if (colCache.has(id)) return colCache.get(id);
    const job = (async () => {
      const d = await seqNotes(id); if (!d) { colCache.delete(id); return null; }
      const all = [...new Set(d.notes.map((n) => n.inst))], ids = all.filter((i) => !d.custom[i]);
      const pal = ids.length ? await askPage("palette", { ids }) : { colors: {} }, out = {};
      for (const i of all) { const a = d.custom[i] || (pal.colors && pal.colors[i]) || [255, 124, 92, 255]; out[i] = [a[1], a[2], a[3]].map((v) => Math.min(255, v)); }
      return out;
    })().catch(() => null);
    colCache.set(id, job); return job;
  }
  window.__osgArt = { seqArt, seqNotes, seqColours, askPage, cache, net };   // for the playlist player (sc.js)
  // motion, shared with yt.js and sc.js. Calm when the popup's Animations switch is off or the system asks for reduced motion.
  // smooth(update) runs a change inside the browser's view transition: elements named for it (html.osg-vt … in theme.css)
  // slide and resize from where they were to where they end up, and the rest crossfades. update may be async (the page
  // holds its old picture until it resolves), e.g. to let the site redraw its sequencer at its new size first.
  const calm = () => document.documentElement.classList.contains("osg-no-anim") || matchMedia("(prefers-reduced-motion: reduce)").matches;
  function smooth(update) {
    if (calm() || !document.startViewTransition || document.visibilityState !== "visible") return update();
    const root = document.documentElement; root.classList.add("osg-vt");
    try { const t = document.startViewTransition(update); t.finished.finally(() => root.classList.remove("osg-vt")); return t.updateCallbackDone; }
    catch (e) { root.classList.remove("osg-vt"); return update(); }
  }
  const close = function (el, fade) {   // a pop-out eases away, then goes (fade: just fade, for full-screen overlays)
    if (!el) return;
    const calm = document.documentElement.classList.contains("osg-no-anim") || matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (calm || !el.isConnected || !el.getClientRects().length) { el.remove(); return; }
    el.classList.add(fade ? "osg-fade-out" : "osg-pop-out"); el.setAttribute("aria-hidden", "true"); el.style.pointerEvents = "none";
    let done = false; const fin = () => { if (!done) { done = true; el.remove(); } };
    el.addEventListener("animationend", fin, { once: true }); setTimeout(fin, 260);
  };
  window.__osgMotion = { calm, smooth, close };
  let bannerEl = null, bannerState = null, bannerDims = null, bannerRO = null;
  // zoom 100 = the picture just covers the banner; less shows more of it (a blurred copy fills the rest)
  function artSize(b) {
    const W = bannerEl.clientWidth, H = bannerEl.clientHeight, d = bannerDims || { w: 1200, h: 630 };
    const s = Math.max(W / d.w, H / d.h) * ((b.z ?? 100) / 100);
    return { W, H, iw: d.w * s, ih: d.h * s };
  }
  function styleBanner(b) {   // fit / position / height on the element (also used live while you drag)
    const z = b.z ?? 100, fill = b.fit === "fill" && b.kind !== "preset";
    bannerEl.className = `osg-banner-${b.kind} osg-fit-${b.kind === "preset" ? "fill" : b.fit} osg-bh-${b.size}${fill && z < 100 ? " osg-zout" : ""}${bannerEl.osgDrawn ? " osg-art-drawn" : ""}`;
    const art = bannerEl.querySelector(".osg-banner-art:not(.osg-banner-blur)"); if (!art) return;
    if (fill) { const { iw, ih } = artSize(b); art.style.backgroundSize = `${iw}px ${ih}px`; } else art.style.backgroundSize = "";
    art.style.backgroundPosition = fill ? `${b.x ?? 50}% ${b.y ?? 50}%` : "";
    bannerEl.osgShown = b;
  }
  async function renderBanner() {
    const uid = memberIdHere(), top = $(".profile_banner"); if (!uid || !top || !Q.banners) return;
    if (bannerEl && bannerEl.classList.contains("osg-repos")) return;   // don't redraw under your mouse
    const bio = $("#bio-text"); const tag = bio ? TAG_RE.exec(bio.textContent) : null;
    if (bio && tag) hideTagIn(bio);
    let b = tag ? parseBanner(tag[1], tag[2]) : null, auto = false;
    if (!b) { const id = await autoBannerSeq(uid); if (!Q.banners) return; b = parseBanner(id || Object.keys(PRESETS)[+uid % Object.keys(PRESETS).length], ""); auto = true; }
    bannerState = { ...b, auto, raw: tag ? tag[1] : "" };
    if (!bannerEl || !document.contains(bannerEl)) { bannerEl = document.createElement("div"); bannerEl.id = "osg-banner"; top.insertAdjacentElement("beforebegin", bannerEl); document.body.classList.add("osg-has-banner"); }
    const bg = b.kind === "seq" ? `url("/preview.php?id=${b.id}&t=0&s=1")` : b.kind === "image" ? `url("${b.url.replace(/"/g, "%22")}")` : PRESETS[b.name];
    const owner = !!$("#bio-edit");
    bannerEl.innerHTML = `<div class="osg-banner-art" style='background-image:${esc(bg)}'></div>${b.kind !== "preset" ? `<div class="osg-banner-art osg-banner-blur" style='background-image:${esc(bg)}'></div>` : ""}<div class="osg-banner-shade"></div>
      ${b.kind === "seq" ? `<a class="osg-banner-credit" href="/${b.id}" title="Open this sequence">♪ <span>${esc(metaAll()[b.id]?.t || "Sequence " + b.id)}</span></a>` : ""}
      ${owner ? `<button type="button" class="osg-banner-edit">${auto ? "Set a banner" : "Change banner"}</button>` : ""}`;
    bannerDims = b.kind === "seq" ? { w: 100, h: 100 } : null; bannerEl.osgDrawn = false;
    styleBanner(b);
    if (!bannerRO && window.ResizeObserver) { bannerRO = new ResizeObserver(() => { if (bannerEl && bannerEl.osgShown) styleBanner(bannerEl.osgShown); if (bannerEl && bannerEl.classList.contains("osg-repos")) bannerEl.classList.add("osg-repos"); }); }
    bannerRO?.disconnect(); bannerRO?.observe(bannerEl);
    const swap = (url, w, h) => { if (!bannerEl) return; bannerDims = { w, h }; for (const el of bannerEl.querySelectorAll(".osg-banner-art")) el.style.backgroundImage = `url("${url}")`; bannerEl.osgDrawn = true; styleBanner(bannerEl.osgShown || b); };
    if (b.kind === "seq") seqArt(b.id).then((a) => { if (a && bannerState && bannerState.id === b.id) swap(a.url, a.w, a.h); });
    if (b.kind === "image") { const im = new Image(); im.onload = () => { if (bannerState && bannerState.url === b.url) { bannerDims = { w: im.naturalWidth, h: im.naturalHeight }; styleBanner(bannerEl.osgShown || b); } }; im.src = b.url; }
    if (b.kind === "seq") seqMeta(b.id).then((m) => { const s = bannerEl.querySelector(".osg-banner-credit span"); if (m && s) s.textContent = m.t; });
    bannerEl.querySelector(".osg-banner-edit")?.addEventListener("click", openBannerPicker);
  }
  // drag the picture up or down to choose which part shows (like YouTube's banner crop)
  function startReposition() {
    if (!bannerEl || !bannerState || bannerState.kind === "preset") return;
    const b = { ...bannerState, fit: "fill", x: bannerState.x ?? 50, y: bannerState.y ?? 50, z: bannerState.z ?? 100 }; styleBanner(b);
    bannerEl.classList.add("osg-repos");
    const bar = document.createElement("div"); bar.className = "osg-banner-repos";
    bar.innerHTML = `<span class="osg-br-hint">Drag to move</span><button type="button" data-r="out" title="Zoom out">−</button><input type="range" min="${ZMIN}" max="${ZMAX}" step="1" value="${b.z}" aria-label="Zoom"><button type="button" data-r="in" title="Zoom in">+</button><span class="osg-br-z">${b.z}%</span><button type="button" data-r="reset" title="Back to filling the width">Reset</button><button type="button" data-r="cancel">Cancel</button><button type="button" data-r="save" class="primary">Save</button>`;
    bannerEl.appendChild(bar);
    const art = bannerEl.querySelector(".osg-banner-art:not(.osg-banner-blur)"), range = bar.querySelector("input"), zl = bar.querySelector(".osg-br-z");
    const show = () => { styleBanner(b); bannerEl.classList.add("osg-repos"); range.value = b.z; zl.textContent = b.z + "%"; };
    const setZoom = (z) => { b.z = Math.round(Math.max(ZMIN, Math.min(ZMAX, z))); show(); };
    let drag = null;
    const down = (e) => { if (e.target.closest(".osg-banner-repos")) return; e.preventDefault(); drag = { cx: e.clientX, cy: e.clientY, x0: b.x, y0: b.y }; bannerEl.setPointerCapture?.(e.pointerId); };
    const move = (e) => {
      if (!drag) return;
      // background-position %: the free space (banner − picture) decides how many % one pixel of dragging is
      const { W, H, iw, ih } = artSize(b);
      const fx = W - iw, fy = H - ih;
      if (Math.abs(fx) > 1) b.x = Math.round(Math.max(0, Math.min(100, drag.x0 + ((e.clientX - drag.cx) / fx) * 100)));
      if (Math.abs(fy) > 1) b.y = Math.round(Math.max(0, Math.min(100, drag.y0 + ((e.clientY - drag.cy) / fy) * 100)));
      show();
    };
    const up = () => { drag = null; };
    const wheel = (e) => { e.preventDefault(); setZoom(b.z * (e.deltaY < 0 ? 1.08 : 1 / 1.08)); };
    range.addEventListener("input", () => setZoom(+range.value));
    const done = (save) => {
      bannerEl.removeEventListener("pointerdown", down); bannerEl.removeEventListener("pointermove", move); bannerEl.removeEventListener("wheel", wheel); removeEventListener("pointerup", up);
      bannerEl.classList.remove("osg-repos"); bar.remove();
      if (save) { if (bannerState.auto) toast("Pick a banner first (Change banner), then move and zoom it."); else saveBannerTag(bannerState.raw, b); }
      else styleBanner(bannerState);
    };
    bar.addEventListener("click", (e) => {
      const t = e.target.closest("[data-r]"); if (!t) return; e.stopPropagation();
      if (t.dataset.r === "in") setZoom(b.z * 1.15); else if (t.dataset.r === "out") setZoom(b.z / 1.15);
      else if (t.dataset.r === "reset") { b.z = 100; b.x = 50; b.y = 50; show(); }
      else done(t.dataset.r === "save");
    });
    bannerEl.addEventListener("pointerdown", down); bannerEl.addEventListener("pointermove", move); bannerEl.addEventListener("wheel", wheel, { passive: false }); addEventListener("pointerup", up);
  }
  // the owner's picker: one of your sequences, a colour, or an image link — saved in your bio with the site's own Save
  let picker = null;
  function closePicker() { if (picker) { close(picker); picker = null; } }
  function openBannerPicker(e) {
    e.stopPropagation(); closePicker();
    const ids = profileItems.slice(0, 48).map((x) => x.id);
    const cur = bannerState || { fit: "fill", y: 50, size: "medium" };
    picker = document.createElement("div"); picker.id = "osg-banner-picker";
    picker.innerHTML = `<div class="osg-bp-head"><b>Profile banner</b><button type="button" class="osg-bp-x" aria-label="Close">✕</button></div>
      <div class="osg-bp-tabs" role="tablist"><button type="button" data-tab="seq" class="on">Your sequences</button><button type="button" data-tab="preset">Colours</button><button type="button" data-tab="image">Image link</button></div>
      <div class="osg-bp-pane" data-pane="seq"><div class="osg-bp-grid">${ids.map((id) => `<button type="button" class="osg-bp-seq" data-v="${id}" style="background-image:url('/preview.php?id=${id}&amp;t=0&amp;s=1')" title="${esc(metaAll()[id]?.t || profileItems.find((x) => x.id === id)?.title || "#" + id)}"></button>`).join("") || `<p class="osg-bp-note">Your sequences are still loading — try again in a moment.</p>`}</div></div>
      <div class="osg-bp-pane" data-pane="preset" hidden><div class="osg-bp-grid osg-bp-presets">${Object.entries(PRESETS).map(([k, g]) => `<button type="button" class="osg-bp-preset" data-v="${k}" style="background-image:${g}"><span>${k}</span></button>`).join("")}</div></div>
      <div class="osg-bp-pane" data-pane="image" hidden><input type="url" class="osg-bp-url" placeholder="https://…/banner.png" value="${cur.kind === "image" ? esc(cur.url) : ""}"><p class="osg-bp-note">A direct https link to a .png, .jpg, .gif or .webp image (about 2000 × 400 fills it best). Everyone with the extension will load it from that address.</p><button type="button" class="osg-bp-use">Use this image</button></div>
      <div class="osg-bp-fit" role="group" aria-label="Banner height"><span>Height:</span><button type="button" data-size="short">Short</button><button type="button" data-size="medium">Medium</button><button type="button" data-size="tall">Tall</button></div>
      <div class="osg-bp-fit" role="group" aria-label="How the picture fits"><span>Picture:</span><button type="button" data-fit="fill">Fill</button><button type="button" data-fit="whole">Show all of it</button><button type="button" class="osg-bp-move" ${cur.auto || cur.kind === "preset" ? "disabled" : ""}>✥ Move &amp; zoom…</button></div>
      <div class="osg-bp-foot"><button type="button" class="osg-bp-auto">Automatic</button><span>Saved as a short tag at the end of your bio — others with Glow Theme see your banner.</span></div>`;
    document.body.appendChild(picker);
    const opt = { fit: cur.fit || "fill", size: cur.size || "medium", y: cur.y ?? 50 };
    const mark = () => { $$("[data-fit]", picker).forEach((b) => b.classList.toggle("on", b.dataset.fit === opt.fit)); $$("[data-size]", picker).forEach((b) => b.classList.toggle("on", b.dataset.size === opt.size)); }; mark();
    const r = bannerEl.getBoundingClientRect(); picker.style.top = Math.max(8, r.top + window.scrollY + 12) + "px"; picker.style.left = Math.max(8, Math.min(document.documentElement.clientWidth - picker.offsetWidth - 8, r.right - picker.offsetWidth - 12)) + "px";
    picker.addEventListener("click", async (ev) => {
      const t = ev.target.closest("button"); if (!t || t.disabled) return; ev.stopPropagation();
      if (t.classList.contains("osg-bp-x")) return closePicker();
      if (t.dataset.tab) { $$(".osg-bp-tabs button", picker).forEach((b) => b.classList.toggle("on", b === t)); $$(".osg-bp-pane", picker).forEach((p) => (p.hidden = p.dataset.pane !== t.dataset.tab)); return; }
      if (t.classList.contains("osg-bp-move")) { closePicker(); return startReposition(); }
      if (t.dataset.fit || t.dataset.size) {   // applies to the current banner (saved straight away once you have one set)
        if (t.dataset.fit) opt.fit = t.dataset.fit; if (t.dataset.size) opt.size = t.dataset.size; mark();
        if (bannerState && !bannerState.auto) return saveBannerTag(bannerState.raw, { ...bannerState, fit: opt.fit, size: opt.size });
        if (bannerState) styleBanner({ ...bannerState, fit: opt.fit, size: opt.size });
        return;
      }
      if (t.dataset.v) return saveBannerTag(t.dataset.v, { fit: opt.fit, size: opt.size });
      if (t.classList.contains("osg-bp-use")) { const u = $(".osg-bp-url", picker).value.trim(); if (!IMG_RE.test(u)) { toast("That needs to be a direct https link ending in .png, .jpg, .gif or .webp."); return; } return saveBannerTag(u, { fit: opt.fit, size: opt.size }); }
      if (t.classList.contains("osg-bp-auto")) return saveBannerTag("");
    });
  }
  async function saveBannerTag(value, o) {
    const ta = $("#bio-textarea"), save = $("#bio-save"); if (!ta || !save) { toast("Open your own profile while signed in to change your banner."); return; }
    const without = ta.value.replace(/\s*\[banner:\s*[^\]]*\]\s*/gi, "\n").replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "");
    const extra = value && o ? bannerOpts({ fit: PRESETS[String(value).toLowerCase()] ? "fill" : o.fit || "fill", x: o.x ?? 50, y: o.y ?? 50, z: o.z ?? 100, size: o.size || "medium" }) : "";
    ta.value = value ? `${without}${without ? "\n\n" : ""}[banner: ${value}${extra ? " " + extra : ""}]` : without;
    closePicker(); toast("Saving your banner…", 3);
    save.click();   // the site's own bio Save
    const t0 = Date.now(); while (Date.now() - t0 < 15000) { await sleep(300); const l = $("#bio-loading"); if (!l || getComputedStyle(l).display === "none") break; }
    await sleep(300); await renderBanner(); toast(value ? "Banner saved — everyone with Glow Theme sees it." : "Back to the automatic banner.");
  }
  document.addEventListener("pointerdown", (e) => { if (picker && !picker.contains(e.target)) closePicker(); }, true);

  // ======================================================================================================
  // Profile sequence browser: big cards, search, sort / date / notes filters, endless scrolling, quick actions
  // ======================================================================================================
  let profileItems = [];
  function parseTiles(doc) {
    return $$("#page_right .pager-items .preview", doc).map((t) => ({ id: (t.querySelector("a")?.getAttribute("href") || "").replace(/\D/g, ""), title: t.getAttribute("title") || "", notes: num(t.querySelector(".info")?.textContent), tile: ((t.querySelector(".image")?.getAttribute("style") || "").match(/url\((['"]?)([^'")]+)\1\)/) || [])[2] || "" })).filter((x) => x.id);
  }
  const nextStart = (doc, start) => { const a = $('#page_right .pagelinks a[href*="start="]:last-child', doc); const ns = a ? +((a.getAttribute("href").match(/start=(\d+)/) || [])[1]) : NaN; return !a || isNaN(ns) || ns <= start ? null : ns; };
  function buildProfileBrowser() {
    const uid = memberIdHere(), col = $("#page_right .right_column"), grid = $("#page_right .pager-items"); if (!uid || !col || !grid || $("#osg-pb")) return;
    const q = new URLSearchParams(location.search);
    const st = { sort: q.get("sort") || "1", date: q.get("date") || "4", search: q.get("search") || "", minNotes: 0, start: +(q.get("start") || 0), next: null, loading: false, done: false, gen: 0 };
    const pb = document.createElement("div"); pb.id = "osg-pb";
    pb.innerHTML = `<div class="osg-pb-bar">
        <div class="osg-pb-search"><svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M20 20l-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><input type="search" placeholder="Search this member's sequences" aria-label="Search this member's sequences" value="${esc(st.search)}"></div>
        <select data-k="sort" aria-label="Sort"><option value="1">Newest</option><option value="4">Oldest</option><option value="2">Popular</option><option value="3">Most notes</option><option value="5">Longest</option></select>
        <select data-k="date" aria-label="Made"><option value="4">Any time</option><option value="1">Today</option><option value="2">This week</option><option value="3">This month</option></select>
        <select data-k="minNotes" aria-label="Notes"><option value="0">Any size</option><option value="100">100+ notes</option><option value="1000">1,000+ notes</option><option value="5000">5,000+ notes</option><option value="10000">10,000+ notes</option></select>
        <span class="osg-pb-size"></span><button type="button" class="osg-pb-classic" title="Show the site's own list">Classic view</button>
      </div><div class="osg-pb-count"></div><div class="osg-pb-grid"></div><div class="osg-pb-more" aria-live="polite"></div>`;
    $(".osg-pb-size", pb).replaceWith(sizePicker("profileSize", false));
    $('[data-k="sort"]', pb).value = st.sort; $('[data-k="date"]', pb).value = st.date;
    grid.insertAdjacentElement("beforebegin", pb);
    col.classList.add("osg-pb-on");
    const g = $(".osg-pb-grid", pb), more = $(".osg-pb-more", pb), count = $(".osg-pb-count", pb);
    // titles, plays and dates for the cards on screen
    const io = new IntersectionObserver((ents) => { for (const en of ents) if (en.isIntersecting) { io.unobserve(en.target); fillCard(en.target); } }, { rootMargin: "300px" });
    function fillCard(card) {
      const id = card.dataset.id;
      seqMeta(id).then((m) => { if (!m) return; const tl = card.querySelector(".osg-pc-title"); if (m.t && (tl.textContent === "…" || !tl.textContent)) { tl.textContent = m.t; tl.title = m.t; } const p = card.querySelector(".osg-pc-plays"); if (p) p.textContent = m.p ? `▶ ${fmtN(m.p)}` : ""; const d = card.querySelector(".osg-pc-date"); if (d && m.d) d.textContent = m.d; });
    }
    function cardFor(x) {
      const c = document.createElement("article"); c.className = "osg-pc"; c.dataset.id = x.id; c.dataset.notes = x.notes;
      const m = metaAll()[x.id], title = (m && m.t) || x.title;
      const big = x.tile.replace(/_s2_/, "_s1_");   // the site's own larger card thumbnail
      c.innerHTML = `<a class="osg-pc-pic" href="/${x.id}"><img loading="lazy" alt="" src="${esc(big || x.tile)}"></a>
        <div class="osg-pc-body"><a class="osg-pc-title" href="/${x.id}" title="${esc(title)}">${esc(title || "…")}</a>
        <div class="osg-pc-meta"><span title="Notes">♪ ${fmtN(x.notes)}</span><span class="osg-pc-plays">${m && m.p ? "▶ " + fmtN(m.p) : ""}</span><span class="osg-pc-date">${esc(m ? m.d : "")}</span></div></div>`;
      const img = c.querySelector("img"); img.addEventListener("error", () => { if (img.src !== new URL(x.tile, location.origin).href && x.tile) img.src = x.tile; }, { once: true });
      const qa = quickActions(x.id); c.appendChild(qa); c.addEventListener("mouseenter", () => qa.osgLoadCount(), { once: true });
      return c;
    }
    function show(list) {
      const frag = document.createDocumentFragment();
      for (const x of list) { if (x.notes < st.minNotes) continue; const c = cardFor(x); frag.appendChild(c); io.observe(c); }
      g.appendChild(frag);
      updateCount();
    }
    function updateCount() {
      const n = [...g.children].filter((c) => !c.hidden).length;
      count.textContent = n ? `${fmtN(n)} sequence${n === 1 ? "" : "s"}${st.done ? "" : " so far"}${st.search ? ` matching “${st.search}”` : ""}${st.minNotes ? ` with ${fmtN(st.minNotes)}+ notes` : ""}` : "";
    }
    async function loadNext() {
      if (st.loading || st.done) return; st.loading = true; const gen = st.gen; more.textContent = "Loading…";
      try {
        const u = new URL(`/members/${uid}`, location.origin); u.searchParams.set("sort", st.sort); if (st.date !== "4") u.searchParams.set("date", st.date); if (st.search) u.searchParams.set("search", st.search); if (st.next) u.searchParams.set("start", st.next);
        const doc = new DOMParser().parseFromString(await net(u, null, 0).then((r) => r.text()), "text/html");
        if (gen !== st.gen) return;
        const items = parseTiles(doc); profileItems.push(...items); show(items);
        const ns = nextStart(doc, st.next || 0); st.next = ns; st.done = !ns || !items.length;
      } catch (e) { more.textContent = "Couldn't load more — scroll to try again."; st.loading = false; return; }
      st.loading = false; updateCount(); more.textContent = st.done ? (g.children.length ? "That's all." : "No sequences found.") : "";
      if (!st.done && more.getBoundingClientRect().top < innerHeight + 600) loadNext();   // keep filling while the end is in view
    }
    function restart() {
      st.gen++; st.next = null; st.done = false; st.loading = false; g.innerHTML = ""; profileItems = [];
      const u = new URL(location.href); for (const [k, v] of [["sort", st.sort !== "1" ? st.sort : ""], ["date", st.date !== "4" ? st.date : ""], ["search", st.search], ["start", ""]]) { if (v) u.searchParams.set(k, v); else u.searchParams.delete(k); }
      history.replaceState(null, "", u);
      loadNext();
    }
    // first page: what the site already shows (unless it started somewhere in the middle)
    if (!st.start) { const items = parseTiles(document); profileItems.push(...items); show(items); st.next = nextStart(document, 0); st.done = !st.next; updateCount(); more.textContent = st.done ? (items.length ? "That's all." : "No sequences found.") : ""; }
    else { st.start = 0; restart(); }
    new IntersectionObserver((ents) => { if (ents[0].isIntersecting) loadNext(); }, { rootMargin: "800px" }).observe(more);
    let qT = 0; $(".osg-pb-search input", pb).addEventListener("input", (e) => { clearTimeout(qT); qT = setTimeout(() => { st.search = e.target.value.trim(); restart(); }, 350); });
    for (const s of $$("select[data-k]", pb)) s.addEventListener("change", () => { const k = s.dataset.k; if (k === "minNotes") { st.minNotes = +s.value; for (const c of g.children) c.hidden = +c.dataset.notes < st.minNotes; updateCount(); if (!st.done) loadNext(); return; } st[k] = s.value; restart(); });
    $(".osg-pb-classic", pb).addEventListener("click", () => { const on = col.classList.toggle("osg-pb-on"); $(".osg-pb-classic", pb).textContent = on ? "Classic view" : "Glow view"; try { localStorage.setItem("osg-pb-classic", on ? "0" : "1"); } catch (e) {} });
    try { if (localStorage.getItem("osg-pb-classic") === "1") $(".osg-pb-classic", pb).click(); } catch (e) {}
  }

  // ======================================================================================================
  // Sequences pages: bigger cards, endless scrolling, quick actions
  // ======================================================================================================
  function enhanceSequenceCards(root = document) {
    for (const c of $$(".sequence-card:not([data-osg])", root)) {
      c.dataset.osg = "1"; const id = (c.querySelector("a")?.getAttribute("href") || "").replace(/\D/g, ""); if (!id) continue;
      const hasCount = !!c.querySelector('[title="Comments"], .fa-comment');
      const qa = quickActions(id, hasCount ? { comments: true } : {}); c.appendChild(qa);
      if (!hasCount) c.addEventListener("mouseenter", () => qa.osgLoadCount(), { once: true });
    }
  }
  function endlessSequences() {
    const list = $(".sequences-list"), links = $(".pagelinks"); if (!list || !links || $("#osg-endless")) return;
    let next = 2, loading = false, done = false, gen = 0;
    const sentinel = document.createElement("div"); sentinel.id = "osg-endless"; list.insertAdjacentElement("afterend", sentinel);
    // (re)start from whatever page the list shows — the site swaps the list in place when you pick a filter
    function reset() {
      gen++; loading = false;
      const cur = +(new URLSearchParams(location.search).get("page") || 1);
      next = cur + 1; done = !$$(".pagelinks a", document).some((a) => (+(a.getAttribute("href") || "").match(/page=(\d+)/)?.[1] || 0) > cur);
      sentinel.textContent = done ? "" : "Scroll for more";
      if (!$(".osg-list-tag", list)) { const t = document.createElement("i"); t.className = "osg-list-tag"; t.hidden = true; list.appendChild(t); }
    }
    reset();
    new MutationObserver(() => { enhanceSequenceCards(list); if (!$(".osg-list-tag", list)) reset(); }).observe(list, { childList: true });
    document.body.classList.add("osg-endless-on");
    async function load() {
      if (loading || done || !Q.endless) return; loading = true; sentinel.textContent = "Loading…"; const g = gen;
      try {
        const u = new URL(location.href); u.searchParams.set("page", next);
        const doc = new DOMParser().parseFromString(await net(u, null, 0).then((r) => r.text()), "text/html");
        if (g !== gen) return;
        const cards = $$(".sequence-card", doc); if (!cards.length) { done = true; sentinel.textContent = "That's all."; loading = false; return; }
        const head = document.createElement("div"); head.className = "osg-page-mark"; head.textContent = `Page ${next}`; list.appendChild(head);
        for (const c of cards) list.appendChild(document.importNode(c, true));
        enhanceSequenceCards(list);
        const hasNext = $$(".pagelinks a", doc).some((a) => (+(a.getAttribute("href") || "").match(/page=(\d+)/)?.[1] || 0) > next);
        next++; done = !hasNext; sentinel.textContent = done ? "That's all." : "";
      } catch (e) { sentinel.textContent = "Couldn't load more — scroll to try again."; }
      if (g !== gen) return;
      loading = false;
      if (!done && sentinel.getBoundingClientRect().top < innerHeight + 600) load();
    }
    new IntersectionObserver((ents) => { if (ents[0].isIntersecting) load(); }, { rootMargin: "900px" }).observe(sentinel);
  }

  // ======================================================================================================
  // Recently viewed
  // ======================================================================================================
  const RECENT = "osgRecent";
  async function recordRecent() {
    if (!Q.recent) return;
    const r = (await store.get(RECENT, null)) || { seqs: [], people: [] };
    const sid = seqIdHere(), uid = memberIdHere();
    if (sid) {
      await sleep(1500);
      const title = unesc(($('meta[property="og:title"]')?.getAttribute("content") || document.title.replace(/\s*-\s*Online Sequencer\s*$/, "")).trim());
      const holder = $(".sequence-date")?.closest("div"); const by = holder ? $('a[href^="/members/"]', holder) : null;
      r.seqs = [{ id: sid, t: title, by: by ? by.textContent.trim() : "", at: Date.now() }, ...r.seqs.filter((x) => x.id !== sid)].slice(0, 40);
    } else if (uid && page() === "page_members") {
      const name = $(".profile_header .name")?.textContent.trim() || "";
      const av = ((($(".profile_avatar_image")?.getAttribute("style")) || "").match(/url\((['"]?)([^'")]+)\1\)/) || [])[2] || "";
      r.people = [{ uid, name, av, at: Date.now() }, ...r.people.filter((x) => x.uid !== uid)].slice(0, 24);
    } else return;
    store.set(RECENT, r);
  }
  let recentBtn = null, recentMenu = null;
  function closeRecent() { if (recentMenu) { close(recentMenu); recentMenu = null; recentBtn?.setAttribute("aria-expanded", "false"); } }
  async function openRecent(anchorRect) {
    closeRecent(); if (!recentBtn && !anchorRect) return;
    const r = (await store.get(RECENT, null)) || { seqs: [], people: [] };
    const ago = (t) => { const s = (Date.now() - t) / 1000; return s < 3600 ? Math.max(1, Math.round(s / 60)) + " min" : s < 86400 ? Math.round(s / 3600) + " h" : Math.round(s / 86400) + " d"; };
    recentMenu = document.createElement("div"); recentMenu.id = "osg-recent";
    recentMenu.innerHTML = `<div class="osg-rc-head"><b>Recently viewed</b>${r.seqs.length || r.people.length ? `<button type="button" data-act="clear">Clear</button>` : ""}</div>
      ${r.seqs.length ? `<div class="osg-rc-sec">Sequences</div><div class="osg-rc-seqs">${r.seqs.slice(0, 12).map((x) => `<a class="osg-rc-seq" href="/${x.id}"><img loading="lazy" alt="" src="/preview.php?id=${x.id}&amp;t=0&amp;s=1"><span><b>${esc(x.t || "#" + x.id)}</b><small>${x.by ? "by " + esc(x.by) + " · " : ""}${ago(x.at)} ago</small></span></a>`).join("")}</div>` : ""}
      ${r.people.length ? `<div class="osg-rc-sec">Profiles</div><div class="osg-rc-people">${r.people.slice(0, 10).map((x) => `<a class="osg-rc-person" href="/members/${x.uid}" title="${esc(x.name)}"><span style="background-image:url('${esc(x.av)}')"></span><small>${esc(x.name || "#" + x.uid)}</small></a>`).join("")}</div>` : ""}
      ${r.seqs.length || r.people.length ? "" : `<p class="osg-rc-empty">Sequences and profiles you open will show up here.</p>`}`;
    document.body.appendChild(recentMenu); recentBtn?.setAttribute("aria-expanded", "true");
    if (anchorRect) { recentMenu.style.top = Math.round(Math.max(64, Math.min(innerHeight - recentMenu.offsetHeight - 8, anchorRect.top))) + "px"; recentMenu.style.left = Math.round(anchorRect.right + 8) + "px"; }
    else { const b = recentBtn.getBoundingClientRect(); recentMenu.style.top = Math.round(b.bottom + 6) + "px"; recentMenu.style.left = Math.round(Math.max(8, Math.min(innerWidth - recentMenu.offsetWidth - 8, b.right - recentMenu.offsetWidth))) + "px"; }
    recentMenu.querySelector('[data-act="clear"]')?.addEventListener("click", (e) => { e.stopPropagation(); store.set(RECENT, { seqs: [], people: [] }); closeRecent(); toast("Cleared."); });
  }
  function addRecentButton() {
    const host = $("#user_member")?.parentElement; if (!host || $("#osg-recent-btn")) return;
    recentBtn = document.createElement("button"); recentBtn.type = "button"; recentBtn.id = "osg-recent-btn"; recentBtn.title = "Recently viewed (G then R)"; recentBtn.setAttribute("aria-haspopup", "menu");
    recentBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
    recentBtn.addEventListener("click", (e) => { e.stopPropagation(); recentMenu ? closeRecent() : openRecent(); });
    host.insertBefore(recentBtn, host.firstChild);
  }
  document.addEventListener("pointerdown", (e) => { if (recentMenu && !recentMenu.contains(e.target) && !(recentBtn && recentBtn.contains(e.target)) && !e.target.closest?.('[data-act="history"]')) closeRecent(); }, true);
  document.addEventListener("osg:open-recent", (e) => { if (recentMenu) closeRecent(); else openRecent(e.detail && e.detail.rect); });

  // ======================================================================================================
  // Sticky compact header, back to top, keyboard shortcuts
  // ======================================================================================================
  function stickyHeader() {
    if (page() === "page_view" || !$("#header")) return;   // the editor has its own fixed layout
    const top = document.createElement("button"); top.type = "button"; top.id = "osg-top"; top.title = "Back to top (Home key)"; top.setAttribute("aria-label", "Back to top");
    top.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 14l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    top.addEventListener("click", () => scrollTo({ top: 0, behavior: "smooth" })); document.body.appendChild(top);
    let ticking = false;
    addEventListener("scroll", () => { if (ticking) return; ticking = true; requestAnimationFrame(() => { ticking = false; const y = scrollY; document.body.classList.toggle("osg-scrolled", y > 90); top.classList.toggle("show", y > 700); }); }, { passive: true });
  }
  const SHORTCUTS = [["/", "Search"], ["G then S", "Sequences"], ["G then P", "Your profile"], ["G then M", "Members"], ["G then F", "Forum"], ["G then H", "Editor"], ["G then R", "Recently viewed"], ["G then C", "My comments"], ["G then L", "Sequence library"], ["Home", "Back to top"], ["?", "This list"]];
  let helpEl = null;
  function toggleHelp() {
    if (helpEl) { close(helpEl, true); helpEl = null; return; }
    helpEl = document.createElement("div"); helpEl.id = "osg-keys"; helpEl.setAttribute("role", "dialog"); helpEl.setAttribute("aria-label", "Keyboard shortcuts");
    helpEl.innerHTML = `<div class="osg-keys-card"><div class="osg-keys-head"><b>Keyboard shortcuts</b><button type="button" aria-label="Close">✕</button></div><dl>${SHORTCUTS.map(([k, d]) => `<dt>${k.split(" then ").map((x) => `<kbd>${esc(x)}</kbd>`).join(" then ")}</dt><dd>${esc(d)}</dd>`).join("")}</dl><p>Not in the editor, where its own shortcuts apply.</p></div>`;
    helpEl.addEventListener("click", (e) => { if (e.target === helpEl || e.target.closest("button")) toggleHelp(); });
    document.body.appendChild(helpEl);
  }
  function shortcuts() {
    if (page() === "page_view") return;
    let g = 0;
    document.addEventListener("keydown", async (e) => {
      if (!Q.shortcuts || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const t = e.target; if (t && (t.closest?.("input, textarea, select, [contenteditable='true'], [contenteditable='']"))) return;
      if (e.key === "Escape") { if (helpEl) toggleHelp(); closeRecent(); return; }
      if (e.key === "?") { e.preventDefault(); toggleHelp(); return; }
      if (e.key === "/") { const i = $("#osg-pb .osg-pb-search input") || $("#osg-yt-search input") || $("form.search input[name=search]") || $('.sequence-search input[name="search"]'); if (i) { e.preventDefault(); i.focus(); i.select(); } return; }
      if (e.key === "Home" && document.body.classList.contains("osg-sticky")) return;   // the browser scrolls up by itself
      if (e.key.toLowerCase() === "g" && !e.shiftKey) { g = Date.now(); return; }
      if (Date.now() - g > 1200) return; g = 0;
      const k = e.key.toLowerCase();
      if (k === "s") location.href = "/sequences";
      else if (k === "m") location.href = "/memberlist";
      else if (k === "f") location.href = "/forum/";
      else if (k === "h") location.href = "/";
      else if (k === "r") { e.preventDefault(); if (recentBtn) openRecent(); else document.dispatchEvent(new CustomEvent("osg:open-recent", { detail: {} })); }
      else if (k === "c") send({ type: "open:comments" });
      else if (k === "l") send({ type: "open:library" });
      else if (k === "p") { const me = $('#member_username a[href*="/members/"]')?.getAttribute("href"); const uid = (me && me.match(/\d+/)?.[0]) || ((await send({ type: "acc:list" })) || {}).current; if (uid && uid !== "0") location.href = "/members/" + uid; else toast("Sign in first — then G P goes to your profile."); }
    });
  }

  // ======================================================================================================
  // turn the extras on and off as the popup's switches change (no reload needed)
  let booted = false;
  function apply() {
    const b = document.body, p = page(); if (!b) return;
    b.classList.toggle("osg-sticky", Q.sticky && p !== "page_view" && !!$("#header"));
    b.classList.toggle("osg-no-top", !Q.backToTop);
    b.classList.toggle("osg-no-qa", !Q.quickActions);
    b.classList.toggle("osg-no-recent", !Q.recent); if (!Q.recent) closeRecent();
    b.classList.toggle("osg-no-banners", !Q.banners);
    b.dataset.osgSeq = Q.seqSize; b.dataset.osgPc = Q.profileSize; b.dataset.osgFeat = Q.featuredSize;
    $$(".osg-size").forEach((x) => x.osgMark && x.osgMark());
    $$(".featured_list").forEach((f) => f.classList.toggle("osg-feat", Q.featuredSize !== "classic"));
    $$(".playlists_list").forEach((f) => f.classList.toggle("osg-pl", Q.featuredSize !== "classic"));
    if (!Q.shortcuts && helpEl) toggleHelp();
    if (p === "page_members" && memberIdHere()) {
      if (Q.banners) { if (!bannerEl || !document.contains(bannerEl)) renderBanner(); }
      else { bannerEl?.remove(); bannerEl = null; closePicker(); b.classList.remove("osg-has-banner"); }
      const pb = $("#osg-pb"), col = $("#page_right .right_column");
      if (Q.profileBrowser) { if (!pb) buildProfileBrowser(); else { pb.hidden = false; let classic = false; try { classic = localStorage.getItem("osg-pb-classic") === "1"; } catch (e) {} col?.classList.toggle("osg-pb-on", !classic); } }
      else if (pb) { pb.hidden = true; col?.classList.remove("osg-pb-on"); }
    }
    if (p === "page_sequences") {
      const list = $(".sequences-list");
      if (list) { list.classList.toggle("osg-big", Q.seqSize !== "classic"); let bar = $("#osg-seq-size"); if (!bar) { bar = document.createElement("div"); bar.id = "osg-seq-size"; bar.innerHTML = "<span>Card size</span>"; bar.appendChild(sizePicker("seqSize", true)); }
        // with the YouTube-style layout the switch sits at the end of the filter chips
        const chips = Q.ytLayout !== false && eligibleYt() ? $(".sequences-page .left-column") : null;
        if (chips) { if (bar.parentElement !== chips) chips.appendChild(bar); } else if (bar.nextElementSibling !== list) list.insertAdjacentElement("beforebegin", bar); }
      if (Q.endless && !$("#osg-endless")) endlessSequences();
      b.classList.toggle("osg-endless-on", Q.endless && !!$("#osg-endless")); const en = $("#osg-endless"); if (en) en.hidden = !Q.endless;
    }
  }
  try { chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.qol) { Q = readQ(ch.qol.newValue); if (booted) apply(); } }); } catch (e) {}
  async function boot() {
    Q = readQ(await store.get("qol", {})); booted = true;
    const p = page();
    stickyHeader(); shortcuts(); recordRecent();
    const tryHeader = () => { addRecentButton(); return !!recentBtn; };
    if (!tryHeader()) { let n = 0; const t = setInterval(() => { if (tryHeader() || ++n > 20) clearInterval(t); }, 500); }
    if (p === "page_members" && memberIdHere()) {
      if (Q.profileBrowser) buildProfileBrowser(); renderBanner();
      const bio = $("#bio-text"); if (bio) new MutationObserver(() => { if (TAG_RE.test(bio.textContent) && !bio.querySelector(".osg-banner-tag")) renderBanner(); }).observe(bio, { childList: true, subtree: true });
    }
    if (p === "page_sequences") { enhanceSequenceCards(); if (Q.endless) endlessSequences(); }
    apply();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();

  // a newer Glow Theme is out: say so on Online Sequencer itself (once per version, until you dismiss it)
  function updateNotice() {
    if (window.top !== window || document.getElementById("osg-update")) return;
    try {
      chrome.storage.local.get({ osgUpdate: null, osgUpdateSeen: "" }, ({ osgUpdate: u, osgUpdateSeen: seen }) => {
        if (chrome.runtime.lastError || !u || !u.version || u.version === seen) return;
        const n = document.createElement("div"); n.id = "osg-update"; n.setAttribute("role", "status");
        n.innerHTML = `<span class="osg-up-dot"></span><span><b>Glow Theme ${String(u.version).replace(/[^\d.]/g, "")} is out</b><small>You have ${chrome.runtime.getManifest().version}. Your settings and library carry over.</small></span><button type="button" class="osg-up-go">How to update</button><button type="button" class="osg-up-x" aria-label="Not now">✕</button>`;
        document.body.appendChild(n);
        const bye = () => { try { chrome.storage.local.set({ osgUpdateSeen: u.version }); } catch (e) {} n.classList.add("osg-up-out"); setTimeout(() => n.remove(), 300); };
        n.querySelector(".osg-up-x").addEventListener("click", bye);
        n.querySelector(".osg-up-go").addEventListener("click", () => { try { chrome.runtime.sendMessage({ type: "open:backup" }); } catch (e) {} bye(); });
      });
    } catch (e) {}
  }
  setTimeout(updateNotice, 2500);
})();
