// ============================================
// MINI PLAYER
// Every way into the mini player — a thumbnail's button, YouTube's own menu,
// Alt + Shift + click, the button in the player's control bar — asks the
// service worker for its own small window, which this script strips down to
// the player. In that window, Pin on top floats the video above every other
// application in the browser's picture-in-picture.
//
// Everything lives inside an IIFE: content scripts of the same extension share
// one scope, so top-level names here must not collide with content.js.
// ============================================
(() => {
  'use strict';

  const DETACH = {
    KEYS: {
      ENABLED: 'detachEnabled',
      WINDOW_SIZE: 'miniWindowSize', // the mini player window's size
      OPENED: 'miniOpened'           // the worker's note that one just opened
    },
    MINI_MARKER: 'wle-mini',     // hash the popup puts on the mini player window
    MIN_SIZE: { width: 300, height: 180 },
    INJECTION_RETRY_INTERVAL: 500,
    INJECTION_MAX_TIMEOUT: 15000,
    SVG_NS: 'http://www.w3.org/2000/svg'
  };

  const DetachState = {
    enabled: true
  };

  // The service worker acts on the mini player's own browser window and tab;
  // content scripts cannot reach chrome.windows or chrome.tabs themselves.
  // Kept in step with MESSAGES in background.js — a content script and a
  // service worker share no module, so the strings are written twice.
  const WINDOW_MESSAGES = {
    HIDE: 'wle-mini-window-hide',
    SHOW: 'wle-mini-window-show',
    OPEN: 'wle-mini-window-open',
    FLOAT_PREPARE: 'wle-float-prepare',
    FLOAT_PIN: 'wle-float-pin',
    FLOAT_UNPIN: 'wle-float-unpin',
    FLOAT_ENDED: 'wle-float-ended'   // worker → page: the floating video stopped
  };

  // Set once the page is on its way out, so teardown does not ask the worker
  // to bring back a window that is already closing.
  let pageClosing = false;

  /**
   * Ask the service worker to move this page's window out of the way while
   * its video is pinned (HIDE: the window is minimized), or to bring it back
   * (SHOW: up again, the way it stood). Best effort: an older browser, a
   * torn-down worker or a window the user already closed must not break
   * pinning.
   *
   * @param {boolean} focus whether restoring should also raise the window.
   *   Only true when the user asked for the video back — a pin that ends by
   *   itself (the feature switched off) must not yank the user out of
   *   whatever they were doing.
   */
  function askWindow(type, { focus = false } = {}) {
    if (pageClosing) return;

    try {
      chrome.runtime.sendMessage({ type, focus }, () => void chrome.runtime.lastError);
    } catch (error) {
      console.info('WLE: could not reach the background worker —', error?.message);
    }
  }

  // ============================================
  // CAPABILITY DETECTION
  // The pin is the browser's picture-in-picture of a <video>; a browser
  // without it gets the mini player window but no pin.
  // ============================================
  const Support = {
    pip() {
      return Boolean(document.pictureInPictureEnabled) &&
        typeof HTMLVideoElement.prototype.requestPictureInPicture === 'function';
    }
  };

  // ============================================
  // HELPERS
  // ============================================
  /**
   * Play a video in the dedicated mini window. The one way in for all three
   * things that offer it: the button on a thumbnail, Alt + Shift + click, and
   * the item in YouTube's own menu. A content script cannot open a window
   * itself, so the service worker does it — from an eleven-character id it
   * validates, never from a URL handed to it by a page.
   */
  function openMiniWindow(videoId, startAt) {
    if (!videoId) return;

    // Whatever this page was playing, it is not what you are watching now.
    // Two soundtracks, one of them from a window you cannot see, is the thing
    // this feature must never do.
    pausePlayback();

    try {
      chrome.runtime.sendMessage({ type: WINDOW_MESSAGES.OPEN, videoId, startAt }, (response) => {
        if (chrome.runtime.lastError || !response?.ok) {
          notify('Could not open the mini player');
        }
      });
    } catch (error) {
      console.info('WLE: could not reach the background worker —', error?.message);
    }
  }

  /** Stop this page's video, if it has one and it is playing. */
  function pausePlayback() {
    const video = Page.findVideo();
    if (video && !video.paused) {
      try {
        video.pause();
      } catch (error) {
        console.info('WLE: could not pause this page —', error?.message);
      }
    }
  }

  /**
   * The mini player for the video this page is showing.
   *
   * It opens a window of its own rather than handing this page's live player
   * to a picture-in-picture window. A document's picture-in-picture window
   * belongs to that document: close the tab and the floating player goes with
   * it, which is not something to build a mini player on — and it was the one
   * way in that behaved that way.
   *
   * What is given up is the hand-off. The window loads the video rather than
   * receiving the one already decoded, so it starts at the second this page
   * had reached and chooses its own quality. The pin inside it is what puts it
   * above other windows, exactly as it does for every other way in.
   */
  function openMiniWindowForThisPage() {
    const videoId = WLEUrl.extractVideoId(window.location.href);
    if (!videoId) {
      notify('No video to detach');
      return;
    }

    const video = Page.findVideo();
    openMiniWindow(videoId, Math.floor(video?.currentTime || 0));
  }

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

  // A drawing pin, seen from the side, for the button that pins.
  const ICONS = {
    pin: ['M9 4h6', 'M10 4v7l-3 3v1h10v-1l-3-3V4', 'M12 15v5']
  };

  // ============================================
  // THE PAGE'S PLAYER
  // ============================================
  const Page = {
    findPlayer() {
      return document.getElementById('movie_player') ||
        document.querySelector('.html5-video-player');
    },

    findVideo() {
      return this.findPlayer()?.querySelector('video') ||
        document.querySelector('video.html5-main-video') ||
        document.querySelector('video');
    },

    /**
     * Read locally rather than through content.js's TitleExtractor: content
     * scripts share one scope, so a `typeof` guard on its `const` would throw
     * rather than guard if the load order ever changed.
     */
    currentTitle() {
      // Shorts keep their title in their own view model, and their tab title
      // is usually just "YouTube" (kept in step with content.js's extractor).
      const short = document.querySelector(
        'ytd-reel-video-renderer[is-active] h1.ytShortsVideoTitleViewModelShortsVideoTitle, ' +
        'h1.ytShortsVideoTitleViewModelShortsVideoTitle, ' +
        'ytd-reel-player-header-renderer #video-title'
      );
      const fromShort = short?.getAttribute('aria-label')?.trim() || short?.textContent?.trim();
      if (fromShort) return fromShort;

      const heading = document.querySelector('h1.ytd-watch-metadata yt-formatted-string');
      const fromDom = heading?.textContent?.trim();
      if (fromDom) return fromDom;

      const docTitle = document.title.replace(' - YouTube', '').trim();
      if (docTitle && docTitle.toLowerCase() !== 'youtube') return docTitle;

      return 'YouTube Video';
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
      // Named apart from YouTube's own miniplayer button, which sits a few
      // pixels away in the same control bar.
      btn.title = 'Pop out into the WLE mini player (Alt+Shift+left click)';
      btn.setAttribute('aria-label', 'Pop out into the Watch Later Enhanced mini player');

      // The same icon every way into the mini player carries: this button, the
      // one on a thumbnail, and the one on a saved video in the popup. It is
      // deliberately not YouTube's own miniplayer glyph — a screen with a
      // block in the corner — which sits a few pixels away in this same bar
      // and does something else.
      const icon = document.createElement('img');
      icon.className = 'wle-ytp-detach-icon';
      icon.src = chrome.runtime.getURL('icons/buttons/mini-player.svg');
      icon.alt = '';

      btn.appendChild(icon);

      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openMiniWindowForThisPage();
      });

      controls.insertBefore(btn, controls.firstChild);
      return true;
    },

    start() {
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
  // ============================================
  // THUMBNAIL MINI PLAYER
  // A video does not have to be open to be watched in the mini player: this
  // puts a button on whatever thumbnail the pointer is over, and hands the id
  // to the service worker, which opens the same window the popup's button does.
  //
  // One button, moved about, rather than one injected per thumbnail: YouTube
  // builds and destroys those by the hundred as the page scrolls, and anything
  // planted inside them is torn out again within seconds.
  // ============================================
  const ThumbButton = {
    // Any link to a video. What makes one a thumbnail rather than a title is
    // decided by its shape, below.
    //
    // This used to name the components YouTube builds its pages out of —
    // ytd-thumbnail, yt-lockup-view-model and so on. That means re-guessing
    // those names after every redesign, being wrong silently in between, and
    // being wrong differently on the home page, the sidebar and a channel,
    // which is exactly what happened. A link to a video wrapping a picture is
    // true of all of them and stays true.
    LINK: 'a[href*="/watch?v="]',
    MIN_WIDTH: 120,
    MIN_HEIGHT: 68,
    // 16:9 is 1.78. Wide enough to rule a wrapped title block out, loose
    // enough to keep a squarer thumbnail in.
    MIN_RATIO: 1.2,
    MAX_RATIO: 2.6,

    button: null,
    videoId: null,
    hideTimer: null,
    // Where the pointer was last seen, so a scroll can work out what is under
    // it now without waiting for the pointer to move.
    pointer: { x: -1, y: -1 },
    frame: null,
    // How often the hit test may run while the pointer moves, in ms.
    DEEP_INTERVAL: 120,
    lastDeep: 0,

    build() {
      if (this.button) return this.button;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'wle-thumb-mini';
      btn.className = 'wle-thumb-mini';
      btn.title = 'Play in the mini player';
      btn.setAttribute('aria-label', 'Play in the Watch Later Enhanced mini player');

      const icon = document.createElement('img');
      icon.src = chrome.runtime.getURL('icons/buttons/mini-player.svg');
      icon.alt = '';
      icon.className = 'wle-thumb-mini-icon';
      btn.appendChild(icon);

      btn.addEventListener('click', (event) => {
        // The thumbnail underneath is a link: opening the video is exactly
        // what this button is for avoiding.
        event.preventDefault();
        event.stopPropagation();
        this.play();
      });

      document.body.appendChild(btn);
      this.button = btn;
      return btn;
    },

    play() {
      if (!this.videoId) return;
      const videoId = this.videoId;
      this.hide();
      openMiniWindow(videoId);
    },

    /**
     * Is this link a picture of a video rather than its title? Size rules out
     * channel avatars and icons; the ratio rules out a title that has wrapped
     * onto enough lines to be as tall as a thumbnail.
     */
    qualifies(anchor) {
      if (!anchor || !WLEUrl.extractVideoId(anchor.href || '')) return false;

      const rect = anchor.getBoundingClientRect();
      if (rect.width < this.MIN_WIDTH || rect.height < this.MIN_HEIGHT) return false;

      const ratio = rect.width / rect.height;
      return ratio >= this.MIN_RATIO && ratio <= this.MAX_RATIO;
    },

    /**
     * The thumbnail under the pointer.
     *
     * The direct path is the cheap one. The hit test is for when YouTube has
     * floated something over the picture — its own hover buttons, or the
     * preview player it starts about a second after you arrive, which is when
     * the button used to vanish from under the pointer reaching for it. The
     * link is still there underneath, and elementsFromPoint returns what is
     * beneath the top element as well as the top element itself.
     */
    thumbnailUnder(target, x, y, { deep = false } = {}) {
      const direct = target instanceof Element ? target.closest(this.LINK) : null;
      if (this.qualifies(direct)) return direct;
      if (!deep) return null;

      for (const el of document.elementsFromPoint(x, y)) {
        const anchor = el.closest?.(this.LINK);
        if (this.qualifies(anchor)) return anchor;
      }
      return null;
    },

    showOn(anchor) {
      clearTimeout(this.hideTimer);

      const rect = anchor.getBoundingClientRect();
      // Read the id now rather than on the click: by then YouTube may have
      // replaced what is under the pointer with its preview player.
      this.videoId = WLEUrl.extractVideoId(anchor.href);

      const btn = this.build();
      // Top left. Top right is where YouTube puts its own "Watch later" and
      // "Add to queue" buttons on the same hover: sitting on top of them
      // covers what they are and makes them unclickable.
      btn.style.top = `${Math.round(rect.top + 8)}px`;
      btn.style.left = `${Math.round(rect.left + 8)}px`;
      btn.classList.add('visible');
    },

    hide() {
      this.videoId = null;
      this.button?.classList.remove('visible');
    },

    get showing() {
      return this.button?.classList.contains('visible') === true;
    },

    start() {
      if (this.wired) return;
      this.wired = true;

      // Delegated, and only over: the button follows the pointer rather than
      // being planted in a list YouTube keeps rebuilding.
      //
      // No Document PiP check here. This button opens an ordinary browser
      // window through the service worker and has never needed picture-in-
      // picture for anything — the gate only meant the button could not exist
      // at all on a browser without it, Firefox included.
      const onPointer = (event, { deep = false } = {}) => {
        if (!DetachState.enabled) return;

        const target = event.target;
        if (target instanceof Element && target.closest('#wle-thumb-mini')) return;

        this.pointer = { x: event.clientX, y: event.clientY };

        const anchor = this.thumbnailUnder(target, event.clientX, event.clientY, { deep });
        if (anchor) {
          this.showOn(anchor);
          return;
        }

        // Left the thumbnail and its button: give the pointer a moment to
        // cross the gap between them before taking it away.
        clearTimeout(this.hideTimer);
        this.hideTimer = setTimeout(() => this.hide(), 120);
      };

      // Crossing into a new element: the cheap path, answered from the event's
      // own target.
      document.addEventListener('pointerover', onPointer, true);

      // Moving at all. Two things make this necessary rather than a
      // duplicate:
      //
      // pointerover only fires when the element under the pointer changes, so
      // a pointer already sitting where a thumbnail appears — every time
      // YouTube's router swaps a grid in under a still cursor, which is what
      // navigating home does — never produces one, and the button would wait
      // to be jiggled at.
      //
      // And this is where the hit test runs. If YouTube's preview player got
      // over the thumbnail before we ever drew a button, the cheap path can
      // no longer see the link at all: every event comes from inside the
      // preview.
      //
      // Eight times a second, not sixty. elementsFromPoint measures 250µs on
      // a page the size of a scrolled home page, which at frame rate is 15ms
      // of every second spent moving the mouse — small, and still nothing to
      // spend on noticing something a tenth of a second sooner than anyone
      // can react to it. Crossing onto a thumbnail is unaffected: that is the
      // cheap path above, and it still answers immediately.
      document.addEventListener('pointermove', (event) => {
        const now = performance.now();
        if (now - this.lastDeep < this.DEEP_INTERVAL) return;
        this.lastDeep = now;
        onPointer(event, { deep: true });
      }, true);

      // Anything that moves the page moves the thumbnail the button is pinned
      // to. Hiding was the wrong answer: a scroll event landing just after the
      // pointer settles — which is what happens every time you scroll to a
      // video and then reach for it, and what the page itself does when it
      // brings something into view — took the button away until the pointer
      // moved again. Follow the thumbnail instead, and hide only once there
      // is no longer one under the pointer.
      const reanchor = () => {
        if (!this.showing || this.frame) return;
        this.frame = requestAnimationFrame(() => {
          this.frame = null;
          const { x, y } = this.pointer;
          const anchor = this.thumbnailUnder(document.elementFromPoint(x, y), x, y, { deep: true });
          if (anchor) this.showOn(anchor);
          else this.hide();
        });
      };
      window.addEventListener('scroll', reanchor, { passive: true, capture: true });
      window.addEventListener('resize', reanchor, { passive: true });
    },

    remove() {
      clearTimeout(this.hideTimer);
      this.button?.remove();
      this.button = null;
      this.videoId = null;
    }
  };

  // ============================================
  // ALT + SHIFT + CLICK — the way into the mini player a redesign cannot take
  //
  // It mirrors Alt + click, which saves: on a thumbnail it acts on that video,
  // on the player it acts on the one you are watching. Adding Shift plays
  // instead of saving. One gesture, the same everywhere, and it asks nothing
  // of YouTube's markup beyond a link being a link — which is what makes it
  // the way in a redesign cannot take away. Either way the video opens in the
  // mini player window; from the player, at the second the page had reached,
  // and the page stops playing.
  // ============================================
  const ModifierClick = {
    wired: false,

    start() {
      if (this.wired) return;
      this.wired = true;

      document.addEventListener('click', (event) => {
        if (!DetachState.enabled) return;
        if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
        if (!(event.target instanceof Element)) return;

        // A link to a video: its picture, or its title.
        const link = event.target.closest('a[href*="/watch?v="]');
        const videoId = WLEUrl.extractVideoId(link?.href || '');
        if (videoId) {
          event.preventDefault();
          event.stopPropagation();
          openMiniWindow(videoId);
          return;
        }

        // The player itself, which is what this replaced a keyboard shortcut
        // for.
        const player = event.target.closest('#movie_player, .html5-video-player');
        if (player && isWatchPage()) {
          event.preventDefault();
          event.stopPropagation();
          openMiniWindowForThisPage();
        }
      }, true);
    }
  };

  // ============================================
  // THE ITEM IN YOUTUBE'S OWN MENU
  // A hover button is at the mercy of whatever YouTube floats over a
  // thumbnail, and of the pointer ever being there at all. The menu behind
  // the ⋮ on every video is neither: it is a deliberate click, it is the same
  // menu on every surface, and it is where someone looks for "what else can I
  // do with this video".
  // ============================================
  const MenuItem = {
    ID: 'wle-menu-item',
    LABEL: 'Play in mini player',
    // How long YouTube takes to build the menu after the click. Polled rather
    // than observed: the popup is one element it refills and moves, so there
    // is no reliable insertion to watch for.
    RETRY_MS: 60,
    MAX_TRIES: 10,

    videoId: null,
    wired: false,
    tries: 0,

    start() {
      if (this.wired) return;
      this.wired = true;

      // Which video a menu belongs to is written nowhere in the menu. So the
      // card the click came from is remembered before the menu opens.
      document.addEventListener('pointerdown', (event) => {
        if (!DetachState.enabled) return;
        this.remember(event.target);
      }, true);
    },

    // A menu button sits three or four levels inside its card. Walking
    // further only reaches the container the cards are in.
    MAX_DEPTH: 6,

    remember(target) {
      if (!(target instanceof Element)) return;
      // Menus are opened by buttons. Anything else is a click on the page.
      if (!target.closest('button, [role="button"]')) return;

      // Walk out to the nearest thing that holds a link to a video: the card.
      // Structural, because the name of the card's component is not something
      // to depend on — it is different on the home page, in a sidebar and on
      // a channel, and changes without notice.
      let node = target.parentElement;
      for (let depth = 0; node && depth < this.MAX_DEPTH; depth++, node = node.parentElement) {
        const links = node.querySelectorAll('a[href*="/watch?v="]');
        if (!links.length) continue;

        // Every link in a card points at the same video — its picture and its
        // title. More than one video in here means the walk has gone past the
        // card into whatever holds them all, and the answer would be whichever
        // video happens to come first in the page. Taking the first link
        // without this check is exactly what a click on YouTube's own avatar
        // or search button used to do.
        const ids = new Set();
        for (const link of links) {
          const id = WLEUrl.extractVideoId(link.href);
          if (id) ids.add(id);
        }

        this.videoId = ids.size === 1 ? [...ids][0] : null;
        this.scheduleInject();
        return;
      }

      // Nothing within reach: whatever this button opens, it is not a video's
      // menu. Said out loud, so the row is taken out of a menu it does not
      // belong in rather than left pointing at the last video clicked.
      this.videoId = null;
      this.scheduleInject();
    },

    scheduleInject() {
      this.tries = 0;
      const attempt = () => {
        if (this.inject() || ++this.tries >= this.MAX_TRIES) return;
        setTimeout(attempt, this.RETRY_MS);
      };
      setTimeout(attempt, this.RETRY_MS);
    },

    /** The menu that is open, if one is. @returns {Element|null} */
    openMenu() {
      // role="menu" is an ARIA contract. The class names around it are not.
      for (const menu of document.querySelectorAll('[role="menu"]')) {
        const rect = menu.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) return menu;
      }
      return null;
    },

    /** @returns {boolean} whether a menu was found and now carries the item. */
    inject() {
      const menu = this.openMenu();
      if (!menu) return false;

      const existing = menu.querySelector(`#${this.ID}`);

      // Not a video's menu. It is one popup that YouTube refills, so a row
      // left from the last video would sit in the account menu offering to
      // play it.
      if (!this.videoId) {
        existing?.remove();
        return true;
      }

      if (existing) {
        // Same menu, another video: it is one popup, refilled.
        existing.dataset.videoId = this.videoId;
        return true;
      }

      const template = [...menu.children].find((child) => child.querySelector('[role="menuitem"]'));
      if (!template) return false;

      const item = this.buildFrom(template);
      if (!item) return false;

      menu.insertBefore(item, menu.firstChild);
      return true;
    },

    /**
     * Built by cloning one of YouTube's own rows. Copying the markup is what
     * keeps the item looking like the menu it is in, through whatever theme,
     * density or redesign the rest of the menu is wearing — and a clone
     * carries no listeners with it, so nothing of YouTube's comes along.
     */
    buildFrom(template) {
      const item = template.cloneNode(true);
      item.id = this.ID;
      item.dataset.videoId = this.videoId;

      const label = item.querySelector('[role="menuitem"]') || item;
      const text = this.firstTextNode(label);
      if (text) text.nodeValue = this.LABEL;
      else label.textContent = this.LABEL;

      // The cloned row brings the icon of whatever it was cloned from.
      const glyph = item.querySelector('svg, img');
      if (glyph) {
        const icon = document.createElement('img');
        icon.src = chrome.runtime.getURL('icons/buttons/mini-player.svg');
        icon.alt = '';
        icon.className = 'wle-menu-icon';
        glyph.replaceWith(icon);
      }

      // The clone may carry ids from the row it came from, and a duplicate id
      // in the page is a lookup that returns the wrong element later.
      item.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));

      item.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openMiniWindow(item.dataset.videoId);
        this.closeMenu();
      }, true);

      return item;
    },

    firstTextNode(root) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node && !node.nodeValue.trim()) node = walker.nextNode();
      return node;
    },

    /** Escape is what YouTube's own dropdown listens for. */
    closeMenu() {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true
      }));
    }
  };

  // ============================================
  // THE PIN
  // The browser's own picture-in-picture: the video and nothing else, no
  // title bar, smooth wherever its page is. It floats from a page with no
  // window at all (THE PIN, WITH NO WINDOW BEHIND IT, below); when that one
  // is not ready, from this page's own video, and then this page has to stay
  // and its window is minimized. Its controls are the browser's, and the
  // extension popup's.
  // ============================================
  const VideoPin = {
    wired: false,

    open() {
      const video = Page.findVideo();
      if (!video) {
        notify('No video to pin');
        return;
      }

      video.requestPictureInPicture().catch((error) => {
        console.warn('WLE: picture-in-picture failed:', error);
        notify('Could not pin the video');
      });
    },

    close() {
      if (!document.pictureInPictureElement) return;
      document.exitPictureInPicture().catch((error) => {
        console.warn('WLE: could not leave picture-in-picture:', error);
      });
    },

    /**
     * Whoever starts it — this button, YouTube's own, the browser's menu —
     * the video floating in the browser's window is the pin, and the mini
     * player window steps aside for it. The events bubble, so one listener on
     * the document hears them from whatever video element YouTube is using.
     */
    watch() {
      if (this.wired) return;
      this.wired = true;

      document.addEventListener('enterpictureinpicture', () => {
        MiniWindow.setPinned(true, { park: true });
      }, true);

      // The window's own × and its button back to the tab both end here, and
      // both are a person asking for the video back.
      document.addEventListener('leavepictureinpicture', () => {
        MiniWindow.setPinned(false, { focus: true });
      }, true);

      // While the video floats from the extension's own page, this one only
      // waits, paused, behind its note — and YouTube's own keys (K, Space),
      // or Chrome's media controls, would start it again out of sight: a
      // second soundtrack. Media events do not bubble; the capture phase
      // still passes the document. Pinned the fallback way (parked), this
      // page's video is the one floating, and it plays.
      document.addEventListener('play', (event) => {
        if (MiniWindow.pinned && !MiniWindow.parked) event.target.pause?.();
      }, true);
    }
  };

  // ============================================
  // THE PIN, WITH NO WINDOW BEHIND IT
  // The browser's own picture-in-picture, opened not from this page but from
  // an embed of the same video that the extension keeps in an offscreen
  // document — no window, no tab, nothing the user closes by closing the
  // browser. This page only asks for it to be made ready, and hands over the
  // click that opens it: see THE FLOATING PLAYER WITH NO WINDOW in
  // background.js. Once it floats, this window closes — or, when it is the
  // last window open, is minimized, and says where the video went.
  //
  // If the floating player is not ready — still loading, or YouTube would not
  // play the embed — the same click pins the old way: picture-in-picture from
  // this page, whose window is then minimized.
  // ============================================
  const FloatingPin = {
    prepared: null,   // the video the floating player was asked to get ready
    pinning: false,   // a pin is on its way and has not been answered

    /**
     * Have the floating player load this video, while nobody needs it yet.
     *
     * @param {boolean} [again] ask even for the video already asked for: the
     *   floating player may have gone since (a pin that fell back, a window
     *   brought back up). The worker reloads it only if it has.
     */
    prepare({ again = false } = {}) {
      if (!MiniWindow.active || !DetachState.enabled || !Support.pip()) return;

      const videoId = WLEUrl.extractVideoId(window.location.href);
      if (!videoId || (videoId === this.prepared && !again)) return;
      this.prepared = videoId;

      const time = Math.floor(Page.findVideo()?.currentTime || 0);
      try {
        chrome.runtime.sendMessage({ type: WINDOW_MESSAGES.FLOAT_PREPARE, videoId, time },
          () => void chrome.runtime.lastError);
      } catch (error) {
        console.info('WLE: could not reach the background worker —', error?.message);
      }
    },

    /**
     * "Bring the video back" from this window, kept minimized behind the
     * floating video: the worker puts it into a fresh mini player window. If
     * nothing floats any more (closed with its ×), this window just comes
     * back as it was.
     */
    unpin() {
      try {
        chrome.runtime.sendMessage({ type: WINDOW_MESSAGES.FLOAT_UNPIN }, (response) => {
          void chrome.runtime.lastError;
          if (!response?.floating) MiniWindow.setPinned(false, { focus: true });
        });
      } catch (error) {
        console.info('WLE: could not reach the background worker —', error?.message);
        MiniWindow.setPinned(false, { focus: true });
      }
    },

    /**
     * Inside the click. The message goes out before anything else happens,
     * because it is what carries the click to the floating player; the
     * answer comes back while the click still counts, so a refusal can
     * still pin the old way with it.
     */
    pin() {
      // A double click is one pin: the second would open the old way beside
      // the first.
      if (this.pinning) return;

      const videoId = WLEUrl.extractVideoId(window.location.href);
      const video = Page.findVideo();
      if (!videoId || !video) {
        VideoPin.open();
        return;
      }

      // During an ad the element plays the ad, on the ad's clock: the
      // floating player would start the video wherever the ad had got to.
      // The old pin keeps this same element, and the video after the ad.
      const ytPlayer = video.closest('.html5-video-player');
      if (ytPlayer?.classList.contains('ad-showing') || ytPlayer?.classList.contains('ad-interrupting')) {
        VideoPin.open();
        return;
      }

      // Its sound, speed and pause go along: whoever muted it or set it to
      // 1.5× did not mean the floating player to undo that. The volume is the
      // slider's: the element's own is YouTube's loudness-normalised level,
      // and the embed normalises again.
      const slider = parseFloat(ytPlayer?.querySelector('.ytp-volume-panel')?.getAttribute('aria-valuenow'));
      const sound = {
        muted: video.muted,
        volume: Math.round(slider >= 0 && slider <= 100 ? slider : video.volume * 100),
        rate: video.playbackRate,
        paused: video.paused
      };

      this.pinning = true;
      try {
        chrome.runtime.sendMessage(
          { type: WINDOW_MESSAGES.FLOAT_PIN, videoId, time: video.currentTime || 0, sound },
          (response) => {
            this.pinning = false;
            const failed = chrome.runtime.lastError || !response?.ok;
            // Under way from an earlier click: that one answers for both.
            if (failed && response?.busy) return;
            if (failed) {
              VideoPin.open();
              // The floating player may have gone, or never got this far:
              // ask again, so the next pin can float.
              this.prepare({ again: true });
              return;
            }
            // Floating now. Silence this page first, so the hand-over is one
            // soundtrack throughout. The worker closes this window, or keeps
            // it minimized when it is the last one: brought back up, it must
            // say where the video went, not offer to pin it again.
            video.pause();
            MiniWindow.setPinned(true);
          }
        );
      } catch (error) {
        this.pinning = false;
        console.info('WLE: could not reach the background worker —', error?.message);
        VideoPin.open();
      }
    }
  };

  /** The way back, from the page the pinned video left behind. */
  function unpinPlayer() {
    if (document.pictureInPictureElement) VideoPin.close();
    else FloatingPin.unpin();
  }

  const MiniWindow = {
    wanted: false,
    active: false,
    pinned: false,
    parked: false,     // pinned, and the window was asked to step aside for it
    stage: null,
    bar: null,
    sizeWired: false,
    titleEl: null,
    titleTimer: null,
    note: null,
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
      this.buildBar();
      this.watchSize();
      VideoPin.watch();
      FloatingPin.prepare();

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
     * A window opened by the extension is an ordinary browser window: it
     * survives minimizing the browser, but it does not float above other
     * applications. Only a picture-in-picture window does, and a browser will
     * only grant one inside a click on the page — which is exactly what this
     * button is for.
     */
    buildBar() {
      if (!Support.pip() || this.bar) return;

      const bar = document.createElement('div');
      bar.className = 'wle-mini-bar';

      const title = document.createElement('span');
      title.className = 'wle-mini-title';

      const pinBtn = document.createElement('button');
      pinBtn.type = 'button';
      pinBtn.className = 'wle-mini-pin';
      pinBtn.title = 'Float the video above every other window';
      pinBtn.setAttribute('aria-label', 'Pin the video on top of other windows');
      pinBtn.appendChild(createIcon(document, ICONS.pin));

      const label = document.createElement('span');
      label.className = 'wle-mini-pin-label';
      label.textContent = 'Pin on top';
      pinBtn.appendChild(label);

      // Nothing before it: the click is what lets the browser open the window.
      pinBtn.addEventListener('click', () => FloatingPin.pin());

      const note = document.createElement('div');
      note.className = 'wle-mini-note';
      note.hidden = true;

      const noteText = document.createElement('p');
      noteText.className = 'wle-mini-note-text';
      noteText.textContent = 'Playing in the pinned player';

      // While pinned, this page waits in a minimized window: whoever brings
      // that window up needs a way to have the video back.
      const unpinBtn = document.createElement('button');
      unpinBtn.type = 'button';
      unpinBtn.className = 'wle-mini-note-btn';
      unpinBtn.textContent = 'Bring the video back';
      unpinBtn.addEventListener('click', () => unpinPlayer());

      note.append(noteText, unpinBtn);

      bar.append(title, pinBtn);
      document.body.append(bar, note);

      this.bar = bar;
      this.titleEl = title;
      this.note = note;
      this.refreshTitle();
    },

    /**
     * The stage goes up as soon as the player element exists, which on a real
     * watch page is well before YouTube has written the metadata — so the
     * first read can come back empty. yt-navigate-finish calls this again,
     * and these retries cover the case where even that lands too early.
     */
    refreshTitle(retries = 4) {
      if (!this.titleEl) return;

      const title = Page.currentTitle();
      if (title && title !== 'YouTube Video') {
        this.titleEl.textContent = title;
        this.titleEl.title = title;
        return;
      }

      if (retries > 0) {
        clearTimeout(this.titleTimer);
        this.titleTimer = setTimeout(() => this.refreshTitle(retries - 1), 400);
      }
    },

    /**
     * While pinned the video plays in the floating window, so this one says
     * so, and offers the way back, instead of a paused player and a button
     * to pin it again.
     *
     * @param {boolean} [park] whether its window should step aside: pinned
     *   the fallback way, the video floats from this page, which therefore
     *   has to stay, and the worker minimizes its window. It comes back, the
     *   way it stood, the moment the video does.
     * @param {boolean} [stay] unpinned, leave the window where it is: the
     *   video stopped floating by itself, and nobody asked for it back.
     */
    setPinned(pinned, { focus = false, park = false, stay = false } = {}) {
      if (!this.active || this.pinned === Boolean(pinned)) return;
      this.pinned = Boolean(pinned);
      this.parked = this.pinned && park;

      if (this.bar) this.bar.hidden = this.pinned;
      if (this.note) this.note.hidden = !this.pinned;

      if (this.parked) askWindow(WINDOW_MESSAGES.HIDE);
      else if (!this.pinned && !stay) askWindow(WINDOW_MESSAGES.SHOW, { focus });
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

      if (this.stage.querySelector('#movie_player, .html5-video-player')) return;

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

    /**
     * Remember this window's size, so it opens the same way next time. Wired
     * once: the stage is built again on every switch back on.
     */
    watchSize() {
      if (this.sizeWired) return;
      this.sizeWired = true;
      window.addEventListener('resize', () => {
        clearTimeout(this.sizeTimer);
        this.sizeTimer = setTimeout(() => {
          // Parked, the window is minimized, and that is not a size to open
          // at next time; torn down, it is not a mini player any more.
          if (!this.active || this.parked) return;

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
      clearTimeout(this.titleTimer);

      const stage = this.stage;
      this.stage = null;
      this.active = false;
      this.pinned = false;
      this.parked = false;
      document.documentElement.classList.remove('wle-mini-window');

      this.bar?.remove();
      this.note?.remove();
      this.bar = null;
      this.titleEl = null;
      this.titleTimer = null;
      this.note = null;

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
  function onPageReady() {
    // Inside the mini player window there is nothing to pop out: it is the
    // window. Its own bar carries the pin. Everything below would put a
    // pop-out button in YouTube's control bar here and arm the gesture, and
    // both only paused the video and brought this window to the front — a
    // control that breaks what you are watching and does nothing else.
    if (MiniWindow.wanted) {
      if (!DetachState.enabled) return;
      MiniWindow.start();
      MiniWindow.reclaim();
      MiniWindow.refreshTitle();
      // Autoplay moved on to another video: the floating player follows.
      FloatingPin.prepare();
      return;
    }

    // The thumbnail button belongs to every page that has thumbnails on it:
    // the home page, a channel, search results, the sidebar of a video. The
    // early return below used to come first, so it was only ever wired up on
    // a watch page — which is also the only page the tests opened.
    if (DetachState.enabled) {
      ThumbButton.start();
      MenuItem.start();
      ModifierClick.start();
    }

    if (!isWatchPage()) {
      DetachButton.stop();
      return;
    }

    if (!DetachState.enabled) return;

    DetachButton.start();
  }

  function applyEnabledState() {
    if (DetachState.enabled) {
      onPageReady();
      return;
    }

    DetachButton.remove();
    ThumbButton.remove();
    // The browser's own floating window goes, and the window that stepped
    // aside for it comes back now: once the stage is down, nothing would ask.
    // Only in the mini player: a YouTube tab's own picture-in-picture is the
    // user's, and every YouTube tab hears this switch.
    if (MiniWindow.active) VideoPin.close();
    MiniWindow.setPinned(false);
    // The worker has closed the floating player itself; switched back on,
    // this page must ask for it again.
    FloatingPin.prepared = null;
    // Leaving the stage up would strip the page with no way back out of it.
    MiniWindow.teardown();
  }

  async function init() {
    // Before anything async: YouTube rewrites the URL while it boots, and the
    // hash is what tells us this window is a mini player.
    MiniWindow.detectRequest();

    const data = await readStorage({ [DETACH.KEYS.ENABLED]: true });
    DetachState.enabled = data[DETACH.KEYS.ENABLED] !== false;

    // A mini player window brought back up — kept minimized behind a
    // floating video that has since gone, say — asks for the floating player
    // again; the worker reloads it only if it is not there.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') FloatingPin.prepare({ again: true });
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;

      // A mini player just opened somewhere. If this tab is the same video, it
      // is now playing it twice — and the copy you cannot see is the one still
      // making noise. Only the same video: another tab's music is not this
      // feature's business.
      //
      // Through storage because that is the one thing a worker and every
      // content script already share, with no list of tabs to keep or walk.
      const opened = changes[DETACH.KEYS.OPENED]?.newValue;
      if (opened && !MiniWindow.wanted &&
          opened.videoId === WLEUrl.extractVideoId(window.location.href)) {
        pausePlayback();
      }

      if (!changes[DETACH.KEYS.ENABLED]) return;
      DetachState.enabled = changes[DETACH.KEYS.ENABLED].newValue !== false;
      applyEnabledState();
    });

    // The video stopped floating while this window waited behind it, kept
    // minimized: its note is no longer true. Only the worker reaches a
    // content script this way.
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === WINDOW_MESSAGES.FLOAT_ENDED && MiniWindow.pinned && !MiniWindow.parked) {
        MiniWindow.setPinned(false, { stay: true });
      }
      return false;
    });

    document.addEventListener('yt-navigate-finish', onPageReady);

    window.addEventListener('pagehide', () => {
      pageClosing = true;
    });

    onPageReady();
  }

  init();
})();
