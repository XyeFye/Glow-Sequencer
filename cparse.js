// Glow Theme for Online Sequencer — reads the site's comment markup (a sequence's comment list, as the site renders it
// in the Comments panel and as /ajax/get_comments.php returns it). Shared by the content script and the search page.
(function () {
  "use strict";
  const num = (s) => (String(s || "").match(/\d+/) || [""])[0];
  function parseDate(s) {   // "11/14/26 6:11" (month/day/two-digit year, 24-hour clock)
    const m = String(s || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})/); if (!m) return 0;
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    return new Date(y, +m[1] - 1, +m[2], +m[4], +m[5]).getTime() || 0;
  }
  function textOf(msg) {   // the message as plain text, line breaks kept
    if (!msg) return "";
    const c = msg.cloneNode(true); for (const br of c.querySelectorAll("br")) br.replaceWith("\n");
    return (c.textContent || "").replace(/ /g, " ").replace(/[ \t]+\n/g, "\n").trim();
  }
  function one(el) {
    const id = (el.className.match(/\bcomment-(\d+)\b/) || [])[1]; if (!id) return null;
    const a = el.querySelector(":scope > .info .name a[href*='/members/']");
    const img = el.querySelector(":scope > .info .member-image");
    const msg = el.querySelector(":scope > .message");
    const date = (el.querySelector(":scope > .info .date")?.textContent || "").trim();
    return {
      id, uid: a ? num(a.getAttribute("href").match(/\/members\/(\d+)/)?.[1]) : "", name: a ? (a.getAttribute("data-user") || a.textContent || "").trim() : "",
      avatar: ((img?.getAttribute("style") || "").match(/url\((['"]?)([^'")]+)\1\)/) || [])[2] || "",
      date, ts: parseDate(date), text: textOf(msg),
      links: msg ? [...msg.querySelectorAll("a[href]")].map((x) => x.getAttribute("href")).filter((h) => /^https?:|^\//.test(h)).slice(0, 20) : [],
    };
  }
  // root: an element or a document holding the comment list → every comment, with the comment it replies to
  function parse(root) {
    const out = [], byId = new Map();
    for (const el of root.querySelectorAll(".chat[class*='comment-']")) { const c = one(el); if (c) { out.push(c); byId.set(c.id, c); c._el = el; } }
    for (const c of out) {
      const wrap = c._el.closest(".comment-replies"); delete c._el;
      const pid = wrap ? (wrap.className.match(/\bcomment-replies-(\d+)\b/) || [])[1] : "";
      c.parent = pid || ""; const p = pid ? byId.get(pid) : null;
      c.parentName = p ? p.name : ""; c.parentUid = p ? p.uid : ""; c.parentText = p ? p.text.slice(0, 200) : "";
    }
    return out;
  }
  function parseHtml(html) { return parse(new DOMParser().parseFromString(`<div>${html}</div>`, "text/html")); }
  globalThis.osgComments = { parse, parseHtml, parseDate };
})();
