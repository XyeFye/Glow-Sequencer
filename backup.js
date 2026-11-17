// Glow Theme — backup and restore of everything the extension keeps, so nothing is lost when it's reinstalled, loaded
// from another folder, or set up on another computer.
//
// A backup holds: your settings (colours, styles, switches), the Sequence library (every saved sequence and its version
// history, with pictures), the comment index and the sequences it knows. It never holds the account switcher's saved
// sign-ins (those stay inside the extension, on this computer) or anything else that could sign someone in.
//
// The background worker writes one automatically — once a day, soon after the library changes, and right after the
// extension updates — to "Glow Theme backup/glow-backup.json" in your Downloads folder (always the same file, replaced
// each time). The restore page (restore.html) brings one back.
import { db, all, putMany, kvSet } from "./db.js";
import { toB64, fromB64 } from "./lib.js";

export const FORMAT = "osg-glow-backup";
export const FILE = "Glow Theme backup/glow-backup.json";
// never in a backup: saved sign-ins and the account switcher's working state, and this computer's own bookkeeping
const PRIVATE_KV = new Set(["accounts", "current", "pending", "notice", "cookieNames", "problems"]);
const PRIVATE_LOCAL = new Set(["meUid", "osgNetCool", "osgUpdate", "osgLastBackup", "osgBackupDirty"]);

async function kvEntries() {
  const d = await db();
  return new Promise((res, rej) => {
    const out = {}, req = d.transaction("kv").objectStore("kv").openCursor();
    req.onsuccess = () => { const c = req.result; if (!c) return res(out); if (!PRIVATE_KV.has(String(c.key))) out[c.key] = c.value; c.continue(); };
    req.onerror = () => rej(req.error);
  });
}
const blobToB64 = async (b) => (b ? { type: b.type || "image/png", data: toB64(new Uint8Array(await b.arrayBuffer())) } : null);
const b64ToBlob = (x) => (x && x.data ? new Blob([fromB64(x.data)], { type: x.type || "image/png" }) : null);

export async function makeBackup() {
  const settings = await chrome.storage.local.get(null);
  for (const k of Object.keys(settings)) if (PRIVATE_LOCAL.has(k)) delete settings[k];
  const library = [];
  for (const e of await all("library")) library.push({ ...e, bytes: toB64(new Uint8Array(e.bytes)), thumb: await blobToB64(e.thumb) });
  return {
    format: FORMAT, version: 1, extVersion: chrome.runtime.getManifest().version, madeAt: new Date().toISOString(),
    settings, kv: await kvEntries(), comments: await all("comments"), seqs: await all("seqs"), library,
  };
}
export function summary(b) {
  return { settings: Object.keys(b.settings || {}).length, library: (b.library || []).length, sequences: new Set((b.library || []).map((x) => x.seqId || x.key)).size, comments: (b.comments || []).length, madeAt: b.madeAt || "", extVersion: b.extVersion || "" };
}

// Bring a backup back. Nothing already here is overwritten except settings (which you asked for): library versions,
// comments and known sequences are added where they're missing.
export async function restoreBackup(b, { settings = true } = {}) {
  if (!b || b.format !== FORMAT || typeof b !== "object") throw new Error("That file isn't a Glow Theme backup.");
  const got = { settings: 0, library: 0, comments: 0, seqs: 0 };
  if (settings && b.settings && typeof b.settings === "object") {
    const s = { ...b.settings }; for (const k of Object.keys(s)) if (PRIVATE_LOCAL.has(k)) delete s[k];
    await chrome.storage.local.set(s); got.settings = Object.keys(s).length;
  }
  if (b.kv && typeof b.kv === "object") for (const [k, v] of Object.entries(b.kv)) if (!PRIVATE_KV.has(k)) await kvSet(k, v);
  const have = (list, key) => new Set(list.map((x) => x[key]));
  if (Array.isArray(b.library)) {
    const mine = await all("library"), keys = have(mine, "key"), hashes = new Set(mine.map((x) => `${x.seqId}|${x.hash}`));
    const add = [];
    for (const e of b.library) {
      if (!e || !e.key || keys.has(e.key) || hashes.has(`${e.seqId}|${e.hash}`) || typeof e.bytes !== "string") continue;
      add.push({ ...e, bytes: fromB64(e.bytes).buffer, thumb: b64ToBlob(e.thumb) });
    }
    for (let i = 0; i < add.length; i += 50) await putMany("library", add.slice(i, i + 50));
    got.library = add.length;
  }
  if (Array.isArray(b.comments)) { const ids = have(await all("comments"), "id"), add = b.comments.filter((c) => c && c.id && !ids.has(c.id)); await putMany("comments", add); got.comments = add.length; }
  if (Array.isArray(b.seqs)) { const ids = have(await all("seqs"), "id"), add = b.seqs.filter((x) => x && x.id && !ids.has(x.id)); await putMany("seqs", add); got.seqs = add.length; }
  return got;
}
// is there anything here yet? (a fresh install has no library, no comments and no settings)
export async function isEmpty() {
  const [lib, com, s] = await Promise.all([all("library"), all("comments"), chrome.storage.local.get(null)]);
  return !lib.length && !com.length && !Object.keys(s).some((k) => !PRIVATE_LOCAL.has(k));
}
