// Glow Theme for Online Sequencer — note-grid recolor.
// Runs in the page's own JS context (manifest "world": "MAIN") so it can reach the
// sequencer's color tables. The grid is drawn by WebGL (or a 2D canvas fallback)
// with hardcoded colors; this swaps those colors for theme colors and repaints.

// shared by the page-side scripts: a pop-out eases away before it's removed (theme.css: .osg-pop-out / .osg-fade-out)
window.__osgPopOut = window.__osgPopOut || function (el, fade) {   // a pop-out eases away, then goes (fade: just fade, for full-screen overlays)
  if (!el) return;
  const calm = document.documentElement.classList.contains("osg-no-anim") || matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (calm || !el.isConnected || !el.getClientRects().length) { el.remove(); return; }
  el.classList.add(fade ? "osg-fade-out" : "osg-pop-out"); el.setAttribute("aria-hidden", "true"); el.style.pointerEvents = "none";
  let done = false; const fin = () => { if (!done) { done = true; el.remove(); } };
  el.addEventListener("animationend", fin, { once: true }); setTimeout(fin, 260);
};

(function () {
  const ORIG = {
    bg: [69, 71, 76], guide: [102, 102, 106], line: [53, 54, 58, 0.5], dark: [53, 54, 58], outside: [53, 54, 58],
  };
  const fill2d = { "#66666a": "guide", "#45474c": "bg", "rgba(53, 54, 58, 0.5)": "line", "rgba(53, 54, 58, 1)": "dark" };

  let current = null;  // current rgba tuples by key, or null when the theme is off

  function accent() {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--os-accent-rgb").trim();
    const m = v.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    return m ? [+m[1], +m[2], +m[3]] : [124, 92, 255];
  }
  const mix = (b, a, t) => b.map((v, i) => Math.round(v + (a[i] - v) * t));

  // Shades come from CSS variables in theme.css (so style presets can change them)
  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (!v) return fallback;
    const nums = v.split(",").map((x) => parseFloat(x));
    return nums.length === 1 ? nums[0] : nums;
  }
  function themeColors() {
    const A = accent();
    const k = Math.max(0, Math.min(2, cssVar("--os-k", 1)));
    const c = (name, fb, mixFb) => mix(cssVar("--os-grid-" + name, fb), A, Math.min(1, cssVar("--os-grid-" + name + "-mix", mixFb) * k));
    return {
      bg:      [...c("bg", [44, 44, 58], 0.05), 1],
      guide:   [...c("guide", [60, 60, 78], 0.10), 1],   // rows that are in the selected key
      line:    [...c("line", [18, 18, 28], 0.10), cssVar("--os-grid-line-alpha", 0.6)],
      dark:    [...c("dark", [24, 20, 44], 0.30), 1],    // beat / octave lines, accent-tinted
      outside: [...c("outside", [28, 28, 38], 0.05), 1],
    };
  }

  function enabled() { return document.documentElement.getAttribute("data-osg-grid") !== "off"; }

  function setGl(arr, c) {
    const a = c.length > 3 ? c[3] : 1;
    arr[0] = c[0] * a / 255; arr[1] = c[1] * a / 255; arr[2] = c[2] * a / 255; arr[3] = a;
  }

  function apply() {
    if (typeof backgroundColor === "undefined" || typeof SequencerView === "undefined") return false;
    current = enabled() ? themeColors() : null;
    const c = current || { bg: [...ORIG.bg, 1], guide: [...ORIG.guide, 1], line: ORIG.line, dark: [...ORIG.dark, 1], outside: [...ORIG.outside, 1] };
    try {
      setGl(backgroundColor, c.bg); setGl(keyGuideColor, c.guide); setGl(lineColor, c.line); setGl(darkLineColor, c.dark);
      if (typeof outsidePianoColor !== "undefined") setGl(outsidePianoColor, c.outside);
      // Force the grid to be rebuilt on the next paint (both renderers)
      if (SequencerView._lastGridSize !== undefined) SequencerView._lastGridSize = -1;
      if (typeof updateGridImage === "function") updateGridImage();
      if (typeof SequencerView.repaint === "function") SequencerView.repaint();
    } catch (e) { /* site code changed; fail quietly */ }
    return true;
  }

  // 2D-canvas fallback renderer: remap the hardcoded strings as they're assigned
  const css = (c) => (c.length > 3 && c[3] !== 1) ? `rgba(${c[0]},${c[1]},${c[2]},${c[3]})` : `rgb(${c[0]},${c[1]},${c[2]})`;
  for (const P of [CanvasRenderingContext2D.prototype, (window.OffscreenCanvasRenderingContext2D || {}).prototype].filter(Boolean)) {
    for (const prop of ["fillStyle", "strokeStyle"]) {
      const d = Object.getOwnPropertyDescriptor(P, prop);
      if (!d || !d.set) continue;
      Object.defineProperty(P, prop, {
        configurable: true, get: d.get,
        set(v) { const k = (current && typeof v === "string") ? fill2d[v] : undefined; d.set.call(this, k ? css(current[k]) : v); },
      });
    }
  }

  // Wait for the site's script to define its color tables, then apply
  let tries = 0;
  const t = setInterval(() => { if (apply() || ++tries > 400) clearInterval(t); }, 50);

  // Re-apply when the popup changes the accent or the grid toggle (content.js dispatches this)
  document.addEventListener("osg-settings-changed", apply);
})();
