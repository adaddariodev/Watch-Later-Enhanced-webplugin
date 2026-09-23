// ============================================
// CONSTANTS & CONFIGURATION
// ============================================
const CONFIG = {
  AUDIO_VOLUME: 0.5,
  TAG_MAX_LENGTH: 22,
  DEBOUNCE_DELAY: 300,
  TRASH_CAP: 50,           // max items kept in the trash (oldest are purged)
  RENDER_CHUNK: 50,        // rows built per pass; the rest follow as you scroll
  RENDER_AHEAD: '600px',   // how far below the fold the next chunk is fetched
  UNDO_DURATION: 2500,     // how long the undo toast stays up (ms)
  DONATE_PROMPT_CHANCE: 0.35,                // chance to show the donate callout on open
  DONATE_PROMPT_COOLDOWN: 3 * 60 * 60 * 1000, // min time between prompts (ms)
  STORAGE_KEYS: {
    VIDEOS: 'savedVideos',
    DELETED: 'deletedVideos',
    SOUND: 'soundEnabled',
    SUPPORTER: 'supporter',
    LAST_PROMPT: 'lastDonatePrompt',
    HIDE_JM_BANNER: 'hideJobsMatchBanner',
    DETACH: 'detachEnabled',
    MINI_WINDOW_SIZE: 'miniWindowSize',
    TYPE_FILTER: 'typeFilter',
    FAVOURITES_ONLY: 'favouritesOnly',
    AUDIO_MIX: 'audioMix',
    REV: 'wleRev'
  },
  // Per-sound level and on/off. 'click' plays here in the popup, 'save' plays
  // on YouTube when a video is added — the content script reads the same key.
  // soundEnabled stays the master switch over both.
  AUDIO_DEFAULTS: {
    click: { enabled: true, volume: 0.5 },
    save: { enabled: true, volume: 0.5 }
  },
  AUDIO_WRITE_DELAY: 200,   // settle time before a mixer change reaches storage
  // 'video' unless a record says otherwise: entries saved before the kind was
  // recorded carry no type, and most of them are videos.
  KINDS: {
    video: 'Video',
    short: 'Shorts'
  },
  MINI_WINDOW: {
    MARKER: 'wle-mini',   // detach.js recognises the window by this hash
    // The service worker owns the size and the window itself; this is only
    // the message that asks it to. Kept in step with MESSAGES in background.js.
    OPEN: 'wle-mini-window-open'
  },
  WRITE_ATTEMPTS: 6,
  // Peppered SHA-256 of supporter unlock material. Plaintext is not in this repository.
  UNLOCK: {
    p: '13c7fd3a9477bf036da5c0d02bb1dc85',
    d: ['5fa8fb99e05a8273b4214a4ca1e2ad01', '4916f0d411ef0b67ac58851273d0363a']
  }
};

// ============================================
// AUDIO MANAGEMENT (Singleton Pattern)
// ============================================
const AudioManager = {
  clickAudio: null,
  saveAudio: null,   // only ever built to preview the mixer's save row

  init() {
    if (!this.clickAudio) {
      this.clickAudio = new Audio('sounds/click.mp3');
    }
    return this.clickAudio;
  },

  /**
   * @param {boolean} soundEnabled the master switch
   * @param {number} [volume] 0-1, for previewing while the slider moves
   */
  play(soundEnabled, volume) {
    const level = typeof volume === 'number' ? volume : AudioMix.levelFor('click');
    if (!soundEnabled || level <= 0) return;

    const audio = this.init();
    audio.volume = level;
    audio.currentTime = 0;
    audio.play().catch(e => console.warn("Audio play blocked:", e));
  },

  /**
   * Play a sound at a given level so its slider can be heard where it is set.
   * The save sound belongs to YouTube pages, but it ships with the extension,
   * so the mixer can play it here rather than leaving that row set blind.
   */
  preview(name, volume) {
    if (name === 'click') {
      this.play(true, volume);
      return;
    }

    if (!this.saveAudio) this.saveAudio = new Audio('sounds/success.wav');
    this.saveAudio.volume = volume;
    this.saveAudio.currentTime = 0;
    this.saveAudio.play().catch((e) => console.warn('Audio play blocked:', e));
  },

  cleanup() {
    if (this.saveAudio) {
      this.saveAudio.pause();
      this.saveAudio = null;
    }
    if (this.clickAudio) {
      this.clickAudio.pause();
      this.clickAudio.currentTime = 0;
      this.clickAudio = null;
    }
  }
};

// ============================================
// SOUND MIXER STATE
// One shape, read by the popup and by the content script, so a level set here
// is the level heard on YouTube.
// ============================================
const AudioMix = {
  mix: null,

  /** Anything stored is user input from an older version or another tab. */
  normalize(raw) {
    const out = {};
    Object.entries(CONFIG.AUDIO_DEFAULTS).forEach(([name, fallback]) => {
      const stored = raw && typeof raw === 'object' ? raw[name] : null;
      const volume = Number(stored?.volume);
      out[name] = {
        enabled: stored?.enabled !== false,
        volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : fallback.volume
      };
    });
    return out;
  },

  load(raw) {
    this.mix = this.normalize(raw);
    return this.mix;
  },

  get(name) {
    if (!this.mix) this.mix = this.normalize(null);
    return this.mix[name] || { ...CONFIG.AUDIO_DEFAULTS[name] };
  },

  /** The level to play at, or 0 when this sound is switched off. */
  levelFor(name) {
    const entry = this.get(name);
    return entry.enabled ? entry.volume : 0;
  },

  writeTimer: null,

  /**
   * Dragging a slider fires input by the dozen, and writing each one cost a
   * disk write and a storage event in every open YouTube tab. The value in
   * memory is what the UI reads, so only the one the user settles on needs
   * to reach storage.
   */
  persist() {
    clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      chrome.storage.local.set({ [CONFIG.STORAGE_KEYS.AUDIO_MIX]: this.mix });
    }, CONFIG.AUDIO_WRITE_DELAY);
  },

  /** A popup can be shut mid-drag, which would drop the pending write. */
  flush() {
    if (!this.writeTimer) return;
    clearTimeout(this.writeTimer);
    this.writeTimer = null;
    chrome.storage.local.set({ [CONFIG.STORAGE_KEYS.AUDIO_MIX]: this.mix });
  },

  set(name, patch) {
    if (!this.mix) this.mix = this.normalize(null);
    this.mix[name] = { ...this.get(name), ...patch };
    this.persist();
    return this.mix[name];
  }
};

// ============================================
// DOM ELEMENT CACHE
// ============================================
const DOMCache = {
  soundBtn: null,
  tagSearchInput: null,
  videoList: null,
  tutorial: null,
  settingsModal: null,
  viewTabs: null,
  toast: null,
  trashActions: null,
  emptyTrashBtn: null,
  searchWrap: null,
  donateBtn: null,
  donateCallout: null,
  scrollContainer: null,
  jmBanner: null,
  hideBannerRow: null,
  hideBannerSwitch: null,
  hideBannerHint: null,
  supporterUnlock: null,
  supporterCodeInput: null,
  supporterUnlockBtn: null,
  supporterUnlockStatus: null,
  miniPlayerRow: null,
  miniPlayerSwitch: null,
  wikiRow: null,
  wikiBtn: null,
  typeFilter: null,
  favouritesFilter: null,
  searchToggle: null,

  init() {
    this.soundBtn = document.getElementById('toggle-sound');
    this.tagSearchInput = document.getElementById('tag-search');
    this.videoList = document.getElementById('video-list');
    this.tutorial = document.getElementById('tutorial');
    this.settingsModal = document.getElementById('settings-modal');
    this.viewTabs = document.getElementById('view-tabs');
    this.toast = document.getElementById('wle-toast');
    this.trashActions = document.getElementById('trash-actions');
    this.emptyTrashBtn = document.getElementById('empty-trash');
    this.searchWrap = document.querySelector('.searchbar-wrap');
    this.donateBtn = document.getElementById('ko-fi-button');
    this.donateCallout = document.getElementById('donate-callout');
    this.scrollContainer = document.querySelector('main');
    this.jmBanner = document.getElementById('jobsmatch-banner');
    this.hideBannerRow = document.getElementById('hide-banner-row');
    this.hideBannerSwitch = document.getElementById('toggle-hide-banner');
    this.hideBannerHint = document.getElementById('hide-banner-hint');
    this.supporterUnlock = document.getElementById('supporter-unlock');
    this.supporterCodeInput = document.getElementById('supporter-code');
    this.supporterUnlockBtn = document.getElementById('supporter-unlock-btn');
    this.supporterUnlockStatus = document.getElementById('supporter-unlock-status');
    this.miniPlayerRow = document.getElementById('mini-player-row');
    this.miniPlayerSwitch = document.getElementById('toggle-mini-player');
    this.wikiRow = document.getElementById('wiki-row');
    this.wikiBtn = document.getElementById('open-wiki');
    this.typeFilter = document.getElementById('type-filter');
    this.favouritesFilter = document.getElementById('favourites-filter');
    this.searchToggle = document.getElementById('search-toggle');
  }
};

// ============================================
// STATE MANAGEMENT
// ============================================
const AppState = {
  soundEnabled: true,
  tagQuery: '',
  tagQueryMode: 'contains',
  typeFilter: 'all', // 'all' | 'video' | 'short'
  favouritesOnly: false,
  draggedItemIndex: null,
  view: 'active', // 'active' | 'archive' | 'trash'
  supporter: false,
  hideJobsMatchBanner: false,
  detachEnabled: true,

  setSoundEnabled(value) {
    this.soundEnabled = value;
    chrome.storage.local.set({ [CONFIG.STORAGE_KEYS.SOUND]: value });
  },

  setTagQuery(value, mode = 'contains') {
    this.tagQuery = value.trim().toLowerCase();
    this.tagQueryMode = mode;
  },

  /**
   * Whether what is on screen is a subset of the real list. Asked in one place
   * because it was asked in two: reordering was switched off for a favourites
   * filter while the drag handle still offered to reorder, the two conditions
   * having been written out separately and then drifted apart.
   */
  isFiltered() {
    return Boolean(this.tagQuery) || this.typeFilter !== 'all' || this.favouritesOnly;
  },

  setView(view) {
    this.view = view;
  },

  setFavouritesOnly(value) {
    this.favouritesOnly = value === true;
    chrome.storage.local.set({ [CONFIG.STORAGE_KEYS.FAVOURITES_ONLY]: this.favouritesOnly });
  },

  setTypeFilter(value) {
    this.typeFilter = value === 'video' || value === 'short' ? value : 'all';
    chrome.storage.local.set({ [CONFIG.STORAGE_KEYS.TYPE_FILTER]: this.typeFilter });
  }
};

