/* Glow Theme for Online Sequencer — Layers: organise a sequence into folders, instrument tracks and note groups.
   Runs in the page (MAIN world) on the editor. Opens as a tab in the site's sidebar ("Layers" in the top menu).

   The tree is a list of nodes:  { t: "f", id, name, color, open, hidden, mute, lock, solo, kids: [...] }   folder
                                 { t: "i", inst, hidden }                                                   instrument track
                                 { t: "g", id, name, color, open, hidden, mute, lock, solo, kids: [...] }   note group
   A note belongs to at most one group directly, through note.__osgG. Groups and folders are both containers: either
   can hold tracks, groups and folders (a group additionally holds its own notes). Hide / mute / lock / solo on a
   container applies to everything inside it.
   Hidden notes aren't drawn or clickable but still play; muted ones don't play; locked ones can't be selected;
   while any group or folder is soloed, only the notes inside soloed ones play.
   Silent notes (volume 0, or a silent instrument) in the first measures — thumbnail art — are gathered into an
   automatic "Thumbnail" group. Any layer can be downloaded on its own as .wav or .mp3 through the site's own exporter.
   An instrument track's own Mute / Solo / Lock buttons are the site's own (same as the instrument settings panel).

   The site's sequence file has no room for any of this, so the layout is kept in this browser (localStorage), per
   sequence. Group membership is remembered by each note's position, pitch and instrument. */
