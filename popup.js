const clickAudio = new Audio('sounds/click.wav');

function playClick() {
  clickAudio.currentTime = 0;
  clickAudio.play().catch(e => console.log("Audio play blocked:", e));
}

function displayVideos() {
  chrome.storage.local.get({ savedVideos: [] }, (data) => {
    const list = document.getElementById('video-list');
    const tutorial = document.getElementById('tutorial');
    const videos = data.savedVideos;

    if (videos.length === 0) {
      list.innerHTML = '';
      tutorial.style.display = 'block';
      return;
    }

    tutorial.style.display = 'none';
    list.innerHTML = '';
    
    videos.forEach((video, index) => {
      const li = document.createElement('li');
      li.className = 'video-item';
      li.innerHTML = `
        <span class="video-title">${video.title}</span>
        <button class="delete-btn" data-index="${index}">✕</button>
      `;
      
      li.addEventListener('click', (e) => {
        if (e.target.className !== 'delete-btn') {
          playClick();
          window.open(video.url, '_blank');
        }
      });
      
      li.querySelector('.delete-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        playClick();
        removeVideo(index);
      });
      
      list.appendChild(li);
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