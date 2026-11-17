// Glow Theme — playlists made easy.
// "+ Playlist" (on the Glow player, on For you suggestions and on sequence cards) opens a picker: your playlists, a box to
// find one, and "New playlist" (made with the sequence already in it). A playlist page also gets "Copy to my playlists".
// The changes are made with the site's own requests from the page side (libmain.js), so the site's sign-in key never
// leaves the page; every request goes through the extension's polite queue.
(function () {
  "use strict";
  if (window.top !== window || window.__osgGroups) return;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const net = (u, o, pri) => (window.__osgNet ? window.__osgNet.fetch(u, o, pri) : fetch(u, o));
  const ask = (kind, payload, ms) => (window.__osgArt && window.__osgArt.askPage ? window.__osgArt.askPage(kind, payload || {}, ms || 30000) : Promise.resolve({ ok: false }));
  const toast = (t, s) => (window.__osgToast ? window.__osgToast(t, s) : null);
  const me = () => ((($('#member_username a[href*="/members/"]')?.getAttribute("href")) || "").match(/\d+/) || [])[0] || "";
  const urlOf = (style) => ((style || "").match(/url\((['"]?)([^'")]+)\1\)/) || [])[2] || "";

  // your playlists, read from your profile (kept for 10 minutes, and refreshed after you change one)
  const KEY = () => "osg-mypl:" + me();
  const forget = () => { try { sessionStorage.removeItem(KEY()); } catch (e) {} };
  async function myPlaylists(force) {
    const uid = me(); if (!uid) return null;
    if (!force) try { const c = JSON.parse(sessionStorage.getItem(KEY()) || "null"); if (c && Date.now() - c.at < 600e3) return c.v; } catch (e) {}
    try {
      const r = await net(`/members/${uid}`, null, 0); if (!r.ok) return null;
      const doc = new DOMParser().parseFromString(await r.text(), "text/html");
      const cards = $$(".playlists_list .playlist_preview[data-id]", doc).length ? $$(".playlists_list .playlist_preview[data-id]", doc) : $$(".playlist_preview[data-id]", doc);
      const v = cards.filter((p) => !p.classList.contains("add_featured")).map((p) => ({ id: p.dataset.id, t: $(".playlist_preview_title", p)?.textContent.trim() || "Playlist", ths: $$("img", p).map((i) => i.getAttribute("src")).filter(Boolean).slice(0, 4), cover: urlOf($(".playlist_preview_thumb", p)?.getAttribute("style")), more: $(".playlist_preview_sequence_wrapper span", p)?.textContent.trim() || "" }));
      try { sessionStorage.setItem(KEY(), JSON.stringify({ at: Date.now(), v })); } catch (e) {}
      return v;
    } catch (e) { return null; }
  }
  async function contains(pid, seq) {
    try { const r = await net(`/playlist/${pid}`, null, 0); return r.ok && new RegExp(`id="sequence_${seq}"`).test(await r.text()); } catch (e) { return false; }
  }
  async function addTo(pid, seq) {
    if (await contains(pid, seq)) return "already";
    const r = await ask("pl", { act: "add", pid, seq }); if (r && r.ok) { forget(); return "added"; }
    return r && r.error === "signin" ? "signin" : "failed";
  }
  async function create(title, seqs, onStep) {
    const r = await ask("pl", { act: "create", title }); if (!r || !r.ok || !r.pid) return { error: (r && r.error) === "signin" ? "signin" : "The site didn't make the playlist." };
    let n = 0; for (const seq of seqs) { const a = await ask("pl", { act: "add", pid: r.pid, seq }); if (a && a.ok) n++; if (onStep) onStep(n, seqs.length); }
    forget(); return { pid: r.pid, added: n };
  }

  // ---- the picker ----
  let pop = null;
  const thumb = (l) => (!l.ths.length && l.cover ? `<span class="osg-grp-th cover" style="background-image:url(&quot;${esc(l.cover)}&quot;)"></span>`
    : `<span class="osg-grp-th">${[0, 1, 2, 3].map((k) => (l.ths[k] ? `<span style="background-image:url(&quot;${esc(l.ths[k])}&quot;)"></span>` : "<span></span>")).join("")}</span>`);
  function close() { if (!pop) return; const p = pop; pop = null; if (window.__osgMotion) window.__osgMotion.close(p); else p.remove(); }
  function place(anchor) {
    const r = anchor.getBoundingClientRect(), w = Math.min(340, innerWidth - 16), h = pop.offsetHeight || 420;
    let left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8), top = r.bottom + 8;
    if (top + h > innerHeight - 8 && r.top - h - 8 > 8) top = r.top - h - 8;
    Object.assign(pop.style, { left: left + "px", top: Math.max(8, Math.min(top, innerHeight - h - 8)) + "px", width: w + "px" });
  }
  async function open(anchor, seq, title) {
    seq = String(seq || "").replace(/\D/g, ""); if (!seq) return;
    if (pop && pop.dataset.seq === seq) { close(); return; } close();
    pop = document.createElement("div"); pop.id = "osg-grp"; pop.dataset.seq = seq; pop.setAttribute("role", "dialog"); pop.setAttribute("aria-label", "Add to a playlist");
    pop.innerHTML = `<header><b>Add to a playlist</b>${title ? `<small>${esc(title)}</small>` : ""}<button type="button" class="osg-grp-x" aria-label="Close">✕</button></header>
      <div class="osg-grp-body"><div class="osg-grp-note">Loading your playlists…</div></div>`;
    document.body.appendChild(pop); place(anchor);
    for (const ev of ["keydown", "keyup", "keypress"]) pop.addEventListener(ev, (e) => { e.stopPropagation(); if (ev === "keydown" && e.key === "Escape") close(); });
    pop.addEventListener("click", (e) => { if (e.target.closest(".osg-grp-x")) close(); });
    if (!me()) { $(".osg-grp-body", pop).innerHTML = `<div class="osg-grp-note">Sign in to Online Sequencer to make playlists.</div>`; return; }
    const lists = await myPlaylists(); if (!pop || pop.dataset.seq !== seq) return;
    const body = $(".osg-grp-body", pop);
    body.innerHTML = `${lists && lists.length > 6 ? `<input class="osg-grp-q" type="search" placeholder="Find a playlist…" aria-label="Find a playlist">` : ""}
      <div class="osg-grp-list">${(lists || []).map((l, i) => `<button type="button" class="osg-grp-row" data-pid="${esc(l.id)}" style="--i:${Math.min(i, 12)}">${thumb(l)}<span class="osg-grp-t"><b>${esc(l.t)}</b><small>${l.more ? esc(l.more.replace(/^\+/, "+ ")) + " more" : ""}</small></span><span class="osg-grp-s">Add</span></button>`).join("") || `<div class="osg-grp-note">${lists ? "You have no playlists yet — make the first one below." : "Couldn't read your playlists right now."}</div>`}</div>
      <form class="osg-grp-new"><input type="text" maxlength="100" placeholder="New playlist name" aria-label="New playlist name" required><button type="submit">＋ Create</button></form>`;
    place(anchor);
    const q = $(".osg-grp-q", pop); if (q) { q.addEventListener("input", () => { const t = q.value.trim().toLowerCase(); $$(".osg-grp-row", pop).forEach((b) => { b.hidden = !!t && !$("b", b).textContent.toLowerCase().includes(t); }); }); q.focus(); }
    body.addEventListener("click", async (e) => {
      const row = e.target.closest(".osg-grp-row"); if (!row || row.dataset.busy) return;
      const st = $(".osg-grp-s", row), link = e.target.closest("a"); if (link) return;
      if (row.dataset.done) { location.href = `/playlist/${row.dataset.pid}#sc`; return; }
      row.dataset.busy = "1"; st.textContent = "Adding…";
      const r = await addTo(row.dataset.pid, seq); delete row.dataset.busy;
      if (r === "added" || r === "already") { row.dataset.done = "1"; row.classList.add("done"); st.innerHTML = r === "added" ? "✓ Added" : "Already in"; row.title = "Open the playlist"; }
      else st.textContent = r === "signin" ? "Sign in first" : "Couldn't add";
    });
    $(".osg-grp-new", pop).addEventListener("submit", async (e) => {
      e.preventDefault(); const inp = $("input", e.currentTarget), btn = $("button", e.currentTarget), name = inp.value.trim(); if (!name) return;
      btn.disabled = inp.disabled = true; btn.textContent = "Making…";
      const r = await create(name, [seq]);
      if (r.error) { btn.disabled = inp.disabled = false; btn.textContent = "＋ Create"; toast(r.error === "signin" ? "Sign in to make playlists." : r.error); return; }
      const list = $(".osg-grp-list", pop); $(".osg-grp-note", list)?.remove();
      list.insertAdjacentHTML("afterbegin", `<button type="button" class="osg-grp-row done" data-pid="${esc(r.pid)}" data-done="1" title="Open the playlist">${thumb({ ths: [], cover: "" })}<span class="osg-grp-t"><b>${esc(name)}</b><small>new</small></span><span class="osg-grp-s">✓ Made</span></button>`);
      inp.value = ""; btn.disabled = inp.disabled = false; btn.textContent = "＋ Create";
      toast(`Made the playlist “${name}” with this sequence in it.`);
    });
  }
  document.addEventListener("pointerdown", (e) => { if (pop && !pop.contains(e.target) && !e.target.closest("[data-osg-grp]")) close(); }, true);
  addEventListener("resize", close);

  // copy a whole playlist (someone else's, or your own) into a new one of yours
  async function copyPlaylist(title, seqs, onStep) { return create(title, seqs, onStep); }

  window.__osgGroups = { open, close, myPlaylists, copyPlaylist, me };
})();
