// ============================================
// CONSTANTS & CONFIGURATION
// ============================================
const CONFIG = {
  AUDIO_VOLUME: 0.5,
  HUD_DISPLAY_TIME: 2000,
  BUTTON_INJECTION_RETRY_INTERVAL: 500,
  BUTTON_INJECTION_MAX_TIMEOUT: 10000,
  REV_KEY: 'wleRev',
  WRITE_ATTEMPTS: 6
};

// ============================================
// AUDIO MANAGEMENT (Singleton)
// ============================================
const AudioManager = {
  successAudio: null,
  
  init() {
    if (!this.successAudio) {
      this.successAudio = new Audio(chrome.runtime.getURL('sounds/success.wav'));
      this.successAudio.volume = CONFIG.AUDIO_VOLUME;
    }
    return this.successAudio;
  },
  
  play(isSoundEnabled) {
    if (!isSoundEnabled) return;
    
    const audio = this.init();
    audio.currentTime = 0;
    audio.play().catch((err) => console.warn('Audio play blocked:', err));
  },
  
  cleanup() {
    if (this.successAudio) {
      this.successAudio.pause();
      this.successAudio.currentTime = 0;
      this.successAudio = null;
    }
  }
};

// ============================================
// STORAGE QUEUE (serialize writes in this tab)
// ============================================
const StorageQueue = {
  queue: Promise.resolve(),

  enqueue(fn) {
    this.queue = this.queue.then(fn).catch((error) => {
      console.error('Storage queue error:', error);
    });
    return this.queue;
  }
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function storageGet(defaults) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(defaults, (data) => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve(data);
    });
  });
}

function storageSet(values) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(values, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    });
  });
}

// ============================================
// KIND DETECTION (video or short)
// The stored link is always the canonical watch URL, so the kind has to be
// settled while saving. A /shorts/ URL proves it, but YouTube serves the same
// Short behind /watch too — from search, a channel's video tab, a shared link
// — and there the URL says nothing. The DOM around a thumbnail usually does,
// and when neither is conclusive YouTube itself is asked afterwards.
// ============================================
const KindDetector = {
  SHORTS_CONTAINERS: [
    'ytd-reel-item-renderer',
    'ytd-reel-video-renderer',
    'ytd-reel-shelf-renderer',
    'ytm-shorts-lockup-view-model',
    'ytm-shorts-lockup-view-model-v2',
    'ytd-rich-shelf-renderer[is-shorts]',
    'ytd-shorts'
  ].join(','),

  SHORTS_BADGES: [
    '[overlay-style="SHORTS"]',
    '.shortsLockupViewModelHostThumbnailContainer',
    'ytd-thumbnail-overlay-time-status-renderer[overlay-style="SHORTS"]'
  ].join(','),

  /** Synchronous best guess: the URL first, then the DOM around the click. */
  fromContext(url, element) {
    if (WLEUrl.getKind(url) === 'short') return 'short';

    try {
      if (element?.closest(this.SHORTS_CONTAINERS)) return 'short';

      const tile = element?.closest(
        'ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer'
      );
      if (tile?.querySelector(this.SHORTS_BADGES)) return 'short';
    } catch (error) {
      console.warn('WLE: could not read the video type from the page:', error);
    }

    return 'video';
  },

  /**
   * The authoritative answer: /shorts/<id> stays put for a Short and redirects
   * to /watch for anything else. Same origin, so the final URL is readable.
   * @returns {Promise<'short'|'video'|null>} null when there is no usable answer
   */
  async verify(videoId) {
    try {
      const response = await fetch(`https://www.youtube.com/shorts/${videoId}`, {
        method: 'HEAD',
        redirect: 'follow'
      });

      if (!response.ok || !response.url) return null;
      if (response.url.includes('/shorts/')) return 'short';
      if (response.url.includes('/watch')) return 'video';
      return null;
    } catch (error) {
      console.warn('WLE: could not confirm the video type:', error);
      return null;
    }
  }
};

/**
 * Saving must not wait on the network, so the guess is stored immediately and
 * put right afterwards if YouTube disagrees. Only a guess of 'video' is worth
 * checking: a /shorts/ URL and a shorts tile are not wrong about being Shorts.
 */
