// ============================================
// BACKGROUND SERVICE WORKER
//
// Owns the mini player's own window: opens it, keeps it to one, and gets it
// out of the way while its video is pinned — then puts it back exactly as it
// was afterwards.
//
// A picture-in-picture window belongs to the document that asked for it —
// close that document and the floating player goes with it. The pin
// sidesteps that: it floats from a page of the extension's own that has no
// window at all (THE FLOATING PLAYER WITH NO WINDOW, below), and the mini
// player window closes. When that player is not ready, the pin falls back to
// the browser's picture-in-picture from the mini player's page, which then
// has to stay — so its window is minimized, and comes back with the video.
//
// All of that needs chrome.windows, chrome.tabs and chrome.offscreen, and
// content scripts have none of them. The tab to act on is not passed in: it
// is read from sender.tab, which the browser fills in for a content script's
// message. Nothing here trusts the message beyond its type, a video id
// checked against VIDEO_ID, and numbers (a time, a volume, a speed) that are
// bounded here before they go anywhere.
// ============================================

// Kept in step with WINDOW_MESSAGES in detach.js — a service worker and a
// content script share no module, so the strings are written twice.
const MESSAGES = {
  HIDE: 'wle-mini-window-hide',
  SHOW: 'wle-mini-window-show',
  OPEN: 'wle-mini-window-open',
  FLOAT_PREPARE: 'wle-float-prepare',
  FLOAT_PIN: 'wle-float-pin',
  FLOAT_UNPIN: 'wle-float-unpin'
};

// Sent to a mini player page, which is not a message the worker listens for.
const FLOAT_ENDED = 'wle-float-ended';

const MINI_WINDOW = {
  MARKER: 'wle-mini',        // detach.js recognises the window by this hash
  SIZE_KEY: 'miniWindowSize',
  OPENED_KEY: 'miniOpened',  // every YouTube tab watches this one
  WIDTH: 560,
  HEIGHT: 340,
  MIN_WIDTH: 320,
  MIN_HEIGHT: 200,
  MAX_START: 24 * 60 * 60    // a day, which no video is
};

// Same rule as url-utils.js: eleven characters of the YouTube id alphabet and
// nothing else. The id arrives from a page, so it is built into a URL here
// rather than taken as one.
const VIDEO_ID = /^[\w-]{11}$/;

/** Where the one open mini player is remembered, across worker restarts. */
const OPEN_KEY = 'wleMiniWindow';

/** By its tab and its window: the window is what chrome.windows.onRemoved reports. */
async function rememberMiniPlayer(tabId, videoId, windowId) {
  await chrome.storage.session.set({ [OPEN_KEY]: { tabId, videoId, windowId } });
}

/** The mini player that is open, if one still is: it may have been closed by hand since. */
async function currentMiniPlayer() {
  const data = await chrome.storage.session.get(OPEN_KEY);
  const open = data?.[OPEN_KEY];
  if (typeof open?.tabId !== 'number') return null;

  const live = await chrome.tabs.get(open.tabId).catch(() => null);
  if (live) return open;

  await chrome.storage.session.remove([OPEN_KEY, stateKey(open.tabId)]);
  return null;
}

/**
 * Requests are served one at a time.
 *
 * Two clicks in quick succession arrive as two messages, and both would look
 * for an open window before either had made one — two windows for one video,
 * which is the duplicate all of this exists to prevent, and the second
 * soundtrack the user reported. Measured: two requests in one tick, two
 * windows.
 *
 * Minimizing and restoring wait their turn in the same line: a restore that
 * overtook the minimize would come back up first and then go down.
 */
let pending = Promise.resolve();

function inTurn(task) {
  const run = pending.catch(() => {}).then(task);
  pending = run.catch(() => {});
  return run;
}

