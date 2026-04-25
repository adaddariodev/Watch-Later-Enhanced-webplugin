const soundBtn = document.getElementById('toggle-sound');
let soundEnabled = true;

const clickAudio = new Audio('sounds/click.wav');

chrome.storage.local.get({ soundEnabled: true }, (data) => {
  soundEnabled = data.soundEnabled;
  updateSoundIcon();
});

function updateSoundIcon() {
  soundBtn.innerText = soundEnabled ? '🔊' : '🔇';
  soundBtn.classList.toggle('muted', !soundEnabled);
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

function displayVideos() {
  chrome.storage.local.get({ savedVideos: [] }, (data) => {
    const savedVideos = data.savedVideos;
    const videoList = document.getElementById('video-list');
    const tutorial = document.getElementById('tutorial');
    const clearAllBtn = document.getElementById('clear-all');

    videoList.textContent = '';

    if (savedVideos.length === 0) {
      clearAllBtn.disabled = true;
      tutorial.style.display = 'block';
      return;
    }

    clearAllBtn.disabled = false;
    tutorial.style.display = 'none';

    const frag = document.createDocumentFragment();

    savedVideos.forEach((video, index) => {
      frag.appendChild(createVideoItem(video, index));
    });

    videoList.appendChild(frag);
  });
}

function createVideoItem(video, index) {
  const li = document.createElement('li');
  li.className = 'video-item';
  li.draggable = true;
  li.dataset.index = String(index);
  li.dataset.url = video.url;

  const handle = document.createElement('div');
  handle.className = 'drag-handle';
  handle.title = 'Hold and drag to reorder';
  handle.textContent = '≡';

  const title = document.createElement('span');
  title.className = 'video-title';
  title.textContent = video.title ?? '';

  const delBtn = document.createElement('button');
  delBtn.className = 'icon-btn delete-btn';
  delBtn.type = 'button';
  delBtn.dataset.index = String(index);
  delBtn.textContent = '✕';

  li.append(handle, title, delBtn);

  li.addEventListener('dragstart', () => {
    draggedItemIndex = parseInt(li.dataset.index, 10);
    setTimeout(() => li.classList.add('dragging'), 0);
  });

  li.addEventListener('dragend', () => {
    li.classList.remove('dragging');
    document.querySelectorAll('.video-item').forEach(el => el.classList.remove('drop-target'));
  });

  li.addEventListener('dragover', (e) => {
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
    e.preventDefault();
    li.classList.remove('drop-target');

    const targetIndex = parseInt(li.dataset.index, 10);
    if (draggedItemIndex === null || draggedItemIndex === targetIndex) return;

    chrome.storage.local.get({ savedVideos: [] }, (data) => {
      const videos = data.savedVideos;
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
    const idx = parseInt(e.target.closest('.delete-btn').dataset.index, 10);
    removeVideo(idx);
    playClick();
    return;
  }

  if (e.target.closest('.drag-handle')) return;

  const url = li.dataset.url;
  if (url) {
    playClick();
    window.open(url, '_blank');
  }
});

function removeVideo(index) {
  chrome.storage.local.get({ savedVideos: [] }, (data) => {
    const videos = data.savedVideos;
    videos.splice(index, 1);
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