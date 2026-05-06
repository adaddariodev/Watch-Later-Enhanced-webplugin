const soundBtn = document.getElementById('toggle-sound');
const tagSearchInput = document.getElementById('tag-search');
let soundEnabled = true;
let tagQuery = '';
let tagQueryMode = 'contains'; // 'contains' | 'exact'

const clickAudio = new Audio('sounds/click.wav');

clickAudio.volume = 0.5; // 50% volume

chrome.storage.local.get({ soundEnabled: true }, (data) => {
  soundEnabled = data.soundEnabled;
  updateSoundIcon();
});

if (tagSearchInput) {
  tagSearchInput.addEventListener('input', (e) => {
    tagQuery = (e.target.value || '').trim().toLowerCase();
    tagQueryMode = 'contains';
    displayVideos();
  });
}

function updateSoundIcon() {
  soundBtn.classList.toggle('muted', !soundEnabled);
  const icon = soundBtn.querySelector('img.btn-icon');
  if (icon) {
    icon.src = soundEnabled ? 'icons/buttons/volume.svg' : 'icons/buttons/volume-mute.svg';
  } else {
    // Fallback if markup changes unexpectedly
    soundBtn.innerText = soundEnabled ? '🔊' : '🔇';
  }
}

soundBtn.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  chrome.storage.local.set({ soundEnabled: soundEnabled });
  updateSoundIcon();
  if (soundEnabled) playClick();
});

function playClick() {
  if (!soundEnabled) return;

  if (clickAudio) {
    clickAudio.currentTime = 0;
    clickAudio.play().catch(e => console.log("Audio play blocked:", e));
  }
}

let draggedItemIndex = null;

function createBtnIcon(src, alt = '') {
  const img = document.createElement('img');
  img.className = 'btn-icon';
  img.src = src;
  img.alt = alt;
  img.decoding = 'async';
  img.loading = 'lazy';
  return img;
}

function colorFromTagName(name) {
  // Deterministic color per tag name (same name => same color across sessions)
  const s = String(name || '').trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) | 0;
  }
  const h = Math.abs(hash) % 360;
  return `hsl(${h} 70% 45%)`;
}

function normalizeVideo(video) {
  const tags = Array.isArray(video?.tags) ? video.tags : [];
  const normalizedTags = tags
    .filter((t) => t && typeof t.name === 'string' && t.name.trim().length > 0)
    .map((t) => ({
      name: String(t.name).trim(),
      color: colorFromTagName(t.name),
    }));

  return {
    ...video,
    tags: normalizedTags,
  };
}

function displayVideos() {
  chrome.storage.local.get({ savedVideos: [] }, (data) => {
    const savedVideos = (data.savedVideos || []).map(normalizeVideo);
    const videoList = document.getElementById('video-list');
    const tutorial = document.getElementById('tutorial');
    const clearAllBtn = document.getElementById('clear-all');
    const tutorialTitle = document.getElementById('tutorial-title');
    const tutorialText = document.getElementById('tutorial-text');

    videoList.textContent = '';

    if (savedVideos.length === 0) {
      clearAllBtn.disabled = true;
      tutorial.style.display = 'block';
      if (tutorialTitle) tutorialTitle.textContent = 'How to use';
      if (tutorialText) {
        tutorialText.innerHTML =
          'Hold the <b>Alt</b> key and <b>Click</b> on any YouTube video to save it instantly.';
      }
      return;
    }

    clearAllBtn.disabled = false;

    const filteredVideos = tagQuery
      ? savedVideos.filter((v) =>
          (v.tags || []).some((t) => {
            const n = t.name.toLowerCase();
            return tagQueryMode === 'exact' ? n === tagQuery : n.includes(tagQuery);
          })
        )
      : savedVideos;

    if (filteredVideos.length === 0) {
      tutorial.style.display = 'block';
      if (tutorialTitle) tutorialTitle.textContent = 'No results';
      if (tutorialText) tutorialText.textContent = 'No videos match this tag search.';
      return;
    }

    tutorial.style.display = 'none';

    const frag = document.createDocumentFragment();

    filteredVideos.forEach((video) => {
      const index = savedVideos.findIndex((v) => v.url === video.url);
      frag.appendChild(createVideoItem(video, index));
    });

    videoList.appendChild(frag);
  });
}