async function confirmKindLater(normalizedUrl, assumedKind) {
  if (assumedKind === 'short') return;

  const videoId = WLEUrl.extractVideoId(normalizedUrl);
  if (!videoId) return;

  const confirmed = await KindDetector.verify(videoId);
  if (!confirmed || confirmed === assumedKind) return;

  return StorageQueue.enqueue(async () => {
    const data = await storageGet({ savedVideos: [], [CONFIG.REV_KEY]: 0 });
    const savedVideos = Array.isArray(data.savedVideos) ? data.savedVideos : [];
    const entry = savedVideos.find((v) => v && v.url === normalizedUrl);

    if (!entry || entry.kind === confirmed) return;

    entry.kind = confirmed;
    await storageSet({
      savedVideos,
      [CONFIG.REV_KEY]: (data[CONFIG.REV_KEY] || 0) + 1
    });
    console.info('WLE: saved type corrected to', confirmed, 'for', normalizedUrl);
  });
}

// ============================================
// VIDEO SAVING LOGIC (Centralized)
// ============================================
/**
 * @param {string} kind 'short' or 'video' — the stored link is always the
 *   canonical watch URL, so what it was saved from has to be recorded here.
 */
async function saveVideoToWLE(url, title, kind) {
  const normalizedUrl = WLEUrl.normalizeUrl(url);
  if (!normalizedUrl) {
    console.warn('Invalid YouTube URL, not saving:', url);
    showHud('Invalid video URL');
    return;
  }

  const storedKind = await StorageQueue.enqueue(async () => {
    for (let attempt = 0; attempt < CONFIG.WRITE_ATTEMPTS; attempt++) {
      try {
        const data = await storageGet({
          savedVideos: [],
          soundEnabled: true,
          [CONFIG.REV_KEY]: 0
        });
        const savedVideos = Array.isArray(data.savedVideos) ? data.savedVideos : [];
        const snap = JSON.stringify(savedVideos);
        const rev = data[CONFIG.REV_KEY] || 0;
        const isSoundEnabled = data.soundEnabled ?? true;

        const latest = await storageGet({ savedVideos: [], [CONFIG.REV_KEY]: 0 });
        if (
          JSON.stringify(latest.savedVideos || []) !== snap ||
          (latest[CONFIG.REV_KEY] || 0) !== rev
        ) {
          await sleep(16 * (attempt + 1));
          continue;
        }

        // Saving something already on the list is how a wrong type gets put
        // right, so it updates the record rather than just refusing. Only
        // upwards though: 'video' is a weak guess — the same Short opened from
        // /watch looks exactly like a video — and must not overwrite 'short'.
        const existing = savedVideos.find((v) => v && v.url === normalizedUrl);
        if (existing) {
          if (kind === 'short' && existing.kind !== 'short') {
            existing.kind = 'short';
            await storageSet({ savedVideos, [CONFIG.REV_KEY]: rev + 1 });
            showHud('Already saved — now marked as a Reel');
          } else {
            showHud('Already saved!');
          }

          return existing.kind;
        }

        const settledKind = kind === 'short' ? 'short' : 'video';

        savedVideos.push({
          url: normalizedUrl,
          title: title || 'Untitled Video',
          kind: settledKind,
          tags: [],
          watched: false,
          watchedAt: null,
          savedAt: Date.now()
        });

        await storageSet({
          savedVideos,
          [CONFIG.REV_KEY]: rev + 1
        });

        AudioManager.play(isSoundEnabled);
        showHud(title);
        return settledKind;

      } catch (error) {
        console.error('Storage write error:', error);
        if (attempt === CONFIG.WRITE_ATTEMPTS - 1) {
          showHud('Failed to save');
          return;
        }
        await sleep(16 * (attempt + 1));
      }
    }
    showHud('Failed to save');
  });

  // Off the critical path: the save has already landed, this only puts the
  // label right if YouTube says the guess was wrong.
  if (storedKind) confirmKindLater(normalizedUrl, storedKind);
}

