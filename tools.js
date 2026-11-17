// Glow Theme for Online Sequencer — "Tools" tab: BPM finder, Key finder, Visualizer.
// Runs in the page's own JS context (manifest "world": "MAIN") so it can read the current
// sequence (song.notes) and tap the site's audio output for the visualizer.

(function () {
  if (window.__osgTools) return;
  const T = (window.__osgTools = { analysers: new Map() });


  /* ================= Audio tap: route anything headed to the speakers through an AnalyserNode ================= */
  const origConnect = AudioNode.prototype.connect;
  const origDisconnect = AudioNode.prototype.disconnect;
  function analyserFor(ctx) {
    let an = T.analysers.get(ctx);
    if (!an) {
      an = ctx.createAnalyser();
      an.fftSize = 2048;
      an.smoothingTimeConstant = 0.82;
      origConnect.call(an, ctx.destination);
      T.analysers.set(ctx, an);
    }
    return an;
  }
  const isLiveDest = (d) => d instanceof AudioDestinationNode && !(d.context instanceof OfflineAudioContext);
  AudioNode.prototype.connect = function (dest, ...rest) {
    if (isLiveDest(dest)) {
      const an = analyserFor(dest.context);
      if (this !== an) return origConnect.call(this, an, rest[0] || 0);
    }
    return origConnect.apply(this, arguments);
  };
  AudioNode.prototype.disconnect = function (dest, ...rest) {
    if (dest && isLiveDest(dest)) {
      const an = T.analysers.get(dest.context);
      if (an && this !== an) { try { return origDisconnect.call(this, an, ...rest); } catch (e) { return; } }
    }
    return origDisconnect.apply(this, arguments);
  };

  /* ================= Small DSP helpers ================= */
  function fft(re, im) { // in-place radix-2
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let j = 0; j < len / 2; j++) {
          const a = i + j, b = a + len / 2;
          const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
          const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
  }
  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  function pearson(a, b) {
    const n = a.length; let ma = 0, mb = 0;
    for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
    return da && db ? num / Math.sqrt(da * db) : 0;
  }
  function keysFromChroma(chroma) {
    const out = [];
    for (let k = 0; k < 12; k++) {
      const r = chroma.map((_, i) => chroma[(i + k) % 12]);
      out.push({ key: NOTE_NAMES[k] + " major", score: pearson(r, MAJOR), tonic: k, mode: "major" });
      out.push({ key: NOTE_NAMES[k] + " minor", score: pearson(r, MINOR), tonic: k, mode: "minor" });
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  }
  const relativeOf = (k) => k.mode === "major" ? NOTE_NAMES[(k.tonic + 9) % 12] + " minor" : NOTE_NAMES[(k.tonic + 3) % 12] + " major";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function decodeFile(file) {
    const ctx = T.ctx || (T.ctx = new AudioContext());
    const buf = await file.arrayBuffer();
    return await ctx.decodeAudioData(buf);
  }

  // ---- BPM: low-pass the signal, find peaks, histogram the intervals between them ----
  async function detectBPM(buffer, onProgress) {
    const sr = 11025;
    const off = new OfflineAudioContext(1, Math.ceil(buffer.duration * sr), sr);
    const src = off.createBufferSource(); src.buffer = buffer;
    const lp = off.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 150; lp.Q.value = 1;
    src.connect(lp); lp.connect(off.destination); src.start(0);
    onProgress && onProgress("Filtering…");
    const data = (await off.startRendering()).getChannelData(0);
    onProgress && onProgress("Finding beats…");
    const part = Math.floor(sr * 0.5);
    const peaks = [];
    for (let i = 0; i + part <= data.length; i += part) {
      let max = 0, pos = i;
      for (let j = i; j < i + part; j++) { const v = Math.abs(data[j]); if (v > max) { max = v; pos = j; } }
      peaks.push({ pos, vol: max });
    }
    peaks.sort((a, b) => b.vol - a.vol);
    const top = peaks.slice(0, Math.max(8, Math.floor(peaks.length * 0.5))).sort((a, b) => a.pos - b.pos);
    const counts = new Map();
    for (let i = 0; i < top.length; i++) {
      for (let j = i + 1; j < Math.min(top.length, i + 10); j++) {
        const interval = (top[j].pos - top[i].pos) / sr;
        if (interval <= 0) continue;
        let tempo = 60 / interval;
        while (tempo < 85) tempo *= 2;
        while (tempo > 170) tempo /= 2;
        const t = Math.round(tempo);
        counts.set(t, (counts.get(t) || 0) + 1);
      }
    }
    // merge neighbours (±1 BPM) into the stronger bin
    const arr = [...counts.entries()].map(([bpm, n]) => ({ bpm, n }));
    arr.sort((a, b) => b.n - a.n);
    const merged = [];
    for (const c of arr) {
      const near = merged.find((m) => Math.abs(m.bpm - c.bpm) <= 1);
      if (near) near.n += c.n; else merged.push({ ...c });
    }
    merged.sort((a, b) => b.n - a.n);
    const total = merged.reduce((s, m) => s + m.n, 0) || 1;
    return merged.slice(0, 5).map((m) => ({ bpm: m.bpm, confidence: m.n / total }));
  }

  // ---- Tempo + meter: onset-strength envelope → tempo (cross-checked with detectBPM) → beat phase → bar accent pattern ----
  async function analyzeTempo(buffer, onProgress) {
    const sr = 11025, N = 512, hop = 128, fps = sr / hop;
    const off = new OfflineAudioContext(1, Math.ceil(buffer.duration * sr), sr);
    const src = off.createBufferSource(); src.buffer = buffer; src.connect(off.destination); src.start(0);
    onProgress && onProgress("Listening for beats…");
    const data = (await off.startRendering()).getChannelData(0);
    // spectral-flux onset envelope
    const win = new Float64Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
    const re = new Float64Array(N), im = new Float64Array(N), prev = new Float64Array(N / 2), frames = Math.max(1, Math.floor((data.length - N) / hop));
    const env = new Float64Array(frames);
    for (let fr = 0; fr < frames; fr++) {
      const o = fr * hop; for (let i = 0; i < N; i++) { re[i] = data[o + i] * win[i]; im[i] = 0; } fft(re, im);
      let flux = 0; for (let b = 1; b < N / 2; b++) { const m = Math.log1p(10 * Math.sqrt(re[b] * re[b] + im[b] * im[b])); const d = m - prev[b]; if (d > 0) flux += d; prev[b] = m; }
      env[fr] = flux;
      if (fr % 2000 === 0) await sleep(0);
    }
    // remove the slow trend so only onsets remain
    const sm = new Float64Array(frames); const W = Math.round(fps * 0.5);
    for (let i = 0; i < frames; i++) { let s = 0, n = 0; for (let j = Math.max(0, i - W); j <= Math.min(frames - 1, i + W); j++) { s += env[j]; n++; } sm[i] = Math.max(0, env[i] - s / n); }
    // tempo: autocorrelation of the envelope, scored with the peak-interval detector's candidates
    const ac = (lag) => { let s = 0, n = 0; for (let i = lag; i < frames; i++) { s += sm[i] * sm[i - lag]; n++; } return n ? s / n : 0; };
    const ac0 = ac(0) || 1;
    const cands = await detectBPM(buffer, onProgress);
    // mild preference for "danceable" tempos so half/double-time readings don't win on ties
    const prior = (b) => Math.exp(-0.5 * Math.pow(Math.log2(b / 120) / 0.6, 2));
    const scoreBpm = (b) => { const lag = Math.round(60 / b * fps); if (lag < 2 || lag * 2 >= frames) return 0; return (ac(lag) + 0.5 * ac(lag * 2) + 0.3 * ac(Math.round(lag / 2))) / ac0 * (0.6 + 0.4 * prior(b)); };
    let best = { bpm: 120, score: -1 };
    const pool = new Set(cands.map((c) => c.bpm)); for (let b = 60; b <= 200; b++) pool.add(b);
    for (const b of pool) { const bonus = cands.find((c) => Math.abs(c.bpm - b) <= 1) ? 1.25 : 1; const sc = scoreBpm(b) * bonus; if (sc > best.score) best = { bpm: b, score: sc }; }
    // refine: parabolic interpolation of the autocorrelation peak around the winning lag → fractional lag → exact tempo
    let lagF = 60 / best.bpm * fps; { const l = Math.round(lagF), a = ac(l - 1), b0 = ac(l), c = ac(l + 1), den = a - 2 * b0 + c; if (l > 2 && den < 0) lagF = l + 0.5 * (a - c) / den; }
    const bpm = Math.round(60 * fps / lagF * 2) / 2, period = lagF;
    // beat phase: which offset lines up with the most onset energy
    let phase = 0, bestP = -1;
    for (let p = 0; p < period; p += 0.5) { let s = 0; for (let t = p; t < frames; t += period) s += sm[Math.round(t)] || 0; if (s > bestP) { bestP = s; phase = p; } }
    // strength of each beat
    const beats = []; for (let t = phase; t < frames; t += period) { const i = Math.round(t); let s = 0; for (let j = i - 2; j <= i + 2; j++) if (j >= 0 && j < frames) s += sm[j]; beats.push(s); }
    // meter: how strongly does every m-th beat stand out? (compare 3 vs 4; 2/4 reads as 4/4)
    const contrast = (m) => { if (beats.length < m * 4) return 0; const means = new Array(m).fill(0), cnt = new Array(m).fill(0); beats.forEach((b, i) => { means[i % m] += b; cnt[i % m]++; }); for (let p = 0; p < m; p++) means[p] /= cnt[p] || 1; const mean = means.reduce((a, b) => a + b, 0) / m || 1; let acc = 0; for (let i = m; i < beats.length; i++) acc += beats[i] * beats[i - m]; acc /= (beats.length - m) || 1; let e2 = 0; for (const b of beats) e2 += b * b; e2 /= beats.length || 1; return (Math.max(...means) - Math.min(...means)) / mean + 0.5 * acc / (e2 || 1); };
    const c3 = contrast(3), c4 = contrast(4), c5 = contrast(5);
    let timeSig = 4; if (c3 > c4 * 1.15 && c3 > c5 * 1.15) timeSig = 3; else if (c5 > c4 * 1.3 && c5 > c3 * 1.3) timeSig = 5;
    return { bpm, timeSig, confidence: Math.min(1, best.score), meterScores: { 3: +c3.toFixed(2), 4: +c4.toFixed(2), 5: +c5.toFixed(2) }, candidates: cands };
  }
  function applyTimeSig(ts) {
    const li = [...document.querySelectorAll("#time_sig_select_input .os-dropdown-menu li")].find((l) => l.textContent.trim() === `${ts}/4`);
    if (li) { li.click(); return true; }
    if (typeof setTimeSig === "function") { try { setTimeSig(ts); return true; } catch (e) {} }
    return false;
  }

  // ---- Key: chromagram over the whole file, matched against Krumhansl key profiles ----
  async function detectKeyFromAudio(buffer, onProgress) {
    const sr = 11025;
    const off = new OfflineAudioContext(1, Math.ceil(buffer.duration * sr), sr);
    const src = off.createBufferSource(); src.buffer = buffer; src.connect(off.destination); src.start(0);
    onProgress && onProgress("Resampling…");
    const data = (await off.startRendering()).getChannelData(0);
    const N = 4096, hop = 2048;
    const win = new Float64Array(N);
    for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
    const binPc = new Int8Array(N / 2).fill(-1);
    for (let b = 1; b < N / 2; b++) {
      const f = b * sr / N;
      if (f < 55 || f > 2200) continue;
      binPc[b] = ((Math.round(12 * Math.log2(f / 440)) + 69) % 12 + 12) % 12;
    }
    const chroma = new Array(12).fill(0);
    const re = new Float64Array(N), im = new Float64Array(N);
    const frames = Math.floor((data.length - N) / hop);
    for (let fr = 0; fr < frames; fr++) {
      const off0 = fr * hop;
      for (let i = 0; i < N; i++) { re[i] = data[off0 + i] * win[i]; im[i] = 0; }
      fft(re, im);
      for (let b = 1; b < N / 2; b++) {
        const pc = binPc[b]; if (pc < 0) continue;
        chroma[pc] += Math.sqrt(re[b] * re[b] + im[b] * im[b]);
      }
      if (fr % 60 === 0) { onProgress && onProgress(`Analyzing… ${Math.round(100 * fr / frames)}%`); await sleep(0); }
    }
    return { keys: keysFromChroma(chroma), chroma };
  }

  // ---- Key from the sequence currently open in the editor ----
  function detectKeyFromSequence() {
    if (typeof song === "undefined" || !song.notes) return null;
    const chroma = new Array(12).fill(0);
    let count = 0;
    for (const n of song.notes) {
      if (n.deleted || typeof n.type !== "string") continue;
      const m = n.type.match(/^([A-G]#?)(\d)$/); if (!m) continue;
      const pc = NOTE_NAMES.indexOf(m[1]); if (pc < 0) continue;
      chroma[pc] += Math.max(0.25, Number(n.length) || 1); count++;
    }
    if (!count) return { keys: [], chroma, count };
    return { keys: keysFromChroma(chroma), chroma, count };
  }

  /* ================= UI ================= */
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") e.className = v; else if (k === "html") e.innerHTML = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
    }
    for (const k of kids) if (k != null) e.append(k);
    return e;
  };
  const fmtPct = (x) => Math.round(x * 100) + "%";

  let panel, currentTab = "bpm", raf = 0, visMode = "bars", expanded = false, sharedFile = null, sharedBuffer = null;

  function buildPanel() {
    try { guide.enabled = !!prefs.guide; if (prefs.guide_mode) guide.mode = prefs.guide_mode; if (prefs.guide_engine) guide.engine = prefs.guide_engine; for (const k of ["sensitivity", "maxNotes", "opacity"]) if (prefs["guide_" + k] != null) guide[k] = prefs["guide_" + k]; } catch (e) {}
    panel = el("div", { id: "osg-tools", class: "osg-hidden" });
    const tabs = el("div", { class: "osg-tabs" },
      ...[["bpm", "BPM"], ["key", "Key"], ["chords", "Chords"], ["stems", "Stems"], ["track", "Track"], ["vis", "Visualizer"], ["settings", "Settings"]].map(([id, label]) =>
        el("button", { class: "osg-tab" + (id === currentTab ? " active" : ""), "data-tab": id, onclick: () => showTab(id) }, label)));
    dockBtn = el("button", { class: "osg-icon", title: "Dock to the sidebar", onclick: toggleDock, html: "&#x2B9E;" });
    // two rows: title + window buttons on top, the tab strip underneath (so all tabs fit, docked or floating)
    const head = el("div", { class: "osg-head" },
      el("div", { class: "osg-head-top" },
        el("span", { class: "osg-title" }, "Tools"), el("span", { class: "osg-head-grip", title: "Drag to move" }), dockBtn,
        el("button", { class: "osg-icon", title: "Expand / shrink", onclick: toggleExpand, html: "&#x26F6;" }),
        el("button", { class: "osg-icon", title: "Close (Esc)", onclick: () => togglePanel(false), html: "&#x2715;" })),
      tabs);
    panel.append(head, buildBpm(), buildKey(), buildChords(), buildStems(), buildTrack(), buildVis(), buildSettings());
    document.body.appendChild(panel);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.classList.contains("osg-hidden") && !docked) togglePanel(false); });
    makeDraggable(head);
    const pos = prefs.pos;
    if (pos) placePanel(pos.x, pos.y);
    if (typeof sidebar === "undefined") dockBtn.style.display = "none"; // only the editor has a sidebar
  }

  /* ---- docking into the site's sidebar (like the chat's "Move to sidebar") ---- */
  let docked = false, dockTab = null, dockBtn = null;
  function toggleDock() {
    if (typeof sidebar === "undefined") return;
    if (!docked) {
      dockTab = sidebar.tab("Tools", "", "460px");
      sidebar.open(dockTab, true);
      dockTab.page.innerHTML = ""; dockTab.page.appendChild(panel);
      panel.classList.add("osg-docked"); panel.classList.remove("osg-hidden", "osg-expanded"); expanded = false;
      panel.style.left = panel.style.top = panel.style.right = "";
      dockBtn.title = "Pop out"; dockBtn.innerHTML = "&#x2B9C;";
      docked = true; savePref("docked", true);
      // if the sidebar tab gets closed with its ✕, return the panel to floating mode
      const mo = new MutationObserver(() => { if (docked && !document.body.contains(panel)) { mo.disconnect(); undock(true); } });
      mo.observe(sidebar.container, { childList: true });
      dockTab._osgObserver = mo;
    } else {
      undock(false);
      try { sidebar.remove(dockTab); } catch (e) {}
    }
  }
  function undock(hidden) {
    dockTab?._osgObserver?.disconnect();
    docked = false; savePref("docked", false);
    panel.classList.remove("osg-docked"); document.body.appendChild(panel);
    if (prefs.pos) placePanel(prefs.pos.x, prefs.pos.y);
    dockBtn.title = "Dock to the sidebar"; dockBtn.innerHTML = "&#x2B9E;";
    if (hidden) panel.classList.add("osg-hidden");
    document.getElementById("osg-tools-link")?.parentElement.classList.toggle("active", !hidden);
  }

  /* ---- preferences (kept per-site in localStorage) ---- */
  let prefs = {};
  try { prefs = JSON.parse(localStorage.getItem("osg-tools") || "{}") || {}; } catch (e) { prefs = {}; }
  function savePref(k, v) { prefs[k] = v; try { localStorage.setItem("osg-tools", JSON.stringify(prefs)); } catch (e) {} }

  /* ---- dragging (grab the header) ---- */
  function placePanel(x, y) {
    const w = panel.offsetWidth, h = panel.offsetHeight;
    x = Math.min(Math.max(0, x), Math.max(0, innerWidth - w));
    y = Math.min(Math.max(0, y), Math.max(0, innerHeight - Math.min(h, 120)));
    panel.style.left = x + "px"; panel.style.top = y + "px"; panel.style.right = "auto";
  }
  function makeDraggable(handle) {
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest("button") || expanded) return;
      dragging = true; handle.setPointerCapture(e.pointerId);
      const r = panel.getBoundingClientRect(); sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      panel.classList.add("osg-dragging"); e.preventDefault();
    });
    handle.addEventListener("pointermove", (e) => { if (dragging) placePanel(ox + e.clientX - sx, oy + e.clientY - sy); });
    const end = (e) => { if (!dragging) return; dragging = false; panel.classList.remove("osg-dragging"); const r = panel.getBoundingClientRect(); savePref("pos", { x: r.left, y: r.top }); };
    handle.addEventListener("pointerup", end); handle.addEventListener("pointercancel", end);
    addEventListener("resize", () => { if (prefs.pos && !expanded) placePanel(prefs.pos.x, prefs.pos.y); });
  }

  // ---- shared audio-file picker (used by BPM and Key tabs) ----
  function filePicker(onReady) {
    const name = el("span", { class: "osg-file-name" }, sharedFile ? sharedFile.name : "No file chosen");
    const input = el("input", { type: "file", accept: "audio/*", class: "osg-file-input" });
    input.addEventListener("change", async () => {
      const f = input.files[0]; if (!f) return;
      sharedFile = f; sharedBuffer = null;
      document.querySelectorAll("#osg-tools .osg-file-name").forEach((n) => (n.textContent = f.name));
      onReady && onReady();
    });
    const btn = el("button", { class: "osg-btn", onclick: () => input.click() }, "Choose audio file");
    return el("div", { class: "osg-file" }, btn, name, input);
  }
  async function getBuffer(status) {
    if (!sharedFile) throw new Error("Pick an audio file first.");
    if (!sharedBuffer) { status("Decoding…"); sharedBuffer = await decodeFile(sharedFile); }
    return sharedBuffer;
  }
  // An "imported track": the reference track from the Track tab, or the site's own "Add Audio Track" file
  function getImportedBuffer() {
    if (ref.buffer) return { buf: ref.buffer, label: `reference track (${ref.name})` };
    const ws = (typeof wavesurferObj !== "undefined" && wavesurferObj) ? wavesurferObj : null;
    const buf = ws && ws.backend && ws.backend.buffer;
    if (buf) return { buf, label: "the site's audio track" };
    throw new Error("No imported track found. Load one in the Track tab, or use the site's “Add Audio Track”.");
  }
  // Generic analyze-button factory: runs `run(buffer)` against a buffer source and renders into `result`
  function analyzeButton(label, getSource, run, status, result) {
    const btn = el("button", { class: "osg-btn", onclick: async () => {
      try {
        btn.disabled = true; result.innerHTML = "";
        const src = await getSource((s) => (status.textContent = s));
        await run(src.buf, (s) => (status.textContent = s), result);
        status.textContent = `Analyzed ${src.buf.duration.toFixed(0)}s of ${src.label}.`;
      } catch (e) { status.textContent = e.message || String(e); } finally { btn.disabled = false; }
    } }, label);
    return btn;
  }

  // ---- BPM tab ----
  function buildBpm() {
    const taps = [];
    const tapVal = el("div", { class: "osg-big" }, "—");
    const tapHint = el("div", { class: "osg-muted" }, "Tap along to the beat (click or press T). 4+ taps for a good reading.");
    function tap() {
      const now = performance.now();
      if (taps.length && now - taps[taps.length - 1] > 2500) taps.length = 0;
      taps.push(now); if (taps.length > 12) taps.shift();
      if (taps.length >= 2) {
        const iv = []; for (let i = 1; i < taps.length; i++) iv.push(taps[i] - taps[i - 1]);
        const avg = iv.reduce((a, b) => a + b, 0) / iv.length;
        tapVal.textContent = (60000 / avg).toFixed(1) + " BPM";
        tapHint.textContent = `${taps.length} taps · click Apply to set the sequence tempo`;
      }
      tapBtn.classList.add("osg-pulse"); setTimeout(() => tapBtn.classList.remove("osg-pulse"), 120);
    }
    const tapBtn = el("button", { class: "osg-btn osg-tap", onclick: tap }, "TAP");
    document.addEventListener("keydown", (e) => {
      if ((e.key === "t" || e.key === "T") && isOpen() && currentTab === "bpm" && !/input|textarea|select/i.test(document.activeElement?.tagName || "")) { e.preventDefault(); tap(); }
    });
    const applyTap = el("button", { class: "osg-btn osg-ghost", onclick: () => applyBpm(parseFloat(tapVal.textContent)) }, "Apply to sequence");
    const resetTap = el("button", { class: "osg-btn osg-ghost", onclick: () => { taps.length = 0; tapVal.textContent = "—"; tapHint.textContent = "Tap along to the beat (click or press T)."; } }, "Reset");

    const status = el("div", { class: "osg-muted" }, "Detects tempo from a song file (mp3, wav, ogg…). Works best on music with a clear beat.");
    const result = el("div", { class: "osg-result" });
    const runBpm = async (buf, prog, target) => {
      const cands = await detectBPM(buf, prog);
      if (!cands.length) { target.textContent = "Couldn't find a steady beat."; return; }
      const best = cands[0];
      target.append(el("div", { class: "osg-big" }, best.bpm + " BPM"),
        el("div", { class: "osg-muted" }, `confidence ${fmtPct(best.confidence)} · could also be ${Math.round(best.bpm / 2)} or ${best.bpm * 2}`),
        el("div", { class: "osg-row" }, ...cands.slice(1, 4).map((c) => el("span", { class: "osg-chip" }, `${c.bpm} · ${fmtPct(c.confidence)}`))),
        el("div", { class: "osg-row" }, el("button", { class: "osg-btn osg-ghost", onclick: () => applyBpm(best.bpm) }, "Apply to sequence")));
    };
    const analyzeFile = analyzeButton("Analyze file", async (s) => ({ buf: await getBuffer(s), label: "the chosen file" }), runBpm, status, result);
    const impStatus = el("div", { class: "osg-muted" }, "Finds the tempo of the track loaded in the Track tab, or of the site's “Add Audio Track” file.");
    const impResult = el("div", { class: "osg-result" });
    const analyzeImported = analyzeButton("Find BPM of imported track", async () => getImportedBuffer(), runBpm, impStatus, impResult);

    return el("div", { class: "osg-pane", "data-pane": "bpm" },
      el("div", { class: "osg-section" }, el("h4", {}, "Tap tempo"), tapVal, el("div", { class: "osg-row" }, tapBtn, applyTap, resetTap), tapHint),
      el("div", { class: "osg-section" }, el("h4", {}, "Imported track"), el("div", { class: "osg-row" }, analyzeImported), impStatus, impResult),
      el("div", { class: "osg-section" }, el("h4", {}, "From an audio file"), filePicker(), el("div", { class: "osg-row" }, analyzeFile), status, result));
  }
  function applyBpm(v, quiet) {
    if (!v || !isFinite(v)) return false;
    const input = document.getElementById("bpm"); if (!input) { toast("Open the editor to apply a tempo."); return false; }
    input.value = Math.round(v);
    input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true }));
    if (!quiet) toast(`Sequence tempo set to ${Math.round(v)} BPM`);
    return true;
  }

  // ---- Key tab ----
  function renderKeys(target, res, extra) {
    target.innerHTML = "";
    if (!res || !res.keys.length) { target.textContent = extra || "Nothing to analyze."; return; }
    const best = res.keys[0];
    const max = Math.max(...res.chroma) || 1;
    target.append(
      el("div", { class: "osg-big" }, best.key),
      el("div", { class: "osg-muted" }, `relative: ${relativeOf(best)} · match ${fmtPct(Math.max(0, best.score))}${extra ? " · " + extra : ""}`),
      el("div", { class: "osg-row" }, ...res.keys.slice(1, 4).map((k) => el("span", { class: "osg-chip" }, `${k.key} · ${fmtPct(Math.max(0, k.score))}`))),
      el("div", { class: "osg-chroma" }, ...res.chroma.map((v, i) => el("div", { class: "osg-chroma-bar" + (i === best.tonic ? " tonic" : ""), title: NOTE_NAMES[i] },
        el("i", { style: `height:${Math.max(4, 100 * v / max)}%` }), el("b", {}, NOTE_NAMES[i])))));
  }
  function buildKey() {
    const seqRes = el("div", { class: "osg-result" });
    const seqBtn = el("button", { class: "osg-btn", onclick: () => {
      const res = detectKeyFromSequence();
      if (!res) return (seqRes.textContent = "Open a sequence in the editor first.");
      renderKeys(seqRes, res, res.count ? `${res.count} notes` : "No notes in this sequence yet.");
    } }, "Analyze current sequence");
    const runKey = async (buf, prog, target) => renderKeys(target, await detectKeyFromAudio(buf, prog));
    const status = el("div", { class: "osg-muted" }, "Finds the musical key of a song file by its overall pitch content.");
    const fileRes = el("div", { class: "osg-result" });
    const analyzeFile = analyzeButton("Analyze file", async (s) => ({ buf: await getBuffer(s), label: "the chosen file" }), runKey, status, fileRes);
    const impStatus = el("div", { class: "osg-muted" }, "Key of the track loaded in the Track tab, or of the site's “Add Audio Track” file.");
    const impResult = el("div", { class: "osg-result" });
    const analyzeImported = analyzeButton("Find key of imported track", async () => getImportedBuffer(), runKey, impStatus, impResult);
    return el("div", { class: "osg-pane osg-hidden", "data-pane": "key" },
      el("div", { class: "osg-section" }, el("h4", {}, "Current sequence"), el("div", { class: "osg-row" }, seqBtn), seqRes),
      el("div", { class: "osg-section" }, el("h4", {}, "Imported track"), el("div", { class: "osg-row" }, analyzeImported), impStatus, impResult),
      el("div", { class: "osg-section" }, el("h4", {}, "From an audio file"), filePicker(), el("div", { class: "osg-row" }, analyzeFile), status, fileRes));
  }

  // ---- Track tab: imported audio as clips on the grid. Real time, ignores BPM / tempo markers. ----
  const ref = { file: null, buffer: null, name: "", enabled: true, volume: 0.8, clips: [], sources: [], gain: null, startedAt: 0, startSec: 0, lastPlayTime: null, nextId: 1, showLane: true, selected: new Set(), autoTempo: true };
  function refCtx() { const ctx = T.ctx || (T.ctx = new AudioContext()); if (ctx.state === "suspended") ctx.resume(); return ctx; }
  function refGain() { const ctx = refCtx(); if (!ref.gain) { ref.gain = ctx.createGain(); ref.gain.connect(ctx.destination); } ref.gain.gain.value = ref.volume; return ref.gain; }
  const baseBpm = () => (typeof initialBpm !== "undefined" && initialBpm) || (typeof bpm !== "undefined" && bpm) || 110;
  const secondsPerTimeUnit = () => 60 / baseBpm() / 4;            // one time unit = a 16th at the sequence's base BPM
  const timeSig = () => { try { return getTimeSig() || 4; } catch (e) { return 4; } };
  const measureSec = () => 4 * timeSig() * secondsPerTimeUnit();
  const clipStartSec = (c) => (c.measure - 1) * measureSec();
  const clipDur = (c) => c.srcEnd - c.srcStart;
  const fmtMeasure = (m) => (Math.round(m * 100) / 100).toString();
  // The site's grid setting, in time units (16ths): its "grid" global is 0.25 for "1" (a beat) … 1 for "1/4" … 4 for "1/16"
  const gridSteps = () => { try { const g = typeof grid === "number" ? grid : +(document.getElementById("grid_select")?.value || 1); return g > 0 ? 1 / g : 1; } catch (e) { return 1; } };
  // Snap a measure position to the grid (free = Alt held: no snapping)
  const snapMeasure = (m, free) => { const per = 4 * timeSig(); let steps = (m - 1) * per; if (!free) { const u = gridSteps(); steps = Math.round(steps / u + 1e-9) * u; } return Math.max(1, 1 + steps / per); };
  // Start every clip that is still ahead of (or under) the playhead, in real time
  function refStart(timeIndex) {
    refStop();
    if (!ref.buffer || !ref.enabled || !ref.clips.length) return;
    const ctx = refCtx(), now = ctx.currentTime, playheadSec = (timeIndex || 0) * secondsPerTimeUnit();
    for (const c of ref.clips) {
      const cs = clipStartSec(c), ce = cs + clipDur(c);
      if (ce <= playheadSec) continue;
      const when = Math.max(0, cs - playheadSec), off = c.srcStart + Math.max(0, playheadSec - cs), dur = c.srcEnd - off;
      if (dur <= 0) continue;
      const src = ctx.createBufferSource(); src.buffer = ref.buffer; src.connect(refGain());
      src.start(now + when, off, dur); src.onended = () => { ref.sources = ref.sources.filter((x) => x !== src); };
      ref.sources.push(src);
    }
    ref.startedAt = now; ref.startSec = playheadSec; ref.lastPlayTime = timeIndex || 0;
  }
  function refStop() { for (const s of ref.sources) { try { s.stop(); } catch (e) {} } ref.sources = []; }
  function refPosition() { return ref.sources.length ? ref.startSec + (refCtx().currentTime - ref.startedAt) : null; }
  function hookSequencer() {
    if (typeof Song === "undefined" || Song.prototype.__osgHooked) return typeof Song !== "undefined";
    const play = Song.prototype.play, stop = Song.prototype.stop;
    Song.prototype.play = function (start, ...rest) { const r = play.call(this, start, ...rest); try { refStart(typeof start === "number" ? start : 0); } catch (e) {} return r; };
    Song.prototype.stop = function (...a) { try { refStop(); } catch (e) {} return stop.apply(this, a); };
    // Don't loop back to measure 1 while a reference track still has audio to play: extend the song's loop end to cover the clips
    const updateLoopTime = Song.prototype.updateLoopTime;
    Song.prototype.updateLoopTime = function (...a) {
      const r = updateLoopTime.apply(this, a);
      try {
        if (ref.buffer && ref.enabled && ref.clips.length) {
          const ts = this.getTimeSig ? this.getTimeSig() : timeSig(), measure = 4 * ts, spu = secondsPerTimeUnit();
          const end = Math.max(...ref.clips.map((c) => (clipStartSec(c) + clipDur(c)) / spu));
          const loop = Math.ceil(end / measure - 1e-6) * measure;
          if (loop > this.loopTime) { this.loopTime = loop; if (typeof maxCells === "number" && typeof updateLength === "function" && loop >= maxCells) updateLength(loop, ts); }
        }
      } catch (e) {}
      return r;
    };
    Song.prototype.__osgHooked = true;
    // Looping doesn't call play() again — watch for the play position jumping backwards and restart from there
    setInterval(() => {
      if (!ref.sources.length || typeof song === "undefined" || !song.playing || typeof playTime !== "number") return;
      if (ref.lastPlayTime != null && playTime < ref.lastPlayTime - 2) refStart(playTime);
      ref.lastPlayTime = playTime;
    }, 150);
    return true;
  }
  { let tries = 0; const t = setInterval(() => { if (hookSequencer() || ++tries > 600) clearInterval(t); }, 100); }

  // clip editing
  function addClip(measure, srcStart, srcEnd) { const c = { id: ref.nextId++, measure: Math.max(1, measure), srcStart, srcEnd }; ref.clips.push(c); ref.clips.sort((a, b) => a.measure - b.measure); clipsChanged(); return c; }
  function splitAt(measure) {
    const c = ref.clips.find((k) => measure > k.measure + 1e-6 && measure < k.measure + clipDur(k) / measureSec() - 1e-6);
    if (!c) return false;
    const at = c.srcStart + (measure - c.measure) * measureSec();
    const second = { id: ref.nextId++, measure, srcStart: at, srcEnd: c.srcEnd };
    c.srcEnd = at; ref.clips.push(second); ref.clips.sort((a, b) => a.measure - b.measure); clipsChanged(); return true;
  }
  function removeClip(c) { ref.clips = ref.clips.filter((k) => k !== c); ref.selected.delete(c.id); clipsChanged(); }
  // selection (click clips in the lane or the list; Shift+Alt+S merges the selected ones)
  function selectClip(c, additive) { if (!additive) { const was = ref.selected.has(c.id) && ref.selected.size === 1; ref.selected.clear(); if (!was) ref.selected.add(c.id); } else if (ref.selected.has(c.id)) ref.selected.delete(c.id); else ref.selected.add(c.id); selectionChanged(); }
  function selectionChanged() { lane && lane.querySelectorAll(".osg-clip").forEach((d) => d.classList.toggle("selected", ref.selected.has(+d.dataset.id))); document.querySelectorAll("#osg-tools .osg-clip-row").forEach((r) => r.classList.toggle("selected", ref.selected.has(+r.dataset.id))); }
  // Merge the selected clips into one. Pieces that are still back-to-back in the file are simply re-joined; otherwise the
  // clips are rendered (with their gaps / overlaps as placed on the grid) into a new region appended to the track.
  function mergeSelected() {
    const sel = ref.clips.filter((c) => ref.selected.has(c.id)).sort((a, b) => a.measure - b.measure);
    if (sel.length < 2) { toast("Select two or more clips first (click them in the lane; Shift+click to add)."); return false; }
    const spu = secondsPerTimeUnit(), eps = 0.002;
    let contiguous = true;
    for (let i = 1; i < sel.length; i++) { const a = sel[i - 1], b = sel[i]; if (Math.abs(a.srcEnd - b.srcStart) > eps || Math.abs((clipStartSec(a) + clipDur(a)) - clipStartSec(b)) > eps * 10) { contiguous = false; break; } }
    let merged;
    if (contiguous) { merged = { id: ref.nextId++, measure: sel[0].measure, srcStart: sel[0].srcStart, srcEnd: sel[sel.length - 1].srcEnd }; }
    else {
      const start = clipStartSec(sel[0]); let total = 0; for (const c of sel) total = Math.max(total, clipStartSec(c) - start + clipDur(c));
      const b = ref.buffer, sr = b.sampleRate, ch = b.numberOfChannels, segLen = Math.ceil(total * sr), oldLen = b.length;
      const out = refCtx().createBuffer(ch, oldLen + segLen, sr);
      for (let k = 0; k < ch; k++) {
        const src = b.getChannelData(k), dst = out.getChannelData(k); dst.set(src, 0);
        for (const c of sel) { const o = oldLen + Math.round((clipStartSec(c) - start) * sr), s0 = Math.round(c.srcStart * sr), s1 = Math.min(oldLen, Math.round(c.srcEnd * sr)); for (let i = s0; i < s1; i++) { const p = o + i - s0; if (p < out.length) dst[p] += src[i]; } }
      }
      ref.buffer = out;
      merged = { id: ref.nextId++, measure: sel[0].measure, srcStart: oldLen / sr, srcEnd: (oldLen + segLen) / sr };
    }
    ref.clips = ref.clips.filter((c) => !ref.selected.has(c.id)); ref.clips.push(merged); ref.clips.sort((a, b) => a.measure - b.measure);
    ref.selected.clear(); ref.selected.add(merged.id);
    if (!contiguous) guide.invalidate();
    clipsChanged(); selectionChanged();
    toast(`Merged ${sel.length} clips into one at measure ${fmtMeasure(merged.measure)}`);
    return true;
  }
  function splitAtPlayhead() { if (typeof playTime !== "number") return false; const m = snapMeasure(1 + playTime / (4 * timeSig())); const ok = splitAt(m); if (!ok) toast("No clip under the playhead to split."); else toast(`Split at measure ${fmtMeasure(m)}`); return ok; }
  document.addEventListener("keydown", (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey || (e.key !== "s" && e.key !== "S" && e.code !== "KeyS")) return;
    if (/input|textarea|select/i.test(document.activeElement?.tagName || "") && !document.activeElement.closest("#osg-tools")) return;
    if (!ref.buffer || !ref.clips.length) return;
    e.preventDefault(); e.stopPropagation();
    if (e.shiftKey) mergeSelected(); else splitAtPlayhead();
  }, true);
  let onClipsChanged = () => {};
  function clipsChanged() { onClipsChanged(); renderLane(); guide.invalidate(); try { if (typeof song !== "undefined" && song.updateLoopTime) song.updateLoopTime(); } catch (e) {} if (ref.sources.length && typeof playTime === "number") refStart(playTime); }

  // clip lane drawn over the sequencer grid
  let lane = null;
  function renderLane() {
    const host = document.getElementById("sequencer_inner");
    if (!host) return;
    if (!lane) {
      lane = el("div", { id: "osg-lane" }); host.appendChild(lane);
      // keep the lane pinned to the top of the visible grid while it scrolls (like the site's marker bar)
      const main = document.getElementById("sequencer_main"), mb = document.getElementById("marker_bar");
      const pin = () => { if (!main) return; const mbVisible = mb && getComputedStyle(mb).display !== "none"; lane.style.top = (main.scrollTop + (mbVisible ? 24 : 2)) + "px"; };
      main && main.addEventListener("scroll", pin, { passive: true }); setInterval(pin, 300); pin();
    }
    lane.style.display = ref.showLane && ref.buffer && ref.clips.length ? "block" : "none";
    lane.innerHTML = "";
    if (typeof noteWidth !== "number") return;
    const spu = secondsPerTimeUnit();
    for (const c of ref.clips) {
      const x = clipStartSec(c) / spu * noteWidth, w = Math.max(6, clipDur(c) / spu * noteWidth);
      const d = el("div", { class: "osg-clip" + (ref.selected.has(c.id) ? " selected" : ""), "data-id": c.id, title: `${ref.name} · ${c.srcStart.toFixed(1)}–${c.srcEnd.toFixed(1)}s at measure ${fmtMeasure(c.measure)}\nClick to select (Shift+click adds) · drag to move (follows the grid setting; hold Alt to move freely) · double-click or Alt+S to split · Shift+Alt+S merges selected` },
        el("span", {}, `${ref.name.replace(/\.[^.]+$/, "")} ${c.srcStart.toFixed(1)}s`));
      d.style.left = x + "px"; d.style.width = w + "px";
      let sx = 0, startM = 0, dragging = false, moved = false;
      d.addEventListener("pointerdown", (e) => { if (e.button !== 0) return; dragging = true; moved = false; sx = e.clientX; startM = c.measure; d.setPointerCapture(e.pointerId); e.preventDefault(); e.stopPropagation(); });
      d.addEventListener("pointermove", (e) => { if (!dragging) return; const dm = (e.clientX - sx) / noteWidth / (4 * timeSig()); if (Math.abs(e.clientX - sx) > 3) moved = true; c.measure = snapMeasure(startM + dm, e.altKey); d.style.left = clipStartSec(c) / spu * noteWidth + "px"; });
      const up = (e) => { if (!dragging) return; dragging = false; if (moved) { ref.clips.sort((a, b) => a.measure - b.measure); clipsChanged(); } else selectClip(c, e.shiftKey || e.ctrlKey); };
      d.addEventListener("pointerup", up); d.addEventListener("pointercancel", up);
      d.addEventListener("dblclick", (e) => { e.stopPropagation(); const m = c.measure + (e.clientX - d.getBoundingClientRect().left) / noteWidth / (4 * timeSig()); splitAt(snapMeasure(m, e.altKey)); });
      lane.appendChild(d);
    }
  }
  { let lastW = 0, lastTs = 0; setInterval(() => { if (!lane || lane.style.display === "none") return; const w = typeof noteWidth === "number" ? noteWidth : 0, ts = timeSig(); if (w !== lastW || ts !== lastTs) { lastW = w; lastTs = ts; renderLane(); } }, 400); }


  /* ================= Note guide: paint the reference track's detected pitches onto the piano roll ================= */
  const GUIDE_WORKER = String.raw`
    function fft(re, im) { const n = re.length; for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
      for (let len = 2; len <= n; len <<= 1) { const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang); for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let j = 0; j < len / 2; j++) { const a = i + j, b = a + len / 2; const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr; re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti; const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr; } } } }
    self.onmessage = function (e) {
      const { x, sr, cellSec, freqs } = e.data;
      const cells = Math.max(1, Math.ceil(x.length / sr / cellSec)), notes = freqs.length, out = new Float32Array(cells * notes);
      // Two resolutions: a long window for low notes (where semitones are only a few Hz apart), a shorter one above ~260 Hz
      const passes = [{ N: 16384, test: (f) => f < 262 }, { N: 8192, test: (f) => f >= 262 }];
      let done = 0;
      for (const { N, test } of passes) {
        const idx = []; for (let k = 0; k < notes; k++) if (test(freqs[k])) idx.push(k);
        if (!idx.length) continue;
        const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
        const re = new Float32Array(N), im = new Float32Array(N);
        // bins within a quarter tone of each note; at least the nearest bin
        const lo = new Int32Array(idx.length), hi = new Int32Array(idx.length);
        idx.forEach((k, j) => { const f = freqs[k]; let a = Math.ceil(f * Math.pow(2, -1 / 24) * N / sr), b = Math.floor(f * Math.pow(2, 1 / 24) * N / sr); if (b < a) a = b = Math.round(f * N / sr); lo[j] = Math.max(1, a); hi[j] = Math.min(N / 2 - 1, Math.max(a, b)); });
        for (let c = 0; c < cells; c++) {
          const center = (c + 0.5) * cellSec * sr, start = Math.round(center - N / 2);
          for (let i = 0; i < N; i++) { const p = start + i; re[i] = (p >= 0 && p < x.length ? x[p] : 0) * win[i]; im[i] = 0; }
          fft(re, im);
          idx.forEach((k, j) => { let m = 0; for (let b = lo[j]; b <= hi[j]; b++) { const v = re[b] * re[b] + im[b] * im[b]; if (v > m) m = v; } out[c * notes + k] = Math.sqrt(m) * (8192 / N); });
          if (c % 50 === 0) self.postMessage({ progress: (done + c / cells) / passes.length });
        }
        done++;
      }
      self.postMessage({ done: true, out, cells, notes }, [out.buffer]);
    };`
  // second guide color for repeated notes: the accent color with its hue turned ~150° (violet → amber, cyan → coral…)
  function altColor(rgb) {
    const [r, g, b] = rgb.split(",").map((x) => +x / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    let h = 0, s = 0;
    if (d) { s = d / (1 - Math.abs(2 * l - 1)); h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; }
    h = (h + 150 + 360) % 360; s = Math.max(s, 0.75); const L = Math.min(Math.max(l, 0.55), 0.65);
    const C = (1 - Math.abs(2 * L - 1)) * s, X = C * (1 - Math.abs(((h / 60) % 2) - 1)), m = L - C / 2;
    const [r1, g1, b1] = h < 60 ? [C, X, 0] : h < 120 ? [X, C, 0] : h < 180 ? [0, C, X] : h < 240 ? [0, X, C] : h < 300 ? [X, 0, C] : [C, 0, X];
    return [r1, g1, b1].map((v) => Math.round((v + m) * 255)).join(", ");
  }
  const guide = {
    enabled: false, engine: "ai", mode: "melody", sensitivity: 0.5, maxNotes: 3, opacity: 0.45, data: null, picks: null, key: "", busy: false, canvas: null, names: null, aiNotes: null, aiKey: "",
    MODES: [["melody", "Melody"], ["bass", "Bass"], ["chords", "Chords"], ["arp", "Arpeggio"], ["all", "Everything"]],
    invalidate() { this.data = null; this.picks = null; this.schedule(); },
    repick() { this.picks = null; this.schedule(); },
    noteNames() { if (typeof piano !== "undefined" && piano.length) return piano.slice(); const out = []; for (let o = 7; o >= 2; o--) for (let p = 11; p >= 0; p--) out.push(NOTE_NAMES[p] + o); return out; },
    freqOf(name) { const m = name.match(/^([A-G]#?)(\d)$/); if (!m) return 440; const midi = 12 * (+m[2] + 1) + NOTE_NAMES.indexOf(m[1]); return 440 * Math.pow(2, (midi - 69) / 12); },
    // AI engine: Spotify Basic Pitch turns the audio into note events (seconds); they're re-gridded whenever the tempo changes
    async analyzeAI() {
      if (!ref.buffer || this.busy) return;
      const cellSec = secondsPerTimeUnit(), noteKey = `${ref.name}|${ref.buffer.length}`;
      this.names = this.noteNames();
      if (this.aiNotes && this.aiKey === noteKey) { this.setAiData(cellSec); this.schedule(); return; }
      if (!window.__osgML) { this.engine = "dsp"; return this.analyze(); }
      this.busy = true; let ok = true;
      try {
        const notes = await window.__osgML.transcribe(ref.buffer, { onStatus: (t) => this.onStatusText && this.onStatusText(t), onProgress: (p) => this.onProgress && this.onProgress(Math.min(0.99, p)) });
        notes.forEach((n, i) => (n.id = i + 1));   // each detected note keeps its identity, so repeats on one key stay separate notes
        if (ref.buffer && `${ref.name}|${ref.buffer.length}` === noteKey) { this.aiNotes = notes; this.aiKey = noteKey; this.setAiData(cellSec); }
      } catch (e) { ok = false; console.warn("[Glow Tools] Basic Pitch failed:", e); this.engine = "dsp"; this.aiError = String((e && (e.message || e)) || "unknown error"); this.onStatusText && this.onStatusText(`The AI note model failed: ${this.aiError}. Showing the built-in engine instead — pick "AI" again to retry.`); if (this.engineSelect) this.engineSelect.value = "dsp"; }
      this.busy = false; if (ok) this.onProgress && this.onProgress(1); this.schedule();
    },
    setAiData(cellSec) { this.cellSec = cellSec; this.data = { ai: true, cells: Math.max(1, Math.ceil(ref.buffer.duration / cellSec)), notes: this.names.length }; this.picks = null; },
    buildPicksAI() {
      const names = this.names, cs = this.cellSec, cells = this.data.cells, mode = this.mode, beat = 4 * cs;
      const rowOf = (m) => names.indexOf(NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1));
      const thr = 0.1 + 0.5 * (1 - this.sensitivity);     // Basic Pitch amplitude, 0..1
      let notes = this.aiNotes.filter((n) => n.amp >= thr && (mode === "melody" ? n.midi >= 48 && n.end - n.start <= 3 : mode === "bass" ? n.midi < 60 : mode === "chords" ? n.end - n.start >= 0.9 * beat : mode === "arp" ? n.end - n.start < 0.9 * beat : true));
      if (mode === "melody") {   // scoops: a short note sliding into a longer one a semitone or two away is part of that note
        notes = notes.filter((n) => { const d = n.end - n.start; return !(d < 0.25 && notes.some((m) => m !== n && m.midi !== n.midi && Math.abs(m.midi - n.midi) <= 2 && m.start - n.end > -0.06 && m.start - n.end < 0.1 && m.end - m.start > 2 * d)); });
      }
      // ghost overtones: a note an octave / 12th / two octaves… above another one that starts and stops with it
      const OVER = [12, 19, 24, 28, 31, 34, 36], all = this.aiNotes;
      notes = notes.filter((n) => !all.some((p) => p !== n && OVER.includes(n.midi - p.midi) && Math.abs(n.start - p.start) < 0.12 && Math.abs(n.end - p.end) < 0.2 && p.amp >= 0.5 * n.amp));
      const cand = Array.from({ length: cells }, () => []);
      for (const n of notes) {
        if (rowOf(n.midi) < 0) continue;
        const k0 = Math.max(0, Math.floor(n.start / cs)), k1 = Math.min(cells - 1, Math.ceil(n.end / cs) - 1);
        let any = false;
        for (let k = k0; k <= k1; k++) { const ov = Math.min(n.end, (k + 1) * cs) - Math.max(n.start, k * cs); if (ov >= 0.5 * cs) { cand[k].push(n); any = true; } }
        if (!any) cand[Math.min(cells - 1, Math.max(0, Math.floor((n.start + n.end) / 2 / cs)))].push(n);   // short notes still get one step
      }
      const mono = mode === "melody" || mode === "bass" || mode === "arp", maxN = mono ? 1 : this.maxNotes;
      const picks = new Array(cells); let prev = null;
      for (let k = 0; k < cells; k++) {
        const c = cand[k];
        let chosen = [];
        if (c.length) {
          if (mode === "bass") { const mx = Math.max(...c.map((n) => n.amp)); chosen = [c.filter((n) => n.amp >= 0.6 * mx).sort((a, b) => a.midi - b.midi)[0]]; }
          // melody = the highest reasonably loud note (skyline); arpeggio = the loudest, sticking to the previous note on near-ties
          else if (mode === "melody") { const mx = Math.max(...c.map((n) => n.amp)); chosen = [c.filter((n) => n.amp >= 0.5 * mx).reduce((a, b) => (b.midi > a.midi ? b : a))]; }
          else if (mono) { let best = c.reduce((a, b) => (b.amp > a.amp ? b : a)); if (prev && prev !== best && c.includes(prev) && prev.amp >= 0.85 * best.amp) best = prev; chosen = [best]; }
          else chosen = c.slice().sort((a, b) => b.amp - a.amp).slice(0, maxN);
        }
        prev = mono && chosen.length ? chosen[0] : null;
        picks[k] = chosen.map((n) => [rowOf(n.midi), Math.min(1, n.amp), n.id]);
      }
      // one-step flickers inside a note take that note (but a one-step rest between two repeats of a key stays a rest)
      if (mode === "melody" || mode === "bass") for (let k = 1; k < cells - 1; k++) { const a = picks[k - 1][0], b = picks[k][0], c2 = picks[k + 1][0]; if (a && c2 && a[0] === c2[0] && (b ? b[0] !== a[0] : a[2] === c2[2])) picks[k] = [[a[0], (a[1] + c2[1]) / 2, a[2]]]; }
      this.picks = picks;
    },
    async analyze() {
      if (this.engine === "ai") return this.analyzeAI();
      if (!ref.buffer || this.busy) return;
      const cellSec = secondsPerTimeUnit(), key = `${ref.name}|${ref.buffer.length}|${cellSec.toFixed(5)}`;
      if (this.data && this.key === key) return;
      this.busy = true; this.key = key; this.names = this.noteNames();
      const b = ref.buffer, L = b.getChannelData(0), R = b.numberOfChannels > 1 ? b.getChannelData(1) : L, x = new Float32Array(b.length);
      for (let i = 0; i < b.length; i++) x[i] = (L[i] + R[i]) / 2;
      const freqs = this.names.map((n) => this.freqOf(n));
      try {
        const res = await new Promise((resolve, reject) => { const w = new Worker(URL.createObjectURL(new Blob([GUIDE_WORKER], { type: "application/javascript" }))); w.onmessage = (e) => { if (e.data.done) { w.terminate(); resolve(e.data); } else if (guide.onProgress) guide.onProgress(e.data.progress); }; w.onerror = (err) => { w.terminate(); reject(err); }; w.postMessage({ x, sr: b.sampleRate, cellSec, freqs }, [x.buffer]); });
        if (this.key === key) { this.data = res; this.cellSec = cellSec; this.picks = null; }
      } catch (e) {}
      this.busy = false; this.onProgress && this.onProgress(1); this.schedule();
    },
    // Turn raw per-note energies into the notes to show, per step, for the chosen part.
    // Rows run high→low (piano[0] is the top key), so "12 semitones higher" = index - 12.
    buildPicks() {
      if (this.data.ai) return this.buildPicksAI();
      const { out, cells, notes } = this.data, mode = this.mode, names = this.names || this.noteNames();
      const HARM = [0, 12, 19, 24, 28, 31], HW = [1, 0.9, 0.8, 0.7, 0.6, 0.5];   // overtone offsets (semitones) and weights
      const c4 = Math.max(0, names.indexOf("C4")), c3 = Math.max(0, names.indexOf("C3")), lowOnly = mode === "bass", mono = mode === "melody" || mode === "bass" || mode === "arp";
      const maxN = mono ? 1 : mode === "chords" ? Math.max(2, this.maxNotes) : this.maxNotes;
      const thr = 1 - this.sensitivity, e = new Float32Array(notes), sal = new Float32Array(notes), picks = new Array(cells);
      // loudness gate: a step has to carry real energy (relative to the loud parts of the track) before anything is drawn in it
      // (measured in the register the mode cares about; the Sensitivity slider sets how quiet a step may be)
      const loud = new Float32Array(cells), rFrom = lowOnly ? c4 : 0, rTo = mode === "melody" ? c3 : notes - 1;
      for (let k = 0; k < cells; k++) { let m = 0; for (let n = rFrom; n <= rTo; n++) { const v = out[k * notes + n]; if (v > m) m = v; } loud[k] = m; }
      const sorted = Float32Array.from(loud).sort(), refLoud = sorted[Math.floor(sorted.length * 0.95)] || 1, gate = refLoud * (0.03 + 0.2 * (1 - this.sensitivity));
      let prevPick = -1;
      for (let k = 0; k < cells; k++) {
        let max = 0;
        for (let n = 0; n < notes; n++) { const v = out[k * notes + n]; e[n] = v; if (v > max && (!lowOnly || n >= c4)) max = v; }
        if (loud[k] <= gate) { picks[k] = []; continue; }
        // salience = harmonic sum: a real note has energy at its fundamental AND its overtones; an overtone on its own doesn't
        let smax = 0;
        // (a note's 3rd harmonic — an octave and a fifth up — is what tells a real fundamental from the octave below it:
        //  the octave below only "sees" the even harmonics, so it's docked for having no 3rd of its own)
        for (let n = 0; n < notes; n++) { let v = 0, top = 0; for (let h = 0; h < HARM.length; h++) { const m = n - HARM[h]; if (m >= 0) { v += e[m] * HW[h]; if (h && e[m] > top) top = e[m]; } } const third = n - 19 >= 0 ? Math.min(1, e[n - 19] / (e[n] + 1e-9)) : 0; v *= (0.7 + 0.3 * third) * Math.min(1, e[n] / (0.3 * top + 1e-9)); sal[n] = v; if (v > smax && (!lowOnly || n >= c4)) smax = v; }
        if (smax <= 0) { picks[k] = []; continue; }
        const order = [];
        for (let n = lowOnly ? c4 : 0; n < notes; n++) if (e[n] >= 0.1 * max && sal[n] >= thr * 0.5 * smax) order.push(n);
        order.sort((p, q) => sal[q] - sal[p]);
        const chosen = [];
        if (mono) {
          let best = order.length ? order[0] : -1;
          if (mode === "melody" && best > c3) {
            // the loudest thing is in the bass register: the melody is the strongest note above C3 that isn't just an overtone of it
            const bass = best; best = -1;
            for (const n of order) { if (n > c3) continue; let ov = false; for (let h = 1; h < HARM.length; h++) if (n === bass - HARM[h] && sal[n] < 0.9 * sal[bass]) { ov = true; break; } if (!ov && sal[n] >= 0.35 * sal[bass]) { best = n; break; } }
          }
          if (best >= 0) {
            // stickiness: keep the previous note if it's nearly as salient (kills flicker between neighbours / octaves)
            if (prevPick >= 0 && prevPick !== best && order.includes(prevPick) && sal[prevPick] >= 0.85 * sal[best]) best = prevPick;
            if (lowOnly) { for (const n of order) if (n > best && sal[n] >= 0.6 * sal[best]) best = n; }   // bass: lowest strong candidate
            chosen.push([best, sal[best] / smax]);
          }
        } else {
          for (const n of order) {
            if (chosen.length >= maxN) break;
            if (sal[n] < thr * smax) continue;
            let overtone = false;
            for (const [p] of chosen) { for (let h = 1; h < HARM.length; h++) if (n === p - HARM[h] && sal[n] < 0.9 * sal[p]) { overtone = true; break; } if (overtone) break; }
            if (overtone) continue;
            chosen.push([n, sal[n] / smax]);
          }
        }
        prevPick = chosen.length ? chosen[0][0] : -1;
        picks[k] = chosen;
      }
      // melody / bass: lone one-step flickers take the neighbours' note, and a run that wobbles between two adjacent
      // semitones (a singer slightly sharp/flat, vibrato) snaps to the one it spends most time on
      if (mode === "melody" || mode === "bass") {
        for (let k = 1; k < cells - 1; k++) { const a = picks[k - 1][0], b = picks[k][0], c = picks[k + 1][0]; if (a && c && a[0] === c[0] && (!b || b[0] !== a[0])) picks[k] = [[a[0], (a[1] + c[1]) / 2]]; }
        const snapped = picks.map((p) => p[0] ? p[0][0] : -1);
        for (let k = 0; k < cells; k++) {
          const n = snapped[k]; if (n < 0) continue;
          const counts = new Map();
          for (let j = Math.max(0, k - 3); j <= Math.min(cells - 1, k + 3); j++) { const m = snapped[j]; if (m >= 0 && Math.abs(m - n) <= 1) counts.set(m, (counts.get(m) || 0) + 1); }
          let bestN = n, bestC = 0; for (const [m, c] of counts) if (c > bestC || (c === bestC && m === n)) { bestC = c; bestN = m; }
          if (bestN !== n) picks[k] = [[bestN, picks[k][0][1]]];
        }
      }
      // chords: only sustained notes (3+ steps) count, one-off blips are noise
      if (mode === "chords") {
        for (let n = 0; n < notes; n++) {
          let run = 0;
          for (let k = 0; k <= cells; k++) { const has = k < cells && picks[k].some((p) => p[0] === n); if (has) run++; else { if (run > 0 && run < 3) for (let j = k - run; j < k; j++) picks[j] = picks[j].filter((p) => p[0] !== n); run = 0; } }
        }
      }
      this.picks = picks;
    },
    ensureCanvas() {
      const host = document.getElementById("sequencer_inner"), main = document.getElementById("sequencer_main"); if (!host || !main) return null;
      if (!this.canvas) {
        this.canvas = el("canvas", { id: "osg-guide" }); host.appendChild(this.canvas);
        main.addEventListener("scroll", () => this.schedule(), { passive: true }); addEventListener("resize", () => this.schedule());
        setInterval(() => { if (this.enabled && (this._nw !== noteWidth || this._nh !== noteHeight || (this.data && Math.abs(secondsPerTimeUnit() - this.cellSec) > 1e-6))) this.schedule(); }, 400);
      }
      return this.canvas;
    },
    schedule() { if (this._t) return; this._t = setTimeout(() => { this._t = 0; try { this.draw(); } catch (e) {} }, 16); },
    draw() {
      const cv = this.ensureCanvas(); if (!cv) return;
      const show = this.enabled && ref.buffer && ref.clips.length;
      cv.style.display = show ? "block" : "none"; if (!show) return;
      if (!this.data) { this.analyze(); return; }
      if (Math.abs(secondsPerTimeUnit() - this.cellSec) > 1e-6) { this.data = null; this.picks = null; this.analyze(); return; }   // tempo changed → re-grid (AI notes are reused)
      if (!this.picks) this.buildPicks();
      const main = document.getElementById("sequencer_main"), W = main.clientWidth, H = main.clientHeight, sl = main.scrollLeft, st = main.scrollTop, dpr = devicePixelRatio || 1;
      this._nw = noteWidth; this._nh = noteHeight;
      cv.style.left = sl + "px"; cv.style.top = st + "px"; cv.style.width = W + "px"; cv.style.height = H + "px";
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, -sl * dpr, -st * dpr); g.clearRect(sl, st, W, H);
      const A = getComputedStyle(document.documentElement).getPropertyValue("--os-accent-rgb").trim() || "124, 92, 255", A2 = altColor(A);
      const { cells, notes } = this.data, spu = secondsPerTimeUnit(), cellSec = this.cellSec, picks = this.picks;
      const unitFrom = sl / noteWidth - 1, unitTo = (sl + W) / noteWidth + 1;
      const rowFrom = Math.max(0, Math.floor(st / noteHeight)), rowTo = Math.min(notes - 1, Math.ceil((st + H) / noteHeight));
      const w = cellSec / spu * noteWidth;
      for (const c of ref.clips) {
        const gridStart = (c.measure - 1) * 4 * timeSig();
        const k0 = Math.max(0, Math.floor(c.srcStart / cellSec)), k1 = Math.min(cells - 1, Math.ceil(c.srcEnd / cellSec));
        // draw each row as runs of consecutive steps belonging to the same note. When a key is struck again right
        // after itself (repeated notes), the next note switches to the second color so you can see where it restarts.
        for (let n = rowFrom; n <= rowTo; n++) {
          let runStart = -1, runSum = 0, runLen = 0, runId, lastEnd = -2, flip = false;
          const flush = (kEnd) => {
            if (runStart < 0) return;
            flip = runStart === lastEnd ? !flip : false; lastEnd = kEnd;
            const u0 = gridStart + (runStart * cellSec - c.srcStart) / spu, u1 = gridStart + (kEnd * cellSec - c.srcStart) / spu;
            if (u1 >= unitFrom && u0 <= unitTo) { const v = runSum / runLen; g.fillStyle = `rgba(${flip ? A2 : A},${(0.25 + 0.75 * v) * this.opacity})`; g.beginPath(); g.roundRect(u0 * noteWidth + 1, n * noteHeight + 1.5, Math.max(2, (u1 - u0) * noteWidth - 2), Math.max(1, noteHeight - 3), 3); g.fill(); }
            runStart = -1; runSum = 0; runLen = 0;
          };
          for (let k = k0; k <= k1; k++) {
            const p = picks[k] && picks[k].find((q) => q[0] === n);
            if (p && runStart >= 0 && p[2] !== runId) flush(k);           // same key, new note → close the previous one here
            if (p) { if (runStart < 0) { runStart = k; runId = p[2]; } runSum += p[1]; runLen++; } else flush(k);
          }
          flush(k1 + 1);
        }
      }
    },
  };

  // On load: find the track's tempo and time signature and set the sequence to match, so measures line up with the audio
  async function autoTempo(say) {
    if (!ref.autoTempo || !ref.buffer) return "";
    try {
      const r = await analyzeTempo(ref.buffer, say);
      const okB = applyBpm(r.bpm, true), okT = applyTimeSig(r.timeSig);
      toast(`Track: ${r.bpm} BPM, ${r.timeSig}/4${okB ? " — applied" : ""}`);
      return `Detected ${r.bpm} BPM, ${r.timeSig}/4${okB || okT ? " and set the sequence to match" : ""}. `;
    } catch (e) { return ""; }
  }
  function buildTrack() {
    const name = el("span", { class: "osg-file-name" }, "No track loaded");
    const input = el("input", { type: "file", accept: "audio/*", class: "osg-file-input" });
    const status = el("div", { class: "osg-muted" }, "Load a song, push it onto the grid at a measure, then split it and move the pieces around. It plays in real time with ▶ and ignores BPM / tempo markers, so it never stretches or drifts.");
    const live = el("div", { class: "osg-muted osg-live" }, "");
    const pushMeasure = el("input", { type: "number", min: 1, step: "any", value: 1, class: "osg-num" });
    const clipList = el("div", { class: "osg-clips" });
    input.addEventListener("change", async () => {
      const f = input.files[0]; if (!f) return;
      try { status.textContent = "Decoding…"; ref.buffer = await decodeFile(f); ref.file = f; ref.name = f.name; name.textContent = `${f.name} · ${ref.buffer.duration.toFixed(1)}s`; ref.clips = []; ref.selected.clear(); guide.invalidate();
        const tempoNote = await autoTempo((m) => (status.textContent = m));
        addClip(+pushMeasure.value || 1, 0, ref.buffer.duration); status.textContent = `Loaded and pushed to measure ${fmtMeasure(+pushMeasure.value || 1)}. ${tempoNote}Press ▶ in the sequencer to hear it with your song.`; }
      catch (e) { status.textContent = "Couldn't decode that file: " + (e.message || e); }
    });
    const choose = el("button", { class: "osg-btn", onclick: () => input.click() }, "Load track");
    const autoT = el("input", { type: "checkbox" }); autoT.checked = ref.autoTempo = prefs.autoTempo !== false;
    autoT.addEventListener("change", () => { ref.autoTempo = autoT.checked; savePref("autoTempo", autoT.checked); });
    const detectBtn = el("button", { class: "osg-btn osg-ghost", title: "Detect the track's BPM and time signature and apply them to the sequence", onclick: async () => { if (!ref.buffer) return toast("Load a track first."); detectBtn.disabled = true; try { const r = await analyzeTempo(ref.buffer, (m) => (status.textContent = m)); applyBpm(r.bpm); applyTimeSig(r.timeSig); clipsChanged(); status.textContent = `Detected ${r.bpm} BPM, ${r.timeSig}/4 (3/4: ${r.meterScores[3]}, 4/4: ${r.meterScores[4]}, 5/4: ${r.meterScores[5]}) — applied.`; } catch (e) { status.textContent = "Couldn't detect tempo: " + (e.message || e); } detectBtn.disabled = false; } }, "Detect BPM & time sig");
    const pushBtn = el("button", { class: "osg-btn", onclick: () => { if (!ref.buffer) return toast("Load a track first."); ref.clips = []; addClip(+pushMeasure.value || 1, 0, ref.buffer.duration); status.textContent = `Pushed the whole track to measure ${fmtMeasure(+pushMeasure.value || 1)}.`; } }, "Push");
    const remove = el("button", { class: "osg-btn osg-ghost", onclick: () => { refStop(); ref.buffer = null; ref.file = null; ref.name = ""; ref.clips = []; clipsChanged(); name.textContent = "No track loaded"; status.textContent = "Track removed."; } }, "Remove");
    const splitMeasure = el("input", { type: "number", min: 1, step: "any", value: 2, class: "osg-num" });
    const splitBtn = el("button", { class: "osg-btn osg-ghost", onclick: () => { const m = +splitMeasure.value; if (!splitAt(m)) toast(`No clip covers measure ${fmtMeasure(m)}.`); } }, "Split");
    const splitHere = el("button", { class: "osg-btn osg-ghost", title: "Split at the playhead (Alt+S)", onclick: splitAtPlayhead }, "Split at playhead");
    const mergeBtn = el("button", { class: "osg-btn osg-ghost", title: "Merge the selected clips (Shift+Alt+S)", onclick: mergeSelected }, "Merge selected");
    const enable = el("input", { type: "checkbox" }); enable.checked = true;
    enable.addEventListener("change", () => { ref.enabled = enable.checked; try { if (typeof song !== "undefined" && song.updateLoopTime) song.updateLoopTime(); } catch (e) {} if (!ref.enabled) refStop(); else if (typeof song !== "undefined" && song.playing && typeof playTime === "number") refStart(playTime); });
    const showLane = el("input", { type: "checkbox" }); showLane.checked = true;
    showLane.addEventListener("change", () => { ref.showLane = showLane.checked; renderLane(); });
    const vol = el("input", { type: "range", min: 0, max: 1.5, step: 0.01, value: ref.volume, class: "osg-slider" });
    const volVal = el("span", { class: "osg-slider-val" }, Math.round(ref.volume * 100) + "%");
    vol.addEventListener("input", () => { ref.volume = +vol.value; volVal.textContent = Math.round(ref.volume * 100) + "%"; if (ref.gain) ref.gain.gain.value = ref.volume; });
    const previewM = el("input", { type: "number", min: 1, step: "any", value: 1, class: "osg-num" });
    const preview = el("button", { class: "osg-btn osg-ghost", onclick: () => { if (ref.sources.length) return refStop(); if (typeof song !== "undefined" && song.playing) return toast("The sequencer is already playing it."); refStart(((+previewM.value || 1) - 1) * 4 * timeSig()); } }, "Preview from measure");
    onClipsChanged = () => {
      clipList.innerHTML = "";
      if (!ref.clips.length) { clipList.append(el("div", { class: "osg-muted" }, "No clips yet. Load a track or push it to a measure.")); return; }
      ref.clips.forEach((c, i) => {
        const m = el("input", { type: "number", min: 1, step: +(gridSteps() / (4 * timeSig())).toFixed(6), value: fmtMeasure(c.measure), class: "osg-num" });
        m.addEventListener("change", () => { c.measure = Math.max(1, +m.value || 1); ref.clips.sort((a, b) => a.measure - b.measure); clipsChanged(); });
        const trim = el("input", { type: "number", step: 0.05, value: c.srcStart.toFixed(2), class: "osg-num", title: "Trim: seconds into the file where this clip starts" });
        trim.addEventListener("change", () => { c.srcStart = Math.min(Math.max(0, +trim.value || 0), c.srcEnd - 0.05); clipsChanged(); });
        const chip = el("span", { class: "osg-chip" + (ref.selected.has(c.id) ? " active" : ""), title: "Click to select (Shift+click adds)" }, `#${i + 1}`);
        chip.addEventListener("click", (e) => selectClip(c, e.shiftKey || e.ctrlKey));
        clipList.append(el("div", { class: "osg-clip-row" + (ref.selected.has(c.id) ? " selected" : ""), "data-id": c.id },
          chip,
          el("span", { class: "osg-muted" }, "measure"), m,
          el("span", { class: "osg-muted" }, "from"), trim,
          el("span", { class: "osg-muted" }, `to ${c.srcEnd.toFixed(1)}s (${clipDur(c).toFixed(1)}s)`),
          el("button", { class: "osg-icon", title: "Delete clip", onclick: () => removeClip(c), html: "&#x2715;" })));
      });
    };
    onClipsChanged();
    setInterval(() => { const p = refPosition(); live.textContent = p == null ? "" : `▶ ${ref.sources.length} clip${ref.sources.length === 1 ? "" : "s"} · ${p.toFixed(1)}s`; }, 250);
    // note guide controls
    const gOn = el("input", { type: "checkbox" }); gOn.checked = guide.enabled; guide.checkbox = gOn;
    const gStatus = el("div", { class: "osg-muted" }, "Paints the track's detected notes onto the piano roll, half-transparent, aligned with the clips. Best on a single isolated part (send one over from the Stems tab).");
    guide.onProgress = (p) => { gStatus.textContent = p >= 1 ? `Guide ready${guide.engine === "ai" && guide.aiNotes ? ` — ${guide.aiNotes.length} notes found` : ""}.` : `${guide.engine === "ai" ? "Transcribing notes" : "Analyzing pitches"}… ${Math.round(p * 100)}%`; };
    guide.onStatusText = (t) => (gStatus.textContent = t);
    const gEngine = el("select", { class: "osg-select" }, el("option", { value: "ai" }, "AI — Spotify Basic Pitch (best)"), el("option", { value: "dsp" }, "Fast — built-in pitch analysis"));
    gEngine.value = guide.engine; guide.engineSelect = gEngine;
    gEngine.addEventListener("change", () => { guide.engine = gEngine.value; savePref("guide_engine", guide.engine); guide.invalidate(); });
    gOn.addEventListener("change", () => { guide.enabled = gOn.checked; savePref("guide", guide.enabled); guide.schedule(); });
    const modeRow = el("div", { class: "osg-row" }, ...guide.MODES.map(([id, label]) => el("button", { class: "osg-chip osg-gmode" + (id === guide.mode ? " active" : ""), "data-gm": id, onclick: () => { guide.mode = id; savePref("guide_mode", id); modeRow.querySelectorAll(".osg-gmode").forEach((b) => b.classList.toggle("active", b.dataset.gm === id)); guide.repick(); } }, label)));
    const gSlider = (label, key, min, max, step, fmt) => { const val = el("span", { class: "osg-slider-val" }); const input = el("input", { type: "range", min, max, step, value: guide[key], class: "osg-slider" }); const upd = () => (val.textContent = fmt(+input.value)); input.addEventListener("input", () => { guide[key] = +input.value; savePref("guide_" + key, guide[key]); upd(); guide.repick(); }); upd(); return el("label", { class: "osg-slider-row" }, el("span", { class: "osg-slider-label" }, label), input, val); };
    const guideBox = el("div", { class: "osg-section" }, el("h4", {}, "Note guide on the piano roll"),
      el("label", { class: "osg-row" }, gOn, el("span", {}, "Show notes (half-transparent)")),
      el("div", { class: "osg-row" }, el("span", { class: "osg-muted" }, "Engine"), gEngine),
      el("div", { class: "osg-muted" }, "What to pick out:"), modeRow,
      el("div", { class: "osg-sliders" }, gSlider("Sensitivity", "sensitivity", 0.1, 0.9, 0.05, (v) => Math.round(v * 100) + "%"), gSlider("Max notes", "maxNotes", 1, 8, 1, (v) => String(v)), gSlider("Opacity", "opacity", 0.15, 0.9, 0.05, (v) => Math.round(v * 100) + "%")),
      el("div", { class: "osg-muted" }, "Melody / Bass / Arpeggio show one note per step (Melody looks at C3 and up, Bass below C4). Chords shows up to “Max notes” held notes and ignores one-off blips. Everything shows all strong pitches. Overtones and sub-octaves are filtered out; Sensitivity also sets how quiet a step can be before nothing is drawn. When the same key is played again right away, the repeat is drawn in a second color. Cleanest on an isolated stem."),
      gStatus);
    return el("div", { class: "osg-pane osg-hidden", "data-pane": "track" },
      el("div", { class: "osg-section" }, el("h4", {}, "Imported track"),
        el("div", { class: "osg-file" }, choose, name, input),
        el("div", { class: "osg-row" }, el("span", { class: "osg-muted" }, "Push to measure"), pushMeasure, pushBtn, remove),
        el("div", { class: "osg-row" }, el("label", { class: "osg-row" }, autoT, el("span", {}, "Auto-detect BPM & time signature on load")), detectBtn), status, live),
      el("div", { class: "osg-section" }, el("h4", {}, "Clips"), clipList,
        el("div", { class: "osg-row" }, el("span", { class: "osg-muted" }, "Split at measure"), splitMeasure, splitBtn, splitHere, mergeBtn),
        el("div", { class: "osg-muted" }, "Clips also show as a lane on the grid: click to select (Shift+click adds), drag to move (follows the sequencer's grid setting, like notes; hold Alt while dragging to move freely), double-click to split there. Alt+S splits at the playhead; Shift+Alt+S merges the selected clips (pieces that were split apart are re-joined; anything else is rendered together as placed).")),
      el("div", { class: "osg-section" }, el("h4", {}, "Playback"),
        el("label", { class: "osg-row" }, enable, el("span", {}, "Play with the sequencer")),
        el("label", { class: "osg-row" }, showLane, el("span", {}, "Show clips on the grid")),
        el("div", { class: "osg-row" }, preview, previewM),
        el("div", { class: "osg-sliders" }, el("label", { class: "osg-slider-row" }, el("span", { class: "osg-slider-label" }, "Volume"), vol, volVal))),
      guideBox);
  }


  /* ================= Chords tab: chord progression generator / randomizer, previewed on the piano roll ================= */
  const CH_SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], harmonic: [0, 2, 3, 5, 7, 8, 11], dorian: [0, 2, 3, 5, 7, 9, 10], mixolydian: [0, 2, 4, 5, 7, 9, 10] };
  const CH_SCALE_LABEL = { major: "Major", minor: "Minor", harmonic: "Harmonic minor", dorian: "Dorian", mixolydian: "Mixolydian" };
  // [id, label, scale degrees (0 = tonic), options]
  const CH_PRESETS = [
    ["pop", "Pop · I V vi IV", [0, 4, 5, 3]],
    ["fifties", "50s · I vi IV V", [0, 5, 3, 4]],
    ["emotional", "Emotional · vi IV I V", [5, 3, 0, 4]],
    ["royal", "Royal road · IV V iii vi", [3, 4, 2, 5]],
    ["canon", "Canon · 8 chords", [0, 4, 5, 2, 3, 0, 3, 4]],
    ["epic", "Epic · i VI III VII", [0, 5, 2, 6], { scale: "minor" }],
    ["andalusian", "Andalusian · i VII VI V", [0, 6, 5, 4], { scale: "minor" }],
    ["jazz", "Jazz · ii V I", [1, 4, 0, 0], { type: "sevenths" }],
    ["lofi", "Lo-fi · ii7 V7 I7 vi7", [1, 4, 0, 5], { type: "sevenths" }],
    ["blues", "12-bar blues", [0, 0, 0, 0, 3, 3, 0, 0, 4, 3, 0, 4], { dominant: true, scale: "major" }],
  ];
  // where a chord on each degree likes to go next (functional harmony, major-key view; works for minor modes too)
  const CH_NEXT = {
    0: [[3, 3], [4, 2.5], [5, 3], [1, 1.5], [2, 0.6]],
    1: [[4, 6], [6, 0.8], [3, 1], [5, 0.6]],
    2: [[5, 4], [3, 3], [1, 1]],
    3: [[4, 3.5], [0, 2.5], [1, 1.5], [5, 1.5], [6, 0.4]],
    4: [[0, 5], [5, 3], [3, 1.5]],
    5: [[3, 3.5], [1, 3], [4, 2], [2, 1]],
    6: [[0, 7], [2, 2]],
  };
  const CH_RHYTHMS = [["block", "Held chords"], ["half", "Two hits per chord"], ["pulse", "8th-note pulse"], ["offbeat", "Off-beat stabs"], ["arp", "Arpeggio up"], ["arpud", "Arpeggio up & down"], ["strum", "Strum"]];
  const CH_TYPES = [["triads", "Triads"], ["sevenths", "7th chords"], ["mixed", "Mixed (some 7ths)"], ["add9", "add9"], ["sus", "Sus (some sus2/sus4)"]];
  const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];
  const pick = (weighted) => { const tot = weighted.reduce((s, w) => s + w[1], 0); let r = Math.random() * tot; for (const [v, w] of weighted) { if ((r -= w) <= 0) return v; } return weighted[weighted.length - 1][0]; };
  const midiName = (m) => NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
  const pianoRange = () => { const names = (typeof piano !== "undefined" && piano.length) ? piano : null; return names ? names : null; };

  const chordGen = {
    root: 0, scale: "major", preset: "pop", degrees: [0, 4, 5, 3], flags: [], type: "triads", rhythm: "block", voicing: "smooth",
    octave: 4, bass: true, perBar: 1, start: 1, raiseV: true, dominant: false, events: [], chords: [], show: true, canvas: null,
  };
  // the chord on scale degree `deg` → { pcs: semitones above the tonic (root first), name, roman }
  function buildChord(deg, flag) {
    const g = chordGen, sc = CH_SCALES[g.scale], st = (i) => sc[i % 7] + 12 * Math.floor(i / 7);
    let tones = [st(deg), st(deg + 2), st(deg + 4)];
    const want7 = g.type === "sevenths" || (g.type === "mixed" && flag === "7"), want9 = g.type === "add9";
    if (g.dominant) { const r = st(deg); tones = [r, r + 4, r + 7]; if (want7 || g.type === "triads") tones.push(r + 10); }
    else {
      if ((g.scale === "minor" || g.scale === "dorian") && deg === 4 && g.raiseV) tones[1] += 1;   // major V for a real cadence
      if (g.type === "sus" && flag === "sus2") tones[1] = st(deg + 1);
      if (g.type === "sus" && flag === "sus4") tones[1] = st(deg + 3);
      if (want7) { let s7 = st(deg + 6); if ((g.scale === "minor" || g.scale === "dorian") && deg === 4 && g.raiseV) s7 = st(deg) + 10; tones.push(s7); }
      if (want9) tones.push(st(deg + 1) + 12);
    }
    const r = tones[0], i3 = tones[1] - r, i5 = tones[2] - r, i7 = tones[3] != null && !want9 ? tones[3] - r : null;
    let q = i3 === 4 ? (i5 === 8 ? "aug" : "") : i3 === 3 ? (i5 === 6 ? "dim" : "m") : i3 === 2 ? "sus2" : i3 === 5 ? "sus4" : "";
    if (i7 != null) q = q === "" ? (i7 === 11 ? "maj7" : "7") : q === "m" ? (i7 === 10 ? "m7" : "m(maj7)") : q === "dim" ? (i7 === 10 ? "m7♭5" : "dim7") : q + "7";
    if (want9) q += "add9";
    const minorish = i3 === 3, rn = ROMAN[deg] , roman = (minorish ? rn.toLowerCase() : rn) + (i5 === 6 ? "°" : i5 === 8 ? "+" : "") + (i7 != null ? "7" : "");
    return { pcs: tones, name: NOTE_NAMES[(g.root + r) % 12] + q, roman, deg };
  }
  function chordFlag() { const t = chordGen.type; return t === "mixed" ? (Math.random() < 0.45 ? "7" : "") : t === "sus" ? (Math.random() < 0.4 ? (Math.random() < 0.5 ? "sus2" : "sus4") : "") : ""; }
  function randomProgression(len) {
    const minorish = chordGen.scale !== "major" && chordGen.scale !== "mixolydian";
    const out = [Math.random() < (minorish ? 0.8 : 0.75) ? 0 : 5];
    while (out.length < len) {
      const prev = out[out.length - 1];
      let next = pick(CH_NEXT[prev]);
      if (out.length === len - 1 && Math.random() < 0.6) next = pick([[4, 3], [3, 1.5], [6, minorish ? 0.6 : 0.2]]);   // set up the loop back to the start
      if (next === prev && Math.random() < 0.8) next = pick(CH_NEXT[prev]);
      out.push(next);
    }
    return out;
  }
  // place each chord's notes: smooth voice-leading keeps notes close to the previous chord
  function voiceProgression() {
    const g = chordGen, lo = 36, hi = 107, center = 12 * (g.octave + 1) + 4;
    let prev = null;
    return g.chords.map((ch) => {
      const pcs = ch.pcs.map((p) => ((g.root + p) % 12 + 12) % 12), n = pcs.length, cands = [];
      for (let inv = 0; inv < n; inv++) {
        for (let o = g.octave - 2; o <= g.octave + 1; o++) {
          const notes = []; let m = 12 * (o + 1) + pcs[inv];
          for (let i = 0; i < n; i++) { const pc = pcs[(inv + i) % n]; if (i > 0) { m += ((pc - (m % 12)) + 12) % 12 || 12; } notes.push(m); }
          if (g.voicing === "open" && notes.length >= 3) notes[1] += 12;
          if (g.voicing === "spread" && notes.length >= 3) { notes[1] += 12; notes[notes.length - 1] += 12; }
          notes.sort((a, b) => a - b);
          if (notes[0] < lo || notes[notes.length - 1] > hi) continue;
          const mean = notes.reduce((s, x) => s + x, 0) / n;
          let cost = Math.abs(mean - center) * (g.voicing === "smooth" && prev ? 0.35 : 1);
          if (g.voicing === "smooth" && prev) { for (let i = 0; i < n; i++) cost += Math.abs(notes[i] - prev[Math.min(i, prev.length - 1)]); }
          else if (g.voicing !== "smooth" && inv !== 0) cost += 12;   // close / open / spread voicings stay in root position
          cands.push({ notes, cost });
        }
      }
      cands.sort((a, b) => a.cost - b.cost);
      const notes = cands.length ? cands[0].notes : pcs.map((p) => center - 4 + p);
      prev = notes;
      let bass = null;
      if (g.bass) { bass = 12 * (g.octave) + pcs[0]; while (bass >= notes[0] - 4) bass -= 12; while (bass < lo) bass += 12; if (bass >= notes[0]) bass = null; }
      return { notes, bass };
    });
  }
  function rhythmEvents(kind, L, notes, bass) {
    const ev = [], add = (t, len, m, vol) => { if (len > 0 && t < L) ev.push({ t, len: Math.min(len, L - t), midi: m, vol }); };
    if (kind === "half" && L >= 8) { for (const t of [0, L / 2]) notes.forEach((m) => add(t, L / 2, m, 0.8)); }
    else if (kind === "pulse") { for (let t = 0; t < L; t += 2) notes.forEach((m) => add(t, 2, m, t % 4 === 0 ? 0.8 : 0.65)); }
    else if (kind === "offbeat") { for (let t = 2; t < L; t += 4) notes.forEach((m) => add(t, 2, m, 0.75)); }
    else if (kind === "arp" || kind === "arpud") {
      const up = notes.concat([notes[0] + 12]), seq = kind === "arp" ? up : up.concat(up.slice(1, -1).reverse());
      for (let i = 0, t = 0; t < L; i++, t += 2) add(t, 2, seq[i % seq.length], 0.75);
    }
    else if (kind === "strum") { notes.forEach((m, i) => add(i * 0.25, L - i * 0.25, m, 0.8)); }
    else notes.forEach((m) => add(0, L, m, 0.8));
    if (bass != null) { if (kind === "pulse" || kind === "offbeat") { for (let t = 0; t < L; t += 4) add(t, 4, bass, 0.9); } else add(0, L, bass, 0.9); }
    return ev;
  }
  function computeChordEvents() {
    const g = chordGen, bar = 4 * timeSig(), L = bar / g.perBar, start = (Math.max(1, g.start) - 1) * bar, names = pianoRange();
    const voiced = voiceProgression();
    g.events = [];
    voiced.forEach((v, i) => {
      for (const e of rhythmEvents(g.rhythm, L, v.notes, v.bass)) {
        const name = midiName(e.midi);
        if (names && names.indexOf(name) < 0) continue;
        g.events.push({ time: start + i * L + e.t, len: e.len, name, vol: e.vol, chord: i });
      }
    });
    g.span = { start, L, count: voiced.length };
    drawChordPreview();
  }
  function setChords(degrees, flags) { chordGen.degrees = degrees; chordGen.flags = flags || degrees.map(() => chordFlag()); chordGen.chords = degrees.map((d, i) => buildChord(d, chordGen.flags[i])); computeChordEvents(); chordGen.onChange && chordGen.onChange(); }
  function rebuildChords() { setChords(chordGen.degrees, chordGen.flags); }

  // ---- preview overlay on the piano roll ----
  function chordCanvas() {
    const host = document.getElementById("sequencer_inner"), main = document.getElementById("sequencer_main"); if (!host || !main) return null;
    if (!chordGen.canvas) {
      chordGen.canvas = el("canvas", { id: "osg-chord-preview" }); host.appendChild(chordGen.canvas);
      main.addEventListener("scroll", () => drawChordPreview(), { passive: true }); addEventListener("resize", () => drawChordPreview());
      let lw = 0, lh = 0, lts = 0; setInterval(() => { if (chordGen.show && chordGen.events.length && (noteWidth !== lw || noteHeight !== lh || timeSig() !== lts)) { lw = noteWidth; lh = noteHeight; lts = timeSig(); computeChordEvents(); } }, 400);
    }
    return chordGen.canvas;
  }
  let chordRaf = 0;
  function drawChordPreview() {
    if (chordRaf) return;
    chordRaf = requestAnimationFrame(() => {
      chordRaf = 0;
      const cv = chordCanvas(); if (!cv) return;
      const g = chordGen, show = g.show && g.events.length && typeof noteWidth === "number";
      cv.style.display = show ? "block" : "none"; if (!show) return;
      const main = document.getElementById("sequencer_main"), W = main.clientWidth, H = main.clientHeight, sl = main.scrollLeft, st = main.scrollTop, dpr = devicePixelRatio || 1;
      cv.style.left = sl + "px"; cv.style.top = st + "px"; cv.style.width = W + "px"; cv.style.height = H + "px";
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      const c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, -sl * dpr, -st * dpr); c.clearRect(sl, st, W, H);
      const A = getComputedStyle(document.documentElement).getPropertyValue("--os-accent-rgb").trim() || "124, 92, 255", B = altColor(A);
      const names = pianoRange() || [];
      // chord spans: faint band + chord name at the top of the visible grid
      c.font = "bold 11px 'PT Sans', sans-serif"; c.textBaseline = "top";
      for (let i = 0; i < g.span.count; i++) {
        const x0 = (g.span.start + i * g.span.L) * noteWidth, x1 = x0 + g.span.L * noteWidth;
        if (x1 < sl || x0 > sl + W) continue;
        c.fillStyle = `rgba(${B},${i % 2 ? 0.05 : 0.09})`; c.fillRect(x0, st, x1 - x0, H);
        const ch = g.chords[i]; if (!ch) continue;
        const label = `${ch.name}  ${ch.roman}`, tw = c.measureText(label).width + 10;
        c.fillStyle = "rgba(12,12,20,0.85)"; c.beginPath(); c.roundRect(x0 + 3, st + 4, tw, 18, 5); c.fill();
        c.strokeStyle = `rgba(${B},0.9)`; c.lineWidth = 1; c.stroke();
        c.fillStyle = `rgb(${B})`; c.fillText(label, x0 + 8, st + 7);
      }
      for (const e of g.events) {
        const row = names.indexOf(e.name); if (row < 0) continue;
        const x = e.time * noteWidth, y = row * noteHeight, w = Math.max(3, e.len * noteWidth - 2);
        if (x + w < sl || x > sl + W || y + noteHeight < st || y > st + H) continue;
        c.fillStyle = `rgba(${B},0.42)`; c.beginPath(); c.roundRect(x + 1, y + 1.5, w, noteHeight - 3, 3); c.fill();
        c.setLineDash([4, 3]); c.strokeStyle = `rgba(${B},0.95)`; c.lineWidth = 1.2; c.stroke(); c.setLineDash([]);
      }
    });
  }
  // ---- insert as real notes (one undo step) and audition ----
  function insertChords() {
    const g = chordGen;
    if (typeof song === "undefined" || typeof Note === "undefined") { toast("Open the editor to add notes."); return 0; }
    const inst = typeof instrument !== "undefined" ? instrument : 0;
    const notes = g.events.map((e) => new Note(song, e.name, e.time, e.len, inst, e.vol));
    if (!notes.length) return 0;
    const doIt = () => { for (const n of notes) song.addNote(n, true); try { song.updateLoopTime(); } catch (e) {} try { selection.setNotes(notes); updateSelection(); } catch (e) {} try { SequencerView.repaint(typeof kRepaintNotesMoved !== "undefined" ? kRepaintNotesMoved : undefined); } catch (e) {} };
    const undoIt = () => { try { song.removeNotes(notes); } catch (e) { for (const n of notes) try { song.removeNote(n); } catch (e2) {} } try { selection.clear(); updateSelection(); } catch (e) {} try { song.updateLoopTime(); SequencerView.repaint(typeof kRepaintNotesMoved !== "undefined" ? kRepaintNotesMoved : undefined); } catch (e) {} };
    if (typeof exec === "function") exec(doIt, undoIt); else doIt();
    try { setConfirmExit(true); } catch (e) {}
    return notes.length;
  }
  function auditionChords() {
    const g = chordGen; if (typeof playNote !== "function" || !g.events.length) { toast("Open the editor to hear chords."); return; }
    const inst = typeof instrument !== "undefined" ? instrument : 0, unitSec = (typeof song !== "undefined" && song.sleepTime ? song.sleepTime : 60000 / (baseBpm() * 4)) / 1000;
    for (const e of g.events) { try { playNote(inst, e.name, e.len, (e.time - g.span.start) * unitSec, false, e.vol); } catch (err) {} }
  }
  // the sequence's key: the editor's Key menu if set, else analyze the notes, else C major
  function sequenceKey() {
    const ks = document.getElementById("key_select");
    const m = ks && ks.value && ks.value.match(/^([A-G]#?)\s+(Major|Minor)$/i);
    if (m) return { root: NOTE_NAMES.indexOf(m[1]), scale: m[2].toLowerCase() === "minor" ? "minor" : "major", from: "the Key menu" };
    const res = detectKeyFromSequence();
    if (res && res.keys && res.keys.length && res.count >= 8) return { root: res.keys[0].tonic, scale: res.keys[0].mode, from: "your notes" };
    return null;
  }

  function buildChords() {
    const g = chordGen;
    try { Object.assign(g, prefs.chords || {}); } catch (e) {}
    const save = () => savePref("chords", { root: g.root, scale: g.scale, type: g.type, rhythm: g.rhythm, voicing: g.voicing, octave: g.octave, bass: g.bass, perBar: g.perBar, raiseV: g.raiseV, show: g.show });
    const sel = (opts, value, onChange) => { const s = el("select", { class: "osg-select" }, ...opts.map(([v, l]) => el("option", { value: v }, l))); s.value = String(value); s.addEventListener("change", () => { onChange(s.value); save(); rebuildChords(); }); return s; };
    const rootSel = sel(NOTE_NAMES.map((n, i) => [i, n]), g.root, (v) => (g.root = +v));
    const scaleSel = sel(Object.entries(CH_SCALE_LABEL), g.scale, (v) => (g.scale = v));
    const keyNote = el("span", { class: "osg-muted" });
    const useSeqKey = el("button", { class: "osg-btn osg-ghost", onclick: () => { const k = sequenceKey(); if (!k) { keyNote.textContent = "Couldn't tell — set the Key menu or add some notes first."; return; } g.root = k.root; g.scale = k.scale; rootSel.value = String(k.root); scaleSel.value = k.scale; keyNote.textContent = `From ${k.from}.`; save(); rebuildChords(); } }, "Use sequence key");
    const presetRow = el("div", { class: "osg-row osg-chips" }, ...CH_PRESETS.map(([id, label, degs, opt]) => el("button", { class: "osg-chip osg-chpreset", "data-p": id, onclick: () => {
      g.preset = id; g.dominant = !!(opt && opt.dominant);
      if (opt && opt.scale && opt.scale !== g.scale && !(opt.scale === "minor" && g.scale !== "major" && g.scale !== "mixolydian")) { g.scale = opt.scale; scaleSel.value = g.scale; }
      if ((opt && opt.type) || g.presetType) { g.type = (opt && opt.type) || "triads"; typeSel.value = g.type; }   // jazz/lo-fi bring 7ths; leaving them goes back to triads
      g.presetType = !!(opt && opt.type);
      presetRow.querySelectorAll(".osg-chpreset").forEach((b) => b.classList.toggle("active", b.dataset.p === id));
      save(); setChords(degs.slice());
    } }, label)));
    const lenSel = el("select", { class: "osg-select" }, ...[4, 8, 12, 16].map((n) => el("option", { value: n }, `${n} chords`)));
    const randomBtn = el("button", { class: "osg-btn", onclick: () => { g.preset = "random"; g.dominant = false; presetRow.querySelectorAll(".osg-chpreset").forEach((b) => b.classList.remove("active")); setChords(randomProgression(+lenSel.value)); } }, "🎲 Randomize");
    const chordList = el("div", { class: "osg-chord-list" });
    const typeSel = sel(CH_TYPES, g.type, (v) => (g.type = v));
    const rhythmSel = sel(CH_RHYTHMS, g.rhythm, (v) => (g.rhythm = v));
    const voicingSel = sel([["smooth", "Smooth (close movement)"], ["close", "Close, root position"], ["open", "Open"], ["spread", "Wide spread"]], g.voicing, (v) => (g.voicing = v));
    const octSel = sel([2, 3, 4, 5, 6].map((o) => [o, `Around C${o}`]), g.octave, (v) => (g.octave = +v));
    const perBarSel = sel([[1, "1 chord per bar"], [2, "2 chords per bar"], [4, "4 chords per bar"]], g.perBar, (v) => (g.perBar = +v));
    const bassCb = el("input", { type: "checkbox" }); bassCb.checked = g.bass; bassCb.addEventListener("change", () => { g.bass = bassCb.checked; save(); rebuildChords(); });
    const raiseCb = el("input", { type: "checkbox" }); raiseCb.checked = g.raiseV; raiseCb.addEventListener("change", () => { g.raiseV = raiseCb.checked; save(); rebuildChords(); });
    const startIn = el("input", { type: "number", min: 1, step: 1, value: g.start, class: "osg-num" }); startIn.addEventListener("change", () => { g.start = Math.max(1, Math.round(+startIn.value || 1)); startIn.value = g.start; rebuildChords(); });
    const atPlayhead = el("button", { class: "osg-btn osg-ghost", onclick: () => { if (typeof playTime !== "number") return; g.start = 1 + Math.floor(playTime / (4 * timeSig())); startIn.value = g.start; rebuildChords(); } }, "At playhead");
    const showCb = el("input", { type: "checkbox" }); showCb.checked = g.show; showCb.addEventListener("change", () => { g.show = showCb.checked; save(); drawChordPreview(); });
    const instLabel = el("span", { class: "osg-muted" });
    const status = el("div", { class: "osg-muted" });
    const hear = el("button", { class: "osg-btn osg-ghost", onclick: auditionChords }, "▶ Hear it");
    const insert = el("button", { class: "osg-btn", onclick: () => { const n = insertChords(); if (n) { status.textContent = `Added ${n} notes at measure ${g.start} — Ctrl+Z undoes it.`; toast(`Added ${g.chords.length} chords (${n} notes)`); g.show = false; showCb.checked = false; drawChordPreview(); } } }, "Add to sequence");
    const clearBtn = el("button", { class: "osg-btn osg-ghost", onclick: () => { g.events = []; g.chords = []; g.degrees = []; chordList.innerHTML = ""; drawChordPreview(); status.textContent = "Preview cleared."; } }, "Clear");
    g.onChange = () => {
      chordList.innerHTML = "";
      g.chords.forEach((ch, i) => {
        const chip = el("button", { class: "osg-chord", title: "Click to swap this chord for another that fits" }, el("b", {}, ch.name), el("span", {}, ch.roman));
        chip.addEventListener("click", () => {
          const prev = g.degrees[i - 1], opts = (prev != null ? CH_NEXT[prev] : [[0, 1], [3, 1], [4, 1], [5, 1]]).filter(([d]) => d !== g.degrees[i]);
          const degs = g.degrees.slice(), flags = g.flags.slice(); degs[i] = opts.length ? pick(opts) : (g.degrees[i] + 3) % 7; flags[i] = chordFlag(); setChords(degs, flags);
        });
        chordList.append(chip);
      });
      let instName = ""; try { instName = getInstrumentName(song, instrument); } catch (e) { try { instName = settings.instruments && typeof instrument !== "undefined" ? `instrument ${instrument}` : ""; } catch (e2) {} }
      instLabel.textContent = instName ? `adds to: ${String(instName).replace(/<[^>]+>/g, "")}` : "";
      status.textContent = g.events.length ? `${g.chords.length} chords · ${g.events.length} notes · measures ${g.start}–${g.start + Math.ceil(g.chords.length / g.perBar) - 1}. The dashed notes on the piano roll are a preview.` : "";
    };
    // first run: follow the sequence key if there is one, start from a pop progression
    setTimeout(() => { const k = sequenceKey(); if (k && !prefs.chords) { g.root = k.root; g.scale = k.scale; rootSel.value = String(k.root); scaleSel.value = k.scale; keyNote.textContent = `From ${k.from}.`; } }, 0);
    return el("div", { class: "osg-pane osg-hidden", "data-pane": "chords" },
      el("div", { class: "osg-section" }, el("h4", {}, "Key"), el("div", { class: "osg-row" }, rootSel, scaleSel, useSeqKey), keyNote),
      el("div", { class: "osg-section" }, el("h4", {}, "Progression"), presetRow,
        el("div", { class: "osg-row" }, randomBtn, lenSel, el("span", { class: "osg-muted" }, "or pick a preset above")),
        chordList, el("div", { class: "osg-muted" }, "Click a chord to swap it for another one that fits.")),
      el("div", { class: "osg-section" }, el("h4", {}, "Sound"),
        el("div", { class: "osg-grid2" }, el("label", {}, "Chords", typeSel), el("label", {}, "Rhythm", rhythmSel), el("label", {}, "Voicing", voicingSel), el("label", {}, "Register", octSel), el("label", {}, "Length", perBarSel)),
        el("label", { class: "osg-row" }, bassCb, el("span", {}, "Add a bass note")),
        el("label", { class: "osg-row" }, raiseCb, el("span", {}, "Major V chord in minor keys"))),
      el("div", { class: "osg-section" }, el("h4", {}, "Place"),
        el("div", { class: "osg-row" }, el("span", { class: "osg-muted" }, "Start at measure"), startIn, atPlayhead),
        el("label", { class: "osg-row" }, showCb, el("span", {}, "Preview on the piano roll")),
        el("div", { class: "osg-row" }, insert, hear, clearBtn, instLabel), status));
  }

  /* ================= Settings tab (theme settings, on the page) ================= */
  // Settings live in the extension's storage. content.js (the extension side) sends the current values
  // as JSON in an "osg-settings-changed" event, and accepts "osg-set" events with {key, value} JSON.
  T.settings = { accent: "#7c5cff", style: "glow", tint: 1, animations: true, hideAds: true, gridTheme: true, myNameColor: "", meUid: "", meName: "" };
  document.addEventListener("osg-settings-changed", (e) => { try { if (typeof e.detail === "string") { Object.assign(T.settings, JSON.parse(e.detail)); renderSettings && renderSettings(); } } catch (err) {} });
  function setSetting(key, value) { T.settings[key] = value; document.dispatchEvent(new CustomEvent("osg-set", { detail: JSON.stringify({ key, value }) })); renderSettings && renderSettings(); }
  let renderSettings = null;
  function buildSettings() {
    const STYLES = [["glow", "Glow", "linear-gradient(135deg,#20202c,#2a2a3a)"], ["midnight", "Midnight", "linear-gradient(135deg,#000,#15151b)"], ["slate", "Slate", "linear-gradient(135deg,#2a303a,#3e4654)"], ["glass", "Glass", "linear-gradient(135deg,rgba(124,92,255,.45),rgba(40,40,70,.6))"], ["neon", "Neon", "linear-gradient(135deg,#050508,#1a1030)"]];
    const COLORS = [["#7c5cff", "Violet"], ["#00d4ff", "Cyan"], ["#ff3d81", "Pink"], ["#39ff88", "Green"], ["#ffb02e", "Amber"], ["#ff4d4d", "Red"]];
    const styles = el("div", { class: "osg-styles" }, ...STYLES.map(([id, label, bg]) => el("button", { class: "osg-style", "data-style": id, onclick: () => setSetting("style", id) }, el("i", { style: `background:${bg}` }), el("span", {}, label))));
    const swatches = el("div", { class: "osg-swatches" }, ...COLORS.map(([c, label]) => el("button", { class: "osg-swatch", "data-color": c, title: label, style: `--c:${c}`, onclick: () => setSetting("accent", c) })));
    const custom = el("input", { type: "color", class: "osg-color" }); custom.addEventListener("input", () => setSetting("accent", custom.value));
    const tint = el("input", { type: "range", min: 0, max: 2, step: 0.05, class: "osg-slider" }); const tintVal = el("span", { class: "osg-slider-val" });
    tint.addEventListener("input", () => { tintVal.textContent = Math.round(tint.value * 100) + "%"; setSetting("tint", +tint.value); });
    const toggle = (key, label, hint) => { const cb = el("input", { type: "checkbox" }); cb.addEventListener("change", () => setSetting(key, cb.checked)); cb._key = key; return el("label", { class: "osg-row osg-toggle-row" }, cb, el("span", {}, label, hint ? el("small", { class: "osg-muted" }, " " + hint) : null)); };
    const toggles = el("div", {}, toggle("gridTheme", "Dark note grid", "theme the editor grid and keys"), toggle("hideAds", "Hide ad banners"), toggle("animations", "Glow animations", "hover transitions and pulses"));
    // your own username color (others always keep the site's colors)
    const nameColor = el("input", { type: "color", class: "osg-color" });
    nameColor.addEventListener("input", () => setSetting("myNameColor", nameColor.value));
    const nameReset = el("button", { class: "osg-btn osg-ghost", onclick: () => setSetting("myNameColor", "") }, "Use site color");
    const namePreview = el("span", { class: "osg-name-preview" });
    const nameHint = el("div", { class: "osg-muted" });
    renderSettings = () => {
      const s = T.settings;
      styles.querySelectorAll(".osg-style").forEach((b) => b.classList.toggle("active", b.dataset.style === s.style));
      swatches.querySelectorAll(".osg-swatch").forEach((b) => b.classList.toggle("active", b.dataset.color.toLowerCase() === String(s.accent).toLowerCase()));
      if (document.activeElement !== custom) custom.value = s.accent;
      if (document.activeElement !== tint) tint.value = s.tint ?? 1; tintVal.textContent = Math.round((s.tint ?? 1) * 100) + "%";
      toggles.querySelectorAll("input").forEach((cb) => { cb.checked = s[cb._key] !== false; });
      if (document.activeElement !== nameColor) nameColor.value = s.myNameColor || "#039be5";
      namePreview.textContent = s.meName || "your name"; namePreview.style.color = s.myNameColor || "";
      nameReset.disabled = !s.myNameColor;
      nameHint.textContent = s.meName
        ? `Signed in as ${s.meName}. Recolors your name in comments, chat, the forum and profile links — only you see it. Everyone else keeps the site's own colors (custom name colors included).`
        : "Log in on onlinesequencer.net once so the extension knows which name is yours. Everyone else keeps the site's own colors.";
    };
    renderSettings();
    document.dispatchEvent(new CustomEvent("osg-request-settings"));
    return el("div", { class: "osg-pane osg-hidden", "data-pane": "settings" },
      el("div", { class: "osg-section" }, el("h4", {}, "Style"), styles),
      el("div", { class: "osg-section" }, el("h4", {}, "Accent color"), swatches, el("label", { class: "osg-row" }, custom, el("span", { class: "osg-muted" }, "Custom color"))),
      el("div", { class: "osg-section" }, el("h4", {}, "Tint & glow strength"), el("div", { class: "osg-sliders" }, el("label", { class: "osg-slider-row" }, el("span", { class: "osg-slider-label" }, "Strength"), tint, tintVal)), el("div", { class: "osg-muted" }, "Scales every accent glow and tint, including the grid lines. 0% = flat dark theme, 200% = full neon.")),
      el("div", { class: "osg-section" }, el("h4", {}, "Your username color"), el("div", { class: "osg-row" }, nameColor, namePreview, nameReset), nameHint),
      el("div", { class: "osg-section" }, el("h4", {}, "Options"), toggles));
  }

  /* ================= Stems tab: DSP stem isolation (harmonic/percussive + center/band extraction) ================= */
  // Runs in a Web Worker. Not an AI separator — expect some bleed — but useful for picking out parts to transcribe.
  const STEM_WORKER = String.raw`
    function fft(re, im) {
      const n = re.length;
      for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
        if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
      for (let len = 2; len <= n; len <<= 1) { const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
        for (let i = 0; i < n; i += len) { let cr = 1, ci = 0;
          for (let j = 0; j < len / 2; j++) { const a = i + j, b = a + len / 2;
            const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
            re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
            const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr; } } }
    }
    function ifft(re, im) { fft(im, re); const n = re.length; for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; } }
    function median(a, n) { // insertion sort of n values, returns the middle one
      for (let i = 1; i < n; i++) { const v = a[i]; let j = i - 1; while (j >= 0 && a[j] > v) { a[j + 1] = a[j]; j--; } a[j + 1] = v; }
      return a[n >> 1];
    }
    self.onmessage = function (e) {
      const { L, R, sr, part, strength, gate } = e.data;
      const N = 2048, hop = N / 4, bins = N / 2 + 1, len = L.length;
      const frames = Math.max(1, Math.ceil(len / hop) + 3);
      const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N); // Hann in + Hann out at 75% overlap sums to 1.5
      const OLA = 1 / 1.5;
      const re = new Float32Array(N), im = new Float32Array(N), re2 = new Float32Array(N), im2 = new Float32Array(N);
      const frameFFT = (src, t, r, i) => { const off = t * hop - 3 * hop; for (let k = 0; k < N; k++) { const p = off + k; r[k] = (p >= 0 && p < len ? src[p] : 0) * win[k]; i[k] = 0; } fft(r, i); };
      const post = (p, s) => self.postMessage({ progress: p, status: s });

      /* ---- pass 1: mid-channel magnitude spectrogram + a compact "fingerprint" per frame (for finding repeats) ---- */
      const mag = new Float32Array(frames * bins);
      const NB = 48, bandLo = new Int32Array(NB), bandHi = new Int32Array(NB);
      for (let b = 0; b < NB; b++) { const f0 = 80 * Math.pow(100, b / NB), f1 = 80 * Math.pow(100, (b + 1) / NB); bandLo[b] = Math.max(1, Math.round(f0 * N / sr)); bandHi[b] = Math.max(bandLo[b], Math.round(f1 * N / sr)); }
      // The fingerprint used to find repeats is taken from the SIDE channel (L−R): the vocal/lead sits in the center, so the
      // side carries accompaniment only and matches are made on the backing, not on the lead. Mono input → low bands only.
      const feat = new Float32Array(frames * NB), featS = new Float32Array(frames * NB); let midE = 0, sideE = 0;
      const bandOf = new Int32Array(bins).fill(-1); for (let b = 0; b < NB; b++) for (let k = bandLo[b]; k <= bandHi[b]; k++) if (bandOf[k] < 0) bandOf[k] = b;
      for (let t = 0; t < frames; t++) {
        frameFFT(L, t, re, im); frameFFT(R, t, re2, im2);
        const row = t * bins, fo = t * NB;
        for (let b = 0; b < bins; b++) {
          const mr = (re[b] + re2[b]) / 2, mi = (im[b] + im2[b]) / 2, sr_ = (re[b] - re2[b]) / 2, si_ = (im[b] - im2[b]) / 2;
          const m = Math.sqrt(mr * mr + mi * mi), sm = Math.sqrt(sr_ * sr_ + si_ * si_); mag[row + b] = m; midE += m * m; sideE += sm * sm;
          const bb = bandOf[b]; if (bb >= 0) { feat[fo + bb] += m; featS[fo + bb] += sm; }
        }
        let n1 = 0, n2 = 0;
        for (let b = 0; b < NB; b++) { const v = Math.log1p(feat[fo + b]), w = Math.log1p(featS[fo + b]); feat[fo + b] = v; featS[fo + b] = w; n1 += v * v; n2 += w * w; }
        n1 = Math.sqrt(n1) || 1; n2 = Math.sqrt(n2) || 1; for (let b = 0; b < NB; b++) { feat[fo + b] /= n1; featS[fo + b] /= n2; }
        if (t % 400 === 0) post(0.3 * t / frames, "Analyzing spectrum…");
      }
      if (sideE > 0.01 * midE) feat.set(featS);
      else { const NBlow = 16; for (let t = 0; t < frames; t++) { let nn = 0; for (let b = 0; b < NB; b++) { if (b >= NBlow) feat[t * NB + b] = 0; nn += feat[t * NB + b] * feat[t * NB + b]; } nn = Math.sqrt(nn) || 1; for (let b = 0; b < NB; b++) feat[t * NB + b] /= nn; } }

      /* ---- repeating-background model (REPET-SIM): for each moment find the most similar moments elsewhere in the song
             and take the median spectrum across them → what repeats is accompaniment, what doesn't is the lead/vocal ---- */
      const B = 4, blocks = Math.ceil(frames / B), K = 20;
      const bf = new Float32Array(blocks * NB);
      for (let i = 0; i < blocks; i++) { let norm = 0; for (let b = 0; b < NB; b++) { let s = 0, n = 0; for (let t = i * B; t < Math.min(frames, (i + 1) * B); t++) { s += feat[t * NB + b]; n++; } s /= n || 1; bf[i * NB + b] = s; norm += s * s; } norm = Math.sqrt(norm) || 1; for (let b = 0; b < NB; b++) bf[i * NB + b] /= norm; }
      const matches = new Int32Array(blocks * K).fill(-1);
      const simTop = new Float32Array(K), idxTop = new Int32Array(K + 1);
      for (let i = 0; i < blocks; i++) {
        simTop.fill(-1); idxTop.fill(-1);
        const oi = i * NB;
        for (let j = 0; j < blocks; j++) {
          if (Math.abs(i - j) < 3) continue;
          const oj = j * NB; let s = 0;
          for (let b = 0; b < NB; b++) s += bf[oi + b] * bf[oj + b];
          if (s <= simTop[K - 1]) continue;
          let p = K - 1; while (p > 0 && simTop[p - 1] < s) { simTop[p] = simTop[p - 1]; idxTop[p] = idxTop[p - 1]; p--; }
          simTop[p] = s; idxTop[p] = j;
        }
        for (let k = 0; k < K; k++) matches[i * K + k] = simTop[k] > 0.6 ? idxTop[k] : -1;
        if (i % 200 === 0) post(0.3 + 0.2 * i / blocks, "Finding repeating parts…");
      }

      /* ---- per-bin frequency weights ---- */
      const freq = (b) => b * sr / N;
      const lowpass = new Float32Array(bins), band = new Float32Array(bins);
      for (let b = 0; b < bins; b++) {
        const f = freq(b);
        lowpass[b] = f < 150 ? 1 : f > 320 ? 0 : 1 - (f - 150) / 170;
        band[b] = f < 100 ? 0 : f < 200 ? (f - 100) / 100 : f <= 6000 ? 1 : f >= 12000 ? 0 : 1 - (f - 6000) / 6000;
      }

      /* ---- pass 2: per frame, harmonic/percussive masks (median filters), repeating mask, center mask → the chosen part ---- */
      const outL = new Float32Array(len), outR = new Float32Array(len);
      const KT = 13, KF = 13, HT = KT >> 1, HF = KF >> 1, tmp = new Float32Array(64);
      const H = new Float32Array(bins), P = new Float32Array(bins), REP = new Float32Array(bins);
      const pw = 1 + strength, q = 1.5 * strength;
      const soft = (g) => g <= gate ? 0 : (g - gate) / (1 - gate);   // "clean-up": anything below the gate is treated as bleed and dropped
      for (let t = 0; t < frames; t++) {
        const row = t * bins;
        // harmonic (smooth in time) vs percussive (smooth in frequency) estimates
        for (let b = 0; b < bins; b++) {
          for (let k = 0; k < KT; k++) { const tt = Math.min(frames - 1, Math.max(0, t - HT + k)); tmp[k] = mag[tt * bins + b]; }
          H[b] = median(tmp, KT);
        }
        for (let b = 0; b < bins; b++) {
          for (let k = 0; k < KF; k++) { const bb = Math.min(bins - 1, Math.max(0, b - HF + k)); tmp[k] = mag[row + bb]; }
          P[b] = median(tmp, KF);
        }
        // repeating background estimate for this frame
        const blk = Math.floor(t / B), o = t - blk * B; let nm = 0;
        for (let k = 0; k < K; k++) { const j = matches[blk * K + k]; if (j < 0) break; const tt = j * B + o; if (tt < frames) idxTop[nm++] = tt; }
        for (let b = 0; b < bins; b++) {
          if (nm < 3) { REP[b] = 1; continue; }
          let n = 0; tmp[n++] = mag[row + b]; for (let k = 0; k < nm; k++) tmp[n++] = mag[idxTop[k] * bins + b];
          const r = median(tmp, n), m = mag[row + b];
          REP[b] = m > 1e-9 ? Math.min(1, r / m) : 1;   // 1 = fully explained by repetition (background), 0 = unique (lead)
        }
        frameFFT(L, t, re, im); frameFFT(R, t, re2, im2);
        for (let b = 0; b < bins; b++) {
          const hp = Math.pow(H[b], pw), pp = Math.pow(P[b], pw);
          const mh = (hp + pp) > 1e-12 ? hp / (hp + pp) : 0.5;
          const Lr = re[b], Li = im[b], Rr = re2[b], Ri = im2[b];
          const Mr = (Lr + Rr) / 2, Mi = (Li + Ri) / 2, Sr = (Lr - Rr) / 2, Si = (Li - Ri) / 2;
          const m2 = Mr * Mr + Mi * Mi, s2 = Sr * Sr + Si * Si;
          const center = (m2 + s2) > 1e-12 ? Math.pow(m2 / (m2 + s2), q) : 0;
          const fg = Math.pow(1 - REP[b], Math.max(0.5, strength));   // non-repeating share
          const gv = soft(mh * band[b] * center * fg);                // vocal / lead share of the mid channel
          let oLr, oLi, oRr, oRi;
          if (part === "drums") { const g = soft(1 - mh); oLr = Lr * g; oLi = Li * g; oRr = Rr * g; oRi = Ri * g; }
          else if (part === "bass") { const g = soft(mh * lowpass[b]); oLr = Lr * g; oLi = Li * g; oRr = Rr * g; oRi = Ri * g; }
          else if (part === "vocals") { oLr = oRr = Mr * gv; oLi = oRi = Mi * gv; }
          else if (part === "lead") { const g = soft(mh * fg * (1 - lowpass[b])); oLr = Lr * g; oLi = Li * g; oRr = Rr * g; oRi = Ri * g; }
          else if (part === "other") { const g = soft(mh * (1 - band[b] * center * fg) * (1 - lowpass[b])); oLr = Lr * g; oLi = Li * g; oRr = Rr * g; oRi = Ri * g; }
          else { /* karaoke: full mix minus the vocal estimate */ oLr = Lr - Mr * gv; oLi = Li - Mi * gv; oRr = Rr - Mr * gv; oRi = Ri - Mi * gv; }
          re[b] = oLr; im[b] = oLi; re2[b] = oRr; im2[b] = oRi;
          if (b > 0 && b < bins - 1) { re[N - b] = oLr; im[N - b] = -oLi; re2[N - b] = oRr; im2[N - b] = -oRi; }
        }
        ifft(re, im); ifft(re2, im2);
        const off = t * hop - 3 * hop;
        for (let k = 0; k < N; k++) { const pos = off + k; if (pos >= 0 && pos < len) { outL[pos] += re[k] * win[k] * OLA; outR[pos] += re2[k] * win[k] * OLA; } }
        if (t % 100 === 0) post(0.5 + 0.5 * t / frames, "Separating…");
      }
      self.postMessage({ done: true, L: outL, R: outR }, [outL.buffer, outR.buffer]);
    };`;

  const stems = { worker: null, result: null, resultLabel: "", source: null, busy: false, cache: new Map() };
  function isolate(buffer, part, strength, gate, onProgress) {
    return new Promise((resolve, reject) => {
      if (stems.worker) { stems.worker.terminate(); stems.worker = null; }
      const w = new Worker(URL.createObjectURL(new Blob([STEM_WORKER], { type: "application/javascript" })));
      stems.worker = w;
      const L = buffer.getChannelData(0).slice(0), R = (buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : buffer.getChannelData(0)).slice(0);
      w.onmessage = (e) => {
        if (e.data.done) {
          const out = (T.ctx || (T.ctx = new AudioContext())).createBuffer(2, e.data.L.length, buffer.sampleRate);
          out.copyToChannel(e.data.L, 0); out.copyToChannel(e.data.R, 1);
          w.terminate(); stems.worker = null; resolve(out);
        } else if (onProgress) onProgress(e.data.progress, e.data.status);
      };
      w.onerror = (err) => { w.terminate(); stems.worker = null; reject(new Error(err.message || "Separation failed")); };
      w.postMessage({ L, R, sr: buffer.sampleRate, part, strength, gate }, [L.buffer, R.buffer]);
    });
  }
  function bufferToWav(buffer) {
    const ch = buffer.numberOfChannels, len = buffer.length, sr = buffer.sampleRate;
    const data = new DataView(new ArrayBuffer(44 + len * ch * 2));
    const str = (o, s) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)); };
    str(0, "RIFF"); data.setUint32(4, 36 + len * ch * 2, true); str(8, "WAVE"); str(12, "fmt "); data.setUint32(16, 16, true);
    data.setUint16(20, 1, true); data.setUint16(22, ch, true); data.setUint32(24, sr, true); data.setUint32(28, sr * ch * 2, true);
    data.setUint16(32, ch * 2, true); data.setUint16(34, 16, true); str(36, "data"); data.setUint32(40, len * ch * 2, true);
    const chans = []; for (let c = 0; c < ch; c++) chans.push(buffer.getChannelData(c));
    let o = 44;
    for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) { const v = Math.max(-1, Math.min(1, chans[c][i])); data.setInt16(o, v < 0 ? v * 32768 : v * 32767, true); o += 2; }
    return new Blob([data], { type: "audio/wav" });
  }
  let stemSource = null;
  // mix several AudioBuffers (same rate/length) into one — used for AI "Remove vocals" = drums + bass + other
  function sumBuffers(list) {
    const len = list[0].length, ch = 2, out = new AudioBuffer({ length: len, numberOfChannels: ch, sampleRate: list[0].sampleRate });
    for (let c = 0; c < ch; c++) { const d = out.getChannelData(c); for (const b of list) { const s = b.getChannelData(Math.min(c, b.numberOfChannels - 1)); for (let i = 0; i < len; i++) d[i] += s[i]; } }
    return out;
  }
  function buildStems() {
    const ALL_PARTS = [["vocals", "Vocals", "both"], ["lead", "Lead / solo", "dsp"], ["drums", "Drums", "both"], ["bass", "Bass", "both"], ["other", "Instruments", "both"], ["karaoke", "Remove vocals", "both"]];
    let part = "vocals", strength = 1, gate = 0.15, engine = prefs.stemsEngine || "ai", abort = null;
    const partRow = el("div", { class: "osg-row" }, ...ALL_PARTS.map(([id, label, eng]) => el("button", { class: "osg-chip osg-part" + (id === part ? " active" : ""), "data-part": id, "data-eng": eng, onclick: () => { part = id; partRow.querySelectorAll(".osg-part").forEach((b) => b.classList.toggle("active", b.dataset.part === id)); } }, label)));
    const srcSel = el("select", { class: "osg-select" }, el("option", { value: "file" }, "Chosen audio file"), el("option", { value: "imported" }, "Imported track (Track tab / site audio track)"));
    const engSel = el("select", { class: "osg-select" }, el("option", { value: "ai" }, "AI — HTDemucs (best, uses your GPU)"), el("option", { value: "dsp" }, "Fast — built-in signal processing"));
    engSel.value = engine;
    const strVal = el("span", { class: "osg-slider-val" }, "100%");
    const str = el("input", { type: "range", min: 0.5, max: 2, step: 0.05, value: 1, class: "osg-slider" });
    str.addEventListener("input", () => { strength = +str.value; strVal.textContent = Math.round(strength * 100) + "%"; });
    const gateVal = el("span", { class: "osg-slider-val" }, "15%");
    const gateIn = el("input", { type: "range", min: 0, max: 0.7, step: 0.05, value: gate, class: "osg-slider" });
    gateIn.addEventListener("input", () => { gate = +gateIn.value; gateVal.textContent = Math.round(gate * 100) + "%"; });
    const dspBox = el("div", {},
      el("div", { class: "osg-sliders" }, el("label", { class: "osg-slider-row" }, el("span", { class: "osg-slider-label" }, "Strength"), str, strVal), el("label", { class: "osg-slider-row" }, el("span", { class: "osg-slider-label" }, "Clean-up"), gateIn, gateVal)),
      el("div", { class: "osg-muted" }, "Strength = how hard the separation masks are pushed. Clean-up = how much faint leftover background is cut out (higher is cleaner but choppier)."));
    const engNote = el("div", { class: "osg-muted" });
    const status = el("div", { class: "osg-muted" });
    const bar = el("div", { class: "osg-progress" }, el("i", {}));
    const result = el("div", { class: "osg-result" });
    const applyEngine = () => {
      engine = engSel.value; savePref("stemsEngine", engine);
      dspBox.classList.toggle("osg-hidden", engine === "ai");
      partRow.querySelectorAll(".osg-part").forEach((b) => b.classList.toggle("osg-hidden", engine === "ai" && b.dataset.eng === "dsp"));
      if (engine === "ai" && part === "lead") partRow.querySelector('[data-part="vocals"]').click();
      engNote.textContent = engine === "ai"
        ? "Meta's HTDemucs model splits the song into vocals, drums, bass and instruments, running on your GPU. The first use downloads about 200 MB (kept in the browser afterwards). All four parts are made in one pass, so switching parts afterwards is instant."
        : "Built-in signal processing (harmonic/percussive split, repeating-background removal, center-channel extraction). Works offline and instantly, but leaves noticeably more bleed than the AI engine.";
      if (engine === "ai" && window.__osgML) window.__osgML.isDemucsCached().then((c) => { if (c && engine === "ai") engNote.textContent += " Model already downloaded."; });
    };
    engSel.addEventListener("change", applyEngine);
    const playBtn2 = el("button", { class: "osg-btn osg-ghost" }, "Play");
    playBtn2.addEventListener("click", () => {
      if (stemSource) { try { stemSource.stop(); } catch (e) {} stemSource = null; playBtn2.textContent = "Play"; return; }
      if (!stems.result) return;
      const ctx = refCtx(); stemSource = ctx.createBufferSource(); stemSource.buffer = stems.result; stemSource.connect(ctx.destination); stemSource.start(0);
      stemSource.onended = () => { stemSource = null; playBtn2.textContent = "Play"; }; playBtn2.textContent = "Stop";
    });
    const useRef = el("button", { class: "osg-btn osg-ghost", onclick: () => { if (!stems.result) return; refStop(); ref.buffer = stems.result; ref.name = stems.resultLabel; ref.file = null; ref.clips = []; ref.selected.clear(); (async () => { await autoTempo(() => {}); clipsChanged(); })(); addClip(1, 0, ref.buffer.duration); guide.enabled = true; savePref("guide", true); if (guide.checkbox) guide.checkbox.checked = true; guide.invalidate(); document.querySelectorAll('#osg-tools [data-pane="track"] .osg-file-name').forEach((n) => (n.textContent = `${ref.name} · ${ref.buffer.duration.toFixed(1)}s`)); toast("Stem pushed to the Track tab at measure 1 — note guide on"); showTab("track"); } }, "Use as reference track");
    const dl = el("button", { class: "osg-btn osg-ghost", onclick: () => { if (!stems.result) return; const a = el("a", { href: URL.createObjectURL(bufferToWav(stems.result)), download: stems.resultLabel.replace(/[^\w.-]+/g, "_") + ".wav" }); document.body.appendChild(a); a.click(); a.remove(); } }, "Download WAV");
    const actions = el("div", { class: "osg-row osg-hidden" }, playBtn2, useRef, dl);
    const fmtT = (s) => s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`;
    const run = el("button", { class: "osg-btn", onclick: async () => {
      if (stems.busy) { if (abort) abort.abort(); return; }
      let src;
      try {
        stems.busy = true; actions.classList.add("osg-hidden"); result.textContent = "";
        src = srcSel.value === "file" ? { buf: await getBuffer((s) => (status.textContent = s)), label: sharedFile.name } : (() => { const s = getImportedBuffer(); return { buf: s.buf, label: ref.name || "audio track" }; })();
        if (src.buf.duration > 900) throw new Error("That track is over 15 minutes — trim it first.");
        let out;
        if (engine === "ai") {
          if (!window.__osgML) throw new Error("The AI engine didn't load — reload the page.");
          const key = `ai|${src.label}|${src.buf.length}`;
          let all = stems.cache.get(key);
          if (!all) {
            abort = new AbortController(); run.textContent = "Cancel"; bar.style.display = "block"; bar.firstChild.style.width = "0%";
            all = await window.__osgML.separate(src.buf, { signal: abort.signal, onStatus: (s) => (status.textContent = s), onProgress: (p, eta) => { bar.firstChild.style.width = Math.round(p * 100) + "%"; status.textContent = `Separating on ${window.__osgML.demucsProvider() === "webgpu" ? "the GPU" : "the CPU (no WebGPU — slower)"}… ${Math.round(p * 100)}% · about ${fmtT(eta)} left`; } });
            stems.cache.set(key, all); if (stems.cache.size > 4) stems.cache.delete(stems.cache.keys().next().value);
          }
          out = part === "karaoke" ? sumBuffers([all.drums, all.bass, all.other]) : all[part];
        } else {
          const key = `${src.label}|${src.buf.length}|${part}|${strength}|${gate}`;
          out = stems.cache.get(key);
          if (!out) {
            bar.style.display = "block";
            out = await isolate(src.buf, part, strength, gate, (p, s) => { bar.firstChild.style.width = Math.round(p * 100) + "%"; status.textContent = `${s} ${Math.round(p * 100)}%`; });
            stems.cache.set(key, out); if (stems.cache.size > 6) stems.cache.delete(stems.cache.keys().next().value);
          }
        }
        const label = ALL_PARTS.find((x) => x[0] === part)[1];
        stems.result = out; stems.resultLabel = `${label} - ${src.label.replace(/\.[^.]+$/, "")}`;
        status.textContent = `Done: ${label} from ${src.label}${engine === "ai" ? " (AI)" : ""}.`; bar.style.display = "none";
        result.append(el("div", { class: "osg-big" }, label), el("div", { class: "osg-muted" }, `${out.duration.toFixed(1)}s · play it, send it to the Track tab as a reference (the note guide works best on a single part), or save it as a WAV.`));
        actions.classList.remove("osg-hidden");
      } catch (e) { status.textContent = /cancel/i.test(e.message || "") ? "Cancelled." : (e.message || String(e)); bar.style.display = "none"; }
      finally { stems.busy = false; abort = null; run.textContent = "Isolate"; }
    } }, "Isolate");
    applyEngine();
    return el("div", { class: "osg-pane osg-hidden", "data-pane": "stems" },
      el("div", { class: "osg-section" }, el("h4", {}, "Source"), filePicker(), el("div", { class: "osg-row" }, el("span", { class: "osg-slider-label" }, "Analyze"), srcSel)),
      el("div", { class: "osg-section" }, el("h4", {}, "Engine"), engSel, engNote),
      el("div", { class: "osg-section" }, el("h4", {}, "Part to isolate"), partRow, dspBox,
        el("div", { class: "osg-row" }, run), bar, status, result, actions));
  }

  // ---- Visualizer tab ----
  let canvas, g, playBtn, fileSource = null;
  function buildVis() {
    canvas = el("canvas", { class: "osg-canvas" });
    g = canvas.getContext("2d");
    const modes = el("div", { class: "osg-row osg-modes" }, ...[["bars", "Bars"], ["wave", "Wave"], ["ring", "Ring"], ["mirror", "Mirror"]].map(([id, label]) =>
      el("button", { class: "osg-chip osg-mode" + (id === visMode ? " active" : ""), "data-mode": id, onclick: (e) => { visMode = id; panel.querySelectorAll(".osg-mode").forEach((m) => m.classList.toggle("active", m.dataset.mode === id)); } }, label)));
    playBtn = el("button", { class: "osg-btn osg-ghost", onclick: toggleFilePlayback }, "Play chosen file");
    const hint = el("div", { class: "osg-muted" }, "Reacts to whatever the site is playing — press ▶ in the sequencer, or play an audio file you picked in the BPM/Key tab.");
    const slider = (label, key, min, max, step, def, fmt) => {
      const val = el("span", { class: "osg-slider-val" });
      const input = el("input", { type: "range", min, max, step, value: prefs[key] ?? def, class: "osg-slider" });
      const upd = () => { val.textContent = fmt(+input.value); };
      input.addEventListener("input", () => { savePref(key, +input.value); upd(); });
      upd();
      return el("label", { class: "osg-slider-row" }, el("span", { class: "osg-slider-label" }, label), input, val);
    };
    const sliders = el("div", { class: "osg-sliders" },
      slider("Intensity", "gain", 0.3, 3, 0.05, 1, (v) => Math.round(v * 100) + "%"),
      slider("Smoothing", "smooth", 0.3, 0.95, 0.01, 0.82, (v) => Math.round(v * 100) + "%"));
    return el("div", { class: "osg-pane osg-hidden", "data-pane": "vis" }, canvas, el("div", { class: "osg-vis-controls" }, modes, sliders, el("div", { class: "osg-row" }, playBtn, el("button", { class: "osg-btn osg-ghost", onclick: toggleExpand }, "Fullscreen")), hint));
  }
  async function toggleFilePlayback() {
    if (fileSource) { try { fileSource.stop(); } catch (e) {} fileSource = null; playBtn.textContent = "Play chosen file"; return; }
    try {
      const buf = await getBuffer(() => {});
      const ctx = T.ctx; if (ctx.state === "suspended") await ctx.resume();
      fileSource = ctx.createBufferSource(); fileSource.buffer = buf; fileSource.connect(ctx.destination); fileSource.start(0);
      fileSource.onended = () => { fileSource = null; playBtn.textContent = "Play chosen file"; };
      playBtn.textContent = "Stop";
    } catch (e) { toast(e.message || String(e)); }
  }
  function accent() {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--os-accent-rgb").trim();
    return v || "124, 92, 255";
  }
  function activeAnalyser(freq) {
    let best = null, bestE = 0;
    for (const an of T.analysers.values()) {
      an.getByteFrequencyData(freq);
      let e = 0; for (let i = 0; i < 64; i++) e += freq[i];
      if (e > bestE) { bestE = e; best = an; }
    }
    return best;
  }
  const freqBuf = new Uint8Array(1024), timeBuf = new Uint8Array(2048);
  function draw() {
    raf = requestAnimationFrame(draw);
    if (!isOpen() || currentTab !== "vis") return;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== W * devicePixelRatio || canvas.height !== H * devicePixelRatio) { canvas.width = W * devicePixelRatio; canvas.height = H * devicePixelRatio; }
    g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    const A = accent();
    g.fillStyle = "rgba(10,10,16,0.35)"; g.fillRect(0, 0, W, H);
    const an = activeAnalyser(freqBuf);
    if (!an) {
      g.fillStyle = "rgba(255,255,255,0.35)"; g.font = "13px sans-serif"; g.textAlign = "center";
      g.fillText("Waiting for audio… press ▶ in the sequencer", W / 2, H / 2); return;
    }
    const gain = prefs.gain ?? 1, smooth = prefs.smooth ?? 0.82;
    if (an.smoothingTimeConstant !== smooth) for (const a of T.analysers.values()) a.smoothingTimeConstant = smooth;
    an.getByteFrequencyData(freqBuf); an.getByteTimeDomainData(timeBuf);
    if (gain !== 1) for (let i = 0; i < timeBuf.length; i++) timeBuf[i] = Math.max(0, Math.min(255, 128 + (timeBuf[i] - 128) * gain));
    const bins = freqBuf.length;
    const sample = (t) => { // log-spaced read, t in 0..1
      const idx = Math.min(bins - 1, Math.floor(Math.pow(bins, t * 0.93 + 0.07) - 1));
      return Math.min(1, freqBuf[Math.max(0, idx)] / 255 * gain);
    };
    if (visMode === "bars" || visMode === "mirror") {
      const n = Math.max(32, Math.floor(W / 7)), bw = W / n;
      for (let i = 0; i < n; i++) {
        const v = sample(i / n), h = Math.pow(v, 1.4) * (visMode === "mirror" ? H / 2 : H);
        const grad = g.createLinearGradient(0, H, 0, 0);
        grad.addColorStop(0, `rgba(${A},0.9)`); grad.addColorStop(1, `rgba(255,255,255,0.9)`);
        g.fillStyle = grad; g.shadowColor = `rgba(${A},0.8)`; g.shadowBlur = 12;
        if (visMode === "mirror") { g.fillRect(i * bw + 1, H / 2 - h, bw - 2, h); g.fillRect(i * bw + 1, H / 2, bw - 2, h); }
        else g.fillRect(i * bw + 1, H - h, bw - 2, h);
      }
      g.shadowBlur = 0;
    } else if (visMode === "wave") {
      g.lineWidth = 2.5; g.strokeStyle = `rgba(${A},1)`; g.shadowColor = `rgba(${A},0.9)`; g.shadowBlur = 16; g.beginPath();
      for (let i = 0; i < timeBuf.length; i++) { const x = i / timeBuf.length * W, y = H / 2 + (timeBuf[i] - 128) / 128 * H * 0.45; i ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke(); g.shadowBlur = 0;
    } else if (visMode === "ring") {
      const cx = W / 2, cy = H / 2, r0 = Math.min(W, H) * 0.22, n = 96;
      let bass = 0; for (let i = 0; i < 16; i++) bass += freqBuf[i]; bass = Math.min(1, bass / (16 * 255) * gain);
      g.beginPath(); g.arc(cx, cy, r0 * (0.9 + bass * 0.25), 0, Math.PI * 2);
      g.fillStyle = `rgba(${A},${0.15 + bass * 0.5})`; g.shadowColor = `rgba(${A},0.9)`; g.shadowBlur = 30 * bass + 10; g.fill();
      g.lineWidth = 3; g.lineCap = "round";
      for (let i = 0; i < n; i++) {
        const v = sample(i / n), ang = i / n * Math.PI * 2 - Math.PI / 2, len = r0 * 0.1 + Math.pow(v, 1.3) * Math.min(W, H) * 0.26;
        g.strokeStyle = `rgba(${A},${0.5 + v * 0.5})`; g.beginPath();
        g.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0); g.lineTo(cx + Math.cos(ang) * (r0 + len), cy + Math.sin(ang) * (r0 + len)); g.stroke();
      }
      g.shadowBlur = 0;
    }
  }

  /* ---- panel plumbing ---- */
  const isOpen = () => panel && !panel.classList.contains("osg-hidden");
  function showTab(id) {
    currentTab = id;
    panel.querySelectorAll(".osg-tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === id));
    panel.querySelectorAll(".osg-pane").forEach((p) => p.classList.toggle("osg-hidden", p.dataset.pane !== id));
    panel.classList.toggle("osg-vis", id === "vis");
  }
  function togglePanel(force) {
    if (!panel) { buildPanel(); if (prefs.docked && typeof sidebar !== "undefined") { toggleDock(); if (!raf) draw(); return; } }
    if (docked) { // docked: the nav link just brings the sidebar tab forward
      if (force === false) { undock(true); try { sidebar.remove(dockTab); } catch (e) {} return; }
      sidebar.open(dockTab, true); if (!raf) draw(); return;
    }
    const open = force !== undefined ? force : !isOpen();
    panel.classList.toggle("osg-hidden", !open);
    document.getElementById("osg-tools-link")?.parentElement.classList.toggle("active", open);
    if (open && !raf) draw();
    if (!open && expanded) toggleExpand();
  }
  function toggleExpand() { expanded = !expanded; panel.classList.toggle("osg-expanded", expanded); if (expanded) showTab("vis"); }
  function toast(msg) {
    let t = document.getElementById("osg-toast");
    if (!t) { t = el("div", { id: "osg-toast" }); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 2200);
  }
  function addNavLink() {
    const ul = document.querySelector("#nav ul"); if (!ul || document.getElementById("osg-tools-link")) return;
    const li = el("li", {}, el("a", { id: "osg-tools-link", href: "javascript:;", onclick: () => togglePanel() }, "Tools"));
    const li2 = el("li", {}, el("a", { id: "osg-settings-link", href: "javascript:;", onclick: () => { if (!panel || !isOpen() || currentTab !== "settings") { togglePanel(true); showTab("settings"); } else togglePanel(false); } }, "Settings"));
    const ad = document.getElementById("ad_container");
    if (ad) { ul.insertBefore(li, ad); ul.insertBefore(li2, ad); } else { ul.appendChild(li); ul.appendChild(li2); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addNavLink); else addNavLink();



  /* ================= Profile stats, play charts, subscriber tracker ================= */
  const num = (t) => Number(String(t || "").replace(/[^\d.]/g, "")) || 0;
  const fmtN = (n) => Math.round(n).toLocaleString();
  async function fetchStats(kind, id) {
    const r = await (window.__osgNet ? window.__osgNet.fetch : fetch)(`/ajax/get_stats.php?${kind}=${encodeURIComponent(id)}`, { credentials: "same-origin" }, 0);
    const j = await r.json(); return Object.entries(j).map(([label, value]) => ({ label, value: Number(value) || 0 }));
  }
  // Themed canvas line/area chart with hover readout
  function drawPlaysChart(canvas, data, opts = {}) {
    const dpr = devicePixelRatio || 1, W = canvas.clientWidth || 340, H = canvas.clientHeight || 200;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const g = canvas.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const A = (getComputedStyle(document.documentElement).getPropertyValue("--os-accent-rgb").trim() || "124, 92, 255");
    const pad = { l: 36, r: 12, t: 14, b: 24 }, iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const max = Math.max(1, ...data.map((d) => d.value)), n = data.length;
    const x = (i) => pad.l + (n > 1 ? i / (n - 1) : 0.5) * iw, y = (v) => pad.t + ih - (v / max) * ih;
    const hover = opts.hover;
    g.clearRect(0, 0, W, H);
    // grid
    g.strokeStyle = "rgba(255,255,255,0.07)"; g.lineWidth = 1; g.fillStyle = "rgba(255,255,255,0.45)"; g.font = "10px 'PT Sans', sans-serif"; g.textAlign = "right"; g.textBaseline = "middle";
    const steps = 4; for (let s = 0; s <= steps; s++) { const v = max * s / steps, yy = y(v); g.beginPath(); g.moveTo(pad.l, yy); g.lineTo(W - pad.r, yy); g.stroke(); g.fillText(fmtN(v), pad.l - 6, yy); }
    g.textAlign = "center"; g.textBaseline = "top";
    const every = Math.max(1, Math.ceil(n / 6)); for (let i = 0; i < n; i += every) g.fillText(data[i].label, x(i), H - pad.b + 6);
    if (n > 1) g.fillText(data[n - 1].label, x(n - 1), H - pad.b + 6);
    // smooth path
    const pts = data.map((d, i) => [x(i), y(d.value)]);
    const path = () => { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], cx = (x0 + x1) / 2; g.bezierCurveTo(cx, y0, cx, y1, x1, y1); } };
    path(); g.lineTo(pts[pts.length - 1][0], pad.t + ih); g.lineTo(pts[0][0], pad.t + ih); g.closePath();
    const grad = g.createLinearGradient(0, pad.t, 0, pad.t + ih); grad.addColorStop(0, `rgba(${A},0.45)`); grad.addColorStop(1, `rgba(${A},0.02)`); g.fillStyle = grad; g.fill();
    path(); g.strokeStyle = `rgba(${A},1)`; g.lineWidth = 2; g.shadowColor = `rgba(${A},0.8)`; g.shadowBlur = 10; g.stroke(); g.shadowBlur = 0;
    if (hover != null && data[hover]) {
      const [hx, hy] = pts[hover];
      g.strokeStyle = "rgba(255,255,255,0.25)"; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(hx, pad.t); g.lineTo(hx, pad.t + ih); g.stroke(); g.setLineDash([]);
      g.fillStyle = "#fff"; g.beginPath(); g.arc(hx, hy, 4, 0, Math.PI * 2); g.fill(); g.strokeStyle = `rgba(${A},1)`; g.lineWidth = 2; g.stroke();
      const label = `${data[hover].label}: ${fmtN(data[hover].value)} play${data[hover].value === 1 ? "" : "s"}`; g.font = "bold 11px 'PT Sans', sans-serif"; const tw = g.measureText(label).width + 12;
      let bx = Math.min(W - pad.r - tw, Math.max(pad.l, hx - tw / 2)), by = Math.max(2, hy - 30);
      g.fillStyle = "rgba(12,12,20,0.95)"; g.strokeStyle = `rgba(${A},0.7)`; g.lineWidth = 1; g.beginPath(); g.roundRect(bx, by, tw, 20, 6); g.fill(); g.stroke();
      g.fillStyle = "#fff"; g.textAlign = "left"; g.textBaseline = "middle"; g.fillText(label, bx + 6, by + 10);
    }
    canvas._osg = { pts, data, pad, iw };
  }
  function chartPanel(data, title) {
    const canvas = el("canvas", { class: "osg-chart" });
    const total = data.reduce((s, d) => s + d.value, 0), last7 = data.slice(-7).reduce((s, d) => s + d.value, 0), peak = data.reduce((b, d) => d.value > b.value ? d : b, data[0] || { label: "–", value: 0 });
    const stat = (v, l) => el("div", { class: "osg-stat" }, el("b", {}, v), el("span", {}, l));
    const wrap = el("div", { class: "osg-chart-wrap" }, el("div", { class: "osg-chart-title" }, title), canvas,
      el("div", { class: "osg-stat-row" }, stat(fmtN(total), `last ${data.length} days`), stat(fmtN(last7), "last 7 days"), stat((total / Math.max(1, data.length)).toLocaleString(undefined, { maximumFractionDigits: 1 }), "avg / day"), stat(fmtN(peak.value), "best day · " + peak.label)));
    let hover = null, pending = false;
    const redraw = () => { pending = false; drawPlaysChart(canvas, data, { hover }); };
    const schedule = () => { if (!pending) { pending = true; requestAnimationFrame(redraw); } };
    canvas.addEventListener("pointermove", (e) => { const c = canvas._osg; if (!c) return; const r = canvas.getBoundingClientRect(); const px = e.clientX - r.left; let best = 0, bd = 1e9; c.pts.forEach((p, i) => { const d = Math.abs(p[0] - px); if (d < bd) { bd = d; best = i; } }); if (best !== hover) { hover = best; schedule(); } });
    canvas.addEventListener("pointerleave", () => { hover = null; schedule(); });
    schedule(); new ResizeObserver(schedule).observe(canvas);
    return wrap;
  }
  // Replace the site's Google-Charts play popup with ours. The site calls initPlayCountChart()/drawPlayCountChart()
  // (global functions) from inline scripts, so we override those globals — then its own hover handler draws our chart.
  async function drawPlayChartInto(element) {
    const popup = element.querySelector(".playcount-chart-popup"), content = element.querySelector(".playcount-chart-popup-content"); if (!popup || !content) return;
    if (content.dataset.osgDrawn) return; content.dataset.osgDrawn = "1";
    popup.classList.add("loading");
    try {
      const isUser = element.hasAttribute("data-user");
      const data = isUser ? await fetchStats("user", element.getAttribute("data-user")) : await fetchStats("sequence", element.getAttribute("data-sequence"));
      content.innerHTML = ""; content.appendChild(chartPanel(data, isUser ? "Plays per day, all sequences" : "Plays per day"));
    } catch (err) { content.textContent = "Couldn't load play stats."; content.dataset.osgDrawn = ""; }
    popup.classList.remove("loading");
  }
  function upgradePlayCharts() {
    window.drawPlayCountChart = drawPlayChartInto;
    window.initPlayCountChart = function () { document.querySelectorAll(".playcount").forEach((e) => { e.isChartLoaded = false; e.onmouseover = () => { if (e.isChartLoaded) return; e.isChartLoaded = true; drawPlayChartInto(e); }; }); };
    window.initPlayCountChart();
  }
  /* ================= Account history (plays / subscribers / sequences over time) ================= */
  // The site only serves the last 30 days of plays and a current subscriber count, so this keeps its own
  // local history: every profile visit merges the 30-day play data and takes a daily snapshot of the totals.
  // Sequences-made history is rebuilt from each sequence's creation date (fetched once, cached).
  const iso = (d) => d.toISOString().slice(0, 10);
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const hist = {
    key: (uid) => "osg-hist-" + uid,
    load(uid) { try { return Object.assign({ plays: {}, snaps: {}, seqs: {}, seqsAt: 0 }, JSON.parse(localStorage.getItem(this.key(uid)) || "{}")); } catch (e) { return { plays: {}, snaps: {}, seqs: {}, seqsAt: 0 }; } },
    save(uid, h) { try { localStorage.setItem(this.key(uid), JSON.stringify(h)); } catch (e) {} },
  };
  // "30 Sep" labels → ISO dates, assuming the series ends today (or yesterday if that fits better)
  function datedSeries(data) {
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const fits = (endOffset) => data.every((d, i) => { const dt = new Date(today); dt.setDate(dt.getDate() - endOffset - (data.length - 1 - i)); const m = d.label.match(/(\d+)\s+(\w+)/); return m && +m[1] === dt.getDate() && MONTHS.indexOf(m[2].slice(0, 3)) === dt.getMonth(); });
    const off = fits(0) ? 0 : fits(1) ? 1 : 0;
    return data.map((d, i) => { const dt = new Date(today); dt.setDate(dt.getDate() - off - (data.length - 1 - i)); return { date: iso(dt), value: d.value }; });
  }
  function recordVisit(uid, totals, dailyPlays) {
    const h = hist.load(uid);
    for (const d of datedSeries(dailyPlays)) h.plays[d.date] = d.value;
    h.snaps[iso(new Date())] = { plays: totals.plays, subs: totals.subs, seqs: totals.seqs };
    hist.save(uid, h); return h;
  }
  // Every sequence on a member's profile (id, title, thumbnail), walking the paginated list
  async function listSequences(uid, onProgress = () => {}) {
    const out = [], seen = new Set(); let start = 0;
    for (let page = 0; page < 60; page++) {
      onProgress(`Listing sequences… page ${page + 1}`);
      const html = await (window.__osgNet ? window.__osgNet.fetch : fetch)(`/members/${uid}?sort=4&start=${start}`, { credentials: "same-origin" }, 1).then((r) => r.text());
      const doc = new DOMParser().parseFromString(html, "text/html");
      const tiles = [...doc.querySelectorAll("#page_right .pager-items .preview")];
      let added = 0;
      for (const t of tiles) {
        const id = (t.querySelector("a")?.getAttribute("href") || "").replace(/\D/g, ""); if (!id || seen.has(id)) continue;
        seen.add(id); added++;
        const thumb = ((t.querySelector(".image")?.getAttribute("style") || "").match(/url\((['"]?)([^'")]+)\1\)/) || [])[2] || "";
        out.push({ id, title: t.getAttribute("title") || "Untitled", thumb });
      }
      if (!tiles.length || !added) break;
      const next = doc.querySelector('#page_right .pagelinks a[href*="start="]:last-child');
      const nextStart = next ? +(next.getAttribute("href").match(/start=(\d+)/) || [])[1] : NaN;
      if (!next || isNaN(nextStart) || nextStart <= start) break; start = nextStart;
    }
    return out;
  }
  async function loadSequenceHistory(uid, onProgress) {
    const h = hist.load(uid);
    // 1. collect every sequence id from the member's paginated list
    const ids = (await listSequences(uid, onProgress)).map((q) => q.id);
    // 2. fetch each sequence page for its creation date and play count (cached for a week)
    const todo = [...new Set(ids)].filter((id) => !h.seqs[id] || Date.now() - (h.seqs[id].ts || 0) > 7 * 86400e3);
    let done = 0, active = 0;
    await new Promise((resolve) => {
      const next = async () => {
        if (!todo.length && !active) return resolve();
        while (todo.length && active < 4) {
          const id = todo.shift(); active++;
          (async () => {
            try {
              const html = await (window.__osgNet ? window.__osgNet.fetch : fetch)("/" + id, { credentials: "same-origin" }, 1).then((r) => r.text());
              const t = document.createElement("textarea"); t.innerHTML = html.match(/property="og:title" content="([^"]*)"/)?.[1] || "";
              h.seqs[id] = { title: t.value, created: html.match(/title="created (\d{4}-\d{2}-\d{2})"/)?.[1] || null, updated: html.match(/class="sequence-date">([^<]*)</)?.[1] || null, plays: +((html.match(/class="playcount"[^>]*>([\d,]+) plays?/)?.[1] || "0").replace(/,/g, "")), ts: Date.now() };
            } catch (e) { h.seqs[id] = h.seqs[id] || { title: "", created: null, plays: 0, ts: Date.now() }; }
            active--; done++; onProgress(`Reading sequences… ${done + (ids.length - todo.length - done - active)}/${ids.length}`); next();
          })();
        }
      };
      next();
    });
    h.seqsAt = Date.now(); hist.save(uid, h); return h;
  }
  // Group dated points by day / week / month / year
  function bucket(points, gran, mode = "sum") {
    const key = (d) => { const dt = new Date(d + "T12:00:00"); if (gran === "year") return String(dt.getFullYear()); if (gran === "month") return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`; if (gran === "week") { const w = new Date(dt); w.setDate(dt.getDate() - dt.getDay()); return iso(w); } return d; };
    const label = (k) => { if (gran === "year") return k; if (gran === "month") { const [y, m] = k.split("-"); return MONTHS[+m - 1] + " " + y.slice(2); } const dt = new Date(k + "T12:00:00"); return `${dt.getDate()} ${MONTHS[dt.getMonth()]}${gran === "week" ? " wk" : ""}`; };
    const map = new Map(); const sorted = [...points].sort((a, b) => a.date < b.date ? -1 : 1);
    for (const p of sorted) { const k = key(p.date); map.set(k, mode === "last" ? p.value : (map.get(k) || 0) + p.value); }
    return [...map.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([k, v]) => ({ label: label(k), value: v, key: k }));
  }
  function buildHistory(uid, since) {
    let metric = "plays", gran = "auto", from = since || iso(new Date(Date.now() - 365 * 86400e3)), to = iso(new Date());
    const chartHost = el("div", {}); const status = el("div", { class: "osg-muted" }, "");
    const fromIn = el("input", { type: "date", class: "osg-date", value: from }), toIn = el("input", { type: "date", class: "osg-date", value: to });
    const metricBtns = el("div", { class: "osg-row" }, ...[["plays", "Plays per day"], ["playsTotal", "Total plays"], ["subs", "Subscribers"], ["seqs", "Sequences made"], ["seqPlays", "Plays by creation month"]].map(([id, label]) => el("button", { class: "osg-chip osg-metric" + (id === metric ? " active" : ""), "data-m": id, onclick: () => { metric = id; metricBtns.querySelectorAll(".osg-metric").forEach((b) => b.classList.toggle("active", b.dataset.m === id)); render(); } }, label)));
    const granSel = el("select", { class: "osg-select" }, ...[["auto", "Auto"], ["day", "Day"], ["week", "Week"], ["month", "Month"], ["year", "Year"]].map(([v, l]) => el("option", { value: v }, l)));
    granSel.addEventListener("change", () => { gran = granSel.value; render(); });
    const preset = (label, days) => el("button", { class: "osg-chip", onclick: () => { from = days ? iso(new Date(Date.now() - days * 86400e3)) : (since || "2013-01-01"); to = iso(new Date()); fromIn.value = from; toIn.value = to; render(); } }, label);
    fromIn.addEventListener("change", () => { from = fromIn.value || from; render(); }); toIn.addEventListener("change", () => { to = toIn.value || to; render(); });
    const loadBtn = el("button", { class: "osg-btn osg-ghost", onclick: async () => { loadBtn.disabled = true; try { await loadSequenceHistory(uid, (m) => (status.textContent = m)); status.textContent = "Sequence history loaded."; render(); } catch (e) { status.textContent = "Couldn't load: " + (e.message || e); } loadBtn.disabled = false; } }, "Load sequence history");
    function render() {
      const h = hist.load(uid); chartHost.innerHTML = "";
      const inRange = (d) => d >= from && d <= to;
      const span = Math.max(1, (new Date(to) - new Date(from)) / 86400e3);
      const g = gran !== "auto" ? gran : span <= 45 ? "day" : span <= 200 ? "week" : span <= 1100 ? "month" : "year";
      let pts = [], title = "", note = "", cumulative = false;
      if (metric === "plays") { pts = Object.entries(h.plays).filter(([d]) => inRange(d)).map(([date, value]) => ({ date, value })); title = "Plays per day"; note = "The site only serves the last 30 days of plays; this history is built up from every visit while the extension is installed."; }
      else if (metric === "playsTotal" || metric === "subs") { cumulative = true; pts = Object.entries(h.snaps).filter(([d]) => inRange(d)).map(([date, s]) => ({ date, value: metric === "subs" ? s.subs : s.plays })); title = metric === "subs" ? "Subscribers" : "Total plays"; note = "Snapshots taken on each visit to this profile (one per day) — grows from the day the extension was installed."; }
      else if (metric === "seqs") { pts = Object.values(h.seqs).filter((q) => q.created && inRange(q.created)).map((q) => ({ date: q.created, value: 1 })); title = "Sequences made"; note = h.seqsAt ? `From the creation dates of ${Object.keys(h.seqs).length} sequences.` : "Click “Load sequence history” to fetch every sequence's creation date (one-time, cached for a week)."; }
      else { pts = Object.values(h.seqs).filter((q) => q.created && inRange(q.created)).map((q) => ({ date: q.created, value: q.plays || 0 })); title = "Plays by sequence creation month"; note = "Current play counts of each sequence, grouped by when the sequence was created (not when the plays happened)."; }
      const data = bucket(pts, g, cumulative ? "last" : "sum");
      if (!data.length) { chartHost.append(el("div", { class: "osg-muted" }, "No data in this range yet. " + note)); return; }
      const panel = chartPanel(data, `${title} · by ${g}`); if (cumulative) panel.querySelector(".osg-stat-row")?.remove();
      chartHost.append(panel, el("div", { class: "osg-muted" }, note));
    }
    render();
    const hKey = "osg-history-hidden"; let hHidden = localStorage.getItem(hKey) === "1";
    const hToggle = el("button", { class: "osg-btn osg-ghost osg-stats-toggle" }, hHidden ? "Show" : "Hide");
    const hBody = el("div", { class: hHidden ? "osg-hidden" : "" }, metricBtns,
      el("div", { class: "osg-row" }, el("span", { class: "osg-muted" }, "From"), fromIn, el("span", { class: "osg-muted" }, "to"), toIn, el("span", { class: "osg-muted" }, "by"), granSel),
      el("div", { class: "osg-row" }, preset("30 days", 30), preset("90 days", 90), preset("1 year", 365), preset("All time", 0), loadBtn),
      status, chartHost);
    hToggle.addEventListener("click", () => { hHidden = !hHidden; hBody.classList.toggle("osg-hidden", hHidden); hToggle.textContent = hHidden ? "Show" : "Hide"; try { localStorage.setItem(hKey, hHidden ? "1" : "0"); } catch (e) {} });
    return el("div", { class: "osg-history" },
      el("div", { class: "osg-stats-head" }, el("span", { class: "osg-chart-title" }, "History"), el("span", { class: "osg-head-right" }, el("span", { class: "osg-muted" }, "client-side, stored in this browser"), hToggle)),
      hBody);
  }

  /* ================= Top sequences: most played in the last day / week / month ================= */
  // The site serves ~30 days of plays-per-day for each sequence (the same data as the "N plays" hover chart),
  // so this lists the profile's sequences, fetches each one's series (4 at a time) and ranks them.
  // Results are cached in this browser for an hour.
  const topCache = {
    key: (uid) => "osg-top-" + uid,
    load(uid) { try { return JSON.parse(localStorage.getItem(this.key(uid)) || "null"); } catch (e) { return null; } },
    save(uid, v) { try { localStorage.setItem(this.key(uid), JSON.stringify(v)); } catch (e) {} },
  };
  function buildTopSequences(uid) {
    const RANGES = { day: "Day", week: "Week", month: "Month" };
    let range = "week", dayPick = "today", showAll = false, loading = false, data = topCache.load(uid);
    try { range = localStorage.getItem("osg-top-range") || range; if (!RANGES[range]) range = "week"; } catch (e) {}
    const status = el("div", { class: "osg-muted" }, ""), list = el("div", { class: "osg-top-list" }), summary = el("div", { class: "osg-top-summary" });
    const rangeBtns = el("div", { class: "osg-row" }, ...Object.entries(RANGES).map(([id, label]) => el("button", { class: "osg-chip osg-range" + (id === range ? " active" : ""), "data-r": id, onclick: () => { range = id; showAll = false; try { localStorage.setItem("osg-top-range", id); } catch (e) {} sync(); render(); } }, label)));
    const dayBtns = el("div", { class: "osg-row osg-top-day" }, ...[["today", "Today"], ["yesterday", "Yesterday"]].map(([id, label]) => el("button", { class: "osg-chip osg-daypick" + (id === dayPick ? " active" : ""), "data-d": id, onclick: () => { dayPick = id; sync(); render(); } }, label)));
    const refresh = el("button", { class: "osg-btn osg-ghost", onclick: () => load(true) }, "Refresh");
    function sync() {
      rangeBtns.querySelectorAll(".osg-range").forEach((b) => b.classList.toggle("active", b.dataset.r === range));
      dayBtns.querySelectorAll(".osg-daypick").forEach((b) => b.classList.toggle("active", b.dataset.d === dayPick));
      dayBtns.classList.toggle("osg-hidden", range !== "day");
    }
    // [from, to) indices into a sequence's daily series for the chosen window
    function windowOf(n) {
      if (range === "day") return dayPick === "today" ? [n - 1, n] : [n - 2, n - 1];
      if (range === "week") return [n - 7, n];
      return [0, n];
    }
    const sum = (a, i, j) => { let t = 0; for (let k = Math.max(0, i); k < Math.min(a.length, j); k++) t += a[k] || 0; return t; };
    function spark(values, win) {
      const W = 120, H = 26, n = values.length, max = Math.max(1, ...values);
      const x = (i) => (n > 1 ? (i / (n - 1)) * (W - 2) + 1 : W / 2), y = (v) => H - 2 - (v / max) * (H - 4);
      const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("class", "osg-spark");
      const a = Math.max(0, win[0]), b = Math.min(n, win[1]);
      if (b > a) { const r = document.createElementNS(ns, "rect"); const x0 = a > 0 ? (x(a - 1) + x(a)) / 2 : 0, x1 = b < n ? (x(b - 1) + x(b)) / 2 : W; r.setAttribute("x", x0); r.setAttribute("y", 0); r.setAttribute("width", Math.max(2, x1 - x0)); r.setAttribute("height", H); r.setAttribute("class", "osg-spark-win"); svg.append(r); }
      const pl = document.createElementNS(ns, "polyline"); pl.setAttribute("points", values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")); svg.append(pl);
      return svg;
    }
    function render() {
      list.innerHTML = ""; summary.innerHTML = "";
      if (!data || !data.seqs) { list.append(el("div", { class: "osg-muted" }, loading ? "" : "Not loaded yet.")); return; }
      const labels = data.labels || [];
      const n = labels.length || Math.max(0, ...data.seqs.map((q) => (q.d || []).length));
      const win = windowOf(n);
      const rows = data.seqs.map((q) => ({ q, v: sum(q.d || [], win[0] - (n - (q.d || []).length), win[1] - (n - (q.d || []).length)) })).filter((r) => r.v > 0).sort((a, b) => b.v - a.v || sum(b.q.d || [], 0, 99) - sum(a.q.d || [], 0, 99));
      const total = rows.reduce((t, r) => t + r.v, 0);
      const span = range === "day" ? (labels[win[0]] ? `${dayPick === "today" ? "today so far" : "yesterday"} (${labels[win[0]]})` : dayPick) : `${labels[Math.max(0, win[0])] || ""} – ${labels[n - 1] || ""} (${Math.min(n, win[1] - Math.max(0, win[0]))} days)`;
      const stat = (v, l) => el("div", { class: "osg-stat" }, el("b", {}, v), el("span", {}, l));
      summary.append(stat(fmtN(total), "plays · " + span), stat(fmtN(rows.length), `of ${fmtN(data.seqs.length)} sequences played`), stat(rows[0] ? fmtN(rows[0].v) : "–", "top sequence"));
      if (!rows.length) { list.append(el("div", { class: "osg-muted" }, loading ? "Counting plays…" : "No plays in this window.")); return; }
      const shown = showAll ? rows : rows.slice(0, 25), best = rows[0].v;
      shown.forEach((r, i) => {
        const bar = el("div", { class: "osg-top-bar" }); bar.style.width = (100 * r.v / best).toFixed(1) + "%";
        const thumb = el("div", { class: "osg-top-thumb" }); if (r.q.thumb) thumb.style.backgroundImage = `url("${r.q.thumb.replace(/"/g, "")}")`;
        list.append(el("a", { class: "osg-top-row" + (i < 3 ? " osg-top-podium" : ""), href: "/" + r.q.id, title: r.q.title },
          el("span", { class: "osg-top-rank" }, String(i + 1)), thumb,
          el("span", { class: "osg-top-name" }, el("span", { class: "osg-top-title" }, r.q.title), bar),
          spark(r.q.d || [], [win[0] - (n - (r.q.d || []).length), win[1] - (n - (r.q.d || []).length)]),
          el("span", { class: "osg-top-plays" }, el("b", {}, fmtN(r.v)), el("span", {}, total ? Math.round(100 * r.v / total) + "%" : ""))));
      });
      if (rows.length > 25) list.append(el("button", { class: "osg-btn osg-ghost osg-top-more", onclick: () => { showAll = !showAll; render(); } }, showAll ? "Show top 25" : `Show all ${rows.length}`));
    }
    function stamp() {
      if (!data || !data.at) return "";
      const m = Math.round((Date.now() - data.at) / 60000);
      return `Updated ${m < 1 ? "just now" : m < 60 ? m + " min ago" : Math.round(m / 60) + " h ago"}${data.partial ? " (incomplete — click Refresh)" : ""}.`;
    }
    async function load(force) {
      if (loading) return;
      if (!force && data && data.seqs && !data.partial && Date.now() - data.at < 3600e3) { status.textContent = stamp(); render(); return; }
      loading = true; refresh.disabled = true;
      try {
        const seqs = await listSequences(uid, (m) => (status.textContent = m));
        const prev = new Map(((data && data.seqs) || []).map((q) => [q.id, q]));
        const fresh = { at: Date.now(), labels: [], seqs: seqs.map((q) => ({ ...q, d: (prev.get(q.id) || {}).d || [] })), partial: true };
        data = fresh; render();
        const todo = [...fresh.seqs]; let done = 0, failed = 0, lastPaint = 0;
        await new Promise((resolve) => {
          let active = 0;
          const pump = () => {
            if (!todo.length && !active) return resolve();
            while (todo.length && active < 4) {
              const q = todo.shift(); active++;
              fetchStats("sequence", q.id).then((series) => {
                q.d = series.map((p) => p.value);
                if (series.length >= fresh.labels.length) fresh.labels = series.map((p) => p.label);
              }).catch(() => { failed++; }).finally(() => {
                active--; done++;
                status.textContent = `Counting plays… ${done}/${fresh.seqs.length}`;
                if (Date.now() - lastPaint > 400) { lastPaint = Date.now(); render(); }
                pump();
              });
            }
          };
          pump();
        });
        fresh.partial = failed > 0; fresh.at = Date.now(); topCache.save(uid, fresh);
        status.textContent = stamp() + (failed ? ` ${failed} sequence${failed === 1 ? "" : "s"} couldn't be read.` : "");
      } catch (e) { status.textContent = "Couldn't load: " + (e.message || e); }
      loading = false; refresh.disabled = false; render();
    }
    sync(); render();
    if (data && data.at) status.textContent = stamp();
    const node = el("div", { class: "osg-top" },
      el("div", { class: "osg-stats-head" }, el("span", { class: "osg-chart-title" }, "Most played sequences"), el("span", { class: "osg-head-right" }, refresh)),
      rangeBtns, dayBtns, summary, status, list,
      el("div", { class: "osg-muted osg-top-note" }, "Uses the site's per-sequence plays-per-day data (the same numbers as the “N plays” hover chart), which covers about the last 30 days, so Month = that whole window. Days follow the site's clock."));
    node.osgLoad = () => load(false);
    return node;
  }

  async function buildProfileStats() {
    if (!/^page_members/.test(document.body.id)) return;
    const header = document.querySelector(".profile_header"); const banner = document.querySelector(".profile_banner"); if (!header || !banner || document.getElementById("osg-profile-stats")) return;
    const text = header.textContent || ""; const uid = (location.pathname.match(/\/members\/(\d+)/) || [])[1];
    const plays = num((header.querySelector(".playcount")?.textContent || "").match(/([\d,]+)\s*plays/)?.[1]);
    const subsN = num((header.querySelector(".subscriber-count")?.textContent || "").match(/([\d,]+)/)?.[1]);
    const seqs = num(text.match(/(?:^|\D)([\d,]+)\s*sequences/)?.[1]);
    const since = text.match(/Member since\s*(\d{4}-\d{2}-\d{2})/)?.[1]; const days = since ? Math.max(1, Math.round((Date.now() - new Date(since).getTime()) / 86400e3)) : null;
    const stat = (v, l, hint) => el("div", { class: "osg-stat", title: hint || "" }, el("b", {}, v), el("span", {}, l));
    const tiles = el("div", { class: "osg-stat-grid" },
      stat(fmtN(plays), "total plays"), stat(fmtN(seqs), "sequences"), stat(fmtN(subsN), "subscribers"),
      stat(seqs ? fmtN(plays / seqs) : "–", "plays per sequence"),
      stat(days ? (days >= 365 ? (days / 365).toFixed(1) + " y" : days + " d") : "–", "member for"),
      stat(days && seqs ? (seqs / (days / 30.44)).toFixed(1) : "–", "sequences / month"),
      stat(days ? (plays / days).toFixed(1) : "–", "plays / day overall"));
    // collapsible: header stays, everything else hides; remembered per browser
    const hiddenKey = "osg-stats-hidden"; let hidden = localStorage.getItem(hiddenKey) === "1";
    const toggle = el("button", { class: "osg-btn osg-ghost osg-stats-toggle" }, hidden ? "Show" : "Hide");
    const overview = el("div", { class: "osg-pane" }, tiles);
    const topPane = buildTopSequences(uid);
    let tab = "overview"; try { tab = localStorage.getItem("osg-stats-tab") === "top" ? "top" : "overview"; } catch (e) {}
    const tabBar = el("div", { class: "osg-card-tabs", role: "tablist" }, ...[["overview", "Overview"], ["top", "Top sequences"]].map(([id, label]) => el("button", { class: "osg-card-tab", role: "tab", "data-t": id, onclick: () => setTab(id) }, label)));
    function setTab(id) {
      tab = id; try { localStorage.setItem("osg-stats-tab", id); } catch (e) {}
      tabBar.querySelectorAll(".osg-card-tab").forEach((b) => { b.classList.toggle("active", b.dataset.t === id); b.setAttribute("aria-selected", b.dataset.t === id ? "true" : "false"); });
      overview.classList.toggle("osg-hidden", id !== "overview"); topPane.classList.toggle("osg-hidden", id !== "top");
      if (id === "top" && !hidden) topPane.osgLoad();
    }
    const body = el("div", { class: "osg-stats-body" + (hidden ? " osg-hidden" : "") }, tabBar, overview, topPane);
    setTab(tab);
    toggle.addEventListener("click", () => { hidden = !hidden; body.classList.toggle("osg-hidden", hidden); toggle.textContent = hidden ? "Show" : "Hide"; box.classList.toggle("osg-collapsed", hidden); try { localStorage.setItem(hiddenKey, hidden ? "1" : "0"); } catch (e) {} if (!hidden && tab === "top") topPane.osgLoad(); });
    const box = el("div", { id: "osg-profile-stats", class: hidden ? "osg-collapsed" : "" },
      el("div", { class: "osg-stats-head" }, el("span", { class: "osg-chart-title" }, "Stats & history"), el("span", { class: "osg-head-right" }, el("span", { class: "osg-muted" }, "computed client-side"), toggle)), body);
    banner.insertAdjacentElement("afterend", box);
    let data = [];
    try { data = await fetchStats("user", uid); const last30 = data.reduce((s, d) => s + d.value, 0), last7 = data.slice(-7).reduce((s, d) => s + d.value, 0);
      tiles.append(stat(fmtN(last7), "plays, last 7 days"), stat(fmtN(last30), `plays, last ${data.length} days`), stat((last30 / Math.max(1, data.length)).toFixed(1), `plays / day, last ${data.length}`));
      overview.appendChild(chartPanel(data, `Plays per day, last ${data.length} days`)); } catch (e) {}
    try { recordVisit(uid, { plays, subs: subsN, seqs }, data); } catch (e) {}
    try { overview.appendChild(buildHistory(uid, since)); } catch (e) {}
  }
  const initProfile = () => { try { upgradePlayCharts(); } catch (e) {} try { buildProfileStats(); } catch (e) {} setTimeout(() => { try { upgradePlayCharts(); } catch (e) {} }, 1500); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initProfile); else initProfile();
  { let t = 0; new MutationObserver(() => { if (t) return; t = setTimeout(() => { t = 0; try { if (document.querySelector(".playcount:not([data-osg])")) { document.querySelectorAll(".playcount").forEach((e) => (e.dataset.osg = "1")); upgradePlayCharts(); } } catch (e) {} }, 500); }).observe(document.documentElement, { childList: true, subtree: true }); }


  /* ================= Ads: close them the way the site does (remove + reflow) instead of hiding ================= */
  function closeAds() {
    let changed = false;
    // Always: press the site's own "Close ad" (independent of the banner setting)
    const fc = document.getElementById("footer_ad_close");
    if (fc) { try { fc.click(); } catch (e) {} if (document.getElementById("footer_ad_wrapper")) { try { typeof closeAd === "function" ? closeAd() : document.getElementById("footer_ad_wrapper").remove(); } catch (e) { document.getElementById("footer_ad_wrapper")?.remove(); } } changed = true; }
    // anything on the page that says "Close ad" gets clicked, exactly as if you had clicked it
    for (const e of document.querySelectorAll("div, a, button, span, i, label")) {
      if (e.closest("#osg-tools") || e.children.length > 3 || e.querySelector("iframe, img, canvas")) continue; // the control itself, not the ad container around it
      const txt = (e.textContent || "").replace(/\s+/g, " ").trim(), aria = (e.getAttribute("aria-label") || e.getAttribute("title") || "").trim();
      if (/^(close|hide|dismiss)\s*ad(s|vert(isement)?)?$/i.test(txt) || /^close ad$/i.test(aria)) {
        const target = e.closest('[onclick], a, button') || e;
        try { target.click(); changed = true; } catch (err) {}
      }
    }
    document.querySelectorAll('[class*="pw-close"], [class*="close-ad"], [id*="close_ad"]').forEach((b) => { try { b.click(); changed = true; } catch (e) {} });
    if (!document.documentElement.classList.contains("osg-hide-ads")) { if (changed && typeof onresize === "function") { try { onresize(); } catch (e) {} } return; }
    // ad slots and their reserved space (only with "Hide ad banners" on)
    for (const sel of ["#ad_container", "#page_ad_left", "#page_ad_right", "#sticky_footer_ad_container", '[id^="pw-oop"]', ".pw-tag", "#standard_iab_head1", '[id^="google_ads_iframe"]', ".ads-adaptive", "#adBanner", '[data-fuse]', '[class*="content-showcase"]']) {
      document.querySelectorAll(sel).forEach((e) => { if (!e.closest("#osg-tools")) { e.remove(); changed = true; } });
    }
    if (changed && typeof onresize === "function") { try { onresize(); } catch (e) {} }
  }
  { const run = () => { try { closeAds(); } catch (e) {} };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run); else run();
    let t = 0; new MutationObserver(() => { if (!t) t = setTimeout(() => { t = 0; run(); }, 300); }).observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener("osg-settings-changed", run); setTimeout(run, 1500); setTimeout(run, 4000);
    let n = 0; const iv = setInterval(() => { run(); if (++n > 10) { clearInterval(iv); setInterval(run, 10000); } }, 2000); }

  T.open = togglePanel;
  Object.assign(T, { chordGen, setChords, randomProgression, buildChord, insertChords, detectBPM, detectKeyFromAudio, detectKeyFromSequence, keysFromChroma, isolate, bufferToWav, toggleDock, analyzeTempo, mergeSelected, splitAtPlayhead, selectClip, ref });
})();
