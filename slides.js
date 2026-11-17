/* Glow Theme for Online Sequencer — Slide notes, the FL Studio way.
   Runs in the page (MAIN world) on the editor.

   In FL Studio's piano roll a slide note doesn't sound by itself: it bends whatever is already playing on its channel
   to its own pitch, taking its own length to get there, and the bent note stays there (or follows the next slide note)
   until it ends. Here the channel is the instrument itself — no extra instrument is made:

   - A slide note is a silent note on the instrument, marked as a slide. Its volume is a tiny signature value (0.001,
     with the curve encoded in the last digit) so that it is still recognised as a slide note after a save and reload
     even if its markers are gone. On the grid it carries a small triangle, and the note it bends shows its pitch path.
   - A note that is sounding when a slide note starts glides to the slide note's pitch over the slide note's length.
     Slide notes chain. (Detune is per instrument, so other notes of the instrument sounding at that moment bend by
     the same amount — the same thing people without the extension will hear.)
   - The glide is written out as the site's own Detune markers on the instrument, which is what the site's player
     performs for people without the extension. The extension only manages markers inside the span of a note that a
     slide bends; detune markers anywhere else on the instrument are the user's own and are left alone.
   - With the extension the markers are never applied: the site's marker handling is switched off for instruments
     that have slide notes, and playback instead automates each voice's own detune along the same timeline. Nothing
     instrument-wide changes, so stopping mid-glide, previews and the keyboard are unaffected.

   Shift+click an empty cell (Draw mode) places a slide note for the current instrument; the toolbar button next to
   the eraser does the same without Shift. Shift+right-click a note for a small sheet (what it bends, preview, make
   it a normal / slide note, delete). Detune markers on an instrument with slide notes are managed by the extension. */