// ============================================
// TITLE EXTRACTION (Cascading Strategy)
// ============================================
const TitleExtractor = {
  /**
   * Validate if a title string is usable
   * Guards against null, empty, whitespace-only, HTML residue, and placeholders
   */
  isValidTitle(title) {
    if (!title || typeof title !== 'string') return false;

    const cleaned = title.trim();

    if (cleaned.length < 2 || cleaned.length > 500) return false;
    if (/^\s*$/.test(cleaned)) return false;
    if (/<[^>]+>/.test(cleaned)) return false;

    const placeholders = ['undefined', 'null', 'nan', '...', '—'];
    if (placeholders.includes(cleaned.toLowerCase())) return false;

    return true;
  },

  /**
   * Shorts keep their title in their own view-model tree, nowhere near the
   * watch page's metadata. The <h1> carries the full text in aria-label and
   * the visible span may be clipped, so the attribute comes first.
   */
  SHORTS_TITLE_SELECTORS: [
    'h1.ytShortsVideoTitleViewModelShortsVideoTitle',
    'yt-shorts-video-title-view-model h1',
    '.shortsLockupViewModelHostMetadataTitle',
    'ytd-reel-player-header-renderer h2 #video-title',
    'ytd-reel-player-header-renderer #video-title',
    'h2.ytd-reel-player-header-renderer'
  ],

  getCurrentShortTitle() {
    // The feed keeps every reel in the DOM. Once we know which one is playing,
    // look only in there: reading a neighbour's heading would quietly save the
    // wrong name, which is worse than finding nothing and asking YouTube.
    const scope = document.querySelector('ytd-reel-video-renderer[is-active]') || document;

    for (const selector of this.SHORTS_TITLE_SELECTORS) {
      const el = scope.querySelector(selector);
      if (!el) continue;

      const ariaLabel = el.getAttribute('aria-label');
      if (this.isValidTitle(ariaLabel)) return ariaLabel.trim();

      const text = el.textContent?.trim();
      if (this.isValidTitle(text)) return text;
    }

    return null;
  },

  /**
   * Title of the page we are on, or null when the DOM has nothing usable —
   * on Shorts the tab title is often just "YouTube", which is not a title.
   */
  getCurrentPageTitle() {
    if (window.location.pathname.startsWith('/shorts/')) {
      const shortTitle = this.getCurrentShortTitle();
      if (shortTitle) return shortTitle;
    }

    const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string');
    const watchTitle = titleEl?.textContent?.trim();
    if (this.isValidTitle(watchTitle)) return watchTitle;

    const docTitle = document.title.replace(' - YouTube', '').trim();
    if (this.isValidTitle(docTitle) && docTitle.toLowerCase() !== 'youtube') {
      return docTitle;
    }

    return null;
  },

  /**
   * What the current page is called, asking YouTube itself when its DOM does
   * not say (the Shorts player, a layout we do not know yet).
   */
  async resolveCurrentPageTitle(url) {
    const fromDom = this.getCurrentPageTitle();
    if (fromDom) return fromDom;

    const oEmbedTitle = await this.fetchTitleFromOEmbed(url);
    if (this.isValidTitle(oEmbedTitle)) return oEmbedTitle.trim();

    console.warn('WLE: no title found for the current page:', url);
    return 'Unknown Title';
  },

  /**
   * Extract title from the DOM context around a thumbnail link
   * Used as fallback when oEmbed fails on CASE A (Alt+Click on thumbnail)
   */
  extractTitleFromContext(videoLink) {
    if (!videoLink) return null;

    try {
      // Navigate up to the video renderer container
      const container = videoLink.closest(
        'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, ytd-playlist-video-renderer, ytd-reel-item-renderer, ytd-shorts, ytd-reel-video-renderer, ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2'
      );
      if (!container) return null;

      // Strategy 0: a Shorts tile keeps its title in its own view model
      for (const selector of this.SHORTS_TITLE_SELECTORS) {
        const shortTitleEl = container.querySelector(selector);
        if (!shortTitleEl) continue;

        const shortAria = shortTitleEl.getAttribute('aria-label');
        if (this.isValidTitle(shortAria)) return shortAria.trim();

        const shortText = shortTitleEl.textContent?.trim();
        if (this.isValidTitle(shortText)) return shortText;
      }

      // Strategy 1: "title" attribute on the title heading or link (cleanest source)
      const titleLink = container.querySelector('#video-title, #video-title-link, h3 a');
      if (titleLink) {
        const attrTitle = titleLink.getAttribute('title');
        if (this.isValidTitle(attrTitle)) return attrTitle.trim();
      }

      // Strategy 2: aria-label on the title link (may contain duration suffix)
      if (titleLink) {
        const ariaLabel = titleLink.getAttribute('aria-label');
        if (ariaLabel) {
          // Remove trailing duration metadata (e.g. "1 ora e 30 minuti", "2 hours, 15 minutes")
          const cleanedLabel = ariaLabel
            .replace(/\s+\d+\s*(ora|ore|hour|hours|minut\w*|second\w*|sec|min|hr).*$/i, '')
            .trim();
          if (this.isValidTitle(cleanedLabel)) return cleanedLabel;
        }
      }

      // Strategy 3: textContent of the title element (last resort, may include extra whitespace)
      if (titleLink) {
        const textContent = titleLink.textContent?.trim();
        if (this.isValidTitle(textContent)) return textContent;
      }

      // Strategy 4: h3 heading text directly
      const h3 = container.querySelector('h3');
      if (h3) {
        const h3Title = h3.getAttribute('title');
        if (this.isValidTitle(h3Title)) return h3Title.trim();

        const h3Text = h3.textContent?.trim();
        if (this.isValidTitle(h3Text)) return h3Text;
      }
    } catch (error) {
      console.warn('DOM title extraction error:', error);
    }

    return null;
  },

  /**
   * Fetch title from oEmbed API (primary source, most reliable)
   * Returns null on failure instead of a placeholder
   */
  async fetchTitleFromOEmbed(url) {
    try {
      const response = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
      );
      
      if (!response.ok) {
        throw new Error(`oEmbed request failed with status ${response.status}`);
      }
      
      const data = await response.json();
      return data.title || null;
    } catch (error) {
      console.warn('oEmbed fetch error:', error);
      return null;
    }
  },

  /**
   * Resolve title with cascading fallback strategy:
   * 1. oEmbed API (most reliable, correct title guaranteed)
   * 2. DOM extraction from thumbnail context (best-effort fallback)
   * 3. "Unknown Title" (last resort)
   */
  async resolveTitle(url, videoLink) {
    // 1. oEmbed — primary source
    const oEmbedTitle = await this.fetchTitleFromOEmbed(url);
    if (this.isValidTitle(oEmbedTitle)) {
      return oEmbedTitle.trim();
    }

    // 2. DOM fallback — extract from the thumbnail's surrounding context
    const domTitle = this.extractTitleFromContext(videoLink);
    if (this.isValidTitle(domTitle)) {
      console.info('WLE: Title resolved via DOM fallback:', domTitle);
      return domTitle;
    }

    // 3. Last resort
    console.warn('WLE: Both title sources failed for:', url);
    return 'Unknown Title';
  }
};

