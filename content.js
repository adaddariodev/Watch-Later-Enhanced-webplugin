const successAudio = new Audio(chrome.runtime.getURL('sounds/success.wav'));
successAudio.volume = 0.5;
successAudio.volume = 0.5; // 50% volume

/**
 * Normalize YouTube Watch URL to avoid duplicates caused by extra params.
 * Example: https://www.youtube.com/watch?v=VIDEO_ID
 */
function normalizeYouTubeWatchUrl(url) {
  try {
    const u = new URL(url);
    const v = u.searchParams.get('v');
    if (!v) return url;
    return `https://www.youtube.com/watch?v=${encodeURIComponent(v)}`;
  } catch {
    return url;
  }
}

/**
 * Serialize storage writes to reduce race conditions on rapid clicks.
 */
let saveQueue = Promise.resolve();
function enqueueSave(fn) {
  saveQueue = saveQueue.then(fn, fn);
  return saveQueue;
}

/**
 * Centralized function for video saving (avoids duplicate code)
 */
function saveVideoToWLE(url, title, thumbNode) {
  enqueueSave(
    () =>
      new Promise((resolve) => {
        chrome.storage.local.get({ savedVideos: [], soundEnabled: true }, (data) => {
          const savedVideos = data.savedVideos;
          const isSoundEnabled = data.soundEnabled;

          if (savedVideos.some((v) => v.url === url)) {
            showHud("Already saved!", "warning"); // Optional: show hud if already saved
            resolve();
            return;
          }

          savedVideos.push({ url, title, tags: [] });
          chrome.storage.local.set({ savedVideos }, () => {
            if (isSoundEnabled) {
              successAudio.currentTime = 0;
              successAudio.play().catch((err) => console.log('Audio blocked', err));
            }

            if (thumbNode) {
              thumbNode.classList.add('wle-success-glow');
              setTimeout(() => thumbNode.classList.remove('wle-success-glow'), 800);
            }

            showHud(title, 'success');
            resolve();
          });
        });
      })
  );
}

/**
 * Global Listener updated for Thumbnail and Video Player (capture phase)
 */