/** A number from a page, kept between min and max; fallback when it is not one. */
function bounded(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

/** Whole seconds, bounded: it goes into a URL, and it arrived from a page. */
function startSeconds(startAt) {
  return Math.floor(bounded(startAt, 0, MINI_WINDOW.MAX_START, 0));
}

/**
 * One mini player, not one per click.
 *
 * A second window is a second soundtrack playing from somewhere you cannot
 * see, and another window to hunt down and close. Asking for the video that is
 * already in there brings that window forward; asking for another one opens
 * it in a new window that takes the old one's place.
 *
 * @param {string} videoId
 * @param {number} [startAt] seconds to resume from — where the page that asked
 *   for this had got to, so the window picks the video up rather than
 *   restarting it.
 */
async function serveMiniWindow(videoId, startAt) {
  if (!VIDEO_ID.test(String(videoId || ''))) throw new Error('not a video id');
  const seconds = startSeconds(startAt);

  // Every YouTube tab watches this, so the one playing the same video can
  // stop: the point of the mini player is to move a video, not to clone it.
  const announce = () =>
    chrome.storage.local.set({ [MINI_WINDOW.OPENED_KEY]: { videoId, at: Date.now() } });

  // A video already floating with no window behind it: the next one plays in
  // that same floating window. Opening a mini player beside it would be a
  // second soundtrack, and a window the floating player exists to avoid.
  const floating = await floatingVideo();
  if (floating) {
    const port = await embedPort();
    if (port) {
      // The one already floating is left alone: loading it again would only
      // take it back to where the asking page was — usually the start.
      if (floating !== videoId) {
        port.postMessage({ type: 'command', cmd: 'load', arg: { videoId, start: seconds } });
        await chrome.storage.session.set({ [FLOAT.KEY]: { videoId } });
      }
      await announce();
      return;
    }
    // No embed answering: whatever floated is gone. Forget it, and open a
    // mini player as usual.
    await chrome.storage.session.remove(FLOAT.KEY);
    await closeFloatDocument();
  }

  const open = await currentMiniPlayer();
  if (open?.videoId === videoId) {
    const minimized = await minimizedState(open.tabId);
    // A window kept minimized only so that Chrome would not quit (see
    // retireMiniWindow) held a video that has since stopped floating — past
    // the branch above nothing floats — and is replaced like any other.
    // Pinned the fallback way, it is already floating above everything:
    // raising its window would only cover what you were doing. Otherwise it
    // comes forward, the way it was.
    if (!minimized?.retired) {
      if (!minimized) await showMiniPlayer(open.tabId, true);
      await announce();
      return;
    }
  }

  const data = await chrome.storage.local.get({ [MINI_WINDOW.SIZE_KEY]: null });
  const saved = data?.[MINI_WINDOW.SIZE_KEY];
  const width = Math.max(MINI_WINDOW.MIN_WIDTH,
    Math.round(Number(saved?.width) || MINI_WINDOW.WIDTH));
  const height = Math.max(MINI_WINDOW.MIN_HEIGHT,
    Math.round(Number(saved?.height) || MINI_WINDOW.HEIGHT));
  const resume = seconds > 0 ? `&t=${seconds}s` : '';

  const win = await chrome.windows.create({
    url: `https://www.youtube.com/watch?v=${videoId}${resume}#${MINI_WINDOW.MARKER}`,
    type: 'popup',
    width,
    height,
    focused: true
  });

  const tabId = win?.tabs?.[0]?.id;
  if (typeof tabId === 'number') await rememberMiniPlayer(tabId, videoId, win.id);

  // The old one goes once the new one is up: were it the last window, Chrome
  // would quit in between.
  if (open) await forgetMiniPlayer(open.tabId);

  // After the window exists, so that a create that failed does not leave a
  // tab paused for a mini player that never opened.
  await announce();
}

/** A mini player replaced by another: its window, and what was kept about it. */
async function forgetMiniPlayer(tabId) {
  await chrome.storage.session.remove(stateKey(tabId));
  await chrome.tabs.remove(tabId).catch(() => {});
}

/**
 * Where a minimized mini player window's earlier state is kept, keyed by its
 * tab's id. chrome.storage.session, not a variable: this worker is stopped
 * after a short idle and everything in memory goes with it, while a pinned
 * video can float for hours. Session storage is per browser run and never
 * reaches the disk.
 */
const stateKey = (tabId) => `wleMinimized:${tabId}`;

async function minimizedState(tabId) {
  const key = stateKey(tabId);
  const data = await chrome.storage.session.get(key);
  return data?.[key] || null;
}

/**
 * The fallback pin: the video floats in the browser's picture-in-picture from
 * the mini player's own page, so that page has to stay, and its window is put
 * as far out of the way as an extension can put a window — minimized.
 * Measured: that picture-in-picture keeps its full frame rate with its page
 * hidden. Only the mini player's own window: one of the user's is theirs.
 *
 * @param {boolean} [retired] minimized only so that Chrome does not quit with
 *   its last window — the video floats from elsewhere (retireMiniWindow).
 */
async function hideMiniPlayer(tabId, { retired = false } = {}) {
  const tab = await chrome.tabs.get(tabId);
  const win = await chrome.windows.get(tab.windowId);
  // Already down: what it was before is already kept, and "minimized" is not
  // a state to come back to.
  if (win.type !== 'popup' || win.state === 'minimized') return;

  // A window the user had maximized must not come back merely "normal".
  await chrome.storage.session.set({
    [stateKey(tabId)]: { state: win.state === 'maximized' ? 'maximized' : 'normal', retired }
  });
  await chrome.windows.update(win.id, { state: 'minimized' });
}

/**
 * The video is back: the window comes back up, the way it was, if it went
 * down at all. focused: false is never sent: it does not mean "leave the focus alone", it
 * hands the focus to whatever window is next.
 *
 * @param {boolean} focused whether to raise it — only when a person asked for
 *   the video back.
 */
async function showMiniPlayer(tabId, focused) {
  const saved = await minimizedState(tabId);
  await chrome.storage.session.remove(stateKey(tabId));

  const tab = await chrome.tabs.get(tabId);
  const win = await chrome.windows.get(tab.windowId);

  const update = {};
  if (win.state === 'minimized') update.state = saved?.state || 'normal';
  if (focused) update.focused = true;
  if (Object.keys(update).length) await chrome.windows.update(win.id, update);
}

// ============================================
// THE FLOATING PLAYER WITH NO WINDOW
//
// The browser's own picture-in-picture closes with the document that opened
// it. Opened from the mini player's page, that page must stay somewhere — a
// window, or a tab in the user's browser window — and closing the browser
// closes it. So the pin opens it from somewhere the user cannot close: an
// offscreen document (float.html) holding a YouTube embed of the same video.
// No window, no tab, nothing in the taskbar. The "background" permission
// keeps Chrome running when its last window closes, and the video with it —
// while Chrome's own "Continue running background apps" setting is on.
//
// The catch is that picture-in-picture is only granted in answer to a click,
// and an offscreen document never gets one. The click on Pin on top happens
// in the mini player's page; its message to this worker carries the gesture,
// and a message sent on while handling it carries it on — so the pin message
// is forwarded to the embed synchronously, over a port the embed keeps open,
// and the embed opens the window. Measured in Chromium: 30 frames a second,
// no window anywhere, and it outlives the window it was asked for from.
//
// Getting ready takes seconds (the embed loads the video), so it happens
// while the mini player is open, before anyone reaches for the button.
// ============================================
const FLOAT = {
  DOC: 'float.html',
  TARGET: 'wle-float',            // what float.js answers to
  EMBED_PORT: 'wle-float-embed',  // float-embed.js
  REMOTE_PORT: 'wle-remote',      // the popup's remote control
  KEY: 'wleFloating',             // session: the video floating, if one is
  RULE_ID: 1,
  // Long enough for the window to open, short enough that the mini player
  // can still use the same click for the old way if this one fails.
  PIN_TIMEOUT: 2500
};

const Floating = {
  port: null,         // to the embed's content script
  status: null,       // its last report: { embedId, ready, pinned, state }
  loading: null,      // the video the page was last asked to load
  remotes: new Set(), // open remote controls
  pinWaiter: null
};

/** The video floating with no window behind it, if any. */
async function floatingVideo() {
  const data = await chrome.storage.session.get(FLOAT.KEY);
  return data?.[FLOAT.KEY]?.videoId || null;
}

/**
 * The port to the embed. The worker may have been restarted since, and the
 * embed reconnects within a moment: give it that moment.
 */
async function embedPort(wait = 1500) {
  const until = Date.now() + wait;
  while (!Floating.port && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return Floating.port;
}

/**
 * An embed loaded from an extension page sends no Referer, and YouTube
 * refuses to play an embed it cannot place (its "Error 153"). This gives the
 * floating player's embed one — only requests made outside any tab, which is
 * where an offscreen document's are, so no embed on any website is touched.
 * Session rules go with the browser, so it is set again whenever needed.
 */
async function ensureReferer() {
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [FLOAT.RULE_ID],
    addRules: [{
      id: FLOAT.RULE_ID,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [{ header: 'referer', operation: 'set', value: 'https://www.youtube.com/' }]
      },
      condition: {
        urlFilter: '|https://www.youtube.com/embed/',
        resourceTypes: ['sub_frame'],
        tabIds: [chrome.tabs.TAB_ID_NONE],
        initiatorDomains: [chrome.runtime.id]
      }
    }]
  });
}