function createVideoItem(video, index) {
  const li = document.createElement('li');
  li.className = 'video-item';
  li.draggable = !tagQuery;
  if (tagQuery) li.classList.add('drag-disabled');
  li.dataset.index = String(index);
  li.dataset.url = video.url;

  const row = document.createElement('div');
  row.className = 'video-row';

  const left = document.createElement('div');
  left.className = 'video-left';

  const handle = document.createElement('div');
  handle.className = 'drag-handle';
  handle.title = tagQuery ? 'Clear search to reorder' : 'Hold and drag to reorder';
  handle.appendChild(createBtnIcon('icons/buttons/menu-burger.svg', ''));

  const title = document.createElement('span');
  title.className = 'video-title';
  title.textContent = video.title ?? '';

  left.append(handle, title);

  const actions = document.createElement('div');
  actions.className = 'video-actions';

  const tagAddBtn = document.createElement('button');
  tagAddBtn.className = 'icon-btn tag-add-btn';
  tagAddBtn.type = 'button';
  tagAddBtn.title = 'Add tag';
  tagAddBtn.setAttribute('aria-label', 'Add tag');
  tagAddBtn.appendChild(createBtnIcon('icons/buttons/tags.svg', ''));

  const delBtn = document.createElement('button');
  delBtn.className = 'icon-btn delete-btn';
  delBtn.type = 'button';
  delBtn.title = 'Remove video';
  delBtn.setAttribute('aria-label', 'Remove video');
  delBtn.dataset.index = String(index);
  delBtn.appendChild(createBtnIcon('icons/buttons/cross-small.svg', ''));

  actions.append(tagAddBtn, delBtn);
  row.append(left, actions);

  const tagRow = document.createElement('div');
  tagRow.className = 'tag-row';

  const tags = Array.isArray(video.tags) ? video.tags : [];
  for (const t of tags) {
    const pill = document.createElement('span');
    pill.className = 'tag-pill';
    const pillText = document.createElement('span');
    pillText.className = 'tag-pill-text';
    pillText.textContent = t.name;

    const pillRemove = document.createElement('button');
    pillRemove.className = 'tag-pill-remove';
    pillRemove.type = 'button';
    pillRemove.title = 'Remove tag';
    pillRemove.textContent = '×';

    pill.append(pillText, pillRemove);
    pill.style.background = t.color;
    pill.title = `Filter by "${t.name}"`;

    pill.addEventListener('click', (e) => {
      // Clicking the pill filters by that exact tag
      if (e.target && e.target.closest && e.target.closest('.tag-pill-remove')) return;
      e.preventDefault();
      e.stopPropagation();
      if (tagSearchInput) {
        tagSearchInput.value = t.name;
      }
      tagQuery = t.name.trim().toLowerCase();
      tagQueryMode = 'exact';
      displayVideos();
    });

    pillRemove.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const tagName = t.name;
      chrome.storage.local.get({ savedVideos: [] }, (data) => {
        const current = (data.savedVideos || []).map(normalizeVideo);
        const idx = current.findIndex((v) => v.url === li.dataset.url);
        if (idx === -1) return;

        const nextTags = (current[idx].tags || []).filter(
          (x) => x.name.toLowerCase() !== tagName.toLowerCase()
        );
        const next = [...current];
        next[idx] = { ...current[idx], tags: nextTags };

        chrome.storage.local.set({ savedVideos: next }, displayVideos);
      });
    });

    tagRow.appendChild(pill);
  }

  const tagInput = document.createElement('input');
  tagInput.className = 'tag-input';
  tagInput.type = 'text';
  tagInput.placeholder = 'Tag…';
  tagInput.maxLength = 22;
  tagInput.style.display = 'none';

  tagAddBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (tagInput.style.display === 'none') {
      tagInput.value = '';
      tagInput.style.display = 'inline-block';
      tagInput.focus();
    } else {
      tagInput.style.display = 'none';
    }
  });

  tagInput.addEventListener('click', (e) => e.stopPropagation());
  tagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      tagInput.style.display = 'none';
      return;
    }

    if (e.key !== 'Enter') return;
    e.preventDefault();

    const name = (tagInput.value || '').trim();
    if (!name) return;

    chrome.storage.local.get({ savedVideos: [] }, (data) => {
      const current = (data.savedVideos || []).map(normalizeVideo);
      const idx = current.findIndex((v) => v.url === li.dataset.url);
      if (idx === -1) return;

      const existing = current[idx].tags || [];
      const exists = existing.some((t) => t.name.toLowerCase() === name.toLowerCase());
      if (exists) {
        tagInput.style.display = 'none';
        return;
      }

      const next = [...current];
      next[idx] = {
        ...current[idx],
        tags: [...existing, { name, color: colorFromTagName(name) }],
      };

      chrome.storage.local.set({ savedVideos: next }, () => {
        tagInput.style.display = 'none';
        displayVideos();
      });
    });
  });

  tagRow.appendChild(tagInput);

  li.append(row, tagRow);

  li.addEventListener('dragstart', () => {
    if (tagQuery) return;
    draggedItemIndex = parseInt(li.dataset.index, 10);
    setTimeout(() => li.classList.add('dragging'), 0);
  });

  li.addEventListener('dragend', () => {
    li.classList.remove('dragging');
    document.querySelectorAll('.video-item').forEach(el => el.classList.remove('drop-target'));
  });

  li.addEventListener('dragover', (e) => {
    if (tagQuery) return;
    e.preventDefault();
    const targetIndex = parseInt(li.dataset.index, 10);
    if (draggedItemIndex !== null && draggedItemIndex !== targetIndex) {
      li.classList.add('drop-target');
    }
  });

  li.addEventListener('dragleave', () => {
    li.classList.remove('drop-target');
  });

  li.addEventListener('drop', (e) => {
    if (tagQuery) return;
    e.preventDefault();
    li.classList.remove('drop-target');

    const targetIndex = parseInt(li.dataset.index, 10);
    if (draggedItemIndex === null || draggedItemIndex === targetIndex) return;

    chrome.storage.local.get({ savedVideos: [] }, (data) => {
      const videos = (data.savedVideos || []).map(normalizeVideo);
      const [draggedVideo] = videos.splice(draggedItemIndex, 1);
      videos.splice(targetIndex, 0, draggedVideo);
      chrome.storage.local.set({ savedVideos: videos }, displayVideos);
    });
  });

  return li;
}