// ============================================
// GLOBAL CLICK LISTENER (Alt+Click Handler)
// ============================================
document.addEventListener('click', async (event) => {
  if (!event.altKey) return;

  // CASE A: Click on a thumbnail link
  const videoLink = event.target.closest('a[href*="/watch?v="], a[href*="/shorts/"]');
  if (videoLink) {
    event.preventDefault();
    event.stopPropagation();

    const url = videoLink.href;
    const normalizedUrl = WLEUrl.normalizeUrl(url);
    if (!normalizedUrl) {
      console.warn('Invalid YouTube URL clicked');
      return;
    }

    const title = await TitleExtractor.resolveTitle(normalizedUrl, videoLink);
    await saveVideoToWLE(normalizedUrl, title, KindDetector.fromContext(url, videoLink));
    return;
  }

  const videoPlayer = event.target.closest('#movie_player') ||
                     event.target.closest('.html5-video-player');

  if (videoPlayer && WLEUrl.isVideoPagePath(window.location.pathname)) {
    event.preventDefault();
    event.stopPropagation();

    const normalizedUrl = WLEUrl.normalizeUrl(window.location.href);
    if (!normalizedUrl) {
      console.warn('Invalid YouTube URL on current page');
      return;
    }

    const title = await TitleExtractor.resolveCurrentPageTitle(normalizedUrl);
    await saveVideoToWLE(normalizedUrl, title, KindDetector.fromContext(window.location.href, videoPlayer));
  }
}, true); // Capture phase to intercept before YouTube handlers

