function saveVideo(video, button) {
  chrome.storage.local.get({ savedVideos: [] }, (data) => {
    const savedVideos = data.savedVideos;

    // Evita di aggiungere duplicati
    if (savedVideos.some((v) => v.url === video.url)) {
      showTemporaryMessage("This video is already saved!", "error");
      return;
    }

    savedVideos.push(video);
    chrome.storage.local.set({ savedVideos }, () => {
      button.innerText = '✔';
      button.style.background = 'rgba(0, 200, 0, 0.8)';
      button.style.cursor = 'default';
      button.disabled = true;
      showTemporaryMessage("Video added to your list!", "success");
    });
  });
}

function addSaveButtonToVideos() {
  const videoElements = document.querySelectorAll('ytd-thumbnail');

  videoElements.forEach((thumbnail) => {
    // Evita di aggiungere i pulsanti più volte
    if (thumbnail.querySelector('.save-watchlater-button') || thumbnail.querySelector('.copy-url-button')) return;

    // Imposta il genitore come relativo per il posizionamento assoluto dei pulsanti
    thumbnail.style.position = 'relative';

    // Crea il pulsante di salvataggio
    const saveButton = document.createElement('button');
    saveButton.innerText = '➕';
    saveButton.className = 'save-watchlater-button';
    saveButton.style.position = 'absolute';
    saveButton.style.top = '10px';
    saveButton.style.right = '10px';
    saveButton.style.padding = '5px';
    saveButton.style.background = 'rgba(255, 0, 0, 0.8)';
    saveButton.style.color = 'white';
    saveButton.style.border = 'none';
    saveButton.style.borderRadius = '4px';
    saveButton.style.cursor = 'pointer';
    saveButton.style.zIndex = '1000';

    saveButton.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();

      const videoLinkElement = thumbnail.querySelector('a#thumbnail');
      if (!videoLinkElement) {
        showTemporaryMessage("Error: Cannot find the URL of the video", "error");
        return;
      }

      const videoUrl = videoLinkElement.href;
      const videoTitleElement = thumbnail.closest('ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer')?.querySelector('#video-title, #video-title-link');
      const videoTitle = videoTitleElement ? videoTitleElement.innerText.trim() : 'Video without title.';

      saveVideo({ title: videoTitle, url: videoUrl }, saveButton);
    });

    thumbnail.appendChild(saveButton);

    // Crea il pulsante per copiare la URL
    const copyButton = document.createElement('button');
    copyButton.innerText = '📋';
    copyButton.className = 'copy-url-button';
    copyButton.style.position = 'absolute';
    copyButton.style.top = '10px';
    copyButton.style.right = '50px';
    copyButton.style.padding = '5px';
    copyButton.style.background = 'rgba(0, 0, 255, 0.8)';
    copyButton.style.color = 'white';
    copyButton.style.border = 'none';
    copyButton.style.borderRadius = '4px';
    copyButton.style.cursor = 'pointer';
    copyButton.style.zIndex = '1000';

    copyButton.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();

      const videoLinkElement = thumbnail.querySelector('a#thumbnail');
      if (!videoLinkElement) {
        showTemporaryMessage("Error: Cannot find the video URL", "error");
        return;
      }

      const videoUrl = videoLinkElement.href;

      // Copia la URL nella clipboard
      navigator.clipboard.writeText(videoUrl).then(() => {
        showTemporaryMessage("Video URL copied to clipboard!", "success");
      }).catch((err) => {
        console.error('Failed to copy URL: ', err);
        showTemporaryMessage("Failed to copy the video URL", "error");
      });
    });

    thumbnail.appendChild(copyButton);

    // Controlla lo stato del pulsante di salvataggio al caricamento
    updateButtonState(thumbnail, saveButton);
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

// Funzione per mostrare un messaggio temporaneo
function showTemporaryMessage(message, type) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `temporary-message ${type}`;
  messageDiv.innerText = message;

  // Aggiungi il messaggio al corpo della pagina
  document.body.appendChild(messageDiv);

  // Rimuovi il messaggio dopo 2 secondi
  setTimeout(() => {
    messageDiv.remove();
  }, 2000);
}

// Funzione per aggiornare lo stato di tutti i pulsanti sulla pagina
function refreshButtons() {
  const videoElements = document.querySelectorAll('ytd-thumbnail');
  videoElements.forEach((thumbnail) => {
    const saveButton = thumbnail.querySelector('.save-watchlater-button');
    if (saveButton) {
      updateButtonState(thumbnail, saveButton);
    }
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "updateButtons") {
    refreshButtons();
  }
});

// Utilizziamo un MutationObserver per monitorare i cambiamenti nella pagina
// e aggiungere i pulsanti ai nuovi video caricati dinamicamente

// Creazione Observer
const observer = new MutationObserver((mutations) => {
  let hasNewNodes = false;
  
  // Controlliamo se ci sono effettivamente nuovi elementi aggiunti alla pagina
  for (const mutation of mutations) {
    if (mutation.addedNodes.length > 0) {
      hasNewNodes = true;
      break; 
    }
  }

  // Se la pagina ha caricato nuovi elementi, controlliamo se ci sono nuovi video
  if (hasNewNodes) {
    addSaveButtonToVideos();
  }
});

// 2. Diciamo all'osservatore di guardare l'intero body della pagina
observer.observe(document.body, {
  childList: true, // Guarda i figli diretti
  subtree: true    // Guarda anche tutti i sotto-elementi nidificati
});

// 3. Facciamo una prima esecuzione manuale per i video già presenti al caricamento
addSaveButtonToVideos();
