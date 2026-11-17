// Glow Theme — the Glow layout for onlinesequencer.net (not the editor): a top bar with search, a sidebar, framed cards.
// Top bar with a centred search box, a left sidebar (with the people you're subscribed to),
// video-style sequence cards and channel-style profiles with tabs. Switch: popup → Quality of life.
(function () {
  "use strict";
  if (window.top !== window || window.__osgYt) return; window.__osgYt = true;

  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const send = (msg) => new Promise((res) => { try { chrome.runtime.sendMessage(msg, (r) => { void chrome.runtime.lastError; res(r || null); }); } catch (e) { res(null); } });
  const store = {
    get: (k, d) => new Promise((res) => { try { chrome.storage.local.get({ [k]: d }, (v) => res(chrome.runtime.lastError ? d : v[k])); } catch (e) { res(d); } }),
    set: (k, v) => { try { chrome.storage.local.set({ [k]: v }); } catch (e) {} },
  };
  const page = () => (document.body ? document.body.id : "");
  const memberIdHere = () => (location.pathname.match(/^\/members\/(\d+)/) || [])[1] || "";
  const eligible = () => page() !== "page_view" && !!$("#header #nav") && !!$("#main");
  const wide = () => innerWidth >= 1200;

  // ---------------------------------------------------------------------------------------------------
  // avatars: the forum keeps them at /forum/uploads/avatars/avatar_<uid>.<ext>; the extension differs per person,
  // so try the common ones once and remember what worked (or that there's none → coloured initial)
  // ---------------------------------------------------------------------------------------------------
  const AV_KEY = "osg-av", EXTS = ["jpg", "png", "gif", "jpeg", "webp"];
  let avMap = null;
  const avAll = () => { if (!avMap) { try { avMap = JSON.parse(localStorage.getItem(AV_KEY) || "{}"); } catch (e) { avMap = {}; } } return avMap; };
  let avT = 0;
  function avPut(uid, ext) { const m = avAll(); if (m[uid] === ext) return; m[uid] = ext; clearTimeout(avT); avT = setTimeout(() => { const k = Object.keys(m); if (k.length > 3000) k.slice(0, k.length - 2500).forEach((x) => delete m[x]); try { localStorage.setItem(AV_KEY, JSON.stringify(m)); } catch (e) {} }, 600); }
  function learnAvatar(uid, url) { const m = String(url || "").match(/avatar_(\d+)\.(\w+)/); if (m && m[1] === String(uid)) avPut(uid, m[2].toLowerCase()); }
  function avatarEl(uid, name, cls) {
    const el = document.createElement("span"); el.className = "osg-av" + (cls ? " " + cls : "");
    const n = (String(name || "").trim() || "?").replace(/^[^\p{L}\p{N}]+/u, "") || "?";
    el.textContent = n.slice(0, 1).toUpperCase(); el.style.setProperty("--h", (+uid * 47) % 360);
    const known = avAll()[uid]; if (known === "-" || !uid) return el;
    const order = known ? [known, ...EXTS.filter((e) => e !== known)] : EXTS;
    const img = document.createElement("img"); img.alt = ""; img.loading = "lazy"; img.decoding = "async";
    let i = 0; const next = () => { if (i >= order.length) { img.remove(); avPut(uid, "-"); return; } img.src = `/forum/uploads/avatars/avatar_${uid}.${order[i++]}`; };
    img.addEventListener("error", next); img.addEventListener("load", () => avPut(uid, order[i - 1]));
    next(); el.appendChild(img); return el;
  }

  // ---------------------------------------------------------------------------------------------------
  // who's signed in (read from the site's own header) and who they're subscribed to
  // ---------------------------------------------------------------------------------------------------
  function me() {
    const um = $("#user_member"); if (!um || getComputedStyle(um).display === "none") return null;
    const a = $('#member_username a[href*="/members/"]'); const uid = a ? (a.getAttribute("href").match(/\d+/) || [])[0] : "";
    return uid && uid !== "0" ? { uid, name: a.textContent.trim() } : null;
  }
  const SUBS = "osgSubs";   // { [myUid]: { list: [{ uid, name, at, src }], feedAt, subs, name } }
  async function subsOf(uid) { const all = (await store.get(SUBS, {})) || {}; return all[uid] || { list: [] }; }
  async function saveSubs(uid, rec) { const all = (await store.get(SUBS, {})) || {}; all[uid] = rec; store.set(SUBS, all); }
  // the site's Subscriptions feed (sequences by people you follow) names everyone who's posted
  async function refreshFromFeed(m) {
    const rec = await subsOf(m.uid); if (Date.now() - (rec.feedAt || 0) < 30 * 60e3) return false;
    const found = new Map();
    for (let p = 1; p <= 4; p++) {
      let html = ""; try { html = await (window.__osgNet ? window.__osgNet.fetch : fetch)("/ajax/sequences.php", { method: "POST", body: new URLSearchParams({ type: "4", date: "4", page: String(p) }) }, 2).then((r) => (r.ok ? r.text() : "")); } catch (e) { break; }
      const doc = new DOMParser().parseFromString(html, "text/html"); const cards = $$(".sequence-card", doc); if (!cards.length) break;
      for (const c of cards) { const a = c.querySelector('.sequence-author a[href*="/members/"]'); if (!a) continue; const uid = a.getAttribute("href").replace(/\D/g, ""); if (uid && uid !== m.uid && !found.has(uid)) found.set(uid, a.textContent.trim()); }
      if (cards.length < 30) break; await new Promise((r) => setTimeout(r, 200));
    }
    const list = rec.list || []; let changed = false;
    for (const [uid, name] of found) { const x = list.find((y) => y.uid === uid); if (x) { if (name && x.name !== name) { x.name = name; changed = true; } } else { list.push({ uid, name, at: Date.now(), src: "feed" }); changed = true; } }
    await saveSubs(m.uid, { ...rec, list, feedAt: Date.now() });
    return changed;
  }
  // on someone's profile the site's own Subscribe button says whether you follow them
  function watchSubscribeButton(m) {
    const btn = $("#profile-button-subscribe"), uid = memberIdHere(); if (!btn || !uid || uid === m.uid) return;
    const name = $(".profile_header .name")?.textContent.trim() || "";
    let last = null;
    const check = async () => {
      const on = btn.classList.contains("enabled"); if (on === last) return; last = on;
      const rec = await subsOf(m.uid); const list = (rec.list || []).filter((x) => x.uid !== uid);
      if (on) list.push({ uid, name, at: Date.now(), src: "profile" });
      const had = (rec.list || []).some((x) => x.uid === uid); if (had === on && on === false) return;
      await saveSubs(m.uid, { ...rec, list }); renderSide();
    };
    check(); new MutationObserver(check).observe(btn, { attributes: true, attributeFilter: ["class"] });
  }
  function learnMe(m) {   // your own profile: remember your subscriber count for the sidebar
    if (memberIdHere() !== m.uid) return;
    const s = ($(".profile_header .subscriber-count")?.textContent || "").trim() || "No subscribers yet";
    subsOf(m.uid).then((rec) => { if (rec.subs !== s || rec.name !== m.name) saveSubs(m.uid, { ...rec, subs: s, name: m.name }).then(renderSide); });
  }

  // ---------------------------------------------------------------------------------------------------
  // top bar + sidebar
  // ---------------------------------------------------------------------------------------------------
  const I = {   // simple line icons (24 × 24)
    menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
    edit: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h3M7 13h6M7 17h2M14 9h3"/>',
    seqs: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    hot: '<path d="M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3-.5-3 0-6 1-8.5z"/>',
    subs: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M6 4h12M10 11l5 2.5-5 2.5z"/>',
    me: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
    hist: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    lib: '<path d="M4 4h4v16H4zM10 4h4v16h-4zM16 5l3.5-1 3 15.5-3.5.8z"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/>',
    cmt: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
    members: '<circle cx="9" cy="9" r="3.5"/><path d="M2.5 20c1-3.5 3.5-5 6.5-5s5.5 1.5 6.5 5"/><circle cx="17" cy="8" r="2.5"/><path d="M16 14c3 0 5 1.5 5.5 4.5"/>',
    forum: '<path d="M3 4h13v9H8l-5 4z"/><path d="M8 16v1h8l5 4V9h-3"/>',
    wiki: '<path d="M4 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4zM20 4h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    chev: '<path d="M9 6l6 6-6 6"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
  };
  const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${I[k]}</svg>`;

  let side = null, scrim = null, built = false, subsExpanded = false;
  function here(href) {
    const u = new URL(href, location.origin); if (u.origin !== location.origin) return false;
    if (u.pathname !== location.pathname) return false;
    const a = new URLSearchParams(u.search), b = new URLSearchParams(location.search);
    for (const k of ["type", "sort"]) if ((a.get(k) || "") !== (b.get(k) || "")) return false;
    return true;
  }
  function item(href, icon, label, extra = "") {
    const isBtn = href.startsWith("#");
    return isBtn ? `<button type="button" class="osg-ys-item" data-act="${href.slice(1)}" ${extra}>${svg(icon)}<span>${esc(label)}</span></button>`
      : `<a class="osg-ys-item${here(href) ? " on" : ""}" href="${esc(href)}" ${extra}>${svg(icon)}<span>${esc(label)}</span></a>`;
  }
  async function renderSide() {
    if (!side) return;
    const m = me(); const rec = m ? await subsOf(m.uid) : { list: [] };
    const subs = (rec.list || []).slice().sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" }));
    const shown = subsExpanded ? subs : subs.slice(0, 7);
    side.innerHTML = `
      <nav class="osg-ys-main" aria-label="Main">
        ${item("/", "edit", "Editor")}
        ${item("/sequences", "seqs", "Sequences")}
        ${item("/sequences?sort=2&date=2", "hot", "Popular")}
        ${m ? item("/sequences?type=4&date=4", "subs", "Following") : ""}
      </nav>
      <div class="osg-ys-hr"></div>
      ${m ? `<a class="osg-ys-sec" href="/members/${m.uid}"><span>Your studio</span>${svg("chev")}</a>
        <div class="osg-ys-you"><span class="osg-ys-me"></span><span><b>${esc(m.name)}</b><small>${esc(rec.subs || "View your channel")}</small></span></div>
        ${item("/members/" + m.uid, "me", "Your channel")}` : `<p class="osg-ys-note">Sign in to see who you follow here.</p>`}
      ${item("#history", "hist", "History")}
      ${item("#library", "lib", "Sequence library")}
      ${item("#comments", "cmt", "Your comments")}
      ${m ? `<div class="osg-ys-hr"></div><div class="osg-ys-sec osg-ys-static"><span>Following</span></div>
        <div class="osg-ys-subs">${shown.map((x) => `<a class="osg-ys-item osg-ys-sub${memberIdHere() === x.uid ? " on" : ""}" href="/members/${esc(x.uid)}" data-uid="${esc(x.uid)}" data-name="${esc(x.name)}" title="${esc(x.name)}"><span class="osg-ys-avslot"></span><span>${esc(x.name || "#" + x.uid)}</span></a>`).join("")}</div>
        ${subs.length > 7 ? `<button type="button" class="osg-ys-item" data-act="more">${svg("down")}<span>${subsExpanded ? "Show fewer" : `Show ${subs.length - 7} more`}</span></button>` : ""}
        ${subs.length ? "" : `<p class="osg-ys-note">People you follow (subscribe to) show up here once they post, or when you open their profile.</p>`}` : ""}
      <div class="osg-ys-hr"></div><div class="osg-ys-sec osg-ys-static"><span>Community</span></div>
      ${item("/memberlist", "members", "Members")}
      ${item("#chat", "chat", "Chat")}
      ${item("/forum/", "forum", "Forum")}
      ${item("/wiki/", "wiki", "Wiki", 'target="_blank" rel="noopener"')}
      <p class="osg-ys-foot">Layout by Glow Theme · switch it off in the extension's popup</p>`;
    for (const s of $$(".osg-ys-sub", side)) s.querySelector(".osg-ys-avslot").replaceWith(avatarEl(s.dataset.uid, s.dataset.name));
    const meSlot = $(".osg-ys-me", side); if (meSlot && m) meSlot.replaceWith(avatarEl(m.uid, m.name, "osg-av-lg"));
    for (const s of $$(".osg-ys-main .osg-ys-item", side)) s.title = s.textContent.trim();
  }
  function onSideClick(e) {
    const b = e.target.closest("[data-act]"); if (!b) { if (e.target.closest("a") && !wide()) document.body.classList.remove("osg-yt-open"); return; }
    const act = b.dataset.act; e.preventDefault();
    if (act === "more") { subsExpanded = !subsExpanded; renderSide(); return; }
    if (act === "library") send({ type: "open:library" });
    else if (act === "comments") send({ type: "open:comments" });
    else if (act === "chat") { const c = $("a.chat_link"); if (c) c.click(); else location.href = "/"; }
    else if (act === "history") document.dispatchEvent(new CustomEvent("osg:open-recent", { detail: { rect: b.getBoundingClientRect().toJSON() } }));
    if (!wide()) document.body.classList.remove("osg-yt-open");
  }
  function toggleMenu() {
    const b = document.body;
    if (wide()) {   // the sidebar folds / unfolds and the page slides with it (theme.css: html.osg-vt)
      const flip = () => { const mini = b.classList.toggle("osg-yt-mini"); try { localStorage.setItem("osg-yt-mini", mini ? "1" : "0"); } catch (e) {} };
      const m = window.__osgMotion; if (m) m.smooth(flip); else flip();
    }
    else b.classList.toggle("osg-yt-open");
  }
  function build() {
    if (built || !eligible()) return; built = true;
    const b = document.body; b.classList.add("osg-yt");
    try { if (localStorage.getItem("osg-yt-mini") === "1") b.classList.add("osg-yt-mini"); } catch (e) {}
    const nav = $("#header #nav");
    const menu = document.createElement("button"); menu.type = "button"; menu.id = "osg-yt-menu"; menu.setAttribute("aria-label", "Menu"); menu.title = "Menu"; menu.innerHTML = svg("menu");
    menu.addEventListener("click", toggleMenu); nav.insertBefore(menu, nav.firstChild);
    const q = new URLSearchParams(location.search).get("search") || "";
    const form = document.createElement("form"); form.id = "osg-yt-search"; form.setAttribute("role", "search");
    form.innerHTML = `<input type="search" name="osg-q" placeholder="Search sequences" aria-label="Search sequences" value="${esc(q)}" autocomplete="off"><button type="submit" aria-label="Search" title="Search">${svg("search")}</button>`;
    form.addEventListener("submit", (e) => {
      e.preventDefault(); const v = form.querySelector("input").value.trim(); if (!v) return;
      const siteInput = $('.sequence-search input[name="search"]'), siteBtn = $(".sequence-search-button");
      if (page() === "page_sequences" && siteInput && siteBtn) { siteInput.value = v; siteBtn.click(); }   // the site's own search, no reload
      else location.href = "/sequences?" + new URLSearchParams({ search: v });
    });
    ($("#logo") || menu).insertAdjacentElement("afterend", form);
    side = document.createElement("aside"); side.id = "osg-yt-side"; side.setAttribute("aria-label", "Sidebar");
    side.addEventListener("click", onSideClick); b.appendChild(side);
    scrim = document.createElement("div"); scrim.id = "osg-yt-scrim"; scrim.addEventListener("click", () => b.classList.remove("osg-yt-open")); b.appendChild(scrim);
    renderSide();
    // your avatar in the top bar
    const um = $("#member_username"); const m = me();
    if (um && m && !$("#osg-yt-me")) { const a = document.createElement("a"); a.id = "osg-yt-me"; a.href = "/members/" + m.uid; a.title = m.name; a.appendChild(avatarEl(m.uid, m.name)); um.insertAdjacentElement("beforebegin", a); }
    if (page() === "page_sequences") seqPage();
    if (page() === "page_memberlist") { const i = $('#page_left form.search input[name="search"]'); if (i && !i.placeholder) i.placeholder = "Search members"; }
    if (page() === "page_members" && memberIdHere()) channel();
  }
  function teardown() {
    if (!built) return; built = false;
    const b = document.body; b.classList.remove("osg-yt", "osg-yt-mini", "osg-yt-open"); delete b.dataset.osgTab;
    for (const id of ["osg-yt-menu", "osg-yt-search", "osg-yt-side", "osg-yt-scrim", "osg-yt-me", "osg-yt-tabs"]) document.getElementById(id)?.remove();
    side = scrim = null;
  }

  // ---------------------------------------------------------------------------------------------------
  // Sequences pages: video-style cards (avatar, duration badge), filters as chips
  // ---------------------------------------------------------------------------------------------------
  function ytCards(root = document) {
    for (const c of $$(".sequence-card:not([data-osg-yt])", root)) {
      c.dataset.osgYt = "1";
      const det = c.querySelector(".sequence-details"), thumb = c.querySelector("a"); if (!det || !thumb) continue;
      const a = c.querySelector('.sequence-author a[href*="/members/"]');
      if (a) { const uid = a.getAttribute("href").replace(/\D/g, ""); const link = document.createElement("a"); link.className = "osg-yt-av"; link.href = "/members/" + uid; link.title = a.textContent.trim(); link.appendChild(avatarEl(uid, a.textContent)); det.insertBefore(link, det.firstChild); }
      else c.classList.add("osg-yt-noav");
      const items = [...c.querySelectorAll(".sequence-details-item")], pick = (cls) => items.find((x) => x.querySelector(cls));
      const clock = pick(".fa-clock");
      if (clock) { clock.classList.add("osg-yt-durcell"); const d = document.createElement("span"); d.className = "osg-yt-dur"; d.textContent = clock.textContent.trim(); thumb.appendChild(d); }
      // YouTube-style lines: the creator, then "1,625 notes · 12 plays · 3 minutes ago"
      const num = (el) => (el ? el.textContent.trim() : ""), plural = (n, w) => `${n} ${w}${n.replace(/\D/g, "") === "1" ? "" : "s"}`;
      const when = (c.querySelector(".sequence-author")?.textContent || "").replace(/^\s*by\s+/, "").replace(a ? a.textContent : "", "").trim();
      const parts = [num(pick(".fa-music")) && plural(num(pick(".fa-music")), "note"), num(pick(".fa-play")) && plural(num(pick(".fa-play")), "play"), num(pick(".fa-comment")) && plural(num(pick(".fa-comment")), "comment"), when].filter(Boolean);
      if (a || parts.length) {
        const by = document.createElement("div"); by.className = "osg-yt-by";
        if (a) { const l = a.cloneNode(true); by.appendChild(l); }
        const meta = document.createElement("div"); meta.className = "osg-yt-meta"; meta.textContent = parts.join(" · ");
        det.append(by, meta); c.classList.add("osg-yt-lines");
      }
    }
  }
  function seqPage() {
    const list = $(".sequences-list"); if (!list) return;
    ytCards(list);
    new MutationObserver(() => { if (built) ytCards(list); }).observe(list, { childList: true });
  }

  // ---------------------------------------------------------------------------------------------------
  // profiles: channel header + tabs (Home / Sequences / Featured / Playlists)
  // ---------------------------------------------------------------------------------------------------
  // one meta line like a channel header, and long bios folded with "…more" — nicer in both layouts
  function channelHeader() {
    const det = $(".profile_header .details");
    if (det && !det.dataset.osgYt) {
      det.dataset.osgYt = "1"; document.body.classList.add("osg-chan");
      for (const n of [...det.childNodes]) if (n.nodeType === 3 && n.textContent.trim()) { const sp = document.createElement("span"); sp.className = "osg-yt-txt"; n.replaceWith(sp); sp.appendChild(n); }
      const dots = () => { let first = true; for (const el of det.children) { if (el.tagName === "BR" || el.classList.contains("name")) continue; const has = !!el.textContent.trim(); el.classList.toggle("osg-yt-dot", has && !first); if (has) first = false; } };
      dots(); new MutationObserver(dots).observe(det, { childList: true, subtree: true, characterData: true });
    }
    const right = $(".profile_header_right"), bio = $("#bio-text");
    if (right && bio && !$(".osg-yt-more", right)) {
      const check = () => {
        if ($(".osg-yt-more", right) || bio.scrollHeight <= bio.clientHeight + 4) return;
        const more = document.createElement("button"); more.type = "button"; more.className = "osg-yt-more"; more.textContent = "…more";
        more.addEventListener("click", () => { const open = right.classList.toggle("osg-bio-open"); more.textContent = open ? "Show less" : "…more"; });
        right.appendChild(more);
      };
      requestAnimationFrame(check); setTimeout(check, 800);
    }
  }
  function channel() {
    const top = $("#page_top"); if (!top) return;
    const avStyle = $(".profile_avatar_image")?.getAttribute("style"); if (avStyle) learnAvatar(memberIdHere(), avStyle);
    const tabs = [["home", "Home"], ["sequences", "Sequences"]];
    for (const blk of $$(":scope > .block", top)) {
      const t = (blk.querySelector(".btitle")?.textContent || "").trim().toLowerCase();
      if (t.startsWith("featured")) { blk.classList.add("osg-blk-featured"); tabs.push(["featured", "Featured"]); }
      else if (t.startsWith("playlist")) { blk.classList.add("osg-blk-playlists"); tabs.push(["playlists", "Playlists"]); }
    }
    if (!$("#osg-yt-tabs")) {
      const bar = document.createElement("div"); bar.id = "osg-yt-tabs"; bar.setAttribute("role", "tablist");
      bar.innerHTML = tabs.map(([k, t]) => `<button type="button" role="tab" data-tab="${k}">${t}</button>`).join("");
      const pb = $(".profile_banner", top);
      if (pb) pb.insertAdjacentElement("afterend", bar); else top.insertBefore(bar, top.firstChild);
      const set = (k, scroll) => {
        if (!tabs.some((t) => t[0] === k)) k = "home";
        document.body.dataset.osgTab = k; $$("button", bar).forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === k)));
        history.replaceState(null, "", location.pathname + location.search + (k === "home" ? "" : "#" + k));
        if (scroll && bar.getBoundingClientRect().top < 56) bar.scrollIntoView({ block: "start" });
      };
      bar.addEventListener("click", (e) => {   // the highlight glides to the new tab and the page crossfades (theme.css: html.osg-vt)
        const b = e.target.closest("[data-tab]"); if (!b || b.getAttribute("aria-selected") === "true") return;
        const m = window.__osgMotion; if (m) m.smooth(() => set(b.dataset.tab, true)); else set(b.dataset.tab, true);
      });
      // the Stats & history panel gets its own tab, and the tabs stay right under the channel header
      const fixStats = () => {
        const stats = $("#osg-profile-stats"); if (!stats) return;
        if (stats.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING) stats.before(bar);
        if (!tabs.some((t) => t[0] === "stats")) { tabs.push(["stats", "Stats"]); bar.insertAdjacentHTML("beforeend", `<button type="button" role="tab" data-tab="stats" aria-selected="false">Stats</button>`); if (location.hash === "#stats") set("stats", false); }
      };
      fixStats(); new MutationObserver(fixStats).observe(top, { childList: true });
      set(location.hash.slice(1) || "home", false);
    }
  }

  // ---------------------------------------------------------------------------------------------------
  let on = false;
  async function apply(q) {
    const want = !q || q.ytLayout !== false;
    if (want === on && (built || !want)) return; on = want;
    if (want) build(); else teardown();
  }
  addEventListener("resize", () => { if (wide()) document.body.classList.remove("osg-yt-open"); });
  try { chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.qol) apply(ch.qol.newValue || {}); if (area === "local" && ch[SUBS] && built) renderSide(); }); } catch (e) {}
  async function boot() {
    if (page() === "page_members" && memberIdHere()) channelHeader();
    await apply((await store.get("qol", {})) || {});
    // the site fills in who's signed in a moment after load
    let tries = 0; const t = setInterval(async () => {
      const m = me(); if (!m && ++tries < 20) return; clearInterval(t); if (!m) return;
      if (built) { renderSide(); if (!$("#osg-yt-me")) { const um = $("#member_username"); if (um) { const a = document.createElement("a"); a.id = "osg-yt-me"; a.href = "/members/" + m.uid; a.title = m.name; a.appendChild(avatarEl(m.uid, m.name)); um.insertAdjacentElement("beforebegin", a); } } }
      watchSubscribeButton(m); learnMe(m);
      if (await refreshFromFeed(m)) renderSide();
    }, 400);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
