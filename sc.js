// Glow Theme — the Glow playlist player.
// On a playlist page you can switch between the site's own view and the "Glow player": the current sequence's picture
// (drawn from its notes, square like the site's thumbnails) over a crisp backdrop of itself with a piano-roll grid, a play
// button, a note meter in the song's own instrument colours that lights up as it plays (click it to jump), and the track
// list. The site's own player keeps doing the playing — this only drives it.
// A third tab, "Studio", lays it out side by side: the song up top with the playlist beside it, the site's actual sequencer
// (playing along) and the note meter under the song, and the playing sequence's comments under the playlist.
// On profiles, hovering a playlist offers "Open" (the site's page), "▶ Player" or "Studio".
// Every sequence's own page gets the Glow player too (switch back to the site's view with the button in the corner):
// the sequence's picture, title, creator and stats, the meter, its description and comments, and "For you" beside it.
(function () {
  "use strict";
  if (window.top !== window || window.__osgSc) return; window.__osgSc = true;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = { get: (k, d) => new Promise((res) => { try { chrome.storage.local.get({ [k]: d }, (v) => res(chrome.runtime.lastError ? d : v[k])); } catch (e) { res(d); } }) };
  const page = () => (document.body ? document.body.id : "");
  const VIEW_KEY = "osg-pl-view", SV_KEY = "osg-sv-view";
  const isPL = () => page() === "page_playlist", isSV = () => page() === "page_view" && !!document.getElementById("frame_wrapper");
  const svId = () => (location.pathname.match(/^\/(\d+)/) || [])[1] || "";
  let enabled = true;

  // ---------------------------------------------------------------------------------------------------
  // profile: hover a playlist → Open / ▶ Player / Studio
  // ---------------------------------------------------------------------------------------------------
  function playlistHovers() {
    for (const card of $$(".playlists_list .playlist_preview:not(.add_featured)")) {
      if (card.querySelector(".osg-pl-hover")) continue;
      const id = card.dataset.id || ((card.querySelector('a[href*="/playlist/"]')?.getAttribute("href") || "").match(/playlist\/(\d+)/) || [])[1];
      if (!id) continue;
      const h = document.createElement("div"); h.className = "osg-pl-hover";
      h.innerHTML = `<a href="/playlist/${id}#sc" class="osg-pl-wave" title="Play it in the Glow player">▶ Player</a><span class="osg-pl-row"><a href="/playlist/${id}#os" class="osg-pl-open" title="Open the playlist on Online Sequencer">Open</a><a href="/playlist/${id}#st" class="osg-pl-studio" title="Open it in Studio: the song, the playlist, the sequencer, the visualizer and comments side by side">Studio</a></span>`;
      h.addEventListener("click", (e) => e.stopPropagation());
      card.appendChild(h);
    }
  }

  // ---------------------------------------------------------------------------------------------------
  // playlist page
  // ---------------------------------------------------------------------------------------------------
  let hero = null, sw = null, deck = null, stVis = null, stCom = null, waveCanvas = null, bars = null, curId = "", lastFrac = -1, hoverFrac = -1, playing = false, tick = 0;
  const art = () => window.__osgArt;
  const net = (u, o, pri) => (window.__osgNet ? window.__osgNet.fetch(u, o, pri) : fetch(u, o));   // the polite queue (net.js)
  const ask = (kind, payload, ms) => (art() && art().askPage ? art().askPage(kind, payload || {}, ms || 1500) : Promise.resolve({ ok: false }));   // the page side (libmain.js)
  const root = () => (isPL() ? $("#playlist_page") : $("#osg-sv"));
  // ---- motion (switch it off with the popup's Animations switch, or the system's reduced-motion setting) ----
  const calm = () => (window.__osgMotion ? window.__osgMotion.calm() : true);
  // switching views morphs: panels slide and resize into their new places (theme.css, html.osg-vt). When the site's
  // sequencer changes size, it is told before the new picture is taken, so it doesn't arrive stretched.
  function switchView(v) {
    const st0 = document.body.classList.contains("osg-st");
    const update = async () => {
      setView(v);
      if (st0 !== document.body.classList.contains("osg-st")) { dispatchEvent(new Event("resize")); await new Promise((r) => setTimeout(r, 60)); }
    };
    if (window.__osgMotion) window.__osgMotion.smooth(update); else update();
  }
  // a copy of el, as it looks now, fades out on top while el changes underneath — a crossfade
  function crossfade(el) {
    if (calm() || !el || !el.isConnected) return;
    const c = el.cloneNode(false), cs = getComputedStyle(el); c.removeAttribute("id"); c.classList.remove("osg-pic-in"); c.setAttribute("aria-hidden", "true");
    if (cs.position !== "absolute") Object.assign(c.style, { position: "absolute", inset: "0", width: "100%", height: "100%" });
    Object.assign(c.style, { transform: cs.transform === "none" ? "" : cs.transform, animation: "osg-fadeout .7s ease forwards", pointerEvents: "none" });
    el.after(c); setTimeout(() => c.remove(), 900);
  }
  // restart a one-off entrance animation
  function replay(el, cls) { if (!el || calm()) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
  // wait (briefly) for a picture to be ready, so the crossfade doesn't fade to an empty box
  const preload = (url) => new Promise((res) => { if (!url) return res(); const im = new Image(); const t = setTimeout(res, 1500); im.onload = im.onerror = () => { clearTimeout(t); res(); }; im.src = url; });
  const playBtn = () => $("#playlist_play_btn")?.closest(".playlist_control_btn");
  const VIEWS = ["os", "sc", "st"], HASHES = VIEWS.map((v) => "#" + v);
  // the site's pencil turns a sequence page into the full editor: the Glow player steps aside while you edit
  const editing = () => isSV() && !!document.querySelector("#frame_wrapper.edit_mode");
  function view() {
    if (editing()) return "os";
    if (isSV()) { if (location.hash === "#os" || location.hash === "#sc") return location.hash.slice(1); try { return localStorage.getItem(SV_KEY) === "os" ? "os" : "sc"; } catch (e) { return "sc"; } }
    if (HASHES.includes(location.hash)) return location.hash.slice(1);
    try { const v = localStorage.getItem(VIEW_KEY); return VIEWS.includes(v) ? v : "os"; } catch (e) { return "os"; }
  }
  function setView(v, remember = true) {
    if (isSV() && v === "st") v = "sc";
    if (editing()) { v = "os"; remember = false; }
    document.body.classList.toggle("osg-sv-edit", editing()); if (sw && isSV()) sw.hidden = !enabled || editing();
    if (remember) try { localStorage.setItem(isSV() ? SV_KEY : VIEW_KEY, v); } catch (e) {}
    if (isSV()) { buildSV(); document.body.classList.toggle("osg-sv", enabled && v === "sc"); svAutoNext(); }
    if (HASHES.includes(location.hash)) history.replaceState(null, "", location.pathname + location.search + "#" + v);
    const on = enabled && (v === "sc" || v === "st"), was = document.body.classList.contains("osg-st");
    document.body.classList.toggle("osg-sc", on); document.body.classList.toggle("osg-st", on && v === "st");
    if (!on) document.body.classList.remove("osg-sc-playing");
    sw && $$("button", sw).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === v)));
    if (on) { buildHero(); buildDock(); if (v === "st") buildStudio(); placeDeck(v === "st"); refresh(true); lazyThumbs(); if ((v === "st" || isSV()) && curId) loadComments(curId); if (recsOn) buildRecs(); }
    // the switch sits on the player's header, or at the top of the site's track list (clear of the sequencer's own buttons),
    // or — on a sequence's page in the site's view — in the corner
    // the switch stays in the bottom-right corner, whichever view you're in (above the playlist's bottom bar)
    if (sw && sw.parentElement !== document.body) document.body.appendChild(sw);
    if (was !== document.body.classList.contains("osg-st")) nudge();
  }
  // the site sizes its sequencer from its box when the window resizes — tell it after the box moves or changes size
  let nudgeT = 0;
  function nudge() { clearTimeout(nudgeT); nudgeT = setTimeout(() => requestAnimationFrame(() => dispatchEvent(new Event("resize"))), 60); }

  // the site loads a track's thumbnail only when it scrolls into view inside its own short list; in these views the
  // list is laid out differently, so load each one as it comes on screen instead
  let thumbIO = null;
  function lazyThumbs() {
    const imgs = $$("#sequences_list img.lazy[data-src]"); if (!imgs.length) return;
    const load = (img) => { const src = img.getAttribute("data-src"); if (src && /^\/|^https:\/\/onlinesequencer\.net\//.test(src)) img.src = src; img.classList.remove("lazy"); };
    if (!("IntersectionObserver" in window)) { imgs.forEach(load); return; }
    thumbIO = thumbIO || new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { thumbIO.unobserve(e.target); load(e.target); } }, { rootMargin: "300px" });
    imgs.forEach((i) => { if (!i.dataset.osgObs) { i.dataset.osgObs = "1"; thumbIO.observe(i); } });
  }

  // ---------------------------------------------------------------------------------------------------
  // Studio: the sequencer, the visualizer and the comments around the song and the playlist
  // ---------------------------------------------------------------------------------------------------
  function buildStudio() {
    const pp = $("#playlist_page"); if (!pp) return;
    if (!stVis) {
      stVis = document.createElement("section"); stVis.id = "osg-st-vis"; stVis.className = "osg-st-panel";
      stVis.innerHTML = `<header class="osg-st-head"><span class="osg-st-dot"></span>Visualizer<small>the song's notes over time, in its instrument colours — click to jump</small></header>`;
      pp.appendChild(stVis);
    }
    if (!stCom) {
      stCom = document.createElement("section"); stCom.id = "osg-st-comments"; stCom.className = "osg-st-panel";
      stCom.innerHTML = `<header class="osg-st-head"><span class="osg-st-dot"></span>Comments <span class="osg-st-count"></span><a class="osg-st-open" target="_blank" rel="noopener">Write a comment ↗</a></header><div class="osg-st-clist" aria-live="polite"></div>`;
      pp.appendChild(stCom);
    }
    if (!pp.dataset.osgRo) { pp.dataset.osgRo = "1"; const fw = $("#frame_wrapper"); if (fw && "ResizeObserver" in window) new ResizeObserver(() => { if (document.body.classList.contains("osg-st")) nudge(); }).observe(fw); }
  }
  function placeDeck(studio) {
    if (!deck || !hero) return;
    const host = studio && stVis ? stVis : hero; if (deck.parentElement !== host) host.appendChild(deck);
    sizeCanvas(); draw();
  }
  const comCache = new Map();
  async function loadComments(id) {
    if (!stCom || !id) return;
    const list = $(".osg-st-clist", stCom), count = $(".osg-st-count", stCom); if (!isSV()) $(".osg-st-open", stCom).href = `/${id}`;
    if (stCom.dataset.id === id && list.dataset.done === "1") return;
    stCom.dataset.id = id; list.dataset.done = ""; count.textContent = "";
    let job = comCache.get(id);
    if (!job) {
      list.innerHTML = `<div class="osg-st-empty">Loading comments…</div>`;
      job = net(`/ajax/get_comments.php?id=0&id=${encodeURIComponent(id)}&page=1`, null, 1).then((r) => { if (!r.ok) throw new Error(r.status); return r.text(); })
        .then((h) => (globalThis.osgComments ? globalThis.osgComments.parseHtml(h) : [])).catch(() => { comCache.delete(id); return null; });
      comCache.set(id, job);
    }
    const cs = await job; if (stCom.dataset.id !== id) return;
    if (!cs) { list.innerHTML = `<div class="osg-st-empty">Couldn't load the comments right now. <a href="/${esc(id)}" target="_blank" rel="noopener">Open the sequence ↗</a></div>`; return; }
    list.dataset.done = "1"; count.textContent = cs.length ? String(cs.length) : "";
    if (!cs.length) { list.innerHTML = isSV() ? `<div class="osg-st-empty osg-sv-empty"><b>No comments yet</b><span>Be the first to say something about this one.</span><a class="osg-sv-write" href="#os" title="Opens the site's view, where the comment box is">Write a comment</a></div>` : `<div class="osg-st-empty">No comments yet — be the first on <a href="/${esc(id)}" target="_blank" rel="noopener">the sequence page ↗</a>.</div>`; return; }
    list.innerHTML = cs.map((c, i) => {
      const av = /^(\/|https:\/\/)[\w\-./?=&%:]+$/.test(c.avatar || "") ? c.avatar : "";
      const who = c.uid ? `<a href="/members/${esc(c.uid)}">${esc(c.name || "Someone")}</a>` : `<b>${esc(c.name || "Someone")}</b>`;
      return `<article class="osg-st-c${c.parent ? " reply" : ""}" style="--i:${Math.min(i, 14)}">
        <a class="osg-st-av"${c.uid ? ` href="/members/${esc(c.uid)}"` : ""} style="${av ? `background-image:url(&quot;${esc(av)}&quot;)` : ""}" aria-hidden="true">${av ? "" : esc((c.name || "?").slice(0, 1).toUpperCase())}</a>
        <div class="osg-st-cb"><div class="osg-st-ch">${who}<span>${esc(c.date)}</span></div><div class="osg-st-ct">${esc(c.text).replace(/\n/g, "<br>")}</div></div></article>`;
    }).join("");
  }
  function buildSwitch() {
    if (sw || !(isPL() || isSV())) return;
    sw = document.createElement("div"); sw.id = "osg-plv"; sw.setAttribute("role", "group"); sw.setAttribute("aria-label", isSV() ? "Sequence view" : "Playlist view");
    sw.innerHTML = `<button type="button" data-v="os">Online Sequencer</button><button type="button" data-v="sc">Glow player</button>${isSV() ? "" : `<button type="button" data-v="st">Studio</button>`}`;
    sw.addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b && b.getAttribute("aria-pressed") !== "true") switchView(b.dataset.v); });
    document.body.appendChild(sw);
  }
  // a sequence's page: the Glow player's own space, above the site's (hidden) sequencer — the player, the description
  // and comments under it, For you beside it
  function buildSV() {
    if ($("#osg-sv")) return;
    const wrap = document.createElement("div"); wrap.id = "osg-sv";
    wrap.innerHTML = `<div id="osg-sv-about"></div>`;
    const fw = $("#frame_wrapper"); fw.parentElement.insertBefore(wrap, fw);
    const about = $("#osg-sv-about", wrap);
    const desc = ($("#info-sidebar-description-text")?.innerText || "").trim();
    if (desc) { const d = document.createElement("section"); d.className = "osg-st-panel osg-sv-desc"; d.innerHTML = `<header class="osg-st-head"><span class="osg-st-dot"></span>About this sequence</header><div class="osg-sv-text">${esc(desc).replace(/\n/g, "<br>")}</div>`; about.appendChild(d); }
    stCom = document.createElement("section"); stCom.id = "osg-st-comments"; stCom.className = "osg-st-panel";
    stCom.innerHTML = `<header class="osg-st-head"><span class="osg-st-dot"></span>Comments <span class="osg-st-count"></span><a class="osg-st-open" href="#os" title="Back to the site's view, where you can comment">Write a comment</a></header><div class="osg-st-clist" aria-live="polite"></div>`;
    about.appendChild(stCom);
  }
  function buildHero() {
    if (hero) return;
    const sv = isSV(), title = sv ? svInfo().title : $("#playlist_title")?.textContent.trim() || "Playlist";
    const owner = sv ? svInfo().by : $(".playlist_title_wrapper a[href*='/members/']");
    hero = document.createElement("section"); hero.id = "osg-sc-hero";
    hero.innerHTML = `<div class="osg-sc-bg"></div><div class="osg-sc-grid"></div><div class="osg-sc-shade"></div>
      <div class="osg-sc-top">
        <a class="osg-sc-art" title="Open this sequence"><span class="osg-sc-art-img"></span></a>
        <div class="osg-sc-titles">
          <div class="osg-sc-eyebrow">${sv ? "Sequence" : "Playlist"}${owner ? ` <span aria-hidden="true">·</span> <a href="${esc(owner.getAttribute("href"))}">${esc(owner.textContent.trim())}</a>` : ""}</div>
          <h1 class="osg-sc-title"><span>${esc(title)}</span></h1>
          <div class="osg-sc-nowrow">
            <button type="button" class="osg-sc-play" aria-label="Play">${svgPlay()}</button>
            <div class="osg-sc-now"><span class="osg-sc-nowlabel"><span class="osg-sc-eq" aria-hidden="true"><i></i><i></i><i></i></span><span class="osg-sc-nowtxt">${sv ? "Ready to play" : "Now playing"}</span></span><span class="osg-sc-track">…</span></div>
          </div>
          <div class="osg-sc-meta"></div>
          <div class="osg-sc-acts">${!sv && ownsPlaylist() ? `<button type="button" class="osg-sc-act osg-sc-adder" title="Search for sequences and add them to this playlist">＋ Add sequences</button>` : ""}<button type="button" class="osg-sc-act osg-sc-addpl" data-osg-grp title="Add this sequence to one of your playlists, or a new one">＋ Playlist</button>${sv ? "" : `<button type="button" class="osg-sc-act osg-sc-copypl" title="Make a playlist of your own with every sequence in this one">⧉ Copy to my playlists</button>`}</div>
        </div>
      </div>
      <div class="osg-sc-deck">
        <div class="osg-sc-times"><span class="osg-sc-t osg-sc-t0">0:00</span><span class="osg-sc-t osg-sc-t1">0:00</span></div>
        <div class="osg-sc-wavebox"><canvas class="osg-sc-wave" height="${MH}"></canvas><span class="osg-sc-hovert"></span></div>
      </div>`;
    root().insertAdjacentElement("afterbegin", hero);
    waveCanvas = $(".osg-sc-wave", hero); deck = $(".osg-sc-deck", hero);
    $(".osg-sc-addpl", hero).addEventListener("click", (e) => window.__osgGroups && window.__osgGroups.open(e.currentTarget, curId, curTitle));
    $(".osg-sc-copypl", hero)?.addEventListener("click", copyPlaylist);
    $(".osg-sc-adder", hero)?.addEventListener("click", openAdder);
    $(".osg-sc-play", hero).addEventListener("click", () => { if (isSV()) ask("transport", { act: "toggle" }).then(() => refresh(false)); else playBtn()?.click(); });
    const box = $(".osg-sc-wavebox", deck), ht = $(".osg-sc-hovert", deck);
    const fracAt = (x) => { const r = waveCanvas.getBoundingClientRect(), m = r.width ? geo.off / devicePixelRatio : 0, w = r.width - 2 * m; return Math.max(0, Math.min(1, (x - r.left - m) / Math.max(1, w))); };
    box.addEventListener("mousemove", (e) => {
      hoverFrac = fracAt(e.clientX);
      const end = songSecs || secs($("#duration_time_end")?.textContent); ht.textContent = end ? fmt(end * hoverFrac) : ""; ht.style.left = (e.clientX - box.getBoundingClientRect().left) + "px"; draw();
    });
    box.addEventListener("mouseleave", () => { hoverFrac = -1; ht.textContent = ""; draw(); });
    box.addEventListener("click", (e) => seek(fracAt(e.clientX)));
    new ResizeObserver(() => { sizeCanvas(); draw(); }).observe(box);
  }
  const svgPlay = () => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>`;
  const svgPause = () => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>`;
  // the site's own small thumbnail for any sequence — works for every one, even when a page gave no picture
  const thumbOf = (id) => (String(id || "").replace(/\D/g, "") ? `/preview.php?id=${String(id).replace(/\D/g, "")}&t=0&s=1` : "");
  const secs = (t) => { const m = String(t || "").trim().match(/^(?:(\d+):)?(\d+):(\d\d)$/); return m ? (+(m[1] || 0)) * 3600 + +m[2] * 60 + +m[3] : 0; };
  const fmt = (s) => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, "0"); return h ? `${h}:${String(m).padStart(2, "0")}:${x}` : `${m}:${x}`; };
  const MH = 96, METER = 68;   // canvas height: the note meter, then the time ruler under it (css px)
  const geo = { off: 0 };
  function sizeCanvas() { if (!waveCanvas) return; const w = Math.round(waveCanvas.clientWidth * devicePixelRatio), h = Math.round(MH * devicePixelRatio); if (waveCanvas.width !== w) waveCanvas.width = w; if (waveCanvas.height !== h) waveCanvas.height = h; }

  // the note meter: how much (volume × length) sounds in each slice of time, lit in the colour of the instrument that
  // carries that moment — a column of little cells, like the sequencer's grid
  const N = 600;
  let binCol = null, songSecs = 0;
  // a new song's meter grows in, left to right
  let growAt = 0, growRaf = 0;
  const GROW = 900;
  function grow() {
    cancelAnimationFrame(growRaf); growAt = calm() ? 0 : performance.now(); if (!growAt) { draw(); return; }
    const step = () => { draw(); if (performance.now() - growAt < GROW) growRaf = requestAnimationFrame(step); else { growAt = 0; draw(); } };
    growRaf = requestAnimationFrame(step);
  }
  // the song's clock, kept the way the site's player keeps it: a sixteenth step lasts 15000 / BPM ms, and tempo markers
  // change the BPM from their step on (a blended marker ramps to its BPM from the marker before it). Returns step → ms.
  function timing(d) {
    const a = d.tempo || [], init = d.bpm > 0 ? d.bpm : 110;
    if (!a.length) { const dt = 15000 / init, f = (t) => Math.max(0, t) * dt; f.inv = (ms) => Math.max(0, ms) / dt; return f; }
    const find = (t) => { let lo = 0, hi = a.length - 1; while (hi >= lo) { const mid = (lo + hi) >> 1; if (a[mid].time <= t) lo = mid + 1; else hi = mid - 1; } return hi; };
    const T = [], D = []; let t = 0;
    for (let i = 0; i < 400000; i++) {
      const k = find(i), prev = a[k], next = a[k + 1]; let v = prev ? prev.value : init;
      if (next && next.blend) { const t0 = prev ? prev.time : 0; v = next.time === t0 ? next.value : v + (next.value - v) * (i - t0) / (next.time - t0); }
      const dt = 15000 / Math.max(1, v); T.push(t); D.push(dt);
      if (!next) break;
      t += dt;
    }
    const f = (time) => { if (time <= 0) return 0; const i = Math.min(Math.floor(time), T.length - 1); return T[i] + (time - i) * D[i]; };
    f.inv = (ms) => {   // ms → step: where in the song a moment is
      if (ms <= 0) return 0; let lo = 0, hi = T.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (T[mid] <= ms) lo = mid; else hi = mid - 1; }
      return lo + (ms - T[lo]) / D[lo];
    };
    return f;
  }
  // jump to a point in the song. The site's own progress bar jumps by position in the score, which lands in the wrong place
  // when the tempo changes along the way — this turns the moment you picked into the right step first.
  let curTime = null;
  function seek(f) {
    f = Math.max(0, Math.min(0.999, f));
    const viaBar = () => { const bar = isPL() && $("#duration_bar"); if (!bar) return; const br = bar.getBoundingClientRect(); if (!br.width) return; bar.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: br.left + br.width * f, clientY: br.top + br.height / 2 })); };
    lastFrac = f; draw();
    if (curTime && songSecs) ask("transport", { act: "seek", step: curTime.inv(f * songSecs * 1000) }).then((r) => { if (!r || !r.ok) viaBar(); });
    else viaBar();
  }
  const WAVE_V = "wave4:";
  async function loadWave(id) {
    bars = null; binCol = null; songSecs = 0; curTime = null; draw();
    // played before: its meter is remembered, nothing to download
    const hit = art() && art().cache ? await art().cache.get(WAVE_V + id, 3 * 86400e3) : null; if (id !== curId) return;
    if (hit && Array.isArray(hit.bars)) { svNotes = hit.notes || 0; if (isSV()) svMeta(); bars = hit.bars; binCol = hit.binCol || null; songSecs = hit.songSecs || 0; curTime = timing({ tempo: hit.tempo || [], bpm: hit.bpm }); grow(); return; }
    const d = art() ? await art().seqNotes(id, { live: true, pri: 0 }) : null; if (id !== curId) return;
    if (!d) { bars = []; draw(); setTimeout(() => { if (id === curId && bars && !bars.length) loadWave(id); }, 15000); return; }   // couldn't load: try again shortly
    const notes = d.notes; if (!notes.length) { bars = []; draw(); return; }
    // the site's song length: up to the end of the last note, rounded up to a whole bar; its progress bar runs over the whole seconds of that
    const ms = timing(d), bar = 4 * (d.timeSig > 0 ? d.timeSig : 4); curTime = ms;
    let endStep = 0; for (const n of notes) endStep = Math.max(endStep, Math.floor(n.time) + n.len);
    endStep = Math.max(bar, Math.ceil(endStep / bar) * bar);
    songSecs = Math.max(1, Math.floor(ms(endStep) / 1000)); const total = songSecs * 1000;
    const acc = new Float32Array(N), per = Array.from({ length: N }, () => new Map());
    for (const n of notes) {
      const a = (ms(n.time) / total) * N, b = (ms(n.time + n.len) / total) * N;
      for (let i = Math.max(0, Math.floor(a)); i < Math.min(N, Math.ceil(b)); i++) { const w = n.vol * (Math.min(b, i + 1) - Math.max(a, i)); acc[i] += w; per[i].set(n.inst, (per[i].get(n.inst) || 0) + w); }
    }
    // scale to the loud parts rather than the single loudest moment, so one dense burst (a picture block) doesn't flatten the rest
    const lit = Array.from(acc).filter((v) => v > 0).sort((x, y) => x - y), max = lit.length ? lit[Math.min(lit.length - 1, Math.floor(lit.length * 0.97))] : 0;
    bars = Array.from(acc, (v) => (max ? Math.min(1, Math.sqrt(v / max)) : 0));
    grow();
    const cols = (art().seqColours ? await art().seqColours(id) : null) || {}; if (id !== curId) return;
    binCol = per.map((m) => {
      let best = null, bw = 0; for (const [k, w] of m) if (w > bw) { bw = w; best = k; }
      let c = best != null && cols[best] ? cols[best].slice() : null; if (!c) return null;
      const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; if (l < 90) { const k = (90 - l) / 255; c = c.map((v) => Math.round(v + (255 - v) * k * 1.4)); }   // keep dark instruments visible
      return c.join(",");
    });
    draw();
    if (art() && art().cache) art().cache.put(WAVE_V + id, { bars: bars.map((v) => Math.round(v * 1000) / 1000), binCol, songSecs, tempo: d.tempo || [], bpm: d.bpm, notes: notes.length });
    svNotes = notes.length; if (isSV()) svMeta();
  }
  // the waveform: a smooth ribbon of how much sounds at each moment, coloured by the instruments that carry it — and,
  // while the song plays, the real sound coming out of the site's player drawn live at the playhead
  let live = null, liveAt = 0, loopRaf = 0;
  const lerp = (a, b, t) => a + (b - a) * t;
  // the site's player sends what it's playing (libmain.js taps its output; nothing is changed or recorded)
  addEventListener("message", (e) => {
    const m = e.data; if (e.source !== window || !m || m["osg-lib"] !== "live") return;
    live = { seq: String(m.seq || ""), step: +m.step || 0, level: Math.max(0, Math.min(1, +m.level || 0)), wave: m.wave instanceof Uint8Array ? m.wave : null, freq: m.freq instanceof Uint8Array ? m.freq : null }; liveAt = performance.now();
  });
  // while a song plays, the waveform moves every frame (the playhead glides, the live sound draws)
  function loop() {
    if (loopRaf) return;
    const step = () => { if (!playing || !document.body.classList.contains("osg-sc") || document.hidden) { loopRaf = 0; draw(); return; } draw(); loopRaf = requestAnimationFrame(step); };
    loopRaf = requestAnimationFrame(step);
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && playing) loop(); });
  function envelope(n) {   // the bars, resampled to n points and gently smoothed
    const out = new Float32Array(n); if (!bars || !bars.length) return out;
    for (let i = 0; i < n; i++) { const a = Math.floor((i / n) * bars.length), b = Math.max(a + 1, Math.floor(((i + 1) / n) * bars.length)); let sum = 0, mx = 0; for (let k = a; k < b; k++) { sum += bars[k]; mx = Math.max(mx, bars[k]); } out[i] = (sum / (b - a)) * 0.6 + mx * 0.4; }
    const sm = new Float32Array(n); for (let i = 0; i < n; i++) { let t = 0, w = 0; for (let k = -2; k <= 2; k++) { const j = i + k; if (j < 0 || j >= n) continue; const ww = 3 - Math.abs(k); t += out[j] * ww; w += ww; } sm[i] = t / w; }
    let mx = 0; for (let i = 0; i < n; i++) mx = Math.max(mx, sm[i]);
    if (mx > 0.05) for (let i = 0; i < n; i++) sm[i] = Math.pow(sm[i] / mx, 0.8) * 0.96;   // fill the height: the loudest moment reaches the top
    return sm;
  }
  function ribbonGradient(g, x0, x1, alpha, accentRgb) {
    const gr = g.createLinearGradient(x0, 0, x1, 0), stops = 28;
    for (let k = 0; k <= stops; k++) { const f = k / stops, idx = binCol && bars ? Math.min(binCol.length - 1, Math.floor(f * binCol.length)) : -1; gr.addColorStop(f, `rgba(${(idx >= 0 && binCol[idx]) || accentRgb},${alpha})`); }
    return gr;
  }
  function draw() {
    if (!waveCanvas) return; sizeCanvas();
    const g = waveCanvas.getContext("2d"), W = waveCanvas.width, dpr = devicePixelRatio;
    g.clearRect(0, 0, W, waveCanvas.height);
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue("--os-accent").trim() || "#ff5500", accentRgb = css.getPropertyValue("--os-accent-rgb").trim() || "255, 85, 0";
    const mh = METER * dpr, off = (geo.off = 2 * dpr), span = W - 2 * off, now = performance.now();
    let frac = Math.max(0, lastFrac);
    if (playing && live && curTime && songSecs && now - liveAt < 400 && String(live.seq) === String(curId)) { const st = +live.step || 0, stepMs = Math.max(1, curTime(st + 1) - curTime(st)); frac = Math.min(1, curTime(st + Math.min(8, (now - liveAt) / stepMs)) / (songSecs * 1000)); }
    // bars, like the Studio visualizer: one per moment of the song, as tall as how much sounds then, in the colours of the
    // instruments carrying it. Played bars glow; bars to come are dim. While it plays, the bars around the playhead dance
    // to the real sound coming out of the player (its frequencies, low to high).
    const bw = 4 * dpr, gap = 2 * dpr, n = Math.max(24, Math.floor((span + gap) / (bw + gap))), env = envelope(n), base = mh - 2 * dpr, top = mh * 0.9;
    let reveal = 1; if (growAt) reveal = Math.min(1, (now - growAt) / GROW);
    if (svbar && isSV()) { const fl = $(".osg-svb-fill", svbar); if (fl) fl.style.width = (frac * 100).toFixed(2) + "%"; }
    const fresh = live && playing && !calm() && now - liveAt < 400 && String(live.seq) === String(curId), lvl = fresh ? live.level : 0, px = off + frac * span;
    const fq = fresh && live.freq && live.freq.length ? live.freq : null, win = Math.max(70 * dpr, Math.min(170 * dpr, span * 0.1));
    const hx = hoverFrac >= 0 && bars ? off + hoverFrac * span : -1, step = (span + gap) / n, showTo = off + span * reveal;
    g.fillStyle = "rgba(255,255,255,0.06)"; g.fillRect(off, base, span, dpr);   // the floor
    for (let i = 0; i < n; i++) {
      const x = off + i * step; if (x > showTo) break;
      const cx = x + bw / 2, played = bars && cx <= px;
      let v = bars ? env[i] : 0.1 + 0.06 * Math.sin(i / 4 + tick / 3);
      let dance = 0;
      if (fq || lvl > 0) { const d = Math.abs(cx - px) / win; if (d < 1) { const fall = Math.cos(d * Math.PI / 2); const band = fq ? fq[Math.min(fq.length - 1, Math.floor(((i % 24) / 24) * fq.length))] / 255 : lvl; dance = band * fall; v = Math.max(v, Math.min(1, v * (1 - fall) + dance * 0.98)); } }
      const h = Math.max(2 * dpr, v * top), y = base - h;
      const idx = binCol && bars ? Math.min(binCol.length - 1, Math.floor((i / n) * binCol.length)) : -1, col = (idx >= 0 && binCol[idx]) || accentRgb;
      const a = !bars ? 0.25 : played ? 1 : hx > px && cx <= hx ? 0.6 : 0.28;
      g.fillStyle = `rgba(${col},${Math.min(1, a + dance * 0.5)})`;
      if (played || dance > 0.2) { g.shadowColor = `rgba(${col},0.7)`; g.shadowBlur = (dance > 0.2 ? 10 : 6) * dpr; } else g.shadowBlur = 0;
      g.beginPath(); if (g.roundRect) g.roundRect(x, y, bw, h, [Math.min(bw / 2, h / 2), Math.min(bw / 2, h / 2), 0, 0]); else g.rect(x, y, bw, h); g.fill();
      if (played && h > 4 * dpr) { g.shadowBlur = 0; g.fillStyle = "rgba(255,255,255,0.55)"; g.fillRect(x, y, bw, dpr); }   // a bright cap on played bars
    }
    g.shadowBlur = 0;
    // the ruler
    const end = songSecs || secs($("#duration_time_end")?.textContent), ry = mh + 6 * dpr;
    g.fillStyle = "rgba(255,255,255,0.14)"; g.fillRect(off, ry, span, dpr);
    if (end > 0) {
      const step = [5, 10, 15, 20, 30, 60, 90, 120, 180, 300, 600, 900, 1200, 1800, 3600].find((st) => end / st <= Math.max(2, span / dpr / 90)) || 3600;
      g.font = `600 ${10 * dpr}px Inter, "Segoe UI", system-ui, sans-serif`; g.textAlign = "center"; g.textBaseline = "top";
      for (let t = step; t < end - step * 0.35; t += step) {
        const x = off + (t / end) * span; g.fillStyle = "rgba(255,255,255,0.3)"; g.fillRect(Math.round(x), ry - 3 * dpr, dpr, 7 * dpr);
        g.fillStyle = "rgba(255,255,255,0.5)"; g.fillText(fmt(t), x, ry + 6 * dpr);
      }
      for (let k = 1; k < 4 * Math.ceil(end / step); k++) { const t = (k * step) / 4; if (t >= end || k % 4 === 0) continue; const x = off + (t / end) * span; g.fillStyle = "rgba(255,255,255,0.14)"; g.fillRect(Math.round(x), ry - 2 * dpr, dpr, 4 * dpr); }
    }
    // hover line and the playhead
    if (hoverFrac >= 0) { const x = off + hoverFrac * span; g.fillStyle = "rgba(255,255,255,0.5)"; g.fillRect(Math.round(x), 0, dpr, ry); }
    if (bars && frac > 0) {
      const x = off + frac * span; g.save(); g.shadowColor = accent; g.shadowBlur = 12 * dpr; g.fillStyle = accent;
      g.fillRect(x - dpr, 0, 2 * dpr, ry + 4 * dpr);
      g.beginPath(); g.moveTo(x - 6 * dpr, 0); g.lineTo(x + 6 * dpr, 0); g.lineTo(x, 7 * dpr); g.closePath(); g.fill(); g.restore();
    }
  }
  // a sequence's page: what the site shows in its info sidebar
  let svNotes = 0;
  function svInfo() {
    const det = $(".info-sidebar-details"), by = det ? $('a[href^="/members/"]', det) : null;
    return {
      title: (document.querySelector('meta[property="og:title"]')?.getAttribute("content") || $("#title")?.value || document.title.replace(/\s*-\s*Online Sequencer\s*$/, "")).trim() || "Untitled",
      by, plays: (($(".playcount", det || document)?.firstChild?.textContent || "").match(/[\d,]+/) || [])[0] || "",
      date: $(".sequence-date", det || document)?.textContent.trim() || "",
      based: det ? $$(".inspired", det).map((x) => ({ text: x.textContent.trim(), href: $('a[href^="/"]:not([href^="/members/"])', x)?.getAttribute("href") || "" })) : [],
    };
  }
  const mine = () => { const me = window.__osgGroups && window.__osgGroups.me ? window.__osgGroups.me() : ""; const by = (svInfo().by?.getAttribute("href") || "").replace(/\D/g, ""); return !!me && me === by; };
  function svMeta() {
    if (!hero) return; const i = svInfo();
    $(".osg-sc-meta", hero).innerHTML = [i.plays ? `${i.plays} plays` : "", svNotes ? `${svNotes.toLocaleString()} notes` : "", i.date ? `updated ${i.date}` : "",
      ...i.based.slice(0, 2).map((b) => (b.href ? `<a href="${esc(b.href)}">${esc(b.text)}</a>` : esc(b.text))), histN || mine() ? `<a href="#" data-osg-hist title="Every version kept of this sequence — and a way to look for older ones">🕘 History${histN ? ` (${histN})` : ""}</a>` : "", `<a href="#os" data-osg-edit title="Edit this sequence in the site's editor">✎ Edit</a>`]
      .filter(Boolean).map((t) => `<span>${/^</.test(t) ? t : esc(t)}</span>`).join("");
    if (histFor !== curId) { histFor = curId; const id = curId; sendBg({ type: "lib:versions", seqId: id }).then((r) => { if (id === curId && r && r.count > 1 && r.count !== histN) { histN = r.count; svMeta(); } }); }
  }
  let histN = 0, histFor = "";
  document.addEventListener("click", (e) => { const ed = e.target.closest("[data-osg-edit]"); if (!ed || !isSV()) return; e.preventDefault(); ask("edit", {}).then((r) => { if (!r || !r.ok) setView("os", false); }); });
  document.addEventListener("click", (e) => { const h = e.target.closest("[data-osg-hist]"); if (!h) return; e.preventDefault(); sendBg({ type: "lib:history", seqId: curId }); });
  let curTitle = "";
  const sendBg = (msg) => new Promise((res) => { try { chrome.runtime.sendMessage(msg, (r) => { void chrome.runtime.lastError; res(r || null); }); } catch (e) { res(null); } });
  // a playlist page: copy every sequence in it into a new playlist of yours
  async function copyPlaylist(e) {
    const b = e.currentTarget; if (b.dataset.busy) return; if (b.dataset.pid) { location.href = `/playlist/${b.dataset.pid}#sc`; return; }
    const G = window.__osgGroups; if (!G || !G.me()) { if (window.__osgToast) window.__osgToast("Sign in to Online Sequencer to make playlists."); return; }
    const seqs = $$("#sequences_list a[data-id]").map((a) => a.dataset.id), title = ($("#playlist_title")?.textContent.trim() || "Playlist");
    const ownerUid = ($(".playlist_title_wrapper a[href*='/members/']")?.getAttribute("href") || "").replace(/\D/g, "");
    b.dataset.busy = "1"; b.textContent = `Copying 0 of ${seqs.length}…`;
    const r = await G.copyPlaylist(ownerUid === G.me() ? `${title} (copy)` : title, seqs, (n, t) => { b.textContent = `Copying ${n} of ${t}…`; });
    delete b.dataset.busy;
    if (r.error) { b.textContent = "⧉ Copy to my playlists"; if (window.__osgToast) window.__osgToast(r.error === "signin" ? "Sign in to make playlists." : r.error); return; }
    b.dataset.pid = r.pid; b.classList.add("done"); b.textContent = `✓ Copied (${r.added}) — open it`;
  }
  async function showTrack(id) {
    curId = id; lastFrac = -1;
    if (isSV()) {
      const i = svInfo(); curTitle = i.title;
      $(".osg-sc-track", hero).textContent = i.by ? `by ${i.by.textContent.trim()}` : "";
      svMeta(); replay($(".osg-sc-now", hero), "osg-rise"); replay($(".osg-sc-meta", hero), "osg-rise");
      $(".osg-sc-art", hero).removeAttribute("href");
      loadComments(id); loadWave(id);
      const drawn = art() ? await art().seqArt(id, { live: true, pri: 0 }) : null;
      // no picture in the notes: the site's own small thumbnail (its big share image carries the site's badge)
      if (id === curId) await setPic(id, drawn && drawn.art ? drawn.url : `/preview.php?id=${id}&t=0&s=1`, !!(drawn && drawn.art));
      return;
    }
    const row = $(`#sequence_${id}`); curTitle = row?.querySelector(".playlist_sequence_title")?.textContent.trim() || ""; const title = row?.querySelector(".playlist_sequence_title")?.textContent.trim() || $("#playlist_playing_sequence")?.textContent.trim() || "";
    const by = row?.querySelector(".playlist_sequence_subtitle span")?.textContent.trim() || "";
    const dur = row?.querySelector(".duration_column")?.textContent.trim() || "";
    $(".osg-sc-track", hero).textContent = title + (by ? ` — ${by}` : "");
    replay($(".osg-sc-now", hero), "osg-rise");
    if (document.body.classList.contains("osg-st")) { loadComments(id); centerRow(row); }
    const rows = $$("#sequences_list .playlist_row:not(#add_sequence)"), pos = rows.findIndex((r) => r.id === "sequence_row_" + id);
    $(".osg-sc-meta", hero).innerHTML = [pos >= 0 ? `Track ${pos + 1} of ${rows.length}` : "", dur, `<a href="/${esc(id)}">Open in the editor ↗</a>`].filter(Boolean).map((t) => `<span>${/^</.test(t) ? t : esc(t)}</span>`).join("");
    replay($(".osg-sc-meta", hero), "osg-rise");
    const a = $(".osg-sc-art", hero); a.href = "/" + id;
    const ic = row?.querySelector("img.playlist_sequence_title_icon"), src = ic ? ic.getAttribute("data-src") || ic.getAttribute("src") || "" : "";
    const tile = src && !/^data:/.test(src) ? src : thumbOf(id);   // a lazy thumbnail's placeholder is a blank pixel
    loadWave(id);
    // the picture drawn from the notes, or the site's thumbnail first if drawing takes a moment
    const drawn = art() ? art().seqArt(id, { live: true, pri: 0 }) : Promise.resolve(null);
    // (a song with no picture block keeps the site's own thumbnail: the whole song squeezed into a square isn't a picture)
    const quick = await Promise.race([drawn, new Promise((r) => setTimeout(() => r(undefined), 160))]);
    if (id !== curId) return;
    if (quick && quick.art) { await setPic(id, quick.url, true); return; }
    await setPic(id, tile, false);
    const pic = await drawn; if (pic && pic.art && id === curId) await setPic(id, pic.url, true);
  }
  async function setPic(id, url, isDrawn) {
    const img = $(".osg-sc-art-img", hero), bg = $(".osg-sc-bg", hero);
    const css = url ? `url("${url}")` : ""; if (img.style.backgroundImage === css) return;
    await preload(url); if (id !== curId) return;
    crossfade(img); crossfade(bg);
    img.style.backgroundImage = css; bg.style.backgroundImage = css; img.classList.toggle("drawn", !!isDrawn);
    replay(img, "osg-pic-in");
  }
  // Studio: the playing track glides to the middle of the playlist
  function centerRow(row) {
    const list = $("#sequences_list"), r = row?.closest(".playlist_row") || row; if (!list || !r || list.scrollHeight <= list.clientHeight) return;
    const top = list.scrollTop + (r.getBoundingClientRect().top - list.getBoundingClientRect().top) - list.clientHeight / 2 + r.offsetHeight / 2;
    list.scrollTo({ top: Math.max(0, top), behavior: calm() ? "auto" : "smooth" });
  }
  function currentId() {
    return $("#sequences_list a.current_sequence")?.dataset.id || (($("#playing_link")?.getAttribute("href") || "").match(/(\d+)$/) || [])[1] || "";
  }
  let thumbTick = 0;
  function setPlaying(p) {
    if (p === playing) return; playing = p; const b = $(".osg-sc-play", hero); b.innerHTML = p ? svgPause() : svgPlay(); b.setAttribute("aria-label", p ? "Pause" : "Play");
    hero.classList.toggle("playing", p); document.body.classList.toggle("osg-sc-playing", p); if (p) loop();
    if (isSV()) $(".osg-sc-nowtxt", hero).textContent = p ? "Now playing" : "Ready to play";
  }
  // a sequence's page has no progress bar: ask the site's player where it is
  let svBusy = false;
  // remember the list a sequence was opened from, so its page can go back and forward through it
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a[href]"); if (!a || a.closest("#osg-svbar")) return;
    const seqOf = (x) => ((x.getAttribute("href") || "").replace(/^https?:\/\/onlinesequencer\.net/, "").match(/^\/(\d+)\/?(?:[?#].*)?$/) || [])[1] || "";
    const id = seqOf(a); if (!id) return;
    const box = a.closest(".pager-items, .sequences-list, .osg-rc-shelf, #osg-sc-recs, .playlists_list, #page_right, main") || document.body;
    const ids = [], t = {}; for (const x of $$("a[href]", box)) { const k = seqOf(x); if (!k || t[k] !== undefined) continue; ids.push(k); t[k] = (x.closest("[title]")?.getAttribute("title") || x.textContent || "").trim().slice(0, 120); }
    if (ids.length < 2 || !ids.includes(id)) return;
    const from = document.body.id === "page_member" || /^\/members\//.test(location.pathname) ? `${($(".profile_header .name")?.textContent || "their").trim()}'s sequences` : document.title.replace(/\s*-\s*Online Sequencer\s*$/, "") || "this list";
    try { sessionStorage.setItem("osg-seqlist", JSON.stringify({ ids: ids.slice(0, 600), t, from, at: Date.now() })); } catch (err) {}
  }, true);
  // a sequence's page gets the same bottom bar as a playlist: what's playing, back to the start, play / pause, the time
  // line (tempo-true, click to jump) and the volume (it moves the site's own volume)
  let svbar = null, svUnmuted = 1;
  function buildSvBar() {
    if (svbar || !isSV()) return;
    svbar = document.createElement("div"); svbar.id = "osg-svbar"; svbar.setAttribute("role", "region"); svbar.setAttribute("aria-label", "Player");
    svbar.innerHTML = `<a class="osg-svb-now" href="#" title="Back to the top"><span class="osg-svb-art"></span><span class="osg-svb-txt"><small>Now playing</small><b></b><i></i></span></a>
      <div class="osg-svb-btns"><button type="button" class="osg-svb-prev" aria-label="Back" title="Back: to the start (or, in the first 10 seconds, the previous sequence)"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M6 5h2v14H6zM20 5v14L9.5 12z"/></svg></button><button type="button" class="osg-svb-play" aria-label="Play">${svgPlay()}</button><button type="button" class="osg-svb-next" aria-label="Next sequence" title="Next sequence" disabled><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M16 5h2v14h-2zM4 5v14l10.5-7z"/></svg></button></div>
      <div class="osg-svb-time"><span class="osg-svb-t0">0:00</span><div class="osg-svb-bar" title="Click to jump there"><div class="osg-svb-fill"></div></div><span class="osg-svb-t1"></span></div>
      <div class="osg-svb-vol"><button type="button" class="osg-svb-mute" aria-label="Mute" title="Mute / unmute"><svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9z"/><path class="osg-svb-waves" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/><path class="osg-svb-x" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M16 9.5l5 5m0-5l-5 5"/></svg></button><input type="range" class="osg-svb-slider" min="0" max="2" step="0.01" value="1" aria-label="Volume"></div>`;
    document.body.appendChild(svbar);
    for (const ev of ["keydown", "keyup", "keypress"]) $(".osg-svb-slider", svbar).addEventListener(ev, (e) => { if (e.key !== " ") e.stopPropagation(); });
    $(".osg-svb-now", svbar).addEventListener("click", (e) => { e.preventDefault(); scrollTo({ top: 0, behavior: calm() ? "auto" : "smooth" }); });
    $(".osg-svb-play", svbar).addEventListener("click", () => ask("transport", { act: "toggle" }).then(() => refresh(false)));
    $(".osg-svb-prev", svbar).addEventListener("click", svBack);
    $(".osg-svb-next", svbar).addEventListener("click", () => svGo(1));
    svNeighbours();
    $(".osg-svb-bar", svbar).addEventListener("click", (e) => { const r = e.currentTarget.getBoundingClientRect(); if (r.width) seek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))); });
    const sl = $(".osg-svb-slider", svbar), site = () => $("#volume_slider");
    const setVol = (v) => { sl.value = v; svVolFill(); const x = site(); if (x) { x.value = v; x.dispatchEvent(new Event("input", { bubbles: true })); x.dispatchEvent(new Event("change", { bubbles: true })); } };
    sl.addEventListener("input", () => setVol(sl.value));
    sl.addEventListener("wheel", (e) => { e.preventDefault(); setVol(Math.max(0, Math.min(2, +sl.value + (e.deltaY < 0 ? 0.1 : -0.1)))); }, { passive: false });
    $(".osg-svb-mute", svbar).addEventListener("click", () => { if (+sl.value > 0) { svUnmuted = +sl.value; setVol(0); } else setVol(svUnmuted || 1); });
    if (site()) sl.value = site().value || 1; svVolFill();
  }
  // back and forward through the list you came from (a creator's sequences, search results, a shelf…) — or, if you came
  // straight here, the creator's own sequences. Back: to the start, or in the first 10 seconds the previous sequence
  // (so past 10 seconds, pressing it twice goes back a sequence). Forward: the next one. A song that was playing keeps
  // playing on the next page.
  let svNb = null, svMs = 0;
  async function svList() {
    const id = svId();
    try { const c = JSON.parse(sessionStorage.getItem("osg-seqlist") || "null"); if (c && Array.isArray(c.ids) && c.ids.includes(id) && Date.now() - c.at < 6 * 3600e3) return c; } catch (e) {}
    const uid = (svInfo().by?.getAttribute("href") || "").replace(/\D/g, ""); if (!uid) return null;
    const v = await readPage(`/members/${uid}`, parseMember(uid, true), 1); if (!v || !v.seqs.length) return null;
    const who = v.name || svInfo().by?.textContent.trim() || "";
    return { ids: v.seqs.map((x) => x.id), t: Object.fromEntries(v.seqs.map((x) => [x.id, x.t])), th: Object.fromEntries(v.seqs.map((x) => [x.id, x.th])), by: Object.fromEntries(v.seqs.map((x) => [x.id, who])), from: `${who || "the creator"}'s sequences` };
  }
  async function svNeighbours() {
    const l = await svList(), id = svId(), i = l ? l.ids.indexOf(id) : -1;
    svNb = i < 0 ? null : { prev: l.ids[i - 1] || "", next: l.ids[i + 1] || "", t: l.t || {}, from: l.from || "", n: l.ids.length, i };
    svRails(l, i); svAutoNext();
    if (!svbar) return; const nx = $(".osg-svb-next", svbar), pv = $(".osg-svb-prev", svbar), name = (x) => (svNb.t[x] ? `“${svNb.t[x]}”` : `#${x}`);
    nx.disabled = !(svNb && svNb.next);
    nx.title = svNb && svNb.next ? `Next: ${name(svNb.next)} — ${svNb.i + 2} of ${svNb.n} in ${svNb.from}` : svNb ? `This is the last of ${svNb.from}` : "Next sequence";
    pv.title = svNb && svNb.prev ? `Back: to the start — or, in the first 10 seconds, ${name(svNb.prev)}` : "Back to the start";
  }
  // when a song ends, go on to the next one (a setting, on by default): the site's player tells libmain.js when it
  // reaches the end, instead of looping back to the start. Off, or with nothing next, the song loops as usual.
  let autoNextOn = true;
  function svAutoNext() { if (!isSV()) return; const on = enabled && autoNextOn && document.body.classList.contains("osg-sv") && !!(svNb && svNb.next); ask("autonext", { on }, 3000); }
  addEventListener("message", (e) => {
    const m = e.data; if (e.source !== window || !m || m["osg-lib"] !== "ended" || !isSV()) return;
    if (String(m.seq) !== svId() || !svNb || !svNb.next || !autoNextOn) return;
    try { sessionStorage.setItem("osg-sv-auto", svNb.next); } catch (err) {}
    location.href = "/" + svNb.next;
  });
  function svOpen(to) {   // open another sequence; if this one was playing, that one starts playing too
    try { if (playing) sessionStorage.setItem("osg-sv-auto", to); else sessionStorage.removeItem("osg-sv-auto"); } catch (e) {}
    location.href = "/" + to;
  }
  function svGo(dir) {
    const to = svNb && (dir > 0 ? svNb.next : svNb.prev); if (!to) return false;
    svOpen(to); return true;
  }
  // "Previous" and "Up next" beside the player — one song each, from the same list as back / next (shown when there's room on the sides)
  function svRails(l, i) {
    $$(".osg-sv-rail").forEach((x) => x.remove());
    const host = $("#osg-sv"); if (!host || !l || i < 0) return;
    const item = (id, k) => { const t = (l.t && l.t[id]) || `Sequence #${id}`, th = (l.th && l.th[id]) || thumbOf(id), by = l.by && l.by[id];
      return `<a class="osg-sv-ri" href="/${esc(id)}" data-osg-rail="${esc(id)}" style="--i:${k}" title="${esc(t)}"><span class="osg-sv-rth" style="background-image:url(&quot;${esc(th)}&quot;)"></span><span class="osg-sv-rt"><b>${esc(t)}</b>${by ? `<small>${esc(by)}</small>` : ""}</span></a>`; };
    const rail = (side, head, ids, empty) => { const r = document.createElement("aside"); r.className = `osg-sv-rail osg-sv-rail-${side}`; r.setAttribute("aria-label", head);
      const art = ids.length ? (l.th && l.th[ids[0]]) || thumbOf(ids[0]) : "";
      // the same backdrop as the player: the nearest song's picture, blurred, under the piano-roll grid
      r.innerHTML = `<span class="osg-sv-rbg" aria-hidden="true"${art ? ` style="background-image:url(&quot;${esc(art)}&quot;)"` : ""}></span><span class="osg-sv-rgrid" aria-hidden="true"></span><span class="osg-sv-rshade" aria-hidden="true"></span><header><span class="osg-st-dot"></span>${head}</header>${ids.length ? ids.map(item).join("") : `<div class="osg-sv-rempty">${empty}</div>`}`; r.title = l.from ? `From ${l.from}` : "";
      host.appendChild(r);
      const bg = $(".osg-sv-rbg", r);   // pointing at a song shows its picture behind the list
      r.addEventListener("mouseover", (e) => { const it = e.target.closest(".osg-sv-ri"); if (!it) return; const u = $(".osg-sv-rth", it)?.style.backgroundImage; if (u && bg.style.backgroundImage !== u) bg.style.backgroundImage = u; });
      r.addEventListener("mouseleave", () => { if (art) bg.style.backgroundImage = `url("${art}")`; }); };
    rail("prev", "Previous", l.ids.slice(Math.max(0, i - 1), i), "This is the first one.");
    rail("next", "Up next", l.ids.slice(i + 1, i + 2), "That's the last one.");    fitRails();
  }
  // a side list only shows when it fits beside the player, inside the window
  function fitRails() {   // where it sits when it's out (not tucked): offsetLeft leaves the tuck's transform out
    for (const r of $$(".osg-sv-rail")) { r.classList.remove("osg-off"); const h = r.offsetParent; if (!h || !r.offsetWidth) continue; const x = h.getBoundingClientRect().left + r.offsetLeft;
      if (x < 4 || x + r.offsetWidth > document.documentElement.clientWidth - 4) r.classList.add("osg-off"); }
  }
  addEventListener("resize", () => requestAnimationFrame(fitRails));
  document.addEventListener("click", (e) => { const a = e.target.closest && e.target.closest("[data-osg-rail]"); if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button) return; e.preventDefault(); svOpen(a.dataset.osgRail); }, true);
  function svBack() {
    const ms = svMs;
    if (ms <= 10000 && svGo(-1)) return;
    ask("transport", { act: "rewind" }).then(() => refresh(false));
  }
  async function svAutoplay() {   // arrived with Next / Back while a song played: carry on playing
    let want = ""; try { want = sessionStorage.getItem("osg-sv-auto") || ""; } catch (e) {}
    if (!want || want !== svId()) return; try { sessionStorage.removeItem("osg-sv-auto"); } catch (e) {}
    for (let k = 0; k < 40; k++) { const r = await ask("transport", { act: "play" }, 1500); if (r && r.ok) { refresh(false); return; } await new Promise((res) => setTimeout(res, 500)); }
  }
  function svVolFill() {
    if (!svbar) return; const sl = $(".osg-svb-slider", svbar), x = Math.max(0, Math.min(2, +sl.value || 0));
    sl.style.setProperty("--osg-vol", (x / 2 * 100) + "%"); sl.title = `Volume ${Math.round(x * 100)}%`; svbar.classList.toggle("osg-muted", x === 0);
    $(".osg-svb-mute", svbar).setAttribute("aria-label", x === 0 ? "Unmute" : "Mute");
  }
  function svBarSync(t0, t1, f) {
    if (!svbar) return;
    $(".osg-svb-t0", svbar).textContent = t0; $(".osg-svb-t1", svbar).textContent = t1; $(".osg-svb-fill", svbar).style.width = (f * 100).toFixed(2) + "%";
    const art = $(".osg-sc-art-img", hero)?.style.backgroundImage || "", a = $(".osg-svb-art", svbar); if (a.style.backgroundImage !== art) a.style.backgroundImage = art;
    const t = $(".osg-sc-title", hero)?.textContent.trim() || "", by = $(".osg-sc-track", hero)?.textContent.trim() || "";
    if ($("b", svbar).textContent !== t) { $("b", svbar).textContent = t; $(".osg-svb-now", svbar).title = t; } if ($(".osg-svb-txt i", svbar).textContent !== by) $(".osg-svb-txt i", svbar).textContent = by;
    const b = $(".osg-svb-play", svbar), p = svbar.classList.contains("playing"); if (p !== playing) { svbar.classList.toggle("playing", playing); b.innerHTML = playing ? svgPause() : svgPlay(); b.setAttribute("aria-label", playing ? "Pause" : "Play"); }
  }
  async function svRefresh(force) {
    const id = svId(); if (id && (id !== curId || force)) showTrack(id);
    if (!svbar) { buildSvBar(); svAutoplay(); }
    if (svBusy) return; svBusy = true;
    const r = await ask("pos", {}, 800); svBusy = false;
    $(".osg-sc-t1", deck).textContent = songSecs ? fmt(songSecs) : "";
    if (!r || !r.ok) { if (!bars) { tick++; draw(); } svBarSync($(".osg-sc-t0", deck).textContent, songSecs ? fmt(songSecs) : "", lastFrac > 0 ? lastFrac : 0); return; }
    setPlaying(!!r.playing);
    const msNow = curTime ? curTime(+r.step || 0) : 0, f = songSecs ? Math.min(1, msNow / (songSecs * 1000)) : 0; svMs = msNow;
    $(".osg-sc-t0", deck).textContent = fmt(msNow / 1000);
    svBarSync(fmt(msNow / 1000), songSecs ? fmt(songSecs) : "", f);
    // the side cards wait tucked behind the player, dark; Previous comes out in the first 5 seconds of a playing song,
    // Up next in its last 10 (and either one when you point at it)
    const left = songSecs ? songSecs - msNow / 1000 : Infinity;
    $(".osg-sv-rail-prev")?.classList.toggle("osg-pop", !!r.playing && msNow <= 5000);
    $(".osg-sv-rail-next")?.classList.toggle("osg-pop", !!r.playing && left <= 10);
    if (Math.abs(f - lastFrac) > 0.0005 || !bars) { lastFrac = f; tick++; draw(); }
  }
  // the playlist's bottom bar: the site's own controls, laid out in one tidy row — what's playing, the buttons, the
  // time line with times that follow the song's tempo changes, and a volume slider that's easy to grab (click the
  // speaker to mute and unmute)
  let dockBuilt = false, unmuted = 1;
  const volFill = () => {
    const v = $("#volume_slider"); if (!v) return; const x = Math.max(0, Math.min(2, +v.value || 0));
    v.style.setProperty("--osg-vol", (x / 2 * 100) + "%"); v.title = `Volume ${Math.round(x * 100)}%`; v.setAttribute("aria-valuetext", Math.round(x * 100) + "%");
    const ic = $("[data-osg-vol]"); if (ic) { const m = x === 0; ic.classList.toggle("fa-volume", !m); ic.classList.toggle("fa-volume-mute", m); ic.setAttribute("aria-label", m ? "Unmute" : "Mute"); }
  };
  function buildDock() {
    if (dockBuilt || !isPL()) return; const bar = $("#playlist_controls"), dur = $(".playlist_controls_duration_group", bar || document), vol = $("#volume_slider"); if (!bar || !dur || !vol) return;
    dockBuilt = true;
    const t0 = document.createElement("span"), t1 = document.createElement("span"); t0.className = "osg-dock-t0"; t1.className = "osg-dock-t1"; t0.textContent = "0:00";
    dur.insertAdjacentElement("afterbegin", t0); dur.appendChild(t1);
    vol.setAttribute("aria-label", "Volume"); vol.title = "Volume";
    vol.addEventListener("input", volFill); volFill();
    const ic = $(".playlist_controls_top .fa-volume", bar);
    if (ic) { ic.dataset.osgVol = "1"; ic.setAttribute("role", "button"); ic.setAttribute("tabindex", "0"); ic.setAttribute("aria-label", "Mute"); ic.title = "Mute / unmute";
      const flip = () => { if (+vol.value > 0) { unmuted = +vol.value; vol.value = 0; } else vol.value = unmuted || 1; vol.dispatchEvent(new Event("input", { bubbles: true })); vol.dispatchEvent(new Event("change", { bubbles: true })); };
      ic.addEventListener("click", flip); ic.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); flip(); } }); }
    // scrolling over the volume nudges it
    vol.addEventListener("wheel", (e) => { e.preventDefault(); vol.value = Math.max(0, Math.min(2, +vol.value + (e.deltaY < 0 ? 0.1 : -0.1))); vol.dispatchEvent(new Event("input", { bubbles: true })); }, { passive: false });
  }
  let plBusy = false, plPos = null;
  // clicking the bottom bar's time line jumps to that moment in time (the site's own jump lands off when the tempo changes)
  document.addEventListener("click", (e) => {
    if (!e.isTrusted || !enabled || !isPL() || !document.body.classList.contains("osg-sc") || !curTime || !songSecs) return;
    const bar = e.target.closest && e.target.closest("#duration_bar"); if (!bar) return;
    const r = bar.getBoundingClientRect(); if (!r.width) return;
    e.preventDefault(); e.stopPropagation(); seek((e.clientX - r.left) / r.width);
  }, true);
  function refresh(force) {
    if (!document.body.classList.contains("osg-sc") || !hero) return;
    if (isSV()) { svRefresh(force); return; }
    const id = currentId(); if (id && (id !== curId || force)) showTrack(id);
    const w = parseFloat($("#duration_bar_progress")?.style.width || "0"); let f = isNaN(w) ? 0 : Math.max(0, Math.min(1, w / 100));
    setPlaying(/fa-pause/.test($("#playlist_play_btn")?.className || ""));
    // where the site's player really is, in time (its own clock assumes one tempo for the whole song)
    if (!plBusy) { plBusy = true; ask("pos", {}, 800).then((r) => { plBusy = false; plPos = r && r.ok && String(r.seq) === String(curId) ? r : null; }); }
    let t0 = $("#duration_time_current")?.textContent || "0:00", t1 = $("#duration_time_end")?.textContent || "";
    if (plPos && curTime && songSecs) { const msNow = Math.min(songSecs * 1000, curTime(+plPos.step || 0)); f = Math.min(1, msNow / (songSecs * 1000)); t0 = fmt(msNow / 1000); t1 = fmt(songSecs); }
    else if (songSecs) { t0 = fmt(f * songSecs); t1 = fmt(songSecs); }
    $(".osg-sc-t0", deck).textContent = t0; $(".osg-sc-t1", deck).textContent = t1;
    const d0 = $(".osg-dock-t0"), d1 = $(".osg-dock-t1"); if (d0) d0.textContent = t0; if (d1) d1.textContent = t1;
    const prog = $("#duration_bar_progress"), own = !!(plPos && curTime && songSecs);
    if (prog) { prog.classList.toggle("osg-f", own); if (own) prog.style.setProperty("--osg-f", (f * 100).toFixed(2) + "%"); }
    if (thumbTick % 4 === 0) volFill();
    if (Math.abs(f - lastFrac) > 0.0005 || !bars) { lastFrac = f; tick++; draw(); }
    if (++thumbTick % 8 === 0) lazyThumbs();
  }

  // ---------------------------------------------------------------------------------------------------
  // For you: beside the Glow player, sequences and playlists picked for your taste, from what's already on hand —
  //   this playlist (its owner, its creators, the words its titles share), the people you subscribe to and the
  //   sequences and people you've looked at lately (the Recent list). At most four pages are read for it (the owner's
  //   channel, two searches, one channel you follow or visited), one after another, kept for 30 minutes.
  // ---------------------------------------------------------------------------------------------------
  let recsOn = true, recs = null, recsFor = "";
  const REC_TTL = 30 * 60e3;
  const STOP = new Set("the and for with from this that your you remix cover covers arrang arranged arrangement version theme song songs music sequence sequences feat original edit full part loop mix extended short attempt accuracy accurate wip new old ost soundtrack medley piano orchestra orchestral layer layers boxx".split(" "));
  const urlOf = (style) => ((style || "").match(/url\((['"]?)([^'")]+)\1\)/) || [])[2] || "";
  async function readPage(url, parse, pri = 2) {   // a page, parsed into plain items and kept for this tab session
    const key = "osg-rec:" + url;
    try { const c = JSON.parse(sessionStorage.getItem(key) || "null"); if (c && Date.now() - c.at < REC_TTL) return c.v; } catch (e) {}
    let v = null;
    try { const r = await net(url, null, pri); if (r.ok) v = parse(new DOMParser().parseFromString(await r.text(), "text/html")); } catch (e) {}
    if (v) try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), v })); } catch (e) {}
    return v;
  }
  const parseSearch = (doc) => ({ seqs: $$(".sequence-card", doc).map((c) => {
    const a = $(".sequence-title a", c), au = $('.sequence-author a[href*="/members/"]', c), items = $$(".sequence-details-item", c).map((x) => x.textContent.trim());
    return { id: (a?.getAttribute("href") || "").replace(/\D/g, ""), t: a?.textContent.trim() || "", by: au?.textContent.trim() || "", uid: (au?.getAttribute("href") || "").replace(/\D/g, ""), th: urlOf($(".preview_large", c)?.getAttribute("style")), dur: items[0] || "", plays: items[2] || "" };
  }).filter((x) => x.id && x.t), lists: [] });
  const parseMember = (uid, all) => (doc) => {
    const name = $(".profile_header .name", doc)?.textContent.trim() || "";
    return {
      name,
      seqs: $$("#page_right .pager-items .preview", doc).slice(0, all ? 400 : 24).map((p) => ({ id: ($("a", p)?.getAttribute("href") || "").replace(/\D/g, ""), t: p.getAttribute("title") || "", by: name, uid, th: urlOf($(".image", p)?.getAttribute("style")), dur: "", plays: "", notes: $(".info", p)?.textContent.trim() || "" })).filter((x) => x.id && x.t),
      lists: $$(".playlist_preview[data-id]", doc).map((p) => ({ id: p.dataset.id, t: $(".playlist_preview_title", p)?.textContent.trim() || "", by: name, uid, ths: $$("img", p).map((i) => i.getAttribute("src")).filter(Boolean).slice(0, 4), cover: urlOf($(".playlist_preview_thumb", p)?.getAttribute("style")), more: $(".playlist_preview_sequence_wrapper span", p)?.textContent.trim() || "" })).filter((x) => x.id && x.t),
    };
  };
  function keywords(titles, avoid) {   // the words this playlist's (and your recent) titles share
    const score = new Map();
    for (const t of titles) {
      const seen = new Set(), front = t.split(/[|\-–—:(\[]/)[0];
      for (const [part, w] of [[front, 2], [t, 1]]) for (const m of part.toLowerCase().matchAll(/[a-z0-9][a-z0-9']{3,}/g)) {
        const k = m[0].replace(/'s$/, ""); if (STOP.has(k) || avoid.has(k) || /^\d+$/.test(k) || seen.has(k + w)) continue; seen.add(k + w); score.set(k, (score.get(k) || 0) + w);
      }
    }
    return [...score.entries()].filter(([, v]) => v >= 3).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k);
  }
  // For you folds away (and the player centres itself); a lip on the player's top-right corner brings it back. Remembered.
  const RC_KEY = "osg-recs-closed";
  const recsClosed = () => { try { return localStorage.getItem(RC_KEY) === "1"; } catch (e) { return false; } };
  function setRecsClosed(closed, animate = true) {
    const flip = () => {
      try { localStorage.setItem(RC_KEY, closed ? "1" : "0"); } catch (e) {}
      document.body.classList.toggle("osg-recs-closed", closed);
      if (!closed) buildRecs();
      requestAnimationFrame(() => { sizeCanvas(); draw(); placeRecsTab(); fitRails(); }); setTimeout(fitRails, 600);
    };
    if (animate && window.__osgMotion) window.__osgMotion.smooth(flip); else flip();
  }
  function recsTab() {
    const host = root(); if (!host) return;
    let t = $("#osg-rc-tab");
    if (!t) { t = document.createElement("button"); t.type = "button"; t.id = "osg-rc-tab"; t.title = "Show For you"; t.innerHTML = `<span aria-hidden="true">‹</span>For you`; t.addEventListener("click", () => setRecsClosed(false)); }
    if (t.parentElement !== host) host.appendChild(t);   // beside the player, in the same grid cell, so it rides on the player's corner
    placeRecsTab();
  }
  // the lip sticks out past the player's right edge; when the window leaves no room for that, it tucks inside the edge
  function placeRecsTab() {
    const t = $("#osg-rc-tab"); if (!t || !hero || !recsClosed()) return;
    const r = hero.getBoundingClientRect(); if (!r.width) return;
    t.classList.toggle("osg-in", r.right + 44 > document.documentElement.clientWidth - 4);
  }
  addEventListener("resize", () => requestAnimationFrame(placeRecsTab));
  async function buildRecs() {
    const host = root(); if (!host) return;
    recsTab(); document.body.classList.toggle("osg-recs-closed", recsClosed());
    if (recsClosed()) return;   // folded away: nothing to read until it's opened
    const key = isPL() ? "pl:" + ((location.pathname.match(/\/playlist\/(\d+)/) || [])[1] || "") : "seq:" + svId(); if (key.endsWith(":")) return;
    let box = $("#osg-sc-recs");
    if (!box) {
      box = document.createElement("aside"); box.id = "osg-sc-recs"; box.setAttribute("aria-label", "For you");
      box.innerHTML = `<header class="osg-rc-head"><b>For you</b><small>Music like this, from creators you like, and what's popular this week</small><button type="button" class="osg-rc-x" title="Hide For you (the player moves to the middle)" aria-label="Hide For you">›</button></header><div class="osg-rc-body"><div class="osg-rc-empty">Finding music for you…</div></div>`;
      $(".osg-rc-x", box).addEventListener("click", () => setRecsClosed(true));
      box.addEventListener("click", (e) => { const b = e.target.closest(".osg-rc-add"); if (!b) return; e.preventDefault(); e.stopPropagation(); if (window.__osgGroups) window.__osgGroups.open(b, b.dataset.seq, b.dataset.t); });
      host.appendChild(box);
    }
    if (recsFor === key) return; recsFor = key;
    // what's on hand
    const sv = isSV(), info = sv ? svInfo() : null;
    const inList = new Set(sv ? [svId()] : $$("#sequences_list a[data-id]").map((a) => a.dataset.id));
    const titles = sv ? [info.title] : $$("#sequences_list .playlist_sequence_title").map((x) => x.textContent.trim());
    const nowTitle = sv ? info.title : ($("#sequences_list a.current_sequence .playlist_sequence_title")?.textContent.trim() || titles[0] || "");
    const creators = new Set(sv ? [info.by?.textContent.trim().toLowerCase() || ""] : $$("#sequences_list .playlist_sequence_subtitle span").map((x) => x.textContent.trim().toLowerCase()).filter(Boolean));
    const ownerA = sv ? info.by : $(".playlist_title_wrapper a[href*='/members/']"), owner = { uid: (ownerA?.getAttribute("href") || "").replace(/\D/g, ""), name: ownerA?.textContent.trim() || "" };
    const me = (($('#member_username a[href*="/members/"]')?.getAttribute("href") || "").match(/\d+/) || [])[0] || "";
    const recent = (await store.get("osgRecent", null)) || { seqs: [], people: [] }, subsAll = (await store.get("osgSubs", {})) || {};
    const subs = ((subsAll[me] || {}).list || []).slice().sort((a, b) => (b.at || 0) - (a.at || 0));
    const avoid = new Set([...creators, owner.name.toLowerCase()].flatMap((n) => n.split(/\s+/)).filter(Boolean));
    // the words to look for: the playing song's own title first, then what this playlist and your recent plays share
    const kws = [...new Set([...keywords([nowTitle, nowTitle], avoid).slice(0, 1), ...keywords([...titles, ...recent.seqs.slice(0, 15).map((x) => x.t || "")], avoid)])].slice(0, 3);
    const other = [...subs.map((x) => ({ uid: x.uid, name: x.name, why: `You follow ${x.name}` })), ...recent.people.map((x) => ({ uid: x.uid, name: x.name, why: `You visited ${x.name}` }))]
      .find((x) => x.uid && x.uid !== owner.uid && x.uid !== me);
    // three shelves (each sequence on one shelf only), plus playlists
    const shelves = { like: new Map(), people: new Map(), popular: new Map() }, lists = new Map();
    const seen = () => new Set([...shelves.like.keys(), ...shelves.people.keys(), ...shelves.popular.keys()]);
    const score = (x) => (creators.has((x.by || "").toLowerCase()) ? 1 : 0) + kws.filter((k) => x.t.toLowerCase().includes(k)).length * 2;
    const add = (shelf, x, base, why) => { if (!x.id || inList.has(x.id)) return; const m = shelves[shelf], p = m.get(x.id); if (p) { p.score += base; return; } if (seen().has(x.id)) return; m.set(x.id, { ...x, score: base + score(x), why: [why] }); };
    const addList = (l, why) => { if ((isPL() && key === "pl:" + l.id) || lists.has(l.id)) return; lists.set(l.id, { ...l, why }); };
    recs = { shelves, lists, kws, owner, sv };
    const cap = (k) => k[0].toUpperCase() + k.slice(1);
    const jobs = [];
    for (const k of kws) jobs.push(async () => { const v = await readPage(`/sequences?search=${encodeURIComponent(k)}`, parseSearch); if (v) v.seqs.slice(0, 16).forEach((x) => add("like", x, 3, `“${cap(k)}”`)); });
    if (owner.uid) jobs.push(async () => { const v = await readPage(`/members/${owner.uid}?sort=2`, parseMember(owner.uid)); if (!v) return; v.seqs.slice(0, 16).forEach((x) => add("people", x, 2, sv ? `More from ${owner.name}` : `From ${owner.name}'s channel`)); v.lists.forEach((l) => addList(l, `${v.name || owner.name}'s playlist`)); });
    if (other) jobs.push(async () => { const v = await readPage(`/members/${other.uid}?sort=2`, parseMember(other.uid)); if (!v) return; v.seqs.slice(0, 12).forEach((x) => add("people", x, 2, other.why)); v.lists.forEach((l) => addList(l, other.why)); });
    jobs.push(async () => { const v = await readPage(`/sequences?sort=2&date=2`, parseSearch); if (v) v.seqs.slice(0, 20).forEach((x) => add("popular", x, 1 + (score(x) ? 2 : 0), "Popular this week")); });
    for (let i = 0; i < jobs.length; i++) { if (recsFor !== key) return; await jobs[i](); renderRecs(); if (i < jobs.length - 1) await new Promise((r) => setTimeout(r, 700)); }
    if (!seen().size && !lists.size) $(".osg-rc-body", box).innerHTML = `<div class="osg-rc-empty">Nothing to suggest right now — the site may be busy. It'll try again next time you open this page.</div>`;
  }
  function renderRecs() {
    const box = $("#osg-sc-recs"); if (!box || !recs) return;
    const pick = (m, n) => { const perBy = new Map(); return [...m.values()].sort((a, b) => b.score - a.score).filter((x) => { const k = (x.by || "").toLowerCase(), c = perBy.get(k) || 0; if (c >= 3) return false; perBy.set(k, c + 1); return true; }).slice(0, n); };
    let i = 0;
    const seqHtml = (x) => `<a class="osg-rc-seq" href="/${esc(x.id)}" style="--i:${Math.min(i++, 12)}">
        <span class="osg-rc-th" style="background-image:url(&quot;${esc(x.th || thumbOf(x.id))}&quot;)">${x.dur ? `<em>${esc(x.dur)}</em>` : ""}</span>
        <button type="button" class="osg-rc-add" data-osg-grp data-seq="${esc(x.id)}" data-t="${esc(x.t)}" title="Add to a playlist" aria-label="Add “${esc(x.t)}” to a playlist">＋</button>
        <span class="osg-rc-tx"><b>${esc(x.t)}</b><span>${esc(x.by || "")}${x.plays ? ` · ${esc(x.plays)} plays` : x.notes ? ` · ${esc(x.notes)}` : ""}</span><i>${esc(x.why[0])}</i></span></a>`;
    const listHtml = (l) => `<a class="osg-rc-list" href="/playlist/${esc(l.id)}#sc" style="--i:${Math.min(i++, 12)}" title="Play it in the Glow player">
        ${!l.ths.length && l.cover ? `<span class="osg-rc-mosaic cover" style="background-image:url(&quot;${esc(l.cover)}&quot;)"></span>`
          : `<span class="osg-rc-mosaic">${[0, 1, 2, 3].map((k) => l.ths[k] ? `<span style="background-image:url(&quot;${esc(l.ths[k])}&quot;)"></span>` : "<span></span>").join("")}${l.more ? `<em>${esc(l.more)}</em>` : ""}</span>`}
        <span class="osg-rc-tx"><b>${esc(l.t)}</b><span>${esc(l.by || "")}</span><i>${esc(l.why)}</i></span></a>`;
    const sec = (title, items, html) => (items.length ? `<h4>${esc(title)}</h4><div class="osg-rc-seqs">${items.map(html).join("")}</div>` : "");
    const like = pick(recs.shelves.like, 8), people = pick(recs.shelves.people, 6), popular = pick(recs.shelves.popular, 6), lists = [...recs.lists.values()].slice(0, 5);
    if (!like.length && !people.length && !popular.length && !lists.length) return;
    $(".osg-rc-body", box).innerHTML = sec(recs.sv ? "More like this" : "Like this playlist", like, seqHtml) + sec(recs.owner.name && !recs.sv ? "From creators you like" : `More from ${recs.owner.name || "this creator"} & people you like`, people, seqHtml)
      + sec("Popular this week", popular, seqHtml) + sec("Playlists", lists, listHtml);
  }

  // ---------------------------------------------------------------------------------------------------
  // Adding to a playlist you own: a panel instead of "paste a link" — search the site, your own sequences, what you
  // played lately and For you, one click each; links pasted or dragged in still work. Each add is the site's own.
  // ---------------------------------------------------------------------------------------------------
  let adder = null, adderTab = "search", adderQ = "", adderT = 0, adderGen = 0;
  const ownsPlaylist = () => isPL() && !!$("#add_sequence");
  const plId = () => (location.pathname.match(/\/playlist\/(\d+)/) || [])[1] || "";
  const inThis = (id) => !!document.getElementById("sequence_row_" + id);
  const idsIn = (text) => [...new Set([...String(text || "").matchAll(/(?:onlinesequencer\.net\/(?:playlist\/\d+\/)?|^|\s)(\d{3,9})(?=\b)/g)].map((m) => m[1]))];
  function closeAdder() { if (!adder) return; const a = adder; adder = null; a.classList.add("osg-adder-out"); setTimeout(() => a.remove(), calm() ? 0 : 260); }
  function openAdder() {
    if (adder) { $(".osg-ad-q", adder)?.focus(); return; }
    adder = document.createElement("aside"); adder.id = "osg-adder"; adder.setAttribute("role", "dialog"); adder.setAttribute("aria-label", "Add sequences to this playlist");
    const title = $("#playlist_title")?.textContent.trim() || "this playlist";
    adder.innerHTML = `<header><div><b>Add sequences</b><small>to ${esc(title)}</small></div><button type="button" class="osg-ad-x" aria-label="Close">✕</button></header>
      <div class="osg-ad-search"><input class="osg-ad-q" type="search" placeholder="Search sequences, or paste links…" aria-label="Search sequences, or paste links" autocomplete="off"></div>
      <div class="osg-ad-tabs" role="tablist">${[["search", "Search"], ["mine", "Yours"], ["recent", "Recent"], ["foryou", "For you"]].map(([k, t]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${k === adderTab}">${t}</button>`).join("")}</div>
      <div class="osg-ad-list" aria-live="polite"></div>
      <footer>Tip: drag sequence links from another tab onto this panel to add them.</footer>`;
    document.body.appendChild(adder);
    const q = $(".osg-ad-q", adder);
    for (const ev of ["keydown", "keyup", "keypress"]) adder.addEventListener(ev, (e) => { e.stopPropagation(); if (ev === "keydown" && e.key === "Escape") closeAdder(); });
    q.addEventListener("input", () => { adderQ = q.value; clearTimeout(adderT); adderT = setTimeout(renderAdder, adderTab === "search" ? 550 : 120); });
    adder.addEventListener("click", async (e) => {
      if (e.target.closest(".osg-ad-x")) { closeAdder(); return; }
      const tab = e.target.closest("[data-tab]"); if (tab) { adderTab = tab.dataset.tab; $$("[data-tab]", adder).forEach((b) => b.setAttribute("aria-selected", String(b === tab))); renderAdder(); return; }
      const b = e.target.closest(".osg-ad-add"); if (b) { e.preventDefault(); addOne(b.dataset.id, b); return; }
      const all = e.target.closest(".osg-ad-addall"); if (all) { const todo = $$(".osg-ad-add:not([disabled])", adder); if (todo.length > 5 && !confirm(`Add all ${todo.length} of these sequences to the playlist?`)) return; for (const x of todo) await addOne(x.dataset.id, x); }
    });
    adder.addEventListener("dragover", (e) => { e.preventDefault(); adder.classList.add("drop"); });
    adder.addEventListener("dragleave", (e) => { if (!adder.contains(e.relatedTarget)) adder.classList.remove("drop"); });
    adder.addEventListener("drop", async (e) => {
      e.preventDefault(); adder.classList.remove("drop");
      const ids = idsIn((e.dataTransfer.getData("text/uri-list") || "") + "\n" + (e.dataTransfer.getData("text/plain") || ""));
      if (!ids.length) { toastMsg("Those weren't sequence links."); return; }
      let n = 0; for (const id of ids) if ((await addOne(id)) === "added") n++;
      toastMsg(n ? `Added ${n} sequence${n === 1 ? "" : "s"}.` : "Nothing new to add — they're already in the playlist.");
      renderAdder();
    });
    renderAdder(); setTimeout(() => q.focus(), 60);
  }
  const toastMsg = (t) => { if (window.__osgToast) window.__osgToast(t); };
  async function addOne(id, btn) {
    if (inThis(id)) { if (btn) { btn.textContent = "In playlist"; btn.disabled = true; } return "already"; }
    if (btn) { btn.disabled = true; btn.textContent = "Adding…"; }
    const r = await ask("pladd", { pid: plId(), seq: id }, 20000);
    const st = r && r.state ? r.state : "failed";
    if (btn) { btn.textContent = st === "added" ? "✓ Added" : st === "already" ? "In playlist" : "Couldn't add"; btn.disabled = st !== "failed"; btn.closest(".osg-ad-row")?.classList.toggle("in", st !== "failed"); }
    if (st === "added") lazyThumbs();
    return st;
  }
  async function adderItems() {
    const f = adderQ.trim().toLowerCase(), filt = (list) => (f ? list.filter((x) => `${x.t} ${x.by || ""}`.toLowerCase().includes(f)) : list);
    if (adderTab === "search") {
      if (f.length < 2) return { note: "Type at least two letters to search every sequence on the site — or paste links to add them." };
      const v = await readPage(`/sequences?search=${encodeURIComponent(adderQ.trim())}`, parseSearch, 0);
      return v ? { items: v.seqs } : { note: "Couldn't search right now — the site may be busy. Try again in a moment." };
    }
    if (adderTab === "mine") {
      const uid = ((($('#member_username a[href*="/members/"]')?.getAttribute("href")) || "").match(/\d+/) || [])[0]; if (!uid) return { note: "Sign in to see your sequences." };
      const v = await readPage(`/members/${uid}`, parseMember(uid, true), 0);
      return v ? { items: filt(v.seqs) } : { note: "Couldn't read your sequences right now." };
    }
    if (adderTab === "recent") {
      const r = (await store.get("osgRecent", null)) || { seqs: [] };
      return { items: filt(r.seqs.map((x) => ({ id: x.id, t: x.t || "#" + x.id, by: x.by || "", th: "" }))), empty: "Sequences you open show up here." };
    }
    const all = recs ? [...recs.shelves.like.values(), ...recs.shelves.people.values(), ...recs.shelves.popular.values()] : [];
    return { items: filt(all), empty: "Open the Glow player view once and For you fills this in." };
  }
  async function renderAdder() {
    if (!adder) return; const gen = ++adderGen, list = $(".osg-ad-list", adder);
    const pasted = idsIn(adderQ).filter((id) => /onlinesequencer\.net|^\s*[\d\s,]+\s*$/.test(adderQ));
    list.innerHTML = `<div class="osg-ad-note">Loading…</div>`;
    const r = await adderItems(); if (gen !== adderGen || !adder) return;
    const rows = (r.items || []).filter((x) => x && x.id);
    const head = pasted.length ? `<div class="osg-ad-pasted">${pasted.map((id) => `<div class="osg-ad-row${inThis(id) ? " in" : ""}"><span class="osg-ad-th"></span><span class="osg-ad-tx"><b>Sequence #${esc(id)}</b><small>from the link you pasted</small></span><button type="button" class="osg-ad-add" data-id="${esc(id)}"${inThis(id) ? " disabled" : ""}>${inThis(id) ? "In playlist" : "＋ Add"}</button></div>`).join("")}</div>` : "";
    list.innerHTML = head + (rows.length ? (rows.length > 3 ? `<button type="button" class="osg-ad-addall">＋ Add all ${rows.filter((x) => !inThis(x.id)).length} shown</button>` : "") + rows.slice(0, 120).map((x, i) => `<div class="osg-ad-row${inThis(x.id) ? " in" : ""}" style="--i:${Math.min(i, 14)}">
        <a class="osg-ad-th" href="/${esc(x.id)}" target="_blank" rel="noopener" style="background-image:url(&quot;${esc(x.th || thumbOf(x.id))}&quot;)" title="Open it in a new tab"></a>
        <span class="osg-ad-tx"><b>${esc(x.t)}</b><small>${esc(x.by || "")}${x.dur ? ` · ${esc(x.dur)}` : ""}${x.plays ? ` · ${esc(x.plays)} plays` : ""}</small></span>
        <button type="button" class="osg-ad-add" data-id="${esc(x.id)}"${inThis(x.id) ? " disabled" : ""}>${inThis(x.id) ? "In playlist" : "＋ Add"}</button></div>`).join("")
      : `<div class="osg-ad-note">${esc(r.note || (adderQ.trim() ? "Nothing matches." : r.empty || "Nothing here yet."))}</div>`);
  }
  // the site's own "add" row on your playlist opens the panel instead of asking for a link
  document.addEventListener("click", (e) => {
    if (!enabled || !isPL()) return;
    const row = e.target.closest("#add_sequence"); if (!row) return;
    e.preventDefault(); e.stopPropagation(); openAdder();
  }, true);

  function apply(q) {
    enabled = !q || q.scPlaylists !== false; recsOn = !q || q.scRecs !== false; autoNextOn = !q || q.autoNext !== false;
    document.body.classList.toggle("osg-recs", enabled && recsOn && (isPL() || isSV()));
    if (isSV()) {
      if (enabled) { buildSwitch(); sw.hidden = false; setView(view(), false); }
      else { document.body.classList.remove("osg-sc", "osg-sv", "osg-sv-edit", "osg-sc-playing"); if (sw) sw.hidden = true; }
      svAutoNext();
    }
    if (page() === "page_playlist" && $("#playlist_page")) {
      if (enabled) { buildSwitch(); sw.hidden = false; setView(view(), false); }
      else { const st = document.body.classList.contains("osg-st"); document.body.classList.remove("osg-sc", "osg-st", "osg-sc-playing"); if (sw) sw.hidden = true; if (st) nudge(); }
    }
    if (page() === "page_members") { if (enabled) playlistHovers(); $$(".osg-pl-hover").forEach((h) => (h.hidden = !enabled)); }
  }
  try { chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.qol) apply(ch.qol.newValue || {}); }); } catch (e) {}
  addEventListener("hashchange", () => { if ((isPL() || isSV()) && enabled && HASHES.includes(location.hash)) setView(location.hash.slice(1), !isSV()); });   // a link to the editor on a sequence page is for this visit only
  async function boot() {
    apply((await store.get("qol", {})) || {});
    if (isPL() || isSV()) setInterval(() => refresh(false), 250);
    if (isSV()) { let was = editing(); new MutationObserver(() => { const now = editing(); if (now !== was && enabled) { was = now; setView(view(), false); nudge(); } }).observe($("#frame_wrapper"), { attributes: true, attributeFilter: ["class"] }); }
    if (page() === "page_members") new MutationObserver(() => { if (enabled) playlistHovers(); }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