// ============================================
// DRAG AUTO-SCROLL
// Native HTML5 drag doesn't scroll the list; when the pointer nears the top
// or bottom edge of the scroll container we nudge it, so items can be dragged
// beyond the currently visible area.
// ============================================
const DragScroller = {
  raf: null,
  pointerY: 0,
  active: false,
  EDGE: 55,     // px hot-zone at top/bottom
  SPEED: 14,    // max px scrolled per frame

  start() {
    if (this.active) return;
    this.active = true;
    this.raf = requestAnimationFrame(() => this.tick());
  },

  update(y) {
    this.pointerY = y;
  },

  stop() {
    this.active = false;
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
  },

  tick() {
    if (!this.active) {
      this.raf = null;
      return;
    }

    const c = DOMCache.scrollContainer;
    if (c) {
      const rect = c.getBoundingClientRect();

      // The top of the list is overlaid by the sticky tabs + searchbar, so the
      // real top boundary of the hot-zone is the BOTTOM of that sticky header —
      // otherwise the upper hot-zone hides behind it and never triggers.
      let topBound = rect.top;
      const header = (DOMCache.searchWrap && DOMCache.searchWrap.offsetParent !== null)
        ? DOMCache.searchWrap
        : DOMCache.viewTabs;
      if (header) {
        topBound = Math.max(topBound, header.getBoundingClientRect().bottom);
      }

      const top = this.pointerY - topBound;
      const bottom = rect.bottom - this.pointerY;
      let dy = 0;

      if (top < this.EDGE) {
        dy = -Math.ceil(Math.min(1, (this.EDGE - top) / this.EDGE) * this.SPEED);
      } else if (bottom < this.EDGE) {
        dy = Math.ceil(Math.min(1, (this.EDGE - bottom) / this.EDGE) * this.SPEED);
      }

      if (dy) c.scrollTop += dy;
    }

    this.raf = requestAnimationFrame(() => this.tick());
  }
};

// ============================================
// UTILITY FUNCTIONS
// ============================================
const Utils = {
  colorFromTagName(name) {
    const s = String(name || '').trim().toLowerCase();
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
      hash = (hash * 31 + s.charCodeAt(i)) | 0;
    }
    const h = Math.abs(hash) % 360;
    return `hsl(${h} 70% 45%)`;
  },

  /**
   * Normalize video object structure.
   * IMPORTANT: tag colors are ALWAYS recomputed from the tag name and never
   * trusted from storage — this keeps imported data safe (a hostile `color`
   * field such as `url(...)` could otherwise trigger a network request).
   * Uses Utils.colorFromTagName (not this.) because it runs as a .map() callback.
   */
  normalizeVideo(video) {
    if (!video || typeof video !== 'object') {
      return null;
    }

    const tags = Array.isArray(video?.tags) ? video.tags : [];
    const normalizedTags = tags
      .filter((t) => t && typeof t.name === 'string' && t.name.trim().length > 0)
      .map((t) => ({
        name: String(t.name).trim(),
        color: Utils.colorFromTagName(t.name),
      }));

    const normalized = {
      ...video,
      title: video.title || 'Untitled Video',
      url: video.url || '',
      tags: normalizedTags,
      watched: video.watched === true,
      watchedAt: typeof video.watchedAt === 'number' ? video.watchedAt : null,
      savedAt: typeof video.savedAt === 'number' ? video.savedAt : null,
      favourite: video.favourite === true,
    };

    // Unknown is not 'video'. A record saved before types existed has no type
    // yet, and asserting one here would freeze the guess into storage the next
    // time the list is written back — after which nothing could tell a real
    // video from one that was never checked. The key stays absent instead, and
    // the content script fills it in when it can ask YouTube.
    if (video.kind !== 'short' && video.kind !== 'video') delete normalized.kind;

    // Same reasoning for the channel: absent means "not looked up yet", which
    // is what the backfill looks for. An empty string would hide it forever.
    const channel = typeof video.channel === 'string' ? video.channel.trim() : '';
    if (channel) normalized.channel = channel;
    else delete normalized.channel;

    return normalized;
  },

  /** Unknown reads as a video everywhere it is shown or counted. */
  isShort(video) {
    return video?.kind === 'short';
  },

  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  },

  createBtnIcon(src, alt = '') {
    const img = document.createElement('img');
    img.className = 'btn-icon';
    img.src = src;
    img.alt = alt;
    img.decoding = 'async';
    img.loading = 'lazy';
    return img;
  }
};

// ============================================
// STORAGE OPERATIONS
// ============================================
const StorageManager = {
  _queue: Promise.resolve(),

  enqueue(fn) {
    const next = this._queue.then(fn, fn);
    this._queue = next.catch((error) => {
      console.error('Storage queue error:', error);
    });
    return next;
  },

  getRaw(defaults) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(defaults, (data) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(data);
      });
    });
  },

  setRaw(values) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(values, () => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve();
      });
    });
  },

  normalizeList(videos) {
    return (videos || [])
      .map((v) => Utils.normalizeVideo(v))
      .filter((v) => v !== null);
  },

  normalizeDeleted(deleted) {
    return (deleted || [])
      .map((v) => {
        const norm = Utils.normalizeVideo(v);
        if (!norm) return null;
        norm.deletedAt = typeof v.deletedAt === 'number' ? v.deletedAt : Date.now();
        norm._idx = typeof v._idx === 'number' ? v._idx : null;
        return norm;
      })
      .filter((v) => v !== null);
  },

  async getVideos() {
    try {
      const data = await this.getRaw({ [CONFIG.STORAGE_KEYS.VIDEOS]: [] });
      return this.normalizeList(data[CONFIG.STORAGE_KEYS.VIDEOS]);
    } catch (error) {
      console.error('Storage read error:', error);
      return [];
    }
  },

  async getDeleted() {
    try {
      const data = await this.getRaw({ [CONFIG.STORAGE_KEYS.DELETED]: [] });
      return this.normalizeDeleted(data[CONFIG.STORAGE_KEYS.DELETED]);
    } catch (error) {
      console.error('Storage read error:', error);
      return [];
    }
  },

  notifyWriteError(error) {
    console.error('Storage write error:', error);
    const msg = String(error && (error.message || error));
    showToast(/quota/i.test(msg) ? 'Could not save — storage may be full' : 'Could not save list');
  },

  /**
   * Read-modify-write both lists in one set(). Retries if another writer
   * changed storage between the snapshot and the write.
   */
  async mutateLists(mutator) {
    return this.enqueue(async () => {
      const keys = {
        [CONFIG.STORAGE_KEYS.VIDEOS]: [],
        [CONFIG.STORAGE_KEYS.DELETED]: [],
        [CONFIG.STORAGE_KEYS.REV]: 0
      };

      for (let attempt = 0; attempt < CONFIG.WRITE_ATTEMPTS; attempt++) {
        const data = await this.getRaw(keys);
        const snapV = JSON.stringify(data[CONFIG.STORAGE_KEYS.VIDEOS] || []);
        const snapD = JSON.stringify(data[CONFIG.STORAGE_KEYS.DELETED] || []);
        const rev = data[CONFIG.STORAGE_KEYS.REV] || 0;

        const ctx = {
          videos: this.normalizeList(data[CONFIG.STORAGE_KEYS.VIDEOS]),
          deleted: this.normalizeDeleted(data[CONFIG.STORAGE_KEYS.DELETED]),
          result: undefined
        };
        mutator(ctx);

        const latest = await this.getRaw(keys);
        if (
          JSON.stringify(latest[CONFIG.STORAGE_KEYS.VIDEOS] || []) !== snapV ||
          JSON.stringify(latest[CONFIG.STORAGE_KEYS.DELETED] || []) !== snapD ||
          (latest[CONFIG.STORAGE_KEYS.REV] || 0) !== rev
        ) {
          await new Promise((r) => setTimeout(r, 16 * (attempt + 1)));
          continue;
        }

        await this.setRaw({
          [CONFIG.STORAGE_KEYS.VIDEOS]: ctx.videos,
          [CONFIG.STORAGE_KEYS.DELETED]: ctx.deleted,
          [CONFIG.STORAGE_KEYS.REV]: rev + 1
        });
        return ctx.result;
      }

      throw new Error('Storage write conflict');
    });
  },

  async updateVideoByUrl(url, updates) {
    try {
      return await this.mutateLists((ctx) => {
        const idx = ctx.videos.findIndex((v) => v.url === url);
        if (idx === -1) {
          ctx.result = false;
          return;
        }
        ctx.videos[idx] = { ...ctx.videos[idx], ...updates };
        ctx.result = true;
      });
    } catch (error) {
      this.notifyWriteError(error);
      return false;
    }
  },

  async toggleFavourite(url) {
    try {
      return await this.mutateLists((ctx) => {
        const idx = ctx.videos.findIndex((v) => v.url === url);
        if (idx === -1) {
          ctx.result = { ok: false };
          return;
        }
        const favourite = !ctx.videos[idx].favourite;
        ctx.videos[idx] = { ...ctx.videos[idx], favourite };
        ctx.result = { ok: true, favourite };
      });
    } catch (error) {
      this.notifyWriteError(error);
      return { ok: false };
    }
  },

  async toggleWatched(url) {
    try {
      return await this.mutateLists((ctx) => {
        const idx = ctx.videos.findIndex((v) => v.url === url);
        if (idx === -1) {
          ctx.result = { ok: false };
          return;
        }
        const watched = !ctx.videos[idx].watched;
        ctx.videos[idx] = {
          ...ctx.videos[idx],
          watched,
          watchedAt: watched ? Date.now() : null
        };
        ctx.result = { ok: true, watched };
      });
    } catch (error) {
      this.notifyWriteError(error);
      return { ok: false };
    }
  },

  async softDelete(urls) {
    try {
      return await this.mutateLists((ctx) => {
        const urlSet = new Set(urls);
        const now = Date.now();
        const moved = [];
        const remaining = [];
        ctx.videos.forEach((v, i) => {
          if (urlSet.has(v.url)) {
            moved.push({ ...v, deletedAt: now, _idx: i });
          } else {
            remaining.push(v);
          }
        });
        if (moved.length === 0) {
          ctx.result = [];
          return;
        }
        ctx.videos = remaining;
        ctx.deleted = [...moved, ...ctx.deleted].slice(0, CONFIG.TRASH_CAP);
        ctx.result = moved.map((m) => m.url);
      });
    } catch (error) {
      this.notifyWriteError(error);
      return [];
    }
  },

  async restore(urls) {
    try {
      return await this.mutateLists((ctx) => {
        const urlSet = new Set(urls);
        const toRestore = ctx.deleted.filter((d) => urlSet.has(d.url));
        const remainingTrash = ctx.deleted.filter((d) => !urlSet.has(d.url));

        toRestore.sort((a, b) => (a._idx ?? Number.MAX_SAFE_INTEGER) - (b._idx ?? Number.MAX_SAFE_INTEGER));

        toRestore.forEach((d) => {
          const clean = { ...d };
          delete clean.deletedAt;
          delete clean._idx;
          const pos = typeof d._idx === 'number'
            ? Math.min(Math.max(d._idx, 0), ctx.videos.length)
            : ctx.videos.length;
          ctx.videos.splice(pos, 0, clean);
        });

        ctx.deleted = remainingTrash;
        ctx.result = true;
      });
    } catch (error) {
      this.notifyWriteError(error);
      return false;
    }
  },

  async permanentDelete(urls) {
    try {
      return await this.mutateLists((ctx) => {
        const urlSet = new Set(urls);
        ctx.deleted = ctx.deleted.filter((d) => !urlSet.has(d.url));
        ctx.result = true;
      });
    } catch (error) {
      this.notifyWriteError(error);
      return false;
    }
  },

  async emptyTrash() {
    try {
      return await this.mutateLists((ctx) => {
        ctx.deleted = [];
        ctx.result = true;
      });
    } catch (error) {
      this.notifyWriteError(error);
      return false;
    }
  },

  async reorder(fromIndex, toIndex) {
    try {
      return await this.mutateLists((ctx) => {
        if (
          fromIndex < 0 ||
          toIndex < 0 ||
          fromIndex >= ctx.videos.length
        ) {
          ctx.result = false;
          return;
        }
        const [item] = ctx.videos.splice(fromIndex, 1);
        if (!item) {
          ctx.result = false;
          return;
        }
        const dest = Math.min(toIndex, ctx.videos.length);
        ctx.videos.splice(dest, 0, item);
        ctx.result = true;
      });
    } catch (error) {
      this.notifyWriteError(error);
      return false;
    }
  },

  async getAllTagNames() {
    const videos = await this.getVideos();
    const seen = new Map();
    videos.forEach((v) => {
      (v.tags || []).forEach((t) => {
        const key = t.name.toLowerCase();
        if (!seen.has(key)) seen.set(key, t.name);
      });
    });
    return [...seen.values()];
  }
};