(function () {
  "use strict";
  if (window.__osgLayers) return; window.__osgLayers = true;

  const PALETTE = ["#7c5cff", "#4fc3f7", "#ff7043", "#81c784", "#f06292", "#ffd54f", "#4db6ac", "#ba68c8", "#e57373", "#90caf9"];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const unesc = (s) => { const t = document.createElement("textarea"); t.innerHTML = s; return t.value; };
  let seq = 0; const newId = (p) => p + Date.now().toString(36) + (seq++).toString(36);
  const LS = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  const G = "__osgG";   // note → group id

  // ---------- model ----------
  let tree = [], opts = {}, rev = 0, st = null, stRev = -1;
  const THUMB_MEASURES = 7;   // the site's thumbnail is drawn from the first few measures
  const timeSigNow = () => { try { return getTimeSig() || 4; } catch (e) { return 4; } };
  const thumbBound = () => THUMB_MEASURES * 4 * timeSigNow();
  const instVolume = (i) => { try { const v = song.getInstrumentSettings(i)?.volume; return v == null ? 1 : +v; } catch (e) { return 1; } };
  const instMutedNative = (i) => { try { return !!audioSystem.getMute(i); } catch (e) { return false; } };
  const instSoloNative = (i) => { try { return !!audioSystem.hasSolo(i); } catch (e) { return false; } };
  // a note that makes no sound: volume 0, or on an instrument that is at volume 0 / muted
  const ART_BASE = "8-Bit Square";
  const isArtInst = (i) => { try { return instMgr.isClone(i) && instMgr.getBaseName(i) === ART_BASE; } catch (e) { return false; } };
  const silentNote = (n, cache) => { if (n.__osgSlide) return false; if (n.volume != null && n.volume <= 0.001) return true; let v = cache.get(n.instrument); if (v === undefined) { v = instVolume(n.instrument) <= 0.001 || instMutedNative(n.instrument); cache.set(n.instrument, v); } return v; };
  function walk(nodes, fn, parent, inh, depth) {
    inh = inh || { hidden: false, mute: false, lock: false, solo: false }; depth = depth || 0;
    for (const n of nodes) {
      const s = { hidden: inh.hidden || !!n.hidden, mute: inh.mute || (n.t !== "i" && !!n.mute), lock: inh.lock || (n.t !== "i" && !!n.lock), solo: inh.solo || (n.t !== "i" && !!n.solo) };
      if (fn(n, parent || null, s, inh, depth) === false) return false;
      if (n.t !== "i" && n.kids && walk(n.kids, fn, n, s, depth + 1) === false) return false;
    }
  }
  function find(list, pred) { let out = null; (function rec(l, parent) { for (let i = 0; i < l.length && !out; i++) { const n = l[i]; if (pred(n)) { out = { node: n, list: l, index: i, parent }; return; } if (n.t !== "i" && n.kids) rec(n.kids, n); } })(list, null); return out; }
  const keyOf = (n) => (n.t === "i" ? "i:" + n.inst : n.t + ":" + n.id);
  const byKey = (k) => find(tree, (n) => keyOf(n) === k);
  const isContainer = (n) => n.t === "f" || n.t === "g";
  const newGroupNode = (name) => ({ t: "g", id: newId("g"), name, color: PALETTE[0], open: false, kids: [] });
  const newFolderNode = (name) => ({ t: "f", id: newId("f"), name, color: PALETTE[4], open: true, kids: [] });
  const nextName = (t, base) => { let k = 1; walk(tree, (n) => { if (n.t === t) k++; }); return `${base} ${k}`; };
  const live = () => (typeof song !== "undefined" && song && song.notes ? song.notes : []);
  // every instrument with notes gets a track; every group a note points at gets a node
  function sync() {
    const have = new Set(), groups = new Set(); let added = false;
    walk(tree, (n) => { if (n.t === "i") have.add(n.inst); else if (n.t === "g") groups.add(n.id); });
    for (const n of live()) {
      if (!have.has(n.instrument)) { have.add(n.instrument); tree.push({ t: "i", inst: n.instrument }); added = true; }
      const g = n[G]; if (g && !groups.has(g)) { groups.add(g); tree.unshift({ t: "g", id: g, name: "Group", color: PALETTE[groups.size % PALETTE.length], open: false, kids: [] }); added = true; }
    }
    if (added) rev++;
    if (!opts.noThumb) autoThumb(false);
  }
  // Thumbnail art: the site draws a sequence's thumbnail from its first measures. Art is drawn with duplicated
  // ("cloned") 8-Bit Square instruments, or with silent notes. An instrument whose notes all sit in those first
  // measures and is either an 8-Bit Square clone or entirely silent is thumbnail art — its track goes into an
  // automatic "Thumbnail" folder.
  // Silent early notes on an instrument that also plays real notes go into a "Thumbnail notes" group inside it.
  // Tracks the user moves back out are left alone (opts.thumbDone remembers which were filed); so are notes taken
  // out of the group (note.__osgNT). Dissolving or deleting the folder turns the whole thing off (opts.noThumb).
  function autoThumb(force) {
    if (force) opts.noThumb = false;
    const bound = thumbBound(), cache = new Map(), done = new Set(force ? [] : opts.thumbDone || []);   // "Find thumbnail art" re-files everything, even tracks moved out before
    const per = new Map();   // instrument → { n, early, art, loose: [silent early notes not in a group] }
    for (const n of live()) {
      if (n.annotation != null) continue;
      let p = per.get(n.instrument); if (!p) per.set(n.instrument, (p = { n: 0, early: 0, art: 0, loose: [] }));
      p.n++;
      if (n.time < bound) { p.early++; if (silentNote(n, cache)) { p.art++; if (!n[G] && !n.__osgNT) p.loose.push(n); } }
    }
    const pure = (inst, p) => p.early === p.n && (p.art === p.n || isArtInst(inst));   // every note early, and it's an 8-Bit Square clone or all silent
    let folder = find(tree, (x) => x.t === "f" && x.auto === "thumb");
    let group = find(tree, (x) => x.t === "g" && (x.auto === "thumb" || x.auto === "thumbNotes"));
    const tracks = [], notes = [];
    for (const [inst, p] of per) {
      if (pure(inst, p)) { if (!done.has(inst)) { const t = byKey("i:" + inst); if (t && !t.parent) tracks.push(t.node); } }   // whole instrument is art, still at the top level
      else notes.push(...p.loose);                                                                                              // mixed instrument: only its silent early notes
    }
    // an older version put everything in one group: move the art instruments' notes out of it so the tracks can go in the folder
    if (group && group.node.auto === "thumb") { for (const n of live()) if (n[G] === group.node.id && per.has(n.instrument) && pure(n.instrument, per.get(n.instrument))) delete n[G]; group.node.auto = "thumbNotes"; if (group.node.name === "Thumbnail") group.node.name = "Thumbnail notes"; rev++; }
    if (!tracks.length && !notes.length) {
      if (group && !live().some((n) => n[G] === group.node.id) && !(group.node.kids || []).length) { removeNode(group, false); rev++; }
      if (force) toast(folder ? "Nothing new: every thumbnail instrument is already filed." : "No thumbnail art found (duplicated 8-Bit Square instruments, or silent ones, whose notes are all in the first " + THUMB_MEASURES + " measures).");
      return 0;
    }
    if (!folder) { const node = { t: "f", id: newId("f"), name: "Thumbnail", color: "#b0b0c8", auto: "thumb", open: false, kids: [] }; tree.unshift(node); folder = { node }; }
    if (group && !find([folder.node], (x) => x === group.node)) { group = find(tree, (x) => x === group.node); removeNode(group, true); folder.node.kids.unshift(group.node); group = find(tree, (x) => x === group.node); }   // (re-found: adding the folder shifted positions)
    for (const t of tracks) { const f = byKey(keyOf(t)); if (f) { f.list.splice(f.index, 1); folder.node.kids.push(t); done.add(t.inst); } }
    if (notes.length) {
      if (!group) { const node = { t: "g", id: newId("g"), name: "Thumbnail notes", color: "#b0b0c8", auto: "thumbNotes", open: false, kids: [] }; folder.node.kids.unshift(node); group = { node }; }
      for (const n of notes) n[G] = group.node.id;
    }
    opts.thumbDone = [...done]; opts.noThumb = false; rev++; saveSoon();
    if (force) { toast([tracks.length && `${tracks.length} track${tracks.length === 1 ? "" : "s"}`, notes.length && `${notes.length.toLocaleString()} note${notes.length === 1 ? "" : "s"}`].filter(Boolean).join(" and ") + ` filed under "${folder.node.name}".`); apply(); refresh(); }
    return tracks.length + notes.length;
  }
  function state() {
    if (st && stRev === rev) return st;
    const s = { instHidden: new Set(), instMuted: new Set(), instLocked: new Set(), instSolo: new Set(), gHidden: new Set(), gMuted: new Set(), gLocked: new Set(), gSolo: new Set(), soloAny: false };
    walk(tree, (n, p, x) => {
      if (n.t === "i") { if (x.hidden) s.instHidden.add(n.inst); if (x.mute) s.instMuted.add(n.inst); if (x.lock) s.instLocked.add(n.inst); if (x.solo) s.instSolo.add(n.inst); }
      else if (n.t === "g") { if (x.hidden) s.gHidden.add(n.id); if (x.mute) s.gMuted.add(n.id); if (x.lock) s.gLocked.add(n.id); if (x.solo) s.gSolo.add(n.id); }
      if (n.t !== "i" && n.solo) s.soloAny = true;
    });
    s.hideAny = s.instHidden.size + s.gHidden.size > 0; s.muteAny = s.instMuted.size + s.gMuted.size > 0; s.lockAny = s.instLocked.size + s.gLocked.size > 0;
    st = s; stRev = rev; return s;
  }
  const isHiddenNote = (n) => { const s = state(); return s.hideAny && (s.instHidden.has(n.instrument) || (!!n[G] && s.gHidden.has(n[G]))); };
  const isMutedNote = (n) => { const s = state(); return s.muteAny && (s.instMuted.has(n.instrument) || (!!n[G] && s.gMuted.has(n[G]))); };
  const isLockedNote = (n) => { const s = state(); return s.lockAny && (s.instLocked.has(n.instrument) || (!!n[G] && s.gLocked.has(n[G]))); };
  const soloPassed = (n) => { const s = state(); return !s.soloAny || s.instSolo.has(n.instrument) || (!!n[G] && s.gSolo.has(n[G])); };
  // the site's own per-instrument mute / solo (the M and S on a track row use those), read straight from the audio system
  const nativeSoloAny = () => { try { return audioSystem.soloingSet.size > 0; } catch (e) { return false; } };
  const nativeMuteAny = () => { try { for (const i of audioSystem.instruments.values()) if (i && i.disabledByMute) return true; } catch (e) {} return false; };
  const soloAnyAll = () => state().soloAny || nativeSoloAny();
  // a note that is "half there": muted (by its track, group or folder), or left out while something else is soloed
  const soloHit = (n) => { const s = state(); return s.instSolo.has(n.instrument) || (!!n[G] && s.gSolo.has(n[G])) || instSoloNative(n.instrument); };
  const dimNote = (n) => isMutedNote(n) || instMutedNative(n.instrument) || (soloAnyAll() && !soloHit(n));
  const blocked = (n) => isHiddenNote(n) || isLockedNote(n);
  function notesIn(node) {
    const insts = new Set(), groups = new Set();
    (function rec(n) { if (n.t === "i") insts.add(n.inst); else { if (n.t === "g") groups.add(n.id); (n.kids || []).forEach(rec); } })(node);
    return live().filter((n) => (n[G] && groups.has(n[G])) || insts.has(n.instrument));
  }

  // ---------- saving (per sequence, in this browser) ----------
  const sigOf = (n) => `${+n.time.toFixed(4)}|${n.type}|${n.instrument}`;
  const storeKey = (id) => "osg-layers-" + (id || "new");
  let loadedFor = null, dirty = false, saveTimer = 0, songRef = null;
  function serialize() {
    const groups = {};
    for (const n of live()) { const g = n[G]; if (g) (groups[g] || (groups[g] = [])).push(sigOf(n)); }
    return JSON.stringify({ v: 1, at: Date.now(), tree, groups, opts });
  }
  function save() {
    clearTimeout(saveTimer); saveTimer = 0; if (loadedFor === null) return;
    const hasAny = tree.some((n) => n.t !== "i") || find(tree, (n) => n.hidden || n.solo) || live().some((n) => n[G]) || opts.noThumb || (opts.thumbDone || []).length;
    const id = typeof song !== "undefined" ? song.id : 0;
    if (!hasAny && !LS.get(storeKey(id))) return;
    const data = serialize(); LS.set(storeKey(id), data); if (String(id) !== String(loadedFor)) { LS.set(storeKey(loadedFor), data); loadedFor = id; }
    dirty = false;
  }
  const saveSoon = () => { dirty = true; if (!saveTimer) saveTimer = setTimeout(save, 600); };
  function clean(src) {
    const out = [], seen = new Set(); let count = 0;
    const str = (v, d) => String(v == null ? d : v).slice(0, 60);
    const col = (c) => (/^#[0-9a-f]{6}$/i.test(c || "") ? c : PALETTE[count % PALETTE.length]);
    (function rec(list, into, depth) {
      if (!Array.isArray(list) || depth > 8) return;
      for (const n of list) {
        if (!n || ++count > 2000) return;
        if (n.t === "f") { const f = { t: "f", id: str(n.id, newId("f")), name: str(n.name, "Folder"), color: col(n.color), open: n.open !== false, hidden: !!n.hidden, mute: !!n.mute, lock: !!n.lock, solo: !!n.solo, kids: [] }; if (n.auto === "thumb") f.auto = "thumb"; rec(n.kids, f.kids, depth + 1); into.push(f); }
        else if (n.t === "i" && Number.isInteger(n.inst) && n.inst >= 0 && !seen.has("i" + n.inst)) { seen.add("i" + n.inst); into.push({ t: "i", inst: n.inst, hidden: !!n.hidden }); }
        else if (n.t === "g" && n.id && !seen.has("g" + n.id)) { seen.add("g" + n.id); const g = { t: "g", id: str(n.id), name: str(n.name, "Group"), color: col(n.color), hidden: !!n.hidden, mute: !!n.mute, lock: !!n.lock, solo: !!n.solo, open: !!n.open, kids: [] }; if (n.auto === "thumb" || n.auto === "thumbNotes") g.auto = n.auto; rec(n.kids, g.kids, depth + 1); into.push(g); }
      }
    })(src, out, 0);
    return out;
  }
  function load() {
    const id = song.id || 0, tries = [id, song.basedon, id ? null : "new"].filter((x, i, a) => x != null && x !== "" && a.indexOf(x) === i);
    let data = null;
    for (const k of tries) { try { const d = JSON.parse(LS.get(storeKey(k)) || "null"); if (d && Array.isArray(d.tree)) { data = d; break; } } catch (e) {} }
    loadedFor = id; opts = { v: 3 }; songRef = song;
    if (!data) { sync(); apply(); return; }
    tree = clean(data.tree); opts = { v: 3, noThumb: !!(data.opts && data.opts.noThumb), thumbDone: Array.isArray(data.opts && data.opts.thumbDone) ? data.opts.thumbDone.filter(Number.isInteger).slice(0, 500) : [] };
    if (!data.opts || data.opts.v !== 3) { opts.noThumb = false; opts.thumbDone = []; }   // layouts saved by earlier versions: file the thumbnail art again under the current rules
    const want = new Map();   // signature → [group ids] (duplicates are matched one by one)
    for (const [g, sigs] of Object.entries(data.groups || {})) for (const s of sigs || []) { const a = want.get(s); if (a) a.push(g); else want.set(s, [g]); }
    if (want.size) for (const n of live()) { const a = want.get(sigOf(n)); if (a && a.length) n[G] = a.shift(); }
    sync(); rev++; apply();
  }
  addEventListener("pagehide", () => { if (dirty || loadedFor !== null) save(); });
  setInterval(() => { if (loadedFor !== null && (dirty || live().some((n) => n[G]))) save(); }, 15000);
  // the editor can load another sequence into the same page: save this one's layout, then start over for the new one
  setInterval(() => {
    if (loadedFor === null || typeof song === "undefined" || song === songRef) return;
    clearTimeout(saveTimer); saveTimer = 0; dirty = false;   // (every change was already saved 0.6 s after it happened)
    tree = []; opts = { v: 3 }; rev++; rowSel.clear(); loadedFor = null;
    let tries = 0; const wait = setInterval(() => { if (++tries > 100 || live().length) { clearInterval(wait); load(); refresh(); } }, 100);
  }, 1000);

  // ---------- hooks into the editor ----------
  function repaint() { try { SequencerView.repaint(typeof kRepaintNotesChanged !== "undefined" ? kRepaintNotesChanged : 2); } catch (e) {} }
  function apply() { repaint(); dropBlockedFromSelection(); }
  function dropBlockedFromSelection() {
    if (typeof selection === "undefined" || !selection.notes.some(blocked)) return;
    selection.setNotes(selection.notes.filter((n) => !blocked(n)));
    try { updateSelection(); } catch (e) {}
  }
  // which of these notes may sound right now (mute / solo, or the one layer being exported) — also used by slides.js
  function filterPlayable(list) {
    if (!list) return list;
    const keep = {};
    if (exportSet) { for (const k in list) if (exportSet.has(list[k])) keep[k] = list[k]; return keep; }   // exporting one layer: exactly its notes
    const s = state(); if (!s.muteAny && !s.soloAny) return list;
    for (const k in list) { const n = list[k]; if (!isMutedNote(n) && soloPassed(n)) keep[k] = n; }
    return keep;
  }
  let hooked = false;
  function hook() {
    if (hooked) return true;
    if (typeof song === "undefined" || typeof SequencerView === "undefined" || typeof Selection === "undefined" || typeof Song === "undefined" || typeof noteFromPoint !== "function") return false;
    hooked = true;
    // 1. hidden notes aren't drawn (each grid tile is drawn from its own list of notes)
    const view = SequencerView, P = Object.getPrototypeOf(view), paintTile = view._repaintTile || P._repaintTile;
    if (typeof paintTile === "function") {
      //    muted notes, and everything outside a solo, are drawn at half strength
      view._repaintTile = function (tile) {
        const s = state(), dimming = s.muteAny || s.soloAny || nativeMuteAny() || nativeSoloAny();
        if ((!s.hideAny && !dimming) || !tile || !Array.isArray(tile.notes)) return paintTile.call(this, tile);
        const all = tile.notes, list = s.hideAny ? all.filter((x) => !(x && x.note && isHiddenNote(x.note))) : all;
        tile.notes = list;
        if (!dimming) { try { return paintTile.call(this, tile); } finally { tile.notes = all; } }
        // The painter asks instMgr.isLocked() once per note it draws, in list order, right before it sets that note's
        // colour. Following those calls tells us which note is being drawn, so its colour (premultiplied) can be halved.
        const drawn = []; for (const x of list) { const n = x && x.note; if (!n || (n.length < 1e-5 && !n.selected) || n.annotation != null) continue; drawn.push(n); }
        const gl = this.gl, hadOwn = Object.prototype.hasOwnProperty.call(instMgr, "isLocked"), isLocked = instMgr.isLocked, u4 = gl.uniform4f;
        let i = 0, dim = false;
        instMgr.isLocked = function (id) {
          let n = drawn[i]; if (n && n.instrument !== id) { let j = i + 1; while (j < drawn.length && drawn[j].instrument !== id) j++; if (j < drawn.length) { i = j; n = drawn[i]; } }
          i++; dim = !!n && n.instrument === id && dimNote(n); return isLocked.call(this, id);
        };
        gl.uniform4f = function (loc, r, g, b, a) { if (dim) { r *= 0.5; g *= 0.5; b *= 0.5; a *= 0.5; } return u4.call(this, loc, r, g, b, a); };
        try { return paintTile.call(this, tile); }
        finally { tile.notes = all; gl.uniform4f = u4; if (hadOwn) instMgr.isLocked = isLocked; else delete instMgr.isLocked; }
      };
    }
    // 2. hidden / locked notes can't be selected (covers click, box select, Ctrl+A, select-by-time, etc.)
    const selectNote = Selection.prototype.selectNote;
    Selection.prototype.selectNote = function (note) { if (note && blocked(note)) return; return selectNote.call(this, note); };
    // 3. clicking where a hidden / locked note is: pick the next note under the pointer, or treat it as empty grid
    const fromPoint = window.noteFromPoint;
    window.noteFromPoint = function (x, y, includeLocked) {
      const hit = fromPoint.apply(this, arguments);
      if (!hit || !blocked(hit)) return hit;
      try {
        const px = x - containerRect.left, py = y - containerRect.top, cols = song.noteColumns;
        const a = Math.max(0, Math.floor((scrollLeft - view.width) / noteWidth)), b = Math.min(cols.length, Math.floor((scrollLeft + view.width + 1) / noteWidth));
        let best;
        for (let i = a; i < b; i++) { const c = cols[i]; if (!c) continue; for (const j in c) { const n = c[j]; if (blocked(n) || (!includeLocked && instMgr.isLocked(n.instrument))) continue; if (px > n.drawX && px < n.drawX + n.drawWidth && py > n.drawY && py < n.drawY + n.drawHeight) { if (best && best.selected && !n.selected) continue; best = n; } } }
        return best;
      } catch (e) { return undefined; }
    };
    // 4. muted notes (by group or folder) don't play — also when exporting
    const playNotes = Song.prototype.playNotes;
    Song.prototype.playNotes = function (list) { return playNotes.call(this, filterPlayable(list)); };
    // 5. the site's own mute / solo / clear-solo (instrument options, or the panel's track rows) redraw the grid too
    for (const fn of ["muteInstrument", "soloInstrument", "clearSolo"]) { const o = window[fn]; if (typeof o === "function") window[fn] = function () { const r = o.apply(this, arguments); repaint(); refresh(); return r; }; }
    // 6. keep the panel's counts fresh when notes change
    const rp = P.repaint;
    if (typeof rp === "function") { let t = 0; view.repaint = function (flags) { const r = rp.call(this, flags); if (flags && panelOpen() && !t) t = setTimeout(() => { t = 0; refresh(); }, 250); return r; }; }
    return true;
  }

  // ---------- panel ----------
  let tab = null, box = null, treeEl = null, menu = null, renderQueued = false, renderLater = false, clickTimer = 0;
  const drag = { active: false, key: null, ghost: null, x0: 0, y0: 0, dstKey: null, zone: null, pid: null };
  const panelOpen = () => !!(box && document.body.contains(box) && box.offsetParent !== null);
  const instName = (i) => { try { return unesc(getInstrumentName(song, i)); } catch (e) { return "Instrument " + i; } };
  const instColor = (i) => { try { const c = getInstrumentColor(song, i); return `rgb(${c[1]},${c[2]},${c[3]})`; } catch (e) { return "#888"; } };
  const curInst = () => (typeof instrument !== "undefined" ? instrument : -1);
  const native = {
    muted: (i) => { try { return !!audioSystem.getMute(i); } catch (e) { return false; } },
    solo: (i) => { try { return !!audioSystem.hasSolo(i); } catch (e) { return false; } },
    locked: (i) => { try { return !!instMgr.isLocked(i); } catch (e) { return false; } },
  };
  const SVG = {
    folder: '<svg viewBox="0 0 24 24"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/></svg>',
    open: '<svg viewBox="0 0 24 24"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5V10H7.2a1.5 1.5 0 0 0-1.4 1L3 18.5z"/><path d="M6.2 11h15.3l-2.8 7.2a1.2 1.2 0 0 1-1.1.8H3.4z"/></svg>',
    group: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="11" height="4" rx="1.2"/><rect x="7" y="10" width="13" height="4" rx="1.2"/><rect x="5" y="16" width="9" height="4" rx="1.2"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3l18 18M10.6 5.1A9.7 9.7 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
    caret: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 9l6 6 6-6"/></svg>',
    right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M9 6l6 6-6 6"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14"/></svg>',
    mix: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 4v16M12 4v16M19 4v16"/><circle cx="5" cy="14" r="2.4" fill="currentColor"/><circle cx="12" cy="8" r="2.4" fill="currentColor"/><circle cx="19" cy="16" r="2.4" fill="currentColor"/></svg>',
  };
  function counts() { const c = { inst: new Map(), g: new Map() }; for (const n of live()) { c.inst.set(n.instrument, (c.inst.get(n.instrument) || 0) + 1); const g = n[G]; if (g) c.g.set(g, (c.g.get(g) || 0) + 1); } return c; }
  function isOpenPath(node) { let f = find(tree, (x) => x === node), p = f && f.parent; while (p) { if (!p.open) return false; f = find(tree, (x) => x === p); p = f && f.parent; } return true; }
  function render() {
    renderQueued = false;
    if (!treeEl || !panelOpen()) return;
    if (drag.active || mixDrag || treeEl.querySelector(".osg-ly-rename")) { renderLater = true; return; }   // never rebuild the list mid-drag, mid-rename or while a mixer slider is held
    if (colorPop && colorKey && !byKey(colorKey)) closeColor();
    renderLater = false;
    sync();
    const c = counts(), sel = typeof selection !== "undefined" ? selection.notes.length : 0, S = state();
    const gi = new Map();   // group id → Map(instrument → count), for the rows inside an expanded group
    for (const n of live()) { const g = n[G]; if (!g) continue; let m = gi.get(g); if (!m) gi.set(g, (m = new Map())); m.set(n.instrument, (m.get(n.instrument) || 0) + 1); }
    box.querySelector("[data-tool=group]").disabled = !sel;
    const anySolo = soloAnyAll();
    box.querySelector("[data-tool=unsolo]").hidden = !anySolo;
    let html = "";
    walk(tree, (n, parent, s, inh, depth) => {
      if (n.t === "i" && !c.inst.get(n.inst)) return;     // tracks show once they have notes (and keep their place)
      if (parent && !isOpenPath(n)) return;
      const k = keyOf(n), cls = ["osg-ly-row", "osg-ly-" + n.t];
      const muted = s.mute || (n.t === "i" && native.muted(n.inst)), solo = s.solo || (n.t === "i" && native.solo(n.inst));
      if (s.hidden) cls.push("is-hidden"); if (muted) cls.push("is-muted"); if (s.lock) cls.push("is-locked");
      if (solo) cls.push("is-solo"); else if (anySolo) cls.push("is-dim");
      if (rowSel.has(k)) cls.push("sel");
      if (n.auto) cls.push("osg-ly-auto");
      const b = (act, on, title, icon) => `<button class="osg-ly-b${on ? " on" : ""}" data-act="${act}" title="${title}" aria-label="${title}" aria-pressed="${!!on}">${icon}</button>`;
      let lead, meta, btns, name;
      if (n.t === "f") {
        name = n.name;
        lead = `<button class="osg-ly-caret" data-act="toggle" aria-label="${n.open ? "Collapse" : "Expand"}" aria-expanded="${!!n.open}">${n.open ? SVG.caret : SVG.right}</button><span class="osg-ly-ic" style="--c:${n.color}">${n.open ? SVG.open : SVG.folder}</span>`;
        let inside = 0; (function rec(x) { if (x.t === "i") inside += c.inst.get(x.inst) || 0; else { if (x.t === "g") inside += c.g.get(x.id) || 0; (x.kids || []).forEach(rec); } })(n);
        meta = [n.kids.length, `${n.kids.length} item${n.kids.length === 1 ? "" : "s"}, ${inside.toLocaleString()} notes inside`];
        btns = b("mix", mixOpen.has(k), "Volume & effects of every track inside", SVG.mix) + b("hide", n.hidden, "Hide everything inside", n.hidden ? SVG.eyeOff : SVG.eye) + b("mute", n.mute, "Mute everything inside", "M") + b("solo", n.solo, "Solo everything inside", "S") + b("lock", n.lock, "Lock everything inside", SVG.lock);
      } else if (n.t === "i") {
        name = instName(n.inst);
        lead = `<span class="osg-ly-sp"></span><span class="osg-ly-chip" style="--c:${instColor(n.inst)}"></span>`;
        meta = [(c.inst.get(n.inst) || 0).toLocaleString(), `${(c.inst.get(n.inst) || 0).toLocaleString()} notes`];
        btns = b("mix", mixOpen.has(k), "Volume & effects", SVG.mix) + b("hide", n.hidden, "Hide this track (it still plays)", n.hidden ? SVG.eyeOff : SVG.eye) + b("mute", native.muted(n.inst), "Mute", "M") + b("solo", native.solo(n.inst), "Solo", "S") + b("lock", native.locked(n.inst), "Lock (stops editing its notes)", SVG.lock);
        if (n.inst === curInst()) cls.push("current");
      } else {
        name = n.name;
        const parts = gi.get(n.id);
        lead = ((parts && parts.size) || (n.kids && n.kids.length) ? `<button class="osg-ly-caret" data-act="toggle" aria-label="${n.open ? "Collapse" : "Expand"}" aria-expanded="${!!n.open}">${n.open ? SVG.caret : SVG.right}</button>` : `<span class="osg-ly-sp"></span>`) + `<span class="osg-ly-ic" style="--c:${n.color}">${SVG.group}</span>`;
        let inside = 0; (function rec(x) { if (x.t === "i") inside += c.inst.get(x.inst) || 0; else { if (x.t === "g") inside += c.g.get(x.id) || 0; (x.kids || []).forEach(rec); } })(n);
        meta = [inside.toLocaleString(), `${(c.g.get(n.id) || 0).toLocaleString()} notes in this group${n.kids && n.kids.length ? `, ${inside.toLocaleString()} including the ${n.kids.length} item${n.kids.length === 1 ? "" : "s"} inside` : ""}`];
        btns = (sel ? b("addsel", false, "Add the selected notes to this group", SVG.plus) : "") + b("mix", mixOpen.has(k), "Volume & effects of the instruments in this group", SVG.mix) + b("hide", n.hidden, "Hide this group (it still plays)", n.hidden ? SVG.eyeOff : SVG.eye) + b("mute", n.mute, "Mute this group", "M") + b("solo", n.solo, "Solo this group", "S") + b("lock", n.lock, "Lock this group", SVG.lock);

      }
      html += `<div class="${cls.join(" ")}" data-key="${esc(k)}" role="treeitem" tabindex="0" aria-level="${depth + 1}" style="padding-left:${6 + depth * 16}px">${lead}<span class="osg-ly-name" title="${esc(name)}">${esc(name)}</span><span class="osg-ly-meta" title="${meta[1]}">${meta[0]}</span><span class="osg-ly-btns">${btns}<button class="osg-ly-b" data-act="menu" title="More" aria-label="More options">${SVG.more}</button></span></div>`;
      if (mixOpen.has(k)) html += mixerHtml(k, n, depth);
      // an expanded group lists the instruments its notes are on
      if (n.t === "g" && n.open) { const parts = gi.get(n.id); if (parts) for (const [inst, cnt] of [...parts.entries()].sort((a, b) => b[1] - a[1])) html += `<div class="osg-ly-row osg-ly-gi" data-key="${esc(k)}" data-inst="${inst}" role="treeitem" tabindex="0" aria-level="${depth + 2}" title="Click to select these notes" style="padding-left:${6 + (depth + 1) * 16 + 18}px"><span class="osg-ly-chip" style="--c:${instColor(inst)}"></span><span class="osg-ly-name">${esc(instName(inst))}</span><span class="osg-ly-meta" title="${cnt.toLocaleString()} notes of this instrument in the group">${cnt.toLocaleString()}</span></div>`; }
    });
    const focusKey = treeEl.contains(document.activeElement) ? document.activeElement.dataset?.key : null;
    treeEl.innerHTML = html || `<div class="osg-ly-empty">Add some notes and your instruments show up here as tracks. Select notes and press <b>Ctrl+G</b> to group them, and make folders to organise everything.</div>`;
    for (const k of [...rowSel]) if (!byKey(k)) rowSel.delete(k);
    box.querySelector("[data-tool=group]").disabled = !sel && !rowSel.size;
    if (focusKey) { const r = treeEl.querySelector(`.osg-ly-row:not(.osg-ly-gi)[data-key="${CSS.escape(focusKey)}"]`); if (r) r.focus({ preventScroll: true }); }
  }
  // ---------- row selection (click, Shift+click for a range, Ctrl+click to toggle) ----------
  let rowSel = new Set(), rowAnchor = null;
  const visibleKeys = () => [...treeEl.querySelectorAll(".osg-ly-row:not(.osg-ly-gi)")].map((r) => r.dataset.key);
  function paintSel() { if (!treeEl) return; treeEl.querySelectorAll(".osg-ly-row:not(.osg-ly-gi)").forEach((r) => r.classList.toggle("sel", rowSel.has(r.dataset.key))); box.querySelector("[data-tool=group]").disabled = !rowSel.size && !(typeof selection !== "undefined" && selection.notes.length); }
  function selectRow(k, e) {
    const keys = visibleKeys();
    if (e.shiftKey && rowAnchor && keys.includes(rowAnchor)) { const a = keys.indexOf(rowAnchor), b = keys.indexOf(k); rowSel = new Set(keys.slice(Math.min(a, b), Math.max(a, b) + 1)); }
    else if (e.ctrlKey || e.metaKey) { if (rowSel.has(k)) rowSel.delete(k); else rowSel.add(k); rowAnchor = k; }
    else { rowSel = new Set([k]); rowAnchor = k; }
    paintSel();
  }
  function clearRowSel() { if (!rowSel.size) return; rowSel.clear(); paintSel(); }
  // the selected rows minus any that sit inside another selected row, in the order they are shown
  function topSelected() { const keys = visibleKeys().filter((k) => rowSel.has(k)); return keys.filter((k) => { let f = byKey(k); while (f && f.parent) { if (rowSel.has(keyOf(f.parent))) return false; f = byKey(keyOf(f.parent)); } return true; }); }
  // put the selected rows into a new group or folder, where the first of them was
  function wrapRows(kind) {
    const keys = topSelected(); if (!keys.length) return false;
    const first = byKey(keys[0]), list = first.list, idx = first.index;
    const node = kind === "g" ? newGroupNode(nextName("g", "Group")) : newFolderNode(nextName("f", "Folder")); node.open = true;
    for (const k of keys) { const f = byKey(k); f.list.splice(f.index, 1); node.kids.push(f.node); }
    list.splice(Math.min(idx, list.length), 0, node);
    rowSel = new Set([keyOf(node)]); rowAnchor = keyOf(node); changed();
    toast(`${keys.length} item${keys.length === 1 ? "" : "s"} put into "${node.name}"`);
    setTimeout(() => startRename(keyOf(node)), 60);
    return true;
  }
  // dissolve the selected groups / folders (what's inside moves up a level; a group's own notes are freed)
  function unwrapRows() {
    const keys = topSelected().filter((k) => { const f = byKey(k); return f && isContainer(f.node); }); if (!keys.length) return false;
    const freed = [];
    for (const k of keys) { const f = byKey(k); if (!f) continue; if (f.node.t === "g") { for (const x of live()) if (x[G] === f.node.id) freed.push(x); } if (f.node.auto) opts.noThumb = true; removeNode(f, true); }
    rowSel.clear(); if (freed.length) setGroups(freed, null); changed();
    toast(`Dissolved ${keys.length} ${keys.length === 1 ? "item" : "items"}`);
    return true;
  }
  function refresh() { if (renderQueued) return; renderQueued = true; requestAnimationFrame(render); }
  function changed() { rev++; saveSoon(); apply(); refresh(); }
  function toast(msg) { try { message(msg); } catch (e) {} }

  // ---------- actions ----------
  function scrollToNotes(list) {
    if (!list.length) return;
    try { const t0 = Math.min(...list.map((n) => n.time)), x = t0 * noteWidth; if (x < scrollLeft || x > scrollLeft + SequencerView.width - 60) setScrollLeft(Math.max(0, x - 40), true); } catch (e) {}
  }
  function selectList(list) {
    const want = new Set(list.filter((n) => !blocked(n) && !native.locked(n.instrument)));
    try { selectNotesIf((n) => want.has(n)); } catch (e) { selection.setNotes([...want]); updateSelection(); }
    scrollToNotes([...want]);
  }
  // group membership changes go on the site's undo stack (Ctrl+Z / Ctrl+Y)
  function setGroups(notes, gid, label) {
    const before = notes.map((n) => n[G] || null);
    const autoIds = new Set(); walk(tree, (x) => { if (x.t === "g" && x.auto) autoIds.add(x.id); });
    const doIt = () => { notes.forEach((n, i) => { if (gid) n[G] = gid; else { if (before[i] && autoIds.has(before[i])) n.__osgNT = 1; delete n[G]; } }); changed(); };
    const undoIt = () => { notes.forEach((n, i) => { if (before[i]) n[G] = before[i]; else delete n[G]; }); changed(); };
    try { exec(doIt, undoIt); } catch (e) { doIt(); }
    if (label) toast(label);
  }
  // Ctrl+G: rows selected in the panel → a new group around them; otherwise the selected notes become a group
  function groupSelection() {
    if (rowSel.size && panelOpen() && wrapRows("g")) return;
    const ns = (typeof selection !== "undefined" ? selection.notes : []).filter((n) => !blocked(n));
    if (!ns.length) { toast("Select some notes (or rows in Layers) first, then press Ctrl+G."); return; }
    const g = newGroupNode(nextName("g", "Group")); g.color = PALETTE[(parseInt(g.name.split(" ").pop(), 10) - 1) % PALETTE.length];
    tree.unshift(g);
    setGroups(ns, g.id, `Grouped ${ns.length} note${ns.length === 1 ? "" : "s"} as "${g.name}"`);
    open();
  }
  // Ctrl+Shift+G: dissolve the selected groups / folders, or take the selected notes out of their group
  function ungroupSelection() {
    if (rowSel.size && panelOpen() && unwrapRows()) return;
    const ns = (typeof selection !== "undefined" ? selection.notes : []).filter((n) => n[G]);
    if (!ns.length) { toast("None of the selected notes are in a group."); return; }
    setGroups(ns, null, `Took ${ns.length} note${ns.length === 1 ? "" : "s"} out of their group`);
  }
  // Ctrl+Alt+G / "New folder": rows selected → a folder around them; notes selected → a folder holding a new group of them; else an empty folder
  function newFolder(inside) {
    if (!inside && rowSel.size && panelOpen() && wrapRows("f")) return;
    const f = newFolderNode(nextName("f", "Folder"));
    const ns = !inside && typeof selection !== "undefined" ? selection.notes.filter((n) => !blocked(n)) : [];
    if (ns.length) { const g = newGroupNode(nextName("g", "Group")); f.kids.push(g); tree.unshift(f); setGroups(ns, g.id, `Grouped ${ns.length} note${ns.length === 1 ? "" : "s"} as "${g.name}" inside "${f.name}"`); open(); }
    else { (inside ? inside.kids : tree).unshift(f); if (inside) inside.open = true; changed(); }
    setTimeout(() => startRename(keyOf(f)), 60);
  }
  function newGroupIn(inside) { const g = newGroupNode(nextName("g", "Group")); inside.kids.unshift(g); inside.open = true; changed(); setTimeout(() => startRename(keyOf(g)), 60); }
  // rename a track: the site keeps instrument names in the instrument settings (same as the name box in Instrument settings)
  function renameInst(inst, v) {
    try { const st = song.getInstrumentSettings(inst); if (!st) return; st.name = v === instMgr.getDefaultName(inst) ? "" : v; } catch (e) { return; }
    try { updateUiForInstrumentClones(); } catch (e) {} try { fillAdvancedInstrumentSettings(); } catch (e) {} try { setConfirmExit(true); } catch (e) {}
  }
  function startRename(k) {
    render();
    const row = treeEl.querySelector(`.osg-ly-row:not(.osg-ly-gi)[data-key="${CSS.escape(k)}"]`), f = byKey(k); if (!row || !f || row.querySelector(".osg-ly-rename")) return;
    const n = f.node, cur = n.t === "i" ? instName(n.inst) : n.name;
    const span = row.querySelector(".osg-ly-name"), input = document.createElement("input"); if (!span) return;
    input.className = "osg-ly-rename"; input.value = cur; input.maxLength = 60; span.replaceWith(input); input.focus(); input.select();
    let done = false;
    const finish = (ok) => { if (done) return; done = true; const v = input.value.trim(); input.replaceWith(span); if (ok && v && v !== cur) { if (n.t === "i") renameInst(n.inst, v); else n.name = v; changed(); } else render(); };
    input.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") finish(true); else if (e.key === "Escape") finish(false); });
    input.addEventListener("keyup", (e) => e.stopPropagation()); input.addEventListener("keypress", (e) => e.stopPropagation());
    input.addEventListener("blur", () => finish(true));
  }
  // ---------- colour popover: right-click a row's icon, Alt+I, or "Change color" in the ⋯ menu ----------
  const SWATCHES = ["#7c5cff", "#4fc3f7", "#ff7043", "#81c784", "#f06292", "#ffd54f", "#4db6ac", "#ba68c8", "#e57373", "#90caf9", "#ff8a65", "#aed581", "#ffb74d", "#9575cd", "#4dd0e1", "#a1887f", "#b0b0c8", "#ffffff"];
  let colorPop = null, colorKey = null;
  const hex2rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const rgb2hex = (r, g, b) => "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, "0")).join("");
  function colorOf(n) { if (n.t !== "i") return n.color || PALETTE[0]; try { const c = getInstrumentColor(song, n.inst); return rgb2hex(c[1], c[2], c[3]); } catch (e) { return "#888888"; } }
  function setColor(n, hex) {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
    if (n.t === "i") {
      try { const [r, g, b] = hex2rgb(hex); const st = song.getInstrumentSettings(n.inst); st.color = [255, r, g, b]; updateInstrumentColor(n.inst); } catch (e) { return; }
      try { SequencerView.repaint(kRepaintNotesChanged); } catch (e) {} try { fillAdvancedInstrumentSettings(); } catch (e) {} try { setConfirmExit(true); } catch (e) {}
      refresh();
    } else { n.color = hex; changed(); }
  }
  function resetColor(n) { if (n.t !== "i") return; try { song.getInstrumentSettings(n.inst).color = []; updateInstrumentColor(n.inst); SequencerView.repaint(kRepaintNotesChanged); } catch (e) {} try { fillAdvancedInstrumentSettings(); } catch (e) {} refresh(); }
  function closeColor() { if (colorPop) { (window.__osgPopOut || ((e) => e.remove()))(colorPop); colorPop = null; colorKey = null; } }
  function openColor(k, anchor) {
    closeColor(); const f = byKey(k); if (!f) return; const n = f.node;
    if (!anchor) anchor = treeEl.querySelector(`.osg-ly-row:not(.osg-ly-gi)[data-key="${CSS.escape(k)}"] .osg-ly-ic, .osg-ly-row:not(.osg-ly-gi)[data-key="${CSS.escape(k)}"] .osg-ly-chip`);
    if (!anchor) return;
    colorKey = k;
    const cur = colorOf(n);
    const pop = document.createElement("div"); pop.id = "osg-ly-color"; pop.setAttribute("role", "dialog"); pop.setAttribute("aria-label", "Colour");
    pop.innerHTML = `<div class="osg-ly-color-title">${esc(n.t === "i" ? instName(n.inst) : n.name)}</div><div class="osg-ly-swatches">${SWATCHES.map((c) => `<button type="button" class="osg-ly-swatch${c.toLowerCase() === cur.toLowerCase() ? " on" : ""}" data-c="${c}" style="--c:${c}" title="${c}" aria-label="${c}"></button>`).join("")}</div><div class="osg-ly-color-row"><label class="osg-ly-custom"><span class="osg-ly-swatch" style="--c:${esc(cur)}"></span><input type="color" value="${esc(cur)}" aria-label="Custom colour"><span>Custom…</span></label>${n.t === "i" ? '<button type="button" class="osg-ly-color-reset">Default</button>' : ""}</div>`;
    document.body.appendChild(pop); colorPop = pop;
    const place = () => { const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight; let left = r.right + 10; if (left + w > innerWidth - 6) left = r.left - w - 10; if (left < 6) left = 6; let top = r.top + r.height / 2 - h / 2; top = Math.max(6, Math.min(innerHeight - h - 6, top)); pop.style.left = left + "px"; pop.style.top = top + "px"; };
    place();
    pop.addEventListener("click", (e) => { const sw = e.target.closest(".osg-ly-swatch[data-c]"); if (sw) { setColor(n, sw.dataset.c); closeColor(); return; } if (e.target.closest(".osg-ly-color-reset")) { resetColor(n); closeColor(); } });
    const input = pop.querySelector("input[type=color]"), preview = pop.querySelector(".osg-ly-custom .osg-ly-swatch");
    input.addEventListener("input", () => { preview.style.setProperty("--c", input.value); setColor(n, input.value); });
    input.addEventListener("change", () => setTimeout(closeColor, 150));
    for (const ev of ["keydown", "keyup", "keypress"]) pop.addEventListener(ev, (e) => { e.stopPropagation(); if (ev === "keydown" && e.key === "Escape") closeColor(); });
    pop.querySelector(".osg-ly-swatch[data-c]")?.focus();
  }
  function removeNode(f, keepKids) { f.list.splice(f.index, 1, ...(keepKids && isContainer(f.node) ? f.node.kids || [] : [])); }
  function deleteNotes(list) {   // through the site's own delete, so it can be undone
    if (!list.length) return;
    const was = selection.notes.slice();
    selection.notes.forEach((n) => (n.selected = false)); selection.notes.length = 0;
    for (const n of list) { n.selected = true; selection.notes.push(n); }
    try { deleteSelection(); } catch (e) { selection.setNotes(was); }
  }
  function menuFor(k, anchor) {
    const f = byKey(k); if (!f) return; const n = f.node, items = [], sel = selection.notes;
    const add = (label, fn, danger) => items.push([label, fn, danger]);
    add("Rename", () => startRename(k));
    add("Change color (right-click the icon, or Alt+I)", () => openColor(k));
    add("Select its notes", () => selectList(n.t === "i" ? live().filter((x) => x.instrument === n.inst) : notesIn(n)));
    add("Download as .wav", () => exportLayer(n, false)); add("Download as .mp3", () => exportLayer(n, true));
    if (f.index > 0) add("Move up", () => moveBy(k, -1));
    if (f.index < f.list.length - 1) add("Move down", () => moveBy(k, 1));
    if (f.parent) add(`Move out of "${f.parent.name}"`, () => moveOut(k));
    const targets = []; walk(tree, (x) => { if (isContainer(x) && x !== n && x !== f.parent && !(isContainer(n) && find([n], (y) => y === x))) targets.push(x); });
    if (targets.length) add("Move into…", () => showMenu(anchor, targets.map((x) => [`→ ${x.name}`, () => moveInto(k, x)]).concat([["← Back", () => menuFor(k, anchor)]])));
    if (isContainer(n)) {
      add("New folder inside", () => newFolder(n)); add("New group inside", () => newGroupIn(n));
    }
    if (n.t === "f") {
      if (n.auto === "thumb") add("Look for more thumbnail art", () => autoThumb(true));
      add("Delete folder (keep what's inside)", () => { removeNode(f, true); if (n.auto) opts.noThumb = true; changed(); });
      add("Delete folder and all its notes", () => { const ns = notesIn(n); if (ns.length && !confirm(`Delete "${n.name}" and the ${ns.length.toLocaleString()} notes in it? Ctrl+Z brings the notes back.`)) return; removeNode(f, false); if (n.auto) opts.noThumb = true; changed(); deleteNotes(ns); }, true);
    } else if (n.t === "g") {
      if (sel.length) add("Add selected notes", () => setGroups(sel.filter((x) => !blocked(x)), n.id));
      if (sel.some((x) => x[G] === n.id)) add("Remove selected notes from group", () => setGroups(sel.filter((x) => x[G] === n.id), null));
      if (n.auto) add("Look for more thumbnail art", () => autoThumb(true));
      add("Ungroup (keep the notes and what's inside)", () => { const ns = live().filter((x) => x[G] === n.id); removeNode(f, true); if (n.auto) opts.noThumb = true; setGroups(ns, null); changed(); });
      add("Delete group and all its notes", () => { const ns = notesIn(n); if (ns.length && !confirm(`Delete "${n.name}" and the ${ns.length.toLocaleString()} notes in it? Ctrl+Z brings the notes back.`)) return; removeNode(f, false); if (n.auto) opts.noThumb = true; changed(); deleteNotes(ns); }, true);
    } else {
      add("Make it the current instrument", () => { try { selectInstrument(n.inst); } catch (e) {} refresh(); });
      add("Delete track (all its notes)", () => { const ns = live().filter((x) => x.instrument === n.inst); if (!confirm(`Delete ${instName(n.inst)} and its ${ns.length.toLocaleString()} notes? Ctrl+Z brings them back.`)) return; deleteNotes(ns); }, true);
    }
    showMenu(anchor, items);
  }
  function showMenu(anchor, items) {
    menu.innerHTML = items.map(([l, , d], i) => `<button type="button" data-i="${i}"${d ? ' class="danger"' : ""}>${esc(l)}</button>`).join("");
    menu.hidden = false; const r = anchor.getBoundingClientRect();
    menu.style.left = Math.max(6, Math.min(innerWidth - menu.offsetWidth - 6, r.right - menu.offsetWidth)) + "px";
    menu.style.top = (r.bottom + menu.offsetHeight + 6 > innerHeight ? r.top - menu.offsetHeight - 4 : r.bottom + 4) + "px";
    menu.onclick = (e) => { const b = e.target.closest("[data-i]"); if (!b) return; menu.hidden = true; items[+b.dataset.i][1](); };
  }
  // ---------- mixer drawer: volume and effects of a track, or of every track inside a folder / group ----------
  const mixOpen = new Set(); let mixDrag = false;
  const REVERBS = [[1, "Classic"], [2, "Small"], [13, "Short"], [3, "Large"], [12, "Church"], [4, "Gated"], [14, "Lead Guitar"], [15, "Rhythm Guitar"], [5, "Reverse"], [6, "Nova"], [7, "Ripple"], [8, "Miasma"]];
  const DISTORTS = [[1, "Limit"], [10, "SoftLim"], [2, "Zest"], [3, "Quasar"], [4, "Styx"], [5, "Lucid"], [6, "Tremor"], [7, "Zircon"], [8, "Hornet"], [9, "Shear"]];
  function instsIn(node) { const out = []; (function rec(x) { if (x.t === "i") out.push(x.inst); else { if (x.t === "g") for (const n of live()) if (n[G] === x.id && !out.includes(n.instrument)) out.push(n.instrument); (x.kids || []).forEach(rec); } })(node); return out; }
  // the instruments a drawer edits: a track (plus the other selected tracks when it is selected), or everything inside a container
  function mixTargets(k) {
    const f = byKey(k); if (!f) return [];
    if (f.node.t !== "i") return instsIn(f.node);
    const list = [f.node.inst];
    if (rowSel.has(k)) for (const key of rowSel) { const g = byKey(key); if (g && g.node.t === "i" && !list.includes(g.node.inst)) list.push(g.node.inst); }
    return list;
  }
  const instVol = (i) => { try { return +getInitialInstrumentVolume(i); } catch (e) { return instVolume(i); } };
  function mixerHtml(k, node, depth) {
    const ts = mixTargets(k); if (!ts.length) return `<div class="osg-ly-mix" data-key="${esc(k)}" style="padding-left:${6 + depth * 16 + 20}px"><div class="osg-ly-mix-empty">No tracks inside yet.</div></div>`;
    const i = ts[0], st = song.getInstrumentSettings(i) || {}, eq = st.eq || {};
    const sl = (f, label, v, min, max, step, fmt) => `<label class="osg-mx"><span>${label}</span><input type="range" data-f="${f}" min="${min}" max="${max}" step="${step}" value="${v}"><output>${fmt(v)}</output></label>`;
    const cb = (f, label, on) => `<label class="osg-mx-cb"><input type="checkbox" data-f="${f}"${on ? " checked" : ""}><span>${label}</span></label>`;
    const sel = (f, opts, v) => `<select data-f="${f}">${opts.map(([val, name]) => `<option value="${val}"${+v === val ? " selected" : ""}>${name}</option>`).join("")}</select>`;
    const pct = (v) => Math.round(v * 100) + "%", num = (v) => String(Math.round(v)), pan = (v) => (Math.abs(v) < 0.005 ? "C" : (v < 0 ? "L" : "R") + Math.round(Math.abs(v) * 100));
    const head = ts.length > 1 ? `${ts.length} tracks (showing ${esc(instName(i))})` : esc(instName(i));
    return `<div class="osg-ly-mix" data-key="${esc(k)}" style="padding-left:${6 + depth * 16 + 20}px">
      <div class="osg-ly-mix-head"><span>${head}</span><button type="button" class="osg-ly-b" data-act="mix" title="Close">✕</button></div>
      ${sl("volume", "Volume", instVol(i), 0, 2, 0.01, pct)}
      ${sl("pan", "Pan", st.pan ?? 0, -1, 1, 0.01, pan)}
      ${sl("detune", "Detune", st.detune ?? 0, -1200, 1200, 1, (v) => num(v) + "¢")}
      <div class="osg-mx-fx">${cb("reverb", "Reverb", !!st.reverb)}${sel("reverbType", REVERBS, st.reverbType || 1)}</div>
      ${sl("reverbVolume", "Reverb amt", st.reverbVolume ?? 0.5, 0, 1, 0.01, pct)}
      <div class="osg-mx-fx">${cb("delay", "Delay", !!st.delay)}${cb("bitcrusher", "Bitcrusher", !!st.bitcrusher)}${cb("eq", "EQ", !!eq.enabled)}</div>
      <div class="osg-mx-fx">${cb("distort", "Distortion", !!st.distort)}${sel("distortType", DISTORTS, st.distortType || 1)}</div>
      ${sl("distortVolume", "Distort amt", st.distortVolume ?? 0, 0, 1, 0.01, pct)}
      ${sl("bitcrusherDepth", "Crush depth", st.bitcrusherDepth ?? 12, 1, 16, 1, num)}
      ${sl("bitcrusherLevel", "Crush level", st.bitcrusherLevel ?? 0.5, 0, 1, 0.01, pct)}
      ${sl("eqLow", "EQ low", eq.low ?? 0, -48, 48, 1, num)}${sl("eqMid", "EQ mid", eq.mid ?? 0, -48, 48, 1, num)}${sl("eqHigh", "EQ high", eq.high ?? 0, -48, 48, 1, num)}
    </div>`;
  }
  // read / write one setting of one instrument through the site's own functions (so its own panel and the audio stay in step)
  function mixGet(i, f) { const st = song.getInstrumentSettings(i) || {}, eq = st.eq || {}; switch (f) { case "volume": return instVol(i); case "eq": return !!eq.enabled; case "eqLow": return eq.low ?? 0; case "eqMid": return eq.mid ?? 0; case "eqHigh": return eq.high ?? 0; case "reverb": case "delay": case "bitcrusher": case "distort": return !!st[f]; default: return st[f]; } }
  function mixSet(i, f, v) {
    try {
      switch (f) {
        case "volume": setInitialInstrumentVolume(i, +v); { const e = document.getElementById("instrument_volume_" + i); if (e) e.value = +v; } break;
        case "pan": setPan(i, +v); break;
        case "detune": setDetune(i, +v); break;
        case "reverb": if (!!mixGet(i, f) !== !!v) selectReverb(i); break;
        case "reverbType": selectReverbType(i, +v); break;
        case "reverbVolume": setReverbVolume(i, +v); break;
        case "delay": if (!!mixGet(i, f) !== !!v) selectDelay(i); break;
        case "distort": if (!!mixGet(i, f) !== !!v) selectDistort(i); break;
        case "distortType": selectDistortType(i, +v); break;
        case "distortVolume": setDistortVolume(i, +v); break;
        case "bitcrusher": if (!!mixGet(i, f) !== !!v) selectBitcrusher(i); break;
        case "bitcrusherDepth": setBitcrusherDepth(i, +v); break;
        case "bitcrusherLevel": setBitcrusherLevel(i, +v); break;
        case "eq": if (!!mixGet(i, f) !== !!v) selectEq(i); break;
        case "eqLow": setEqLow(i, +v); break;
        case "eqMid": setEqMid(i, +v); break;
        case "eqHigh": setEqHigh(i, +v); break;
      }
      if (i === curInst()) { try { fillAdvancedInstrumentSettings(); } catch (e) {} }
    } catch (e) {}
  }
  const mixBefore = new Map();   // "key|field" → values before the slider was grabbed (for one undo step per gesture)
  function mixInput(drawer, input, commit) {
    const k = drawer.dataset.key, f = input.dataset.f, ts = mixTargets(k); if (!ts.length) return;
    const v = input.type === "checkbox" ? input.checked : +input.value;
    const bk = k + "|" + f; if (!mixBefore.has(bk)) mixBefore.set(bk, ts.map((i) => [i, mixGet(i, f)]));
    for (const i of ts) mixSet(i, f, v);
    const out = input.parentElement && input.parentElement.querySelector("output"); if (out) { const fmt = { volume: (x) => Math.round(x * 100) + "%", reverbVolume: (x) => Math.round(x * 100) + "%", distortVolume: (x) => Math.round(x * 100) + "%", bitcrusherLevel: (x) => Math.round(x * 100) + "%", pan: (x) => (Math.abs(x) < 0.005 ? "C" : (x < 0 ? "L" : "R") + Math.round(Math.abs(x) * 100)), detune: (x) => Math.round(x) + "¢" }[f] || ((x) => String(Math.round(x))); out.textContent = fmt(v); }
    if (commit) {   // one undo step for the whole drag
      const before = mixBefore.get(bk); mixBefore.delete(bk);
      const after = ts.map((i) => [i, mixGet(i, f)]);
      if (before && JSON.stringify(before) !== JSON.stringify(after)) exec(() => { for (const [i, x] of after) mixSet(i, f, x); refresh(); }, () => { for (const [i, x] of before) mixSet(i, f, x); refresh(); });
      if (f === "reverb" || f === "delay" || f === "distort" || f === "bitcrusher" || f === "eq" || f === "reverbType" || f === "distortType") refresh();
    }
  }
  function rowAction(k, act, btn) {
    const f = byKey(k); if (!f) return; const n = f.node;
    if (act === "menu") return menuFor(k, btn);
    if (act === "mix") { if (mixOpen.has(k)) mixOpen.delete(k); else mixOpen.add(k); refresh(); return; }
    if (act === "toggle") { n.open = !n.open; rev++; saveSoon(); refresh(); return; }
    if (act === "addsel") { const ns = selection.notes.filter((x) => !blocked(x)); setGroups(ns, n.id, `Added ${ns.length} note${ns.length === 1 ? "" : "s"} to "${n.name}"`); return; }
    if (n.t === "i" && act === "mute") { try { muteInstrument(n.inst); } catch (e) {} refresh(); return; }
    if (n.t === "i" && act === "solo") { try { soloInstrument(n.inst); } catch (e) {} refresh(); return; }
    if (n.t === "i" && act === "lock") { try { lockInstrument(n.inst); } catch (e) {} dropBlockedFromSelection(); refresh(); return; }
    if (act === "solo") { n.solo = !n.solo; changed(); return; }
    const prop = act === "hide" ? "hidden" : act; n[prop] = !n[prop]; changed();
  }
  function rowClick(k, e, inst) {
    const f = byKey(k); if (!f) return; const n = f.node;
    if (inst == null) { selectRow(k, e); if (e.shiftKey || e.ctrlKey || e.metaKey) return; }   // modifier clicks only change the row selection
    if (n.t === "i") { try { selectInstrument(n.inst); } catch (err) {} refresh(); }
    else if (n.t === "g") selectList(inst == null ? notesIn(n) : live().filter((x) => x[G] === n.id && x.instrument === inst));
    else if (e.detail === 1) { clearTimeout(clickTimer); clickTimer = setTimeout(() => { n.open = !n.open; changed(); }, 230); }   // a double-click renames instead
  }
  // ---------- drag and drop (pointer based, so it also works with touch and inside the site's sidebar) ----------
  // Press on a row and move: drop above / below another row to reorder, or onto the middle of a folder to put it inside.
  function dropZone(row, y) { const r = row.getBoundingClientRect(), f = (y - r.top) / r.height; if ((row.classList.contains("osg-ly-f") || row.classList.contains("osg-ly-g")) && f > 0.28 && f < 0.72) return "into"; return f < 0.5 ? "before" : "after"; }
  function clearDrop() { treeEl.querySelectorAll(".drop-before, .drop-after, .drop-into").forEach((r) => r.classList.remove("drop-before", "drop-after", "drop-into")); treeEl.classList.remove("drop-end"); }
  function dragStart(e, row) {
    drag.active = true; drag.key = row.dataset.key; drag.dstKey = null; drag.zone = null;
    // dragging one of several selected rows drags them all
    drag.keys = rowSel.has(drag.key) && rowSel.size > 1 ? topSelected() : [drag.key];
    const inside = new Set(); for (const k of drag.keys) { const f = byKey(k); if (f) walk([f.node], (x) => { inside.add(keyOf(x)); }); }
    drag.inside = inside;
    treeEl.querySelectorAll(".osg-ly-row").forEach((r) => { if (inside.has(r.dataset.key)) r.classList.add("dragging"); });
    const g = document.createElement("div"); g.className = "osg-ly-ghost"; g.textContent = drag.keys.length > 1 ? `${drag.keys.length} items` : row.querySelector(".osg-ly-name")?.textContent || ""; document.body.appendChild(g); drag.ghost = g;
    document.body.classList.add("osg-ly-dragging");
    dragMove(e);
  }
  function dragMove(e) {
    if (drag.ghost) { drag.ghost.style.left = (e.clientX + 12) + "px"; drag.ghost.style.top = (e.clientY - 10) + "px"; }
    clearDrop(); drag.dstKey = null; drag.zone = null;
    const tr = treeEl.getBoundingClientRect();
    // auto-scroll the list near its edges
    if (e.clientY < tr.top + 24) treeEl.scrollTop -= 8; else if (e.clientY > tr.bottom - 24) treeEl.scrollTop += 8;
    if (e.clientX < tr.left - 40 || e.clientX > tr.right + 40 || e.clientY < tr.top - 40 || e.clientY > tr.bottom + 40) { drag.ghost?.classList.add("off"); return; }
    drag.ghost?.classList.remove("off");
    let row = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".osg-ly-row");
    if (row && !treeEl.contains(row)) row = null;
    if (row && row.classList.contains("osg-ly-gi")) { row = treeEl.querySelector(`.osg-ly-row:not(.osg-ly-gi)[data-key="${CSS.escape(row.dataset.key)}"]`); drag.zone = "after"; }
    if (!row) { treeEl.classList.add("drop-end"); drag.dstKey = ""; drag.zone = "after"; return; }
    if (drag.inside.has(row.dataset.key)) return;
    drag.dstKey = row.dataset.key; drag.zone = drag.zone || dropZone(row, e.clientY);
    row.classList.add("drop-" + drag.zone);
  }
  function dragEnd(doDrop) {
    const { keys, dstKey, zone, inside } = drag;
    treeEl.querySelectorAll(".dragging").forEach((r) => r.classList.remove("dragging")); clearDrop();
    drag.ghost?.remove(); drag.ghost = null; document.body.classList.remove("osg-ly-dragging");
    drag.active = false; drag.key = null; drag.keys = null; drag.inside = null; drag.pid = null;
    if (doDrop && keys && dstKey !== null && !inside.has(dstKey)) moveNodes(keys, dstKey || null, zone);
    else if (renderLater) refresh();
  }
  function wireDrag() {
    treeEl.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || drag.pid !== null) return;
      const row = e.target.closest(".osg-ly-row"); if (!row || row.classList.contains("osg-ly-gi") || e.target.closest("button, input")) return;
      drag.pid = e.pointerId; drag.x0 = e.clientX; drag.y0 = e.clientY; drag.pending = row;
      const move = (ev) => {
        if (ev.pointerId !== drag.pid) return;
        if (!drag.active) { if (Math.hypot(ev.clientX - drag.x0, ev.clientY - drag.y0) < 5) return; clearTimeout(clickTimer); dragStart(ev, drag.pending); }
        ev.preventDefault(); dragMove(ev);
      };
      const done = () => { document.removeEventListener("pointermove", move, true); document.removeEventListener("pointerup", up, true); document.removeEventListener("pointercancel", cancel, true); };
      const up = (ev) => {
        if (ev.pointerId !== drag.pid) return;
        done();
        if (drag.active) { dragEnd(true); suppressClick = true; setTimeout(() => (suppressClick = false), 0); } else drag.pid = null;
      };
      const cancel = () => { done(); if (drag.active) dragEnd(false); else drag.pid = null; };
      document.addEventListener("pointermove", move, true); document.addEventListener("pointerup", up, true); document.addEventListener("pointercancel", cancel, true);
    });
  }
  let suppressClick = false;
  // moving without dragging (also in the ⋯ menu)
  function moveBy(k, delta) { const f = byKey(k); if (!f) return; const j = f.index + delta; if (j < 0 || j >= f.list.length) return; f.list.splice(f.index, 1); f.list.splice(j, 0, f.node); changed(); }
  function moveOut(k) { const f = byKey(k); if (!f || !f.parent) return; const pf = byKey(keyOf(f.parent)); f.list.splice(f.index, 1); pf.list.splice(pf.index + 1, 0, f.node); changed(); }
  function moveInto(k, target) { moveNodes(rowSel.has(k) && rowSel.size > 1 ? topSelected() : [k], keyOf(target), "into"); }
  function moveNode(srcKey, dstKey, zone) { moveNodes([srcKey], dstKey, zone); }
  function moveNodes(srcKeys, dstKey, zone) {
    srcKeys = srcKeys.filter((k) => k !== dstKey && byKey(k));
    if (!srcKeys.length) return;
    if (dstKey) { const dst = byKey(dstKey); if (!dst) return; for (const k of srcKeys) { const src = byKey(k); if (isContainer(src.node) && find([src.node], (x) => x === dst.node)) { toast("Something can't be moved inside itself."); return; } } }
    const nodes = [];
    for (const k of srcKeys) { const src = byKey(k); if (!src) continue; src.list.splice(src.index, 1); nodes.push(src.node); }
    if (!dstKey) tree.push(...nodes);
    else { const d = byKey(dstKey); if (!d) { tree.push(...nodes); } else if (zone === "into") { (d.node.kids || (d.node.kids = [])).push(...nodes); d.node.open = true; } else d.list.splice(d.index + (zone === "after" ? 1 : 0), 0, ...nodes); }
    changed();
  }

  // ---------- download one layer as .wav / .mp3 ----------
  // Uses the site's own exporter (saveAudio), with playback filtered to the layer's notes. Leading silence is kept
  // (only the tail is trimmed) so that layers exported separately line up with each other.
  let exportSet = null, exportCleanup = null;
  function layerName(n) { return n.t === "i" ? instName(n.inst) : n.name; }
  // notes of a layer that may be rendered: anything muted or locked (itself, through a container, or on the site's own instrument
  // buttons) is left out of the audio
  const renderable = (notes) => notes.filter((x) => !isMutedNote(x) && !instMutedNative(x.instrument) && !isLockedNote(x) && !native.locked(x.instrument));
  const safeName = (t) => String(t).replace(/[\\/:*?"<>|]+/g, "-").trim() || "Layer";
  // render exactly these notes through the site's own exporter; resolves when the file has been handed to the browser
  function exportNotes(name, notes, isMp3) {
    return new Promise((resolve) => {
      if (typeof saveAudio !== "function") { toast("This page can't export audio."); return resolve(false); }
      if (exportSet) { toast("Another layer is still exporting — wait for it to finish."); return resolve(false); }
      if (typeof audioSystem !== "undefined" && audioSystem.recording) { toast("The site is already exporting; try again when it finishes."); return resolve(false); }
      const title = (() => { try { return getTitle(); } catch (e) { return "Untitled"; } })() + " - " + safeName(name);
      const origTitle = window.getTitle, origTrim = window.trimSilence, origSave = window.saveBlobObject;
      exportSet = new Set(notes);
      window.getTitle = () => title;
      if (typeof origTrim === "function") window.trimSilence = (l, r) => { const [, end] = origTrim(l, r); return [0, end]; };   // keep the lead-in, trim only the tail
      let timer = 0, saved = false, watch = 0, wasRecording = false, idle = 0;
      exportCleanup = () => { exportSet = null; exportCleanup = null; clearTimeout(timer); clearInterval(watch); window.getTitle = origTitle; if (typeof origTrim === "function") window.trimSilence = origTrim; if (typeof origSave === "function") window.saveBlobObject = origSave; resolve(saved); };
      if (typeof origSave === "function") window.saveBlobObject = function (...a) { saved = true; try { return origSave.apply(this, a); } finally { setTimeout(() => exportCleanup && exportCleanup(), 0); } };
      timer = setTimeout(() => exportCleanup && exportCleanup(), 20 * 60 * 1000);
      // if the site's exporter stops without producing a file, don't hang the queue
      watch = setInterval(() => { try { const rec = !!audioSystem.recording; if (rec) { wasRecording = true; idle = 0; } else if (wasRecording && ++idle > 6) exportCleanup && exportCleanup(); } catch (e) {} }, 500);
      try { saveAudio(!!isMp3); } catch (e) { exportCleanup(); toast("Couldn't start the export: " + (e.message || e)); }
    });
  }
  function exportLayer(n, isMp3) {
    const notes = renderable(n.t === "i" ? live().filter((x) => x.instrument === n.inst) : notesIn(n));
    if (!notes.length) { toast(`"${layerName(n)}" has nothing to export (muted or locked notes are left out).`); return; }
    toast(`Exporting "${layerName(n)}" as ${isMp3 ? ".mp3" : ".wav"} — ${notes.length.toLocaleString()} notes…`);
    exportNotes(layerName(n), notes, isMp3);
  }
  // every top-level item (folders, groups and loose tracks) as its own file, one after another; muted or locked ones are skipped
  let batch = null;
  async function exportAll(isMp3) {
    if (batch) { toast("A batch export is already running (stop it from the ⋯ menu)."); return; }
    const c = counts();
    const items = tree.filter((n) => (n.t === "i" ? c.inst.get(n.inst) : true));
    const skipped = [], todo = [];
    for (const n of items) {
      const mutedOrLocked = n.t === "i" ? (native.muted(n.inst) || native.locked(n.inst)) : (n.mute || n.lock);
      if (mutedOrLocked) { skipped.push(layerName(n)); continue; }
      const notes = renderable(n.t === "i" ? live().filter((x) => x.instrument === n.inst) : notesIn(n));
      if (notes.length) todo.push({ n, notes }); else skipped.push(layerName(n));
    }
    if (!todo.length) { toast("Nothing to export" + (skipped.length ? ` — every top-level item is muted, locked or empty.` : ".")); return; }
    batch = { stop: false };
    toast(`Exporting ${todo.length} file${todo.length === 1 ? "" : "s"} as ${isMp3 ? ".mp3" : ".wav"}${skipped.length ? ` (skipping ${skipped.length} muted / locked / empty)` : ""}. Your browser may ask to allow multiple downloads.`);
    let done = 0;
    for (const { n, notes } of todo) {
      if (batch.stop) break;
      toast(`Exporting ${done + 1} of ${todo.length}: "${layerName(n)}" (${notes.length.toLocaleString()} notes)…`);
      const ok = await exportNotes(layerName(n), notes, isMp3); if (ok) done++;
      await new Promise((r) => setTimeout(r, 400));
    }
    const stopped = batch.stop; batch = null;
    toast(stopped ? `Batch export stopped after ${done} file${done === 1 ? "" : "s"}.` : `Done — ${done} of ${todo.length} file${todo.length === 1 ? "" : "s"} exported${skipped.length ? `; skipped: ${skipped.join(", ")}` : ""}.`);
  }
  function clearSolo() { let n = 0; walk(tree, (x) => { if (x.t !== "i" && x.solo) { x.solo = false; n++; } }); if (nativeSoloAny()) { try { window.clearSolo(); } catch (e) {} n++; } if (n) changed(); }
  function panelMenu(anchor) {
    const items = [
      ["Find thumbnail art (8-Bit Square duplicates / silent instruments in the first " + THUMB_MEASURES + " measures)", () => autoThumb(true)],
      ["Clear all solos", clearSolo],
      batch ? ["Stop the batch export", () => { if (batch) batch.stop = true; }] : ["Download every top-level folder / group / track as .wav", () => exportAll(false)],
      ...(batch ? [] : [["Download every top-level folder / group / track as .mp3", () => exportAll(true)]]),
      ["Select all rows", () => { rowSel = new Set(visibleKeys()); paintSel(); }],
      ["Expand all", () => { walk(tree, (x) => { if (isContainer(x)) x.open = true; }); changed(); }],
      ["Collapse all", () => { walk(tree, (x) => { if (isContainer(x)) x.open = false; }); changed(); }],
    ];
    showMenu(anchor, items);
  }

  function build() {
    box = document.createElement("div"); box.id = "osg-layers";
    box.innerHTML = `<div class="osg-ly-tools"><button class="osg-ly-tool" data-tool="folder" title="New folder — around the selected rows if any (Ctrl+Alt+G)">${SVG.folder}<span>New folder</span></button><button class="osg-ly-tool" data-tool="group" title="Group the selected notes, or the selected rows (Ctrl+G)">${SVG.group}<span>Group</span></button><button class="osg-ly-tool osg-ly-unsolo" data-tool="unsolo" title="Turn off every soloed group and folder" hidden>S<span>Clear solo</span></button><button class="osg-ly-tool osg-ly-more" data-tool="more" title="More" aria-label="More">${SVG.more}</button></div><div class="osg-ly-tree" role="tree" aria-label="Layers"></div><div class="osg-ly-foot"><button type="button" class="osg-ly-foot-toggle" data-tool="tips" aria-expanded="false"><span class="osg-ly-foot-caret">▴</span> Tips</button><div class="osg-ly-foot-body" hidden>Click rows to select them (<b>Shift</b> for a range, <b>Ctrl</b> to add). <b>Ctrl+G</b> puts the selected rows — or the selected notes — in a new group, <b>Ctrl+Alt+G</b> in a new folder, <b>Ctrl+Shift+G</b> dissolves / ungroups. Double-click, Enter or F2 renames (tracks too); right-click a row's icon, or press Alt+I, to change its colour; right-click anywhere else on a row for its menu. Groups and folders nest inside each other. Drag rows (all selected ones move together) to reorder, or onto the middle of a group or folder to put them inside; the ⋯ menu has Move up / down / into too. ▸ collapses or expands. Hidden notes still play; <b>S</b> solos a group or folder; the ⋯ menu downloads a layer as .wav / .mp3. Saved in this browser for this sequence.</div></div>`;
    treeEl = box.querySelector(".osg-ly-tree");
    menu = document.createElement("div"); menu.id = "osg-ly-menu"; menu.hidden = true; document.body.appendChild(menu);
    box.querySelector("[data-tool=folder]").onclick = () => newFolder(null);
    box.querySelector("[data-tool=group]").onclick = groupSelection;
    box.querySelector("[data-tool=unsolo]").onclick = clearSolo;
    box.querySelector("[data-tool=more]").onclick = (e) => panelMenu(e.currentTarget);
    { // the tips at the bottom stay tucked away until pulled open
      const tg = box.querySelector("[data-tool=tips]"), body = box.querySelector(".osg-ly-foot-body"); let on = LS.get("osg-layers-tips") === "1";
      const paint = () => { body.hidden = !on; tg.setAttribute("aria-expanded", String(on)); tg.querySelector(".osg-ly-foot-caret").textContent = on ? "▾" : "▴"; };
      tg.onclick = () => { on = !on; LS.set("osg-layers-tips", on ? "1" : "0"); paint(); }; paint();
    }
    let lastClick = { key: null, at: 0, x: 0, y: 0 };
    treeEl.addEventListener("click", (e) => {
      if (suppressClick) return;
      const btn = e.target.closest("[data-act]"), row = e.target.closest(".osg-ly-row"), drawer = e.target.closest(".osg-ly-mix"); if (!row && !drawer) return;
      if (btn) { e.stopPropagation(); rowAction((row || drawer).dataset.key, btn.dataset.act, btn); return; }
      if (!row) return;
      if (e.target.closest(".osg-ly-rename")) return;
      const k = row.dataset.key, sub = row.classList.contains("osg-ly-gi");
      // second click on the same row within 400 ms = double-click → rename (the native dblclick can't be relied on: the row may have been redrawn in between)
      if (!sub && lastClick.key === k && e.timeStamp - lastClick.at < 400 && Math.hypot(e.clientX - lastClick.x, e.clientY - lastClick.y) < 8) { lastClick = { key: null, at: 0 }; clearTimeout(clickTimer); startRename(k); return; }
      lastClick = { key: sub ? null : k, at: e.timeStamp, x: e.clientX, y: e.clientY };
      rowClick(k, e, sub ? +row.dataset.inst : null);
    });
    // mixer drawers: live while dragging, one undo step when released; never rebuild the list while a slider is held
    treeEl.addEventListener("input", (e) => { const d = e.target.closest(".osg-ly-mix"); if (!d || !e.target.dataset.f) return; e.stopPropagation(); mixInput(d, e.target, e.target.type === "checkbox" || e.target.tagName === "SELECT"); });
    treeEl.addEventListener("change", (e) => { const d = e.target.closest(".osg-ly-mix"); if (!d || !e.target.dataset.f || e.target.type === "checkbox" || e.target.tagName === "SELECT") return; e.stopPropagation(); mixInput(d, e.target, true); });
    treeEl.addEventListener("pointerdown", (e) => { if (e.target.closest(".osg-ly-mix")) { mixDrag = true; e.stopPropagation(); } }, true);
    document.addEventListener("pointerup", () => { if (mixDrag) { mixDrag = false; if (renderLater) refresh(); } }, true);
    treeEl.addEventListener("click", (e) => { if (e.target.closest(".osg-ly-mix") && !e.target.closest("[data-act]")) e.stopPropagation(); }, true);
    treeEl.addEventListener("dblclick", (e) => { clearTimeout(clickTimer); if (e.target.closest("input")) return; const row = e.target.closest(".osg-ly-row:not(.osg-ly-gi)"); if (row && !e.target.closest("[data-act]") && !row.querySelector(".osg-ly-rename")) startRename(row.dataset.key); });
    // Enter renames the focused row (or the single selected row); F2 too; Space activates it
    treeEl.addEventListener("keydown", (e) => {
      if (e.target.closest("input, select")) return;
      const row = e.target.closest(".osg-ly-row:not(.osg-ly-gi)"); const k = row ? row.dataset.key : (rowSel.size === 1 ? [...rowSel][0] : null); if (!k) return;
      if (e.key === "F2" || e.key === "Enter") { e.preventDefault(); e.stopPropagation(); startRename(k); } else if (e.key === " ") { e.preventDefault(); rowClick(k, { detail: 1 }); }
      else if (e.altKey && !e.ctrlKey && !e.metaKey && (e.code === "KeyI" || e.key.toLowerCase() === "i")) { e.preventDefault(); e.stopPropagation(); openColor(k); }
    });
    wireDrag();
    // right-click: on a row's icon → colour picker beside it; anywhere else on a row → the row's ⋯ menu
    treeEl.addEventListener("contextmenu", (e) => {
      const row = e.target.closest(".osg-ly-row:not(.osg-ly-gi)"); if (!row) return;
      e.preventDefault(); e.stopPropagation();
      const icon = e.target.closest(".osg-ly-ic, .osg-ly-chip");
      if (icon) openColor(row.dataset.key, icon);
      else { closeColor(); menuFor(row.dataset.key, row.querySelector("[data-act=menu]") || row); }
    });
    // keys typed in the panel shouldn't reach the sequencer's shortcuts
    for (const ev of ["keydown", "keyup", "keypress"]) box.addEventListener(ev, (e) => { if (e.target.closest("input, select")) e.stopPropagation(); });
    document.addEventListener("pointerdown", (e) => { if (!menu.hidden && !e.target.closest("#osg-ly-menu, [data-act=menu], [data-tool=more]")) menu.hidden = true; if (colorPop && !e.target.closest("#osg-ly-color")) closeColor(); });
    window.addEventListener("blur", () => { if (drag.active) dragEnd(false); });
    addEventListener("blur", () => { menu.hidden = true; });
  }
  function open() {
    if (typeof sidebar === "undefined") return;
    if (!box) build();
    tab = sidebar.tab("Layers", "");   // (the same width as the site's own Sequence tab)
    if (!tab.page.contains(box)) { tab.page.innerHTML = ""; tab.page.appendChild(box); }
    sidebar.open(tab, true);
    LS.set("osg-layers-open", "1");
    document.getElementById("osg-layers-link")?.parentElement.classList.add("active");
    refresh();
    // closing the tab with its ✕ takes it out of the sidebar
    if (!tab._osgWatch) { tab._osgWatch = new MutationObserver(() => { if (!document.body.contains(box)) { tab._osgWatch.disconnect(); tab = null; LS.set("osg-layers-open", "0"); document.getElementById("osg-layers-link")?.parentElement.classList.remove("active"); } }); tab._osgWatch.observe(sidebar.container, { childList: true, subtree: true }); }
  }
  function close() { if (tab) { try { sidebar.remove(tab); } catch (e) {} } }
  function toggle() { if (tab && panelOpen()) close(); else open(); }
  function addNavLink() {
    const ul = document.querySelector("#nav ul"); if (!ul || document.getElementById("osg-layers-link")) return;
    const li = document.createElement("li"), a = document.createElement("a"); a.id = "osg-layers-link"; a.href = "javascript:;"; a.textContent = "Layers"; a.onclick = toggle; li.appendChild(a);
    const before = document.getElementById("osg-tools-link")?.parentElement || document.getElementById("ad_container");
    if (before && before.parentElement === ul) ul.insertBefore(li, before); else ul.appendChild(li);
  }

  // Ctrl+G groups (notes, or the rows selected in Layers), Ctrl+Alt+G makes a folder, Ctrl+Shift+G ungroups / dissolves
  document.addEventListener("keydown", (e) => {
    if (!hooked) return;
    if (e.key === "Escape" && colorPop) { closeColor(); return; }
    if (e.key === "Escape" && rowSel.size && panelOpen()) { clearRowSel(); return; }
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.code === "KeyI" || e.key.toLowerCase() === "i") && rowSel.size === 1 && panelOpen() && !/input|textarea|select/i.test(document.activeElement?.tagName || "")) { e.preventDefault(); e.stopPropagation(); openColor([...rowSel][0]); return; }
    if (e.key === "Enter" && !e.ctrlKey && !e.altKey && !e.metaKey && rowSel.size === 1 && panelOpen() && box.contains(document.activeElement) && !document.activeElement.closest("input, button")) { e.preventDefault(); e.stopPropagation(); startRename([...rowSel][0]); return; }
    if (!(e.ctrlKey || e.metaKey) || (e.code !== "KeyG" && e.key.toLowerCase() !== "g")) return;
    if (/input|textarea|select/i.test(document.activeElement?.tagName || "") || document.activeElement?.isContentEditable) return;
    e.preventDefault(); e.stopPropagation();
    if (e.altKey) newFolder(null); else if (e.shiftKey) ungroupSelection(); else groupSelection();
  }, true);
  // clicking anywhere outside the panel drops the row selection (so Ctrl+G goes back to acting on notes)
  document.addEventListener("pointerdown", (e) => { if (rowSel.size && !e.target.closest("#osg-layers, #osg-ly-menu")) clearRowSel(); }, true);
  // follow the selection and the current instrument
  document.addEventListener("mouseup", () => { if (panelOpen()) setTimeout(refresh, 30); }, true);
  document.addEventListener("keyup", () => { if (panelOpen()) setTimeout(refresh, 30); }, true);
  document.addEventListener("change", (e) => { if (e.target && e.target.id === "instrument_select" && panelOpen()) refresh(); }, true);

  // ---------- start once the editor and the sequence have loaded ----------
  let tries = 0, lastLen = -1, stable = 0;
  const boot = setInterval(() => {
    if (++tries > 1200) return clearInterval(boot);   // ~2 minutes
    if (typeof sidebar === "undefined" || !document.getElementById("sequencer")) { if (tries > 100 && typeof song === "undefined") clearInterval(boot); return; }
    if (!hook()) return;
    addNavLink();
    // a saved sequence: wait until its notes have arrived and stopped changing (a new, empty one starts right away)
    const len = live().length; if (len === lastLen) stable++; else { stable = 0; lastLen = len; }
    if (/^\/\d+/.test(location.pathname) && (stable < 4 || len === 0) && tries < 300) return;
    clearInterval(boot);
    load();
    if (LS.get("osg-layers-open") === "1") open();
  }, 100);
  window.osgLayers = { open, close, toggle, groupSelection, ungroupSelection, newFolder, exportLayer, exportAll, autoThumb, clearSolo, filterPlayable, tree: () => tree, save };
})();
