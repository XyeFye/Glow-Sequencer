/* Glow Theme for Online Sequencer — Time signature changes. Runs in the page (MAIN world) on the editor.
   The site has one time signature for the whole sequence. This lets bars have their own: Shift+right-click a bar
   number in the timeline (or use the ♩ button at the right end of the timeline) to set a time signature for that bar,
   for the selected bars, or from that bar onwards. The map is kept in an ordinary annotation note on the grid that reads
   "Time signatures: 3 = 3/4, 7 = 7/8" (bar numbers as shown in the timeline), so it is saved with the sequence, can be
   edited by hand, and tells people without the extension what is going on. With a map in place the timeline shows the
   real bars (numbers and widths), bar lines are drawn on the grid, the loop end snaps to a real bar end, and the
   metronome accents real downbeats. Notes themselves are untouched: the beat grid stays in sixteenths as always. */
(function () {
  "use strict";
  if (window.__osgTimeSig) return; window.__osgTimeSig = true;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const toast = (m) => { try { message(m, 3, true); } catch (e) {} };
  const PREFIX = /^\s*time\s*sig(?:nature)?s?\s*[:=\-]\s*/i;   // the annotation that holds the map
  const DENS = [2, 4, 8, 16];
  const lenOf = (num, den) => num * 16 / den;                     // sixteenths in one bar of num/den

  // ---------- the map: changes by bar index (0-based), the site's own time signature before the first one ----------
  const live = () => (typeof song !== "undefined" && song && Array.isArray(song.notes) ? song.notes : []);
  const baseSig = () => { let n = 4; try { n = +song.getTimeSig() || 4; } catch (e) {} return { num: n, den: 4 }; };
  const mapNote = () => live().find((n) => !n.deleted && n.annotation && PREFIX.test(n.annotation.text || ""));
  function parse(text) {
    const out = new Map(); const body = String(text || "").replace(PREFIX, "");
    for (const part of body.split(/[,;\n]+/)) {
      const m = part.match(/^\s*(?:bar\s*)?(\d+)\s*[=:\-–]?\s*(\d+)\s*\/\s*(\d+)\s*$/i); if (!m) continue;
      const bar = +m[1] - 1, num = +m[2], den = +m[3];
      if (bar < 0 || bar > 9999 || num < 1 || num > 64 || !DENS.includes(den)) continue;
      out.set(bar, { num, den });
    }
    return out;
  }
  const serialize = (changes) => "Time signatures: " + [...changes.entries()].sort((a, b) => a[0] - b[0]).map(([bar, s]) => `${bar + 1} = ${s.num}/${s.den}`).join(", ");
  let changes = new Map(), sigKey = "";
  function readMap() {   // → true when the map changed
    const n = mapNote(); const text = n ? n.annotation.text : ""; const key = text + "|" + baseSig().num;
    if (key === sigKey) return false; sigKey = key; changes = parse(text); bars = []; return true;
  }
  const active = () => changes.size > 0;
  // bars, built as far as needed: { i, start, end, num, den, change (true where a new signature begins) }
  let bars = [];
  function ensureBars(uptoTime, uptoIndex) {
    let i = bars.length, t = i ? bars[i - 1].end : 0, cur = i ? { num: bars[i - 1].num, den: bars[i - 1].den } : baseSig();
    if (!i && changes.has(0)) cur = changes.get(0);
    while ((uptoTime != null && t <= uptoTime) || (uptoIndex != null && i <= uptoIndex)) {
      if (i > 50000) break;
      const ch = changes.get(i), s = ch || cur, len = lenOf(s.num, s.den);
      bars.push({ i, start: t, end: t + len, num: s.num, den: s.den, change: !!ch });
      cur = s; t += len; i++;
    }
  }
  function barAt(time) { time = Math.max(0, time); ensureBars(time, null); let lo = 0, hi = bars.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (bars[mid].end <= time) lo = mid + 1; else hi = mid; } return bars[lo]; }
  function bar(i) { ensureBars(null, i); return bars[i]; }
  const sigAt = (bar) => { for (let k = bar; k >= 0; k--) if (changes.has(k)) return changes.get(k); return baseSig(); };   // the signature in force at a bar

  // ---------- writing the map (one undo step; the annotation note is created when needed) ----------
  function writeMap(next, label) {
    const n = mapNote(), text = next.size ? serialize(next) : null, oldText = n ? n.annotation.text : null;
    const setText = (note, t) => { note.annotation.text = t; if (note.annotation.element) note.annotation.element.textContent = t; };
    const after = () => { try { SequencerView.repaint(kRepaintNotesMoved); } catch (e) {} readMap(); refreshAll(); try { song.updateLoopTime(); } catch (e) {} try { setConfirmExit(true); } catch (e) {} };
    if (n && text) exec(() => { setText(n, text); after(); }, () => { setText(n, oldText); after(); });
    else if (n && !text) exec(() => { song.removeNote(n); after(); }, () => { song.addNote(n); after(); });
    else if (text) {
      const note = new Note(song, piano[0], 0, 4, -1, 1); note.annotation = new Annotation(text);
      exec(() => { song.addNote(note); after(); }, () => { song.removeNote(note); after(); });
    }
    if (label) toast(label);
  }
  function setRange(fromBar, toBar, sig, through) {   // bars fromBar..toBar get sig; `through` = from fromBar onwards
    const next = new Map(changes), afterSig = sigAt(toBar + 1);   // what the bar after the range has now, so it keeps it
    for (const k of [...next.keys()]) if (k >= fromBar && (through || k <= toBar)) next.delete(k);
    next.set(fromBar, sig); if (!through) next.set(toBar + 1, afterSig);
    // drop entries that don't change the signature in force
    let cur = baseSig(); for (const k of [...next.keys()].sort((a, b) => a - b)) { const s = next.get(k); if (s.num === cur.num && s.den === cur.den) next.delete(k); else cur = s; }
    return next;
  }

  // ---------- the timeline: real bars, real widths ----------
  const tlEl = () => document.getElementById("sequencer_timeline_measures"), mainEl = () => document.getElementById("sequencer_main");
  let tlKey = "", tlFirst = -1;
  function renderTimeline(force) {
    const tl = tlEl(), c = mainEl(); if (!tl || !c) return;
    const sl = c.scrollLeft, w = (typeof containerRect !== "undefined" && containerRect ? containerRect.width : c.clientWidth) || c.clientWidth, nw = noteWidth;
    const first = barAt(sl / nw); const list = [];
    for (let i = first.i; ; i++) { const b = bar(i); list.push(b); if (b.start * nw > sl + w + 2) break; if (list.length > 400) break; }
    const timeMode = typeof displayMeasureTime !== "undefined" && displayMeasureTime;
    const key = list.map((b) => `${b.i}:${b.start}:${b.end}:${b.num}/${b.den}`).join("|") + "|" + nw + "|" + timeMode;
    if (force || key !== tlKey) {
      tlKey = key; tl.innerHTML = "";
      for (const b of list) {
        const d = document.createElement("div"); d.className = "measure osg-ts-bar" + (b.change ? " osg-ts-change" : ""); d.style.minWidth = d.style.width = Math.round((b.end - b.start) * nw) + "px"; d.style.flex = "none";
        d.innerHTML = `<b>${timeMode ? formatTime(b.start) : b.i + 1}</b>${b.change ? `<i>${b.num}/${b.den}</i>` : ""}`;
        d.title = `Bar ${b.i + 1} — ${b.num}/${b.den}. Shift+right-click to change the time signature.`;
        d.onmouseover = d.onmousemove = (event) => { try { d.title = formatTime(clickToNoteX(event.clientX)) + ` · bar ${b.i + 1}, ${b.num}/${b.den}`; } catch (e) {} };
        tl.appendChild(d);
      }
    }
    tl.style.transform = `translateX(${-(sl - first.start * nw)}px)`;
    if (first.i !== tlFirst) { tlFirst = first.i; try { updateMarkers(); } catch (e) {} }
  }
  // ---------- the grid: a line where each bar starts ----------
  let layer = null, gridKey = "";
  function renderGrid() {
    const inner = document.getElementById("sequencer_inner"); if (!inner) return;
    if (!active()) { if (layer) { layer.remove(); layer = null; } gridKey = ""; return; }
    if (!layer || layer.parentElement !== inner) { layer = document.createElement("div"); layer.id = "osg-ts-lines"; inner.appendChild(layer); }
    // only the bars around the view (a very zoomed-out grid has thousands)
    const c = mainEl(), nw = noteWidth, h = piano.length * noteHeight, sl = c ? c.scrollLeft : 0, w = c ? c.clientWidth : 1600;
    const first = barAt(Math.max(0, sl - w) / nw), last = barAt((sl + 2 * w) / nw);
    const key = `${sigKey}|${nw}|${noteHeight}|${first.i}|${last.i}`; if (key === gridKey) return; gridKey = key;
    let html = ""; for (let i = first.i; i <= last.i; i++) { const b = bar(i); if (!b) break; html += `<div class="osg-ts-line${b.change ? " change" : ""}" style="left:${(b.start * nw).toFixed(1)}px;height:${h}px"${b.change ? ` data-sig="${b.num}/${b.den}"` : ""}></div>`; }
    layer.innerHTML = html;
  }
  function refreshAll() { try { if (active()) renderTimeline(true); else { tlKey = ""; tlFirst = -1; oUpdateMeasures && oUpdateMeasures(); } } catch (e) {} renderGrid(); }

  // ---------- the popup ----------
  let pop = null;
  const closePop = () => { if (pop) { (window.__osgPopOut || ((e) => e.remove()))(pop); pop = null; } };
  function openPop(time, x, y) {
    closePop(); readMap();
    const b = barAt(time), cur = sigAt(b.i), has = changes.has(b.i);
    let selBars = null; try { if (!selection.isEmpty()) { const sp = selection.getTimeSpan(); const a = barAt(sp.min).i, z = barAt(Math.max(sp.min, sp.max - 0.001)).i; selBars = [a, z]; } } catch (e) {}
    const list = [...changes.entries()].sort((p, q) => p[0] - q[0]);
    pop = document.createElement("div"); pop.id = "osg-ts-pop";
    pop.innerHTML = `<div class="osg-popup-title"><span>Time signature — bar ${b.i + 1}</span><button type="button" class="osg-popup-x" data-act="close" aria-label="Close">✕</button></div>
      <div class="osg-popup-body">
        <div class="osg-ts-sig"><input type="number" min="1" max="64" step="1" value="${cur.num}" data-f="num" aria-label="Beats per bar"><span>/</span><select data-f="den" aria-label="Beat unit">${DENS.map((d) => `<option value="${d}"${d === cur.den ? " selected" : ""}>${d}</option>`).join("")}</select><em>now ${cur.num}/${cur.den}${has ? " (changes here)" : ""}</em></div>
        <div class="osg-ts-scope">
          <label><input type="radio" name="osg-ts-scope" value="one" checked> This bar only</label>
          <label><input type="radio" name="osg-ts-scope" value="on"> From bar ${b.i + 1} onwards</label>
          ${selBars ? `<label><input type="radio" name="osg-ts-scope" value="sel"> Selected bars (${selBars[0] + 1}${selBars[1] !== selBars[0] ? `–${selBars[1] + 1}` : ""})</label>` : ""}
        </div>
        <div class="osg-popup-actions"><button type="button" class="primary" data-act="apply">Apply</button>${has ? `<button type="button" data-act="remove">Remove change at bar ${b.i + 1}</button>` : ""}${list.length ? `<button type="button" class="danger" data-act="clear">Clear all</button>` : ""}</div>
        ${list.length ? `<div class="osg-ts-list">${list.map(([k, s]) => `<span>bar ${k + 1}: <b>${s.num}/${s.den}</b></span>`).join("")}</div>` : ""}
        <div class="osg-popup-hint">Kept in an annotation on the grid ("Time signatures: …") so it saves with the sequence and can be edited by hand. The sequence's own time signature (${baseSig().num}/4) applies until the first change. Notes stay where they are.</div>
      </div>`;
    document.body.appendChild(pop);
    pop.style.left = Math.max(6, Math.min(innerWidth - pop.offsetWidth - 6, x + 8)) + "px"; pop.style.top = Math.max(6, Math.min(innerHeight - pop.offsetHeight - 6, y + 8)) + "px";
    const read = () => { const num = Math.max(1, Math.min(64, Math.round(+pop.querySelector("[data-f=num]").value) || 4)), den = +pop.querySelector("[data-f=den]").value; return { num, den }; };
    pop.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-act]"); if (!btn) return; const act = btn.dataset.act;
      if (act === "close") closePop();
      else if (act === "apply") {
        const sig = read(), scope = (pop.querySelector("input[name=osg-ts-scope]:checked") || {}).value;
        let next; if (scope === "on") next = setRange(b.i, b.i, sig, true); else if (scope === "sel" && selBars) next = setRange(selBars[0], selBars[1], sig, false); else next = setRange(b.i, b.i, sig, false);
        writeMap(next, `${sig.num}/${sig.den} ${scope === "on" ? `from bar ${b.i + 1} on` : scope === "sel" ? `for bars ${selBars[0] + 1}–${selBars[1] + 1}` : `for bar ${b.i + 1}`}.`); closePop();
      }
      else if (act === "remove") { const next = new Map(changes); next.delete(b.i); writeMap(next, `Bar ${b.i + 1} follows the previous time signature again.`); closePop(); }
      else if (act === "clear") { writeMap(new Map(), "Time signature changes cleared."); closePop(); }
    });
    for (const ev of ["keydown", "keyup", "keypress"]) pop.addEventListener(ev, (e) => { e.stopPropagation(); if (ev === "keydown" && e.key === "Escape") closePop(); if (ev === "keydown" && e.key === "Enter" && e.target.matches("input")) pop.querySelector("[data-act=apply]").click(); });
    for (const ev of ["mousedown", "pointerdown", "contextmenu", "wheel"]) pop.addEventListener(ev, (e) => e.stopPropagation());
    pop.querySelector("[data-f=num]").focus();
  }
  document.addEventListener("pointerdown", (e) => { if (pop && !pop.contains(e.target)) closePop(); }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && pop) closePop(); }, true);

  // ---------- hooks ----------
  let oUpdateMeasures = null, hooked = false;
  function hook() {
    if (hooked) return true;
    if (typeof song === "undefined" || typeof updateMeasures !== "function" || typeof scrollMeasures !== "function" || typeof Annotation !== "function" || typeof exec !== "function" || typeof SequencerView === "undefined") return false;
    hooked = true;
    oUpdateMeasures = window.updateMeasures; const oScroll = window.scrollMeasures;
    window.updateMeasures = function () { if (!active()) return oUpdateMeasures.apply(this, arguments); renderTimeline(true); try { updateMarkers(); } catch (e) {} };
    window.scrollMeasures = function () { if (!active()) return oScroll.apply(this, arguments); renderTimeline(false); renderGrid(); try { scrollVisibleMarkers(); } catch (e) {} };
    // the loop ends on a real bar line
    const oLoop = Song.prototype.updateLoopTime;
    Song.prototype.updateLoopTime = function () {
      const r = oLoop.apply(this, arguments); if (!active() || this !== song) return r;
      let end = 0; for (const n of this.notes) if (!n.deleted) end = Math.max(end, (n.intTime != null ? n.intTime : Math.floor(n.time)) + n.length);
      const b = end > 0 ? barAt(Math.max(0, end - 1e-6)) : bar(0); this.loopTime = b.end;
      try { if (typeof maxCells !== "undefined" && this.loopTime >= maxCells) updateLength(this.loopTime + (b.end - b.start), b.end - b.start); } catch (e) {}
      return r;
    };
    // the metronome's accent falls on real downbeats
    const oCol = Song.prototype.playColumn; Song.prototype.playColumn = function (idx) { this.__osgCol = idx; return oCol.apply(this, arguments); };
    const as = typeof audioSystem !== "undefined" ? audioSystem : null;
    if (as && typeof as.playMetronome === "function") { const om = as.playMetronome; as.playMetronome = function (first) { if (active() && song && song.__osgCol != null) { const b = barAt(song.__osgCol); first = b.start === song.__osgCol; } return om.call(this, first); }; }
    // drawing follows the notes / zoom
    const prev = SequencerView.repaint; SequencerView.repaint = function (flags) { const r = prev.call(this, flags); queueRefresh(); return r; };
    // Shift+right-click on the timeline
    const tlWrap = document.getElementById("sequencer_timeline");
    if (tlWrap) { tlWrap.addEventListener("mousedown", (e) => { if (e.button === 2 && e.shiftKey) { e.preventDefault(); e.stopPropagation(); } }, true); tlWrap.addEventListener("contextmenu", (e) => { if (!e.shiftKey) return; e.preventDefault(); e.stopPropagation(); let t = 0; try { t = clickToNoteX(e.clientX); } catch (err) { t = (mainEl().scrollLeft + e.clientX - tlWrap.getBoundingClientRect().left) / noteWidth; } openPop(Math.max(0, t), e.clientX, e.clientY); }, true); }
    addButton();
    return true;
  }
  function addButton() {
    const opts = document.getElementById("sequencer_timeline_options"); if (!opts || document.getElementById("osg-ts-btn")) return;
    const b = document.createElement("div"); b.id = "osg-ts-btn"; b.title = "Time signature changes: set a time signature for a bar, the selected bars, or from a bar onwards (also Shift+right-click a bar number)"; b.textContent = "♩"; b.setAttribute("role", "button");
    b.onclick = (e) => { e.stopPropagation(); let t = 0; try { if (!selection.isEmpty()) t = selection.getTimeSpan().min; else t = mainEl().scrollLeft / noteWidth; } catch (err) {} openPop(Math.max(0, t), e.clientX - 260, e.clientY); };
    opts.appendChild(b);
  }
  let refreshT = 0; const queueRefresh = () => { if (refreshT) return; refreshT = setTimeout(() => { refreshT = 0; if (readMap()) { try { song.updateLoopTime(); } catch (e) {} refreshAll(); } else { if (active()) renderTimeline(false); renderGrid(); } }, 60); };
  let tries = 0, songRef = null;
  const boot = setInterval(() => {
    if (++tries > 1200) return clearInterval(boot);
    if (!document.getElementById("sequencer")) { if (tries > 100 && typeof song === "undefined") clearInterval(boot); return; }
    if (!hook()) return;
    if (song !== songRef) { songRef = song; sigKey = ""; }
    if (readMap()) { try { song.updateLoopTime(); } catch (e) {} refreshAll(); }
    else if (active()) renderGrid();
  }, 500);
  window.osgTimeSig = { open: openPop, barAt, bar, changes: () => new Map(changes), set: (from, to, num, den, through) => writeMap(setRange(from, to, { num, den }, !!through)), refresh: refreshAll };
})();
