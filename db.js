// Glow Theme for Online Sequencer — the extension's own database (IndexedDB on the extension's origin).
// Only extension pages and the background worker can open it: web pages and content scripts cannot, which is why the
// saved account sign-ins live here and not in chrome.storage.
//   kv        small values (accounts and their saved sign-in cookies, scan settings)
//   comments  your sequence comments: { id, uid, name, seq, parent, parentName, parentText, text, links, date, ts, seenAt, gone }
//   seqs      sequences known to the index: { id, title, creatorUid, creatorName, scannedAt, scannedFor: [uid], sources }
//   library   saved sequences, as sequence data: { key, seqId, title, creatorUid, creatorName, bytes (the site's .sequence
//             format), hash, size, notes, thumb (Blob), source, savedAt }
const NAME = "osg-glow", VERSION = 2;
let dbp = null;
export function db() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv");
      if (!d.objectStoreNames.contains("comments")) { const s = d.createObjectStore("comments", { keyPath: "id" }); s.createIndex("uid", "uid"); s.createIndex("seq", "seq"); }
      if (!d.objectStoreNames.contains("seqs")) d.createObjectStore("seqs", { keyPath: "id" });
      if (!d.objectStoreNames.contains("library")) { const l = d.createObjectStore("library", { keyPath: "key" }); l.createIndex("seqId", "seqId"); l.createIndex("hash", "hash"); }
    };
    req.onsuccess = () => { const d = req.result; d.onversionchange = () => { d.close(); dbp = null; }; resolve(d); };   // let a newer version upgrade it
    req.onerror = () => { dbp = null; reject(req.error); };
  });
  return dbp;
}
const done = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
const result = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export async function kvGet(key, fallback = null) { const d = await db(); const v = await result(d.transaction("kv").objectStore("kv").get(key)); return v === undefined ? fallback : v; }
export async function kvSet(key, value) { const d = await db(); const tx = d.transaction("kv", "readwrite"); tx.objectStore("kv").put(value, key); await done(tx); }

export async function all(store) { const d = await db(); return result(d.transaction(store).objectStore(store).getAll()); }
export async function get(store, key) { const d = await db(); return result(d.transaction(store).objectStore(store).get(key)); }
export async function byIndex(store, index, value) { const d = await db(); return result(d.transaction(store).objectStore(store).index(index).getAll(value)); }
export async function putMany(store, items) { if (!items.length) return; const d = await db(); const tx = d.transaction(store, "readwrite"); const s = tx.objectStore(store); for (const it of items) s.put(it); await done(tx); }
export async function del(store, keys) { const d = await db(); const tx = d.transaction(store, "readwrite"); const s = tx.objectStore(store); for (const k of keys) s.delete(k); await done(tx); }
export async function put(store, item) { const d = await db(); const tx = d.transaction(store, "readwrite"); tx.objectStore(store).put(item); await done(tx); }
export async function count(store) { const d = await db(); return result(d.transaction(store).objectStore(store).count()); }
export async function clear(store) { const d = await db(); const tx = d.transaction(store, "readwrite"); tx.objectStore(store).clear(); await done(tx); }

// ---------- comments ----------
// Merge freshly parsed comments for one sequence. `uids` are the accounts that were looked for in it: any stored
// comment of theirs on that sequence that is no longer there has been deleted on the site, so it is flagged `gone`.
export async function mergeSequenceComments(seq, uids, found, meta = {}) {
  const d = await db(); const tx = d.transaction(["comments", "seqs"], "readwrite");
  const cs = tx.objectStore("comments"), ss = tx.objectStore("seqs");
  const now = Date.now(), ids = new Set(found.map((c) => c.id));
  const existing = await result(cs.index("seq").getAll(String(seq)));
  for (const c of existing) if (uids.includes(c.uid) && !ids.has(c.id) && !c.gone) { c.gone = true; c.goneAt = now; cs.put(c); }
  const byId = new Map(existing.map((c) => [c.id, c]));
  for (const c of found) { const old = byId.get(c.id); cs.put({ ...(old || {}), ...c, seq: String(seq), seenAt: old?.seenAt || now, gone: false }); }
  const s = (await result(ss.get(String(seq)))) || { id: String(seq), title: "", scannedFor: [] };
  s.scannedAt = now; s.scannedFor = [...new Set([...(s.scannedFor || []), ...uids])];
  if (meta.title && !s.title) s.title = meta.title; if (meta.title && meta.force) s.title = meta.title;
  if (meta.source) s.sources = [...new Set([...(s.sources || []), meta.source])];
  ss.put(s);
  await done(tx);
}
// Note sequences as candidates for scanning (seen in this browser, your own, from history…), keeping what is known.
export async function addSeqs(list, source) {
  if (!list.length) return 0;
  const d = await db(); const tx = d.transaction("seqs", "readwrite"); const ss = tx.objectStore("seqs"); let added = 0;
  for (const it of list) {
    const id = String(it.id); if (!/^\d+$/.test(id)) continue;
    const s = await result(ss.get(id));
    if (!s) { const n = { id, title: it.title || "", scannedAt: 0, scannedFor: [], sources: [source] }; if (it.creatorUid) { n.creatorUid = it.creatorUid; n.creatorName = it.creatorName || ""; } ss.put(n); added++; }
    else { let ch = false; if (it.title && (!s.title || it.force)) { s.title = it.title; ch = true; } if (!(s.sources || []).includes(source)) { s.sources = [...(s.sources || []), source]; ch = true; } if (it.creatorUid && !s.creatorUid) { s.creatorUid = it.creatorUid; if (it.creatorName) s.creatorName = it.creatorName; ch = true; } if (ch) ss.put(s); }
  }
  await done(tx); return added;
}