// ============================================
// BUTTON INJECTION
// ============================================
const ButtonInjector = {
  injectionInterval: null,
  injectionTimeout: null,

  inject() {
    const actionMenu = document.querySelector('ytd-menu-renderer #top-level-buttons-computed');
    if (!actionMenu) return;

    const existing = document.getElementById('wle-action-btn');
    if (existing && actionMenu.contains(existing)) return;
    existing?.remove();

    const btn = document.createElement('button');
    btn.id = 'wle-action-btn';
    btn.className = 'wle-yt-button';
    btn.title = 'Add to Watch Later Enhanced';

    const icon = document.createElement('img');
    icon.className = 'wle-yt-icon';
    icon.src = chrome.runtime.getURL('icons/48px.png');
    icon.alt = '';

    const text = document.createElement('span');
    text.textContent = 'Save to Watch Later Enhanced';

    btn.appendChild(icon);
    btn.appendChild(text);

    actionMenu.insertBefore(btn, actionMenu.firstChild);

    btn.addEventListener('click', async () => {
      const normalizedUrl = WLEUrl.normalizeUrl(window.location.href);
      if (!normalizedUrl) {
        console.warn('Invalid YouTube URL on current page');
        showHud('Invalid video URL');
        return;
      }

      const title = await TitleExtractor.resolveCurrentPageTitle(normalizedUrl);
      await saveVideoToWLE(normalizedUrl, title, KindDetector.fromContext(window.location.href, null));
    });
  },

  startInjection() {
    this.stopInjection();

    this.injectionInterval = setInterval(() => {
      const actionMenu = document.querySelector('ytd-menu-renderer #top-level-buttons-computed');
      if (actionMenu) {
        this.inject();
        this.stopInjection();
      }
    }, CONFIG.BUTTON_INJECTION_RETRY_INTERVAL);

    this.injectionTimeout = setTimeout(() => {
      this.stopInjection();
    }, CONFIG.BUTTON_INJECTION_MAX_TIMEOUT);
  },

  stopInjection() {
    if (this.injectionInterval) {
      clearInterval(this.injectionInterval);
      this.injectionInterval = null;
    }
    if (this.injectionTimeout) {
      clearTimeout(this.injectionTimeout);
      this.injectionTimeout = null;
    }
  }
};

// ============================================
// YOUTUBE SPA NAVIGATION HANDLER
// ============================================
document.addEventListener('yt-navigate-finish', () => {
  if (WLEUrl.isVideoPagePath(window.location.pathname)) {
    ButtonInjector.startInjection();
  }
});

if (WLEUrl.isVideoPagePath(window.location.pathname)) {
  ButtonInjector.startInjection();
}

// ============================================
// HUD (Heads-Up Display) MANAGEMENT
// ============================================
let hudTimeout = null;
let hudElement = null;

function showHud(message) {
  if (!hudElement) {
    hudElement = document.createElement('div');
    hudElement.className = 'wle-hud';
    document.body.appendChild(hudElement);
  }

  // Sanitize message (prevent XSS)
  const temp = document.createElement('div');
  temp.textContent = message;
  hudElement.textContent = temp.textContent;

  hudElement.classList.add('visible');

  if (hudTimeout) clearTimeout(hudTimeout);

  hudTimeout = setTimeout(() => {
    hudElement.classList.remove('visible');
  }, CONFIG.HUD_DISPLAY_TIME);
}

// ============================================
// CLEANUP ON PAGE UNLOAD
// ============================================
window.addEventListener('unload', () => {
  AudioManager.cleanup();
  ButtonInjector.stopInjection();
  
  if (hudTimeout) {
    clearTimeout(hudTimeout);
  }
  
  if (hudElement && hudElement.parentNode) {
    hudElement.parentNode.removeChild(hudElement);
  }
});