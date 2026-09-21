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
      SIZE: 'miniPlayerSize',
      PENDING: 'pendingDetach'
    },
    DEFAULT_WIDTH: 480,
    MIN_SIZE: { width: 300, height: 180 },
    PENDING_TTL: 60000,          // how long a popup "open detached" request stays valid
    LAUNCHER_TIMEOUT: 20000,     // how long the in-page launcher card stays up
    BAR_IDLE_DELAY: 2600,        // hide the mini player bar after this much idle time
    INJECTION_RETRY_INTERVAL: 500,
    INJECTION_MAX_TIMEOUT: 15000,
    SEEK_STEP: 5,
    SVG_NS: 'http://www.w3.org/2000/svg'
  };

  // Used only if detach.css cannot be fetched: without these rules the moved
  // player would keep YouTube's inline sizing and render at the wrong scale.
  const FALLBACK_PIP_CSS = `
    html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
    .wle-pip-root, .wle-pip-stage { position: absolute; inset: 0; }
    #movie_player, .html5-video-player { width: 100% !important; height: 100% !important; }
    video { width: 100% !important; height: 100% !important; left: 0 !important; top: 0 !important; object-fit: contain !important; }
  `;

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
   * Build an icon with the same stroke style as the bundled SVGs.
   * Created node by node: the mini player document may inherit a CSP that
   * rejects markup parsing, and createElementNS always works.
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

  const ICONS = {
    backToTab: ['M9 14 4 9l5-5', 'M20 20v-7a4 4 0 0 0-4-4H4'],
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
            this.text = css || FALLBACK_PIP_CSS;
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
    document.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
      try {
        if (node.tagName === 'LINK') {
          if (!node.href) return;
          const link = targetDoc.createElement('link');
          link.rel = 'stylesheet';
          link.href = node.href; // resolved, absolute
          if (node.media) link.media = node.media;
          targetDoc.head.appendChild(link);
          return;
        }

        const style = targetDoc.createElement('style');
        style.textContent = node.textContent;
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

    currentTitle() {
      if (typeof TitleExtractor === 'object' && typeof TitleExtractor.getCurrentPageTitle === 'function') {
        return TitleExtractor.getCurrentPageTitle();
      }
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
        // The watch page is gone (YouTube rebuilt its layout): drop the orphan
        // instead of leaving it playing audio from nowhere.
        try {
          player.querySelector('video')?.pause();
        } catch (error) {
          console.warn('WLE: orphaned player could not be paused:', error);
        }
        player.remove();
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
      btn.title = 'Mini player (Alt+Shift+D)';
      btn.setAttribute('aria-label', 'Open the Watch Later Enhanced mini player');

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
  // LAUNCHER CARD
  // The popup cannot open the mini player itself — the API needs a gesture in
  // the YouTube tab — so it leaves a request behind and the page offers a
  // single click to detach.
  // ============================================
  const Launcher = {
    element: null,
    timer: null,

    async maybeShow() {
      if (!DetachState.enabled || !Support.any() || !isWatchPage()) return;

      const data = await readStorage({ [DETACH.KEYS.PENDING]: null });
      const pending = data[DETACH.KEYS.PENDING];
      if (!pending || typeof pending !== 'object') return;

      // One-shot request: clear it whether or not it still applies here.
      await writeStorage({ [DETACH.KEYS.PENDING]: null });

      const isFresh = Date.now() - Number(pending.ts || 0) < DETACH.PENDING_TTL;
      const isSameVideo = pending.videoId &&
        pending.videoId === WLEUrl.extractVideoId(window.location.href);

      if (!isFresh || !isSameVideo) return;

      this.show();
    },

    show() {
      this.hide();

      const card = document.createElement('div');
      card.className = 'wle-detach-launcher';

      const text = document.createElement('p');
      text.className = 'wle-detach-launcher-text';
      text.textContent = 'Watch this in the mini player?';

      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'wle-detach-launcher-btn';
      openBtn.textContent = 'Open mini player';
      openBtn.addEventListener('click', async () => {
        this.hide();
        await DetachedPlayer.open();
      });

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'wle-detach-launcher-close';
      closeBtn.textContent = '×';
      closeBtn.title = 'Dismiss';
      closeBtn.setAttribute('aria-label', 'Dismiss');
      closeBtn.addEventListener('click', () => this.hide());

      card.append(text, openBtn, closeBtn);
      document.body.appendChild(card);

      requestAnimationFrame(() => card.classList.add('visible'));

      this.element = card;
      this.timer = setTimeout(() => this.hide(), DETACH.LAUNCHER_TIMEOUT);
    },

    hide() {
      clearTimeout(this.timer);
      this.timer = null;
      this.element?.remove();
      this.element = null;
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
    if (!isWatchPage()) {
      DetachButton.stop();
      return;
    }

    if (!DetachState.enabled) return;

    DetachButton.start();
    Launcher.maybeShow();
  }

  function applyEnabledState() {
    if (DetachState.enabled) {
      onPageReady();
      return;
    }

    DetachButton.remove();
    Launcher.hide();
    DetachedPlayer.close();
  }

  async function init() {
    const data = await readStorage({ [DETACH.KEYS.ENABLED]: true });
    DetachState.enabled = data[DETACH.KEYS.ENABLED] !== false;

    document.addEventListener('keydown', handleKeydown, true);

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[DETACH.KEYS.ENABLED]) return;
      DetachState.enabled = changes[DETACH.KEYS.ENABLED].newValue !== false;
      applyEnabledState();
    });

    // YouTube's SPA reuses #movie_player on the next page, and it looks it up
    // in the tab's document: hand it back before navigation starts.
    document.addEventListener('yt-navigate-start', () => {
      DetachedPlayer.close();
      Launcher.hide();
    });

    document.addEventListener('yt-navigate-finish', onPageReady);

    window.addEventListener('pagehide', () => DetachedPlayer.close());

    onPageReady();
  }

  init();
})();
