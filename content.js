// Glow Theme for Online Sequencer — applies saved settings and keeps them in sync.
// Also bridges settings to/from the on-page Settings tab (tools.js, which runs in the page's own context).

(function () {
  // myNameColor: your own username color ("" = keep the site's); meUid / meName: who you are, read from the page header
  const DEFAULTS = { accent: "#7c5cff", style: "glow", tint: 1, animations: true, hideAds: true, gridTheme: true, myNameColor: "", meUid: "", meName: "" };
  // After the extension is reloaded/updated, this old copy stays in open tabs with a dead connection to the
  // extension ("Extension context invalidated"). alive() lets every call bail out quietly instead of throwing.
  const alive = () => { try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; } };
  const store = chrome.storage.local;
  const safe = (fn) => { if (!alive()) return; try { fn(); } catch (e) {} };

  function hexToRgb(hex) {
    const h = String(hex).replace("#", "");
    const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    const n = parseInt(full, 16);
    if (isNaN(n)) return "124, 92, 255";
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(", ");
  }

  let current = { ...DEFAULTS };
  function apply(opts) {
    current = { ...DEFAULTS, ...opts };
    const root = document.documentElement;
    const accent = /^#[0-9a-f]{3,6}$/i.test(current.accent) ? current.accent : DEFAULTS.accent;
    root.style.setProperty("--os-accent", accent);
    root.style.setProperty("--os-accent-rgb", hexToRgb(accent));
    root.classList.toggle("osg-no-anim", current.animations === false);
    try { if (window.top === window) localStorage.setItem("osg-anim", current.animations === false ? "0" : "1"); } catch (e) {}   // read before the next page draws (pageMotion)
    root.classList.toggle("osg-hide-ads", current.hideAds !== false);
    root.setAttribute("data-osg-grid", current.gridTheme === false ? "off" : "on");
    root.setAttribute("data-osg-style", current.style || DEFAULTS.style);
    root.style.setProperty("--os-k", String(Math.max(0, Math.min(2, Number(current.tint ?? 1)))));
    applyMyNameColor();
    // Tell the page-side scripts (grid.js / tools.js) — detail is a JSON string so it crosses the world boundary
    document.dispatchEvent(new CustomEvent("osg-settings-changed", { detail: JSON.stringify(current) }));
  }

  // ---- your own username color (only you see it) ----
  const cssStr = (s) => '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  function applyMyNameColor() {
    let el = document.getElementById("osg-myname");
    const color = /^#[0-9a-f]{3,8}$/i.test(current.myNameColor || "") ? current.myNameColor : "";
    const uid = /^\d+$/.test(current.meUid || "") ? current.meUid : "", name = current.meName || "";
    if (!color || (!uid && !name)) { if (el) el.textContent = ""; return; }
    const sel = [];
    if (uid) sel.push(`a[href="/members/${uid}"]`, `a[href$="onlinesequencer.net/members/${uid}"]`, `a[href*="action=profile&uid=${uid}"]`);
    if (name) sel.push(`a[data-user=${cssStr(name)}]`);
    const all = sel.join(", "), inner = sel.map((x) => x + " *").join(", ");
    if (!el) { el = document.createElement("style"); el.id = "osg-myname"; (document.head || document.documentElement).appendChild(el); }
    el.textContent = `${all}, ${inner} { color: ${color} !important; }`;
  }
  // who am I? The editor/site header shows "Welcome back <a href="/members/ID">NAME</a>" once logged in
  // (filled in after page load), and the forum shows a profile link in its welcome block.
  function detectMe() {
    let uid = "", name = "";
    const a = document.querySelector('#member_username a[href*="/members/"]');
    if (a) { uid = (a.getAttribute("href").match(/\/members\/(\d+)/) || [])[1] || ""; name = a.textContent.trim(); }
    if (!uid) { const f = document.querySelector('#panel .welcome a[href*="action=profile"], .welcome a[href*="action=profile"]'); if (f) { uid = (f.getAttribute("href").match(/uid=(\d+)/) || [])[1] || ""; name = f.textContent.trim(); } }
    if (!uid || uid === "0" || !name) return false;
    if (uid !== current.meUid || name !== current.meName) safe(() => store.set({ meUid: uid, meName: name }));
    return true;
  }
  if (window.top === window) {
    const tryDetect = () => { try { return detectMe(); } catch (e) { return false; } };
    const start = () => { if (tryDetect()) return; const mo = new MutationObserver(() => { if (tryDetect()) mo.disconnect(); }); mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true }); setTimeout(() => mo.disconnect(), 20000); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  }

  // ---- moving between pages: the old page fades out (the browser's cross-page view transition) and the new one fades in
  // once the extension has laid it out (ready.js), so the plain site never flashes up first. Never hidden for long: it
  // shows itself after 1.5 s whatever happens. Off with the popup's Animations switch or the system's reduced motion.
  (function pageMotion() {
    if (window.top !== window || location.hostname !== "onlinesequencer.net") return;
    let on = true; try { on = localStorage.getItem("osg-anim") !== "0"; } catch (e) {}
    if (!on || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const root = document.documentElement;
    const st = document.createElement("style"); st.id = "osg-page-motion"; st.textContent = "@view-transition { navigation: auto; }";
    (document.head || root).appendChild(st);
    root.classList.add("osg-entering");
    const reveal = () => {
      if (!root.classList.contains("osg-entering")) return;
      root.classList.remove("osg-entering"); root.classList.add("osg-entered"); setTimeout(() => root.classList.remove("osg-entered"), 700);
    };
    document.addEventListener("osg:laid-out", () => requestAnimationFrame(reveal), { once: true });
    setTimeout(reveal, 1500);
    // a page brought back with Back / Forward from the browser's memory shows as it was left
    addEventListener("pageshow", (e) => { if (e.persisted) root.classList.remove("osg-entering"); });
  })();

  function load() { safe(() => store.get(DEFAULTS, (v) => { if (!chrome.runtime.lastError) apply(v); })); }

  // One-time migration from the old sync storage (if local is empty)
  safe(() => store.get(null, (local) => {
    if (chrome.runtime.lastError) return apply({});
    if (local && Object.keys(local).length) return load();
    try { chrome.storage.sync.get(null, (s) => { if (!chrome.runtime.lastError && s && Object.keys(s).length) store.set(s, load); else load(); }); } catch (e) { load(); }
  }));
  safe(() => chrome.storage.onChanged.addListener((changes, area) => { if (area === "local") load(); }));

  // Settings changed from the on-page Settings tab
  document.addEventListener("osg-set", (e) => {
    try {
      const { key, value } = JSON.parse(e.detail);
      if (!(key in DEFAULTS)) return;
      if (!alive()) { apply({ ...current, [key]: value }); return; }   // extension was reloaded: still apply on this page
      safe(() => store.set({ [key]: value }));
    } catch (err) {}
  });
  document.addEventListener("osg-request-settings", () => apply(current));
})();