// ============================================
// VIDEO ITEM CREATION
// ============================================
const VideoItemFactory = {
  /**
   * @param {object} video
   * @param {number} index  position in the full saved-videos array (for drag reorder)
   * @param {'active'|'archive'|'trash'} mode
   */
  create(video, index, mode = 'active') {
    const li = document.createElement('li');
    li.className = 'video-item';
    li.dataset.url = video.url;
    li.dataset.index = String(index);

    const editable = mode !== 'trash';
    // Reordering writes positions in the full list, so it only makes sense
    // while the list on screen is the full list.
    const isFiltered = AppState.isFiltered();
    const canDrag = mode === 'active' && !isFiltered;
    li.draggable = canDrag;
    if (mode === 'active' && isFiltered) li.classList.add('drag-disabled');

    const { row, tagAddBtn, secondaryActions } = this.createVideoRow(video, index, mode, canDrag);
    li.appendChild(row);

    // What the video is, then what you called it: one row each, so a long
    // channel name and a pile of tags never share a line. The second half of
    // the buttons rides along on the first of those rows.
    li.appendChild(this.createMetaRow(video, secondaryActions));

    if (editable) {
      li.appendChild(this.createTagRow(video, li, tagAddBtn));
    } else if (Array.isArray(video.tags) && video.tags.length) {
      const tagRow = document.createElement('div');
      tagRow.className = 'tag-row';
      video.tags.forEach((tag) => tagRow.appendChild(this.createReadonlyPill(tag)));
      li.appendChild(tagRow);
    }

    if (canDrag) this.attachDragListeners(li);

    return li;
  },

  createVideoRow(video, index, mode, canDrag) {
    const row = document.createElement('div');
    row.className = 'video-row';

    const left = document.createElement('div');
    left.className = 'video-left';

    // Shown whenever reordering is a thing in this view, even when a filter
    // has it switched off: hiding it would shift every row sideways and leave
    // no hint that reordering exists at all.
    if (mode === 'active') {
      left.appendChild(this.createDragHandle());
    }

    left.appendChild(this.createTitle(video.title));

    const { primary, secondary, tagAddBtn } = this.createActions(index, mode, video);
    row.append(left, primary);

    return { row, tagAddBtn, secondaryActions: secondary };
  },

  createDragHandle() {
    const handle = document.createElement('div');
    handle.className = 'drag-handle';
    handle.title = AppState.isFiltered()
      ? 'Clear the filters to reorder'
      : 'Hold and drag to reorder';
    handle.appendChild(Utils.createBtnIcon('icons/buttons/menu-burger.svg', ''));
    return handle;
  },

  createTitle(title) {
    const titleEl = document.createElement('span');
    titleEl.className = 'video-title';
    titleEl.textContent = title;
    return titleEl;
  },

  /**
   * The Video/Shorts label. It lives under the title, on the meta row, so it
   * never eats into the two lines the title gets.
   */
  createKindPill(kind) {
    const type = kind === 'short' ? 'short' : 'video';
    const pill = document.createElement('span');
    pill.className = `kind-pill kind-pill-${type}`;
    pill.textContent = CONFIG.KINDS[type];
    // Out of the title it reads as a bare word next to the tag names, so say
    // what the word is for. No title attribute: it would only repeat the text
    // already on screen, as a tooltip on every row.
    pill.setAttribute('aria-label', `Type: ${CONFIG.KINDS[type]}`);
    return pill;
  },

  /**
   * Who published it. Only for records that carry a channel — the ones saved
   * before this existed get theirs filled in from a YouTube tab, and until
   * then showing an empty pill would be worse than showing none.
   */
  createChannelPill(channel) {
    const pill = document.createElement('span');
    pill.className = 'channel-pill';
    pill.textContent = channel;
    // The pill truncates when the name is long, so the full one stays
    // readable on hover and to a screen reader.
    pill.title = channel;
    pill.setAttribute('aria-label', `Channel: ${channel}`);
    return pill;
  },

  makeIconButton(className, iconSrc, title) {
    const btn = document.createElement('button');
    btn.className = `icon-btn ${className}`;
    btn.type = 'button';
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.appendChild(Utils.createBtnIcon(iconSrc, ''));
    return btn;
  },

  /** One row of the buttons. Both keep the class the click handler looks for. */
  makeActionGroup(modifier) {
    const group = document.createElement('div');
    group.className = `video-actions ${modifier}`;
    return group;
  },

  /**
   * The buttons, over two rows rather than one. Five of them in a line take
   * about 170px of a 400px popup away from the title on every card, which is
   * what was clipping titles at a word or two.
   *
   * What plays the video sits beside the title; what files it away sits on the
   * row below, level with the pills. An empty group is hidden in CSS, so trash
   * — which has no primary action — gives the title the whole width.
   */
  createActions(index, mode, video) {
    const primary = this.makeActionGroup('video-actions-primary');
    const secondary = this.makeActionGroup('video-actions-secondary');
    let tagAddBtn = null;

    if (mode === 'trash') {
      const restoreBtn = this.makeIconButton('restore-btn', 'icons/buttons/rotate-left.svg', 'Restore video');
      const permaBtn = this.makeIconButton('perma-delete-btn', 'icons/buttons/trash-xmark.svg', 'Delete permanently');
      secondary.append(restoreBtn, permaBtn);
      return { primary, secondary, tagAddBtn };
    }

    // active / archive
    if (AppState.detachEnabled) {
      // A player floating in front of a window: the same icon this action
      // carries everywhere else — on a YouTube thumbnail, and in the player's
      // own control bar.
      const miniBtn = this.makeIconButton(
        'mini-player-btn',
        'icons/buttons/mini-player.svg',
        'Play in a mini player window'
      );
      primary.appendChild(miniBtn);
    }

    // Filled and red when it is a favourite, an outline when it is not — the
    // state is the icon, so the button says which it is without being read.
    const favBtn = this.makeIconButton(
      'favourite-btn',
      video.favourite ? 'icons/buttons/heart-filled.svg' : 'icons/buttons/heart.svg',
      video.favourite ? 'Remove from favourites' : 'Add to favourites'
    );
    favBtn.classList.toggle('is-favourite', video.favourite === true);
    favBtn.setAttribute('aria-pressed', video.favourite ? 'true' : 'false');
    primary.appendChild(favBtn);

    if (mode === 'archive') {
      const unwatchBtn = this.makeIconButton('watch-toggle-btn', 'icons/buttons/rotate-left.svg', 'Move back to To Watch');
      secondary.appendChild(unwatchBtn);
    } else {
      const watchedBtn = this.makeIconButton('watch-toggle-btn', 'icons/buttons/check.svg', 'Mark as watched');
      secondary.appendChild(watchedBtn);
    }

    tagAddBtn = this.makeIconButton('tag-add-btn', 'icons/buttons/tags.svg', 'Add tag');
    secondary.appendChild(tagAddBtn);

    const delBtn = this.makeIconButton('delete-btn', 'icons/buttons/cross-small.svg', 'Remove video');
    delBtn.dataset.index = String(index);
    secondary.appendChild(delBtn);

    return { primary, secondary, tagAddBtn };
  },

  /**
   * What YouTube says about the video: its type, and who published it — with
   * the second row of buttons on the same line, hard right.
   * @param {HTMLElement} [actions] the secondary button group
   */
  createMetaRow(video, actions) {
    const row = document.createElement('div');
    row.className = 'meta-row';

    // The pills live in their own box so they wrap against each other and not
    // against the buttons, which stay on one line whatever the channel is
    // called.
    const pills = document.createElement('div');
    pills.className = 'meta-pills';
    pills.appendChild(this.createKindPill(video.kind));
    if (video.channel) pills.appendChild(this.createChannelPill(video.channel));
    row.appendChild(pills);

    if (actions) row.appendChild(actions);
    return row;
  },

  createTagRow(video, li, tagAddBtn) {
    const tagRow = document.createElement('div');
    tagRow.className = 'tag-row';

    const tags = Array.isArray(video.tags) ? video.tags : [];

    tags.forEach(tag => {
      const pill = this.createTagPill(tag, li);
      tagRow.appendChild(pill);
    });

    const tagEditor = this.createTagInput(li, tagAddBtn, video);
    tagRow.appendChild(tagEditor);

    // With no tags the row holds only the closed editor. Left in the layout it
    // would still take the card's row gap, so every untagged video would carry
    // a strip of nothing. The editor opening puts it back.
    if (!tags.length) tagRow.classList.add('is-empty');

    return tagRow;
  },

  createReadonlyPill(tag) {
    const pill = document.createElement('span');
    pill.className = 'tag-pill tag-pill-readonly';
    pill.style.background = tag.color;
    const pillText = document.createElement('span');
    pillText.className = 'tag-pill-text';
    pillText.textContent = tag.name;
    pill.appendChild(pillText);
    return pill;
  },

  createTagPill(tag, li) {
    const pill = document.createElement('span');
    pill.className = 'tag-pill';
    pill.style.background = tag.color;
    pill.title = `Filter by "${tag.name}"`;

    const pillText = document.createElement('span');
    pillText.className = 'tag-pill-text';
    pillText.textContent = tag.name;

    const pillRemove = document.createElement('button');
    pillRemove.className = 'tag-pill-remove';
    pillRemove.type = 'button';
    pillRemove.title = 'Remove tag';
    pillRemove.textContent = '×';

    pill.append(pillText, pillRemove);

    pill.addEventListener('click', (e) => {
      if (e.target?.closest('.tag-pill-remove')) return;
      e.preventDefault();
      e.stopPropagation();

      if (DOMCache.tagSearchInput) {
        DOMCache.tagSearchInput.value = tag.name;
      }
      AppState.setTagQuery(tag.name, 'exact');
      // Unfold it without taking the focus: the list is now filtered by this
      // tag, and the only place that says so is the field.
      SearchBar.open({ focus: false });
      displayVideos();
    });

    pillRemove.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      try {
        const videos = await StorageManager.getVideos();
        const video = videos.find((v) => v.url === li.dataset.url);

        if (!video) return;

        const nextTags = (video.tags || []).filter(
          (t) => t.name.toLowerCase() !== tag.name.toLowerCase()
        );

        await StorageManager.updateVideoByUrl(video.url, { tags: nextTags });
        displayVideos();
      } catch (error) {
        console.error('Error removing tag:', error);
      }
    });

    return pill;
  },

  /**
   * Add a tag (by name) to a video. Returns true on success or if it already
   * exists. Shared by the Enter key and the autocomplete suggestions.
   */
  async addTag(videoUrl, name) {
    const clean = (name || '').trim();
    if (!clean || !videoUrl) return false;

    try {
      const videos = await StorageManager.getVideos();
      const video = videos.find((v) => v.url === videoUrl);
      if (!video) return false;

      const existing = video.tags || [];
      if (existing.some((t) => t.name.toLowerCase() === clean.toLowerCase())) {
        return true; // already present — treat as success
      }

      const newTag = { name: clean, color: Utils.colorFromTagName(clean) };
      return await StorageManager.updateVideoByUrl(videoUrl, {
        tags: [...existing, newTag]
      });
    } catch (error) {
      console.error('Error adding tag:', error);
      return false;
    }
  },

  createTagInput(li, tagAddBtn, video) {
    const wrap = document.createElement('span');
    wrap.className = 'tag-input-wrap';
    wrap.style.display = 'none';

    const tagInput = document.createElement('input');
    tagInput.className = 'tag-input';
    tagInput.type = 'text';
    tagInput.placeholder = 'Tag…';
    tagInput.maxLength = CONFIG.TAG_MAX_LENGTH;

    const suggestions = document.createElement('div');
    suggestions.className = 'tag-suggestions';
    suggestions.hidden = true;

    wrap.append(tagInput, suggestions);

    let tagUniverse = [];
    const existingLower = () => new Set((video.tags || []).map((t) => t.name.toLowerCase()));

    const row = () => wrap.closest('.tag-row');

    const closeEditor = () => {
      wrap.style.display = 'none';
      // Back out of the layout if nothing was added, so the card does not keep
      // a blank strip where the editor was.
      const tagRow = row();
      if (tagRow && !tagRow.querySelector('.tag-pill')) tagRow.classList.add('is-empty');
      tagInput.value = '';
      suggestions.hidden = true;
      suggestions.textContent = '';
    };

    const openEditor = async () => {
      wrap.style.display = 'inline-flex';
      row()?.classList.remove('is-empty');
      tagInput.value = '';
      suggestions.hidden = true;
      suggestions.textContent = '';
      tagInput.focus();
      tagUniverse = await StorageManager.getAllTagNames();
    };

    const commit = async (name) => {
      const clean = (name || '').trim();
      if (!clean) { closeEditor(); return; }
      const ok = await VideoItemFactory.addTag(li.dataset.url, clean);
      if (ok) {
        displayVideos(); // rebuilds the list (editor closes with it)
      } else {
        closeEditor();
      }
    };

    const renderSuggestions = (query) => {
      const q = query.trim().toLowerCase();
      suggestions.textContent = '';
      if (!q) { suggestions.hidden = true; return; }

      const exclude = existingLower();
      const matches = tagUniverse
        .filter((n) => n.toLowerCase().includes(q) && !exclude.has(n.toLowerCase()))
        .slice(0, 6);

      if (matches.length === 0) { suggestions.hidden = true; return; }

      matches.forEach((name) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'tag-suggestion';

        const dot = document.createElement('span');
        dot.className = 'tag-suggestion-dot';
        dot.style.background = Utils.colorFromTagName(name);

        const label = document.createElement('span');
        label.className = 'tag-suggestion-label';
        label.textContent = name;

        item.append(dot, label);
        // mousedown (not click): fires before the input's blur tears the list down
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          commit(name);
        });
        suggestions.appendChild(item);
      });

      suggestions.hidden = false;
    };

    if (tagAddBtn) {
      tagAddBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (wrap.style.display === 'none') {
          openEditor();
        } else {
          closeEditor();
        }
      });
    }

    wrap.addEventListener('click', (e) => e.stopPropagation());

    tagInput.addEventListener('input', () => renderSuggestions(tagInput.value));

    tagInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeEditor();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        commit(tagInput.value);
      }
    });

    // Clicking away (with nothing selected) closes the editor — fix for the
    // input staying open when left empty. The timeout lets a suggestion's
    // mousedown run first.
    tagInput.addEventListener('blur', () => {
      setTimeout(() => {
        if (document.activeElement !== tagInput) closeEditor();
      }, 120);
    });

    return wrap;
  },

  attachDragListeners(li) {
    li.addEventListener('dragstart', () => {
      if (AppState.tagQuery) return;
      AppState.draggedItemIndex = parseInt(li.dataset.index, 10);
      DragScroller.start();
      setTimeout(() => li.classList.add('dragging'), 0);
    });

    li.addEventListener('dragend', () => {
      DragScroller.stop();
      li.classList.remove('dragging');
      document.querySelectorAll('.video-item').forEach(el => el.classList.remove('drop-target'));
    });

    li.addEventListener('dragover', (e) => {
      if (AppState.tagQuery) return;
      e.preventDefault();
      const targetIndex = parseInt(li.dataset.index, 10);
      if (AppState.draggedItemIndex !== null && AppState.draggedItemIndex !== targetIndex) {
        li.classList.add('drop-target');
      }
    });

    li.addEventListener('dragleave', () => {
      li.classList.remove('drop-target');
    });

    li.addEventListener('drop', async (e) => {
      if (AppState.tagQuery) return;
      e.preventDefault();
      li.classList.remove('drop-target');

      const targetIndex = parseInt(li.dataset.index, 10);
      if (AppState.draggedItemIndex === null || AppState.draggedItemIndex === targetIndex) return;

      try {
        await StorageManager.reorder(AppState.draggedItemIndex, targetIndex);
        displayVideos();
      } catch (error) {
        console.error('Error reordering videos:', error);
      }
    });
  }
};

