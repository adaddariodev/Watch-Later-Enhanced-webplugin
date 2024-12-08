// Funzione per aggiungere il pulsante "➕" sotto le thumbnail dei video
function addSaveButtonToVideos() {
  // Seleziona tutte le thumbnail dei video su YouTube
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
      e.stopPropagation(); // Previene l'interazione con altri elementi sottostanti
      e.preventDefault();

      // Trova il link del video e il titolo
      const videoLink = thumbnail.closest('a').href;
      const videoTitleElement = thumbnail.closest('ytd-grid-video-renderer, ytd-video-renderer').querySelector('#video-title');
      const videoTitle = videoTitleElement ? videoTitleElement.innerText : 'Video senza titolo';

      // Salva il video
      saveVideo({ title: videoTitle, url: videoLink });
    });

    // Aggiungi il pulsante alla thumbnail
    thumbnail.appendChild(button);
  });
}

// Funzione per salvare il video in chrome.storage
function saveVideo(video) {
  chrome.storage.local.get({ savedVideos: [] }, (data) => {
    const savedVideos = data.savedVideos;

    // Evita di aggiungere duplicati
    if (savedVideos.some((v) => v.url === video.url)) {
      alert('Questo video è già stato salvato!');
      return;
    }

    savedVideos.push(video);
    chrome.storage.local.set({ savedVideos }, () => {
      alert(`Video salvato: ${video.title}`);
    });
  });
}

// Esegui la funzione ogni 2 secondi per catturare nuovi video durante lo scroll
setInterval(addSaveButtonToVideos, 2000);
