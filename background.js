// ============================================
// BACKGROUND SERVICE WORKER
//
// One job: get the mini player's own window out of the way while its video is
// pinned, and put it back exactly as it was afterwards.
//
// A document picture-in-picture window belongs to the document that asked for
// it — close that document and the floating player goes with it. So the window
// the popup opened cannot be closed while the video floats above it; the best
// that can be done is to minimize it, which needs chrome.windows, and content
// scripts have no access to that API.
//
// The window to act on is not passed in: it is read from sender.tab, which the
// browser fills in for a content script's message. Nothing here trusts the
// message for anything but its type and the focus flag.
// ============================================

// Kept in step with WINDOW_MESSAGES in detach.js — a service worker and a
// content script share no module, so the strings are written twice.
const MESSAGES = {
  HIDE: 'wle-mini-window-hide',
  SHOW: 'wle-mini-window-show'
};

/** Where the window's pre-minimize state is parked, keyed by window id. */
const stateKey = (windowId) => `wleWinState:${windowId}`;

/**
 * chrome.storage.session, not a variable: this worker is stopped after a short
 * idle and everything in memory goes with it, while a pinned video can float
 * for hours. Session storage is per browser run and never reaches the disk.
 */
function rememberState(windowId, state) {
  return chrome.storage.session.set({ [stateKey(windowId)]: state });
}

async function takeRememberedState(windowId) {
  const key = stateKey(windowId);
  const data = await chrome.storage.session.get(key);
  await chrome.storage.session.remove(key);
  return data?.[key] === 'maximized' ? 'maximized' : 'normal';
}

async function hideWindow(windowId) {
  // A window the user had maximized must not come back merely "normal".
  const win = await chrome.windows.get(windowId);
  await rememberState(windowId, win?.state === 'maximized' ? 'maximized' : 'normal');
  await chrome.windows.update(windowId, { state: 'minimized' });
}

async function showWindow(windowId, focused) {
  const state = await takeRememberedState(windowId);
  await chrome.windows.update(windowId, { state, focused });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = message && message.type;
  if (type !== MESSAGES.HIDE && type !== MESSAGES.SHOW) return false;

  // Only the content script on a YouTube page has any business moving a
  // window about. Nothing outside this extension can reach this listener —
  // there is no externally_connectable — but an extension page of our own
  // could, and minimizing whatever window happens to ask is not a behaviour
  // worth leaving lying around.
  const windowId = sender?.tab?.windowId;
  const fromYouTube = /^https?:\/\/([\w-]+\.)*youtube\.com\//.test(sender?.url || '');

  if (typeof windowId !== 'number' || !fromYouTube) {
    sendResponse({ ok: false, reason: 'not a youtube window' });
    return false;
  }

  const work = type === MESSAGES.HIDE
    ? hideWindow(windowId)
    // Raising the window is only right when a person asked for the video
    // back; a player that closed itself must not interrupt them.
    : showWindow(windowId, message.focus === true);

  work.then(
    () => sendResponse({ ok: true }),
    (error) => {
      // A window the user closed in the meantime is not an error worth
      // shouting about: the caller only ever uses this as a courtesy.
      console.info('WLE: mini player window not updated —', error?.message);
      sendResponse({ ok: false, reason: 'window gone' });
    }
  );

  return true; // the response goes out after the promise settles
});
