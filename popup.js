document.addEventListener("DOMContentLoaded", () => {
  const videoList = document.getElementById("video-list");
  const clearButton = document.getElementById("clear-videos");

  // Carica i video salvati al caricamento del popup
  loadSavedVideos();

  // Funzione per caricare i video salvati
  function loadSavedVideos() {
    chrome.storage.local.get({ savedVideos: [] }, (data) => {
      const savedVideos = data.savedVideos;
      videoList.innerHTML = "";

      if (savedVideos.length === 0) {
        videoList.innerHTML = "<li>Nessun video salvato</li>";
        return;
      }

      savedVideos.forEach((video, index) => {
        const listItem = document.createElement("li");
        listItem.innerHTML = `
          <span>${index + 1}. <a href="${video.url}" target="_blank">${video.title}</a></span>
          <button data-index="${index}" class="delete-button">❌</button>
        `;
        videoList.appendChild(listItem);
      });

      // Aggiungi eventi per eliminare singoli video
      document.querySelectorAll(".delete-button").forEach((button) => {
        button.addEventListener("click", (e) => {
          const index = e.target.dataset.index;
          deleteVideo(index);
        });
      });
    });
  }

  // Funzione per eliminare un singolo video
  function deleteVideo(index) {
    chrome.storage.local.get({ savedVideos: [] }, (data) => {
      const savedVideos = data.savedVideos;
      savedVideos.splice(index, 1);
      chrome.storage.local.set({ savedVideos }, () => {
        loadSavedVideos();
        showMessage("Video eliminato correttamente!");
      });
    });
  }

  // Funzione per cancellare tutti i video
  clearButton.addEventListener("click", () => {
    if (confirm("Sei sicuro di voler cancellare tutti i video salvati?")) {
      chrome.storage.local.set({ savedVideos: [] }, () => {
        loadSavedVideos();
        showMessage("Tutti i video sono stati cancellati!");
      });
    }
  });

  // Funzione per mostrare un messaggio temporaneo
  function showMessage(text) {
    const messageDiv = document.getElementById("message");
    messageDiv.textContent = text;
    messageDiv.classList.add("show");

    // Nasconde il messaggio dopo 3 secondi
    setTimeout(() => {
      messageDiv.classList.remove("show");
    }, 3000);
  }

  function deleteVideo(index) {
    chrome.storage.local.get({ savedVideos: [] }, (data) => {
      const savedVideos = data.savedVideos;
      savedVideos.splice(index, 1);
      chrome.storage.local.set({ savedVideos }, () => {
        loadSavedVideos();
        updateAllButtonStates();
        showMessage("Video eliminato correttamente!");
      });
    });
  }
    
  // Funzione per cancellare tutti i video senza il secondo avviso
  clearButton.addEventListener("click", () => {
    chrome.storage.local.set({ savedVideos: [] }, () => {
      loadSavedVideos();
      updateAllButtonStates();
      showMessage("Tutti i video sono stati cancellati!");
    });
  });

  // Funzione per aggiornare lo stato di tutti i pulsanti sulla pagina YouTube
  function updateAllButtonStates() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { action: "updateButtons" });
    });
  }
  
});
