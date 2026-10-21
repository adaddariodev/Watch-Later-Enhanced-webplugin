// ============================================
// BACKGROUND SERVICE WORKER
//
// Owns the mini player's own window: opens it, keeps it to one, and gets it
// out of the way while its video is pinned — then puts it back exactly as it
// was afterwards.
//
// A picture-in-picture window belongs to the document that asked for it —
// close that document and the floating player goes with it. So the page in
// the mini player window has to outlive the pin. Its window does not: while
// the video floats in the browser's own picture-in-picture, the page is moved
// into the browser window it was opened from, as one more tab, and the mini
// player window closes behind it. One window on screen for one video.
// Unpinning pops the tab back out into a mini player window where the old one
// stood. (The other pin, a document picture-in-picture window with YouTube's
// controls, never asks: see THE PIN, IN TWO FORMS in detach.js.)
//
// All of that needs chrome.windows and chrome.tabs, and content scripts have
// no access to either. The tab to act on is not passed in: it is read from
// sender.tab, which the browser fills in for a content script's message.
// Nothing here trusts the message for anything but its type and the focus
// flag.
// ============================================

// Kept in step with WINDOW_MESSAGES in detach.js — a service worker and a
// content script share no module, so the strings are written twice.
const MESSAGES = {
  HIDE: 'wle-mini-window-hide',
  SHOW: 'wle-mini-window-show',
  OPEN: 'wle-mini-window-open',
  PING: 'wle-mini-window-ping'   // worker → page: are you still the mini player?
};

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

/**
 * By its tab, not its window: pinning moves the tab out of the window it was
 * opened in, and that window closes.
 *
 * @param {number} [home] the browser window it was asked for from — where its
 *   tab goes while the video is pinned.
 */
async function rememberMiniPlayer(tabId, videoId, home) {
  await chrome.storage.session.set({ [OPEN_KEY]: { tabId, videoId, home } });
}

/**
 * The mini player that is open, if one still is.
 *
 * It may have been closed by hand since. And while it is pinned its page is a
 * tab among the user's own, where it can be reloaded or sent somewhere else
 * from the address bar — after which that tab is theirs, not the mini
 * player, and closing it to make room for the next video would close
 * whatever they are reading. So a tab outside its own window only counts
 * while its page still says it is the mini player. One in its own window
 * counts without asking: it may be a window opened a moment ago whose page
 * has not loaded yet, and treating that as gone is how a double click used to
 * open two.
 */
async function currentMiniPlayer() {
  const data = await chrome.storage.session.get(OPEN_KEY);
  const open = data?.[OPEN_KEY];
  if (typeof open?.tabId !== 'number') return null;

  const tab = await chrome.tabs.get(open.tabId).catch(() => null);
  if (tab) {
    const win = await chrome.windows.get(tab.windowId).catch(() => null);
    if (win?.type === 'popup') return open;

    const answer = await chrome.tabs.sendMessage(open.tabId, { type: MESSAGES.PING }).catch(() => null);
    if (answer?.mini === true) return open;
  }

  await forgetMiniPlayer(open.tabId);
  return null;
}