// ============================================
// THE RENDER WINDOW
// ============================================
/**
 * The list is thrown away and rebuilt on every change — a heart, a filter, a
 * keystroke, a delete. With 1200 saved videos that was 31,920 nodes and half a
 * second each time, and two seconds of empty popup before the first row
 * appeared: a 135,000px column built to be looked at through 404px of window.
 *
 * So a pass builds one chunk and the rest arrive as you scroll, fetched a
 * screen or two ahead of the fold. The cost of a rebuild becomes the cost of
 * what is actually on screen.
 *
 * The window never shrinks while you are looking at the same list. That is not
 * a nicety: the browser keeps your scroll position across a rebuild only
 * because the content is still as tall, so dropping back to the first chunk
 * after every heart toggle would throw you to the top of the list. It resets
 * only when the list itself changes — another view, another filter, another
 * search.
 */
const ListWindow = {
  limit: CONFIG.RENDER_CHUNK,
  key: null,
  observer: null,
  sentinel: null,
  // What the last pass drew, so growing appends rather than rebuilds.
  videos: [],
  indexByUrl: null,
  mode: 'active',

  /** The identity of the list on screen — not its contents. */
  sync(key) {
    if (key === this.key) return;

    // A different list is a different place. Filtering while scrolled down
    // otherwise drops you into the middle of a list whose top you have never
    // seen — and worse here, the window would then fill itself back up chunk
    // by chunk until it was tall enough to reach that old offset, which is
    // the whole saving handed back.
    if (this.key !== null && DOMCache.scrollContainer) DOMCache.scrollContainer.scrollTop = 0;

    this.key = key;
    this.limit = CONFIG.RENDER_CHUNK;
  },

  render(videos, { mode, indexByUrl = null } = {}) {
    this.videos = videos;
    this.mode = mode;
    this.indexByUrl = indexByUrl;

    const frag = document.createDocumentFragment();
    videos.slice(0, this.limit).forEach((v) => frag.appendChild(this.build(v)));
    DOMCache.videoList.appendChild(frag);
    this.markEnd();
  },

  build(video) {
    return VideoItemFactory.create(video, this.indexByUrl?.get(video.url) ?? -1, this.mode);
  },

  /** The next chunk, appended. The rows already there are left alone. */
  grow() {
    if (this.limit >= this.videos.length) return;

    const next = this.videos.slice(this.limit, this.limit + CONFIG.RENDER_CHUNK);
    this.limit += CONFIG.RENDER_CHUNK;

    const frag = document.createDocumentFragment();
    next.forEach((v) => frag.appendChild(this.build(v)));
    DOMCache.videoList.insertBefore(frag, this.sentinel);
    this.markEnd();
  },

  /**
   * Puts the tripwire back at the end of the list, or takes it away once
   * everything is drawn.
   */
  markEnd() {
    if (this.limit >= this.videos.length) {
      this.detach();
      return;
    }

    if (!this.sentinel) {
      this.sentinel = document.createElement('li');
      this.sentinel.className = 'list-sentinel';
      this.sentinel.setAttribute('aria-hidden', 'true');
    }
    DOMCache.videoList.appendChild(this.sentinel);

    if (!this.observer) {
      this.observer = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) this.grow();
      }, { root: DOMCache.scrollContainer || null, rootMargin: `${CONFIG.RENDER_AHEAD} 0px` });
    }
    this.observer.observe(this.sentinel);
  },

  /** Before anything empties the list out from under it. */
  detach() {
    this.observer?.disconnect();
    this.sentinel?.remove();
  }
};

