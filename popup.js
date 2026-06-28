// ============================================
// CONSTANTS & CONFIGURATION
// ============================================
const CONFIG = {
  AUDIO_VOLUME: 0.5,
  TAG_MAX_LENGTH: 22,
  DEBOUNCE_DELAY: 300,
  TRASH_CAP: 50,           // max items kept in the trash (oldest are purged)
  UNDO_DURATION: 2500,     // how long the undo toast stays up (ms)
  DONATE_PROMPT_CHANCE: 0.35,                // chance to show the donate callout on open
  DONATE_PROMPT_COOLDOWN: 3 * 60 * 60 * 1000, // min time between prompts (ms)
  STORAGE_KEYS: {
    VIDEOS: 'savedVideos',
    DELETED: 'deletedVideos',
    SOUND: 'soundEnabled',
    SUPPORTER: 'supporter',
    LAST_PROMPT: 'lastDonatePrompt'
  }
};

// ============================================
// AUDIO MANAGEMENT (Singleton Pattern)
// ============================================
const AudioManager = {
  clickAudio: null,

  init() {
    if (!this.clickAudio) {
      this.clickAudio = new Audio('sounds/click.wav');
      this.clickAudio.volume = CONFIG.AUDIO_VOLUME;
    }
    return this.clickAudio;
  },

  play(soundEnabled) {
    if (!soundEnabled) return;

    const audio = this.init();
    audio.currentTime = 0;
    audio.play().catch(e => console.warn("Audio play blocked:", e));
  },

  cleanup() {
    if (this.clickAudio) {
      this.clickAudio.pause();
      this.clickAudio.currentTime = 0;
      this.clickAudio = null;
    }
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
  }
};

