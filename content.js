const successAudio = new Audio(chrome.runtime.getURL('sounds/success.wav'));

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
 * Global Listener: Alt+Click saves videos with oEmbed title when possible.
 */
document.addEventListener(
  'click',
  (event) => {
    if (!event.altKey) return;

    const videoLink = event.target.closest('a[href*="/watch?v="]');
    if (!videoLink) return;

    event.preventDefault();
    event.stopPropagation();

    const normalizedUrl = normalizeYouTubeWatchUrl(videoLink.href);

    const container = event.target.closest(
      'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, yt-lockup-view-model, ytd-rich-grid-media, ytd-grid-video-renderer'
    );
    const thumbNode = container
      ? container.querySelector(
          'ytd-thumbnail, .yt-lockup-view-model-wiz__thumbnail, #thumbnail'
        )
      : null;

    chrome.storage.local.get({ savedVideos: [] }, async (data) => {
      const isAlreadySaved = data.savedVideos.some((v) => v.url === normalizedUrl);

      if (isAlreadySaved) {
        showHud('Video already saved!', 'warning');
        if (thumbNode) {
          thumbNode.classList.add('wle-warning-glow');
          setTimeout(() => thumbNode.classList.remove('wle-warning-glow'), 800);
        }
        return;
      }

      showHud('Saving video...', 'loading');

      try {
        const response = await fetch(
          `https://www.youtube.com/oembed?url=${encodeURIComponent(normalizedUrl)}&format=json`
        );

        if (!response.ok) throw new Error('Error occurred while fetching oEmbed data');

        const oembedData = await response.json();
        const cleanTitle = oembedData?.title || 'YouTube Video';

        saveVideo({ title: cleanTitle, url: normalizedUrl }, thumbNode);
      } catch (error) {
        console.warn('Failed to fetch oEmbed data.', error);
        const fallbackTitle = extractTitle(event.target, videoLink, container);
        saveVideo({ title: fallbackTitle, url: normalizedUrl }, thumbNode);
      }
    });
  },
  true
);

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