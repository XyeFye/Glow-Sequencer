/* Glow Theme for Online Sequencer — sequence library, editor side. Runs in the page (MAIN world) on the editor.
   Answers the extension's isolated script over window.postMessage:
   - "export": the sequence in the editor right now (unsaved edits included) in the site's .sequence format, its title,
     its number on the site (if it has one) and a small piano-roll picture of its notes;
   - "load": opens a saved sequence in the editor, the same way the site opens a .sequence file you drop on it. */
(function () {
  "use strict";
  if (window.__osgLibMain) return; window.__osgLibMain = true;
  const TAG = "osg-lib";
  const reply = (id, data) => window.postMessage({ [TAG]: "reply", id, ...data }, location.origin);
  const toB64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const ready = () => typeof song !== "undefined" && song && typeof loadDataProto === "function" && typeof getSongProto === "function" && !(typeof loadingSequence !== "undefined" && loadingSequence);
  const waitReady = (ms = 20000) => new Promise((res, rej) => { const t0 = Date.now(); const tick = () => { if (ready()) res(); else if (Date.now() - t0 > ms) rej(new Error("The editor didn't finish loading.")); else setTimeout(tick, 200); }; tick(); });

  function picture() {   // a small piano roll of the notes, coloured like the editor
    try {
      const notes = song.notes.filter((n) => !n.deleted && n.annotation == null && n.volume > 0.002); if (!notes.length) return "";
      const W = 320, H = 180, c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d");
      g.fillStyle = "#16161f"; g.fillRect(0, 0, W, H);
      let t1 = 0, lo = 999, hi = -1; for (const n of notes) { t1 = Math.max(t1, n.time + n.length); const r = pianoToIndex[n.type]; if (r != null) { lo = Math.min(lo, r); hi = Math.max(hi, r); } }
      if (hi < lo) return ""; const rows = Math.max(12, hi - lo + 3), sx = W / Math.max(16, t1), sy = H / rows;
      for (const n of notes) {
        const r = pianoToIndex[n.type]; if (r == null) continue; let col = "#7c5cff";
        try { const k = getInstrumentColor(song, n.instrument); col = `rgb(${k[1]},${k[2]},${k[3]})`; } catch (e) {}
        g.fillStyle = col; g.fillRect(n.time * sx, (r - lo + 1) * sy, Math.max(1, n.length * sx - 0.5), Math.max(1, sy - 0.5));
      }
      return c.toDataURL("image/png");
    } catch (e) { return ""; }
  }
  // While the Glow player is showing, the site's sequencer is out of sight: skip redrawing it (it keeps playing — like
  // hiding instruments in the editor), so playback doesn't lag. Back in view, it redraws everything.
  (function quietGrid() {
    const quiet = () => !!document.body && document.body.classList.contains("osg-sc") && !document.body.classList.contains("osg-st");
    let installed = false, was = false;
    const install = () => {
      if (installed) return true;
      if (typeof SequencerView === "undefined" || !SequencerView || typeof SequencerView._repaint !== "function") return false;
      installed = true; const V = SequencerView, orig = V._repaint;
      V._repaint = function () { if (quiet()) { this._repaintId = 0; return; } return orig.apply(this, arguments); };
      return true;
    };
    const check = () => {
      if (!install()) return; const q = quiet(); if (q === was) return; was = q;
      if (!q) { try { SequencerView._rebuildTileGrid(); } catch (e) {} try { SequencerView._repaintId = 0; SequencerView.repaint(); } catch (e) {} }
    };
    const watch = () => { if (!document.body) return setTimeout(watch, 200); new MutationObserver(check).observe(document.body, { attributes: true, attributeFilter: ["class"] }); check(); };
    watch(); let tries = 0; const iv = setInterval(() => { check(); if (installed || ++tries > 40) clearInterval(iv); }, 1000);
  })();
  // Every time you save a sequence on the site, a copy of exactly what was saved goes to your library (the extension's
  // own storage on this computer) — its history, one version per save. The site's save is untouched; this only watches it.
  // the Glow player's waveform shows the sound as it plays: listen to the player's output (an analyser on the final mix,
  // which changes nothing you hear) and pass the shape of the sound, its loudness and where the song is, ~30 times a
  // second — only while a song plays in the Glow player, in a visible tab
  (function liveTap() {
    let an = null, buf = null, fbuf = null, last = 0, failed = false;
    const ensure = () => {
      if (an || failed) return an;
      try { const A = window.audioSystem; if (!A || !A.audioContext || !A.finalGain || A.offline) return null; an = A.audioContext.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = 0.55; A.finalGain.connect(an); buf = new Uint8Array(an.fftSize); fbuf = new Uint8Array(an.frequencyBinCount); }
      catch (err) { an = null; failed = true; }
      return an;
    };
    const tick = (t) => {
      requestAnimationFrame(tick);
      if (t - last < 33 || document.hidden || !document.body || !document.body.classList.contains("osg-sc")) return;
      if (typeof song === "undefined" || !song || !song.playing) return;
      last = t; const a = ensure(); if (!a) return;
      a.getByteTimeDomainData(buf);
      let sum = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
      let z = 0; for (let i = 1; i < buf.length / 2; i++) if (buf[i - 1] < 128 && buf[i] >= 128) { z = i; break; }   // start on a rising zero crossing, so the trace holds still
      const out = new Uint8Array(256); for (let i = 0; i < 256; i++) out[i] = buf[Math.min(buf.length - 1, z + i * 4)];
      // 24 frequency bands, spread like hearing (more of them in the lows), for the dancing bars
      a.getByteFrequencyData(fbuf); const fq = new Uint8Array(24), nb = fbuf.length;
      for (let k = 0; k < 24; k++) { const lo = Math.floor(2 * Math.pow(nb / 4, k / 24)), hi = Math.max(lo + 1, Math.floor(2 * Math.pow(nb / 4, (k + 1) / 24))); let m = 0; for (let j = lo; j < hi && j < nb; j++) m = Math.max(m, fbuf[j]); fq[k] = m; }
      window.postMessage({ [TAG]: "live", seq: String(song.id), step: typeof playTime === "number" ? playTime : 0, level: Math.min(1, Math.sqrt(sum / buf.length) * 3.2), wave: out, freq: fq }, location.origin);
    };
    requestAnimationFrame(tick);
  })();

  (function backups() {
    const watchSaved = (snap) => {
      const t0 = Date.now();
      const tick = () => {
        const link = document.getElementById("sharelink"), html = link ? link.innerHTML : "";
        if (/Link to this sequence/.test(html) && song && +song.id > 0) { window.postMessage({ [TAG]: "saved", seqId: String(song.id), data: snap.data, title: snap.title, picture: picture() }, location.origin); return; }
        if (html && !/Saving/i.test(html) && !/Link to this sequence/.test(html)) return;   // the save failed: nothing to keep
        if (Date.now() - t0 < 30000) setTimeout(tick, 400);
      };
      setTimeout(tick, 400);
    };
    const wrap = () => {
      if (typeof window.save !== "function") return false; if (window.save.__osg) return true;
      const orig = window.save;
      const wrapped = async function () {
        let snap = null;
        try { if (typeof song !== "undefined" && song && song.notes && song.notes.length && typeof getSongProto === "function") { let title = ""; try { title = getTitle(); } catch (err) {} snap = { data: toB64(getSongProto().serializeBinary()), title }; } } catch (err) {}
        const r = await orig.apply(this, arguments);
        if (snap) watchSaved(snap);
        return r;
      };
      wrapped.__osg = true;
      try { window.save = wrapped; } catch (err) { return true; }
      return true;
    };
    let n = 0; const iv = setInterval(() => { if (wrap() || ++n > 60) clearInterval(iv); }, 500);
  })();
  window.addEventListener("message", async (e) => {
    if (e.source !== window || !e.data || typeof e.data !== "object") return;
    const m = e.data;
    if (m[TAG] === "pladd") {   // a playlist page you own: add a sequence the way the site's own "add" does (its list and play order
      // update as usual) — only the "paste a link" prompt is answered for you
      try {
        if (typeof addToPlaylist !== "function" || typeof showPrompt !== "function") { reply(m.id, { ok: false, error: "none" }); return; }
        const seq = parseInt(m.seq, 10), pid = parseInt(m.pid, 10); if (!(seq > 0) || !(pid > 0)) { reply(m.id, { ok: false }); return; }
        if (document.getElementById("sequence_row_" + seq) || (typeof sequenceIds !== "undefined" && sequenceIds.indexOf(seq) !== -1)) { reply(m.id, { ok: true, state: "already" }); return; }
        const sp = window.showPrompt; window.showPrompt = () => Promise.resolve(String(seq));
        try { await addToPlaylist(pid); } finally { window.showPrompt = sp; }
        const t0 = Date.now();
        while (Date.now() - t0 < 12000) { if (document.getElementById("sequence_row_" + seq)) { reply(m.id, { ok: true, state: "added" }); return; } await new Promise((r) => setTimeout(r, 250)); }
        reply(m.id, { ok: false, state: "failed" });
      } catch (err) { reply(m.id, { ok: false, error: String((err && err.message) || err) }); }
      return;
    }
    if (m[TAG] === "pl") {   // playlists: the site's own requests (its sign-in key never leaves the page), through the polite queue
      try {
        if (typeof settings === "undefined" || !settings || !settings.post_key || !(+settings.uid > 0)) { reply(m.id, { ok: false, error: "signin" }); return; }
        const send = async (data) => {
          const f = window.__osgNet ? window.__osgNet.fetch : fetch;
          const r = await f("/ajax/update_playlist.php", { method: "POST", body: new URLSearchParams({ ...data, post_key: settings.post_key }), headers: { "X-Requested-With": "XMLHttpRequest" } }, 0);
          return { ok: r.ok, status: r.status, text: (await r.text()).trim() };
        };
        if (m.act === "create") {
          const r = await send({ create: true }); const pid = parseInt(r.text, 10);
          if (!r.ok || !(pid > 0)) { reply(m.id, { ok: false, error: "The site didn't make the playlist." }); return; }
          if (m.title) await send({ id: pid, title: String(m.title).slice(0, 100), description: String(m.desc || "").slice(0, 1000) });
          reply(m.id, { ok: true, pid: String(pid) });
        } else if (m.act === "add" || m.act === "remove") {
          const r = await send(m.act === "add" ? { id: +m.pid, add_sequence: +m.seq } : { id: +m.pid, remove_sequence: +m.seq });
          reply(m.id, { ok: r.ok, status: r.status });
        } else reply(m.id, { ok: false });
      } catch (err) { reply(m.id, { ok: false, error: String((err && err.message) || err) }); }
      return;
    }
    if (m[TAG] === "pos") {   // where the site's player is (in steps of the song) and whether it's playing
      try { reply(m.id, { ok: typeof song !== "undefined" && !!song, playing: !!(song && song.playing), step: typeof playTime === "number" ? playTime : 0, seq: song && song.id }); }
      catch (err) { reply(m.id, { ok: false }); }
      return;
    }
    if (m[TAG] === "transport") {   // play / pause, or start playing from a step (what the site's own controls do)
      try {
        if (m.act === "play") {   // start playing if it isn't (the sequence may still be loading: say so, and get asked again)
          if (typeof loadingSequence !== "undefined" && loadingSequence || !Array.isArray(song.notes) || !song.notes.length) { reply(m.id, { ok: false, wait: true }); return; }
          if (!song.playing) { if (typeof loadingSounds !== "undefined" && loadingSounds) { try { playTime = 0; autoplay = true; } catch (err) {} } else song.play(0); }
        }
        else if (m.act === "rewind") {   // back to the start: playing on from there if it was playing, or just waiting there
          if (song.playing) { song.stop(); song.play(0); }
          else { try { playTime = 0; lastPlayTime = 0; } catch (err) {} try { setPlayheadPosition(0); } catch (err) {} try { setScrollLeft(0, true); } catch (err) {} }
        }
        else if (m.act === "toggle") { if (song.playing) song.stop(); else song.play(typeof isPlayerMode !== "undefined" && isPlayerMode ? playTime : lastPlayTime); }
        else if (m.act === "seek") {
          // a whole step: the site plays the notes of column playTime, so a fractional step would never match any note
          // and the song would run on in silence
          const st = Math.max(0, Math.floor(Math.min(+m.step || 0, (song.loopTime || Infinity) - 1)));
          try { setScrollLeft(Math.floor(st * grid * noteWidth), true); } catch (err) {}
          // stop first, then play from the new spot — the site's own way (a #t link does the same). Calling play() on a song
          // that's already playing starts a second clock while the sound engine is still set up for the first: the
          // playhead moves on, but nothing is heard.
          if (typeof loadingSounds !== "undefined" && loadingSounds) { try { playTime = st; autoplay = true; } catch (err) {} }
          else { if (song.playing) song.stop(); song.play(st); }
        }
        reply(m.id, { ok: true, playing: !!song.playing });
      } catch (err) { reply(m.id, { ok: false }); }
      return;
    }
    if (m[TAG] === "autonext") {   // at the end of the song: tell the extension (it opens the next one) instead of looping
      try {
        const mine = typeof onLoop === "function" && onLoop.__osgNext;
        if (m.on) { if (!onLoop || mine) { const f = function () { try { window.postMessage({ [TAG]: "ended", seq: String(song.id) }, location.origin); } catch (err) {} }; f.__osgNext = true; onLoop = f; } }
        else if (mine) onLoop = null;
        reply(m.id, { ok: true, on: !!(typeof onLoop === "function" && onLoop.__osgNext) });
      } catch (err) { reply(m.id, { ok: false }); }
      return;
    }
    if (m[TAG] === "snap") {   // the sequence as it is on this page right now, untouched — exactly what the site has stored
      try {
        const ok = typeof song !== "undefined" && song && String(song.id) === String(m.seq) && Array.isArray(song.notes) && song.notes.length && !(typeof loadingSequence !== "undefined" && loadingSequence) && !window.confirmExit && typeof getSongProto === "function";
        if (!ok) { reply(m.id, { ok: false }); return; }
        let title = ""; try { title = getTitle(); } catch (err) {}
        reply(m.id, { ok: true, seq: String(song.id), data: toB64(getSongProto().serializeBinary()), title, picture: picture() });
      } catch (err) { reply(m.id, { ok: false }); }
      return;
    }
    if (m[TAG] === "edit") {   // the site's own pencil: turn the sequence page into the full editor
      try { if (typeof enterEditMode === "function") { if (song && song.playing) song.stop(); enterEditMode(); reply(m.id, { ok: true }); } else reply(m.id, { ok: false }); }
      catch (err) { reply(m.id, { ok: false }); }
      return;
    }
    if (m[TAG] === "song") {   // the sequence the site has loaded and is playing — its notes, so the extension needn't download it again
      try {
        if (typeof song === "undefined" || !song || !Array.isArray(song.notes)) { reply(m.id, { ok: false, none: true }); return; }
        if (String(song.id) !== String(m.seq) || (typeof loadingSequence !== "undefined" && loadingSequence)) { reply(m.id, { ok: false }); return; }
        const idx = {}; (settings.piano || []).forEach((n, i) => { idx[n] = i; });
        const notes = [];
        for (const n of song.notes) { if (!n || n.deleted) continue; const t = idx[n.type]; if (t === undefined) continue; notes.push([t, +n.time, +n.length, +n.instrument, n.volume == null ? 1 : +n.volume]); }
        const tm = (song.markers && song.markers[0] && song.markers[0][0]) || [];
        const init = song.initialMarkerValues && song.initialMarkerValues[0] ? song.initialMarkerValues[0][0] : undefined;
        reply(m.id, { ok: true, notes, tempo: tm.map((x) => [+x.time, +x.value, !!x.blend]), bpm: +(init ?? song.bpm) || 110, timeSig: (song.getTimeSig && song.getTimeSig()) || 4 });
      } catch (err) { reply(m.id, { ok: false, none: true }); }
      return;
    }
    if (m[TAG] === "palette") {   // the site's instrument colours (any page) — for drawing sequence banners like the site's pictures
      try {
        const colors = {};
        for (const i of (Array.isArray(m.ids) ? m.ids : []).slice(0, 2000)) { try { colors[i] = typeof instMgr !== "undefined" ? instMgr.getColor(+i) : settings.instrumentColors[+i % (settings.instrumentCloneOffset || 10000)]; } catch (err) {} }
        reply(m.id, { ok: true, colors });
      } catch (err) { reply(m.id, { ok: false }); }
      return;
    }
    if (m[TAG] !== "export" && m[TAG] !== "load") return;
    try {
      await waitReady();
      if (m[TAG] === "export") {
        const bytes = getSongProto().serializeBinary();
        let title = ""; try { title = getTitle(); } catch (err) {}
        reply(m.id, { ok: true, data: toB64(bytes), title: title || "", seqId: song.id ? String(song.id) : "", notes: song.notes.length, picture: picture() });
      } else {
        const bin = atob(m.data), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        loadDataProto(u8);
        try { if (m.title) setTitle(m.title); } catch (err) {}
        try { setConfirmExit(true); } catch (err) {}
        reply(m.id, { ok: true });
      }
    } catch (err) { reply(m.id, { ok: false, error: String(err && err.message || err) }); }
  });
})();
