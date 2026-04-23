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

let draggedItemIndex = null; // Global variable to track what we're moving

function displayVideos() {
  chrome.storage.local.get({ savedVideos: [] }, (data) => {
    const savedVideos = data.savedVideos;
    const videoList = document.getElementById('video-list');
    const tutorial = document.getElementById('tutorial');
    const clearAllBtn = document.getElementById('clear-all');
``
    videoList.innerHTML = '';

    if (savedVideos.length === 0) {
      clearAllBtn.disabled = true;
      tutorial.style.display = 'block';
      return;
    } else {
      clearAllBtn.disabled = false;
      tutorial.style.display = 'none';
    }

    savedVideos.forEach((video, index) => {
      const li = document.createElement('li');
      li.className = 'video-item';
      li.setAttribute('draggable', 'true'); // Makes the element draggable
      li.dataset.index = index; // We save the index for sorting
      
      // We add the handle (≡) to the HTML
      li.innerHTML = `
        <div class="drag-handle" title="Hold and drag to reorder">≡</div>
        <span class="video-title">${video.title}</span>
        <button class="icon-btn delete-btn" data-index="${index}">✕</button>
      `;
      
      // --- CLICK LOGIC (Opening video) ---
      li.addEventListener('click', (e) => {
        // We avoid opening the video if we click on the trash or the handle
        if (!e.target.closest('.delete-btn') && !e.target.closest('.drag-handle')) {
          playClick();
          window.open(video.url, '_blank');
        }
      });

      // --- DELETION LOGIC ---
      const delBtn = li.querySelector('.delete-btn');
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const videoIndex = parseInt(delBtn.dataset.index, 10);
        removeVideo(videoIndex);
        playClick();
      });

      // --- DRAG & DROP LOGIC ---
      
      // 1. Start dragging
      li.addEventListener('dragstart', (e) => {
        draggedItemIndex = parseInt(li.dataset.index, 10);
        // We use a small timeout so the 'dragging' class is applied to the original element (creating the zoom effect), but the browser's native shadow remains clean
        setTimeout(() => li.classList.add('dragging'), 0); 
      });

      // 2. End dragging
      li.addEventListener('dragend', () => {
        li.classList.remove('dragging');
        // Safety cleanup on all elements
        document.querySelectorAll('.video-item').forEach(el => el.classList.remove('drop-target'));
      });

      // 3. When hovering over another element
      li.addEventListener('dragover', (e) => {
        e.preventDefault(); // Necessary to allow dropping
        const targetIndex = parseInt(li.dataset.index, 10);
        if (draggedItemIndex !== targetIndex && draggedItemIndex !== null) {
          li.classList.add('drop-target');
        }
      });

      // 4. When leaving an element we were hovering over
      li.addEventListener('dragleave', () => {
        li.classList.remove('drop-target');
      });

      // 5. When dropping the element (the actual drop)
      li.addEventListener('drop', (e) => {
        e.preventDefault();
        li.classList.remove('drop-target');
        
        const targetIndex = parseInt(li.dataset.index, 10);
        
        // If the element is dropped on itself or there's an error, do nothing
        if (draggedItemIndex === null || draggedItemIndex === targetIndex) return;

        // We retrieve the data and modify the order
        chrome.storage.local.get({ savedVideos: [] }, (data) => {
          const videos = data.savedVideos;
          // We remove the element from the old position
          const [draggedVideo] = videos.splice(draggedItemIndex, 1);
          // We insert it in the new position
          videos.splice(targetIndex, 0, draggedVideo);
          
          // We save to Local Storage and update the UI
          chrome.storage.local.set({ savedVideos: videos }, displayVideos);
        });
      });

      videoList.appendChild(li);
    });
  });
}

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