async function hasFloatDocument() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  return contexts.length > 0;
}

/**
 * IFRAME_SCRIPTING is what this page truthfully does, and it matters which
 * reasons are given: with AUDIO_PLAYBACK alone, Chrome closes the document
 * thirty seconds after the sound stops — a paused floating video would
 * vanish.
 */
async function ensureFloatDocument() {
  // Only ever called in line (inTurn), so two can never race to create it.
  if (await hasFloatDocument()) return;
  await chrome.offscreen.createDocument({
    url: FLOAT.DOC,
    reasons: ['IFRAME_SCRIPTING', 'AUDIO_PLAYBACK'],
    justification: 'Plays the pinned video in the browser\'s picture-in-picture window without keeping a tab or a window open for it.'
  });
}

async function closeFloatDocument() {
  Floating.status = null;
  Floating.loading = null;
  if (await hasFloatDocument()) await chrome.offscreen.closeDocument().catch(() => {});
}

/** The mini player is open on this video: have the floating one ready. */
async function prepareFloating(videoId, start) {
  if (!VIDEO_ID.test(String(videoId || ''))) return;
  // One already floating is not replaced from a mini player's page.
  if (await floatingVideo()) return;

  // What was asked for, not what was last reported: an embed being replaced
  // still reports the video it is leaving until the new one connects. The
  // report only stands in after a worker restart, which forgets the asking.
  const status = Floating.status;
  const asked = Floating.loading ?? (status?.state?.videoId || status?.embedId);
  if (asked === videoId && await hasFloatDocument()) return;

  await ensureReferer();
  await ensureFloatDocument();
  Floating.loading = videoId;
  await chrome.runtime.sendMessage({ target: FLOAT.TARGET, type: 'load', videoId, start }).catch(() => {});
}