// ============================================
// STATE MANAGEMENT
// ============================================
const AppState = {
  soundEnabled: true,
  tagQuery: '',
  tagQueryMode: 'contains',
  draggedItemIndex: null,
  view: 'active', // 'active' | 'archive' | 'trash'

  setSoundEnabled(value) {
    this.soundEnabled = value;
    chrome.storage.local.set({ [CONFIG.STORAGE_KEYS.SOUND]: value });
  },

  setTagQuery(value, mode = 'contains') {
    this.tagQuery = value.trim().toLowerCase();
    this.tagQueryMode = mode;
  },

  setView(view) {
    this.view = view;
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

    return {
      ...video,
      title: video.title || 'Untitled Video',
      url: video.url || '',
      tags: normalizedTags,
      watched: video.watched === true,
      watchedAt: typeof video.watchedAt === 'number' ? video.watchedAt : null,
      savedAt: typeof video.savedAt === 'number' ? video.savedAt : null,
    };
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
  async getVideos() {
    return new Promise((resolve) => {
      chrome.storage.local.get({ [CONFIG.STORAGE_KEYS.VIDEOS]: [] }, (data) => {
        if (chrome.runtime.lastError) {
          console.error('Storage read error:', chrome.runtime.lastError);
          resolve([]);
          return;
        }

        const videos = (data[CONFIG.STORAGE_KEYS.VIDEOS] || [])
          .map((v) => Utils.normalizeVideo(v))
          .filter(v => v !== null);

        resolve(videos);
      });
    });
  },

  async getDeleted() {
    return new Promise((resolve) => {
      chrome.storage.local.get({ [CONFIG.STORAGE_KEYS.DELETED]: [] }, (data) => {
        if (chrome.runtime.lastError) {
          console.error('Storage read error:', chrome.runtime.lastError);
          resolve([]);
          return;
        }

        const deleted = (data[CONFIG.STORAGE_KEYS.DELETED] || [])
          .map((v) => {
            const norm = Utils.normalizeVideo(v);
            if (!norm) return null;
            // Preserve trash-only bookkeeping fields
            norm.deletedAt = typeof v.deletedAt === 'number' ? v.deletedAt : Date.now();
            norm._idx = typeof v._idx === 'number' ? v._idx : null;
            return norm;
          })
          .filter(v => v !== null);

        resolve(deleted);
      });
    });
  },

  async saveVideos(videos) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [CONFIG.STORAGE_KEYS.VIDEOS]: videos }, () => {
        if (chrome.runtime.lastError) {
          console.error('Storage write error:', chrome.runtime.lastError);
          reject(chrome.runtime.lastError);
          return;
        }
        resolve();
      });
    });
  },

  async saveDeleted(deleted) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [CONFIG.STORAGE_KEYS.DELETED]: deleted }, () => {
        if (chrome.runtime.lastError) {
          console.error('Storage write error:', chrome.runtime.lastError);
          reject(chrome.runtime.lastError);
          return;
        }
        resolve();
      });
    });
  },

  async updateVideoByUrl(url, updates) {
    try {
      const videos = await this.getVideos();
      const idx = videos.findIndex((v) => v.url === url);

      if (idx === -1) {
        console.warn('Video not found for URL:', url);
        return false;
      }

      videos[idx] = { ...videos[idx], ...updates };
      await this.saveVideos(videos);
      return true;
    } catch (error) {
      console.error('Update video error:', error);
      return false;
    }
  },

  /**
   * Toggle the "watched" flag (moves a video between To Watch and Archive).
   */
  async toggleWatched(url) {
    try {
      const videos = await this.getVideos();
      const idx = videos.findIndex((v) => v.url === url);
      if (idx === -1) return false;

      const watched = !videos[idx].watched;
      videos[idx] = {
        ...videos[idx],
        watched,
        watchedAt: watched ? Date.now() : null
      };
      await this.saveVideos(videos);
      return watched;
    } catch (error) {
      console.error('Toggle watched error:', error);
      return false;
    }
  },

  /**
   * Soft-delete: move the given URLs from the active list into the trash.
   * Returns the list of URLs actually moved (for undo).
   */
  async softDelete(urls) {
    try {
      const videos = await this.getVideos();
      const deleted = await this.getDeleted();
      const urlSet = new Set(urls);
      const now = Date.now();

      const moved = [];
      const remaining = [];
      videos.forEach((v, i) => {
        if (urlSet.has(v.url)) {
          moved.push({ ...v, deletedAt: now, _idx: i });
        } else {
          remaining.push(v);
        }
      });

      if (moved.length === 0) return [];

      const newDeleted = [...moved, ...deleted].slice(0, CONFIG.TRASH_CAP);
      await this.saveVideos(remaining);
      await this.saveDeleted(newDeleted);
      return moved.map((m) => m.url);
    } catch (error) {
      console.error('Soft delete error:', error);
      return [];
    }
  },

  /**
   * Restore the given URLs from the trash back into the active list,
   * reinserting them at their original position when possible.
   */
  async restore(urls) {
    try {
      const videos = await this.getVideos();
      const deleted = await this.getDeleted();
      const urlSet = new Set(urls);

      const toRestore = deleted.filter((d) => urlSet.has(d.url));
      const remainingTrash = deleted.filter((d) => !urlSet.has(d.url));

      // Ascending original index so a multi-item restore rebuilds the order
      toRestore.sort((a, b) => (a._idx ?? Number.MAX_SAFE_INTEGER) - (b._idx ?? Number.MAX_SAFE_INTEGER));

      toRestore.forEach((d) => {
        const clean = { ...d };
        delete clean.deletedAt;
        delete clean._idx;
        const pos = typeof d._idx === 'number'
          ? Math.min(Math.max(d._idx, 0), videos.length)
          : videos.length;
        videos.splice(pos, 0, clean);
      });

      await this.saveVideos(videos);
      await this.saveDeleted(remainingTrash);
      return true;
    } catch (error) {
      console.error('Restore error:', error);
      return false;
    }
  },

  /**
   * Permanently remove the given URLs from the trash.
   */
  async permanentDelete(urls) {
    try {
      const deleted = await this.getDeleted();
      const urlSet = new Set(urls);
      const filtered = deleted.filter((d) => !urlSet.has(d.url));
      await this.saveDeleted(filtered);
      return true;
    } catch (error) {
      console.error('Permanent delete error:', error);
      return false;
    }
  },

  async emptyTrash() {
    try {
      await this.saveDeleted([]);
      return true;
    } catch (error) {
      console.error('Empty trash error:', error);
      return false;
    }
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
    const canDrag = mode === 'active' && !AppState.tagQuery;
    li.draggable = canDrag;
    if (mode === 'active' && AppState.tagQuery) li.classList.add('drag-disabled');

    const { row, tagAddBtn } = this.createVideoRow(video, index, mode, canDrag);
    li.appendChild(row);

    if (editable) {
      const tagRow = this.createTagRow(video, li, tagAddBtn);
      li.appendChild(tagRow);
    } else if (Array.isArray(video.tags) && video.tags.length) {
      // Read-only tags in the trash view
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

    if (canDrag) {
      left.appendChild(this.createDragHandle());
    }

    left.appendChild(this.createTitle(video.title));

    const { actions, tagAddBtn } = this.createActions(index, mode, video);
    row.append(left, actions);

    return { row, tagAddBtn };
  },

  createDragHandle() {
    const handle = document.createElement('div');
    handle.className = 'drag-handle';
    handle.title = AppState.tagQuery ? 'Clear search to reorder' : 'Hold and drag to reorder';
    handle.appendChild(Utils.createBtnIcon('icons/buttons/menu-burger.svg', ''));
    return handle;
  },

  createTitle(title) {
    const titleEl = document.createElement('span');
    titleEl.className = 'video-title';
    titleEl.textContent = title;
    return titleEl;
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

  createActions(index, mode, video) {
    const actions = document.createElement('div');
    actions.className = 'video-actions';
    let tagAddBtn = null;

    if (mode === 'trash') {
      const restoreBtn = this.makeIconButton('restore-btn', 'icons/buttons/rotate-left.svg', 'Restore video');
      const permaBtn = this.makeIconButton('perma-delete-btn', 'icons/buttons/trash-xmark.svg', 'Delete permanently');
      actions.append(restoreBtn, permaBtn);
      return { actions, tagAddBtn };
    }

    // active / archive
    if (mode === 'archive') {
      const unwatchBtn = this.makeIconButton('watch-toggle-btn', 'icons/buttons/rotate-left.svg', 'Move back to To Watch');
      actions.appendChild(unwatchBtn);
    } else {
      const watchedBtn = this.makeIconButton('watch-toggle-btn', 'icons/buttons/check.svg', 'Mark as watched');
      actions.appendChild(watchedBtn);
    }

    tagAddBtn = this.makeIconButton('tag-add-btn', 'icons/buttons/tags.svg', 'Add tag');
    actions.appendChild(tagAddBtn);

    const delBtn = this.makeIconButton('delete-btn', 'icons/buttons/cross-small.svg', 'Remove video');
    delBtn.dataset.index = String(index);
    actions.appendChild(delBtn);

    return { actions, tagAddBtn };
  },

  createTagRow(video, li, tagAddBtn) {
    const tagRow = document.createElement('div');
    tagRow.className = 'tag-row';

    const tags = Array.isArray(video.tags) ? video.tags : [];

    tags.forEach(tag => {
      const pill = this.createTagPill(tag, li);
      tagRow.appendChild(pill);
    });

    const tagInput = this.createTagInput(li, tagAddBtn);
    tagRow.appendChild(tagInput);

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

  createTagInput(li, tagAddBtn) {
    const tagInput = document.createElement('input');
    tagInput.className = 'tag-input';
    tagInput.type = 'text';
    tagInput.placeholder = 'Tag…';
    tagInput.maxLength = CONFIG.TAG_MAX_LENGTH;
    tagInput.style.display = 'none';

    if (tagAddBtn) {
      tagAddBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (tagInput.style.display === 'none') {
          tagInput.value = '';
          tagInput.style.display = 'inline-block';
          tagInput.focus();
        } else {
          tagInput.style.display = 'none';
        }
      });
    }

    tagInput.addEventListener('click', (e) => e.stopPropagation());

    tagInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        tagInput.style.display = 'none';
        return;
      }

      if (e.key !== 'Enter') return;
      e.preventDefault();
      e.stopPropagation();

      const name = (tagInput.value || '').trim();
      if (!name) return;

      // Capture URL BEFORE async operations (li might be removed from DOM)
      const videoUrl = li.dataset.url;
      if (!videoUrl) {
        console.warn('No video URL found on li element');
        return;
      }

      try {
        const videos = await StorageManager.getVideos();
        const video = videos.find((v) => v.url === videoUrl);

        if (!video) {
          console.warn('Video not found in storage:', videoUrl);
          return;
        }

        const existing = video.tags || [];
        const exists = existing.some((t) => t.name.toLowerCase() === name.toLowerCase());

        if (exists) {
          console.info('Tag already exists:', name);
          tagInput.style.display = 'none';
          return;
        }

        const newTag = {
          name,
          color: Utils.colorFromTagName(name)
        };

        const success = await StorageManager.updateVideoByUrl(videoUrl, {
          tags: [...existing, newTag]
        });

        if (success) {
          displayVideos();
        } else {
          console.error('Failed to update video tags');
        }
      } catch (error) {
        console.error('Error adding tag:', error);
      }
    });

    return tagInput;
  },

  attachDragListeners(li) {
    li.addEventListener('dragstart', () => {
      if (AppState.tagQuery) return;
      AppState.draggedItemIndex = parseInt(li.dataset.index, 10);
      setTimeout(() => li.classList.add('dragging'), 0);
    });

    li.addEventListener('dragend', () => {
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
        const videos = await StorageManager.getVideos();
        const [draggedVideo] = videos.splice(AppState.draggedItemIndex, 1);
        videos.splice(targetIndex, 0, draggedVideo);
        await StorageManager.saveVideos(videos);
        displayVideos();
      } catch (error) {
        console.error('Error reordering videos:', error);
      }
    });
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

    DOMCache.videoList.textContent = '';

    // ---- TRASH VIEW ----
    if (AppState.view === 'trash') {
      if (deletedVideos.length === 0) {
        showTutorial('Trash is empty', 'Deleted videos appear here so you can restore them. Items are removed automatically once the trash is full.');
        return;
      }
      DOMCache.tutorial.style.display = 'none';
      const frag = document.createDocumentFragment();
      deletedVideos.forEach((video) => {
        frag.appendChild(VideoItemFactory.create(video, -1, 'trash'));
      });
      DOMCache.videoList.appendChild(frag);
      return;
    }

    // ---- ACTIVE / ARCHIVE VIEWS ----
    const source = AppState.view === 'archive' ? archivedVideos : activeVideos;

    if (source.length === 0) {
      if (AppState.view === 'archive') {
        showTutorial('No watched videos yet', 'Mark a video as watched (✓) to move it here.');
      } else {
        showTutorial('How to use', 'Hold the <b>Alt</b> key and <b>Click</b> on any YouTube video to save it instantly.');
      }
      return;
    }

    const filteredVideos = AppState.tagQuery
      ? source.filter((v) =>
          (v.tags || []).some((t) => {
            const n = t.name.toLowerCase();
            return AppState.tagQueryMode === 'exact' ? n === AppState.tagQuery : n.includes(AppState.tagQuery);
          })
        )
      : source;

    if (filteredVideos.length === 0) {
      showTutorial('No results', 'No videos match this tag search.');
      return;
    }

    DOMCache.tutorial.style.display = 'none';

    const frag = document.createDocumentFragment();
    filteredVideos.forEach((video) => {
      // Index into the FULL saved array, so drag reorder stays correct
      const index = savedVideos.findIndex((v) => v.url === video.url);
      frag.appendChild(VideoItemFactory.create(video, index, AppState.view));
    });

    DOMCache.videoList.appendChild(frag);
  } catch (error) {
    console.error('Error displaying videos:', error);
    showTutorial('Error', 'Failed to load videos. Please try refreshing.');
  }
}

