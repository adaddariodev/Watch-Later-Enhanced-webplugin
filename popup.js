// ============================================
// CONSTANTS & CONFIGURATION
// ============================================
const CONFIG = {
  AUDIO_VOLUME: 0.5,
  TAG_MAX_LENGTH: 22,
  DEBOUNCE_DELAY: 300,
  STORAGE_KEYS: {
    VIDEOS: 'savedVideos',
    SOUND: 'soundEnabled'
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
  clearAllBtn: null,
  settingsModal: null,
  
  init() {
    this.soundBtn = document.getElementById('toggle-sound');
    this.tagSearchInput = document.getElementById('tag-search');
    this.videoList = document.getElementById('video-list');
    this.tutorial = document.getElementById('tutorial');
    this.clearAllBtn = document.getElementById('clear-all');
    this.settingsModal = document.getElementById('settings-modal');
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
  
  setSoundEnabled(value) {
    this.soundEnabled = value;
    chrome.storage.local.set({ [CONFIG.STORAGE_KEYS.SOUND]: value });
  },
  
  setTagQuery(value, mode = 'contains') {
    this.tagQuery = value.trim().toLowerCase();
    this.tagQueryMode = mode;
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
   * Normalize video object structure
   * IMPORTANT: Uses Utils.colorFromTagName (not this.colorFromTagName)
   * because this method is often used as a .map() callback,
   * which would lose the 'this' binding.
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
        
        // Bind explicit per evitare problemi di 'this' in map callback
        const videos = (data[CONFIG.STORAGE_KEYS.VIDEOS] || [])
          .map((v) => Utils.normalizeVideo(v))
          .filter(v => v !== null);
        
        resolve(videos);
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
  
  async removeVideoByUrl(url) {
    try {
      const videos = await this.getVideos();
      const filtered = videos.filter((v) => v.url !== url);
      await this.saveVideos(filtered);
      return true;
    } catch (error) {
      console.error('Remove video error:', error);
      return false;
    }
  },
  
  async clearAllVideos() {
    try {
      await this.saveVideos([]);
      return true;
    } catch (error) {
      console.error('Clear all error:', error);
      return false;
    }
  }
};

// ============================================
// VIDEO ITEM CREATION
// ============================================
const VideoItemFactory = {
  create(video, index) {
    const li = document.createElement('li');
    li.className = 'video-item';
    li.draggable = !AppState.tagQuery;
    if (AppState.tagQuery) li.classList.add('drag-disabled');
    li.dataset.index = String(index);
    li.dataset.url = video.url;

    const { row, tagAddBtn } = this.createVideoRow(video, index);
    const tagRow = this.createTagRow(video, li, tagAddBtn);

    li.append(row, tagRow);
    this.attachDragListeners(li);

    return li;
  },
  
  createVideoRow(video, index) {
    const row = document.createElement('div');
    row.className = 'video-row';

    const left = document.createElement('div');
    left.className = 'video-left';

    const handle = this.createDragHandle();
    const title = this.createTitle(video.title);

    left.append(handle, title);

    const { actions, tagAddBtn } = this.createActions(index);
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
  
  createActions(index) {
    const actions = document.createElement('div');
    actions.className = 'video-actions';

    const tagAddBtn = document.createElement('button');
    tagAddBtn.className = 'icon-btn tag-add-btn';
    tagAddBtn.type = 'button';
    tagAddBtn.title = 'Add tag';
    tagAddBtn.setAttribute('aria-label', 'Add tag');
    tagAddBtn.appendChild(Utils.createBtnIcon('icons/buttons/tags.svg', ''));

    const delBtn = document.createElement('button');
    delBtn.className = 'icon-btn delete-btn';
    delBtn.type = 'button';
    delBtn.title = 'Remove video';
    delBtn.setAttribute('aria-label', 'Remove video');
    delBtn.dataset.index = String(index);
    delBtn.appendChild(Utils.createBtnIcon('icons/buttons/cross-small.svg', ''));

    actions.append(tagAddBtn, delBtn);
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
    const savedVideos = await StorageManager.getVideos();
    
    if (!DOMCache.videoList || !DOMCache.tutorial || !DOMCache.clearAllBtn) {
      console.error('Required DOM elements not found');
      return;
    }

    DOMCache.videoList.textContent = '';

    if (savedVideos.length === 0) {
      DOMCache.clearAllBtn.disabled = true;
      showTutorial('How to use', 'Hold the <b>Alt</b> key and <b>Click</b> on any YouTube video to save it instantly.');
      return;
    }

    DOMCache.clearAllBtn.disabled = false;

    const filteredVideos = AppState.tagQuery
      ? savedVideos.filter((v) =>
          (v.tags || []).some((t) => {
            const n = t.name.toLowerCase();
            return AppState.tagQueryMode === 'exact' ? n === AppState.tagQuery : n.includes(AppState.tagQuery);
          })
        )
      : savedVideos;

    if (filteredVideos.length === 0) {
      showTutorial('No results', 'No videos match this tag search.');
      return;
    }

    DOMCache.tutorial.style.display = 'none';

    const frag = document.createDocumentFragment();

    filteredVideos.forEach((video) => {
      const index = savedVideos.findIndex((v) => v.url === video.url);
      frag.appendChild(VideoItemFactory.create(video, index));
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

// ============================================
// EVENT HANDLERS (Event Delegation)
// ============================================
function setupVideoListHandlers() {
  if (!DOMCache.videoList) return;
  
  DOMCache.videoList.addEventListener('click', async (e) => {
    const li = e.target.closest('.video-item');
    if (!li) return;

    if (e.target.closest('.delete-btn')) {
      e.stopPropagation();
      const url = li.dataset.url;
      if (url) {
        AudioManager.play(AppState.soundEnabled);
        await StorageManager.removeVideoByUrl(url);
        displayVideos();
      }
      return;
    }

    if (e.target.closest('.tag-add-btn')) return;
    if (e.target.closest('.tag-row')) return;
    if (e.target.closest('.video-actions')) return;
    if (e.target.closest('.drag-handle')) return;

    if (e.target.closest('.video-left')) {
      const url = li.dataset.url;
      if (url) {
        AudioManager.play(AppState.soundEnabled);
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    }
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
// CLEAR ALL HANDLING
// ============================================
function setupClearAll() {
  const clearBtn = document.getElementById('clear-all');
  
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      AudioManager.play(AppState.soundEnabled);
      
      if (confirm("Clear all videos?")) {
        await StorageManager.clearAllVideos();
        displayVideos();
      }
    });
  }
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
    setupClearAll();
    setupVideoListHandlers();
    
    await displayVideos();
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