/** Everything remembered about a tab that is no longer the mini player. */
async function forgetMiniPlayer(tabId) {
  await chrome.storage.session.remove([OPEN_KEY, parkKey(tabId)]);
  await chrome.tabs.update(tabId, { autoDiscardable: true }).catch(() => {});
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
 * Pinning and unpinning wait their turn in the same line: they move the same
 * tab between windows, and an unpin that overtook the pin still moving it
 * would look for the tab in a window it had not reached yet.
 */
let pending = Promise.resolve();

function inTurn(task) {
  const run = pending.catch(() => {}).then(task);
  pending = run.catch(() => {});
  return run;
}

/**
 * The browser window someone is working in. The pinned player is listed as a
 * normal window too, and it is the one that just took the focus — it is told
 * apart by floating above the rest.
 */
async function lastBrowserWindow() {
  const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
  return win && !win.alwaysOnTop ? win : null;
}

/**
 * One mini player, not one per click.
 *
 * A second window is a second soundtrack playing from somewhere you cannot
 * see, and another window to hunt down and close. Asking for the video that is
 * already in there brings that window forward; asking for another one puts it
 * in the same window.
 *
 * @param {string} videoId
 * @param {number} [startAt] seconds to resume from — where the page that asked
 *   for this had got to, so the window picks the video up rather than
 *   restarting it.
 * @param {number} [home] the window of the tab that asked, if a tab did.
 */
async function serveMiniWindow(videoId, startAt, home) {
  if (!VIDEO_ID.test(String(videoId || ''))) throw new Error('not a video id');

  // Every YouTube tab watches this, so the one playing the same video can
  // stop: the point of the mini player is to move a video, not to clone it.
  const announce = () =>
    chrome.storage.local.set({ [MINI_WINDOW.OPENED_KEY]: { videoId, at: Date.now() } });

  const open = await currentMiniPlayer();
  if (open) {
    if (open.videoId === videoId) {
      // Pinned, it is already floating above everything, and its window is a
      // tab parked among yours: raising that would only cover what you were
      // doing.
      if (!(await parkedAt(open.tabId))) {
        const tab = await chrome.tabs.get(open.tabId);
        await chrome.windows.update(tab.windowId, { focused: true });
      }
      await announce();
      return;
    }
    // The tab, not its window: pinned, it shares a window with your own tabs.
    await chrome.tabs.remove(open.tabId).catch(() => {});
  }

  const data = await chrome.storage.local.get({ [MINI_WINDOW.SIZE_KEY]: null });
  const saved = data?.[MINI_WINDOW.SIZE_KEY];
  const width = Math.max(MINI_WINDOW.MIN_WIDTH,
    Math.round(Number(saved?.width) || MINI_WINDOW.WIDTH));
  const height = Math.max(MINI_WINDOW.MIN_HEIGHT,
    Math.round(Number(saved?.height) || MINI_WINDOW.HEIGHT));

  // Bounded and whole: it goes into a URL, and it arrived from a page.
  const seconds = Math.min(MINI_WINDOW.MAX_START, Math.max(0, Math.floor(Number(startAt) || 0)));
  const resume = seconds > 0 ? `&t=${seconds}s` : '';

  // Asked for from the popup, there is no tab: the window it hangs from is the
  // one that was in front a moment ago.
  if (typeof home !== 'number') home = (await lastBrowserWindow())?.id;

  const win = await chrome.windows.create({
    url: `https://www.youtube.com/watch?v=${videoId}${resume}#${MINI_WINDOW.MARKER}`,
    type: 'popup',
    width,
    height,
    focused: true
  });

  const tabId = win?.tabs?.[0]?.id;
  if (typeof tabId === 'number') await rememberMiniPlayer(tabId, videoId, home);

  // After the window exists, so that a create that failed does not leave a
  // tab paused for a mini player that never opened.
  await announce();
}

/** Where a pinned player's window stood, keyed by its tab's id. */
const parkKey = (tabId) => `wleParked:${tabId}`;

/**
 * chrome.storage.session, not a variable: this worker is stopped after a short
 * idle and everything in memory goes with it, while a pinned video can float
 * for hours. Session storage is per browser run and never reaches the disk.
 */
async function parkedAt(tabId) {
  const key = parkKey(tabId);
  const data = await chrome.storage.session.get(key);
  return data?.[key] || null;
}

/**
 * Where a pinned player's page waits: the browser window the mini player was
 * opened from, while it is still there, or else any other one of the same
 * kind — a private window's tab cannot move into an ordinary one.
 */
async function browserWindowFor(tab) {
  const open = await currentMiniPlayer();
  const home = open?.tabId === tab.id ? open.home : undefined;

  const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
  const candidates = windows.filter((win) =>
    !win.alwaysOnTop && win.incognito === tab.incognito && win.id !== tab.windowId);

  return candidates.find((win) => win.id === home) || candidates[0] || null;
}

/**
 * Pinned: the video now floats in the browser's own picture-in-picture
 * window, and the mini player window behind it holds nothing to look at — a
 * second window for one video, sitting in the taskbar. Its page still has to
 * stay open, so it moves into a browser window as one more tab, and the mini
 * player window, emptied, closes. Measured: that picture-in-picture stays at
 * full frame rate with its page in a background tab.
 *
 * Two moves rather than one, because Chrome will not move a tab out of a
 * popup window into another window — it will only give that tab a new window
 * of its own. So the tab gets a minimized one, and from there joins the
 * browser window, which empties the stopover and closes it too. Measured: the
 * floating player survives both moves, and the tab arrives in the background,
 * leaving the one you were looking at in front.
 *
 * With nowhere to put the tab, the mini player window is minimized instead.
 */
async function parkMiniPlayer(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const win = await chrome.windows.get(tab.windowId);

  // Already a tab among the user's own — a window that could not be popped
  // back out, say. There is no window of its own to put away, and the one it
  // is in is theirs: minimizing that is not an option.
  if (win.type !== 'popup') return;

  // Recorded first: unpinning reads this to put the window back where it was.
  await chrome.storage.session.set({
    [parkKey(tab.id)]: {
      left: win.left,
      top: win.top,
      width: win.width,
      height: win.height,
      state: win.state === 'maximized' ? 'maximized' : 'normal'
    }
  });

  const target = await browserWindowFor(tab);
  if (target) {
    try {
      // The tab in front there, to give back if the way out selects ours:
      // see unparkMiniPlayer. Kept current while parked by onActivated.
      const [front] = await chrome.tabs.query({ windowId: target.id, active: true });
      await chrome.storage.session.set({
        [parkKey(tab.id)]: { ...(await parkedAt(tab.id)), windowId: target.id, frontTabId: front?.id }
      });

      await chrome.windows.create({ tabId: tab.id, type: 'normal', state: 'minimized', focused: false });
      await chrome.tabs.move(tab.id, { windowId: target.id, index: -1 });
      // A tab out of sight is the first one Chrome discards when memory runs
      // short, and discarding this one would take the floating player with it.
      await chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => {});
      return;
    } catch (error) {
      console.info('WLE: could not move the mini player into a browser window —', error?.message);
    }
  }

  // Wherever the tab got to: the stopover, if the first move went through.
  const current = await chrome.tabs.get(tab.id);
  await chrome.windows.update(current.windowId, { state: 'minimized' });
}

