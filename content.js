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
        alert("Errore: Impossibile trovare il link del video.");
        return;
      }

      const videoUrl = videoLinkElement.href;

      // Ricerca più robusta per il titolo del video
      const videoTitleElement = thumbnail.closest('ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer')?.querySelector('#video-title, #video-title-link');
      const videoTitle = videoTitleElement ? videoTitleElement.innerText.trim() : 'Video senza titolo';

      saveVideo({ title: videoTitle, url: videoUrl }, button);
    });

    // Aggiungi il pulsante alla thumbnail
    thumbnail.appendChild(button);
  });
}

function saveVideo(video, button) {
  chrome.storage.local.get({ savedVideos: [] }, (data) => {
    const savedVideos = data.savedVideos;

    // Evita di aggiungere duplicati
    if (savedVideos.some((v) => v.url === video.url)) {
      alert('Questo video è già stato salvato!');
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

// Esegui la funzione ogni 2 secondi per catturare nuovi video durante lo scroll
setInterval(addSaveButtonToVideos, 2000);
