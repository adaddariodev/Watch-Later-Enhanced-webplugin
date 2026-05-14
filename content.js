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
// ============================================
const URLValidator = {
  /**
   * Validate if URL is a proper YouTube watch URL
   */
  isValidYouTubeWatchUrl(url) {
    try {
      const u = new URL(url);
      return (
        u.hostname === CONFIG.YOUTUBE_DOMAIN &&
        u.pathname === CONFIG.YOUTUBE_WATCH_PATH &&
        u.searchParams.has('v') &&
        u.searchParams.get('v').length > 0
      );
    } catch {
      return false;
    }
  },
  
  /**
   * Normalize YouTube Watch URL to avoid duplicates
   * Example: https://www.youtube.com/watch?v=VIDEO_ID
   */
  normalizeYouTubeWatchUrl(url) {
    try {
      const u = new URL(url);
      const videoId = u.searchParams.get('v');
      
      if (!videoId) {
        console.warn('Invalid YouTube URL: missing video ID');
        return url;
      }
      
      return `https://${CONFIG.YOUTUBE_DOMAIN}${CONFIG.YOUTUBE_WATCH_PATH}?v=${encodeURIComponent(videoId)}`;
    } catch (error) {
      console.error('URL normalization error:', error);
      return url;
    }
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
async function saveVideoToWLE(url, title, thumbNode) {
  // Validate URL before saving
  if (!URLValidator.isValidYouTubeWatchUrl(url)) {
    console.warn('Invalid YouTube URL, not saving:', url);
    showHud('Invalid video URL', 'warning');
    return;
  }
  
  const normalizedUrl = URLValidator.normalizeYouTubeWatchUrl(url);
  
  return StorageQueue.enqueue(
    () =>
      new Promise((resolve) => {
        chrome.storage.local.get({ savedVideos: [], soundEnabled: true }, (data) => {
          if (chrome.runtime.lastError) {
            console.error('Storage read error:', chrome.runtime.lastError);
            showHud('Storage error', 'warning');
            resolve();
            return;
          }
          
          const savedVideos = data.savedVideos || [];
          const isSoundEnabled = data.soundEnabled ?? true;

          // Check for duplicates
          if (savedVideos.some((v) => v.url === normalizedUrl)) {
            showHud('Already saved!', 'warning');
            resolve();
            return;
          }

          // Add new video
          savedVideos.push({ 
            url: normalizedUrl, 
            title: title || 'Untitled Video', 
            tags: [],
            savedAt: Date.now()
          });
          
          chrome.storage.local.set({ savedVideos }, () => {
            if (chrome.runtime.lastError) {
              console.error('Storage write error:', chrome.runtime.lastError);
              showHud('Failed to save', 'warning');
              resolve();
              return;
            }
            
            // Play success feedback
            AudioManager.play(isSoundEnabled);

            // Show success hud
            showHud(title, 'success');
            resolve();
          });
        });
      })
  );
}

// ============================================
// TITLE EXTRACTION
// ============================================
const TitleExtractor = {
  /**
   * Extract title from current page
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
   * Fetch title from oEmbed API
   */
  async fetchTitleFromOEmbed(url) {
    try {
      const response = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
      );
      
      if (!response.ok) {
        throw new Error('oEmbed request failed');
      }
      
      const data = await response.json();
      return data.title || 'Unknown Title';
    } catch (error) {
      console.warn('oEmbed fetch error:', error);
      return 'Unknown Title';
    }
  }
};

// ============================================
// GLOBAL CLICK LISTENER (Alt+Click Handler)
// ============================================
document.addEventListener('click', async (event) => {
  if (!event.altKey) return;

  // CASE A: Click on a thumbnail link
  const videoLink = event.target.closest('a[href*="/watch?v="]');
  if (videoLink) {
    event.preventDefault();
    event.stopPropagation();
    
    const url = videoLink.href;
    if (!URLValidator.isValidYouTubeWatchUrl(url)) {
      console.warn('Invalid YouTube URL clicked');
      return;
    }
    
    const normalizedUrl = URLValidator.normalizeYouTubeWatchUrl(url);
    const thumbNode = videoLink.querySelector('img') || videoLink;
    
    // Fetch title from oEmbed
    const title = await TitleExtractor.fetchTitleFromOEmbed(normalizedUrl);
    await saveVideoToWLE(normalizedUrl, title, thumbNode);
    return;
  }

  // CASE B: Click directly on the video player
  const videoPlayer = event.target.closest('#movie_player') || 
                     event.target.closest('.html5-video-player');
  
  if (videoPlayer && window.location.pathname === CONFIG.YOUTUBE_WATCH_PATH) {
    event.preventDefault();
    event.stopPropagation();
    
    const currentUrl = window.location.href;
    if (!URLValidator.isValidYouTubeWatchUrl(currentUrl)) {
      console.warn('Invalid YouTube URL on current page');
      return;
    }
    
    const normalizedUrl = URLValidator.normalizeYouTubeWatchUrl(currentUrl);
    const title = TitleExtractor.getCurrentPageTitle();
    
    await saveVideoToWLE(normalizedUrl, title, videoPlayer);
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
      
      if (!URLValidator.isValidYouTubeWatchUrl(currentUrl)) {
        console.warn('Invalid YouTube URL on current page');
        showHud('Invalid video URL', 'warning');
        return;
      }
      
      const normalizedUrl = URLValidator.normalizeYouTubeWatchUrl(currentUrl);
      const title = TitleExtractor.getCurrentPageTitle();
      
      // Pass button as thumbNode for visual feedback
      await saveVideoToWLE(normalizedUrl, title, btn);
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

function showHud(message, state = 'success') {
  if (!hudElement) {
    hudElement = document.createElement('div');
    hudElement.className = 'wle-hud';
    document.body.appendChild(hudElement);
  }

  // Sanitize message (prevent XSS)
  const temp = document.createElement('div');
  temp.textContent = message;
  hudElement.textContent = temp.textContent;

  hudElement.classList.remove('wle-loading', 'wle-success', 'wle-warning');
  hudElement.classList.add(`wle-${state}`);
  hudElement.classList.add('visible');

  if (hudTimeout) clearTimeout(hudTimeout);

  if (state !== 'loading') {
    hudTimeout = setTimeout(() => {
      hudElement.classList.remove('visible');
    }, CONFIG.HUD_DISPLAY_TIME);
  }
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