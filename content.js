// ============================================
// CONSTANTS & CONFIGURATION
// ============================================
const CONFIG = {
  AUDIO_VOLUME: 0.5,
  HUD_DISPLAY_TIME: 2000,
  BUTTON_INJECTION_RETRY_INTERVAL: 500,
  BUTTON_INJECTION_MAX_TIMEOUT: 10000,
  REV_KEY: 'wleRev',
  WRITE_ATTEMPTS: 6,
  // Working out video vs Short by asking YouTube
  KIND_PROBE_TIMEOUT: 5000,
  KIND_MEMO_MAX: 200,
  BACKFILL_PER_PAGE: 3,
  BACKFILL_DELAY: 4000,
  OEMBED_MEMO_MAX: 200,
  CHANNEL_MAX_LENGTH: 100
};

// ============================================
// AUDIO MANAGEMENT (Singleton)
// ============================================
const AudioManager = {
  savedAudio: null,

  init() {
    if (!this.savedAudio) {
      this.savedAudio = new Audio(chrome.runtime.getURL('sounds/video-saved.mp3'));
    }
    return this.savedAudio;
  },

  /**
   * The popup's mixer sets the level for this sound, so read what it stored
   * rather than a constant. Anything missing or malformed falls back to the
   * default, and the master switch still overrules all of it.
   * @param {boolean} isSoundEnabled the master switch
   * @param {object} [mix] the stored audioMix, as read alongside it
   */
  play(isSoundEnabled, mix) {
    if (!isSoundEnabled) return;

    const entry = mix && typeof mix === 'object' ? mix.save : null;
    if (entry && entry.enabled === false) return;

    const stored = Number(entry?.volume);
    const volume = Number.isFinite(stored)
      ? Math.min(1, Math.max(0, stored))
      : CONFIG.AUDIO_VOLUME;
    if (volume <= 0) return;

    const audio = this.init();
    audio.volume = volume;
    audio.currentTime = 0;
    audio.play().catch((err) => console.warn('Audio play blocked:', err));
  },
  
  cleanup() {
    if (this.savedAudio) {
      this.savedAudio.pause();
      this.savedAudio.currentTime = 0;
      this.savedAudio = null;
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
// OEMBED
// YouTube answers with the title and the channel in one payload, so the two
// are worth asking for together rather than once each. Memoised per URL: a
// save resolves a title and a channel, and neither should cost its own
// round trip.
// ============================================
const OEmbed = {
  cache: new Map(),

  get(url) {
    if (!this.cache.has(url)) {
      if (this.cache.size >= CONFIG.OEMBED_MEMO_MAX) this.cache.clear();

      // A failure is not remembered: one bad moment must not stop the next
      // save from asking.
      this.cache.set(url, this.fetch(url).then((data) => {
        if (!data) this.cache.delete(url);
        return data;
      }));
    }
    return this.cache.get(url);
  },

  async fetch(url) {
    try {
      // Same origin as the page this runs in. Hardcoding www.youtube.com made
      // this a blocked cross-origin request on m.youtube.com — the extension
      // holds no host permissions — so titles never resolved there.
      const response = await fetch(
        `${window.location.origin}/oembed?url=${encodeURIComponent(url)}&format=json`
      );

      if (!response.ok) {
        throw new Error(`oEmbed request failed with status ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.warn('oEmbed fetch error:', error);
      return null;
    }
  }
};

// ============================================
// CHANNEL NAME
// Who published the video. The page says so next to almost every thumbnail,
// and oEmbed knows it for anything the page does not.
// ============================================
const ChannelExtractor = {
  // Ordered widest-to-narrowest: the first that yields text wins.
  SELECTORS: [
    'ytd-channel-name a',
    'ytd-channel-name #text',
    '#channel-name a',
    '#channel-name #text',
    'yt-reel-channel-bar-view-model a',
    '.ytReelChannelBarViewModelChannelName a',
    '.yt-core-attributed-string__link[href*="/@"]',
    'a[href*="/@"]',
    'a[href*="/channel/"]'
  ],

  TILES: 'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ' +
    'ytd-grid-video-renderer, ytd-playlist-video-renderer, ytd-reel-item-renderer, ' +
    'ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2',

  OWNERS: '#owner, ytd-video-owner-renderer, ytd-reel-player-header-renderer, ' +
    'ytd-watch-metadata, yt-reel-channel-bar-view-model',

  clean(name) {
    const text = String(name || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > CONFIG.CHANNEL_MAX_LENGTH) return null;
    // "@handle" is what some layouts show instead of the display name; it is
    // still the channel, so keep it, but a bare "YouTube" is the page chrome.
    if (/^youtube$/i.test(text)) return null;
    return text;
  },

  fromScope(scope) {
    if (!scope) return null;
    for (const selector of this.SELECTORS) {
      const name = this.clean(scope.querySelector(selector)?.textContent);
      if (name) return name;
    }
    return null;
  },

  /** The tile the click landed in, which names its own channel. */
  fromContext(element) {
    try {
      return this.fromScope(element?.closest(this.TILES));
    } catch (error) {
      console.warn('WLE: could not read the channel from the page:', error);
      return null;
    }
  },

  /** The channel of the video this page is playing. */
  fromCurrentPage() {
    try {
      // A Shorts feed keeps every reel it has scrolled through in the DOM, so
      // document order would hand back a neighbour's channel. Only one reel is
      // playing, and it says which.
      const activeReel = document.querySelector('ytd-reel-video-renderer[is-active]');
      if (activeReel) {
        const name = this.fromScope(activeReel);
        if (name) return name;
      }

      for (const owner of document.querySelectorAll(this.OWNERS)) {
        // Same reason: an owner block inside a reel that is not playing
        // belongs to a different video.
        if (owner.closest('ytd-reel-video-renderer:not([is-active])')) continue;
        const name = this.fromScope(owner);
        if (name) return name;
      }
    } catch (error) {
      console.warn('WLE: could not read the channel from the page:', error);
    }
    return null;
  },

  /** @returns {Promise<string|null>} */
  async resolve(url, element, { fromPage = false } = {}) {
    const fromDom = fromPage ? this.fromCurrentPage() : this.fromContext(element);
    if (fromDom) return fromDom;

    const data = await OEmbed.get(url);
    return this.clean(data?.author_name);
  }
};

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

  /** videoId -> Promise, so the same id is never asked about twice. */
  asked: new Map(),

  /**
   * The authoritative answer: /shorts/<id> stays put for a Short and redirects
   * to /watch for anything else. Same origin, so the final URL is readable.
   * @returns {Promise<'short'|'video'|null>} null when there is no usable answer
   */
  verify(videoId) {
    if (!this.asked.has(videoId)) {
      // A YouTube tab can live for hours; keep the memo from growing forever.
      if (this.asked.size >= CONFIG.KIND_MEMO_MAX) this.asked.clear();

      // Only an actual answer is worth remembering. Memoising a timeout or a
      // blocked request would stop this tab ever asking about that video
      // again, turning one bad moment into a permanent wrong label.
      this.asked.set(videoId, this.ask(videoId).then((result) => {
        if (result === null) this.asked.delete(videoId);
        return result;
      }));
    }
    return this.asked.get(videoId);
  },

  async ask(videoId) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.KIND_PROBE_TIMEOUT);

    // Same origin as the page this runs in. The extension has no host
    // permissions, so hardcoding www.youtube.com would make this a blocked
    // cross-origin request on m.youtube.com.
    const url = `${window.location.origin}/shorts/${videoId}`;

    try {
      let response = await fetch(url, {
        method: 'HEAD',
        redirect: 'follow',
        signal: controller.signal
      });

      // Not every YouTube front end answers a HEAD. A GET reads the same
      // redirect; the body is dropped as soon as the headers are in.
      if (response.status === 405 || response.status === 501) {
        response = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal });
        response.body?.cancel().catch(() => {});
      }

      if (!response.ok || !response.url) return null;
      if (response.url.includes('/shorts/')) return 'short';
      if (response.url.includes('/watch')) return 'video';
      return null;
    } catch (error) {
      console.warn('WLE: could not confirm the video type:', error);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
};

/**
 * Saving must not wait on the network, so the guess is stored immediately and
 * put right afterwards if YouTube disagrees. Only a guess of 'video' is worth
 * checking: a /shorts/ URL and a shorts tile are not wrong about being Shorts.
 */
async function confirmKindLater(normalizedUrl, assumedKind, { force = false } = {}) {
  if (assumedKind === 'short') return;

  const videoId = WLEUrl.extractVideoId(normalizedUrl);
  if (!videoId) return;

  const confirmed = await KindDetector.verify(videoId);
  // An answer that agrees with the guess needs no write — except during the
  // backfill, where the record has no type at all and 'video' is what it is
  // missing. Without this, every ordinary save would take the storage queue
  // through a pointless read.
  if (!confirmed || (!force && confirmed === assumedKind)) return;

  return StorageQueue.enqueue(async () => {
    // Read-modify-write on a list other tabs also write to, so it takes the
    // same snapshot guard the save path uses: without it a save made in
    // another tab between the read and the write is silently dropped.
    for (let attempt = 0; attempt < CONFIG.WRITE_ATTEMPTS; attempt++) {
      const data = await storageGet({ savedVideos: [], [CONFIG.REV_KEY]: 0 });
      const savedVideos = Array.isArray(data.savedVideos) ? data.savedVideos : [];
      const rev = data[CONFIG.REV_KEY] || 0;
      const snap = JSON.stringify(savedVideos);

      const entry = savedVideos.find((v) => v && v.url === normalizedUrl);
      if (!entry || entry.kind === confirmed) return;

      const latest = await storageGet({ savedVideos: [], [CONFIG.REV_KEY]: 0 });
      if (
        JSON.stringify(latest.savedVideos || []) !== snap ||
        (latest[CONFIG.REV_KEY] || 0) !== rev
      ) {
        await sleep(16 * (attempt + 1));
        continue;
      }

      entry.kind = confirmed;
      await storageSet({ savedVideos, [CONFIG.REV_KEY]: rev + 1 });
      console.info('WLE: saved type corrected to', confirmed, 'for', normalizedUrl);
      return;
    }
  });
}

/**
 * Fill in the channel of a record saved before channels were stored. oEmbed
 * knows it for any video id, so this needs no page around the video.
 */
async function fillChannelLater(normalizedUrl) {
  const channel = ChannelExtractor.clean((await OEmbed.get(normalizedUrl))?.author_name);
  if (!channel) return;

  return StorageQueue.enqueue(async () => {
    for (let attempt = 0; attempt < CONFIG.WRITE_ATTEMPTS; attempt++) {
      const data = await storageGet({ savedVideos: [], [CONFIG.REV_KEY]: 0 });
      const savedVideos = Array.isArray(data.savedVideos) ? data.savedVideos : [];
      const rev = data[CONFIG.REV_KEY] || 0;
      const snap = JSON.stringify(savedVideos);

      const entry = savedVideos.find((v) => v && v.url === normalizedUrl);
      if (!entry || entry.channel) return;

      const latest = await storageGet({ savedVideos: [], [CONFIG.REV_KEY]: 0 });
      if (
        JSON.stringify(latest.savedVideos || []) !== snap ||
        (latest[CONFIG.REV_KEY] || 0) !== rev
      ) {
        await sleep(16 * (attempt + 1));
        continue;
      }

      entry.channel = channel;
      await storageSet({ savedVideos, [CONFIG.REV_KEY]: rev + 1 });
      return;
    }
  });
}

/**
 * Records saved before this version are missing what did not exist then: a
 * type, a channel, or both. The popup cannot ask YouTube about them — the
 * extension holds no host permissions, so a fetch from the extension page
 * would be cross-origin — which leaves this content script, on a YouTube tab,
 * as the only place the question can be put.
 *
 * A few per page load, so it never looks like a crawl, and only ever for what
 * is actually missing.
 */
async function backfillSaves() {
  try {
    const data = await storageGet({ savedVideos: [] });
    const savedVideos = Array.isArray(data.savedVideos) ? data.savedVideos : [];

    const stale = savedVideos
      .filter((v) => {
        if (!v || !WLEUrl.extractVideoId(v.url)) return false;
        return (v.kind !== 'short' && v.kind !== 'video') || !v.channel;
      })
      .slice(0, CONFIG.BACKFILL_PER_PAGE);

    // Sequentially: the point is to be unobtrusive, not fast.
    for (const entry of stale) {
      if (entry.kind !== 'short' && entry.kind !== 'video') {
        // force, because here even an answer of 'video' is news — the record
        // has no type at all.
        await confirmKindLater(entry.url, 'video', { force: true });
      }
      if (!entry.channel) await fillChannelLater(entry.url);
    }
  } catch (error) {
    console.warn('WLE: could not fill in the details of older saves:', error);
  }
}

// ============================================
// VIDEO SAVING LOGIC (Centralized)
// ============================================
/**
 * @param {string} kind 'short' or 'video' — the stored link is always the
 *   canonical watch URL, so what it was saved from has to be recorded here.
 * @param {string|null} channel who published it, when the page or oEmbed says
 */
async function saveVideoToWLE(url, title, kind, channel) {
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
          audioMix: null,
          [CONFIG.REV_KEY]: 0
        });
        const savedVideos = Array.isArray(data.savedVideos) ? data.savedVideos : [];
        const snap = JSON.stringify(savedVideos);
        const rev = data[CONFIG.REV_KEY] || 0;
        const isSoundEnabled = data.soundEnabled ?? true;
        const audioMix = data.audioMix;

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
          const upgrade = kind === 'short' && existing.kind !== 'short';
          // Saved before types existed: give it one, so the check that runs
          // after this has something to correct. Leaving it without a type
          // returns nothing to the caller, which silences that check entirely.
          const untyped = existing.kind !== 'short' && existing.kind !== 'video';

          // A record from before channels were stored gets one now, for free.
          const learntChannel = Boolean(channel) && !existing.channel;
          if (learntChannel) existing.channel = channel;

          if (upgrade || untyped || learntChannel) {
            if (upgrade || untyped) existing.kind = upgrade ? 'short' : 'video';
            await storageSet({ savedVideos, [CONFIG.REV_KEY]: rev + 1 });
          }

          showHud(upgrade ? 'Already saved — now marked as a Short' : 'Already saved!');
          return existing.kind;
        }

        const settledKind = kind === 'short' ? 'short' : 'video';

        const record = {
          url: normalizedUrl,
          title: title || 'Untitled Video',
          kind: settledKind,
          tags: [],
          watched: false,
          watchedAt: null,
          savedAt: Date.now()
        };
        // Absent rather than empty when unknown, so the backfill can tell
        // "never looked" from "looked, and there is none".
        if (channel) record.channel = channel;

        savedVideos.push(record);

        await storageSet({
          savedVideos,
          [CONFIG.REV_KEY]: rev + 1
        });

        AudioManager.play(isSoundEnabled, audioMix);
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
    const data = await OEmbed.get(url);
    return data?.title || null;
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
  // Alt + Shift + click belongs to the mini player, in detach.js. Without this
  // the same click would both save the video and play it.
  if (!event.altKey || event.shiftKey) return;

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

    const [title, channel] = await Promise.all([
      TitleExtractor.resolveTitle(normalizedUrl, videoLink),
      ChannelExtractor.resolve(normalizedUrl, videoLink)
    ]);
    await saveVideoToWLE(normalizedUrl, title, KindDetector.fromContext(url, videoLink), channel);
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

    const [title, channel] = await Promise.all([
      TitleExtractor.resolveCurrentPageTitle(normalizedUrl),
      ChannelExtractor.resolve(normalizedUrl, videoPlayer, { fromPage: true })
    ]);
    await saveVideoToWLE(
      normalizedUrl, title, KindDetector.fromContext(window.location.href, videoPlayer), channel
    );
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

      const [title, channel] = await Promise.all([
        TitleExtractor.resolveCurrentPageTitle(normalizedUrl),
        ChannelExtractor.resolve(normalizedUrl, null, { fromPage: true })
      ]);
      await saveVideoToWLE(
        normalizedUrl, title, KindDetector.fromContext(window.location.href, null), channel
      );
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

// When the page has nothing better to do, so it never competes with YouTube's
// own loading — it reads storage and asks YouTube two questions, and neither
// is worth a millisecond of a video starting. The timeout is the promise that
// it happens at all on a page that never goes idle; the plain timer is for
// browsers without requestIdleCallback. Once per content script, not once per
// SPA navigation.
const canIdle = typeof requestIdleCallback === 'function';
const backfillHandle = canIdle
  ? requestIdleCallback(backfillSaves, { timeout: CONFIG.BACKFILL_DELAY })
  : setTimeout(backfillSaves, CONFIG.BACKFILL_DELAY);

// The two take handles from different pools, and cancelling one with the
// other's function would cancel whatever unrelated thing holds that number.
function cancelBackfill() {
  if (canIdle) cancelIdleCallback(backfillHandle);
  else clearTimeout(backfillHandle);
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
// pagehide, not unload. An unload listener makes a page ineligible for the
// browser's back/forward cache, so every Back out of a YouTube video would be
// a full page load instead of an instant restore — the extension slowing down
// the site it is a guest on, for a teardown that has a modern event of its
// own. pagehide fires everywhere unload does.
window.addEventListener('pagehide', () => {
  AudioManager.cleanup();
  ButtonInjector.stopInjection();
  cancelBackfill();

  if (hudTimeout) {
    clearTimeout(hudTimeout);
  }
  
  if (hudElement && hudElement.parentNode) {
    hudElement.parentNode.removeChild(hudElement);
  }
});