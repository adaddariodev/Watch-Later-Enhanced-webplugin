// ============================================
// DETACHED MINI PLAYER (Document Picture-in-Picture)
// Moves YouTube's own player into a floating, always-on-top OS window, so the
// video keeps playing — with native controls, captions and "skip ad" intact —
// while the user works elsewhere, even with the browser minimized. The window
// can be moved and resized freely; closing it drops the player back exactly
// where it was.
//
// Everything lives inside an IIFE: content scripts of the same extension share
// one scope, so top-level names here must not collide with content.js.
// ============================================
(() => {
  'use strict';

  const DETACH = {
    KEYS: {
      ENABLED: 'detachEnabled',
      SIZE: 'miniPlayerSize',        // the always-on-top window's inner size
      WINDOW_SIZE: 'miniWindowSize'  // the popup's own browser window's size
    },
    MINI_MARKER: 'wle-mini',     // hash the popup puts on the mini player window
    DEFAULT_WIDTH: 480,
    MIN_SIZE: { width: 300, height: 180 },
    BAR_IDLE_DELAY: 2600,        // hide the mini player bar after this much idle time
    INJECTION_RETRY_INTERVAL: 500,
    INJECTION_MAX_TIMEOUT: 15000,
    SEEK_STEP: 5,
    SVG_NS: 'http://www.w3.org/2000/svg'
  };

  const DetachState = {
    enabled: true
  };

  // ============================================
  // CAPABILITY DETECTION
  // Document PiP (Chrome 116+) is the real thing: an independent OS window.
  // The classic video PiP API is the fallback; some browsers have neither.
  // ============================================
  const Support = {
    documentPip() {
      return typeof window.documentPictureInPicture?.requestWindow === 'function';
    },

    nativePip() {
      return Boolean(document.pictureInPictureEnabled) &&
        typeof HTMLVideoElement.prototype.requestPictureInPicture === 'function';
    },

    any() {
      return this.documentPip() || this.nativePip();
    }
  };

  // ============================================
  // HELPERS
  // ============================================
  function notify(message) {
    // showHud() is declared by content.js, which loads first in the same world.
    if (typeof showHud === 'function') showHud(message);
    else console.info('WLE:', message);
  }

  function readStorage(defaults) {
    return new Promise((resolve) => {
      chrome.storage.local.get(defaults, (data) => {
        if (chrome.runtime.lastError) {
          console.warn('WLE: storage read failed:', chrome.runtime.lastError);
          resolve(defaults);
          return;
        }
        resolve(data);
      });
    });
  }

  function writeStorage(values) {
    return new Promise((resolve) => {
      chrome.storage.local.set(values, () => {
        if (chrome.runtime.lastError) {
          console.warn('WLE: storage write failed:', chrome.runtime.lastError);
        }
        resolve();
      });
    });
  }

  function isWatchPage() {
    return WLEUrl.isVideoPagePath(window.location.pathname);
  }

  function isTypingTarget(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    if (node.isContentEditable) return true;
    const tag = node.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  /**
   * Build an icon with the same stroke style as the bundled SVGs. Inline SVG
   * rather than an <img>: these buttons colour their icon with currentColor,
   * which is what gives the close button its red hover state.
   */
  function createIcon(doc, paths) {
    const svg = doc.createElementNS(DETACH.SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'wle-pip-icon');

    paths.forEach((d) => {
      const path = doc.createElementNS(DETACH.SVG_NS, 'path');
      path.setAttribute('d', d);
      svg.appendChild(path);
    });

    return svg;
  }

  // The pair reads as one idea: the same window, with the arrow leaving it on
  // the control bar's pop-out button and coming back into it here.
  const ICONS = {
    backToTab: [
      'M20 10h-6V4',
      'M21 3l-7 7',
      'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'
    ],
    close: ['M18 6 6 18', 'M6 6l12 12']
  };

  // ============================================
  // MINI PLAYER STYLESHEET (fetched once, injected into the PiP document)
  // The PiP window is a separate document, so the manifest's content.css does
  // not reach it.
  // ============================================
  const PipStyles = {
    text: null,
    pending: null,

    load() {
      if (this.text !== null) return Promise.resolve(this.text);

      if (!this.pending) {
        this.pending = fetch(chrome.runtime.getURL('detach.css'))
          .then((response) => (response.ok ? response.text() : ''))
          .catch((error) => {
            console.warn('WLE: mini player stylesheet failed to load:', error);
            return '';
          })
          .then((css) => {
            // Empty means the window would show a mis-sized player; the caller
            // turns that into the plain picture-in-picture fallback instead.
            this.text = css;
            this.pending = null;
            return this.text;
          });
      }

      return this.pending;
    }
  };

  /**
   * Clone the page's stylesheets into the mini player document so YouTube's
   * player keeps its own look (controls, captions, ad overlays).
   */
  function copyPageStyles(targetDoc) {
    // This runs inside the click that opens the window, and a watch page
    // carries a lot of CSS: skip what cannot contribute anything.
    const seenHrefs = new Set();

    document.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
      try {
        if (node.tagName === 'LINK') {
          if (!node.href || seenHrefs.has(node.href)) return;
          seenHrefs.add(node.href);
          const link = targetDoc.createElement('link');
          link.rel = 'stylesheet';
          link.href = node.href; // resolved, absolute
          if (node.media) link.media = node.media;
          targetDoc.head.appendChild(link);
          return;
        }

        const css = node.textContent;
        if (!css || !css.trim()) return;

        const style = targetDoc.createElement('style');
        style.textContent = css;
        targetDoc.head.appendChild(style);
      } catch (error) {
        console.warn('WLE: a stylesheet could not be copied to the mini player:', error);
      }
    });
  }

  // ============================================
  // DETACHED PLAYER
  // ============================================
  const DetachedPlayer = {
    pipWindow: null,
    player: null,       // the moved #movie_player, while detached
    videoId: null,      // the video it was detached with
    placeholder: null,  // stand-in left in the page
    stage: null,
    bar: null,
    idleTimer: null,
    resizeTimer: null,

    findPlayer() {
      return this.player ||
        document.getElementById('movie_player') ||
        document.querySelector('.html5-video-player');
    },

    findVideo() {
      const player = this.findPlayer();
      return player?.querySelector('video') ||
        document.querySelector('video.html5-main-video') ||
        document.querySelector('video');
    },

    async toggle() {
      if (this.pipWindow) {
        this.close();
        return;
      }

      if (document.pictureInPictureElement) {
        try {
          await document.exitPictureInPicture();
        } catch (error) {
          console.warn('WLE: could not leave picture-in-picture:', error);
        }
        return;
      }

      await this.open();
    },

    async open() {
      const player = this.findPlayer();
      const video = player?.querySelector('video');

      if (!player || !video) {
        notify('No video to detach');
        return;
      }

      if (Support.documentPip()) {
        try {
          await this.openDocumentPip(player, video);
          return;
        } catch (error) {
          console.warn('WLE: detached mini player failed, trying picture-in-picture:', error);
        }
      }

      if (Support.nativePip()) {
        try {
          await video.requestPictureInPicture();
          return;
        } catch (error) {
          console.warn('WLE: picture-in-picture failed:', error);
        }
      }

      notify('Mini player not supported by this browser');
    },

    /**
     * The real thing: a standalone window holding YouTube's player.
     * Requires a user gesture (Chrome 116+).
     */
    async openDocumentPip(player, video) {
      const [css, size] = await Promise.all([PipStyles.load(), this.resolveSize(video)]);

      // Without the stylesheet the player would land at YouTube's tab-sized
      // inline dimensions: better to let open() fall back to classic PiP.
      if (!css) throw new Error('mini player stylesheet unavailable');

      const pipWindow = await window.documentPictureInPicture.requestWindow({
        width: size.width,
        height: size.height,
        disallowReturnToOpener: false
      });

      this.pipWindow = pipWindow;

      try {
        this.setupWindow(pipWindow, css);
        this.movePlayer(player);
        this.attachWindowHandlers(pipWindow);
        this.syncPlayerSize();
      } catch (error) {
        // Never leave the player stranded in a half-built window.
        this.restore();
        this.pipWindow = null;
        try { pipWindow.close(); } catch { /* already gone */ }
        throw error;
      }
    },

    setupWindow(pipWindow, css) {
      const doc = pipWindow.document;

      doc.documentElement.lang = document.documentElement.lang || 'en';
      doc.title = this.currentTitle();

      copyPageStyles(doc);

      const style = doc.createElement('style');
      style.textContent = css;
      doc.head.appendChild(style);

      doc.body.className = 'wle-pip-body';

      const root = doc.createElement('div');
      root.className = 'wle-pip-root';

      this.stage = doc.createElement('div');
      this.stage.className = 'wle-pip-stage';

      this.bar = this.buildBar(doc);

      root.append(this.stage, this.bar);
      doc.body.appendChild(root);
    },

    buildBar(doc) {
      const bar = doc.createElement('div');
      bar.className = 'wle-pip-bar';

      const title = doc.createElement('span');
      title.className = 'wle-pip-title';
      title.textContent = this.currentTitle();
      title.title = title.textContent;

      const actions = doc.createElement('div');
      actions.className = 'wle-pip-actions';

      const backBtn = doc.createElement('button');
      backBtn.type = 'button';
      backBtn.className = 'wle-pip-btn wle-pip-back';
      backBtn.title = 'Back to the YouTube tab';
      backBtn.setAttribute('aria-label', 'Back to the YouTube tab');
      backBtn.appendChild(createIcon(doc, ICONS.backToTab));
      backBtn.addEventListener('click', () => {
        try { window.focus(); } catch { /* focus may be refused */ }
        this.close();
      });

      const closeBtn = doc.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'wle-pip-btn wle-pip-close';
      closeBtn.title = 'Close mini player (Esc)';
      closeBtn.setAttribute('aria-label', 'Close mini player');
      closeBtn.appendChild(createIcon(doc, ICONS.close));
      closeBtn.addEventListener('click', () => this.close());

      actions.append(backBtn, closeBtn);
      bar.append(title, actions);

      return bar;
    },

    /**
     * Move the live player element across documents. Playback is not
     * interrupted: it is the same element, only re-parented.
     */
    movePlayer(player) {
      this.placeholder = this.createPlaceholder(player.getBoundingClientRect());
      player.parentNode?.insertBefore(this.placeholder, player);

      this.stage.appendChild(player);
      this.player = player;
      this.videoId = WLEUrl.extractVideoId(window.location.href);
    },

    createPlaceholder(playerRect) {
      const box = document.createElement('div');
      box.className = 'wle-detach-placeholder';

      // The player's box is what held the watch page open: keep it.
      if (playerRect && playerRect.height > 0) {
        box.style.minHeight = `${Math.round(playerRect.height)}px`;
      }

      const text = document.createElement('p');
      text.className = 'wle-detach-placeholder-text';
      text.textContent = 'Playing in the mini player';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'wle-detach-placeholder-btn';
      button.textContent = 'Bring the video back';
      button.addEventListener('click', () => this.close());

      box.append(text, button);
      return box;
    },

    attachWindowHandlers(pipWindow) {
      // Fired both when the user closes the window and when Chrome's own
      // "back to tab" button is used.
      pipWindow.addEventListener('pagehide', () => this.handleWindowClosed(), { once: true });

      pipWindow.addEventListener('resize', () => {
        clearTimeout(this.resizeTimer);
        this.resizeTimer = setTimeout(() => this.syncPlayerSize(), 120);
      });

      pipWindow.document.addEventListener('keydown', (event) => this.handleKey(event));
      pipWindow.document.addEventListener('pointermove', () => this.wakeBar());

      this.wakeBar();
    },

    handleKey(event) {
      const video = this.findVideo();
      const key = event.key;

      if (key === 'Escape') {
        event.preventDefault();
        this.close();
        return;
      }

      if (!video) return;

      switch (key) {
        case ' ':
        case 'k':
        case 'K':
          event.preventDefault();
          if (video.paused) video.play().catch(() => {});
          else video.pause();
          break;
        case 'ArrowLeft':
          event.preventDefault();
          video.currentTime = Math.max(0, video.currentTime - DETACH.SEEK_STEP);
          break;
        case 'ArrowRight':
          event.preventDefault();
          video.currentTime = Math.min(video.duration || Infinity, video.currentTime + DETACH.SEEK_STEP);
          break;
        case 'm':
        case 'M':
          event.preventDefault();
          video.muted = !video.muted;
          break;
        default:
          break;
      }

      this.wakeBar();
    },

    wakeBar() {
      if (!this.bar) return;
      clearTimeout(this.idleTimer);
      this.bar.classList.remove('idle');
      this.idleTimer = setTimeout(() => this.bar?.classList.add('idle'), DETACH.BAR_IDLE_DELAY);
    },

    /**
     * YouTube lays its controls out from the player's box, and it only reacts
     * to the tab's resize events — which resizing the mini player never fires.
     */
    syncPlayerSize() {
      try {
        window.dispatchEvent(new Event('resize'));
      } catch (error) {
        console.warn('WLE: resize notification failed:', error);
      }
    },

    async resolveSize(video) {
      const data = await readStorage({ [DETACH.KEYS.SIZE]: null });
      const saved = data[DETACH.KEYS.SIZE];

      if (saved && Number.isFinite(saved.width) && Number.isFinite(saved.height)) {
        return this.clampSize(saved.width, saved.height);
      }

      const ratio = video.videoWidth && video.videoHeight
        ? video.videoWidth / video.videoHeight
        : 16 / 9;

      return this.clampSize(DETACH.DEFAULT_WIDTH, Math.round(DETACH.DEFAULT_WIDTH / ratio));
    },

    clampSize(width, height) {
      const maxWidth = Math.max(DETACH.MIN_SIZE.width, Math.round((window.screen?.availWidth || 1280) * 0.8));
      const maxHeight = Math.max(DETACH.MIN_SIZE.height, Math.round((window.screen?.availHeight || 720) * 0.8));

      return {
        width: Math.min(Math.max(Math.round(width), DETACH.MIN_SIZE.width), maxWidth),
        height: Math.min(Math.max(Math.round(height), DETACH.MIN_SIZE.height), maxHeight)
      };
    },

    persistSize(pipWindow) {
      const width = pipWindow?.innerWidth;
      const height = pipWindow?.innerHeight;
      if (!Number.isFinite(width) || !Number.isFinite(height)) return;
      if (width < DETACH.MIN_SIZE.width || height < DETACH.MIN_SIZE.height) return;

      writeStorage({ [DETACH.KEYS.SIZE]: { width, height } });
    },

    /**
     * Read locally rather than through content.js's TitleExtractor: content
     * scripts share one scope, so a `typeof` guard on its `const` would throw
     * rather than guard if the load order ever changed.
     */
    currentTitle() {
      const heading = document.querySelector('h1.ytd-watch-metadata yt-formatted-string');
      const fromDom = heading?.textContent?.trim();
      if (fromDom) return fromDom;

      return document.title.replace(' - YouTube', '').trim() || 'YouTube Video';
    },

    /** Closed from the mini player's own window controls. */
    handleWindowClosed() {
      const pipWindow = this.pipWindow;
      if (!pipWindow) return;

      this.persistSize(pipWindow);
      this.pipWindow = null;
      this.restore();
    },

    /** Closed from the page (button, shortcut, navigation). */
    close() {
      const pipWindow = this.pipWindow;
      if (!pipWindow) return;

      this.persistSize(pipWindow);
      this.pipWindow = null;
      this.restore();

      try {
        pipWindow.close();
      } catch (error) {
        console.warn('WLE: mini player did not close cleanly:', error);
      }
    },

    /** Put the player back where it came from. Safe to call twice. */
    restore() {
      const player = this.player;
      const placeholder = this.placeholder;

      this.player = null;
      this.placeholder = null;
      this.stage = null;
      this.bar = null;
      this.videoId = null;
      clearTimeout(this.idleTimer);
      clearTimeout(this.resizeTimer);

      if (!player) return;

      if (placeholder?.parentNode) {
        try {
          placeholder.parentNode.insertBefore(player, placeholder);
        } catch (error) {
          console.warn('WLE: the player could not be moved back:', error);
        }
      } else {
        // The page re-rendered while detached, so the spot we kept is gone.
        // Re-attach to the container the page has now; only drop the player
        // when YouTube has already built a new one, since two #movie_player
        // elements would break the page worse than a missing video. In a mini
        // player window the page containers are hidden behind the stage, so
        // the stage wins — otherwise the video comes back invisible.
        const host = document.getElementById('movie_player')
          ? null
          : (MiniWindow.active && MiniWindow.stage?.isConnected
              ? MiniWindow.stage
              : document.querySelector('ytd-player #container, #player-container-inner, #player-container'));

        if (host) {
          host.appendChild(player);
        } else {
          try {
            player.querySelector('video')?.pause();
          } catch (error) {
            console.warn('WLE: orphaned player could not be paused:', error);
          }
          player.remove();
        }
      }

      placeholder?.remove();

      try {
        window.dispatchEvent(new Event('resize'));
      } catch (error) {
        console.warn('WLE: resize notification failed:', error);
      }
    }
  };

  // ============================================
  // PLAYER CONTROL BAR BUTTON
  // ============================================
  const DetachButton = {
    injectionInterval: null,
    injectionTimeout: null,

    inject() {
      // While detached the player is in the mini player window and the button
      // rides along with it; the fallback selector below would otherwise
      // attach a second button to whatever player instance the page has left.
      if (DetachedPlayer.pipWindow) return true;

      // Scoped to the watch player: YouTube keeps other player instances
      // (its own miniplayer, inline previews) around with the same classes.
      const player = document.getElementById('movie_player') ||
        document.querySelector('.html5-video-player');
      const controls = player?.querySelector('.ytp-right-controls');
      if (!controls) return false;

      if (controls.querySelector('#wle-detach-btn')) return true;
      document.getElementById('wle-detach-btn')?.remove();

      const btn = document.createElement('button');
      btn.id = 'wle-detach-btn';
      btn.className = 'ytp-button wle-ytp-detach-btn';
      // Named apart from YouTube's own miniplayer button, which sits a few
      // pixels away in the same control bar.
      btn.title = 'Pop out into the WLE mini player (Alt+Shift+D)';
      btn.setAttribute('aria-label', 'Pop out into the Watch Later Enhanced mini player');

      const icon = document.createElement('img');
      icon.className = 'wle-ytp-detach-icon';
      icon.src = chrome.runtime.getURL('icons/buttons/detach.svg');
      icon.alt = '';

      btn.appendChild(icon);

      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        DetachedPlayer.toggle();
      });

      controls.insertBefore(btn, controls.firstChild);
      return true;
    },

    start() {
      if (!Support.any()) return;
      this.stop();

      if (this.inject()) return;

      this.injectionInterval = setInterval(() => {
        if (this.inject()) this.stop();
      }, DETACH.INJECTION_RETRY_INTERVAL);

      this.injectionTimeout = setTimeout(() => this.stop(), DETACH.INJECTION_MAX_TIMEOUT);
    },

    stop() {
      if (this.injectionInterval) {
        clearInterval(this.injectionInterval);
        this.injectionInterval = null;
      }
      if (this.injectionTimeout) {
        clearTimeout(this.injectionTimeout);
        this.injectionTimeout = null;
      }
    },

    remove() {
      this.stop();
      document.getElementById('wle-detach-btn')?.remove();
    }
  };

  // ============================================
  // MINI PLAYER WINDOW
  // The popup opens the video in its own small browser window, marked with a
  // hash. Here the real player is lifted into a full-window stage, so the page
  // around it (masthead, comments, recommendations) never shows: no dependence
  // on YouTube's layout classes, only on the player element itself.
  // ============================================
  const MiniWindow = {
    wanted: false,
    active: false,
    stage: null,
    interval: null,
    timeout: null,
    sizeTimer: null,

    /** Read once at start-up: YouTube rewrites the URL as it boots. */
    detectRequest() {
      this.wanted = window.location.hash.replace('#', '') === DETACH.MINI_MARKER;
      if (!this.wanted && window.location.hash.includes(DETACH.MINI_MARKER)) {
        console.info('WLE: mini player marker present but not exact, opening as a normal page');
      }
      return this.wanted;
    },

    start() {
      if (!this.wanted || this.active) return;

      if (this.enter()) return;

      this.stop();
      this.interval = setInterval(() => {
        if (this.enter()) this.stop();
      }, DETACH.INJECTION_RETRY_INTERVAL);
      this.timeout = setTimeout(() => this.stop(), DETACH.INJECTION_MAX_TIMEOUT);
    },

    stop() {
      if (this.interval) {
        clearInterval(this.interval);
        this.interval = null;
      }
      if (this.timeout) {
        clearTimeout(this.timeout);
        this.timeout = null;
      }
    },

    enter() {
      const player = document.getElementById('movie_player') ||
        document.querySelector('.html5-video-player');
      if (!player || !document.body) return false;

      const stage = document.createElement('div');
      stage.className = 'wle-mini-stage';
      document.body.appendChild(stage);
      stage.appendChild(player);

      document.documentElement.classList.add('wle-mini-window');
      this.stage = stage;
      this.active = true;
      this.watchSize();

      // Leaving the marker in the address bar would let any page hand out a
      // link that strips YouTube down; dropping it also means a reload gives
      // the normal page back.
      try {
        history.replaceState(history.state, '', window.location.pathname + window.location.search);
      } catch (error) {
        console.warn('WLE: could not clear the mini player marker:', error);
      }

      // YouTube sizes its controls from the player box it thinks it has.
      try {
        window.dispatchEvent(new Event('resize'));
      } catch (error) {
        console.warn('WLE: resize notification failed:', error);
      }

      return true;
    },

    /**
     * The stage is opaque: if the player ever leaves it, the window shows
     * nothing but black. YouTube re-parents its player when the SPA navigates
     * (autoplay to the next video), so check after every navigation.
     */
    reclaim() {
      if (!this.active) return;

      if (!this.stage?.isConnected) {
        // The stage itself was wiped: rebuild it from scratch.
        this.active = false;
        this.stage = null;
        document.documentElement.classList.remove('wle-mini-window');
        this.start();
        return;
      }

      // While detached the placeholder holds the spot — that is not a loss.
      if (this.stage.querySelector('#movie_player, .html5-video-player, .wle-detach-placeholder')) return;

      const player = document.getElementById('movie_player') ||
        document.querySelector('.html5-video-player');

      if (player) {
        this.stage.appendChild(player);
        try {
          window.dispatchEvent(new Event('resize'));
        } catch (error) {
          console.warn('WLE: resize notification failed:', error);
        }
        return;
      }

      // Nothing left to show: never leave a black wall over the page.
      this.teardown();
    },

    /** Remember this window's size, so it opens the same way next time. */
    watchSize() {
      window.addEventListener('resize', () => {
        clearTimeout(this.sizeTimer);
        this.sizeTimer = setTimeout(() => {
          const width = window.outerWidth;
          const height = window.outerHeight;
          if (!Number.isFinite(width) || !Number.isFinite(height)) return;
          if (width < DETACH.MIN_SIZE.width || height < DETACH.MIN_SIZE.height) return;
          writeStorage({ [DETACH.KEYS.WINDOW_SIZE]: { width, height } });
        }, 400);
      });
    },

    teardown() {
      this.stop();
      clearTimeout(this.sizeTimer);

      const stage = this.stage;
      this.stage = null;
      this.active = false;
      document.documentElement.classList.remove('wle-mini-window');

      if (!stage) return;

      // Hand the player back to the page first: removing the stage with the
      // player still inside it would take the video down with it.
      const player = stage.querySelector('#movie_player, .html5-video-player');
      if (player) {
        const host = document.querySelector('ytd-player #container, #player-container-inner, #player-container') ||
          document.body;
        host.appendChild(player);
      }

      stage.remove();

      try {
        window.dispatchEvent(new Event('resize'));
      } catch (error) {
        console.warn('WLE: resize notification failed:', error);
      }
    }
  };

  // ============================================
  // PAGE WIRING
  // ============================================
  function handleKeydown(event) {
    if (!DetachState.enabled) return;
    if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
    if (event.code !== 'KeyD' && (event.key || '').toLowerCase() !== 'd') return;
    if (isTypingTarget(event.target)) return;
    if (!isWatchPage()) return;

    event.preventDefault();
    event.stopPropagation();
    DetachedPlayer.toggle();
  }

  function onPageReady() {
    // A navigation that slipped past yt-navigate-start: the tab is on another
    // video now, so hand the player back before YouTube comes looking for it.
    if (DetachedPlayer.pipWindow &&
        DetachedPlayer.videoId !== WLEUrl.extractVideoId(window.location.href)) {
      DetachedPlayer.close();
    }

    if (!isWatchPage()) {
      DetachButton.stop();
      return;
    }

    if (!DetachState.enabled) return;

    DetachButton.start();
    MiniWindow.start();
    MiniWindow.reclaim();
  }

  function applyEnabledState() {
    if (DetachState.enabled) {
      onPageReady();
      return;
    }

    DetachButton.remove();
    DetachedPlayer.close();
    // Leaving the stage up would strip the page with no way back out of it.
    MiniWindow.teardown();
  }

  async function init() {
    // Before anything async: YouTube rewrites the URL while it boots, and the
    // hash is what tells us this window is a mini player.
    MiniWindow.detectRequest();

    const data = await readStorage({ [DETACH.KEYS.ENABLED]: true });
    DetachState.enabled = data[DETACH.KEYS.ENABLED] !== false;

    document.addEventListener('keydown', handleKeydown, true);

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[DETACH.KEYS.ENABLED]) return;
      DetachState.enabled = changes[DETACH.KEYS.ENABLED].newValue !== false;
      applyEnabledState();
    });

    // YouTube's SPA reuses #movie_player on the next page, and it looks it up
    // in the tab's document: hand it back before navigation starts. It also
    // fires this event while booting the page it is already on, which must not
    // cost the user their mini player — so only leave when the video changes.
    document.addEventListener('yt-navigate-start', (event) => {
      if (!DetachedPlayer.pipWindow) return;

      const target = event?.detail?.endpoint?.watchEndpoint?.videoId ||
        WLEUrl.extractVideoId(window.location.href);

      if (target && target === DetachedPlayer.videoId) return;
      DetachedPlayer.close();
    });

    document.addEventListener('yt-navigate-finish', onPageReady);

    window.addEventListener('pagehide', () => DetachedPlayer.close());

    onPageReady();
  }

  init();
})();