// ============================================
// DISPLAY LOGIC
// ============================================
async function displayVideos() {
  try {
    if (!DOMCache.videoList || !DOMCache.tutorial) {
      console.error('Required DOM elements not found');
      return;
    }

    const [savedVideos, deletedVideos] = await Promise.all([
      StorageManager.getVideos(),
      StorageManager.getDeleted()
    ]);

    const activeVideos = savedVideos.filter((v) => !v.watched);
    const archivedVideos = savedVideos.filter((v) => v.watched);

    updateTabCounts(activeVideos.length, archivedVideos.length, deletedVideos.length);

    // Tag search only applies to active/archive; the "Empty trash" bar only
    // shows in the trash view (so there is no single control wiping everything).
    if (DOMCache.searchWrap) DOMCache.searchWrap.style.display = AppState.view === 'trash' ? 'none' : '';
    if (DOMCache.trashActions) {
      DOMCache.trashActions.classList.toggle('visible', AppState.view === 'trash' && deletedVideos.length > 0);
    }

    ListWindow.detach();
    DOMCache.videoList.textContent = '';

    // ---- TRASH VIEW ----
    if (AppState.view === 'trash') {
      if (deletedVideos.length === 0) {
        showTutorial('Trash is empty', 'Deleted videos appear here so you can restore them. Items are removed automatically once the trash is full.');
        return;
      }
      DOMCache.tutorial.style.display = 'none';
      ListWindow.sync('trash');
      ListWindow.render(deletedVideos, { mode: 'trash' });
      return;
    }

    // ---- ACTIVE / ARCHIVE VIEWS ----
    const source = AppState.view === 'archive' ? archivedVideos : activeVideos;

    if (source.length === 0) {
      updateTypeCounts([]);
      if (AppState.view === 'archive') {
        showTutorial('No watched videos yet', 'Mark a video as watched (✓) to move it here.');
      } else {
        showTutorial('How to use', 'Hold the <b>Alt</b> key and <b>Click</b> on any YouTube video to save it instantly.', true);
      }
      return;
    }

    const taggedVideos = AppState.tagQuery
      ? source.filter((v) =>
          (v.tags || []).some((t) => {
            const n = t.name.toLowerCase();
            return AppState.tagQueryMode === 'exact' ? n === AppState.tagQuery : n.includes(AppState.tagQuery);
          })
        )
      : source;

    // Counts are taken after the tag search, so each chip predicts exactly
    // what selecting it would show.
    updateTypeCounts(taggedVideos);

    if (taggedVideos.length === 0) {
      showTutorial('No results', 'No videos match this tag search.');
      return;
    }

    // 'video' means "not a Short", so records with no type yet are counted
    // and filtered the same way they are labelled.
    const byType = AppState.typeFilter === 'all'
      ? taggedVideos
      : taggedVideos.filter((v) =>
          AppState.typeFilter === 'short' ? Utils.isShort(v) : !Utils.isShort(v));

    // Favourites is not a fourth type — a Short can be one too — so it narrows
    // whatever the chips are already showing rather than replacing it.
    const filteredVideos = AppState.favouritesOnly
      ? byType.filter((v) => v.favourite === true)
      : byType;

    if (filteredVideos.length === 0) {
      const label = AppState.typeFilter === 'short' ? 'Shorts' : 'Videos';
      const what = AppState.favouritesOnly
        ? (AppState.typeFilter === 'all' ? 'favourites' : `favourite ${label.toLowerCase()}`)
        : (AppState.typeFilter === 'short' ? 'Shorts' : 'videos');
      showTutorial(
        `No ${what} here`,
        AppState.favouritesOnly
          ? 'Nothing in this list is a favourite yet.'
          : `Nothing in this list matches the <b>${label}</b> filter.`
      );

      // A node, not markup: nothing YouTube supplies should ever reach
      // showTutorial's innerHTML through a template string.
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'tutorial-reset';
      reset.id = 'reset-type-filter';
      reset.textContent = 'Show everything';
      reset.addEventListener('click', () => {
        AudioManager.play(AppState.soundEnabled);
        AppState.setTypeFilter('all');
        AppState.setFavouritesOnly(false);
        updateTypeFilterUI();
        updateFavouriteFilterUI();
        displayVideos();
      });
      document.getElementById('tutorial-text')?.appendChild(reset);
      return;
    }

    DOMCache.tutorial.style.display = 'none';

    // Index into the FULL saved array, so drag reorder stays correct. Built
    // once: looking each row up by scanning was quadratic in the list length.
    const indexByUrl = new Map(savedVideos.map((v, i) => [v.url, i]));

    // Everything that decides which videos these are, so that changing any of
    // them starts the window at the top again and changing none of them — a
    // heart, a delete — leaves your place alone.
    ListWindow.sync(`${AppState.view}|${AppState.typeFilter}|${AppState.favouritesOnly}|${AppState.tagQuery}`);
    ListWindow.render(filteredVideos, { mode: AppState.view, indexByUrl });
  } catch (error) {
    console.error('Error displaying videos:', error);
    showTutorial('Error', 'Failed to load videos. Please try refreshing.');
  }
}

function showTutorial(title, message, showHint = false) {
  if (!DOMCache.tutorial) return;

  DOMCache.tutorial.style.display = 'block';

  const titleEl = document.getElementById('tutorial-title');
  const textEl = document.getElementById('tutorial-text');
  const visualEl = document.getElementById('tutorial-visual');

  if (titleEl) titleEl.textContent = title;
  if (textEl) {
    textEl.innerHTML = message;
  }
  // The keyboard/mouse "ALT + LEFT CLICK" hint only makes sense on the
  // "How to use" empty state — hide it for Archive / Trash / no-results.
  if (visualEl) visualEl.style.display = showHint ? '' : 'none';
}

// ============================================
// TYPE FILTER (All / Videos / Shorts)
// A single-choice group, so radios rather than toggle buttons: arrow keys
// move between the chips and only the selected one is a tab stop.
// ============================================
function updateTypeCounts(videos) {
  const shorts = videos.filter((v) => Utils.isShort(v)).length;
  const counts = { all: videos.length, video: videos.length - shorts, short: shorts };

  Object.entries(counts).forEach(([type, n]) => {
    const el = document.querySelector(`.type-chip-count[data-count-for-type="${type}"]`);
    if (el) el.textContent = String(n);
  });

  // Counted after the chips, so the heart says what pressing it would leave.
  const inType = AppState.typeFilter === 'all'
    ? videos
    : videos.filter((v) => (AppState.typeFilter === 'short' ? Utils.isShort(v) : !Utils.isShort(v)));
  const favCount = document.querySelector('.fav-filter-count');
  if (favCount) favCount.textContent = String(inType.filter((v) => v.favourite === true).length);
}

function updateFavouriteFilterUI() {
  const btn = DOMCache.favouritesFilter;
  if (!btn) return;

  const on = AppState.favouritesOnly;
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.classList.toggle('is-on', on);
  btn.title = on ? 'Showing only favourites' : 'Show only favourites';
  const icon = btn.querySelector('img.btn-icon');
  if (icon) icon.src = on ? 'icons/buttons/heart-filled.svg' : 'icons/buttons/heart.svg';
}

function setupFavouriteFilter() {
  const btn = DOMCache.favouritesFilter;
  if (!btn) return;

  btn.addEventListener('click', () => {
    AudioManager.play(AppState.soundEnabled);
    AppState.setFavouritesOnly(!AppState.favouritesOnly);
    updateFavouriteFilterUI();
    displayVideos();
  });
}

