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

  // Every host a link to a video is handed out on. Wider than HOSTS, which
  // answers a different question — whether the page this runs on is YouTube.
  const LINK_HOSTS = new Set([
    'www.youtube.com',
    'youtube.com',
    'm.youtube.com',
    'music.youtube.com',
    'www.youtube-nocookie.com',
    'youtube-nocookie.com',
    'youtu.be'
  ]);
  const SHORT_LINK_RE = /^\/([\w-]{11})\/?$/;
  const PATH_ID_RE = /^\/(shorts|live|embed|v)\/([\w-]{11})(?:\/|$)/;

  /**
   * A link somebody pasted, or wrote into a file, in whatever form YouTube
   * hands them out: the share button's youtu.be, a Short, a live stream, an
   * embed, with or without the https:// an address bar hides. extractVideoId
   * stays strict because it decides what a page is; this one only has to
   * decide what a link points at.
   *
   * It is still strict where it matters: the host must be YouTube's own and
   * the id must be an id, and what comes back is the canonical watch URL built
   * from that id — never the text that was pasted.
   *
   * @returns {{ id: string, kind: 'short'|null, url: string }
   *   | { error: 'not-link'|'not-youtube'|'not-video' }}
   *   kind is 'short' only when the link says so; any other link can still be
   *   a Short, so it is left for YouTube to answer.
   */
  function parseLink(text) {
    const raw = String(text || '').trim();
    if (!raw || /\s/.test(raw)) return { error: 'not-link' };

    // A scheme is anything before the first colon, as long as it comes before
    // the first slash — so youtube.com/watch?v=… gets https:// in front, and
    // javascript:… keeps the scheme it came with and is turned away below.
    const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(raw);
    let u;
    try {
      u = new URL(hasScheme ? raw : `https://${raw}`);
    } catch {
      return { error: 'not-link' };
    }

    if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: 'not-link' };
    if (!LINK_HOSTS.has(u.hostname)) return { error: 'not-youtube' };

    let id = null;
    let kind = null;

    if (u.hostname === 'youtu.be') {
      id = u.pathname.match(SHORT_LINK_RE)?.[1] || null;
    } else if (u.pathname === '/watch') {
      const v = u.searchParams.get('v') || '';
      id = ID_RE.test(v) ? v : null;
    } else {
      const match = u.pathname.match(PATH_ID_RE);
      if (match) {
        id = match[2];
        if (match[1] === 'shorts') kind = 'short';
      }
    }

    if (!id) return { error: 'not-video' };
    return { id, kind, url: `https://www.youtube.com/watch?v=${id}` };
  }

  return {
    extractVideoId,
    isValidYouTubeUrl,
    isVideoPagePath,
    getKind,
    normalizeUrl,
    isSafeOpenUrl,
    parseLink
  };
})();
