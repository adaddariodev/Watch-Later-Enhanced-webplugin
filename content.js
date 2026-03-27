const successAudio = new Audio(chrome.runtime.getURL('sounds/success.wav'));

/**
 * Global Listener: Alt Click logic + API data retrieval + Title Extraction
 */
document.addEventListener('click', (event) => {
  if (!event.altKey) return;

  const videoLink = event.target.closest('a[href*="/watch?v="]');

  if (videoLink) {
    event.preventDefault();
    event.stopPropagation();

    const container = event.target.closest('ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, yt-lockup-view-model, ytd-rich-grid-media, ytd-grid-video-renderer');
    const thumbNode = container ? container.querySelector('ytd-thumbnail, .yt-lockup-view-model-wiz__thumbnail, #thumbnail') : null;

    // Check if the video is already saved to prevent unnecessary API calls and provide instant feedback
    chrome.storage.local.get({ savedVideos: [] }, async (data) => {
      const isAlreadySaved = data.savedVideos.some(v => v.url === videoLink.href);
      
      if (isAlreadySaved) {
        // if the video is already saved, we show a warning HUD and a quick glow effect on the thumbnail (if available)
        showHud("Video already saved!", "warning");
        if (thumbNode) {
            thumbNode.classList.add('wle-warning-glow');
            setTimeout(() => thumbNode.classList.remove('wle-warning-glow'), 800);
        }
        return;
      }

      // if the video is not saved, we show a loading HUD and attempt to fetch the title using oEmbed API
      showHud("Saving video...", "loading");

      try {
        const response = await fetch(`https://www.youtube.com/oembed?url=${videoLink.href}&format=json`);
        
        if (!response.ok) throw new Error("Error occurred while fetching oEmbed data");

        const oembedData = await response.json();
        const cleanTitle = oembedData.title;

        // save the video with the clean title from oEmbed and provide visual feedback
        saveVideo({ title: cleanTitle, url: videoLink.href }, thumbNode);

      } catch (error) {
        console.warn("Failed to fetch oEmbed data.", error);
        let fallbackTitle = extractTitleGodMode(event.target, videoLink, container);
        saveVideo({ title: fallbackTitle, url: videoLink.href }, thumbNode);
      }
    });
  }
}, true);

/**
 * Aggressive Title Extraction Strategy
 * Scans multiple layers of the DOM to ensure the title is NEVER "blank" or "Video"
 */
function extractTitle(target, link, container) {
  // Strategy A: Search inside the container for specific title elements (New & Old YT)
  if (container) {
    const titleSelectors = [
      '#video-title', 
      '#video-title-link', 
      '.yt-lockup-metadata-view-model__title', 
      'yt-formatted-string.ytd-video-renderer',
      'h3'
    ];
    
    for (const selector of titleSelectors) {
      const el = container.querySelector(selector);
      if (el) {
        const text = el.getAttribute('title') || el.innerText || el.textContent;
        if (text && text.trim().length > 3) return text.trim();
      }
    }
  }

  // Strategy B: Parse the link's aria-label (YouTube often stores "Title by Channel duration")
  const ariaLabel = link.getAttribute('aria-label');
  if (ariaLabel) {
    // Splits by common delimiters to isolate the title
    return ariaLabel.split(' di ')[0].split(' by ')[0].trim();
  }

  // Strategy C: Check the link's own title attribute
  const linkTitle = link.getAttribute('title');
  if (linkTitle && linkTitle.trim().length > 0) return linkTitle.trim();

  // Strategy D: Check image alt text inside the link
  const img = link.querySelector('img');
  if (img && img.alt) return img.alt.trim();

  return "YouTube Video";
}

/**
 * Save logic with Sound and Visual Feedback
 */
function saveVideo(video, thumbNode) {
  chrome.storage.local.get({ savedVideos: [], soundEnabled: true }, (data) => {
    const savedVideos = data.savedVideos;
    const isSoundEnabled = data.soundEnabled;

    if (savedVideos.some(v => v.url === video.url)) return;

    savedVideos.push(video);
    chrome.storage.local.set({ savedVideos }, () => {
      
      if (isSoundEnabled) {
        successAudio.currentTime = 0;
        successAudio.play().catch(err => console.log("Audio blocked", err));
      }

      if (thumbNode) {
        thumbNode.classList.add('wle-success-glow');
        setTimeout(() => thumbNode.classList.remove('wle-success-glow'), 800);
      }

      showHud(video.title);
    });
  });
}


let hudTimeout; // Global variable to manage HUD timeout

/**
 * Modern HUD UI with State Management
 */
function showHud(message, state = 'success') {
  let hud = document.querySelector('.wle-hud');
  
  if (!hud) {
    hud = document.createElement('div');
    hud.className = 'wle-hud';
    document.body.appendChild(hud);
  }

  hud.textContent = message;
  hud.classList.remove('wle-loading', 'wle-success'); // Cleans previous states
  hud.classList.add(`wle-${state}`);
  hud.classList.add('visible');

  // Clears any previous timers to prevent the HUD from closing mid-animation
  if (hudTimeout) {
    clearTimeout(hudTimeout);
  }

  // If it's in a loading state, the HUD remains fixed.
  // If it's in a success (or other) state, the timer starts to hide it.
  if (state !== 'loading') {
    hudTimeout = setTimeout(() => {
      hud.classList.remove('visible');
    }, 2000); // Hides after 2 seconds
  }
}