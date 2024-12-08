document.addEventListener("DOMContentLoaded", () => {
  const videoList = document.getElementById("video-list");
  const clearButton = document.getElementById("clear-videos");

  // Load saved videos when the popup is opened
  loadSavedVideos();

  // Function to load saved videos
  function loadSavedVideos() {
    chrome.storage.local.get({ savedVideos: [] }, (data) => {
      const savedVideos = data.savedVideos;
      videoList.innerHTML = "";

      if (savedVideos.length === 0) {
        videoList.innerHTML = "<li>No saved videos</li>";
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

      // Add event listeners to delete individual videos
      document.querySelectorAll(".delete-button").forEach((button) => {
        button.addEventListener("click", (e) => {
          const index = e.target.dataset.index;
          deleteVideo(index);
        });
      });
    });
  }

  // Function to delete a single video
  function deleteVideo(index) {
    chrome.storage.local.get({ savedVideos: [] }, (data) => {
      const savedVideos = data.savedVideos;
      savedVideos.splice(index, 1);
      chrome.storage.local.set({ savedVideos }, () => {
        loadSavedVideos();
        updateAllButtonStates();
        showMessage("Video deleted successfully!");
      });
    });
  }

  // Function to clear all videos
  clearButton.addEventListener("click", () => {
    chrome.storage.local.set({ savedVideos: [] }, () => {
      loadSavedVideos();
      updateAllButtonStates();
      showMessage("All videos have been cleared!");
    });
  });

  // Function to show a temporary message
  function showMessage(text) {
    const messageDiv = document.getElementById("message");
    messageDiv.textContent = text;
    messageDiv.classList.add("show");

    // Hide the message after 3 seconds
    setTimeout(() => {
      messageDiv.classList.remove("show");
    }, 3000);
  }

  // Function to update the state of all buttons on the YouTube page
  function updateAllButtonStates() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { action: "updateButtons" });
    });
  }
});