/** Nothing needs the floating player any more: free what it holds. */
async function releaseFloating() {
  if (await floatingVideo()) return;
  await closeFloatDocument();
}

/**
 * The floating window closed. Only "Back to mini player" — the remote's, or
 * the note in a mini player window kept behind it — sets report.reopen: the
 * video goes back into a mini player window, at the second it had reached.
 * The window's own buttons, its × and its way back to a tab it does not have,
 * mean the video is done.
 */
async function leftFloating(report) {
  // A window that opened too late, once the mini player had pinned the old
  // way, never was the floating player: the embed has gone quiet by itself,
  // and stays ready for the next pin.
  if (!(await floatingVideo())) return;

  const videoId = report.state?.videoId || report.embedId;
  const time = report.state?.time || 0;

  await stopFloating();
  const old = await currentMiniPlayer();
  const kept = old && (await minimizedState(old.tabId))?.retired;

  if (!report.reopen || !VIDEO_ID.test(String(videoId || ''))) {
    // A mini player window kept minimized only so that Chrome would not quit
    // (see retireMiniWindow) has nothing left to do once another window
    // keeps Chrome open.
    if (kept && (await otherWindows(old.tabId))) await forgetMiniPlayer(old.tabId);
    return;
  }

  // That window is replaced by a fresh one at the second the video had
  // reached — the new one first, so that Chrome never finds itself with no
  // window to stay open for.
  await chrome.storage.session.remove(OPEN_KEY);
  await serveMiniWindow(videoId, time);
  if (old) await forgetMiniPlayer(old.tabId);
}

/** The floating video goes, with the page that holds it. */
async function stopFloating() {
  await chrome.storage.session.remove(FLOAT.KEY);
  await closeFloatDocument();
  relayToRemotes({ type: 'state', floating: false });
  // A mini player window kept behind the floating video says the video is
  // there: it is not any more.
  const open = await currentMiniPlayer();
  if (open) chrome.tabs.sendMessage(open.tabId, { type: FLOAT_ENDED }).catch(() => {});
}

