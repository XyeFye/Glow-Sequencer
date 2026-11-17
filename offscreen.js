// Glow Theme — a hidden page that turns the backup text into a file the downloads list can save (background.js asks).
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !m) return false;
  if (m.type === "osg-offscreen:blob") { reply({ url: URL.createObjectURL(new Blob([String(m.text || "")], { type: "application/json" })) }); return false; }
  if (m.type === "osg-offscreen:revoke") { try { URL.revokeObjectURL(m.url); } catch (e) {} reply({ ok: true }); return false; }
  return false;
});
