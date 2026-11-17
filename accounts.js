// Glow Theme for Online Sequencer — account switcher in the site header, and your comment index.
// Runs in the extension's isolated world (the page's own scripts can't see it) in the top frame of onlinesequencer.net.
//  - Tells the background worker who is signed in, so it can keep that account's sign-in for switching.
//  - Next to "Welcome back NAME" (or the Login button) adds a menu: your saved accounts, Add account, Search my comments.
//  - Whenever a Comments panel loads, your comments in it go into the index for the comment search.
(function () {
  "use strict";
  if (window.top !== window || window.__osgAccounts) return; window.__osgAccounts = true;
  const send = (msg) => new Promise((res) => { try { chrome.runtime.sendMessage(msg, (r) => { void chrome.runtime.lastError; res(r || null); }); } catch (e) { res(null); } });
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (s, r = document) => r.querySelector(s);
  const shown = (el) => !!el && getComputedStyle(el).display !== "none" && el.offsetParent !== null;
  const seqId = () => (location.pathname.match(/^\/(\d+)\/?$/) || [])[1] || "";
  function seqTitle() {
    const og = $('meta[property="og:title"]')?.getAttribute("content");
    return (og || document.title || "").replace(/\s*[|-]\s*[^|]*Online Sequencer\s*$/i, "").replace(/\s*\|\s*[^|]*$/, "").trim();
  }

  // ---------- who is signed in ----------
  function headerState() {
    const a = $('#member_username a[href*="/members/"]'); const uid = a ? (a.getAttribute("href").match(/\/members\/(\d+)/) || [])[1] || "" : "";
    if (uid && uid !== "0" && shown($("#user_member"))) return { state: "member", uid, name: a.textContent.trim() };
    if (shown($("#user_guest"))) return { state: "guest", uid: "", name: "" };
    return null;   // not settled yet (the header fills in after load) or not a page with the site header
  }
  let last = null, info = { accounts: [], current: "", adding: false };
  async function report(st) {
    const cookieNames = document.cookie.split(";").map((x) => x.split("=")[0].trim()).filter(Boolean);   // names only
    const r = await send({ type: "acc:state", ...st, cookieNames });
    if (r && r.error) { if (!report.warned) { report.warned = true; toast(r.error, 12); } return; }
    if (!r || r.reloading) return;
    info = r; render();
    if (r.notice) toast(r.notice);
    if (r.adding && st.state === "guest") startAdding();
  }
  function watchHeader() {
    const check = () => {
      const st = headerState(); if (!st) return;
      const key = st.state + ":" + st.uid; if (last && last.key === key) return;
      const prev = last; last = { ...st, key };
      if (prev && prev.state === "member" && st.state === "guest") send({ type: "acc:loggedOut", uid: prev.uid });   // the site's Log out
      report(st);
    };
    const host = $("#user_member")?.parentElement; if (!host) return false;
    new MutationObserver(check).observe(host, { subtree: true, childList: true, attributes: true, attributeFilter: ["style", "href"], characterData: true });
    // a signed-in header is filled in shortly after load; give it a moment before taking "guest" for an answer
    let n = 0; const t = setInterval(() => { const st = headerState(); if (st && (st.state === "member" || ++n > 6)) { clearInterval(t); check(); } }, 400);
    return true;
  }

  // ---------- the menu ----------
  let btn = null, menu = null, manage = false;
  const avatar = (x) => x.avatar ? `<span class="osg-acc-av" style="background-image:url('${esc(new URL(x.avatar, location.origin).href)}')"></span>` : `<span class="osg-acc-av osg-acc-av-letter">${esc((x.name || "?").slice(0, 1).toUpperCase())}</span>`;
  function render() {
    const member = last && last.state === "member";
    const anchor = member ? $("#member_username") : $("#login_button"); if (!anchor) return;
    if (!btn || !document.contains(btn)) {
      btn = document.createElement("button"); btn.type = "button"; btn.id = "osg-acc-btn"; btn.setAttribute("aria-haspopup", "menu");
      btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); menu ? closeMenu() : openMenu(); });
    }
    if (btn.previousElementSibling !== anchor) anchor.insertAdjacentElement("afterend", btn);
    const others = info.accounts.filter((x) => !x.current).length;
    btn.title = member ? "Switch account" : "Sign in as a saved account";
    btn.innerHTML = member ? `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>${others ? `<span class="osg-acc-count">${others}</span>` : ""}`
      : `Accounts<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    btn.classList.toggle("guest", !member);
    btn.hidden = !member && !info.accounts.length;   // nothing to offer a guest until an account has been saved
    if (menu) openMenu();
  }
  function openMenu() {
    const member = last && last.state === "member";
    if (!menu) { menu = document.createElement("div"); menu.id = "osg-acc-menu"; menu.setAttribute("role", "menu"); document.body.appendChild(menu); menu.addEventListener("click", onMenu); }
    const list = [...info.accounts].sort((p, q) => (q.current - p.current) || (q.usedAt - p.usedAt) || p.name.localeCompare(q.name));
    menu.innerHTML = `<div class="osg-acc-head">${member ? "Switch account" : "Sign in as"}${list.length ? `<button type="button" class="osg-acc-link" data-act="manage">${manage ? "Done" : "Manage"}</button>` : ""}</div>
      <div class="osg-acc-list">${list.map((x) => `<div class="osg-acc-row${x.current ? " current" : ""}${x.signedOut ? " out" : ""}" role="menuitem" tabindex="0" data-act="switch" data-uid="${esc(x.uid)}" title="${x.current ? "Signed in" : x.signedOut ? "Signed out — add it again to switch to it" : "Switch to " + esc(x.name)}">${avatar(x)}<span class="osg-acc-name">${esc(x.name || "Account " + x.uid)}<small>${x.current ? "Signed in" : x.signedOut ? "Signed out" : "#" + esc(x.uid)}</small></span>${x.current ? `<span class="osg-acc-check">✓</span>` : ""}${manage ? `<button type="button" class="osg-acc-x" data-act="remove" data-uid="${esc(x.uid)}" title="Forget this account here (doesn't sign it out)">✕</button>` : ""}</div>`).join("") || `<div class="osg-acc-empty">No saved accounts yet. Your current account is saved automatically; add another to switch between them.</div>`}</div>
      <div class="osg-acc-actions">
        <button type="button" data-act="add"><span>＋</span>Add account</button>
        <button type="button" data-act="comments"><span>⌕</span>Search my comments</button>
        ${document.getElementById("sequencer") ? `<button type="button" data-act="libsave"><span>★</span>Save this sequence to my library</button>` : ""}
        <button type="button" data-act="library"><span>▤</span>My sequence library</button>
      </div>
      <div class="osg-acc-foot">Sign-ins stay in this browser, inside the extension. Passwords are never saved.</div>`;
    btn.setAttribute("aria-expanded", "true");
    const r = btn.getBoundingClientRect();
    menu.style.top = Math.round(r.bottom + 6) + "px"; menu.style.left = Math.round(Math.max(8, Math.min(innerWidth - menu.offsetWidth - 8, r.right - menu.offsetWidth))) + "px";
  }
  function closeMenu() { if (menu) { const m = window.__osgMotion; if (m) m.close(menu); else menu.remove(); menu = null; } manage = false; btn?.setAttribute("aria-expanded", "false"); }
  async function onMenu(e) {
    const el = e.target.closest("[data-act]"); if (!el) return; e.stopPropagation(); const act = el.dataset.act, uid = el.dataset.uid;
    if (act === "manage") { manage = !manage; openMenu(); return; }
    if (act === "remove") { const x = info.accounts.find((y) => y.uid === uid); if (!confirm(`Forget ${x ? x.name : "this account"} in the switcher? (It stays signed in if it's the current one.)`)) return; await send({ type: "acc:remove", uid }); const r = await send({ type: "acc:list" }); if (r) { info = { ...info, ...r }; render(); } return; }
    if (act === "switch") {
      const x = info.accounts.find((y) => y.uid === uid); if (!x || x.current) { closeMenu(); return; }
      if (x.signedOut) { toast(`${x.name} is signed out. Use “Add account” and sign in to it again.`); return; }
      closeMenu(); toast(`Switching to ${x.name}…`, 8);
      const r = await send({ type: "acc:switch", uid }); if (r && r.error) toast(r.error);
      return;
    }
    if (act === "add") { closeMenu(); const r = await send({ type: "acc:add" }); if (r && r.error) toast(r.error); return; }
    if (act === "comments") { closeMenu(); send({ type: "open:comments" }); }
    if (act === "library") { closeMenu(); send({ type: "open:library" }); }
    if (act === "libsave") { closeMenu(); saveToLibrary(); }
  }
  document.addEventListener("pointerdown", (e) => { if (menu && !menu.contains(e.target) && e.target !== btn && !btn?.contains(e.target)) closeMenu(); }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && menu) closeMenu(); if (menu && e.key === "Enter" && e.target.closest?.("#osg-acc-menu [data-act=switch]")) e.target.click(); }, true);
  addEventListener("resize", () => menu && openMenu());

  // ---------- adding an account: you sign in yourself, in the site's own login fields ----------
  let addBar = null;
  function startAdding() {
    if (!addBar) {
      addBar = document.createElement("div"); addBar.id = "osg-acc-adding";
      addBar.innerHTML = `<span>Sign in with the account you want to add — it'll be saved for switching.</span><button type="button">Cancel</button>`;
      addBar.querySelector("button").onclick = async () => { addBar.remove(); addBar = null; toast("Going back…", 5); await send({ type: "acc:cancelAdd" }); };
      document.body.appendChild(addBar);
    }
    const fields = $("#login_fields"); if (fields && !shown(fields)) $("#login_button")?.click();
    setTimeout(() => $("#username")?.focus(), 50);
    const done = new MutationObserver(() => { if (last && last.state === "member" && addBar) { addBar.remove(); addBar = null; done.disconnect(); } });
    done.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
  }

  // ---------- small notices ----------
  let toastEl = null, toastT = 0;
  function toast(text, secs) {
    secs = secs || Math.max(5, Math.min(14, String(text).length / 14));
    if (!toastEl) { toastEl = document.createElement("div"); toastEl.id = "osg-acc-toast"; toastEl.setAttribute("role", "status"); document.body.appendChild(toastEl); }
    toastEl.textContent = text; toastEl.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove("show"), secs * 1000);
  }
  chrome.runtime.onMessage.addListener((m) => {
    if (m && m.type === "acc:changed") {
      let bar = $("#osg-acc-stale"); if (!bar) { bar = document.createElement("div"); bar.id = "osg-acc-stale"; document.body.appendChild(bar); }
      bar.innerHTML = `<span>${m.name ? `You switched to <b>${esc(m.name)}</b> in another tab.` : "You signed out in another tab to add an account."} Reload this page before saving or commenting here.</span><button type="button" data-r>Reload</button><button type="button" data-x aria-label="Dismiss">✕</button>`;
      bar.querySelector("[data-r]").onclick = () => location.reload(); bar.querySelector("[data-x]").onclick = () => bar.remove();
    }
  });

  // ---------- your comments, indexed as you see them ----------
  const seenLists = new WeakMap();
  function scanComments() {
    const seq = seqId(); if (!seq || !globalThis.osgComments) return;
    for (const box of document.querySelectorAll(".comments-content")) {
      const html = box.innerHTML; if (seenLists.get(box) === html) continue; seenLists.set(box, html);
      const loading = box.closest(".comments")?.querySelector(".comments-loading"); if (loading && shown(loading)) continue;
      if (!html.trim()) continue;
      const comments = osgComments.parse(box);
      if (!comments.length && !/no comments yet/i.test(box.textContent)) continue;   // an error message, not an empty list
      send({ type: "cm:found", seq, title: seqTitle(), comments });
    }
  }
  let scanT = 0; const scanSoon = () => { clearTimeout(scanT); scanT = setTimeout(scanComments, 400); };

  // ---------- sequence library: the editor's own data goes through the page-side script (libmain.js) ----------
  const askMain = (kind, payload = {}, ms = 30000) => new Promise((res) => {
    const id = Math.random().toString(36).slice(2);
    const on = (e) => { if (e.source !== window || !e.data || e.data["osg-lib"] !== "reply" || e.data.id !== id) return; removeEventListener("message", on); clearTimeout(t); res(e.data); };
    const t = setTimeout(() => { removeEventListener("message", on); res({ ok: false, error: "The editor didn't answer." }); }, ms);
    addEventListener("message", on); window.postMessage({ "osg-lib": kind, id, ...payload }, location.origin);
  });
  async function saveToLibrary() {
    toast("Saving to your library…", 3);
    const x = await askMain("export"); if (!x.ok) { toast("Couldn't read the sequence: " + x.error); return; }
    const r = await send({ type: "lib:saveEditor", data: x.data, title: x.title, seqId: x.seqId, picture: x.picture });
    if (!r || r.error) { toast("Couldn't save it: " + ((r && r.error) || "no answer")); return; }
    toast(r.duplicate ? `“${r.title}” is already in your library (exactly this version).` : `Saved “${r.title}” to your library (${(r.notes || 0).toLocaleString()} notes).`);
  }
  // every save on the site → a version in your library (libmain.js watches the site's save and sends what was saved)
  addEventListener("message", async (e) => {
    const m = e.data; if (e.source !== window || !m || m["osg-lib"] !== "saved" || !/^\d+$/.test(String(m.seqId || "")) || typeof m.data !== "string") return;
    const q = await new Promise((res) => { try { chrome.storage.local.get({ qol: {} }, (v) => res(v.qol || {})); } catch (err) { res({}); } });
    if (q.backupSaves === false) return;
    const me = document.querySelector('#member_username a[href*="/members/"]');
    const r = await send({ type: "lib:saveVersion", data: m.data, title: m.title, seqId: String(m.seqId), picture: m.picture, creatorUid: ((me && me.getAttribute("href")) || "").replace(/\D/g, ""), creatorName: me ? me.textContent.trim() : "" });
    if (r && r.ok && !r.duplicate) toast(`Saved — and backed up to your library (version ${r.versions} of “${r.title}”).`, 4);
  });
  // opening one of your own sequences keeps a copy of it as it is on the site, so edits you saved somewhere else (another
  // computer, before the extension) show up in its history too. Only when it differs from what's already kept.
  async function snapshotOwn() {
    if (document.body.id !== "page_view") return;
    const seq = (location.pathname.match(/^\/(\d+)\/?$/) || [])[1]; if (!seq) return;
    const meA = document.querySelector('#member_username a[href*="/members/"]'), me = ((meA && meA.getAttribute("href")) || "").replace(/\D/g, "");
    const byA = document.querySelector('.info-sidebar-details a[href^="/members/"]'), by = ((byA && byA.getAttribute("href")) || "").replace(/\D/g, "");
    if (!me || me !== by) return;
    const q = await new Promise((res) => { try { chrome.storage.local.get({ qol: {} }, (v) => res(v.qol || {})); } catch (err) { res({}); } });
    if (q.backupSaves === false) return;
    for (let k = 0; k < 20; k++) {
      await new Promise((r) => setTimeout(r, k ? 1500 : 2500));
      const x = await askMain("snap", { seq }, 5000); if (!x || !x.ok) continue;
      const r = await send({ type: "lib:saveVersion", source: "seen", data: x.data, title: x.title, seqId: seq, picture: x.picture, creatorUid: me, creatorName: meA.textContent.trim() });
      if (r && r.ok && !r.duplicate && r.versions > 1) toast(`“${r.title}” had changed since its last copy here — kept this version in its history.`, 5);
      return;
    }
  }
  async function openFromLibrary() {
    const m = location.hash.match(/[#&]osglib=([^&]+)/); if (!m) return;
    history.replaceState(null, "", location.pathname + location.search);
    const r = await send({ type: "lib:get", key: decodeURIComponent(m[1]) }); if (!r || r.error) { toast((r && r.error) || "Couldn't open it."); return; }
    toast(`Opening “${r.title}”…`, 4);
    const x = await askMain("load", { data: r.data, title: r.title }); toast(x.ok ? `Opened “${r.title}” from your library. Save it to put it on the site.` : "Couldn't open it: " + x.error);
  }

  function boot() {
    openFromLibrary(); snapshotOwn();
    watchHeader();
    // the Comments panel is created when it is first opened: look for it now and then, and watch each one found
    const watched = new WeakSet(), mo = new MutationObserver(scanSoon);
    const find = () => { for (const box of document.querySelectorAll(".comments-content")) if (!watched.has(box)) { watched.add(box); mo.observe(box, { childList: true, subtree: true, characterData: true }); scanSoon(); } };
    find(); setInterval(find, 1500);
    if (seqId()) setTimeout(() => send({ type: "cm:seen", seq: seqId(), title: seqTitle() }), 2500);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