function showTutorial(title, message) {
  if (!DOMCache.tutorial) return;

  DOMCache.tutorial.style.display = 'block';

  const titleEl = document.getElementById('tutorial-title');
  const textEl = document.getElementById('tutorial-text');

  if (titleEl) titleEl.textContent = title;
  if (textEl) {
    textEl.innerHTML = message;
  }
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

    // Mark watched / move back to To Watch
    if (e.target.closest('.watch-toggle-btn')) {
      e.stopPropagation();
      if (!url) return;
      AudioManager.play(AppState.soundEnabled);
      const nowWatched = await StorageManager.toggleWatched(url);
      displayVideos();
      showToast(
        nowWatched ? 'Moved to Archive' : 'Moved to To Watch',
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
      if (url) {
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
    if (AppState.soundEnabled) {
      AudioManager.play(true);
    }
  });
}

// ============================================
// SEARCH HANDLING
// ============================================
function setupSearch() {
  if (!DOMCache.tagSearchInput) return;

  const debouncedSearch = Utils.debounce((value) => {
    AppState.setTagQuery(value, 'contains');
    displayVideos();
  }, CONFIG.DEBOUNCE_DELAY);

  DOMCache.tagSearchInput.addEventListener('input', (e) => {
    debouncedSearch(e.target.value || '');
  });
}

// ============================================
// MODAL HANDLING
// ============================================
function setupModal() {
  const openBtn = document.getElementById('open-settings');
  const closeBtn = document.getElementById('close-settings');

  if (openBtn && DOMCache.settingsModal) {
    openBtn.addEventListener('click', () => {
      AudioManager.play(AppState.soundEnabled);
      DOMCache.settingsModal.classList.remove('hidden');
    });
  }

  if (closeBtn && DOMCache.settingsModal) {
    closeBtn.addEventListener('click', () => {
      AudioManager.play(AppState.soundEnabled);
      DOMCache.settingsModal.classList.add('hidden');
    });
  }
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
// DONATE CALLOUT (honor-system supporter prompt)
// ============================================
function markSupporter() {
  // We cannot verify a Ko-fi donation from the extension (no backend, no login).
  // This is an honor-system flag: once set, the donate prompt never shows again.
  chrome.storage.local.set({ [CONFIG.STORAGE_KEYS.SUPPORTER]: true });
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
  const doneBtn = document.getElementById('donate-callout-done');
  const cta = document.getElementById('donate-callout-cta');

  if (closeBtn) closeBtn.addEventListener('click', hideDonateCallout);
  if (doneBtn) doneBtn.addEventListener('click', () => { markSupporter(); hideDonateCallout(); });
  if (cta) cta.addEventListener('click', () => { markSupporter(); hideDonateCallout(); });

  // Clicking the header donate button counts as goodwill → stop nagging.
  if (DOMCache.donateBtn) DOMCache.donateBtn.addEventListener('click', markSupporter);

  window.addEventListener('resize', () => {
    if (DOMCache.donateCallout && DOMCache.donateCallout.classList.contains('visible')) {
      positionDonateCallout();
    }
  });
}

// ============================================
// INITIALIZATION
// ============================================
async function init() {
  try {
    DOMCache.init();

    chrome.storage.local.get({ [CONFIG.STORAGE_KEYS.SOUND]: true }, (data) => {
      AppState.soundEnabled = data[CONFIG.STORAGE_KEYS.SOUND];
      updateSoundIcon();
    });

    setupSoundToggle();
    setupSearch();
    setupModal();
    setupTrashActions();
    setupVideoListHandlers();
    setupViewTabs();
    setupDonateCallout();

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

window.addEventListener('unload', () => {
  AudioManager.cleanup();
});
