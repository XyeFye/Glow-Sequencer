/* Glow Theme for Online Sequencer — add another sequence into the one you're editing, without replacing anything.
   Runs in the page (MAIN world) on the editor.

   "Add a song…" (in the Layers panel, or offered when you drop a .sequence file onto an editor that already has notes)
   takes a .sequence file — or a link to a sequence on the site — and adds its notes to this song:
   - Its instruments keep their settings (volume, effects, colour, name…).
   - An instrument this song already uses is never overwritten: the incoming part goes onto a new copy ("clone") of
     that instrument instead, with the incoming settings, named after the song it came from.
   - Its per-instrument automation (volume, pan, effects…) comes along on the same instruments. Its tempo changes come
     only if you ask (they would change this whole song's speed).
   - It can go at the start, at the playhead, or after the end of this song.
   - Ctrl+Z takes the whole addition back out in one step.
   - In Layers, this song's tracks sit in a folder named after it, and each added song gets a folder of its own. */
(function () {
  "use strict";
  if (window.__osgMerge) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const net = (u, o) => (window.__osgNet ? window.__osgNet.fetch(u, o, 0) : fetch(u, o));
  const ready = () => typeof song !== "undefined" && song && Array.isArray(song.notes) && typeof proto !== "undefined" && typeof instMgr !== "undefined";
  const title = () => { try { return getTitle(); } catch (e) { return "This song"; } };
  const perInst = (s) => { try { return !!(kMarkerEditorSettings[s] && kMarkerEditorSettings[s].isPerInstrument); } catch (e) { return s !== 0; } };
  const baseName = (i) => { try { return instMgr.getBaseName(i) || getInstrumentName(i); } catch (e) { return "Instrument " + i; } };

  // ---------- reading a sequence ----------
  function parse(bytes) {
    const sp = proto.Sequence.deserializeBinary(bytes);
    if (!sp.getNotesList().length && !sp.getMarkersList().length) throw new Error("That sequence has no notes.");
    return sp;
  }
  async function fromLink(text) {
    const id = (String(text).match(/(?:onlinesequencer\.net\/)?(\d{3,})/) || [])[1]; if (!id) throw new Error("That doesn't look like a sequence link or number.");
    const r = await net(`/app/api/get_proto.php?v=2&id=${id}`); if (!r.ok) throw new Error("The site didn't send that sequence (" + r.status + ").");
    const sp = parse(new Uint8Array(await r.arrayBuffer()));
    let name = "Sequence " + id;
    try { const h = await (await net(`/${id}`)).text(); const m = h.match(/<meta property="og:title" content="([^"]*)"/); if (m) { const t = document.createElement("textarea"); t.innerHTML = m[1]; name = t.value.trim() || name; } } catch (e) {}
    return { sp, name };
  }

  // ---------- planning: which instrument each incoming part goes onto ----------
  function usedHere() {
    const used = new Set();
    for (const n of song.notes) used.add(n.instrument);
    for (const [s, byInst] of Object.entries(song.markers || {})) if (perInst(+s)) for (const [i, a] of Object.entries(byInst || {})) if (a && a.length) used.add(+i);
    for (const k of Object.keys((song.settings && song.settings.instruments) || {})) { const i = +k; try { if (instMgr.isClone(i)) used.add(i); } catch (e) {} }
    return used;
  }
  function incoming(sp) {
    const ids = new Set();
    for (const n of sp.getNotesList()) { const i = n.getInstrument(); if (instMgr.isValidId(i)) ids.add(i); }
    for (const m of sp.getMarkersList()) if (perInst(m.getSetting()) && instMgr.isValidId(m.getInstrument())) ids.add(m.getInstrument());
    return [...ids].sort((a, b) => a - b);
  }
  // a plan only looks; nothing is changed until it's carried out
  function plan(sp) {
    const used = usedHere(), ins = incoming(sp);
    return { ins, clash: ins.filter((i) => used.has(i)), notes: sp.getNotesList().length };
  }

  // ---------- carrying it out ----------
  function merge(sp, name, where, withTempo) {
    if (!ready()) throw new Error("Open the editor first.");
    const used = usedHere(), map = new Map(), made = [], taken = new Set(used);
    let end = 0; for (const n of song.notes) end = Math.max(end, n.time + n.length);
    const bar = 4 * ((typeof getTimeSig === "function" && getTimeSig()) || 4);
    const offset = where === "end" ? Math.ceil(end / bar) * bar : where === "playhead" ? Math.max(0, Math.floor((typeof lastPlayTime === "number" ? lastPlayTime : 0) || 0)) : 0;
    const settingsIn = sp.getSettings() ? sp.getSettings().getInstrumentsMap() : null;
    for (const x of incoming(sp)) {
      let y = x;
      if (taken.has(x)) {   // this song already has it: put the incoming part on a fresh copy of the instrument
        y = null;
        for (let k = 0; k < 120; k++) { const c = instMgr.cloneInstrument(x); if (!taken.has(c)) { y = c; break; } }
        if (y == null) throw new Error(`No free copy of ${baseName(x)} left to put the new part on.`);
        made.push(y);
      } else try { instMgr.ensureLoaded(x); } catch (e) {}
      taken.add(y); map.set(x, y);
    }
    // the incoming instruments' settings, on the instruments they're going to
    for (const [x, y] of map) {
      let s = null;
      try { if (settingsIn && settingsIn.has(x)) s = parseInstrumentSettingsProto(settingsIn.get(x)); } catch (e) {}
      if (!s && y === x) continue;   // nothing to bring, and it's this song's own free slot: leave it as it is
      if (!s) s = getDefaultInstrumentSettings();
      if (Array.isArray(s.stack)) s.stack = s.stack.map((it) => ({ ...it, instrument: map.has(it.instrument) ? map.get(it.instrument) : it.instrument }));
      if (y !== x && !s.name) s.name = `${baseName(x)} · ${name}`.slice(0, 48);
      song.settings.instruments[y] = s;
      try { loadInstrumentSettings(y); } catch (e) {}
    }
    // notes and automation, moved onto their instruments and to where they're going
    const notesIn = sp.getNotesList().filter((n) => map.has(n.getInstrument()));
    for (const n of notesIn) { n.setInstrument(map.get(n.getInstrument())); n.setTime(n.getTime() + offset); }
    const marks = [];
    for (const m of sp.getMarkersList()) {
      const s = m.getSetting(), per = perInst(s); if (!per && !withTempo) continue;
      if (per && !map.has(m.getInstrument())) continue;
      try { if (!isValidMarkerSetting(s)) continue; } catch (e) {}
      marks.push({ t: m.getTime() + offset, s, i: per ? map.get(m.getInstrument()) : m.getInstrument(), v: m.getValue(), b: !!m.getBlend() });
    }
    if (withTempo && sp.getSettings() && sp.getSettings().getBpm()) marks.push({ t: offset, s: 0, i: 0, v: sp.getSettings().getBpm(), b: false });   // its own speed, from where it starts
    let added = null, addedMarks = [];
    const repaint = () => { try { song.updateLoopTime(); } catch (e) {} try { updateMeasures(); } catch (e) {} try { SequencerView.repaint(kRepaintNotesMoved); } catch (e) {} };
    const doIt = () => {
      if (!added) {
        const before = new Set(song.notes);
        song.appendNoteData(notesIn);
        added = song.notes.filter((n) => !before.has(n));
        for (const k of marks) { const mk = new Marker(song, k.t, k.s, k.i, k.v, k.b); song.addMarker(mk); addedMarks.push(mk); try { if (k.s === kMarkerSettingInstrumentReverb) loadReverb(k.v); } catch (e) {} }
      } else { for (const n of added) song.addNote(n, true); for (const mk of addedMarks) song.addMarker(mk); }
      try { selection.clear(); } catch (e) {}
      repaint();
    };
    const undoIt = () => { for (const n of added || []) { try { song.removeNote(n, true); } catch (e) {} } for (const mk of addedMarks) { try { song.removeMarker(mk); } catch (e) {} } repaint(); };
    if (typeof exec === "function") exec(doIt, undoIt); else doIt();
    try { updateUiForInstrumentClones(); } catch (e) {}
    try { setConfirmExit(true); } catch (e) {}
    try { if (window.__osgLayersAPI) window.__osgLayersAPI.addSong(name, [...new Set(map.values())]); } catch (e) {}
    return { notes: (added || []).length, instruments: map.size, copies: made.length, at: offset, map: [...map] };
  }

  // ---------- the dialog ----------
  let dlg = null;
  function close() { if (dlg) { dlg.remove(); dlg = null; } }
  function open(pre) {
    if (!ready()) { try { message("Open a sequence in the editor first.", 3, true); } catch (e) {} return; }
    close();
    dlg = document.createElement("div"); dlg.id = "osg-merge"; dlg.setAttribute("role", "dialog"); dlg.setAttribute("aria-label", "Add a song to this sequence");
    dlg.innerHTML = `<div class="osg-mg-card">
      <header><b>Add a song to this one</b><button type="button" class="osg-mg-x" aria-label="Close">✕</button></header>
      <p class="osg-mg-sub">Its notes are added to <b>${esc(title())}</b> — nothing here is replaced. An instrument this song already uses gets a new copy for the incoming part.</p>
      <div class="osg-mg-pick">
        <label class="osg-mg-file">📂 Choose a .sequence file<input type="file" accept=".sequence,.seq" hidden></label>
        <span>or</span>
        <form class="osg-mg-link"><input type="text" placeholder="Paste a sequence link or number" aria-label="Sequence link or number"><button type="submit">Get it</button></form>
      </div>
      <div class="osg-mg-info" hidden></div>
      <div class="osg-mg-opts" hidden>
        <label>Put it <select class="osg-mg-where"><option value="start">at the start</option><option value="playhead">at the playhead</option><option value="end">after the end of this song</option></select></label>
        <label class="osg-mg-tempo"><input type="checkbox"> Use its tempo from where it starts</label>
      </div>
      <footer><button type="button" class="osg-mg-go" disabled>Add it</button></footer>
    </div>`;
    document.body.appendChild(dlg);
    for (const ev of ["keydown", "keyup", "keypress"]) dlg.addEventListener(ev, (e) => { e.stopPropagation(); if (ev === "keydown" && e.key === "Escape") close(); });
    dlg.addEventListener("pointerdown", (e) => { if (e.target === dlg) close(); });
    dlg.querySelector(".osg-mg-x").onclick = close;
    let got = null;
    const info = dlg.querySelector(".osg-mg-info"), go = dlg.querySelector(".osg-mg-go"), opts = dlg.querySelector(".osg-mg-opts");
    const show = (sp, name) => {
      const p = plan(sp); got = { sp, name };
      const count = new Map(); for (const i of p.clash) { const b = baseName(i); count.set(b, (count.get(b) || 0) + 1); }
      const list = [...count].map(([b, k]) => (k > 1 ? `${b} ×${k}` : b)), names = list.slice(0, 6).join(", ") + (list.length > 6 ? `, +${list.length - 6} more` : "");
      info.hidden = false; info.className = "osg-mg-info";
      info.innerHTML = `<b>${esc(name)}</b> — ${p.notes.toLocaleString()} note${p.notes === 1 ? "" : "s"} on ${p.ins.length} instrument${p.ins.length === 1 ? "" : "s"}.` + (p.clash.length ? `<br>${p.clash.length} of them ${p.clash.length === 1 ? "is" : "are"} already used here (${esc(names)}) — ${p.clash.length === 1 ? "it goes" : "they go"} on new copies.` : "<br>None of its instruments are used here yet.");
      opts.hidden = false; go.disabled = false; go.focus();
    };
    const fail = (e) => { info.hidden = false; info.className = "osg-mg-info bad"; info.textContent = String((e && e.message) || e); got = null; go.disabled = true; };
    const fileIn = dlg.querySelector('input[type="file"]');
    const readFile = async (f) => { try { show(parse(new Uint8Array(await f.arrayBuffer())), f.name.replace(/\.(sequence|seq)$/i, "")); } catch (e) { fail(e.message ? e : "That file isn't a sequence."); } };
    fileIn.onchange = () => { const f = fileIn.files[0]; fileIn.value = ""; if (f) readFile(f); };
    dlg.querySelector(".osg-mg-link").onsubmit = async (e) => { e.preventDefault(); const t = e.currentTarget.querySelector("input").value.trim(); if (!t) return; info.hidden = false; info.className = "osg-mg-info"; info.textContent = "Getting it…"; try { const r = await fromLink(t); show(r.sp, r.name); } catch (err) { fail(err); } };
    go.onclick = () => {
      if (!got) return; go.disabled = true;
      try {
        const r = merge(got.sp, got.name, dlg.querySelector(".osg-mg-where").value, dlg.querySelector(".osg-mg-tempo input").checked);
        close();
        try { message(`Added “${got.name}”: ${r.notes.toLocaleString()} notes on ${r.instruments} instrument${r.instruments === 1 ? "" : "s"}${r.copies ? ` (${r.copies} new cop${r.copies === 1 ? "y" : "ies"})` : ""}. Ctrl+Z takes it back out.`, 5, true); } catch (e) {}
      } catch (e) { fail(e); go.disabled = false; }
    };
    if (pre && pre.file) readFile(pre.file);
  }

  // Dropping a .sequence file on an editor that already has notes: ask whether to add it or open it in place of this one
  // (the site would simply replace the song).
  document.addEventListener("drop", (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f || !/\.sequence$/i.test(f.name) || !ready() || !song.notes.length || (typeof isPlayerMode !== "undefined" && isPlayerMode)) return;
    if (!(e.target && e.target.closest && e.target.closest("#sequencer"))) return;   // the site only takes files dropped on the sequencer
    e.preventDefault(); e.stopImmediatePropagation();
    close();
    dlg = document.createElement("div"); dlg.id = "osg-merge";
    dlg.innerHTML = `<div class="osg-mg-card osg-mg-ask"><header><b>${esc(f.name)}</b><button type="button" class="osg-mg-x" aria-label="Cancel">✕</button></header>
      <p class="osg-mg-sub">This editor already has a song in it.</p>
      <div class="osg-mg-choices"><button type="button" class="osg-mg-add">＋ Add it to this song<small>Keeps everything here; clashing instruments get new copies</small></button><button type="button" class="osg-mg-open">Open it instead<small>Replaces what's in the editor, like the site normally does</small></button></div></div>`;
    document.body.appendChild(dlg);
    dlg.querySelector(".osg-mg-x").onclick = close;
    dlg.addEventListener("pointerdown", (ev) => { if (ev.target === dlg) close(); });
    dlg.querySelector(".osg-mg-add").onclick = () => open({ file: f });
    dlg.querySelector(".osg-mg-open").onclick = async () => { close(); try { loadDataProto(new Uint8Array(await f.arrayBuffer())); setTitle(f.name.replace(/\.sequence$/i, "")); } catch (err) { try { message("Couldn't open that file.", 3, true); } catch (x) {} } };
  }, true);

  window.__osgMerge = { open, merge, plan, parse };
})();