/**
 * Some videos YouTube will not play in an embed. Asked for while one floats,
 * such a video would leave a dead picture floating; it goes to a mini player
 * window instead, which plays it on YouTube's own page.
 */
async function floatingLoadFailed(report) {
  const videoId = String(report.videoId || '');
  if (!VIDEO_ID.test(videoId) || (await floatingVideo()) !== videoId) return;
  console.info('WLE: YouTube would not play this video in the floating player; opening a mini player instead');
  await stopFloating();
  await serveMiniWindow(videoId, report.start);
}

/**
 * Whether a window other than this tab's is open — one that keeps Chrome
 * running if this one closes. A picture-in-picture window does not: it
 * closes with the page that opened it.
 */
async function otherWindows(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return false;
  return (await chrome.windows.getAll()).some((win) => win.id !== tab.windowId && !win.alwaysOnTop);
}

/**
 * Once the video floats the mini player window has nothing left to do, and
 * goes — unless it is the last window open. The "background" permission keeps
 * Chrome running after its last window only while Chrome's own "Continue
 * running background apps" setting is on, which an extension cannot read; with
 * it off, closing that window would quit Chrome and the floating video with
 * it. So the last one is minimized instead, and closing it is the user's call.
 */
async function retireMiniWindow(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return;
  // Only the mini player's own window: a tab of the user's is theirs, and
  // its page has already paused itself.
  const own = await chrome.windows.get(tab.windowId).catch(() => null);
  if (own?.type !== 'popup') return;

  if (await otherWindows(tabId)) {
    await forgetMiniPlayer(tabId);
    return;
  }
  await hideMiniPlayer(tabId, { retired: true }).catch(() => {});
}

function relayToRemotes(message) {
  for (const remote of Floating.remotes) {
    try {
      remote.postMessage(message);
    } catch {
      Floating.remotes.delete(remote);
    }
  }
}

function onEmbedMessage(message) {
  switch (message?.type) {
    case 'status':
    case 'state':
      Floating.status = message;
      relayToRemotes({ type: 'state', floating: message.pinned === true, status: message });
      if (message.type === 'status') reconcile(message);
      break;
    case 'pin-result':
      Floating.pinWaiter?.(message.ok === true, message.reason);
      break;
    case 'left':
      Floating.status = message;
      inTurn(() => leftFloating(message));
      break;
    case 'load-failed':
      inTurn(() => floatingLoadFailed(message));
      break;
    default:
      break;
  }
}

/**
 * The embed says, as it connects, that nothing floats — while a video is
 * recorded as floating. A report that it left can be lost: posted to a
 * worker already stopping, before the port knew it was gone. Without this the
 * next video would load into a page nobody can see, and play there. Not on
 * the way back to the mini player: that report is still to come.
 */
async function reconcile(report) {
  if (report.pinned !== false || report.leaving || Floating.pinWaiter) return;
  if (!(await floatingVideo())) return;
  inTurn(() => leftFloating({ ...report, reopen: false }));
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === FLOAT.EMBED_PORT) {
    // Only the embed inside our own offscreen document: a frame outside any
    // tab, at a YouTube embed address.
    const url = port.sender?.url || '';
    if (port.sender?.tab || !url.startsWith('https://www.youtube.com/embed/')) {
      port.disconnect();
      return;
    }
    Floating.port = port;
    // Only the current embed is listened to: one being replaced can still be
    // talking about the video it is leaving.
    port.onMessage.addListener((message) => {
      if (Floating.port === port) onEmbedMessage(message);
    });
    // In this same worker a port only goes when its frame does — a reloaded
    // or closed embed — so what it said about being ready goes with it.
    // (A worker stopped for idling takes everything in memory anyway.)
    port.onDisconnect.addListener(() => {
      if (Floating.port !== port) return;
      Floating.port = null;
      Floating.status = null;
    });
    watchIfWanted();
    return;
  }

  if (port.name === FLOAT.REMOTE_PORT) {
    if (!String(port.sender?.url || '').startsWith(chrome.runtime.getURL(''))) {
      port.disconnect();
      return;
    }
    Floating.remotes.add(port);
    port.onDisconnect.addListener(() => {
      Floating.remotes.delete(port);
      if (!Floating.remotes.size) Floating.port?.postMessage({ type: 'watch', on: false });
    });
    port.onMessage.addListener((message) => onRemoteMessage(message));
    watchIfWanted();
    floatingVideo().then((videoId) => {
      try {
        port.postMessage({ type: 'state', floating: Boolean(videoId), status: Floating.status });
      } catch {
        // Closed already.
      }
    });
  }
});