(function () {
  "use strict";
  if (window.__osgSlides) return; window.__osgSlides = true;

  const FLAG = "__osgSlide";                // on a note: it is a slide note
  const CURVE = "__osgCurve";               // on a slide note: how it glides (linear unless set)
  const CURVES = { linear: (p) => p, easeIn: (p) => p * p, easeOut: (p) => 1 - (1 - p) * (1 - p), smooth: (p) => p * p * (3 - 2 * p) };
  const CURVE_NAMES = { linear: "Linear", easeIn: "Ease in (slow start, fast end)", easeOut: "Ease out (fast start, slow end)", smooth: "Smooth (S-curve)" };
  const CURVE_ORDER = ["linear", "easeIn", "easeOut", "smooth"];
  const curveOf = (n) => (n && CURVES[n[CURVE]] ? n[CURVE] : "linear");
  const DETUNE = 11;                        // kMarkerSettingInstrumentDetune
  const SILENT = 0.002;                   // a note at or under this volume is silent
  // A slide note's volume is a tiny signature value that also carries its curve, so the note stays a slide note after a
  // save and reload even if its markers were lost; the site stores volumes as 32-bit floats, hence the tolerance.
  const SIG = { linear: 0.001, easeIn: 0.0011, easeOut: 0.0012, smooth: 0.0013 };
  const volFor = (curve) => SIG[curve] || SIG.linear;
  const sigCurve = (v) => { for (const k in SIG) if (Math.abs(v - SIG[k]) < 2e-5) return k; return null; };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const unesc = (s) => { const t = document.createElement("textarea"); t.innerHTML = s; return t.value; };
  const toast = (m) => { try { message(m); } catch (e) {} };
  let slideMode = false;

  // ---------- helpers around the editor's own state ----------
  const live = () => (typeof song !== "undefined" && song && Array.isArray(song.notes) ? song.notes : []);
  const rowOf = (type) => pianoToIndex[type];
  const instSettings = (i) => { try { return song.getInstrumentSettings(i); } catch (e) { return null; } };
  const baseDetune = (i) => { const s = instSettings(i); const v = s && parseFloat(s.detune); return isFinite(v) ? v : 0; };
  const dispName = (i) => { try { return unesc(getInstrumentName(song, i)); } catch (e) { return "Instrument " + i; } };
  const instColor = (i) => { try { const c = getInstrumentColor(song, i); return `rgb(${c[1]},${c[2]},${c[3]})`; } catch (e) { return "#fff"; } };
  const t0Of = (n) => Math.floor(n.time);
  const t1Of = (n) => t0Of(n) + Math.max(1, Math.round(n.length));
  const isSilent = (n) => !(n.volume > SILENT);
  const isSlide = (n) => !!(n && !n.deleted && n[FLAG] && isSilent(n));
  const onInst = (inst) => live().filter((n) => !n.deleted && n.instrument === inst);
  const beatName = (t) => `${Math.floor(t / 16) + 1}.${Math.floor((t % 16) / 4) + 1}${t % 4 ? "+" + (t % 4) : ""}`;
  const markersOf = (inst) => (song.markers && song.markers[DETUNE] && song.markers[DETUNE][inst]) || [];

  // instruments whose detune markers this feature manages: any with a slide note now, plus any that had one this session
  const managed = new Set();
  function slideInsts() { for (const n of live()) if (isSlide(n)) managed.add(n.instrument); return managed; }
  const isManaged = (i) => managed.has(i);

  // ---------- reading slides back from a saved sequence ----------
  // A silent note whose end carries a blended detune marker on its instrument is a slide note (that marker is what the
  // site plays the glide from). Checked for every unmarked silent note each time, so it also works while a sequence
  // is still loading, and for notes pasted in from elsewhere.
  function adopt() {
    for (const n of live()) {
      if (n.deleted || n[FLAG] || !isSilent(n)) continue;
      const sig = sigCurve(n.volume);
      if (sig) { n[FLAG] = true; if (sig !== "linear") n[CURVE] = sig; managed.add(n.instrument); continue; }
      // older slide notes (volume 0): recognised by the blended detune marker the glide ends on, anywhere inside the note
      const a = markersOf(n.instrument); if (!a.length) continue;
      const t0 = t0Of(n), t1 = t1Of(n); if (!a.some((m) => m.blend && m.time > t0 && m.time <= t1)) continue;
      n[FLAG] = true; managed.add(n.instrument); n.volume = volFor("linear");
      // the glide's shape: one blended marker is linear; several between the slide's start and end tell the curve
      const inside = a.filter((m) => m.blend && m.time > t0 && m.time <= t1); let startV = null; for (const m of a) if (!m.blend && m.time <= t0) startV = m.value;
      if (inside.length > 1 && startV != null) { const endV = inside[inside.length - 1].value, span = endV - startV; if (span) { let above = 0, below = 0; for (const m of inside.slice(0, -1)) { const p = (m.time - t0) / (t1 - t0), v = (m.value - startV) / span; if (v > p + 0.04) above++; else if (v < p - 0.04) below++; } n[CURVE] = above && below ? "smooth" : above ? "easeOut" : below ? "easeIn" : "linear"; n.volume = volFor(n[CURVE]); } }
    }
  }

  // ---------- what bends what ----------
  // Per instrument: per sounding note { note, slides: [{ slide, from, to }] } (semitone offsets at the start and end of
  // each slide), and per slide note { slide, base (the note it bends, or null), from, to }.
  function analyse(inst) {
    const notes = onInst(inst), sounding = notes.filter((n) => !isSilent(n)).sort((a, b) => a.time - b.time), slides = notes.filter(isSlide).sort((a, b) => a.time - b.time);
    const bases = sounding.map((n) => ({ note: n, slides: [] })), bySlide = new Map();
    for (const s of slides) {
      const s0 = t0Of(s);
      // the note it bends: the most recently started note still sounding when the slide starts (closest pitch breaks ties)
      let best = null, bestScore = -Infinity;
      for (const b of bases) { const n = b.note, t0 = t0Of(n), t1 = t1Of(n); if (t0 > s0 || t1 <= s0) continue; const score = t0 * 1000 - Math.abs(rowOf(n.type) - rowOf(s.type)); if (score > bestScore) { bestScore = score; best = b; } }
      const rec = { slide: s, base: best ? best.note : null, from: 0, to: 0 };
      if (best) { const prev = best.slides[best.slides.length - 1]; rec.from = prev ? prev.to : 0; rec.to = rowOf(best.note.type) - rowOf(s.type); rec.curve = curveOf(s); best.slides.push(rec); }
      bySlide.set(s, rec);
    }
    // per bent note: its segments, in units from its own start
    const byNote = new Map();
    for (const b of bases) { if (!b.slides.length) continue; const t0 = t0Of(b.note); byNote.set(b.note, b.slides.map((r) => { const s0 = Math.max(t0, t0Of(r.slide)), s1 = Math.max(s0 + 1, t1Of(r.slide)); return { from: r.from, to: r.to, s0: s0 - t0, s1: s1 - t0, curve: r.curve }; })); }
    return { bases, bySlide, byNote };
  }
  // the detune markers one instrument should carry: the instrument's pitch-offset timeline
  function wantedFor(inst) {
    const { bases } = analyse(inst), base = baseDetune(inst), list = [];
    for (const b of bases) {
      if (!b.slides.length) continue;
      const t0 = t0Of(b.note), t1 = t1Of(b.note);
      list.push({ time: t0, value: base, blend: false, start: true });
      for (const r of b.slides) {
        const s0 = Math.max(t0, t0Of(r.slide)), s1 = Math.max(s0 + 1, Math.min(t1, t1Of(r.slide))), f = CURVES[r.curve] || CURVES.linear;   // (a slide running past the note's end stops with it)
        list.push({ time: s0, value: base + r.from * 100, blend: false, start: s0 === t0 });
        const segs = r.curve && r.curve !== "linear" ? Math.min(4, s1 - s0) : 1;   // a curve becomes a few straight pieces (markers sit on sixteenths)
        for (let k = 1; k <= segs; k++) { const t = k === segs ? s1 : Math.round(s0 + (s1 - s0) * k / segs); if (t <= s0 || (k < segs && t >= s1)) continue; list.push({ time: t, value: base + (r.from + (r.to - r.from) * f(k / segs)) * 100, blend: true }); }
      }
      list.push({ time: t1, value: base, blend: false, reset: true });   // back to normal the moment the bent note ends
    }
    // a reset is pointless where another bent note starts; among markers at one time the later one wins
    const starts = new Set(list.filter((m) => m.start).map((m) => m.time));
    const keep = list.filter((m) => !(m.reset && starts.has(m.time)));
    const byKey = new Map(); for (const m of keep) byKey.set(m.time + "|" + (m.blend ? 1 : 0), m);
    return [...byKey.values()].sort((a, b) => a.time - b.time || (a.blend ? 0 : 1) - (b.blend ? 0 : 1));
  }
  let cache = new Map();   // inst → { analysis, timeline }, rebuilt after every change
  function analysed(inst) { let a = cache.get(inst); if (!a) { a = analyse(inst); a.timeline = wantedFor(inst); cache.set(inst, a); } return a; }

  let syncing = false, ready = false;   // until a saved sequence has finished loading, markers are only added, never taken away
  function syncInst(inst) {
    const a = analysed(inst), want = a.timeline, have = markersOf(inst).slice();
    const key = (m) => `${m.time}|${+m.value.toFixed(3)}|${m.blend ? 1 : 0}`;
    const haveKeys = new Set(have.map(key)), wantKeys = new Set(want.map(key));
    // the stretches this feature owns: the span of every note that a slide bends; markers elsewhere are the user's own
    const spans = a.bases.filter((b) => b.slides.length).map((b) => [t0Of(b.note), t1Of(b.note)]);
    const owned = (m) => spans.some(([t0, t1]) => m.time >= t0 && m.time <= t1);
    let changed = false;
    if (ready) for (const m of have) if (!wantKeys.has(key(m)) && owned(m)) { song.removeMarker(m); changed = true; }
    for (const m of want) if (!haveKeys.has(key(m))) { song.addMarker(new Marker(song, m.time, DETUNE, inst, m.value, m.blend)); changed = true; }
    return changed;
  }
  function syncAll() {
    if (syncing || typeof song === "undefined") return; syncing = true; cache = new Map();
    try {
      adopt();
      let changed = false; for (const i of slideInsts()) if (syncInst(i)) changed = true;
      if (changed) { try { updateMarkers(); onMarkerValueChange(DETUNE, false); } catch (e) {} }
    } finally { syncing = false; }
    render();
  }

  // ---------- placing, converting, deleting ----------
  function insertSlide(time, type, inst) {
    const remember = typeof settings !== "undefined" && settings.user && settings.user.remember_length === "true";
    const length = Math.max(1, remember ? (lastNoteLength.get(inst) ?? 1 / grid) : 1 / grid);
    const note = new Note(song, type, time, length, inst, volFor("linear")); note[FLAG] = true; managed.add(inst);
    instMgr.ensureLoaded(inst);
    exec(() => { song.addNote(note); song.updateLoopTime(); SequencerView.repaint(kRepaintNotesMoved); syncAll(); },
      () => { song.removeNote(note); song.updateLoopTime(); SequencerView.repaint(kRepaintNotesMoved); syncAll(); });
    try { selection.clear(); selection.selectNote(note); updateSelection(); } catch (e) {}
    setConfirmExit(true);
    const r = analysed(inst).bySlide.get(note);
    if (r && r.base) preview(note); else toast("Slide note placed. It bends a note of " + dispName(inst) + " that is sounding when it starts — place it over one.");
    return note;
  }
  function setSlide(notes, on, label) {
    const changes = notes.map((n) => [n, n.volume, !!n[FLAG]]);
    const apply = (slide) => { for (const [n, vol, flag] of changes) { if (slide == null) { n.volume = vol; n[FLAG] = flag; } else { n.volume = slide ? volFor(curveOf(n)) : (vol > SILENT ? vol : 1); n[FLAG] = slide; } if (n[FLAG]) managed.add(n.instrument); } SequencerView.repaint(kRepaintNotesChanged); syncAll(); };
    exec(() => apply(on), () => apply(null));
    setConfirmExit(true); if (label) toast(label);
  }
  function setCurve(notes, curve, label) {
    const changes = notes.map((n) => [n, n[CURVE], n.volume]);
    exec(() => { for (const [n] of changes) { n[CURVE] = curve; if (isSlide(n)) n.volume = volFor(curve); } syncAll(); }, () => { for (const [n, c, v] of changes) { if (c) n[CURVE] = c; else delete n[CURVE]; n.volume = v; } syncAll(); });
    setConfirmExit(true); if (label) toast(label);
  }
  function cycleCurve(n) { const cur = curveOf(n), next = CURVE_ORDER[(CURVE_ORDER.indexOf(cur) + 1) % CURVE_ORDER.length]; const list = n.selected ? selection.notes.filter(isSlide) : [n]; setCurve(list.length ? list : [n], next, `Slide curve: ${CURVE_NAMES[next]}${list.length > 1 ? ` (${list.length} notes)` : ""}`); }
  function deleteNotes(notes) {
    exec(() => { for (const n of notes) song.removeNote(n); try { selection.setNotes(selection.notes.filter((x) => !notes.includes(x))); updateSelection(); } catch (e) {} SequencerView.repaint(kRepaintNotesMoved); syncAll(); },
      () => { for (const n of notes) song.addNote(n); SequencerView.repaint(kRepaintNotesMoved); syncAll(); });
    setConfirmExit(true);
  }

  // ---------- playback: bend the voice itself ----------
  // The instrument's timeline (the same one the markers describe) is applied to each voice's own detune AudioParam
  // when the note is scheduled. While a note is being scheduled the audio system "tracks" the voice(s) it makes, which
  // is how they are caught here.
  function capture(fn) {
    const as = audioSystem, got = [], own1 = Object.prototype.hasOwnProperty.call(as, "trackNote"), own2 = Object.prototype.hasOwnProperty.call(as, "trackNoteByTimeout"), o1 = as.trackNote, o2 = as.trackNoteByTimeout;
    as.trackNote = function (i, v) { got.push(v); return o1.call(this, i, v); };
    as.trackNoteByTimeout = function (i, v, off) { got.push(v); return o2.call(this, i, v, off); };
    try { fn(); } finally { if (own1) as.trackNote = o1; else delete as.trackNote; if (own2) as.trackNoteByTimeout = o2; else delete as.trackNoteByTimeout; }
    return got;
  }
  // play `type` on `inst` for `length` units after `delay` s, bending it along `segs` ({from,to,s0,s1,curve}, units from its start)
  function playBent(inst, type, length, delay, volume, segs, off) {
    const as = audioSystem, unit = song.sleepTime / 1000, base = baseDetune(inst), start = as.time() + (delay || 0) + (instMgr.isSynth(inst) ? 0.01 : 0);
    const voices = capture(() => playNote(inst, type, length, delay, !as.offline, volume, true));
    if (!voices.length || !segs.length) return;
    const io = as.instruments.get(inst), base0 = io && isFinite(io.detune) ? io.detune : base; off = off || 0;
    for (const v of voices) {
      const d = v && v.detune; if (!d) continue; const b = base0 + (+v.initDetune || 0);
      try {
        d.cancelScheduledValues(start); d.setValueAtTime(b + segs[0].from * 100, start);
        for (const r of segs) {
          const a0 = start + (r.s0 - off) * unit, a1 = start + (r.s1 - off) * unit, f = CURVES[r.curve] || CURVES.linear;
          if (a1 <= start) { d.setValueAtTime(b + r.to * 100, start); continue; }
          d.setValueAtTime(b + r.from * 100, Math.max(start, a0));
          const steps = r.curve && r.curve !== "linear" ? 8 : 1;
          for (let k = 1; k <= steps; k++) { const at = a0 + (a1 - a0) * k / steps; if (at <= start) continue; d.linearRampToValueAtTime(b + (r.from + (r.to - r.from) * f(k / steps)) * 100, at); }
        }
      } catch (e) {}
    }
  }
  // hear a slide outside playback: the note it bends, from this slide's start, with whatever follows it
  function preview(s) {
    const a = analysed(s.instrument), r = a.bySlide.get(s); if (!r || !r.base) return;
    const n = r.base, t0 = t0Of(n), segs = a.byNote.get(n) || [], from = Math.max(t0, t0Of(s)) - t0;
    const rest = segs.filter((g) => g.s1 > from); if (!rest.length) return;
    playBent(s.instrument, n.type, Math.max(1, t1Of(n) - t0 - from), 0, n.volume, rest, from);
  }

  // ---------- drawing: FL-style slide triangle on each slide note, and the bend path on the note it bends ----------
  let layer = null, renderQueued = false;
  function render() {
    if (renderQueued) return; renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      const inner = document.getElementById("sequencer_inner"); if (!inner) return;
      if (!layer || layer.parentElement !== inner) { layer = document.createElement("div"); layer.id = "osg-slides"; inner.appendChild(layer); }
      let html = "";
      for (const inst of slideInsts()) {
        const { bases, bySlide } = analysed(inst), col = instColor(inst);
        for (const [s, r] of bySlide) {
          const x = s.time * noteWidth, y = rowOf(s.type) * noteHeight, w = s.length * noteWidth, h = noteHeight, tri = Math.min(h - 4, 9), len = t1Of(s) - t0Of(s);
          html += `<div class="osg-slide-note${r.base ? "" : " orphan"}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;--c:${col}" title="${r.base ? `Slide note: bends ${esc(r.base.type)} to ${esc(s.type)} over ${len} sixteenth${len === 1 ? "" : "s"}, ${CURVE_NAMES[curveOf(s)].toLowerCase()}` : "Slide note: nothing is sounding here for it to bend"}. Shift+click to change the curve, Shift+right-click for options"><svg width="${w}" height="${h}"><polygon points="${w - 2 - tri},2 ${w - 2},2 ${w - 2},${2 + tri}"/></svg></div>`;
        }
        for (const b of bases) {
          if (!b.slides.length) continue;
          const n = b.note, t0 = t0Of(n), t1 = t1Of(n), row = rowOf(n.type), mid = noteHeight / 2, pts = [`${t0 * noteWidth},${row * noteHeight + mid}`];
          for (const r of b.slides) { const s0 = Math.max(t0, t0Of(r.slide)), s1 = Math.max(s0 + 1, t1Of(r.slide)), f = CURVES[r.curve] || CURVES.linear, N = r.curve && r.curve !== "linear" ? 12 : 1; for (let k = 0; k <= N; k++) { const q = k / N; pts.push(`${((s0 + (s1 - s0) * q) * noteWidth).toFixed(1)},${((row - (r.from + (r.to - r.from) * f(q))) * noteHeight + mid).toFixed(1)}`); } }
          const last = b.slides[b.slides.length - 1], xEnd = Math.max(t1, t1Of(last.slide)) * noteWidth; pts.push(`${xEnd},${(row - last.to) * noteHeight + mid}`);
          html += `<svg class="osg-slide-path" style="--c:${col}" width="${xEnd + 4}" height="${(piano.length + 1) * noteHeight}"><polyline points="${pts.join(" ")}"/></svg>`;
        }
      }
      layer.innerHTML = html;
    });
  }

  // ---------- the little sheet on Shift+right-click ----------
  let pop = null;
  function closeSheet() { if (pop) { (window.__osgPopOut || ((e) => e.remove()))(pop); pop = null; } }
  function openSheet(n, x, y) {
    closeSheet();
    const slide = isSlide(n), r = slide ? analysed(n.instrument).bySlide.get(n) : null, len = t1Of(n) - t0Of(n);
    const sel = n.selected ? selection.notes.filter((m) => !m.deleted && m.annotation == null && isSlide(m) === slide) : [n];
    const many = sel.length > 1, who = esc(dispName(n.instrument));
    pop = document.createElement("div"); pop.id = "osg-slide-editor";
    pop.innerHTML = `<div class="osg-popup-title"><span>${slide ? "Slide note" : "Note"} — ${esc(n.type)}${many ? ` <small>+${sel.length - 1} selected</small>` : ""}</span><button type="button" class="osg-popup-x" data-act="close" aria-label="Close">✕</button></div>
      <div class="osg-popup-body">
        ${slide ? (r && r.base ? `<div class="osg-field"><span>Bends</span><b>${esc(r.base.type)} → ${esc(n.type)}</b><em>over ${len} sixteenth${len === 1 ? "" : "s"} from ${beatName(t0Of(n))}${r.from ? ` (already ${r.from > 0 ? "+" : ""}${r.from} semitones from an earlier slide)` : ""}</em></div>`
          : `<div class="osg-field"><span>Bends</span><b>nothing yet</b><em>no note of ${who} is sounding when this slide starts</em></div>`)
          : `<div class="osg-field"><span>On</span><b>${who}</b><em>${isSilent(n) ? "a silent note" : "a sounding note — slide notes placed over it bend it"}</em></div>`}
        ${slide ? `<label class="osg-field"><span>Curve</span><select data-f="curve">${CURVE_ORDER.map((c) => `<option value="${c}"${c === curveOf(n) ? " selected" : ""}>${CURVE_NAMES[c]}</option>`).join("")}</select><em>how the pitch travels over the slide note's length</em></label>` : ""}
        <div class="osg-popup-actions">${slide ? `<button type="button" data-act="play">▶ Preview</button><button type="button" data-act="normal">Make it a normal note</button>` : `<button type="button" data-act="slide">Make it a slide note</button>`}<button type="button" class="danger" data-act="delete">Delete${many ? " all" : ""}</button></div>
        <div class="osg-popup-hint">Like FL Studio: a slide note is silent and bends whatever is playing on ${who} to its pitch, taking its own length to get there. Shift+click an empty cell to add one.</div>
      </div>`;
    document.body.appendChild(pop);
    pop.style.left = Math.max(6, Math.min(innerWidth - pop.offsetWidth - 6, x + 8)) + "px"; pop.style.top = Math.max(6, Math.min(innerHeight - pop.offsetHeight - 6, y + 8)) + "px";
    const cur = pop.querySelector("[data-f=curve]"); if (cur) cur.onchange = () => setCurve(sel, cur.value, `Slide curve: ${CURVE_NAMES[cur.value]}${many ? ` (${sel.length} notes)` : ""}`);
    pop.addEventListener("click", (e) => {
      const b = e.target.closest("[data-act]"); if (!b) return; const act = b.dataset.act;
      if (act === "close") closeSheet();
      else if (act === "play") preview(n);
      else if (act === "normal") { setSlide(sel, false, many ? `${sel.length} notes are normal notes now.` : "It's a normal note now."); closeSheet(); }
      else if (act === "slide") { setSlide(sel, true, many ? `${sel.length} notes are slide notes now.` : "It's a slide note now."); closeSheet(); }
      else if (act === "delete") { deleteNotes(sel); closeSheet(); }
    });
    for (const ev of ["keydown", "keyup", "keypress"]) pop.addEventListener(ev, (e) => { e.stopPropagation(); if (ev === "keydown" && e.key === "Escape") closeSheet(); });
    for (const ev of ["mousedown", "pointerdown", "contextmenu"]) pop.addEventListener(ev, (e) => e.stopPropagation());
  }

  // ---------- mouse: Shift+click places, Shift+right-click opens the sheet ----------
  const noteAt = (e) => { try { return noteFromPoint(e.clientX, e.clientY, false) || null; } catch (err) { return null; } };
  function cellAt(e) { const x = xPosition(e.clientX), y = yPosition(e.clientY); if (x < 0 || y < 0) return null; const type = piano[noteIndex(y)]; const time = timeIndex(x); if (type == null || !(time >= 0)) return null; return { time, type }; }
  function wire() {
    const main = document.getElementById("sequencer_main"); if (!main || main.__osgSlides) return; main.__osgSlides = true;
    main.addEventListener("mousedown", (e) => {
      if (typeof isPlayerMode !== "undefined" && isPlayerMode) return;
      if (e.button === 2 && e.shiftKey) { if (noteAt(e)) { e.preventDefault(); e.stopPropagation(); } return; }
      if (e.button !== 0) return;
      const wantSlide = (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) || (slideMode && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey);
      if (!wantSlide || (mode !== "draw" && !slideMode)) return;   // (in Edit mode Shift+drag is the site's add-to-selection box)
      const hit = noteAt(e);
      if (hit) { if (e.shiftKey && isSlide(hit)) { e.preventDefault(); e.stopPropagation(); cycleCurve(hit); } return; }   // Shift+click on a slide note: next curve; on other notes the site's own add-to-selection
      const cell = cellAt(e); if (!cell) return;
      if (instMgr.isLocked(instrument)) { toast("That instrument is locked."); return; }
      e.preventDefault(); e.stopPropagation();
      insertSlide(cell.time, cell.type, instrument);
    }, true);
    main.addEventListener("contextmenu", (e) => {
      if (!e.shiftKey) return; const n = noteAt(e); if (!n || n.annotation != null) return;
      e.preventDefault(); e.stopPropagation(); openSheet(n, e.clientX, e.clientY);
    }, true);
    document.addEventListener("pointerdown", (e) => { if (pop && !pop.contains(e.target)) closeSheet(); }, true);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && pop) closeSheet(); }, true);
  }
  function addButton() {
    const erase = document.getElementById("mode_erase"); if (!erase || document.getElementById("osg_mode_slide")) return;
    const b = document.createElement("div"); b.className = "btn"; b.id = "osg_mode_slide"; b.title = "Slide notes (like FL Studio): click to place one, or Shift+click any time. A slide note bends the note playing under it to its pitch over its own length. Shift+right-click a note for options.";
    b.innerHTML = '<svg class="osg-slide-glyph" viewBox="0 0 16 16" width="16" height="16"><rect x="1" y="9" width="9" height="5" rx="1.2" fill="currentColor" opacity=".5"/><rect x="7" y="2" width="8" height="5" rx="1.2" fill="currentColor"/><polygon points="8,3 11.5,3 8,6.5" fill="#000" opacity=".6"/></svg>';
    b.onclick = () => { slideMode = !slideMode; b.classList.toggle("active", slideMode); if (slideMode && mode !== "draw") { try { setMode("draw"); } catch (e) {} } toast(slideMode ? "Slide mode: click where a playing note should bend to." : "Slide mode off."); };
    erase.insertAdjacentElement("afterend", b);
  }

  // ---------- hooks: markers and the drawing follow the notes ----------
  let hooked = false, syncT = 0;
  const syncSoon = () => { clearTimeout(syncT); syncT = setTimeout(() => { syncT = 0; syncAll(); }, 80); };
  function hook() {
    if (hooked) return true;
    if (typeof song === "undefined" || typeof SequencerView === "undefined" || typeof Marker === "undefined" || typeof noteFromPoint !== "function" || typeof exec !== "function") return false;
    hooked = true;
    const prev = SequencerView.repaint; SequencerView.repaint = function (flags) { const r = prev.call(this, flags); if (flags) syncSoon(); return r; };
    // copies (paste, duplicate) stay slide notes
    const cn = window.cloneNote; if (typeof cn === "function") window.cloneNote = function (note) { const c = cn.apply(this, arguments); if (note && note[FLAG]) { c[FLAG] = true; if (note[CURVE]) c[CURVE] = note[CURVE]; } return c; };
    // the player: sounding notes on instruments with slides follow the instrument's timeline per voice; everything else as usual
    const PN = Song.prototype.playNotes;
    Song.prototype.playNotes = function (list) {
      if (!list || !managed.size) return PN.call(this, list);
      const allowed = window.osgLayers && typeof osgLayers.filterPlayable === "function" ? osgLayers.filterPlayable(list) : list;   // Layers' mute / solo / export
      const rest = {}; let any = false;
      for (const k in list) {
        const n = list[k];
        if (n && n.annotation == null && !isSilent(n) && isManaged(n.instrument)) { const segs = analysed(n.instrument).byNote.get(n); if (segs) { any = true; if (allowed[k]) playBent(n.instrument, n.type, n.length, song.sleepTime * n.fracTime / 1000, n.volume, segs, 0); continue; } }
        rest[k] = n;
      }
      return PN.call(this, any ? rest : list);
    };
    // the site's own marker handling stays off for those instruments: the markers are only for people without the extension
    for (const fn of ["updateMarkerSetting", "blendMarkerSetting"]) { const o = window[fn]; if (typeof o === "function") window[fn] = function (setting, instId) { if (setting === DETUNE && isManaged(instId)) return; return o.apply(this, arguments); }; }
    const sd = window.setDetune; if (typeof sd === "function") window.setDetune = function () { const r = sd.apply(this, arguments); syncSoon(); return r; };
    return true;
  }
  let tries = 0, songRef = null, lastLen = -1, stable = 0;
  const boot = setInterval(() => {
    if (++tries > 1200) return clearInterval(boot);
    if (!document.getElementById("sequencer")) { if (tries > 100 && typeof song === "undefined") clearInterval(boot); return; }
    if (!hook()) return;
    wire(); addButton();
    if (typeof song !== "undefined" && song !== songRef) { songRef = song; ready = false; stable = 0; lastLen = -1; managed.clear(); syncAll(); }
    // a saved sequence arrives in pieces: no marker may be removed until its notes have stopped changing
    const len = live().length; if (len === lastLen) stable++; else { stable = 0; lastLen = len; }
    if (!ready && (stable >= 4 || (!/^\/\d+/.test(location.pathname) && stable >= 1))) { ready = true; syncAll(); }
  }, 500);
  window.osgSlides = { insert: insertSlide, sheet: openSheet, sync: syncAll, isSlide, analyse, timeline: (i) => analysed(i).timeline, setCurve };
})();