function updateTypeFilterUI() {
  if (!DOMCache.typeFilter) return;

  DOMCache.typeFilter.querySelectorAll('.type-chip').forEach((chip) => {
    const selected = chip.dataset.type === AppState.typeFilter;
    chip.setAttribute('aria-checked', selected ? 'true' : 'false');
    chip.tabIndex = selected ? 0 : -1;
  });
}

function setupTypeFilter() {
  const group = DOMCache.typeFilter;
  if (!group) return;

  const chips = Array.from(group.querySelectorAll('.type-chip'));

  const select = (chip, { focus = false } = {}) => {
    if (!chip || chip.dataset.type === AppState.typeFilter) return;
    AudioManager.play(AppState.soundEnabled);
    AppState.setTypeFilter(chip.dataset.type);
    updateTypeFilterUI();
    if (focus) chip.focus();
    displayVideos();
  };

  group.addEventListener('click', (e) => {
    const chip = e.target.closest('.type-chip');
    if (chip) select(chip);
  });

  group.addEventListener('keydown', (e) => {
    // Home / End jump to the ends of the group, as a radiogroup should.
    const edge = { Home: 0, End: chips.length - 1 }[e.key];
    if (edge !== undefined) {
      e.preventDefault();
      select(chips[edge], { focus: true });
      return;
    }

    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;

    e.preventDefault();
    const current = chips.findIndex((c) => c.dataset.type === AppState.typeFilter);
    const next = chips[(current + step + chips.length) % chips.length];
    select(next, { focus: true });
  });
}

function updateTabCounts(active, archive, trash) {
  const set = (view, n) => {
    const el = document.querySelector(`.view-tab-count[data-count-for="${view}"]`);
    if (el) el.textContent = n > 0 ? String(n) : '';
  };
  set('active', active);
  set('archive', archive);
  set('trash', trash);
}

// ============================================
// TOAST (undo notifications)
// ============================================
let toastTimeout = null;

function showToast(message, actionLabel, actionFn) {
  const el = DOMCache.toast;
  if (!el) return;

  el.textContent = '';

  const msg = document.createElement('span');
  msg.className = 'wle-toast-msg';
  msg.textContent = message;
  el.appendChild(msg);

  if (actionLabel && typeof actionFn === 'function') {
    const btn = document.createElement('button');
    btn.className = 'wle-toast-action';
    btn.type = 'button';
    btn.textContent = actionLabel;
    btn.addEventListener('click', async () => {
      hideToast();
      await actionFn();
    });
    el.appendChild(btn);
  }

  el.classList.add('visible');
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(hideToast, CONFIG.UNDO_DURATION);
}

function hideToast() {
  const el = DOMCache.toast;
  if (!el) return;
  el.classList.remove('visible');
  if (toastTimeout) {
    clearTimeout(toastTimeout);
    toastTimeout = null;
  }
}

// ============================================
// EVENT HANDLERS (Event Delegation)
// ============================================
function setupVideoListHandlers() {
  if (!DOMCache.videoList) return;

  DOMCache.videoList.addEventListener('click', async (e) => {
    const li = e.target.closest('.video-item');
    if (!li) return;
    const url = li.dataset.url;

    // Play the video in its own small window
    if (e.target.closest('.mini-player-btn')) {
      e.stopPropagation();
      if (!WLEUrl.isSafeOpenUrl(url)) return;
      AudioManager.play(AppState.soundEnabled);
      openMiniPlayerWindow(url);
      return;
    }

    // Favourite / not
    if (e.target.closest('.favourite-btn')) {
      e.stopPropagation();
      if (!url) return;
      AudioManager.play(AppState.soundEnabled);
      const result = await StorageManager.toggleFavourite(url);
      displayVideos();
      if (!result || !result.ok) showToast('Could not update favourites');
      return;
    }

    // Mark watched / move back to To Watch
    if (e.target.closest('.watch-toggle-btn')) {
      e.stopPropagation();
      if (!url) return;
      AudioManager.play(AppState.soundEnabled);
      const result = await StorageManager.toggleWatched(url);
      displayVideos();
      if (!result || !result.ok) return;
      showToast(
        result.watched ? 'Moved to Archive' : 'Moved to To Watch',
        'Undo',
        async () => { await StorageManager.toggleWatched(url); displayVideos(); }
      );
      return;
    }

    // Restore from trash
    if (e.target.closest('.restore-btn')) {
      e.stopPropagation();
      if (!url) return;
      AudioManager.play(AppState.soundEnabled);
      await StorageManager.restore([url]);
      displayVideos();
      return;
    }

    // Permanently delete from trash
    if (e.target.closest('.perma-delete-btn')) {
      e.stopPropagation();
      if (!url) return;
      AudioManager.play(AppState.soundEnabled);
      if (!confirm('Permanently delete this video?')) return;
      await StorageManager.permanentDelete([url]);
      displayVideos();
      return;
    }

    // Soft delete (active/archive) → trash, with undo
    if (e.target.closest('.delete-btn')) {
      e.stopPropagation();
      if (!url) return;
      AudioManager.play(AppState.soundEnabled);
      const moved = await StorageManager.softDelete([url]);
      displayVideos();
      if (moved.length) {
        showToast('Video moved to trash', 'Undo', async () => {
          await StorageManager.restore(moved);
          displayVideos();
        });
      }
      return;
    }

    if (e.target.closest('.tag-add-btn')) return;
    if (e.target.closest('.tag-row')) return;
    if (e.target.closest('.video-actions')) return;
    if (e.target.closest('.drag-handle')) return;

    if (e.target.closest('.video-left')) {
      if (WLEUrl.isSafeOpenUrl(url)) {
        AudioManager.play(AppState.soundEnabled);
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    }
  });
}

// ============================================
// VIEW TABS
// ============================================
function setupViewTabs() {
  if (!DOMCache.viewTabs) return;

  DOMCache.viewTabs.addEventListener('click', (e) => {
    const tab = e.target.closest('.view-tab');
    if (!tab) return;

    const view = tab.dataset.view;
    if (!view || view === AppState.view) return;

    AppState.setView(view);

    DOMCache.viewTabs.querySelectorAll('.view-tab').forEach((t) => {
      t.classList.toggle('active', t === tab);
      t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
    });

    AudioManager.play(AppState.soundEnabled);
    displayVideos();
  });
}

// ============================================
// DRAG AUTO-SCROLL WIRING
// ============================================
function setupDragAutoScroll() {
  if (!DOMCache.scrollContainer) return;
  DOMCache.scrollContainer.addEventListener('dragover', (e) => {
    if (DragScroller.active) DragScroller.update(e.clientY);
  });
}

// ============================================
// SOUND MANAGEMENT
// ============================================
function updateSoundIcon() {
  if (!DOMCache.soundBtn) return;

  DOMCache.soundBtn.classList.toggle('muted', !AppState.soundEnabled);
  const icon = DOMCache.soundBtn.querySelector('img.btn-icon');

  if (icon) {
    icon.src = AppState.soundEnabled
      ? 'icons/buttons/volume.svg'
      : 'icons/buttons/volume-mute.svg';
  }
}

function setupSoundToggle() {
  if (!DOMCache.soundBtn) return;

  DOMCache.soundBtn.addEventListener('click', () => {
    AppState.setSoundEnabled(!AppState.soundEnabled);
    updateSoundIcon();
    updateMixerUI();
    if (AppState.soundEnabled) {
      AudioManager.play(true);
    }
  });
}

// ============================================
// SOUND MIXER
// Slider and number box are the same value in two shapes; each writes the
// other. The master switch dims the lot without forgetting the levels.
// ============================================
/**
 * @param {boolean} [settle] true once a value is final: the number box is then
 *   rewritten even while focused, so a clamped value cannot stay on screen.
 */
function updateMixerUI({ settle = false } = {}) {
  document.querySelectorAll('.mixer-row').forEach((row) => {
    const name = row.dataset.sound;
    const entry = AudioMix.get(name);
    const percent = Math.round(entry.volume * 100);

    const toggle = row.querySelector('[data-sound-toggle]');
    const slider = row.querySelector('[data-sound-slider]');
    const number = row.querySelector('[data-sound-number]');

    if (toggle) toggle.setAttribute('aria-checked', entry.enabled ? 'true' : 'false');
    if (slider && document.activeElement !== slider) slider.value = String(percent);
    // Left alone mid-typing so the cursor does not jump, but corrected the
    // moment the value settles — change fires while the box still holds focus,
    // so the focus guard alone would let a clamped value stay on screen.
    if (number && (settle || document.activeElement !== number)) {
      number.value = String(percent);
    }

    // Off on its own switch, or off because everything is.
    row.classList.toggle('is-off', !entry.enabled || !AppState.soundEnabled);
  });

  updateGroupNotes();
}

function setupMixer() {
  const mixer = document.getElementById('mixer');
  if (!mixer) return;

  // Previewing every pixel of a drag would stutter; on release is enough.
  // Both sounds are previewed here — setting a level you cannot hear is
  // guesswork, and the save sound ships with the extension like the click one.
  const preview = (name, volume) => {
    if (!AppState.soundEnabled || !AudioMix.get(name).enabled || volume <= 0) return;
    AudioManager.preview(name, volume);
  };

  const setVolume = (name, percent, { play = false, settle = false } = {}) => {
    const clamped = Math.min(100, Math.max(0, Math.round(Number(percent) || 0)));
    AudioMix.set(name, { volume: clamped / 100 });
    updateMixerUI({ settle });
    if (play) preview(name, clamped / 100);
  };

  mixer.addEventListener('input', (e) => {
    const slider = e.target.closest('[data-sound-slider]');
    if (slider) { setVolume(slider.dataset.soundSlider, slider.value); return; }

    const number = e.target.closest('[data-sound-number]');
    // Mid-typing the box can be empty or out of range; only mirror a usable
    // number, and let change() settle whatever is left behind.
    if (number && number.value !== '') setVolume(number.dataset.soundNumber, number.value);
  });

  // change is where a value settles, so this is where the box is corrected:
  // typing 500 clamps to 100, and leaving 500 on screen beside a level of 100
  // is worse than the cursor jumping.
  mixer.addEventListener('change', (e) => {
    const slider = e.target.closest('[data-sound-slider]');
    if (slider) {
      setVolume(slider.dataset.soundSlider, slider.value, { play: true, settle: true });
      return;
    }

    const number = e.target.closest('[data-sound-number]');
    if (number) setVolume(number.dataset.soundNumber, number.value, { play: true, settle: true });
  });

  mixer.addEventListener('click', (e) => {
    const toggle = e.target.closest('[data-sound-toggle]');
    if (!toggle) return;

    const name = toggle.dataset.soundToggle;
    const now = !AudioMix.get(name).enabled;
    AudioMix.set(name, { enabled: now });
    updateMixerUI();
    if (now) preview(name, AudioMix.get(name).volume);
  });
}

/**
 * What is switched off in there, so shutting the section hides controls
 * rather than information. Everything at its default says nothing at all —
 * a header reading "on, on, shown" is noise.
 */
function updateGroupNotes() {
  const el = document.getElementById('prefs-group-summary');
  if (!el) return;

  const changed = [];

  if (!AppState.soundEnabled) {
    changed.push('muted');
  } else {
    const off = Object.keys(CONFIG.AUDIO_DEFAULTS).filter((n) => !AudioMix.get(n).enabled);
    if (off.length) changed.push(`${off.join(' & ')} muted`);
  }

  if (!AppState.detachEnabled) changed.push('mini player off');
  if (AppState.supporter && AppState.hideJobsMatchBanner) changed.push('banner hidden');

  el.textContent = changed.join(' · ');
}

// ============================================
// USER GUIDE
// The guide ships with the extension (wiki.html), so it opens instantly and
// works offline.
// ============================================
function openWiki() {
  AudioManager.play(AppState.soundEnabled);
  window.open(chrome.runtime.getURL('wiki.html'), '_blank', 'noopener');
}

function setupWikiButton() {
  if (DOMCache.wikiRow) {
    DOMCache.wikiRow.addEventListener('click', () => openWiki());
  }

  if (DOMCache.wikiBtn) {
    DOMCache.wikiBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openWiki();
    });
  }
}

