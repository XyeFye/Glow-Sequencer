// Glow Theme — one polite queue for the extension's own requests to Online Sequencer.
// The site briefly blocks a browser that asks for too much too fast (and then sequences stop loading), so every extra
// request the extension makes goes through here:
//   - at most two at a time, and a short gap between them — shared by all your Online Sequencer tabs;
//   - what you asked for (pri 0) goes before what's merely nice to have (pri 1) and background work (pri 2, one at a time);
//   - the same page asked for twice at once is fetched once;
//   - if the site says "too many requests" (429) or "busy" (503), every tab pauses for as long as the site asks (or
//     15 s, 30 s, 1 min… up to 5 min), and the request is tried again afterwards instead of failing.
// Loaded in the content-script world, the page world (page-side tools) and the extension's own pages.
(function () {
  "use strict";
  const G = typeof globalThis !== "undefined" ? globalThis : window;
  if (G.__osgNet) return;
  const GAP = 450, MAX = 2;
  const LAST = "osg-net-last", COOL = "osg-net-cool", STRIKES = "osg-net-strikes";
  const ls = {
    get(k) { try { return +localStorage.getItem(k) || 0; } catch (e) { return 0; } },
    set(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) {} },
  };
  // the extension's own pages don't share the site's storage: they share the pause through chrome.storage instead
  const cs = (() => { try { return G.chrome && G.chrome.storage && G.chrome.storage.local ? G.chrome.storage.local : null; } catch (e) { return null; } })();
  let sharedCool = 0;
  if (cs) {
    try { cs.get({ osgNetCool: 0 }, (v) => { sharedCool = +v.osgNetCool || 0; }); } catch (e) {}
    try { G.chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.osgNetCool) { sharedCool = +ch.osgNetCool.newValue || 0; pump(); } }); } catch (e) {}
  }
  const coolUntil = () => Math.max(ls.get(COOL), sharedCool);
  function pause(ms) {
    const until = Date.now() + ms; if (until <= coolUntil()) return;
    ls.set(COOL, until); sharedCool = until;
    if (cs) try { cs.set({ osgNetCool: until }); } catch (e) {}
    try { document.dispatchEvent(new CustomEvent("osg:net-pause", { detail: JSON.stringify({ ms }) })); } catch (e) {}
  }

  const queue = [], inflight = new Map(); let busy = 0, timer = 0, seq = 0;
  function osgFetch(url, opts, pri) {
    opts = opts || {}; pri = pri == null ? 1 : pri;
    const get = !opts.method || /^get$/i.test(opts.method), key = get ? String(url) : null;
    if (key && inflight.has(key)) { const j = inflight.get(key); if (pri < j.pri) { j.pri = pri; sort(); } return j.p.then((r) => r.clone()); }
    const job = { url, opts, pri, n: seq++, tries: 0 };
    job.p = new Promise((res, rej) => { job.res = res; job.rej = rej; });
    queue.push(job); sort();
    if (key) { inflight.set(key, job); job.p.then(() => inflight.delete(key), () => inflight.delete(key)); }
    pump();
    return key ? job.p.then((r) => r.clone()) : job.p;
  }
  const sort = () => queue.sort((a, b) => a.pri - b.pri || a.n - b.n);
  function pump() {
    clearTimeout(timer);
    if (!queue.length || busy >= MAX) return;
    if (queue[0].pri >= 2 && busy > 0) return;   // background work goes one at a time
    const now = Date.now(), wait = Math.max(coolUntil() - now, ls.get(LAST) + GAP - now, 0);
    if (wait > 0) { timer = setTimeout(pump, Math.min(wait + 20, 30000)); return; }
    const job = queue.shift(); busy++; ls.set(LAST, Date.now());
    fetch(job.url, job.opts).then((r) => {
      if (r.status === 429 || r.status === 503) {
        const strikes = Math.min(6, ls.get(STRIKES) + 1); ls.set(STRIKES, strikes);
        const ra = parseFloat(r.headers.get("Retry-After"));
        pause(!isNaN(ra) && ra > 0 ? Math.min(600, ra) * 1000 : Math.min(300000, 15000 * 2 ** (strikes - 1)));
        if (++job.tries <= 3) { queue.unshift(job); sort(); return; }   // try again once the pause is over
      } else if (r.ok && ls.get(STRIKES) && Date.now() > coolUntil() + 60000) ls.set(STRIKES, 0);
      job.res(r);
    }, (e) => job.rej(e)).finally(() => { busy--; pump(); });
    timer = setTimeout(pump, GAP);
  }
  // how long until the extension may ask the site again (0 = now)
  const pausedFor = () => Math.max(0, coolUntil() - Date.now());
  addEventListener("storage", (e) => { if (e.key === COOL || e.key === LAST) pump(); });
  G.__osgNet = { fetch: osgFetch, pausedFor };
})();
