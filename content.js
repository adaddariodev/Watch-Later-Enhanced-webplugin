// ============================================
// CONSTANTS & CONFIGURATION
// ============================================
const CONFIG = {
  AUDIO_VOLUME: 0.5,
  HUD_DISPLAY_TIME: 2000,
  BUTTON_INJECTION_RETRY_INTERVAL: 500,
  BUTTON_INJECTION_MAX_TIMEOUT: 10000,
  YOUTUBE_WATCH_PATH: '/watch',
  YOUTUBE_DOMAIN: 'www.youtube.com'
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
// URL VALIDATION & NORMALIZATION
// (Supports both standard videos /watch?v=ID and Shorts /shorts/ID)
// ============================================
const URLValidator = {
  /**
   * True if the hostname is a YouTube host we accept.
   */
  isYouTubeHost(hostname) {
    return hostname === CONFIG.YOUTUBE_DOMAIN || hostname === 'youtube.com' || hostname === 'm.youtube.com';
  },

  /**
   * Extract the video ID from a watch URL (/watch?v=ID) or a Shorts URL (/shorts/ID).
   * Returns null when the URL is not a recognizable YouTube video.
   */
  extractVideoId(url) {
    try {
      const u = new URL(url);
      if (!this.isYouTubeHost(u.hostname)) return null;

      if (u.pathname === CONFIG.YOUTUBE_WATCH_PATH) {
        const id = u.searchParams.get('v');
        return id && id.length > 0 ? id : null;
      }

      const shortsMatch = u.pathname.match(/^\/shorts\/([^/?#]+)/);
      if (shortsMatch && shortsMatch[1]) return shortsMatch[1];

      return null;
    } catch {
      return null;
    }
  },

  /**
   * 'short' for Shorts URLs, 'video' otherwise.
   */
  getKind(url) {
    try {
      return new URL(url).pathname.startsWith('/shorts/') ? 'short' : 'video';
    } catch {
      return 'video';
    }
  },

  /**
   * Validate if URL is a proper YouTube video (standard or Shorts).
   */
  isValidYouTubeUrl(url) {
    return this.extractVideoId(url) !== null;
  },

  /**
   * Normalize a YouTube URL to a canonical, dedupe-friendly form.
   * Shorts keep their /shorts/ID form so they reopen as Shorts.
   */
  normalizeUrl(url) {
    const videoId = this.extractVideoId(url);
    if (!videoId) {
      console.warn('Invalid YouTube URL: missing video ID');
      return url;
    }

    const path = this.getKind(url) === 'short'
      ? `/shorts/${encodeURIComponent(videoId)}`
      : `${CONFIG.YOUTUBE_WATCH_PATH}?v=${encodeURIComponent(videoId)}`;

    return `https://${CONFIG.YOUTUBE_DOMAIN}${path}`;
  },

  /**
   * The /watch?v=ID form for a given URL — used for the oEmbed lookup,
   * which is most reliable with the canonical watch URL even for Shorts.
   */
  toWatchUrl(url) {
    const videoId = this.extractVideoId(url);
    if (!videoId) return url;
    return `https://${CONFIG.YOUTUBE_DOMAIN}${CONFIG.YOUTUBE_WATCH_PATH}?v=${encodeURIComponent(videoId)}`;
  }
};

// ============================================
// STORAGE QUEUE (Prevent Race Conditions)
// ============================================
const StorageQueue = {
  queue: Promise.resolve(),
  
  enqueue(fn) {
    this.queue = this.queue
      .then(fn)
      .catch((error) => {
        console.error('Storage queue error:', error);
        return fn(); // Retry once on error
      });
    return this.queue;
  }
};

// ============================================
// VIDEO SAVING LOGIC (Centralized)
// ============================================
async function saveVideoToWLE(url, title, thumbNode, kind = 'video') {
  // Validate URL before saving
  if (!URLValidator.isValidYouTubeUrl(url)) {
    console.warn('Invalid YouTube URL, not saving:', url);
    showHud('Invalid video URL');
    return;
  }

  const normalizedUrl = URLValidator.normalizeUrl(url);
  const videoId = URLValidator.extractVideoId(normalizedUrl);

  return StorageQueue.enqueue(
    () =>
      new Promise((resolve) => {
        chrome.storage.local.get({ savedVideos: [], soundEnabled: true }, (data) => {
          if (chrome.runtime.lastError) {
            console.error('Storage read error:', chrome.runtime.lastError);
            showHud('Storage error');
            resolve();
            return;
          }

          const savedVideos = data.savedVideos || [];
          const isSoundEnabled = data.soundEnabled ?? true;

          // Check for duplicates by video ID (a video saved from /watch and from
          // /shorts shares the same ID, so we treat them as the same entry)
          if (savedVideos.some((v) => URLValidator.extractVideoId(v.url) === videoId)) {
            showHud('Already saved!');
            resolve();
            return;
          }

          // Add new video
          savedVideos.push({
            url: normalizedUrl,
            title: title || 'Untitled Video',
            tags: [],
            kind: kind === 'short' ? 'short' : 'video',
            watched: false,
            watchedAt: null,
            savedAt: Date.now()
          });
          
          chrome.storage.local.set({ savedVideos }, () => {
            if (chrome.runtime.lastError) {
              console.error('Storage write error:', chrome.runtime.lastError);
              showHud('Failed to save');
              resolve();
              return;
            }
            
            // Play success feedback
            AudioManager.play(isSoundEnabled);

            // Show success hud
            showHud(title);
            resolve();
          });
        });
      })
  );
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
        'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, ytd-playlist-video-renderer'
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

  // CASE A: Click on a thumbnail link (standard video or Shorts)
  const videoLink = event.target.closest('a[href*="/watch?v="], a[href*="/shorts/"]');
  if (videoLink) {
    event.preventDefault();
    event.stopPropagation();

    const url = videoLink.href;
    if (!URLValidator.isValidYouTubeUrl(url)) {
      console.warn('Invalid YouTube URL clicked');
      return;
    }

    const normalizedUrl = URLValidator.normalizeUrl(url);
    const kind = URLValidator.getKind(normalizedUrl);
    const thumbNode = videoLink.querySelector('img') || videoLink;

    // Resolve title with cascading fallback: oEmbed → DOM → Unknown Title.
    // oEmbed is queried with the /watch form (most reliable, even for Shorts).
    const title = await TitleExtractor.resolveTitle(URLValidator.toWatchUrl(normalizedUrl), videoLink);
    await saveVideoToWLE(normalizedUrl, title, thumbNode, kind);
    return;
  }

  // CASE B: Click directly on the video player (watch page or Shorts page)
  const videoPlayer = event.target.closest('#movie_player') ||
                     event.target.closest('.html5-video-player') ||
                     event.target.closest('ytd-reel-video-renderer');

  const onVideoPage = window.location.pathname === CONFIG.YOUTUBE_WATCH_PATH ||
                      window.location.pathname.startsWith('/shorts/');

  if (videoPlayer && onVideoPage) {
    event.preventDefault();
    event.stopPropagation();

    const currentUrl = window.location.href;
    if (!URLValidator.isValidYouTubeUrl(currentUrl)) {
      console.warn('Invalid YouTube URL on current page');
      return;
    }

    const normalizedUrl = URLValidator.normalizeUrl(currentUrl);
    const kind = URLValidator.getKind(normalizedUrl);
    const title = TitleExtractor.getCurrentPageTitle();

    await saveVideoToWLE(normalizedUrl, title, videoPlayer, kind);
  }
}, true); // Capture phase to intercept before YouTube handlers

// ============================================
// BUTTON INJECTION
// ============================================
const ButtonInjector = {
  injectionInterval: null,
  
  /**
   * Inject "Save to Watch Later Enhanced" button
   */
  inject() {
    // Prevent duplicate injection
    if (document.getElementById('wle-action-btn')) return;

    const actionMenu = document.querySelector('ytd-menu-renderer #top-level-buttons-computed');
    if (!actionMenu) return;

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

    // Insert as first button
    actionMenu.insertBefore(btn, actionMenu.firstChild);

    // Attach click handler
    btn.addEventListener('click', async () => {
      const currentUrl = window.location.href;

      if (!URLValidator.isValidYouTubeUrl(currentUrl)) {
        console.warn('Invalid YouTube URL on current page');
        showHud('Invalid video URL');
        return;
      }

      const normalizedUrl = URLValidator.normalizeUrl(currentUrl);
      const kind = URLValidator.getKind(normalizedUrl);
      const title = TitleExtractor.getCurrentPageTitle();

      // Pass button as thumbNode for visual feedback
      await saveVideoToWLE(normalizedUrl, title, btn, kind);
    });
  },
  
  /**
   * Start injection attempts with retry logic
   */
  startInjection() {
    this.stopInjection(); // Clear any existing interval
    
    this.injectionInterval = setInterval(() => {
      const actionMenu = document.querySelector('ytd-menu-renderer #top-level-buttons-computed');
      if (actionMenu) {
        this.inject();
        this.stopInjection();
      }
    }, CONFIG.BUTTON_INJECTION_RETRY_INTERVAL);
    
    // Clear interval after max timeout
    setTimeout(() => {
      this.stopInjection();
    }, CONFIG.BUTTON_INJECTION_MAX_TIMEOUT);
  },
  
  /**
   * Stop injection attempts
   */
  stopInjection() {
    if (this.injectionInterval) {
      clearInterval(this.injectionInterval);
      this.injectionInterval = null;
    }
  }
};

// ============================================
// YOUTUBE SPA NAVIGATION HANDLER
// ============================================
document.addEventListener('yt-navigate-finish', () => {
  if (window.location.pathname === CONFIG.YOUTUBE_WATCH_PATH) {
    ButtonInjector.startInjection();
  }
});

// Initial injection on page load
if (window.location.pathname === CONFIG.YOUTUBE_WATCH_PATH) {
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