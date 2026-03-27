const soundBtn = document.getElementById('toggle-sound');
let soundEnabled = true;

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
  clickAudio.currentTime = 0;
  clickAudio.play().catch(e => console.log("Audio play blocked:", e));
}

function displayVideos() {
  chrome.storage.local.get({ savedVideos: [] }, (data) => {
    const savedVideos = data.savedVideos;
    const videoList = document.getElementById('video-list');
    const tutorial = document.getElementById('tutorial');
    const clearAllBtn = document.getElementById('clear-all');

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
      li.innerHTML = `
        <span class="video-title">${video.title}</span>
        <button class="icon-btn delete-btn" data-index="${index}">✕</button>
      `;
      
      li.addEventListener('click', (e) => {
        if (e.target.className !== 'icon-btn delete-btn') {
          playClick();
          window.open(video.url, '_blank');
        }
      });

      const delBtn = li.querySelector('.delete-btn');
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        playClick();
        removeVideo(index);
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