/**
 * The video is back from the floating window: give its page a mini player
 * window again, where the old one stood.
 *
 * @param {boolean} focused whether to raise it — only when a person asked for
 *   the video back.
 */
async function unparkMiniPlayer(tabId, focused) {
  const saved = await parkedAt(tabId);

  const tab = await chrome.tabs.get(tabId);
  const win = await chrome.windows.get(tab.windowId);

  // Still in its own window: minimized rather than moved, or never asked to
  // step aside at all — a pin with YouTube's controls leaves it where it is.
  // Only a minimized one has a state to undo, and a window the user had
  // maximized must not come back merely "normal". focused: false is never
  // sent: it does not mean "leave the focus alone", it hands the focus to
  // whatever window is next.
  if (win.type === 'popup') {
    await chrome.storage.session.remove(parkKey(tabId));
    const update = {};
    if (win.state === 'minimized') update.state = saved?.state || 'normal';
    if (focused) update.focused = true;
    if (Object.keys(update).length) await chrome.windows.update(win.id, update);
    return;
  }

  // A tab among the user's own. Only one this worker parked there is ever
  // taken out of a browser window.
  if (!saved) return;

  await chrome.tabs.update(tabId, { autoDiscardable: true }).catch(() => {});

  // The floating window's button back to the tab selects this tab in the
  // browser window on its way out, so taking it away would leave that window
  // on whichever tab happened to sit next to it.
  const selected = tab.active;

  const size = { tabId, type: 'popup', width: saved.width, height: saved.height, focused };
  let popup;
  try {
    popup = await chrome.windows.create({ ...size, left: saved.left, top: saved.top });
  } catch (error) {
    // Where it stood is no longer on any screen — a monitor unplugged while
    // the video floated is enough. Let the browser place it instead.
    console.info('WLE: the mini player window could not go back where it was —', error?.message);
    try {
      popup = await chrome.windows.create(size);
    } catch (again) {
      // Never leave the video playing in a tab nobody can see.
      await chrome.tabs.update(tabId, { active: true }).catch(() => {});
      await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
      throw again;
    }
  }

  // Only once it is out: a record lost before that leaves the tab stranded.
  await chrome.storage.session.remove(parkKey(tabId));

  if (selected && typeof saved.frontTabId === 'number') {
    await chrome.tabs.update(saved.frontTabId, { active: true }).catch(() => {});
  }

  if (saved.state === 'maximized') {
    await chrome.windows.update(popup.id, { state: 'maximized' });
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = message && message.type;

  // Opening a mini player is the one thing the popup asks for too, and the
  // popup is an extension page with no sender.tab — so it is answered before
  // the window checks below, which are about moving an existing window.
  if (type === MESSAGES.OPEN) {
    inTurn(() => serveMiniWindow(message.videoId, message.startAt, sender?.tab?.windowId)).then(
      () => sendResponse({ ok: true }),
      (error) => {
        console.info('WLE: could not open the mini player —', error?.message);
        sendResponse({ ok: false, reason: error?.message || 'failed' });
      }
    );
    return true;
  }

  if (type !== MESSAGES.HIDE && type !== MESSAGES.SHOW) return false;

  // Only the content script on a YouTube page has any business moving a
  // window about. Nothing outside this extension can reach this listener —
  // there is no externally_connectable — but an extension page of our own
  // could, and moving whatever tab happens to ask is not a behaviour worth
  // leaving lying around.
  const tabId = sender?.tab?.id;
  const fromYouTube = /^https?:\/\/([\w-]+\.)*youtube\.com\//.test(sender?.url || '');

  if (typeof tabId !== 'number' || !fromYouTube) {
    sendResponse({ ok: false, reason: 'not a youtube window' });
    return false;
  }

  const work = inTurn(() => type === MESSAGES.HIDE
    ? parkMiniPlayer(tabId)
    // Raising the window is only right when a person asked for the video
    // back; a player that closed itself must not interrupt them.
    : unparkMiniPlayer(tabId, message.focus === true));

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

// A tab closed by hand leaves notes behind saying it is open, or parked.
// Clearing them is what lets the next click open a window instead of trying
// to focus one that is not there.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  await chrome.storage.session.remove(parkKey(tabId));
  const data = await chrome.storage.session.get(OPEN_KEY);
  if (data?.[OPEN_KEY]?.tabId === tabId) {
    await chrome.storage.session.remove(OPEN_KEY);
  }
});

// While the mini player is parked, the tab in front of its browser window is
// the one to give back when it leaves — the one the user is on, not the one
// they were on when they pinned. In turn with pinning and unpinning, so a
// change of tab that unpinning itself causes is read after the tab is out,
// when it no longer counts.
chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  inTurn(async () => {
    const data = await chrome.storage.session.get(OPEN_KEY);
    const parkedTab = data?.[OPEN_KEY]?.tabId;
    if (typeof parkedTab !== 'number' || parkedTab === tabId) return;

    const saved = await parkedAt(parkedTab);
    if (saved?.windowId !== windowId) return;

    const tab = await chrome.tabs.get(parkedTab).catch(() => null);
    if (tab?.windowId !== windowId) return;

    await chrome.storage.session.set({ [parkKey(parkedTab)]: { ...saved, frontTabId: tabId } });
  });
});