// ============================================
// DETACHED MINI PLAYER
// The always-on-top window (Document Picture-in-Picture) can only be opened
// right after a click inside the page itself — no extension API grants that.
// So the popup opens the video in a small browser window of its own instead:
// no tab, no confirmation, and it survives minimizing the main window. From
// there the player's pop-out button promotes it to always-on-top.
// ============================================
/**
 * The window is opened by the service worker, which is also what a YouTube
 * thumbnail's button talks to — one implementation of the size, the marker and
 * the fallback, rather than the same thing written twice.
 */
function openMiniPlayerWindow(url) {
  const videoId = WLEUrl.extractVideoId(url);
  if (!videoId) return;

  chrome.runtime.sendMessage({ type: CONFIG.MINI_WINDOW.OPEN, videoId }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      // No worker (an older browser, or one that has just been torn down):
      // a plain window still plays the video.
      console.warn('Could not open the mini player window:',
        chrome.runtime.lastError?.message || response?.reason);
      window.open(
        `https://www.youtube.com/watch?v=${videoId}#${CONFIG.MINI_WINDOW.MARKER}`,
        '_blank',
        'noopener,noreferrer'
      );
    }
  });
}

function updateMiniPlayerSwitch() {
  const sw = DOMCache.miniPlayerSwitch;
  if (sw) sw.setAttribute('aria-checked', AppState.detachEnabled ? 'true' : 'false');
  updateGroupNotes();
}

function toggleMiniPlayer() {
  AudioManager.play(AppState.soundEnabled);
  AppState.detachEnabled = !AppState.detachEnabled;
  chrome.storage.local.set({ [CONFIG.STORAGE_KEYS.DETACH]: AppState.detachEnabled });
  updateMiniPlayerSwitch();
  displayVideos();
}

function setupMiniPlayerToggle() {
  const sw = DOMCache.miniPlayerSwitch;
  const row = DOMCache.miniPlayerRow;

  if (row) {
    row.addEventListener('click', () => toggleMiniPlayer());
  }

  if (sw) {
    sw.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMiniPlayer();
    });
  }
}

// ============================================
// SEARCH HANDLING
// ============================================

/**
 * The search field folds away when it is not in use, which is most of the
 * time: an empty 35px box was the single tallest thing between the popup's
 * edge and the first video.
 *
 * The one rule that governs the whole thing: it is never folded while it is
 * filtering. A query you cannot see is a list that looks broken, so anything
 * that would close it on a non-empty field clears the field first.
 */
const SearchBar = {
  open({ focus = true } = {}) {
    const wrap = DOMCache.searchWrap;
    if (!wrap) return;
    wrap.classList.add('search-open');
    DOMCache.searchToggle?.setAttribute('aria-expanded', 'true');
    if (focus) DOMCache.tagSearchInput?.focus();
  },

  /** Folds it away, taking any query with it. */
  close({ focusToggle = false } = {}) {
    const wrap = DOMCache.searchWrap;
    if (!wrap) return;

    // Only a query that reached the list costs a re-render. Typing and pressing
    // Esc inside the debounce window leaves text in the box that never filtered
    // anything, and rebuilding the list for that is 500ms of nothing on a long
    // one.
    const wasFiltering = Boolean(AppState.tagQuery);
    if (wasFiltering || DOMCache.tagSearchInput?.value) {
      if (DOMCache.tagSearchInput) DOMCache.tagSearchInput.value = '';
      AppState.setTagQuery('', 'contains');
      if (wasFiltering) displayVideos();
    }

    wrap.classList.remove('search-open');
    DOMCache.searchToggle?.setAttribute('aria-expanded', 'false');

    if (focusToggle) DOMCache.searchToggle?.focus();
    // Nothing keeps the focus inside a folded field: it is about to become
    // visibility: hidden, and a caret in an invisible box is a dead keyboard.
    else if (document.activeElement === DOMCache.tagSearchInput) DOMCache.tagSearchInput.blur();
  },

  get isOpen() {
    return DOMCache.searchWrap?.classList.contains('search-open') === true;
  }
};

function setupSearch() {
  if (!DOMCache.tagSearchInput) return;

  const debouncedSearch = Utils.debounce((value) => {
    // A keystroke can land after Esc has already folded the field away. Left
    // to run, it would put the query back with nothing on screen saying so —
    // the one state this must never reach.
    if (!SearchBar.isOpen) return;
    AppState.setTagQuery(value, 'contains');
    displayVideos();
  }, CONFIG.DEBOUNCE_DELAY);

  DOMCache.tagSearchInput.addEventListener('input', (e) => {
    debouncedSearch(e.target.value || '');
  });

  // Esc gives the field back rather than closing the popup, which is what a
  // stray Esc in a Chrome popup otherwise does.
  DOMCache.tagSearchInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    SearchBar.close({ focusToggle: true });
  });

  // Clicking away from an empty field folds it back. A field with something in
  // it stays: it is filtering the list, and the list has to say so.
  DOMCache.tagSearchInput.addEventListener('blur', (e) => {
    if (DOMCache.tagSearchInput.value.trim()) return;
    if (e.relatedTarget === DOMCache.searchToggle) return; // the toggle closes it itself
    SearchBar.close();
  });

  // Pressing the button must not move the focus out of the field first: that
  // blur would fold an empty field away, and the click landing afterwards
  // would read it as closed and open it straight back up. Browsers disagree
  // about whether a click focuses a button at all, so this does not depend on
  // it either way.
  DOMCache.searchToggle?.addEventListener('mousedown', (e) => e.preventDefault());

  DOMCache.searchToggle?.addEventListener('click', () => {
    AudioManager.play(AppState.soundEnabled);
    if (SearchBar.isOpen) SearchBar.close();
    else SearchBar.open();
  });

  // '/' is what YouTube itself uses. Only when nothing else is taking typing,
  // and never over the settings dialog.
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (DOMCache.settingsModal && !DOMCache.settingsModal.classList.contains('hidden')) return;
    // The trash view hides the whole strip. Opening a field nobody can see
    // would leave the button claiming aria-expanded="true" over nothing, and
    // the field waiting open and empty on the way back.
    if (!DOMCache.searchWrap || DOMCache.searchWrap.offsetParent === null) return;
    const el = e.target;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el?.isContentEditable) return;
    e.preventDefault();
    SearchBar.open();
  });
}

// ============================================
// MODAL HANDLING
// ============================================
function setupModal() {
  const openBtn = document.getElementById('open-settings');
  const closeBtn = document.getElementById('close-settings');
  const modal = DOMCache.settingsModal;

  if (!modal) return;

  const closeModal = () => {
    AudioManager.play(AppState.soundEnabled);
    modal.classList.add('hidden');
  };

  if (openBtn) {
    openBtn.addEventListener('click', () => {
      AudioManager.play(AppState.soundEnabled);
      modal.classList.remove('hidden');
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', closeModal);
  }

  // The close button used to be the only way out of the modal. Clicking the
  // backdrop and pressing Escape are what people try first anyway.
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      closeModal();
    }
  });
}

// ============================================
// EMPTY TRASH (trash view only)
// ============================================
function setupTrashActions() {
  if (!DOMCache.emptyTrashBtn) return;

  DOMCache.emptyTrashBtn.addEventListener('click', async () => {
    AudioManager.play(AppState.soundEnabled);
    if (confirm('Permanently empty the trash?')) {
      await StorageManager.emptyTrash();
      displayVideos();
    }
  });
}

// ============================================
// DONATE CALLOUT
// ============================================
function markSupporter() {
  // Set after the thank-you digest matches. Ko-fi clicks do not unlock.
  AppState.supporter = true;
  AppState.hideJobsMatchBanner = true;
  chrome.storage.local.set({
    [CONFIG.STORAGE_KEYS.SUPPORTER]: true,
    [CONFIG.STORAGE_KEYS.HIDE_JM_BANNER]: true
  });
  applyJobsMatchBanner();
}

