// ============================================
// BACKGROUND SERVICE WORKER
//
// One job: get the mini player's own window out of the way while its video is
// pinned, and bring it back when it is not.
//
// A document picture-in-picture window belongs to the document that asked for
// it — close that document and the floating player goes with it. So the window
// the popup opened cannot be closed while the video floats above it; the best
// that can be done is to minimize it, which needs chrome.windows, and content
// scripts have no access to that API.
//
// The window to act on is not passed in: it is read from sender.tab, which the
// browser fills in for a content script's message. Nothing here trusts the
// message for anything but its type.
// ============================================

const MESSAGES = {
  HIDE: 'wle-mini-window-hide',
  SHOW: 'wle-mini-window-show'
};

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

  const state = type === MESSAGES.HIDE
    ? { state: 'minimized' }
    : { state: 'normal', focused: true };

  chrome.windows.update(windowId, state, () => {
    // A window the user closed in the meantime is not an error worth shouting
    // about: the caller only ever uses this as a courtesy.
    const error = chrome.runtime.lastError;
    if (error) console.info('WLE: mini player window not updated —', error.message);
    sendResponse({ ok: !error });
  });

  return true; // the response goes out after the callback
});
