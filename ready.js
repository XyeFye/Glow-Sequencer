// Glow Theme — runs after every other content script on the page: the extension's layout is in place, so the page can
// fade in (content.js keeps it hidden until now, so the plain site doesn't flash up first).
document.dispatchEvent(new CustomEvent("osg:laid-out"));
