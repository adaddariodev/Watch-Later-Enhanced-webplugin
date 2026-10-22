// ============================================
// FLOATING PLAYER — INSIDE THE EMBED (content script)
//
// Runs inside the YouTube embed that the offscreen document (float.html)
// holds. It is the one place that can put this video into the browser's
// picture-in-picture window, and it needs a click to do it — a click that
// happened in the mini player window. The service worker hands that click on
// over the port this script keeps open: a message sent while handling a
// gesture carries it, and the frame that receives it may open the window.
//
// Everything else it does is plumbing: it reports the player's state to the
// worker (for the popup's remote control) and passes commands to the player's
// own API in the page world (float-embed-main.js).
// ============================================
(() => {
  'use strict';

  // Only in the extension's own floating player: the manifest already limits
  // this to embeds marked wle_float, and this checks the page around it.
  const own = new URL(chrome.runtime.getURL('')).origin;
  if (window === window.top || location.ancestorOrigins?.[0] !== own) return;

  const PORT_NAME = 'wle-float-embed';
  const WATCH_INTERVAL = 500;
  // A video asked for while one floats that has not started by then is one
  // YouTube will not play in an embed.
  const LOAD_GIVE_UP = 10000;
  const embedId = location.pathname.match(/^\/embed\/([\w-]{11})/)?.[1] || null;

  let port = null;
  let primed = false;
  let pinning = false;    // a pin was asked for and has not been answered
  let cancelled = false;  // ...and the worker gave up on it meanwhile
  let unpinning = false;  // leaving the window to go back to the mini player
  let watchTimer = null;
  let loadTimer = null;

  const video = () => document.querySelector('video.html5-main-video') || document.querySelector('video');

  // ---- The player's API, through the page world ----
  let nextId = 1;
  const answers = new Map();

  document.addEventListener('wle-float-answer', (event) => {
    let answer;
    try {
      answer = JSON.parse(String(event.detail));
    } catch {
      return;
    }
    answers.get(answer?.id)?.(answer.state ?? null);
    answers.delete(answer?.id);
  });

  /**
   * Run a player command and get its state back. The page world answers
   * inside the same dispatch, so this resolves at once; the timeout is for a
   * page world that is not there.
   */
  function player(cmd, arg) {
    return new Promise((resolve) => {
      const id = nextId++;
      answers.set(id, resolve);
      document.dispatchEvent(new CustomEvent('wle-float-command', { detail: JSON.stringify({ id, cmd, arg }) }));
      setTimeout(() => {
        if (answers.delete(id)) resolve(null);
      }, 1000);
    });
  }

  /**
   * The player's state, at once — or null while the page world, or the
   * player's API in it, is not there yet: commands sent before then are lost.
   */
  function stateNow() {
    let state = null;
    const id = nextId++;
    answers.set(id, (answer) => {
      state = answer;
    });
    document.dispatchEvent(new CustomEvent('wle-float-command', { detail: JSON.stringify({ id, cmd: 'state' }) }));
    answers.delete(id);
    return state;
  }

  /** Silent and still: what this player is whenever it is not floating. */
  function hush() {
    player('pause');
    player('mute', true);
    const v = video();
    if (v) {
      v.pause();
      v.muted = true;
    }
  }

  // ---- The worker ----
  // The port is down for a moment every time the worker idles. A report that
  // only says how things are can wait for the next one; these say that
  // something happened, and the worker must not miss them.
  const MUST_ARRIVE = new Set(['left', 'pin-result', 'load-failed']);
  const outbox = [];

  function send(message) {
    if (!port) {
      if (MUST_ARRIVE.has(message.type)) outbox.push(message);
      return;
    }
    try {
      port.postMessage(message);
    } catch {
      if (MUST_ARRIVE.has(message.type)) outbox.push(message);
    }
  }

  let statusRetries = 0;

  async function report(type, extra = {}) {
    const v = video();
    const state = await player('state');
    send({
      type,
      embedId,
      ready: primed && Boolean(v) && v.readyState >= 1,
      pinned: Boolean(document.pictureInPictureElement),
      // On the way back to the mini player: not floating any more, but the
      // report of that is still to come.
      leaving: unpinning,
      state,
      ...extra
    });

    // The page-world half may not be in yet: it is injected separately, and
    // can come after this one. Say it again once it can answer.
    if (!state && type === 'status' && statusRetries < 20) {
      statusRetries++;
      setTimeout(() => report('status'), 500);
    }
  }

  /**
   * The worker is stopped whenever it idles, and the port goes with it. The
   * next click on Pin on top needs one open, so it is reopened at once —
   * which wakes the worker, and is the cost of being ready.
   */
  function connect() {
    try {
      port = chrome.runtime.connect({ name: PORT_NAME });
    } catch {
      // The extension was reloaded or removed: this frame is an orphan.
      port = null;
      return;
    }
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(() => {
      port = null;
      watch(false);
      setTimeout(connect, 100);
    });
    while (port && outbox.length) send(outbox.shift());
    report('status');
  }

  // ---- Getting ready: details loaded, then wait ----
  /**
   * The embed starts muted, on its own. Once the video's details are in —
   * all picture-in-picture needs — it waits, paused, for the pin, so the
   * floating player does not run ahead of the mini player. While it waits it
   * asks for the smallest picture YouTube has: it is a second copy of a
   * video already playing in the mini player, and may never be watched.
   *
   * Checked rather than waited for: this script arrives once the page has
   * loaded, and by then the video may have started already — an event that
   * fired before anyone listened is not coming again. Muted autoplay that
   * was refused or is slow gets asked for directly, once; one that starts
   * after the checks have given up still gets caught by the event. The
   * player's API is waited for too: it comes in a script of its own, which
   * may arrive after this one.
   */
  const PRIME_STEP = 250;
  const PRIME_KICK = 2000;
  const PRIME_GIVE_UP = 20000;
  let primeWaited = 0;

  function prime() {
    if (primed) return;
    const v = video();

    if (v && v.readyState >= 1 && stateNow()) {
      primed = true;
      if (!document.pictureInPictureElement && !pinning) {
        hush();
        player('quality', 'lowest');
      }
      report('status');
      return;
    }

    primeWaited += PRIME_STEP;
    if (primeWaited === PRIME_KICK) {
      player('play');
      v?.play().catch(() => {});
    }
    if (primeWaited < PRIME_GIVE_UP) setTimeout(prime, PRIME_STEP);
  }

  document.addEventListener('playing', () => prime(), true);

  // ---- The pin ----
  /**
   * Called while handling the message that carries the click, so the window
   * can be asked for, and the request goes first: it is what spends the click.
   * The video moves to where the mini player was at once, but only plays,
   * with the mini player's sound and speed, once the window is there — a
   * refused or late window must not leave a hidden player making noise
   * beside the mini player that pinned the old way instead.
   */
  function pin({ time, muted, volume, rate, paused }) {
    const v = video();
    if (!v || v.readyState < 1) {
      send({ type: 'pin-result', ok: false, reason: 'not ready' });
      return;
    }

    try {
      v.disablePictureInPicture = false;
    } catch {
      // Read-only on some players; the request below says so if it matters.
    }

    let request;
    try {
      request = v.requestPictureInPicture();
    } catch (error) {
      send({ type: 'pin-result', ok: false, reason: String(error?.message || error) });
      return;
    }

    pinning = true;
    cancelled = false;
    player('seek', time);

    request.then(
      () => {
        pinning = false;
        if (cancelled) {
          // Too late: the mini player pinned the old way meanwhile.
          hush();
          document.exitPictureInPicture().catch(() => {});
          return;
        }
        player('quality', 'auto');
        player('rate', rate);
        player('volume', volume);
        player('mute', muted);
        // Pinned while paused, it floats paused, as the old pin did.
        if (!paused) player('play');
        send({ type: 'pin-result', ok: true });
        // The last report was sent on the way in, silent and still.
        report('status');
      },
      (error) => {
        pinning = false;
        hush();
        send({ type: 'pin-result', ok: false, reason: String(error?.message || error) });
      }
    );
  }

  document.addEventListener('enterpictureinpicture', () => report('status'), true);

  /**
   * The window closed. Only "Back to mini player" means "give it back"; the
   * browser's ×, another site taking the one picture-in-picture window there
   * is, anything else, means this video is done — so it falls silent here,
   * and the worker closes the page.
   */
  document.addEventListener('leavepictureinpicture', () => {
    const reopen = unpinning;
    unpinning = false;
    if (!reopen) hush();
    report('left', { reopen });
  }, true);

  // ---- The remote control ----
  function watch(on) {
    clearInterval(watchTimer);
    watchTimer = on ? setInterval(() => report('state'), WATCH_INTERVAL) : null;
  }

  /**
   * After a video is loaded into the floating player: does it play? The
   * player's own error says no at once; a video that has not started at all
   * by the time limit says no too. Anything that plays — an ad before it
   * counts — says yes, and so does a person pausing or stopping it meanwhile.
   */
  let loading = null;

  function watchLoad(arg) {
    clearTimeout(loadTimer);
    loading = { videoId: arg?.videoId, start: arg?.start };
    loadTimer = setTimeout(() => loadFailed(), LOAD_GIVE_UP);
  }

  function loadSettled() {
    clearTimeout(loadTimer);
    loading = null;
  }

  function loadFailed() {
    if (!loading) return;
    const failed = loading;
    loadSettled();
    send({ type: 'load-failed', ...failed });
  }

  document.addEventListener('playing', () => loadSettled(), true);
  document.addEventListener('wle-float-error', () => loadFailed());

  const COMMANDS = new Set(['play', 'pause', 'seek', 'seekBy', 'volume', 'mute', 'rate', 'quality', 'load']);

  async function command(cmd, arg) {
    if (cmd === 'pause' || cmd === 'unpin' || cmd === 'stop') loadSettled();
    if (cmd === 'unpin' || cmd === 'stop') {
      // Back to the mini player keeps the video going; stop does not.
      if (cmd === 'stop') hush();
      if (!document.pictureInPictureElement) {
        // Not floating after all: nothing will fire on its way out, so say
        // it here.
        report('left', { reopen: cmd === 'unpin' });
        return;
      }
      unpinning = cmd === 'unpin';
      await document.exitPictureInPicture().catch(() => {});
      return;
    }
    if (!COMMANDS.has(cmd)) return;
    if (cmd === 'load') watchLoad(arg);
    await player(cmd, arg);
    report('state');
  }

  function onMessage(message) {
    switch (message?.type) {
      case 'pin':
        pin(message);
        break;
      case 'pin-cancel':
        if (pinning) {
          cancelled = true;
        } else if (document.pictureInPictureElement) {
          hush();
          document.exitPictureInPicture().catch(() => {});
        }
        break;
      case 'command':
        command(String(message.cmd), message.arg);
        break;
      case 'watch':
        watch(message.on === true);
        break;
      default:
        break;
    }
  }

  connect();
  prime();
})();
