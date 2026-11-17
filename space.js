// Glow Theme — Space plays and stops from anywhere on the page.
// The site only listens for keys while its sequencer grid has the keyboard focus. Anywhere else, Space falls through to
// the browser and scrolls the page — and with the extension's layouts (YouTube layout, Glow player, Studio) the grid is
// often not focused, or not on screen at all. This passes Space on to the site's own play / stop:
//   - playlist pages: the playlist's play / pause button (exactly what clicking it does);
//   - the editor and sequence pages: the site's own key handler, so it plays from the same place it would anyway.
// Typing in a box (search, comments, BPM, the extension's panels) is left alone, and so is the grid itself.
(function () {
  "use strict";
  if (window.top !== window || window.__osgSpace) return; window.__osgSpace = true;
  const typing = (el) => !!(el && el.closest && el.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], .annotation"));
  addEventListener("keydown", (e) => {
    if (e.code !== "Space" && e.key !== " ") return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.isComposing || e.defaultPrevented) return;
    const t = e.target, active = document.activeElement;
    if (typing(t) || typing(active)) return;
    const grid = document.getElementById("sequencer_main");
    if (grid && (grid.contains(t) || grid.contains(active)) && document.body.id !== "page_playlist") return;   // the site handles it there
    const playlistBtn = document.body.id === "page_playlist" ? document.getElementById("playlist_play_btn")?.closest(".playlist_control_btn") : null;
    const site = typeof window.onkeydown === "function" && grid ? window.onkeydown : null;
    if (!playlistBtn && !site) return;   // nothing to play on this page: let Space scroll as usual
    e.preventDefault(); e.stopPropagation();
    if (active && active !== document.body && active.matches?.("button, a, [role='button'], summary")) active.blur();   // or its keyup would click it too
    if (e.repeat) return;   // holding Space doesn't flip it on and off
    if (playlistBtn) playlistBtn.click();
    else try { site.call(window, e); } catch (err) {}
  }, true);
})();