document.getElementById('video-list').addEventListener('click', (e) => {
  const li = e.target.closest('.video-item');
  if (!li) return;

  if (e.target.closest('.delete-btn')) {
    e.stopPropagation();
    const url = li.dataset.url;
    if (url) removeVideoByUrl(url);
    playClick();
    return;
  }

  // Tags area is interactive (filter/remove), do not open video from there.
  if (e.target.closest('.tag-row')) return;

  if (e.target.closest('.drag-handle')) return;

  // Only open the video when clicking the upper row (title area).
  if (!e.target.closest('.video-row')) return;

  const url = li.dataset.url;
  if (url) {
    playClick();
    window.open(url, '_blank');
  }
});

function removeVideoByUrl(url) {
  chrome.storage.local.get({ savedVideos: [] }, (data) => {
    const videos = (data.savedVideos || []).map(normalizeVideo);
    const idx = videos.findIndex((v) => v.url === url);
    if (idx === -1) return;
    videos.splice(idx, 1);
    chrome.storage.local.set({ savedVideos: videos }, displayVideos);
  });
}

document.getElementById('clear-all').addEventListener('click', () => {
  playClick();
  if (confirm("Clear all videos?")) {
    chrome.storage.local.set({ savedVideos: [] }, displayVideos);
  }
});

displayVideos();

// --- MODAL SETTINGS LOGIC ---
const settingsModal = document.getElementById('settings-modal');
const openSettingsBtn = document.getElementById('open-settings');
const closeSettingsBtn = document.getElementById('close-settings');

// open settings (and play sound)
openSettingsBtn.addEventListener('click', () => {
  playClick();
  settingsModal.classList.remove('hidden');
});

// close settings (and play sound)
closeSettingsBtn.addEventListener('click', () => {
  playClick();
  settingsModal.classList.add('hidden');
});