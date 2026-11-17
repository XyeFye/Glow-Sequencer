// Glow Theme for Online Sequencer — AI engines (runs in the page's own JS context, like tools.js).
//
//  • Stem separation: Meta's HTDemucs (4 stems) on ONNX Runtime Web, GPU via WebGPU with a CPU (WASM) fallback.
//    Pre/post-processing ported from demucs-web by timcsy (MIT) — https://github.com/timcsy/demucs-web
//    Model: https://huggingface.co/timcsy/demucs-web-onnx (MIT), weights from facebookresearch/demucs (MIT).
//  • Note transcription: Spotify Basic Pitch (Apache-2.0) — https://github.com/spotify/basic-pitch-ts
//
// Both run inside background Web Workers so the editor never freezes while they work. (If a worker can't be
// started, they fall back to running on the page itself.) Nothing is downloaded until one of them is used; the
// Demucs model (~180 MB) is kept in the browser's Cache Storage for onlinesequencer.net, so it only downloads once.

(function () {
  if (window.__osgML) return;

  const URLS = {
    ORT_BASE: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/",   // 1.20.x computes HTDemucs wrongly on WebGPU; 1.30 matches the CPU result
    DEMUCS: "https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx",
    BP_MODULE: "https://cdn.jsdelivr.net/npm/@spotify/basic-pitch@1.0.1/+esm",
    BP_MODEL: "https://cdn.jsdelivr.net/npm/@spotify/basic-pitch@1.0.1/model/model.json",
    TFJS: "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@3.19.0/+esm",           // the exact build basic-pitch's +esm bundle imports
    CACHE: "osg-models-v1",
  };
  const D = { SR: 44100, NFFT: 4096, HOP: 1024, SAMPLES: 343980, BINS: 2048, FRAMES: 336, OVERLAP: 0.25, TRACKS: ["drums", "bass", "other", "vocals"] };

  /* ======================= shared core (also copied into the workers as source text) ======================= */
  const twiddleCache = new Map(), revCache = new Map(), hannCache = new Map();
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
  function twiddles(n) {
    if (twiddleCache.has(n)) return twiddleCache.get(n);
    const re = new Float32Array(n / 2), im = new Float32Array(n / 2);
    for (let k = 0; k < n / 2; k++) { const a = -2 * Math.PI * k / n; re[k] = Math.cos(a); im[k] = Math.sin(a); }
    const t = { re, im }; twiddleCache.set(n, t); return t;
  }
  function bitrev(n) {
    if (revCache.has(n)) return revCache.get(n);
    const bits = Math.log2(n) | 0, r = new Uint32Array(n);
    for (let i = 0; i < n; i++) { let x = i, y = 0; for (let b = 0; b < bits; b++) { y = (y << 1) | (x & 1); x >>= 1; } r[i] = y; }
    revCache.set(n, r); return r;
  }
  function hann(n) {
    if (hannCache.has(n)) return hannCache.get(n);
    const w = new Float32Array(n); for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / n));
    hannCache.set(n, w); return w;
  }
  // in-place complex FFT; inverse=true conjugates the twiddles and scales by 1/n
  function fftc(re, im, inverse) {
    const n = re.length, rev = bitrev(n), tw = twiddles(n), sgn = inverse ? -1 : 1;
    for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0; j < half; j++) {
          const k = j * step, wr = tw.re[k], wi = sgn * tw.im[k], a = i + j, b = a + half;
          const orr = re[b] * wr - im[b] * wi, oi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - orr; im[b] = im[a] - oi; re[a] += orr; im[a] += oi;
        }
      }
    }
    if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }
  function stft(signal, N, hop) {
    const frames = Math.floor((signal.length - N) / hop) + 1, bins = N / 2 + 1, w = hann(N), scale = 1 / Math.sqrt(N);
    const sr = new Float32Array(frames * bins), si = new Float32Array(frames * bins), re = new Float32Array(N), im = new Float32Array(N);
    for (let f = 0; f < frames; f++) {
      const s = f * hop; for (let i = 0; i < N; i++) { re[i] = signal[s + i] * w[i]; im[i] = 0; }
      fftc(re, im, false);
      const o = f * bins; for (let k = 0; k < bins; k++) { sr[o + k] = re[k] * scale; si[o + k] = im[k] * scale; }
    }
    return { real: sr, imag: si, frames, bins };
  }
  function istft(specR, specI, frames, bins, N, hop, length) {
    const out = new Float32Array(length), wsum = new Float32Array(length), w = hann(N), scale = Math.sqrt(N);
    const re = new Float32Array(N), im = new Float32Array(N);
    for (let f = 0; f < frames; f++) {
      re.fill(0); im.fill(0);
      for (let k = 0; k < bins; k++) { re[k] = specR[f * bins + k]; im[k] = specI[f * bins + k]; }
      for (let k = 1; k < bins - 1; k++) { re[N - k] = re[k]; im[N - k] = -im[k]; }
      fftc(re, im, true);
      const s = f * hop;
      for (let i = 0; i < N && s + i < length; i++) { out[s + i] += re[i] * w[i] * scale; wsum[s + i] += w[i] * w[i]; }
    }
    for (let i = 0; i < length; i++) if (wsum[i] > 1e-8) out[i] /= wsum[i];
    return out;
  }
  function reflectPad(x, l, r) {
    const n = x.length, out = new Float32Array(l + n + r);
    for (let i = 0; i < l; i++) out[i] = x[Math.min(l - i, n - 1)];
    out.set(x, l);
    for (let i = 0; i < r; i++) out[l + n + i] = x[Math.max(0, n - 2 - i)];
    return out;
  }
  function prepareInput(D, segL, segR) {
    const N = D.SAMPLES, le = Math.ceil(N / D.HOP), pad = Math.floor(D.HOP / 2) * 3, padR = pad + le * D.HOP - N, c = D.NFFT / 2;
    const sL = stft(reflectPad(reflectPad(segL, pad, padR), c, c), D.NFFT, D.HOP), sR = stft(reflectPad(reflectPad(segR, pad, padR), c, c), D.NFFT, D.HOP);
    const B = D.BINS, F = D.FRAMES, spec = new Float32Array(4 * B * F);
    for (let f = 0; f < F; f++) {
      const src = (f + 2) * sL.bins;
      for (let b = 0; b < B; b++) { const o = b * F + f; spec[o] = sL.real[src + b]; spec[B * F + o] = sL.imag[src + b]; spec[2 * B * F + o] = sR.real[src + b]; spec[3 * B * F + o] = sR.imag[src + b]; }
    }
    const wave = new Float32Array(2 * N); wave.set(segL, 0); wave.set(segR, N);
    return { wave, spec };
  }
  // frequency-branch output of one track/channel → time signal (aligned with the time branch)
  function freqToTime(D, freq, track, chan, length) {
    const B = D.BINS, F = D.FRAMES, PB = B + 1, PF = F + 4;
    const re = new Float32Array(PF * PB), im = new Float32Array(PF * PB);
    const base = track * 4 * B * F, oR = base + (2 * chan) * B * F, oI = base + (2 * chan + 1) * B * F;
    for (let f = 0; f < F; f++) for (let b = 0; b < B; b++) { const d = (f + 2) * PB + b, s = b * F + f; re[d] = freq[oR + s]; im[d] = freq[oI + s]; }
    const len = (PF - 1) * D.HOP + D.NFFT, x = istft(re, im, PF, PB, D.NFFT, D.HOP, len), off = D.NFFT / 2 + Math.floor(D.HOP / 2) * 3;
    return x.subarray(off, off + length);
  }
  async function cachedDownload(URLS, url, onProgress) {
    let cache = null;
    try { cache = await caches.open(URLS.CACHE); const hit = await cache.match(url); if (hit) { onProgress && onProgress(1, 1, true); return await hit.arrayBuffer(); } } catch (e) { cache = null; }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Model download failed (HTTP ${res.status})`);
    const total = +res.headers.get("Content-Length") || 0;
    let buf;
    if (res.body && total) {
      const reader = res.body.getReader(); let out = new Uint8Array(total), got = 0;
      for (;;) { const { done, value } = await reader.read(); if (done) break; if (got + value.length > out.length) { const bigger = new Uint8Array(Math.max(out.length * 2, got + value.length)); bigger.set(out.subarray(0, got)); out = bigger; } out.set(value, got); got += value.length; onProgress && onProgress(got, total, false); }
      buf = out.buffer.slice(0, got);
    } else buf = await res.arrayBuffer();
    try { if (cache) await cache.put(url, new Response(buf, { headers: { "Content-Type": "application/octet-stream" } })); } catch (e) {}
    return buf;
  }
  async function hasWebGPU() { try { return !!(navigator.gpu && (await navigator.gpu.requestAdapter())); } catch (e) { return false; } }
  async function createDemucsSession(URLS, ort, buf) {
    if (await hasWebGPU()) { try { return { session: await ort.InferenceSession.create(buf, { executionProviders: ["webgpu"], graphOptimizationLevel: "disabled" }), provider: "webgpu" }; } catch (e) {} }
    return { session: await ort.InferenceSession.create(buf, { executionProviders: ["wasm"], graphOptimizationLevel: "basic" }), provider: "wasm" };
  }
  // run HTDemucs over a whole 44.1 kHz stereo signal → [[L,R] × 4 tracks]
  async function separateCore(D, ort, session, L, R, onProgress, isCancelled) {
    const total = L.length, stride = Math.floor(D.SAMPLES * (1 - D.OVERLAP)), starts = [];
    for (let s = 0; s < total; s += stride) { starts.push(s); if (s + D.SAMPLES >= total) break; }
    const outs = D.TRACKS.map(() => [new Float32Array(total), new Float32Array(total)]), weights = new Float32Array(total);
    const inWave = session.inputNames[0], inSpec = session.inputNames[1];
    const run = (start) => {
      const segL = new Float32Array(D.SAMPLES), segR = new Float32Array(D.SAMPLES), n = Math.min(D.SAMPLES, total - start);
      segL.set(L.subarray(start, start + n)); segR.set(R.subarray(start, start + n));
      const { wave, spec } = prepareInput(D, segL, segR);
      const feeds = { [inWave]: new ort.Tensor("float32", wave, [1, 2, D.SAMPLES]) };
      if (inSpec) feeds[inSpec] = new ort.Tensor("float32", spec, [1, 4, D.BINS, D.FRAMES]);
      return session.run(feeds).then((res) => ({ res, start, n }));
    };
    const t0 = performance.now();
    let pending = run(starts[0]);
    for (let si = 0; si < starts.length; si++) {
      if (isCancelled()) throw new Error("Cancelled");
      const { res, start, n } = await pending;
      if (si + 1 < starts.length) pending = run(starts[si + 1]);   // keep the GPU busy while this segment is post-processed
      let time = null, freq = null, tDims = null;
      for (const name of session.outputNames) { const t = res[name]; if (t.dims.length === 4 && t.dims[2] === 2) { time = t.data; tDims = t.dims; } else if (t.dims.length === 5 && t.dims[2] === 4) freq = t.data; }
      if (!time) throw new Error("Unexpected model output");
      const S = tDims[3], win = new Float32Array(n);
      for (let i = 0; i < n; i++) win[i] = Math.min(1, Math.min(i, n - i) / (stride * 0.5));
      if (si === 0) for (let i = 0; i < Math.min(n, stride >> 1); i++) win[i] = 1;                 // no fade-in at the very start
      if (si === starts.length - 1) for (let i = Math.max(0, n - (stride >> 1)); i < n; i++) win[i] = 1; // nor fade-out at the end
      for (let t = 0; t < 4; t++) {
        for (let ch = 0; ch < 2; ch++) {
          const fx = freq ? freqToTime(D, freq, t, ch, D.SAMPLES) : null, o = t * 2 * S + ch * S, dst = outs[t][ch];
          for (let i = 0; i < n; i++) dst[start + i] += (time[o + i] + (fx ? fx[i] : 0)) * win[i];
        }
      }
      for (let i = 0; i < n; i++) weights[start + i] += win[i];
      const done = (si + 1) / starts.length, el = (performance.now() - t0) / 1000;
      onProgress(done, el / done - el);
      await sleep(0);
    }
    for (const [l, r] of outs) for (let i = 0; i < total; i++) if (weights[i] > 0) { l[i] /= weights[i]; r[i] /= weights[i]; }
    return outs;
  }
  // Basic Pitch: load (GPU via WebGL if possible, else CPU) and transcribe a 22.05 kHz mono signal → note list
  async function bpLoad(URLS, importer) {
    const mod = await importer(URLS.BP_MODULE);
    let tf = null; try { tf = await importer(URLS.TFJS); } catch (e) {}
    if (tf) {
      let ok = false; try { ok = await tf.setBackend("webgl"); await tf.ready(); } catch (e) { ok = false; }
      if (!ok || tf.getBackend() !== "webgl") { try { await tf.setBackend("cpu"); await tf.ready(); } catch (e) {} }
    }
    const model = new mod.BasicPitch(URLS.BP_MODEL);
    await model.model;   // surface model download errors here rather than mid-transcription
    return { mod, tf, model };
  }
  async function bpTranscribe(bp, mono, opts, onProgress, onStatus) {
    const { mod, tf, model } = bp, o = Object.assign({ onsetThresh: 0.5, frameThresh: 0.3, minNoteFrames: 11, splitOnset: 0.7 }, opts || {});
    let frames, onsets, contours;
    const run = async () => {
      frames = []; onsets = []; contours = [];
      await model.evaluateModel(mono, (f, on, c) => { for (const x of f) frames.push(x); for (const x of on) onsets.push(x); for (const x of c) contours.push(x); }, (p) => onProgress(p));
    };
    try { await run(); }
    catch (e) {
      if (!tf || tf.getBackend() === "cpu") throw e;
      onStatus("GPU note analysis failed, retrying on the CPU…");   // e.g. WebGL context lost while the separator held the GPU
      await tf.setBackend("cpu"); await tf.ready();
      await run();
    }
    // Basic Pitch sometimes splits one held note into pieces (vibrato / volume swells start new notes). Join a piece onto the
    // note right before it on the same key unless the model heard a real new attack there (onset ≥ splitOnset).
    const events = mod.addPitchBendsToNoteEvents(contours, mod.outputToNotesPoly(frames, onsets, o.onsetThresh, o.frameThresh, o.minNoteFrames));
    events.sort((a, b) => a.pitchMidi - b.pitchMidi || a.startFrame - b.startFrame);
    const onsetAt = (fr, midi) => { let m = 0; for (let k = Math.max(0, fr - 1); k <= Math.min(onsets.length - 1, fr + 1); k++) { const row = onsets[k]; const v = row ? row[midi - 21] : 0; if (v > m) m = v; } return m; };
    const merged = [];
    for (const ev of events) {
      const last = merged[merged.length - 1];
      if (last && last.pitchMidi === ev.pitchMidi && ev.startFrame - (last.startFrame + last.durationFrames) <= 7 && onsetAt(ev.startFrame, ev.pitchMidi) < o.splitOnset) {
        const end = Math.max(last.startFrame + last.durationFrames, ev.startFrame + ev.durationFrames);
        last.amplitude = (last.amplitude * last.durationFrames + ev.amplitude * ev.durationFrames) / (last.durationFrames + ev.durationFrames);
        last.durationFrames = end - last.startFrame; last.pitchBends = undefined;
      } else merged.push(Object.assign({}, ev));
    }
    return mod.noteFramesToTime(merged).map((e) => ({ start: e.startTimeSeconds, end: e.startTimeSeconds + e.durationSeconds, midi: e.pitchMidi, amp: e.amplitude })).sort((a, b) => a.start - b.start || a.midi - b.midi);
  }

  /* ======================= workers ======================= */
  const CORE_SRC = [sleep, twiddles, bitrev, hann, fftc, stft, istft, reflectPad, prepareInput, freqToTime, cachedDownload, hasWebGPU, createDemucsSession, separateCore, bpLoad, bpTranscribe].map(String).join("\n");
  const WORKER_SRC = `
    const twiddleCache = new Map(), revCache = new Map(), hannCache = new Map();
    const URLS = ${JSON.stringify(URLS)}, D = ${JSON.stringify(D)};
    ${CORE_SRC}
    let demucs = null, bp = null, cancelled = false;
    const status = (id, text) => self.postMessage({ id, type: "status", text });
    self.onmessage = async (e) => {
      const m = e.data;
      if (m.type === "cancel") { cancelled = true; return; }
      try {
        if (m.type === "separate") {
          cancelled = false;
          if (!demucs) {
            status(m.id, "Loading ONNX Runtime…");
            const ort = await import(URLS.ORT_BASE + "ort.webgpu.bundle.min.mjs");
            ort.env.wasm.wasmPaths = URLS.ORT_BASE; ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 4) : 1;
            const buf = await cachedDownload(URLS, URLS.DEMUCS, (got, total, cached) => status(m.id, cached ? "Model found in cache…" : "Downloading separation model… " + Math.round(got / 1e6) + " / " + Math.round(total / 1e6) + " MB"));
            status(m.id, "Starting the model…");
            const s = await createDemucsSession(URLS, ort, buf);
            demucs = { ort, session: s.session, provider: s.provider };
          }
          self.postMessage({ id: m.id, type: "provider", provider: demucs.provider });
          let lastPost = 0;
          const outs = await separateCore(D, demucs.ort, demucs.session, m.L, m.R, (p, eta) => { const now = performance.now(); if (now - lastPost > 150 || p >= 1) { lastPost = now; self.postMessage({ id: m.id, type: "progress", p, eta }); } }, () => cancelled);
          self.postMessage({ id: m.id, type: "done", outs }, outs.flat().map((a) => a.buffer));
        } else if (m.type === "transcribe") {
          if (!bp) { status(m.id, "Loading the note model…"); bp = await bpLoad(URLS, (u) => import(u)); }
          self.postMessage({ id: m.id, type: "backend", backend: bp.tf ? bp.tf.getBackend() : "?" });
          let lastPost = 0;
          const notes = await bpTranscribe(bp, m.audio, m.opts, (p) => { const now = performance.now(); if (now - lastPost > 150) { lastPost = now; self.postMessage({ id: m.id, type: "progress", p }); } }, (t) => status(m.id, t));
          self.postMessage({ id: m.id, type: "done", notes });
        }
      } catch (err) { self.postMessage({ id: m.id, type: "error", message: String((err && err.message) || err) }); }
    };`;

  // one long-lived worker per engine (so the models stay loaded); null = workers unavailable → run on the page
  const workers = {};
  function getWorker(kind) {
    if (workers[kind] !== undefined) return workers[kind];
    try { workers[kind] = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: "text/javascript" })), { type: "module" }); }
    catch (e) { workers[kind] = null; }
    return workers[kind];
  }
  let nextId = 1;
  function callWorker(kind, msg, transfer, { onStatus, onProgress, onInfo, signal } = {}) {
    const w = getWorker(kind);
    if (!w) return null;
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const onMsg = (e) => {
        const m = e.data; if (m.id !== id) return;
        if (m.type === "status") onStatus && onStatus(m.text);
        else if (m.type === "progress") onProgress && onProgress(m.p, m.eta);
        else if (m.type === "provider" || m.type === "backend") onInfo && onInfo(m);
        else { w.removeEventListener("message", onMsg); w.removeEventListener("error", onErr); if (signal) signal.removeEventListener("abort", onAbort); if (m.type === "done") resolve(m); else reject(new Error(m.message)); }
      };
      const onErr = (e) => { w.removeEventListener("message", onMsg); w.removeEventListener("error", onErr); workers[kind] = null; reject(new Error("worker: " + (e.message || "failed to start"))); };
      const onAbort = () => w.postMessage({ type: "cancel" });
      w.addEventListener("message", onMsg); w.addEventListener("error", onErr);
      if (signal) signal.addEventListener("abort", onAbort);
      w.postMessage(Object.assign({ id }, msg), transfer);
    });
  }

  // import() a remote ES module on the page (fallback path). Extension scripts aren't always allowed to import modules
  // themselves, so if the direct import fails, the page imports it through a tiny inline module script instead.
  const importCache = new Map();
  function pageImport(url) {
    if (importCache.has(url)) return importCache.get(url);
    const p = (async () => {
      try { return await import(url); }
      catch (direct) {
        return await new Promise((resolve, reject) => {
          const id = "__osgImport_" + Math.random().toString(36).slice(2);
          const timer = setTimeout(() => { delete window[id]; reject(new Error(`Timed out loading ${url} (${direct.message || direct})`)); }, 60000);
          window[id] = { resolve: (m) => { clearTimeout(timer); resolve(m); }, reject: (e) => { clearTimeout(timer); reject(e); } };
          const s = document.createElement("script"); s.type = "module";
          s.textContent = `const h = window[${JSON.stringify(id)}]; delete window[${JSON.stringify(id)}]; import(${JSON.stringify(url)}).then(h.resolve, h.reject);`;
          (document.head || document.documentElement).appendChild(s); s.remove();
        });
      }
    })();
    importCache.set(url, p); p.catch(() => importCache.delete(url));
    return p;
  }

  async function resample(buffer, rate, channels) {
    if (buffer.sampleRate === rate && buffer.numberOfChannels === channels) return buffer;
    const off = new OfflineAudioContext(channels, Math.max(1, Math.ceil(buffer.duration * rate)), rate);
    const src = off.createBufferSource(); src.buffer = buffer; src.connect(off.destination); src.start(0);
    return await off.startRendering();
  }

  /* ======================= public API ======================= */
  const ML = (window.__osgML = { hasWebGPU, pageImport });
  let provider = null, notesBackend = null, demucsMain = null, bpMain = null;
  ML.demucsProvider = () => provider;
  ML.notesBackend = () => notesBackend;
  ML.isDemucsCached = async () => { try { return !!(await (await caches.open(URLS.CACHE)).match(URLS.DEMUCS)); } catch (e) { return false; } };
  ML.clearCache = async () => { try { return await caches.delete(URLS.CACHE); } catch (e) { return false; } };

  // Separate an AudioBuffer into { drums, bass, other, vocals } AudioBuffers (44.1 kHz stereo).
  ML.separate = async function (buffer, { onProgress, onStatus, signal } = {}) {
    onStatus && onStatus("Preparing audio…");
    const audio = await resample(buffer, D.SR, 2);
    const L = audio.getChannelData(0).slice(), R = (audio.numberOfChannels > 1 ? audio.getChannelData(1) : audio.getChannelData(0)).slice();
    let outs;
    const viaWorker = callWorker("demucs", { type: "separate", L, R }, [L.buffer, R.buffer], { onStatus, onProgress, signal, onInfo: (m) => (provider = m.provider) });
    if (viaWorker) {
      try { outs = (await viaWorker).outs; }
      catch (e) { if (/cancel/i.test(e.message) || !/^worker:/.test(e.message)) throw e; }   // worker couldn't start → page fallback below
    }
    if (!outs) {
      const L2 = audio.getChannelData(0), R2 = audio.numberOfChannels > 1 ? audio.getChannelData(1) : L2;
      if (!demucsMain) {
        onStatus && onStatus("Loading ONNX Runtime…");
        const ort = await pageImport(URLS.ORT_BASE + "ort.webgpu.bundle.min.mjs");
        ort.env.wasm.wasmPaths = URLS.ORT_BASE; if (!self.crossOriginIsolated) ort.env.wasm.numThreads = 1;
        const buf = await cachedDownload(URLS, URLS.DEMUCS, (got, total, cached) => onStatus && onStatus(cached ? "Model found in cache…" : `Downloading separation model… ${Math.round(got / 1e6)} / ${Math.round(total / 1e6)} MB`));
        onStatus && onStatus("Starting the model…");
        const s = await createDemucsSession(URLS, ort, buf);
        demucsMain = { ort, session: s.session }; provider = s.provider;
      }
      outs = await separateCore(D, demucsMain.ort, demucsMain.session, L2, R2, (p, eta) => onProgress && onProgress(p, eta), () => !!(signal && signal.aborted));
    }
    const result = {};
    D.TRACKS.forEach((name, t) => { const b = new AudioBuffer({ length: outs[t][0].length, numberOfChannels: 2, sampleRate: D.SR }); b.copyToChannel(outs[t][0], 0); b.copyToChannel(outs[t][1], 1); result[name] = b; });
    return result;
  };

  // → [{ start, end, midi, amp }] in seconds, sorted by start.
  ML.transcribe = async function (buffer, { onProgress, onStatus, opts } = {}) {
    onStatus && onStatus("Preparing audio…");
    const mono = (await resample(buffer, 22050, 1)).getChannelData(0).slice();
    const viaWorker = callWorker("notes", { type: "transcribe", audio: mono, opts }, [mono.buffer], { onStatus, onProgress, onInfo: (m) => (notesBackend = m.backend) });
    if (viaWorker) {
      try { return (await viaWorker).notes; }
      catch (e) { if (!/^worker:/.test(e.message)) throw e; }
    }
    const mono2 = (await resample(buffer, 22050, 1)).getChannelData(0);
    if (!bpMain) { onStatus && onStatus("Loading the note model…"); bpMain = await bpLoad(URLS, pageImport); }
    notesBackend = bpMain.tf ? bpMain.tf.getBackend() : null;
    return await bpTranscribe(bpMain, mono2, opts, (p) => onProgress && onProgress(p), (t) => onStatus && onStatus(t));
  };
})();
