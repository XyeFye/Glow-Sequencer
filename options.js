/* Glow Theme for Online Sequencer — Instrument options extras. Runs in the page (MAIN world) on the editor.
   - Every slider in the Advanced and Synthesizer tabs gets an exact, editable number next to it (type a value to set it).
   - Copy / Load of instrument settings also carries the Synthesizer tab (the site keeps the target's synth on Load).
   - Presets: save the current instrument's settings under a name (kept in this browser) and apply them to any
     instrument later, from a small menu next to Copy / Load. */
(function () {
  "use strict";
  if (window.__osgOptions) return; window.__osgOptions = true;
  const LS = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const toast = (m) => { try { message(m, 3, true); } catch (e) {} };

  // ---------- exact values beside the sliders ----------
  // how each slider's number is shown: [digits, unit, scale (slider value × scale = shown value)]
  const FORMATS = {
    advanced_volume: [0, "%", 100], advanced_pan: [0, "", 100], advanced_detune: [0, "¢", 1], advanced_reverb_volume: [0, "%", 100], advanced_distort_volume: [0, "%", 100],
    advanced_eq_high: [0, "dB", 1], advanced_eq_mid: [0, "dB", 1], advanced_eq_low: [0, "dB", 1], advanced_attack: [2, "s", 1], advanced_release: [2, "s", 1], advanced_bitcrusher_level: [0, "%", 100],
    synth_filter: [0, "Hz", 1], synth_filter_q: [0, "Q", 1], synth_lfo_intensity: [0, "%", 1], synth_attack: [2, "", 1], synth_decay: [2, "", 1], synth_sustain: [2, "", 1], synth_release: [2, "", 1],
  };
  const fmtOf = (slider) => FORMATS[slider.id.replace(/^instrument_options_/, "")] || [+(String(slider.step).split(".")[1] || "").length || 0, "", 1];
  function readoutFor(slider) {
    const [digits, unit, scale] = fmtOf(slider);
    const wrap = document.createElement("span"); wrap.className = "osg-readout" + (slider.classList.contains("slider_v") ? " osg-readout-v" : "");
    const inp = document.createElement("input"); inp.type = "number"; inp.className = "osg-readout-in"; inp.title = "Exact value — type a number to set it";
    inp.min = (+slider.min * scale).toString(); inp.max = (+slider.max * scale).toString(); inp.step = scale === 1 ? slider.step : (+slider.step * scale).toString();
    const u = document.createElement("span"); u.className = "osg-readout-unit"; u.textContent = unit;
    wrap.append(inp, u);
    const show = () => { const v = +slider.value * scale; const txt = slider.id.endsWith("advanced_pan") ? v.toFixed(0) : v.toFixed(digits); if (document.activeElement !== inp) inp.value = txt; inp.dataset.v = txt; };
    inp.addEventListener("change", () => { let v = parseFloat(inp.value); if (!isFinite(v)) { show(); return; } v = Math.max(+inp.min, Math.min(+inp.max, v)) / scale; slider.value = v; slider.dispatchEvent(new Event("input", { bubbles: true })); slider.dispatchEvent(new Event("change", { bubbles: true })); show(); });
    for (const ev of ["keydown", "keyup", "keypress"]) inp.addEventListener(ev, (e) => { e.stopPropagation(); if (ev === "keydown" && e.key === "Enter") inp.blur(); });
    inp.addEventListener("wheel", (e) => { e.stopPropagation(); });
    slider.addEventListener("input", show);
    slider.__osgShow = show; show();
    return wrap;
  }
  const ROOTS = ["instrument_options_advanced", "instrument_options_synth"];   // (the Simple tab's instrument list keeps its plain sliders)
  function addReadouts() {
    for (const id of ROOTS) for (const slider of (document.getElementById(id) || document.createElement("div")).querySelectorAll('input[type="range"]')) {
      if (slider.__osgShow) continue;
      const ro = readoutFor(slider);
      if (slider.classList.contains("slider_v")) {   // the synth's A D S R columns are too narrow: their numbers go in one row under the envelope
        const adsr = slider.closest("#instrument_options_synth_adsr"), block = (adsr && adsr.parentElement.classList.contains("instrument_options_synth_row")) ? adsr.parentElement : (adsr || slider.parentElement.parentElement);   // under the whole envelope row (graph + sliders)
        let row = block.nextElementSibling && block.nextElementSibling.classList.contains("osg-readout-row") ? block.nextElementSibling : null;
        if (!row) { row = document.createElement("div"); row.className = "osg-readout-row"; block.insertAdjacentElement("afterend", row); }
        const lab = (slider.parentElement.querySelector("p") || {}).textContent || ""; const l = document.createElement("span"); l.className = "osg-readout-lab"; l.textContent = lab.trim();
        ro.prepend(l); row.appendChild(ro);
      } else { const line = slider.closest(".slider_line"); if (line) line.insertAdjacentElement("afterend", ro); else slider.insertAdjacentElement("afterend", ro); }
    }
  }
  function refreshReadouts() { const root = document.getElementById("instrument_options"); if (!root || root.offsetParent === null) return; for (const id of ROOTS) for (const s of (document.getElementById(id) || document.createElement("div")).querySelectorAll('input[type="range"]')) if (s.__osgShow) s.__osgShow(); }

  // ---------- Copy / Load with the Synthesizer tab ----------
  let protoText = null;   // the last settings copied in this session (the clipboard may not be readable)
  function serialize(i) { const p = getInstrumentSettingsProto(i); return goog.crypt.base64.encodeByteArray(p.serializeBinary()); }
  function applyText(i, text, label) {
    const instProto = proto.InstrumentSettings.deserializeBinary(text);
    const parsed = parseInstrumentSettingsProto(instProto);
    const synthToo = !!(instMgr.isCustomSynth(i) && typeof instProto.hasSynth === "function" && instProto.hasSynth() && parsed.synth);
    const backup = song.settings.instruments[i] && song.settings.instruments[i].synth;
    song.settings.instruments[i] = parsed;
    loadInstrumentSettings(i);
    if (!synthToo) song.settings.instruments[i].synth = backup;
    else { try { updateSynth(i); } catch (e) {} }
    try { fillAdvancedInstrumentSettings(); } catch (e) {}
    try { updateUiForInstrumentClones(); } catch (e) {}
    setConfirmExit(true); refreshReadouts();
    toast((label || "Settings loaded") + (synthToo ? " (with the Synthesizer tab)." : "."));
  }
  function hookCopyLoad() {
    const oc = window.copyInstrumentSettings, op = window.pasteInstrumentSettings; if (typeof oc !== "function" || typeof op !== "function" || oc.__osg) return;
    window.copyInstrumentSettings = function (i) { try { protoText = serialize(i); } catch (e) {} return oc.apply(this, arguments); };
    window.copyInstrumentSettings.__osg = true;
    window.pasteInstrumentSettings = async function (i) {
      let text = null; try { text = await navigator.clipboard.readText(); } catch (e) {}
      if (!text || !/^[A-Za-z0-9+/=]+$/.test(text.trim())) text = protoText;
      if (!text) { toast("Copy instrument settings first."); return; }
      try { applyText(i, text.trim(), "Settings loaded"); } catch (e) { console.log(e); toast("Copy instrument settings first."); }
    };
  }

  // ---------- named presets ----------
  const KEY = "osg-inst-presets";
  const presets = () => { try { const a = JSON.parse(LS.get(KEY) || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
  const savePresets = (a) => LS.set(KEY, JSON.stringify(a.slice(0, 200)));
  let menu = null;
  function closeMenu() { if (menu) { (window.__osgPopOut || ((e) => e.remove()))(menu); menu = null; } }
  function openMenu(anchor) {
    closeMenu();
    const i = instrument, list = presets();
    menu = document.createElement("div"); menu.id = "osg-preset-menu";
    menu.innerHTML = `<div class="osg-pm-head">Presets <small>kept in this browser</small></div>
      <button type="button" class="osg-pm-item osg-pm-save" data-act="save">＋ Save current settings as…</button>
      ${list.length ? list.map((p, k) => `<div class="osg-pm-row"><button type="button" class="osg-pm-item" data-act="apply" data-k="${k}" title="${esc(p.base || "")}${p.synth ? " · includes synthesizer" : ""}">${esc(p.name)}<small>${esc(p.base || "")}${p.synth ? " · synth" : ""}</small></button><button type="button" class="osg-pm-x" data-act="del" data-k="${k}" title="Delete preset">✕</button></div>`).join("") : `<div class="osg-pm-empty">No presets yet.</div>`}`;
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect(); menu.style.left = Math.max(6, Math.min(innerWidth - menu.offsetWidth - 6, r.left)) + "px"; menu.style.top = (r.bottom + 4 + menu.offsetHeight > innerHeight ? r.top - menu.offsetHeight - 4 : r.bottom + 4) + "px";
    menu.addEventListener("click", (e) => {
      const b = e.target.closest("[data-act]"); if (!b) return; const act = b.dataset.act, k = +b.dataset.k;
      if (act === "save") {
        const name = prompt("Preset name", instMgr.getDefaultName(i) + " preset"); if (!name) return;
        try { const a = presets(); a.unshift({ name: name.trim().slice(0, 60), base: instMgr.getDefaultName(i), synth: !!instMgr.isCustomSynth(i), data: serialize(i), when: Date.now() }); savePresets(a); toast(`Preset "${name.trim()}" saved.`); } catch (err) { toast("Couldn't save the preset."); }
        closeMenu();
      } else if (act === "apply") { const p = presets()[k]; if (!p) return; try { applyText(i, p.data, `Preset "${p.name}" applied`); } catch (err) { toast("Couldn't apply that preset."); } closeMenu(); }
      else if (act === "del") { const a = presets(); const p = a[k]; if (p && confirm(`Delete preset "${p.name}"?`)) { a.splice(k, 1); savePresets(a); openMenu(anchor); } }
    });
  }
  function addPresetButton() {
    const copy = document.getElementById("instrument_options_copy"); if (!copy || document.getElementById("osg_presets_btn")) return;
    const b = document.createElement("div"); b.id = "osg_presets_btn"; b.className = "button"; b.innerHTML = "Presets ▾"; b.title = "Save this instrument's settings as a named preset, or apply a saved one";
    b.onclick = (e) => { e.stopPropagation(); if (menu) closeMenu(); else openMenu(b); };
    (document.getElementById("instrument_options_load") || copy).insertAdjacentElement("afterend", b);
    document.addEventListener("pointerdown", (e) => { if (menu && !e.target.closest("#osg-preset-menu, #osg_presets_btn")) closeMenu(); }, true);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && menu) closeMenu(); }, true);
  }

  // ---------- boot ----------
  let tries = 0;
  const boot = setInterval(() => {
    if (++tries > 600) return clearInterval(boot);
    if (!document.getElementById("instrument_options") || typeof getInstrumentSettingsProto !== "function" || typeof instrument === "undefined") return;
    clearInterval(boot);
    addReadouts(); hookCopyLoad(); addPresetButton();
    setInterval(() => { addReadouts(); refreshReadouts(); }, 250);   // the site sets slider values directly when the instrument changes
  }, 500);
})();
