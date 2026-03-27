const successAudio = new Audio(chrome.runtime.getURL('sounds/success.wav'));

/**
 * Global Listener: Alt + Click logic
 */
document.addEventListener('click', (event) => {
  if (!event.altKey) return;

  const videoLink = event.target.closest('a[href*="/watch?v="]');

  if (videoLink) {
    event.preventDefault();
    event.stopPropagation();

    const container = event.target.closest('ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, yt-lockup-view-model, ytd-rich-grid-media, ytd-grid-video-renderer');
    const thumbNode = container ? container.querySelector('ytd-thumbnail, .yt-lockup-view-model-wiz__thumbnail, #thumbnail') : null;

    let videoTitle = extractTitleGodMode(event.target, videoLink, container);

    const cleanTitle = videoTitle.replace(/\s*(?:e|and|,)?\s*\d+\s*(?:minuti|minutes|min|secondi|seconds|sec)\b|[\[\(\d]*:\d+[\]\)\s]*/gi, '').trim();

    saveVideo({ title: cleanTitle, url: videoLink.href }, thumbNode);
  }
}, true);

/**
 * Aggressive Title Extraction Strategy
 * Scans multiple layers of the DOM to ensure the title is NEVER "blank" or "Video"
 */
function extractTitleGodMode(target, link, container) {
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

/**
 * Modern HUD UI
 */
function showHud(message, type) {
  let hud = document.querySelector('.wle-hud');
  if (!hud) {
    hud = document.createElement('div');
    hud.className = 'wle-hud';
    document.body.appendChild(hud);
  }
  
  const statusText = type === "success" ? `<span class="wle-hud-title">Saved to List</span>` : "";
  hud.innerHTML = `${statusText}${message}`;
  
  requestAnimationFrame(() => {
    hud.classList.add('visible');
  });
  
  clearTimeout(hud.timer);
  hud.timer = setTimeout(() => {
    hud.classList.remove('visible');
  }, 2500);
}