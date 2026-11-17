// Glow Theme for Online Sequencer — the sequence library: sequences saved as sequence data (the site's .sequence format),
// in the extension's own database. Used by the background worker, the Library page and the My comments page.
import { all, get, put, byIndex, del } from "./db.js";

export const SITE = "https://onlinesequencer.net";

// Sequence fields in the site's format: 1 settings, 2 notes, 3 markers. Counting the notes needs no protobuf library.
export function countNotes(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); let i = 0, n = 0;
  const varint = () => { let x = 0, s = 0, c; do { if (i >= b.length) throw 0; c = b[i++]; x += (c & 127) * 2 ** s; s += 7; } while (c & 128); return x; };
  try {
    while (i < b.length) {
      const key = varint(), field = Math.floor(key / 8), wt = key & 7;
      if (wt === 0) varint(); else if (wt === 1) i += 8; else if (wt === 5) i += 4; else if (wt === 2) { const len = varint(); if (field === 2) n++; i += len; } else break;
    }
  } catch (e) {}
  return n;
}
export async function sha256(bytes) { const h = await crypto.subtle.digest("SHA-256", bytes); return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join(""); }
export const toB64 = (bytes) => { const b = new Uint8Array(bytes); let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
export const fromB64 = (s) => { const bin = atob(s); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b; };
const unesc = (s) => String(s || "").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

// title / creator of a sequence, from its page
export async function sequenceMeta(id) {
  const html = await fetch(`${SITE}/${id}`).then((r) => r.text());
  const title = unesc((html.match(/property="og:title" content="([^"]*)"/) || [])[1] || "").trim();
  const by = html.match(/<\/span>\s*by\s*<a href="\/members\/(\d+)">([^<]*)<\/a>/) || html.match(/class="sequence-date">[^<]*<\/span><\/span>\s*by\s*<a href="\/members\/(\d+)">([^<]*)<\/a>/);
  return { title, creatorUid: by ? by[1] : "", creatorName: by ? unesc(by[2]).trim() : "" };
}
export async function fetchPreview(id) {
  try { const r = await fetch(`${SITE}/preview/${id}`); if (!r.ok) return null; const b = await r.blob(); return b.size && /^image\//.test(b.type) ? await cropBadge(b) : null; } catch (e) { return null; }
}
// The site's share picture (1200 × 630) carries its "Online Sequencer" badge in the bottom-right corner (x ≥ 774,
// y ≥ 508). Keep the part above it, so thumbnails show only the sequence.
export async function cropBadge(blob) {
  try {
    const bm = await createImageBitmap(blob), w = bm.width, h = bm.height, r = w / h;
    if (r < 1.85 || r > 1.96 || w < 300) { if (bm.close) bm.close(); return blob; }
    const ch = Math.floor(h * 506 / 630), c = new OffscreenCanvas(w, ch);
    c.getContext("2d").drawImage(bm, 0, 0, w, ch, 0, 0, w, ch); if (bm.close) bm.close();
    return await c.convertToBlob({ type: "image/webp", quality: 0.9 });
  } catch (e) { return blob; }
}

// Save one entry. The same sequence with identical data already in the library is not saved twice (that entry is
// returned instead); a different version of it, or another sequence that happens to have the same data, is kept.
export async function saveEntry({ bytes, title = "", seqId = "", creatorUid = "", creatorName = "", thumb = null, source = "site", savedAt = 0, fromId = "", fromTitle = "" }) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!u8.length) throw new Error("That sequence has no data (it may be private or deleted).");
  const hash = await sha256(u8);
  const same = (await byIndex("library", "hash", hash)).find((e) => (e.seqId || "") === String(seqId || ""));
  if (same) return { entry: same, duplicate: true };
  const entry = { key: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, seqId: String(seqId || ""), title: String(title || "Untitled").slice(0, 200), creatorUid: String(creatorUid || ""), creatorName: String(creatorName || "").slice(0, 80), bytes: u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength), hash, size: u8.length, notes: countNotes(u8), thumb: thumb || null, thumbV: 2, source, savedAt: savedAt > 0 ? savedAt : Date.now() };
  if (fromId) { entry.fromId = String(fromId).replace(/\D/g, ""); entry.fromTitle = String(fromTitle || "").slice(0, 200); }
  await put("library", entry);
  return { entry, duplicate: false };
}
// Save a sequence that is on the site, by its number: its current data, title, creator and thumbnail.
export async function saveFromSite(id, known = {}) {
  id = String(id).replace(/\D/g, ""); if (!id) throw new Error("Not a sequence number.");
  const r = await fetch(`${SITE}/app/api/get_proto.php?v=2&id=${id}`); if (!r.ok) throw new Error("The site said " + r.status + ".");
  const bytes = new Uint8Array(await r.arrayBuffer());
  const meta = known.title && known.creatorUid !== undefined ? known : { ...(await sequenceMeta(id).catch(() => ({}))), ...known };
  const thumb = await fetchPreview(id);
  return saveEntry({ bytes, seqId: id, title: meta.title || "Sequence " + id, creatorUid: meta.creatorUid || "", creatorName: meta.creatorName || "", thumb, source: known.source || "site" });
}
export const listLibrary = () => all("library");
export const getEntry = (key) => get("library", key);
export const deleteEntries = (keys) => del("library", keys);
// thumbnails kept before the badge was cropped off: crop them once
export async function fixOldThumbs(list, onFixed) {
  for (const x of list) {
    if (x.thumbV === 2) continue;
    const e = await get("library", x.key); if (!e) continue;
    if (e.thumb) e.thumb = await cropBadge(e.thumb);
    e.thumbV = 2; await put("library", e); x.thumb = e.thumb; x.thumbV = 2; if (onFixed) onFixed(x);
  }
}
export async function renameEntry(key, title) { const e = await get("library", key); if (!e) return; e.title = String(title || "").slice(0, 200) || e.title; await put("library", e); return e; }