/**
 * State twice a second, but only for a remote control that is open on a video
 * that floats: a popup opened beside a mini player that is only getting the
 * floating player ready has nothing to show.
 */
async function watchIfWanted() {
  if (!Floating.port || !Floating.remotes.size || !(await floatingVideo())) return;
  try {
    Floating.port.postMessage({ type: 'watch', on: true });
  } catch {
    // The embed went in the meantime; it says so when it is back.
  }
}

const REMOTE_COMMANDS = new Set(['play', 'pause', 'seek', 'seekBy', 'volume', 'mute', 'rate', 'quality', 'load', 'unpin', 'stop']);

function onRemoteMessage(message) {
  const cmd = String(message?.cmd || '');
  if (!REMOTE_COMMANDS.has(cmd)) return;
  if (cmd === 'load') {
    // The next video is a mini player request like any other: it lands in
    // the floating window when one is open.
    const videoId = String(message.arg?.videoId || '');
    if (VIDEO_ID.test(videoId)) inTurn(() => serveMiniWindow(videoId, 0));
    return;
  }
  Floating.port?.postMessage({ type: 'command', cmd, arg: message.arg });
}

/**
 * Only the content script on a YouTube page has any business moving a window
 * about. Other extensions' messages arrive at onMessageExternal, which this
 * worker does not listen to — but an extension page of our own reaches this
 * listener, and moving whatever tab happens to ask is not a behaviour worth
 * leaving lying around.
 */
function isFromYouTubeTab(sender) {
  return typeof sender?.tab?.id === 'number' &&
    /^https?:\/\/([\w-]+\.)*youtube\.com\//.test(sender?.url || '');
}

/**
 * The click on Pin on top, still in hand. Everything up to postMessage is
 * synchronous: an await before it would let the gesture go, and the embed
 * would be refused its window.
 */
