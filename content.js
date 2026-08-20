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
// VIDEO SAVING LOGIC (Centralized)
// ============================================
async function saveVideoToWLE(url, title) {
  const normalizedUrl = WLEUrl.normalizeUrl(url);
  if (!normalizedUrl) {
    console.warn('Invalid YouTube URL, not saving:', url);
    showHud('Invalid video URL');
    return;
  }

  return StorageQueue.enqueue(async () => {
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

        if (savedVideos.some((v) => v && v.url === normalizedUrl)) {
          showHud('Already saved!');
          return;
        }

        const latest = await storageGet({ savedVideos: [], [CONFIG.REV_KEY]: 0 });
        if (
          JSON.stringify(latest.savedVideos || []) !== snap ||
          (latest[CONFIG.REV_KEY] || 0) !== rev
        ) {
          await sleep(16 * (attempt + 1));
          continue;
        }

        savedVideos.push({
          url: normalizedUrl,
          title: title || 'Untitled Video',
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
        return;
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
   * Extract title from current watch page DOM
   */
  getCurrentPageTitle() {
    const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string');
    if (titleEl?.textContent) {
      return titleEl.textContent.trim();
    }
    
    // Fallback to document title
    const docTitle = document.title.replace(' - YouTube', '').trim();
    return docTitle || 'YouTube Video';
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
        'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, ytd-playlist-video-renderer, ytd-reel-item-renderer, ytd-shorts, ytd-reel-video-renderer'
      );
      if (!container) return null;

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
    await saveVideoToWLE(normalizedUrl, title);
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

    const title = TitleExtractor.getCurrentPageTitle();
    await saveVideoToWLE(normalizedUrl, title);
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

      const title = TitleExtractor.getCurrentPageTitle();
      await saveVideoToWLE(normalizedUrl, title);
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