function positionDonateCallout() {
  const btn = DOMCache.donateBtn;
  const cal = DOMCache.donateCallout;
  if (!btn || !cal) return;

  const r = btn.getBoundingClientRect();
  const calWidth = 230;
  let left = r.left + r.width / 2 - calWidth / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - calWidth - 8));
  cal.style.width = `${calWidth}px`;
  cal.style.left = `${left}px`;
  cal.style.top = `${r.bottom + 10}px`;

  const arrow = cal.querySelector('.donate-callout-arrow');
  if (arrow) {
    const arrowLeft = r.left + r.width / 2 - left - 7;
    arrow.style.left = `${Math.max(12, Math.min(arrowLeft, calWidth - 26))}px`;
  }
}

function showDonateCallout() {
  const cal = DOMCache.donateCallout;
  if (!cal) return;

  positionDonateCallout();
  requestAnimationFrame(() => {
    cal.classList.add('visible');
    if (DOMCache.donateBtn) DOMCache.donateBtn.classList.add('wle-donate-pulse');
  });
  chrome.storage.local.set({ [CONFIG.STORAGE_KEYS.LAST_PROMPT]: Date.now() });
}

function hideDonateCallout() {
  const cal = DOMCache.donateCallout;
  if (!cal) return;
  cal.classList.remove('visible');
  if (DOMCache.donateBtn) DOMCache.donateBtn.classList.remove('wle-donate-pulse');
}

function maybeShowDonateCallout() {
  if (!DOMCache.donateCallout) return;

  chrome.storage.local.get(
    { [CONFIG.STORAGE_KEYS.SUPPORTER]: false, [CONFIG.STORAGE_KEYS.LAST_PROMPT]: 0 },
    (data) => {
      if (data[CONFIG.STORAGE_KEYS.SUPPORTER]) return;
      const last = data[CONFIG.STORAGE_KEYS.LAST_PROMPT] || 0;
      if (Date.now() - last < CONFIG.DONATE_PROMPT_COOLDOWN) return;
      if (Math.random() > CONFIG.DONATE_PROMPT_CHANCE) return;
      showDonateCallout();
    }
  );
}

function setupDonateCallout() {
  const closeBtn = document.getElementById('donate-callout-close');
  const cta = document.getElementById('donate-callout-cta');

  if (closeBtn) closeBtn.addEventListener('click', hideDonateCallout);
  if (cta) cta.addEventListener('click', hideDonateCallout);

  window.addEventListener('resize', () => {
    if (DOMCache.donateCallout && DOMCache.donateCallout.classList.contains('visible')) {
      positionDonateCallout();
    }
  });
}

// ============================================
// JOBSMATCH BANNER
// ============================================
function applyJobsMatchBanner() {
  const banner = DOMCache.jmBanner;
  if (banner) {
    const show = !(AppState.supporter && AppState.hideJobsMatchBanner);
    banner.classList.toggle('hidden', !show);
  }
  updateHideBannerSwitch();
  updateGroupNotes();
}

function updateHideBannerSwitch() {
  const sw = DOMCache.hideBannerSwitch;
  const hint = DOMCache.hideBannerHint;
  const row = DOMCache.hideBannerRow;
  if (!sw) return;

  const unlocked = !!AppState.supporter;
  sw.disabled = !unlocked;
  sw.setAttribute('aria-checked', (unlocked && AppState.hideJobsMatchBanner) ? 'true' : 'false');
  sw.setAttribute('aria-disabled', unlocked ? 'false' : 'true');
  if (row) row.classList.toggle('locked', !unlocked);
  if (hint) hint.classList.toggle('hidden', unlocked);
  if (DOMCache.supporterUnlock) {
    DOMCache.supporterUnlock.classList.toggle('hidden', unlocked);
  }
}

function promptUnlockBannerHide() {
  AudioManager.play(AppState.soundEnabled);
  showDonateCallout();
}

function toggleHideJobsMatchBanner() {
  if (!AppState.supporter) {
    promptUnlockBannerHide();
    return;
  }
  AudioManager.play(AppState.soundEnabled);
  AppState.hideJobsMatchBanner = !AppState.hideJobsMatchBanner;
  chrome.storage.local.set({
    [CONFIG.STORAGE_KEYS.HIDE_JM_BANNER]: AppState.hideJobsMatchBanner
  });
  applyJobsMatchBanner();
}

function setupJobsMatchBanner() {
  const sw = DOMCache.hideBannerSwitch;
  const row = DOMCache.hideBannerRow;

  if (row) {
    row.addEventListener('click', () => {
      if (AppState.supporter) {
        toggleHideJobsMatchBanner();
        return;
      }
      promptUnlockBannerHide();
    });
  }

  if (sw) {
    sw.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleHideJobsMatchBanner();
    });
  }

  chrome.storage.local.get(
    [CONFIG.STORAGE_KEYS.SUPPORTER, CONFIG.STORAGE_KEYS.HIDE_JM_BANNER],
    (data) => {
      const supporter = !!data[CONFIG.STORAGE_KEYS.SUPPORTER];
      const hasHideKey = Object.prototype.hasOwnProperty.call(
        data,
        CONFIG.STORAGE_KEYS.HIDE_JM_BANNER
      );
      let hide = hasHideKey ? !!data[CONFIG.STORAGE_KEYS.HIDE_JM_BANNER] : false;

      // Existing supporters keep the perk; default hide if the new key is unset.
      if (supporter && !hasHideKey) {
        hide = true;
        chrome.storage.local.set({ [CONFIG.STORAGE_KEYS.HIDE_JM_BANNER]: true });
      }

      AppState.supporter = supporter;
      AppState.hideJobsMatchBanner = hide;
      applyJobsMatchBanner();
    }
  );

  setupSupporterUnlock();
}

async function hashUnlockCandidate(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) return '';
  const payload = `${CONFIG.UNLOCK.p}\0${normalized}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function digestsMatch(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function setUnlockStatus(message, kind) {
  const el = DOMCache.supporterUnlockStatus;
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('is-error', kind === 'error');
  el.classList.toggle('is-ok', kind === 'ok');
}

async function candidateMatchesUnlock(value) {
  const expected = CONFIG.UNLOCK.d.join('');
  const digest = await hashUnlockCandidate(value);
  return digestsMatch(digest, expected);
}

async function submitSupporterUnlock() {
  const input = DOMCache.supporterCodeInput;
  const raw = input ? input.value : '';
  const tokens = String(raw || '').trim().split(/\s+/).filter(Boolean);
  const candidates = [];
  if (raw && raw.trim()) candidates.push(raw.trim());
  tokens.forEach((token) => {
    if (!candidates.includes(token)) candidates.push(token);
  });

  if (!candidates.length) {
    setUnlockStatus('Paste the code from your Ko-fi thank-you message.', 'error');
    return;
  }

  AudioManager.play(AppState.soundEnabled);

  let matched = false;
  for (const candidate of candidates) {
    if (await candidateMatchesUnlock(candidate)) {
      matched = true;
      break;
    }
  }

  if (!matched) {
    setUnlockStatus('That code is not valid.', 'error');
    return;
  }

  markSupporter();
  if (input) input.value = '';
  setUnlockStatus('Thanks — you can hide the JobsMatch note.', 'ok');
  showToast('Supporter perk unlocked');
}

function setupSupporterUnlock() {
  const btn = DOMCache.supporterUnlockBtn;
  const input = DOMCache.supporterCodeInput;
  if (btn) btn.addEventListener('click', () => { submitSupporterUnlock(); });
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitSupporterUnlock();
      }
    });
  }
}

function setupStorageSync() {
  let timer = null;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (!changes[CONFIG.STORAGE_KEYS.VIDEOS] && !changes[CONFIG.STORAGE_KEYS.DELETED]) return;
    clearTimeout(timer);
    timer = setTimeout(() => { displayVideos(); }, 80);
  });
}

// ============================================
// INITIALIZATION
// ============================================
async function init() {
  try {
    DOMCache.init();

    // Awaited: the list rows are built from these preferences.
    const prefs = await new Promise((resolve) => {
      chrome.storage.local.get(
        {
          [CONFIG.STORAGE_KEYS.SOUND]: true,
          [CONFIG.STORAGE_KEYS.DETACH]: true,
          [CONFIG.STORAGE_KEYS.TYPE_FILTER]: 'all',
          [CONFIG.STORAGE_KEYS.FAVOURITES_ONLY]: false,
          [CONFIG.STORAGE_KEYS.AUDIO_MIX]: null
        },
        (data) => resolve(data)
      );
    });

    AppState.soundEnabled = prefs[CONFIG.STORAGE_KEYS.SOUND] !== false;
    AppState.detachEnabled = prefs[CONFIG.STORAGE_KEYS.DETACH] !== false;
    AppState.typeFilter = ['video', 'short'].includes(prefs[CONFIG.STORAGE_KEYS.TYPE_FILTER])
      ? prefs[CONFIG.STORAGE_KEYS.TYPE_FILTER]
      : 'all';
    AppState.favouritesOnly = prefs[CONFIG.STORAGE_KEYS.FAVOURITES_ONLY] === true;
    AudioMix.load(prefs[CONFIG.STORAGE_KEYS.AUDIO_MIX]);
    updateSoundIcon();
    updateMiniPlayerSwitch();
    updateTypeFilterUI();
    updateFavouriteFilterUI();
    updateMixerUI();

    setupMixer();
    setupSoundToggle();
    setupMiniPlayerToggle();
    setupWikiButton();
    setupTypeFilter();
    setupFavouriteFilter();
    setupSearch();
    setupModal();
    setupTrashActions();
    setupVideoListHandlers();
    setupViewTabs();
    setupDragAutoScroll();
    setupDonateCallout();
    setupJobsMatchBanner();
    setupStorageSync();

    await displayVideos();

    // Give the layout a moment to settle, then maybe nudge for a donation
    setTimeout(maybeShowDonateCallout, 600);
  } catch (error) {
    console.error('Initialization error:', error);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// pagehide, not unload: a popup dismissed with Esc or by clicking away can be
// torn down without unload firing, which would drop a mixer change still
// waiting to be written. pagehide covers every case unload does, so it is the
// only listener here.
window.addEventListener('pagehide', () => {
  AudioMix.flush();
  AudioManager.cleanup();
});