document.addEventListener('click', (event) => {
  if (!event.altKey) return;

  // 1. CASE A: Click on a Thumbnail
  const videoLink = event.target.closest('a[href*="/watch?v="]');
  if (videoLink) {
    event.preventDefault();
    event.stopPropagation();
    
    const normalizedUrl = normalizeYouTubeWatchUrl(videoLink.href);
    const thumbNode = videoLink.querySelector('img') || videoLink;
    
    // Get the title from oEmbed (like you originally did)
    fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(normalizedUrl)}&format=json`)
      .then(res => res.json())
      .then(data => saveVideoToWLE(normalizedUrl, data.title, thumbNode))
      .catch(() => saveVideoToWLE(normalizedUrl, "Unknown Title", thumbNode));
    return;
  }

  // 2. CASE B: Click directly on the Video in playback
  const videoPlayer = event.target.closest('#movie_player') || event.target.closest('.html5-video-player');
  if (videoPlayer && window.location.pathname === '/watch') {
    event.preventDefault();
    event.stopPropagation();
    
    const currentUrl = normalizeYouTubeWatchUrl(window.location.href);
    
    // The title is already in the DOM, no need for oEmbed!
    const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string');
    const title = titleEl ? titleEl.textContent : document.title.replace(' - YouTube', '');
    
    saveVideoToWLE(currentUrl, title, videoPlayer);
  }
}, true); // <--- TRUE is important here (capture phase) to "beat" YouTube on time

/**
 * Function to inject the button below the video
 */
function injectWLEButton() {
  if (document.getElementById('wle-action-btn')) return; // Bottone già presente

  // The container of the YouTube actions (Like, Dislike, Share...)
  const actionMenu = document.querySelector('ytd-menu-renderer #top-level-buttons-computed');
  if (!actionMenu) return;

  const btn = document.createElement('button');
  btn.id = 'wle-action-btn';
  btn.className = 'wle-yt-button';
  btn.title = "Add to Watch Later Enhanced";

  const icon = document.createElement('img');
  icon.className = 'wle-yt-icon';
  // Use the path to your icon
  icon.src = chrome.runtime.getURL('icons/48px.png'); 

  const text = document.createElement('span');
  text.innerText = 'Save to Watch Later Enhanced';

  btn.appendChild(icon);
  btn.appendChild(text);

  // Insert it as the first button in the bar
  actionMenu.insertBefore(btn, actionMenu.firstChild);

  // Click handler for the button
  btn.addEventListener('click', () => {
    const currentUrl = normalizeYouTubeWatchUrl(window.location.href);
    const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string');
    const title = titleEl ? titleEl.textContent : document.title.replace(' - YouTube', '');
    
    // Pass the button as "thumbNode" to make it glow green!
    saveVideoToWLE(currentUrl, title, btn);
  });
}

/**
 * YouTube Single Page Application handling.
 * YouTube does not reload the page when switching videos; it navigates internally.
 * We wait for navigation to finish before trying to inject the button.
 */
document.addEventListener('yt-navigate-finish', () => {
  if (window.location.pathname === '/watch') {
    // Il DOM di YT potrebbe metterci un attimo a caricare i bottoni
    const checkInterval = setInterval(() => {
      const actionMenu = document.querySelector('ytd-menu-renderer #top-level-buttons-computed');
      if (actionMenu) {
        clearInterval(checkInterval);
        injectWLEButton();
      }
    }, 500);
    
    // Clear interval after 10 seconds if something goes wrong
    setTimeout(() => clearInterval(checkInterval), 10000); 
  }
});

/**
 * Aggressive Title Extraction Strategy
 * Scans multiple layers of the DOM to ensure the title is NEVER "blank" or "Video"
 */
function extractTitle(target, link, container) {
  if (container) {
    const titleSelectors = [
      '#video-title',
      '#video-title-link',
      '.yt-lockup-metadata-view-model__title',
      'yt-formatted-string.ytd-video-renderer',
      'h3',
    ];

    for (const selector of titleSelectors) {
      const el = container.querySelector(selector);
      if (el) {
        const text = el.getAttribute('title') || el.innerText || el.textContent;
        if (text && text.trim().length > 3) return text.trim();
      }
    }
  }

  const ariaLabel = link.getAttribute('aria-label');
  if (ariaLabel) {
    return ariaLabel.split(' di ')[0].split(' by ')[0].trim();
  }

  const linkTitle = link.getAttribute('title');
  if (linkTitle && linkTitle.trim().length > 0) return linkTitle.trim();

  const img = link.querySelector('img');
  if (img && img.alt) return img.alt.trim();

  return 'YouTube Video';
}

/**
 * Save logic with Sound and Visual Feedback
 */
function saveVideo(video, thumbNode) {
  enqueueSave(
    () =>
      new Promise((resolve) => {
        chrome.storage.local.get({ savedVideos: [], soundEnabled: true }, (data) => {
          const savedVideos = data.savedVideos;
          const isSoundEnabled = data.soundEnabled;

          if (savedVideos.some((v) => v.url === video.url)) {
            resolve();
            return;
          }

          savedVideos.push(video);
          chrome.storage.local.set({ savedVideos }, () => {
            if (isSoundEnabled) {
              successAudio.currentTime = 0;
              successAudio.play().catch((err) => console.log('Audio blocked', err));
            }

            if (thumbNode) {
              thumbNode.classList.add('wle-success-glow');
              setTimeout(() => thumbNode.classList.remove('wle-success-glow'), 800);
            }

            showHud(video.title);
            resolve();
          });
        });
      })
  );
}

let hudTimeout;

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
  hud.classList.remove('wle-loading', 'wle-success', 'wle-warning');
  hud.classList.add(`wle-${state}`);
  hud.classList.add('visible');

  if (hudTimeout) clearTimeout(hudTimeout);

  if (state !== 'loading') {
    hudTimeout = setTimeout(() => {
      hud.classList.remove('visible');
    }, 2000);
  }
}