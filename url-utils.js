// Shared YouTube URL helpers (content script + popup). No plaintext secrets.
const WLEUrl = (() => {
  const HOSTS = new Set(['www.youtube.com', 'youtube.com', 'm.youtube.com']);
  const ID_RE = /^[\w-]{11}$/;
  const SHORTS_RE = /^\/shorts\/([\w-]{11})(?:\/|$)/;

  function extractVideoId(url) {
    try {
      const u = new URL(url, 'https://www.youtube.com');
      if (!HOSTS.has(u.hostname)) return null;

      if (u.pathname === '/watch') {
        const id = u.searchParams.get('v') || '';
        return ID_RE.test(id) ? id : null;
      }

      const shorts = u.pathname.match(SHORTS_RE);
      return shorts ? shorts[1] : null;
    } catch {
      return null;
    }
  }

  function isValidYouTubeUrl(url) {
    return extractVideoId(url) !== null;
  }

  function isVideoPagePath(pathname) {
    return pathname === '/watch' || pathname.startsWith('/shorts/');
  }

  /**
   * 'short' or 'video' — read from the URL a video was saved from, since the
   * stored link is always normalised to the canonical watch form.
   */
  function getKind(url) {
    try {
      const u = new URL(url, 'https://www.youtube.com');
      if (!HOSTS.has(u.hostname)) return null;
      if (SHORTS_RE.test(u.pathname)) return 'short';
      if (u.pathname === '/watch' && ID_RE.test(u.searchParams.get('v') || '')) return 'video';
      return null;
    } catch {
      return null;
    }
  }

  function normalizeUrl(url) {
    const id = extractVideoId(url);
    if (!id) return null;
    return `https://www.youtube.com/watch?v=${id}`;
  }

  function isSafeOpenUrl(url) {
    try {
      const u = new URL(url);
      return u.protocol === 'https:' && extractVideoId(url) !== null;
    } catch {
      return false;
    }
  }

  return {
    extractVideoId,
    isValidYouTubeUrl,
    isVideoPagePath,
    getKind,
    normalizeUrl,
    isSafeOpenUrl
  };
})();
