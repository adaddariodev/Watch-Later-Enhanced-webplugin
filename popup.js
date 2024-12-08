document.addEventListener("DOMContentLoaded", () => {
  const videoList = document.getElementById("video-list");

  chrome.storage.local.get({ savedVideos: [] }, (data) => {
    const savedVideos = data.savedVideos;

    videoList.innerHTML = "";
    savedVideos.forEach((video, index) => {
      const listItem = document.createElement("li");
      listItem.innerHTML = `
        <span>${index + 1}. <a href="${video.url}" target="_blank">${video.title}</a></span>
        <button data-index="${index}" class="delete-button">❌</button>
      `;
      videoList.appendChild(listItem);
    });

    // Aggiungi evento per eliminare i video
    document.querySelectorAll(".delete-button").forEach((button) => {
      button.addEventListener("click", (e) => {
        const index = e.target.dataset.index;
        deleteVideo(index);
      });
    });
  });
});

function deleteVideo(index) {
  chrome.storage.local.get({ savedVideos: [] }, (data) => {
    const savedVideos = data.savedVideos;
    savedVideos.splice(index, 1);
    chrome.storage.local.set({ savedVideos }, () => {
      location.reload();
    });
  });
}
