/* Glow Theme for Online Sequencer — FX rack. Runs in the page (MAIN world) on the editor.
   A dock along the bottom of the editor ("FX" in the top menu) that shows the current instrument's effects as a chain of cards — power
   toggle, name, type picker, rotary knobs with exact readouts — in the style of a DAW effects rack. Everything is
   written through the site's own instrument-settings functions, so the site's instrument panel, the Layers mixer and
   the audio stay in step; every knob gesture is one undo step. */
(function () {
  "use strict";
  if (window.__osgFx) return; window.__osgFx = true;
  const LS = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const unesc = (s) => { const t = document.createElement("textarea"); t.innerHTML = s; return t.value; };
  const toast = (m) => { try { message(m, 3, true); } catch (e) {} };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---------- the site's settings, read and written through its own functions ----------
  const st = (i) => { try { return song.getInstrumentSettings(i) || {}; } catch (e) { return {}; } };
  const curInst = () => (typeof instrument !== "undefined" ? instrument : null);
  const instName = (i) => { try { return unesc(getInstrumentName(song, i)); } catch (e) { return "Instrument " + i; } };
  const instColor = (i) => { try { const c = getInstrumentColor(song, i); return `rgb(${c[1]},${c[2]},${c[3]})`; } catch (e) { return "#888"; } };
  const instVol = (i) => { try { return +getInitialInstrumentVolume(i); } catch (e) { return 1; } };
  const isSampler = (i) => { try { return !!instMgr.isSampler(i); } catch (e) { return false; } };
  const isSynth = (i) => { try { return !!instMgr.isCustomSynth(i); } catch (e) { return false; } };
  const REVERBS = [[1, "Classic"], [2, "Small"], [13, "Short"], [3, "Large"], [12, "Church"], [4, "Gated"], [14, "Lead Guitar"], [15, "Rhythm Guitar"], [5, "Reverse"], [6, "Nova"], [7, "Ripple"], [8, "Miasma"]];
  const DISTORTS = [[1, "Limit"], [10, "SoftLim"], [2, "Zest"], [3, "Quasar"], [4, "Styx"], [5, "Lucid"], [6, "Tremor"], [7, "Zircon"], [8, "Hornet"], [9, "Shear"]];
  function get(i, f) {
    const s = st(i), eq = s.eq || {}, sy = s.synth || {}, ve = sy.volumeEnvelope || {};
    switch (f) {
      case "volume": return instVol(i); case "pan": return +s.pan || 0; case "detune": return +s.detune || 0;
      case "reverb": return !!s.reverb; case "reverbType": return +s.reverbType || 1; case "reverbVolume": return s.reverbVolume ?? 1;
      case "delay": return !!s.delay;
      case "distort": return !!s.distort; case "distortType": return +s.distortType || 1; case "distortVolume": return s.distortVolume ?? 0;
      case "bitcrusher": return !!s.bitcrusher; case "bitcrusherDepth": return +s.bitcrusherDepth || 12; case "bitcrusherLevel": return s.bitcrusherLevel ?? 0.5;
      case "eq": return !!eq.enabled; case "eqLow": return +eq.low || 0; case "eqMid": return +eq.mid || 0; case "eqHigh": return +eq.high || 0;
      case "envelope": return !!s.samplerEnvelope; case "samplerAttack": return +(s.samplerAttack ?? 0); case "samplerRelease": return +(s.samplerRelease ?? 1);
      case "filter": return +(sy.filter ?? 20000); case "resonance": return +(sy.resonance ?? 10);
      case "adsr": return !!ve.enabled; case "attack": return +(ve.attack ?? 0); case "decay": return +(ve.decay ?? 0); case "sustain": return +(ve.sustain ?? 1); case "release": return +(ve.release ?? 1);
    }
    return 0;
  }
  function set(i, f, v) {
    try {
      switch (f) {
        case "volume": setInitialInstrumentVolume(i, +v); { const e = document.getElementById("instrument_volume_" + i); if (e) e.value = +v; } break;
        case "pan": setPan(i, +v); break; case "detune": setDetune(i, Math.round(+v)); break;
        case "reverb": if (get(i, f) !== !!v) selectReverb(i); break; case "reverbType": selectReverbType(i, +v); break; case "reverbVolume": setReverbVolume(i, +v); break;
        case "delay": if (get(i, f) !== !!v) selectDelay(i); break;
        case "distort": if (get(i, f) !== !!v) selectDistort(i); break; case "distortType": selectDistortType(i, +v); break; case "distortVolume": setDistortVolume(i, +v); break;
        case "bitcrusher": if (get(i, f) !== !!v) selectBitcrusher(i); break; case "bitcrusherDepth": setBitcrusherDepth(i, Math.round(+v)); break; case "bitcrusherLevel": setBitcrusherLevel(i, +v); break;
        case "eq": if (get(i, f) !== !!v) selectEq(i); break; case "eqLow": setEqLow(i, Math.round(+v)); break; case "eqMid": setEqMid(i, Math.round(+v)); break; case "eqHigh": setEqHigh(i, Math.round(+v)); break;
        case "envelope": if (get(i, f) !== !!v) selectEnvelope(i); break; case "samplerAttack": setSamplerAttack(i, +v); break; case "samplerRelease": setSamplerRelease(i, +v); break;
        case "filter": setSynthFilter(i, Math.round(+v)); break; case "resonance": setSynthFilterQ(i, +v); break;
        case "adsr": if (get(i, f) !== !!v) selectADSR(i); break;
        case "attack": setAttack(i, +v); break; case "decay": setDecay(i, +v); break; case "sustain": setSustain(i, +v); break; case "release": setRelease(i, +v); break;
      }
      if (i === curInst()) { try { fillAdvancedInstrumentSettings(); } catch (e) {} }
      try { setConfirmExit(true); } catch (e) {}
    } catch (e) {}
  }
  // one undo step per gesture
  function commit(i, f, before, after) { if (before === after) return; try { exec(() => { set(i, f, after); render(); }, () => { set(i, f, before); render(); }); } catch (e) { set(i, f, after); } }

  // ---------- the rack: which cards, which knobs ----------
  const pct = (v) => Math.round(v * 100) + "%", num0 = (v) => String(Math.round(v)), sec = (v) => (+v).toFixed(2) + " s", f2 = (v) => (+v).toFixed(2);
  const panFmt = (v) => (Math.abs(v) < 0.005 ? "C" : (v < 0 ? "L " : "R ") + Math.round(Math.abs(v) * 100));
  const knob = (f, label, min, max, step, def, fmt) => ({ f, label, min, max, step, def, fmt });
  function cardsFor(i) {
    const cards = [
      { id: "channel", name: "Channel", fixed: true, knobs: [knob("volume", "Volume", 0, 2, 0.01, 1, pct), knob("pan", "Pan", -1, 1, 0.01, 0, panFmt), knob("detune", "Detune", -1200, 1200, 1, 0, (v) => num0(v) + " ¢")] },
      { id: "eq", name: "Equalizer", power: "eq", knobs: [knob("eqLow", "Low", -48, 48, 1, 0, (v) => num0(v) + " dB"), knob("eqMid", "Mid", -48, 48, 1, 0, (v) => num0(v) + " dB"), knob("eqHigh", "High", -48, 48, 1, 0, (v) => num0(v) + " dB")] },
      { id: "distort", name: "Distortion", power: "distort", type: { f: "distortType", options: DISTORTS }, knobs: [knob("distortVolume", "Amount", 0, 1, 0.01, 0.5, pct)] },
      { id: "bitcrusher", name: "Bitcrusher", power: "bitcrusher", knobs: [knob("bitcrusherDepth", "Depth", 1, 16, 1, 12, (v) => num0(v) + " bit"), knob("bitcrusherLevel", "Level", 0, 1, 0.01, 0.5, pct)] },
      { id: "delay", name: "Delay", power: "delay", knobs: [], note: "Tempo-synced echo — on or off." },
      { id: "reverb", name: "Reverb", power: "reverb", type: { f: "reverbType", options: REVERBS }, knobs: [knob("reverbVolume", "Amount", 0, 1, 0.01, 1, pct)] },
    ];
    if (isSampler(i)) cards.splice(1, 0, { id: "envelope", name: "Envelope", power: "envelope", knobs: [knob("samplerAttack", "Attack", 0, 3, 0.01, 0, sec), knob("samplerRelease", "Release", 0.01, 3, 0.01, 1, sec)] });
    if (isSynth(i)) cards.splice(1, 0,
      { id: "filter", name: "Filter", fixed: true, knobs: [knob("filter", "Cutoff", 0, 20000, 1, 20000, (v) => num0(v) + " Hz"), knob("resonance", "Resonance", 0, 20, 0.1, 10, (v) => (+v).toFixed(1))] },
      { id: "adsr", name: "Amp envelope", power: "adsr", knobs: [knob("attack", "A", 0, 1, 0.02, 0, f2), knob("decay", "D", 0, 1, 0.02, 0, f2), knob("sustain", "S", 0, 1, 0.02, 1, f2), knob("release", "R", 0, 1, 0.02, 1, f2)] });
    return cards;
  }

  // ---------- knob widget ----------
  const R = 22, ARC = 270, START = 225, C = 28;   // degrees clockwise from 12 o'clock: the dial sweeps from 7 o'clock (225°) through the top to 5 o'clock, so a centred value points straight up
  const polar = (deg) => { const a = (deg - 90) * Math.PI / 180; return [C + R * Math.cos(a), C + R * Math.sin(a)]; };
  function arcPath(from, to) { const [x1, y1] = polar(from), [x2, y2] = polar(to); return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${R} ${R} 0 ${to - from > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`; }
  function paintKnob(el, k, v) {
    const p = clamp((v - k.min) / (k.max - k.min), 0, 1), zero = k.min < 0 && k.max > 0 ? (0 - k.min) / (k.max - k.min) : 0;
    const a = START + ARC * p, z = START + ARC * zero, lo = Math.min(a, z), hi = Math.max(a, z);
    el.querySelector(".osg-fx-arc").setAttribute("d", hi - lo < 0.5 ? "" : arcPath(lo, hi));
    const [px, py] = polar(a); const ptr = el.querySelector(".osg-fx-ptr"); ptr.setAttribute("x2", (C + (px - C) * 0.62).toFixed(2)); ptr.setAttribute("y2", (C + (py - C) * 0.62).toFixed(2)); ptr.setAttribute("x1", (C + (px - C) * 0.2).toFixed(2)); ptr.setAttribute("y1", (C + (py - C) * 0.2).toFixed(2));
    el.querySelector(".osg-fx-val").textContent = k.fmt(v);
  }
  function knobEl(i, k, enabled) {
    const w = document.createElement("div"); w.className = "osg-fx-knob" + (enabled ? "" : " off"); w.dataset.f = k.f; w.title = `${k.label} — drag up / down, scroll, or double-click to reset. Shift for fine steps.`;
    w.innerHTML = `<svg viewBox="0 0 56 56" width="52" height="52"><path class="osg-fx-track" d="${arcPath(START, START + ARC)}"/><path class="osg-fx-arc" d=""/><circle class="osg-fx-cap-sh" cx="28" cy="29.5" r="15"/><circle class="osg-fx-cap" cx="28" cy="28" r="15"/><circle class="osg-fx-cap-in" cx="28" cy="28" r="11.5"/><line class="osg-fx-ptr" x1="28" y1="28" x2="28" y2="6"/></svg><div class="osg-fx-val">–</div><div class="osg-fx-lab">${esc(k.label)}</div>`;
    paintKnob(w, k, get(i, k.f));
    let drag = null;
    w.addEventListener("pointerdown", (e) => { if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); w.setPointerCapture(e.pointerId); drag = { y: e.clientY, v0: get(i, k.f), before: get(i, k.f) }; w.classList.add("drag"); });
    w.addEventListener("pointermove", (e) => { if (!drag) return; const range = k.max - k.min, px = e.shiftKey ? 900 : 180; let v = drag.v0 + (drag.y - e.clientY) / px * range; v = Math.round(clamp(v, k.min, k.max) / k.step) * k.step; v = +v.toFixed(4); set(i, k.f, v); paintKnob(w, k, v); });
    const end = (e) => { if (!drag) return; const before = drag.before; drag = null; w.classList.remove("drag"); commit(i, k.f, before, get(i, k.f)); };
    w.addEventListener("pointerup", end); w.addEventListener("pointercancel", end);
    w.addEventListener("dblclick", (e) => { e.preventDefault(); const before = get(i, k.f); set(i, k.f, k.def); paintKnob(w, k, k.def); commit(i, k.f, before, k.def); });
    w.addEventListener("wheel", (e) => { e.preventDefault(); e.stopPropagation(); const before = get(i, k.f); const steps = (e.shiftKey ? 1 : 4) * k.step * (e.deltaY < 0 ? 1 : -1); let v = +clamp(before + steps, k.min, k.max).toFixed(4); set(i, k.f, v); paintKnob(w, k, v); clearTimeout(w._t); w._wb = w._wb ?? before; w._t = setTimeout(() => { commit(i, k.f, w._wb, get(i, k.f)); w._wb = undefined; }, 400); }, { passive: false });
    // click the value to type it
    w.querySelector(".osg-fx-val").addEventListener("pointerdown", (e) => { e.stopPropagation(); });
    w.querySelector(".osg-fx-val").addEventListener("click", (e) => {
      e.stopPropagation(); const val = w.querySelector(".osg-fx-val"); if (val.querySelector("input")) return;
      const inp = document.createElement("input"); inp.type = "number"; inp.step = k.step; inp.min = k.min; inp.max = k.max; inp.value = get(i, k.f); val.textContent = ""; val.appendChild(inp); inp.focus(); inp.select();
      const done = (apply) => { const before = get(i, k.f); let v = parseFloat(inp.value); if (apply && isFinite(v)) { v = +clamp(v, k.min, k.max).toFixed(4); set(i, k.f, v); commit(i, k.f, before, v); } paintKnob(w, k, get(i, k.f)); };
      inp.addEventListener("keydown", (ev) => { ev.stopPropagation(); if (ev.key === "Enter") done(true); if (ev.key === "Escape") done(false); });
      inp.addEventListener("blur", () => done(true));
    });
    return w;
  }

  // ---------- the dock (sits between the note grid and the bottom bar, like a DAW's effects strip) ----------
  let box = null, shownInst = null, pollT = 0;
  const panelOpen = () => !!(box && document.body.contains(box));
  const SVG = {
    power: `<svg viewBox="0 0 16 16" width="12" height="12"><path d="M8 2v6" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/><path d="M4.5 4.2a5 5 0 1 0 7 0" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>`,
    chev: `<svg viewBox="0 0 16 16" width="14" height="14"><path d="M3 6l5 5 5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`,
    x: `<svg viewBox="0 0 16 16" width="12" height="12"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
    plus: `<svg viewBox="0 0 16 16" width="16" height="16"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  };
  function build() {
    box = document.createElement("div"); box.id = "osg-fx"; if (LS.get("osg-fx-min") === "1") box.classList.add("min");
    box.innerHTML = `<div class="osg-fx-strip">
        <div class="osg-fx-ch"><span class="osg-fx-kicker">FX</span><span class="osg-fx-chip"></span><select class="osg-fx-inst" title="Which instrument's effects to show"></select>
          <div class="osg-fx-ch-btns"><button type="button" class="osg-fx-btn" data-act="presets" title="Save or apply a preset (the same presets as the instrument options)">Presets ▾</button><button type="button" class="osg-fx-btn" data-act="reset" title="Switch every effect off and put the channel back to default">Reset</button></div>
          <span class="osg-fx-hint">Drag knobs up / down · Shift = fine · scroll · double-click resets · click a value to type</span></div>
        <div class="osg-fx-rack"></div>
        <div class="osg-fx-side"><button type="button" class="osg-fx-ic" data-act="min" title="Collapse / expand">${SVG.chev}</button><button type="button" class="osg-fx-ic" data-act="close" title="Close the FX dock">${SVG.x}</button></div>
      </div>`;
    box.querySelector(".osg-fx-inst").addEventListener("change", (e) => { try { selectInstrument(+e.target.value); } catch (err) {} shownInst = null; render(); });
    box.addEventListener("click", (e) => {
      const b = e.target.closest("[data-act]"); if (!b) return; const i = curInst(); if (i == null) return;
      const act = b.dataset.act;
      if (act === "power" || act === "remove") { const f = b.dataset.f, before = get(i, f), after = act === "remove" ? false : !before; set(i, f, after); commit(i, f, before, after); render(); }
      else if (act === "add") addMenu(b, i);
      else if (act === "presets") presetMenu(b, i);
      else if (act === "reset") resetAll(i);
      else if (act === "min") { box.classList.toggle("min"); LS.set("osg-fx-min", box.classList.contains("min") ? "1" : "0"); relayout(); setTimeout(relayout, 260); }
      else if (act === "close") close();
    });
    box.addEventListener("change", (e) => { const s = e.target.closest("select[data-f]"); if (!s) return; const i = curInst(); const before = get(i, s.dataset.f), after = +s.value; set(i, s.dataset.f, after); commit(i, s.dataset.f, before, after); render(); });
    for (const ev of ["keydown", "keyup", "keypress"]) box.addEventListener(ev, (e) => { if (e.target.closest("input, select")) e.stopPropagation(); });
    box.addEventListener("transitionend", (e) => { if (e.target === box && e.propertyName === "height") relayout(); });   // the grid re-measures once the dock has finished growing / shrinking
    // the strip scrolls sideways with the wheel (knobs keep the wheel for themselves)
    box.querySelector(".osg-fx-rack").addEventListener("wheel", (e) => { if (e.target.closest(".osg-fx-knob") || e.deltaX) return; const r = e.currentTarget; if (r.scrollWidth > r.clientWidth) { r.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
  }
  function cardEl(i, c) {
    const on = c.fixed ? true : get(i, c.power);
    const card = document.createElement("div"); card.className = "osg-fx-card" + (on ? " on" : " off") + (c.fixed ? " fixed" : ""); card.dataset.id = c.id;
    card.innerHTML = `<div class="osg-fx-card-head">${c.fixed ? `<span class="osg-fx-dot"></span>` : `<button type="button" class="osg-fx-power" data-act="power" data-f="${c.power}" title="${on ? "Turn off" : "Turn on"}">${SVG.power}</button>`}<span class="osg-fx-name">${esc(c.name)}</span>${c.fixed ? "" : `<button type="button" class="osg-fx-x" data-act="remove" data-f="${c.power}" title="Remove (turn off)">${SVG.x}</button>`}</div>
      ${c.type ? `<select class="osg-fx-type" data-f="${c.type.f}">${c.type.options.map(([v, n]) => `<option value="${v}"${get(i, c.type.f) === v ? " selected" : ""}>${esc(n)}</option>`).join("")}</select>` : ""}
      <div class="osg-fx-card-body"></div>`;
    const body = card.querySelector(".osg-fx-card-body");
    if (c.knobs.length) for (const k of c.knobs) body.appendChild(knobEl(i, k, on)); else body.innerHTML = `<div class="osg-fx-note">${esc(c.note || "")}</div>`;
    return card;
  }
  function render() {
    if (!panelOpen()) return; const i = curInst(); if (i == null) return;
    if (box.querySelector(".osg-fx-knob.drag") || box.querySelector(".osg-fx-val input")) return;
    const insts = new Set(); try { for (const n of song.notes) insts.add(n.instrument); } catch (e) {} insts.add(i);
    const sel = box.querySelector(".osg-fx-inst"); const list = [...insts].sort((a, b) => instName(a).localeCompare(instName(b)));
    const want = list.map((x) => x + ":" + instName(x)).join("|"); if (sel.dataset.sig !== want) { sel.innerHTML = list.map((x) => `<option value="${x}">${esc(instName(x))}</option>`).join(""); sel.dataset.sig = want; }
    sel.value = String(i); box.style.setProperty("--c", instColor(i));
    const rack = box.querySelector(".osg-fx-rack"); const keep = rack.scrollLeft; rack.innerHTML = ""; shownInst = i;
    for (const c of cardsFor(i)) rack.appendChild(cardEl(i, c));
    const off = cardsFor(i).filter((c) => !c.fixed && !get(i, c.power));
    if (off.length) { const add = document.createElement("button"); add.type = "button"; add.className = "osg-fx-add"; add.dataset.act = "add"; add.innerHTML = `${SVG.plus}<span>Add effect</span><small>${off.length} available</small>`; rack.appendChild(add); }
    rack.scrollLeft = keep;
  }
  function refreshValues() {   // the site changed something (its own panel, Layers' mixer, a preset): repaint without rebuilding
    if (!panelOpen()) return; const i = curInst(); if (i == null) return;
    if (i !== shownInst) { render(); return; }
    if (box.querySelector(".osg-fx-knob.drag") || box.querySelector(".osg-fx-val input")) return;
    let rebuild = false;
    for (const c of cardsFor(i)) { const card = box.querySelector(`.osg-fx-card[data-id="${c.id}"]`); if (!card) { rebuild = true; break; } const on = c.fixed ? true : get(i, c.power); if (card.classList.contains("on") !== on) { rebuild = true; break; } for (const k of c.knobs) { const w = card.querySelector(`.osg-fx-knob[data-f="${k.f}"]`); if (w) paintKnob(w, k, get(i, k.f)); } if (c.type) { const s = card.querySelector("select[data-f]"); if (s && +s.value !== get(i, c.type.f)) s.value = get(i, c.type.f); } }
    if (rebuild) render();
  }
  function resetAll(i) {
    const fields = []; for (const c of cardsFor(i)) { if (c.power) fields.push([c.power, false]); for (const k of c.knobs) fields.push([k.f, k.def]); }
    const before = fields.map(([f]) => [f, get(i, f)]); if (before.every(([f, v], n) => v === fields[n][1])) return;
    const apply = (vals) => { for (const [f, v] of vals) set(i, f, v); render(); };
    try { exec(() => apply(fields), () => apply(before)); } catch (e) { apply(fields); }
    toast("Effects reset for " + instName(i) + ".");
  }
  // small menus
  let menu = null; const closeMenu = () => { if (menu) { (window.__osgPopOut || ((e) => e.remove()))(menu); menu = null; } };
  function showMenu(anchor, items) {
    closeMenu(); menu = document.createElement("div"); menu.className = "osg-fx-menu";
    menu.innerHTML = items.map((it, k) => it.sep ? `<div class="osg-fx-menu-sep"></div>` : `<button type="button" data-k="${k}"${it.cls ? ` class="${it.cls}"` : ""}>${it.label}</button>`).join("");
    document.body.appendChild(menu); const r = anchor.getBoundingClientRect();
    menu.style.left = Math.max(6, Math.min(innerWidth - menu.offsetWidth - 6, r.left)) + "px";
    menu.style.top = (r.top - menu.offsetHeight - 6 >= 6 ? r.top - menu.offsetHeight - 6 : r.bottom + 6) + "px";   // the dock is at the bottom, so menus open upwards
    menu.addEventListener("click", (e) => { const b = e.target.closest("button[data-k]"); if (!b) return; const it = items[+b.dataset.k]; closeMenu(); it.run && it.run(); });
  }
  function addMenu(anchor, i) { const off = cardsFor(i).filter((c) => !c.fixed && !get(i, c.power)); showMenu(anchor, off.map((c) => ({ label: esc(c.name), run: () => { const before = get(i, c.power); set(i, c.power, true); commit(i, c.power, before, true); render(); } }))); }
  // presets: the same store the instrument options use
  const PKEY = "osg-inst-presets";
  const presets = () => { try { const a = JSON.parse(LS.get(PKEY) || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
  function presetMenu(anchor, i) {
    const list = presets();
    const items = [{ label: "＋ Save current settings as…", cls: "accent", run: () => { const name = prompt("Preset name", instMgr.getDefaultName(i) + " preset"); if (!name) return; try { const a = presets(); a.unshift({ name: name.trim().slice(0, 60), base: instMgr.getDefaultName(i), synth: isSynth(i), data: goog.crypt.base64.encodeByteArray(getInstrumentSettingsProto(i).serializeBinary()), when: Date.now() }); LS.set(PKEY, JSON.stringify(a.slice(0, 200))); toast(`Preset "${name.trim()}" saved.`); } catch (e) { toast("Couldn't save the preset."); } } }];
    if (list.length) items.push({ sep: true });
    for (const p of list) items.push({ label: `${esc(p.name)} <small>${esc(p.base || "")}${p.synth ? " · synth" : ""}</small>`, run: () => applyPreset(i, p) });
    showMenu(anchor, items);
  }
  function applyPreset(i, p) {
    try {
      const instProto = proto.InstrumentSettings.deserializeBinary(p.data), parsed = parseInstrumentSettingsProto(instProto);
      const synthToo = isSynth(i) && typeof instProto.hasSynth === "function" && instProto.hasSynth() && parsed.synth, backup = st(i).synth;
      song.settings.instruments[i] = parsed; loadInstrumentSettings(i); if (!synthToo) song.settings.instruments[i].synth = backup; else { try { updateSynth(i); } catch (e) {} }
      try { fillAdvancedInstrumentSettings(); } catch (e) {} try { updateUiForInstrumentClones(); } catch (e) {} setConfirmExit(true); render(); toast(`Preset "${p.name}" applied.`);
    } catch (e) { toast("Couldn't apply that preset."); }
  }
  document.addEventListener("pointerdown", (e) => { if (menu && !e.target.closest(".osg-fx-menu")) closeMenu(); }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && menu) closeMenu(); }, true);

  // ---------- open / close + nav link ----------
  const relayout = () => { try { window.dispatchEvent(new Event("resize")); } catch (e) {} };   // the note grid sizes its canvas from the window
  function open() {
    const row = document.getElementById("sequencer_main_row"); if (!row) return;
    if (!box) build();
    if (!panelOpen()) row.insertAdjacentElement("afterend", box);
    LS.set("osg-fx-open", "1"); document.getElementById("osg-fx-link")?.parentElement.classList.add("active");
    shownInst = null; render(); relayout(); setTimeout(relayout, 60);
  }
  function close() { if (!panelOpen()) return; box.remove(); LS.set("osg-fx-open", "0"); document.getElementById("osg-fx-link")?.parentElement.classList.remove("active"); closeMenu(); relayout(); setTimeout(relayout, 60); }
  function toggle() { if (panelOpen()) close(); else open(); }
  function addNavLink() {
    const ul = document.querySelector("#nav ul"); if (!ul || document.getElementById("osg-fx-link")) return;
    const li = document.createElement("li"), a = document.createElement("a"); a.id = "osg-fx-link"; a.href = "javascript:;"; a.textContent = "FX"; a.title = "Effects dock for the current instrument"; a.onclick = toggle; li.appendChild(a);
    const after = document.getElementById("osg-layers-link")?.parentElement;
    if (after && after.parentElement === ul) after.insertAdjacentElement("afterend", li); else { const before = document.getElementById("osg-tools-link")?.parentElement || document.getElementById("ad_container"); if (before && before.parentElement === ul) ul.insertBefore(li, before); else ul.appendChild(li); }
  }
  let tries = 0;
  const boot = setInterval(() => {
    if (++tries > 600) return clearInterval(boot);
    if (!document.getElementById("sequencer_main_row") || typeof song === "undefined" || typeof setPan !== "function") return;
    addNavLink();
    if (!pollT) pollT = setInterval(refreshValues, 300);
    if (tries > 4 || document.getElementById("osg-fx-link")) { clearInterval(boot); if (LS.get("osg-fx-open") === "1") setTimeout(open, 800); }
  }, 500);
  window.osgFx = { open, close, toggle, render };
})();
