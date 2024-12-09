function saveVideo(video, button) {
  chrome.storage.local.get({ savedVideos: [] }, (data) => {
    const savedVideos = data.savedVideos;

    // Evita di aggiungere duplicati
    if (savedVideos.some((v) => v.url === video.url)) {
      alert('This video is already saved!');
      return;
    }

    savedVideos.push(video);
    chrome.storage.local.set({ savedVideos }, () => {
      button.innerText = '✔';
      button.style.background = 'rgba(0, 200, 0, 0.8)';
      button.style.cursor = 'default';
      button.disabled = true;
    });
  });
}

function addSaveButtonToVideos() {
  const videoElements = document.querySelectorAll('ytd-thumbnail');

  videoElements.forEach((thumbnail) => {
    // Evita di aggiungere il pulsante più volte
    if (thumbnail.querySelector('.save-watchlater-button')) return;

    // Imposta il genitore come relativo per il posizionamento assoluto del pulsante
    thumbnail.style.position = 'relative';

    // Crea il pulsante
    const button = document.createElement('button');
    button.innerText = '➕';
    button.className = 'save-watchlater-button';
    button.style.position = 'absolute';
    button.style.top = '10px';
    button.style.right = '10px';
    button.style.padding = '5px';
    button.style.background = 'rgba(255, 0, 0, 0.8)';
    button.style.color = 'white';
    button.style.border = 'none';
    button.style.borderRadius = '4px';
    button.style.cursor = 'pointer';
    button.style.zIndex = '1000';

    // Aggiungi l’evento click per salvare il video
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();

      const videoLinkElement = thumbnail.querySelector('a#thumbnail');
      if (!videoLinkElement) {
        alert("Error: Cannot find the URL of the video");
        return;
      }

      const videoUrl = videoLinkElement.href;
      const videoTitleElement = thumbnail.closest('ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer')?.querySelector('#video-title, #video-title-link');
      const videoTitle = videoTitleElement ? videoTitleElement.innerText.trim() : 'Video without title.';

      saveVideo({ title: videoTitle, url: videoUrl }, button);
    });

    // Aggiungi il pulsante alla thumbnail
    thumbnail.appendChild(button);

    // Controlla lo stato del pulsante al caricamento
    updateButtonState(thumbnail, button);
  });
}

// Funzione per aggiornare dinamicamente lo stato del pulsante
function updateButtonState(thumbnail, button) {
  const videoLinkElement = thumbnail.querySelector('a#thumbnail');
  if (!videoLinkElement) return;

  const videoUrl = videoLinkElement.href;

  chrome.storage.local.get({ savedVideos: [] }, (data) => {
    const savedVideos = data.savedVideos;
    const isSaved = savedVideos.some((video) => video.url === videoUrl);

    if (isSaved) {
      button.innerText = '✔';
      button.style.background = 'rgba(0, 200, 0, 0.8)';
      button.style.cursor = 'default';
      button.disabled = true;
    } else {
      button.innerText = '➕';
      button.style.background = 'rgba(255, 0, 0, 0.8)';
      button.style.cursor = 'pointer';
      button.disabled = false;
    }
  });
}

// Funzione per aggiornare lo stato di tutti i pulsanti sulla pagina
function refreshButtons() {
  const videoElements = document.querySelectorAll('ytd-thumbnail');
  videoElements.forEach((thumbnail) => {
    const button = thumbnail.querySelector('.save-watchlater-button');
    if (button) {
      updateButtonState(thumbnail, button);
    }
  });
}

// Ascolta i messaggi dal popup per aggiornare i pulsanti
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "updateButtons") {
    refreshButtons();
  }
});

// Esegui la funzione ogni 2 secondi per catturare nuovi video durante lo scroll
setInterval(addSaveButtonToVideos, 2000);
