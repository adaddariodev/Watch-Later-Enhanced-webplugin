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
  const embedId = location.pathname.match(/^\/embed\/([\w-]{11})/)?.[1] || null;

  let port = null;
  let primed = false;
  let watchTimer = null;

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

  // ---- The worker ----
  function send(message) {
    try {
      port?.postMessage(message);
    } catch {
      // The worker went away mid-send; onDisconnect reconnects.
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
    report('status');
  }

  // ---- Getting ready: details loaded, then wait ----
  /**
   * The embed starts muted, on its own. Once the video's details are in —
   * all picture-in-picture needs — it waits, paused, for the pin, so the
   * floating player does not run ahead of the mini player.
   *
   * Checked rather than waited for: this script arrives once the page has
   * loaded, and by then the video may have started already — an event that
   * fired before anyone listened is not coming again. Muted autoplay that
   * was refused or is slow gets asked for directly, once.
   */
  const PRIME_STEP = 250;
  const PRIME_KICK = 2000;
  const PRIME_GIVE_UP = 20000;
  let primeWaited = 0;

  function prime() {
    if (primed) return;
    const v = video();

    if (v && v.readyState >= 1) {
      primed = true;
      if (!document.pictureInPictureElement) {
        // Through the player, so its own state agrees, and on the element
        // as well, in case the page-world half is not in yet.
        player('pause');
        v.pause();
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

  // ---- The pin ----
  /**
   * Called while handling the message that carries the click, so the window
   * can be asked for. The request goes first: it is what spends the click.
   * Then the video picks up where the mini player was, with sound.
   */
  function pin(time) {
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

    player('seek', time);
    player('mute', false);
    player('play');

    request.then(
      () => send({ type: 'pin-result', ok: true }),
      (error) => send({ type: 'pin-result', ok: false, reason: String(error?.message || error) })
    );
  }

  document.addEventListener('enterpictureinpicture', () => report('status'), true);

  /**
   * The browser's × pauses the video on its way out; its button back to the
   * tab does not. That is how the worker tells "done with it" from "give it
   * back to me". The pause arrives just ahead of this event, or just after:
   * a moment's wait settles it.
   */
  document.addEventListener('leavepictureinpicture', () => {
    setTimeout(() => {
      const v = video();
      report('left', { paused: !v || v.paused });
    }, 250);
  }, true);

  // ---- The remote control ----
  function watch(on) {
    clearInterval(watchTimer);
    watchTimer = on ? setInterval(() => report('state'), WATCH_INTERVAL) : null;
  }

  const COMMANDS = new Set(['play', 'pause', 'seek', 'seekBy', 'volume', 'mute', 'rate', 'quality', 'load']);

  async function command(cmd, arg) {
    if (cmd === 'unpin') {
      // Back to the mini player: leave the window without pausing.
      await document.exitPictureInPicture().catch(() => {});
      return;
    }
    if (cmd === 'stop') {
      await player('pause');
      await document.exitPictureInPicture().catch(() => {});
      return;
    }
    if (!COMMANDS.has(cmd)) return;
    await player(cmd, arg);
    report('state');
  }

  function onMessage(message) {
    switch (message?.type) {
      case 'pin':
        pin(Number(message.time) || 0);
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