function pinFloating(message, sender, sendResponse) {
  // A double click is one pin. The page treats this answer as "already
  // under way", not as a refusal to fall back from.
  if (Floating.pinWaiter) {
    sendResponse({ ok: false, busy: true });
    return false;
  }

  const status = Floating.status;
  const ready = Floating.port && status?.ready &&
    (status.state?.videoId || status.embedId) === message.videoId;

  if (!ready) {
    console.info('WLE: the floating player is not ready, pinning the old way');
    sendResponse({ ok: false, reason: 'not ready' });
    return false;
  }

  // The mini player's sound, speed and pause come along: whoever muted it or
  // set it to 1.5× did not mean the floating player to undo that.
  const sound = message.sound || {};
  Floating.port.postMessage({
    type: 'pin',
    time: bounded(message.time, 0, MINI_WINDOW.MAX_START, 0),
    muted: sound.muted === true,
    volume: bounded(sound.volume, 0, 100, 100),
    rate: bounded(sound.rate, 0.0625, 16, 1),
    paused: sound.paused === true
  });

  const tabId = sender.tab.id;
  const port = Floating.port;
  new Promise((resolve) => {
    Floating.pinWaiter = (ok, reason) => resolve({ ok, reason });
    setTimeout(() => resolve({ ok: false, reason: 'no answer', late: true }), FLOAT.PIN_TIMEOUT);
  }).then(async ({ ok, reason, late }) => {
    Floating.pinWaiter = null;
    sendResponse({ ok });
    if (!ok) {
      console.info('WLE: the floating player could not pin, pinning the old way —', reason);
      // The page is pinning the old way now; a window that opens late here
      // would take its place, or play beside it.
      if (late) {
        try {
          port.postMessage({ type: 'pin-cancel' });
        } catch {
          // Gone with its frame: nothing left to cancel.
        }
      }
      return;
    }

    // In line, and queued before anything else can be: a floating window
    // closed the moment it opened reports so next, and must find it recorded.
    // Recorded before the mini player window goes, so its closing is not
    // taken for the end of the floating player too.
    await inTurn(async () => {
      await chrome.storage.session.set({ [FLOAT.KEY]: { videoId: message.videoId } });
      await retireMiniWindow(tabId);
    });
    relayToRemotes({ type: 'state', floating: true, status: Floating.status });
    watchIfWanted();
  });
  return true;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = message && message.type;

  // Answered first and without waiting in line: see pinFloating.
  if (type === MESSAGES.FLOAT_PIN) {
    if (!isFromYouTubeTab(sender)) {
      sendResponse({ ok: false, reason: 'not a youtube window' });
      return false;
    }
    return pinFloating(message, sender, sendResponse);
  }

  if (type === MESSAGES.FLOAT_PREPARE) {
    if (!isFromYouTubeTab(sender)) return false;
    inTurn(async () => {
      // Only the mini player this worker opened: any other page carrying its
      // marker would take the one floating player over from it.
      if ((await currentMiniPlayer())?.tabId !== sender.tab.id) return;
      await prepareFloating(String(message.videoId || ''), startSeconds(message.time));
    }).catch((error) => {
      console.info('WLE: the floating player could not be prepared —', error?.message);
    });
    return false;
  }

  // "Bring the video back" from a mini player window kept behind a floating
  // video: the same as the remote's "Back to mini player". The answer says
  // whether anything was floating, so a page whose video has already gone
  // just comes back as it was.
  if (type === MESSAGES.FLOAT_UNPIN) {
    if (!isFromYouTubeTab(sender)) return false;
    inTurn(async () => {
      if ((await currentMiniPlayer())?.tabId !== sender.tab.id) return false;
      if (!(await floatingVideo())) return false;
      const port = await embedPort();
      if (port) {
        port.postMessage({ type: 'command', cmd: 'unpin' });
        return true;
      }
      // Recorded as floating, but nothing answers: it is gone.
      await stopFloating();
      return false;
    }).then(
      (floating) => sendResponse({ floating }),
      () => sendResponse({ floating: false })
    );
    return true;
  }

  // Opening a mini player is the one thing the popup asks for too, and the
  // popup is an extension page with no sender.tab — so it is answered before
  // the window checks below, which are about moving an existing window.
  if (type === MESSAGES.OPEN) {
    inTurn(() => serveMiniWindow(message.videoId, message.startAt)).then(
      () => sendResponse({ ok: true }),
      (error) => {
        console.info('WLE: could not open the mini player —', error?.message);
        sendResponse({ ok: false, reason: error?.message || 'failed' });
      }
    );
    return true;
  }

  if (type !== MESSAGES.HIDE && type !== MESSAGES.SHOW) return false;

  if (!isFromYouTubeTab(sender)) {
    sendResponse({ ok: false, reason: 'not a youtube window' });
    return false;
  }
  const tabId = sender.tab.id;

  const work = inTurn(() => type === MESSAGES.HIDE
    ? hideMiniPlayer(tabId)
    // Raising the window is only right when a person asked for the video
    // back; a player that closed itself must not interrupt them.
    : showMiniPlayer(tabId, message.focus === true));

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

// A mini player window closed by hand leaves notes behind saying it is open,
// or minimized. Clearing them is what lets the next click open a window
// instead of trying to focus one that is not there. Popup windows only: the
// mini player is one, and closing an ordinary tab or window does not wake
// this worker.
chrome.windows.onRemoved.addListener(async (windowId) => {
  const data = await chrome.storage.session.get(OPEN_KEY);
  const open = data?.[OPEN_KEY];
  if (open?.windowId !== windowId) return;
  await chrome.storage.session.remove([OPEN_KEY, stateKey(open.tabId)]);
  // The floating player was being kept ready for this mini player. Unless
  // it is the one floating now, nothing needs it.
  inTurn(() => releaseFloating());
}, { windowTypes: ['popup'] });

// The mini player switched off in Settings: a video floating with no window
// behind it has no page left that would hear about it, so it is stopped here.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.detachEnabled?.newValue === false) inTurn(() => stopFloating());
});
