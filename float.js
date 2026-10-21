// ============================================
// FLOATING PLAYER HOST (offscreen document)
//
// The browser's picture-in-picture window belongs to the document that opened
// it and closes with it. Opened from a tab or a window, it dies when the user
// closes their browser window. Opened from here it does not: an offscreen
// document is no window and no tab, so nothing the user closes reaches it.
//
// This page only loads and unloads the embed. The content scripts inside the
// embed (float-embed.js, float-embed-main.js) talk to the service worker and
// drive the player; the worker decides when this page exists at all.
// ============================================

const FLOAT_TARGET = 'wle-float';
const VIDEO_ID = /^[\w-]{11}$/;
const frame = document.getElementById('player');

/**
 * Muted autoplay is what gets the video's details loaded, and a video without
 * them cannot enter picture-in-picture: the embed starts muted, and the
 * script inside it pauses it until the pin. wle_float marks the embed as
 * ours, so the content scripts run in this one and in no embed on any other
 * site.
 *
 * widget_referrer says, inside the page, what the worker's rule says in the
 * request's Referer: the player checks where it is embedded from both sides,
 * and an extension page has no web address to give it.
 */
function embedUrl(videoId, start) {
  const params = new URLSearchParams({
    autoplay: '1',
    mute: '1',
    playsinline: '1',
    rel: '0',
    start: String(Math.max(0, Math.floor(Number(start) || 0))),
    widget_referrer: 'https://www.youtube.com/',
    wle_float: '1'
  });
  return `https://www.youtube.com/embed/${videoId}?${params}`;
}

chrome.runtime.onMessage.addListener((message) => {
  // runtime messages are a broadcast: only the ones addressed here count.
  if (message?.target !== FLOAT_TARGET) return false;

  if (message.type === 'load' && VIDEO_ID.test(String(message.videoId || ''))) {
    frame.src = embedUrl(message.videoId, message.start);
  } else if (message.type === 'unload') {
    frame.src = 'about:blank';
  }
  return false;
});
