// ============================================
// FLOATING PLAYER — THE PLAYER'S OWN API (page world)
//
// Runs in the page's world inside the YouTube embed of the floating player,
// because that is the only world that sees the player's methods: volume,
// speed, quality, seeking, loading another video. A content script cannot
// call them; it asks through a DOM event and gets the answer the same way,
// as JSON text, the one thing that crosses between the two worlds intact.
//
// Only inside an embed whose parent is an extension page: the manifest limits
// it to embeds carrying the wle_float marker, and this checks the parent too.
// ============================================
(() => {
  'use strict';

  if (window === window.top) return;
  if (!String(location.ancestorOrigins?.[0] || '').startsWith('chrome-extension://')) return;

  const player = () => document.getElementById('movie_player');

  /** A player method, if this player has it; undefined otherwise. */
  function call(name, ...args) {
    const p = player();
    if (typeof p?.[name] !== 'function') return undefined;
    try {
      return p[name](...args);
    } catch (error) {
      console.info(`WLE: the player refused ${name} —`, error?.message);
      return undefined;
    }
  }

  const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
  const list = (value) => (Array.isArray(value) ? value.slice(0, 20) : []);

  // The quality asked for. The player only says what it is playing — 720p,
  // never "auto" — so a menu set to Auto would otherwise show a fixed level.
  let qualityWanted = 'auto';

  const COMMANDS = {
    play: () => call('playVideo'),
    pause: () => call('pauseVideo'),
    seek: (seconds) => call('seekTo', Math.max(0, num(seconds)), true),
    seekBy: (delta) => call('seekTo', Math.max(0, num(call('getCurrentTime')) + num(delta)), true),
    volume: (level) => {
      const value = Math.min(100, Math.max(0, Math.round(num(level, 100))));
      call('setVolume', value);
      if (value > 0) call('unMute');
    },
    mute: (on) => call(on ? 'mute' : 'unMute'),
    // YouTube's menu also takes custom speeds between the ones it lists, so
    // the list only bounds it.
    rate: (rate) => {
      const rates = list(call('getAvailablePlaybackRates')).filter((r) => Number.isFinite(r));
      const wanted = num(rate, 1);
      if (rates.length && (wanted < Math.min(...rates) || wanted > Math.max(...rates))) return;
      call('setPlaybackRate', wanted);
    },
    // setPlaybackQualityRange is the call YouTube's own menu makes; the
    // older setPlaybackQuality is kept as a second try. 'lowest' is the last
    // real level: the player lists them best first, then 'auto'.
    quality: (level) => {
      const levels = list(call('getAvailableQualityLevels'));
      let wanted = String(level || '');
      if (wanted === 'auto') {
        qualityWanted = 'auto';
        call('setPlaybackQualityRange', 'auto', 'auto');
        return;
      }
      if (wanted === 'lowest') wanted = levels.filter((q) => q !== 'auto').at(-1) || '';
      if (!levels.includes(wanted)) return;
      qualityWanted = wanted;
      call('setPlaybackQualityRange', wanted, wanted);
      call('setPlaybackQuality', wanted);
    },
    load: (arg) => {
      const videoId = String(arg?.videoId || '');
      if (!/^[\w-]{11}$/.test(videoId)) return;
      hearErrors();
      call('loadVideoById', { videoId, startSeconds: Math.max(0, num(arg?.start)) });
    }
  };

  /**
   * A video YouTube will not play in an embed (age-restricted, embedding
   * turned off, private) says so through the player's own error event: 100,
   * 101, 150 and the like. Passed on at once, rather than left for the
   * isolated world to notice the video never started.
   */
  let heard = null;
  function hearErrors() {
    const p = player();
    if (!p || heard === p || typeof p.addEventListener !== 'function') return;
    heard = p;
    try {
      p.addEventListener('onError', (code) => {
        document.dispatchEvent(new CustomEvent('wle-float-error', { detail: JSON.stringify({ code: num(code?.data ?? code) }) }));
      });
    } catch {
      // A player without its event API: the isolated world's timer still covers it.
    }
  }

  function state() {
    const p = player();
    if (!p || typeof p.getCurrentTime !== 'function') return null;

    const data = call('getVideoData') || {};
    const playerState = call('getPlayerState');
    return {
      videoId: typeof data.video_id === 'string' ? data.video_id : null,
      title: typeof data.title === 'string' ? data.title : '',
      author: typeof data.author === 'string' ? data.author : '',
      time: num(call('getCurrentTime')),
      duration: num(call('getDuration')),
      // Buffering counts as playing: it is about to.
      playing: playerState === 1 || playerState === 3,
      volume: num(call('getVolume'), 100),
      muted: Boolean(call('isMuted')),
      rate: num(call('getPlaybackRate'), 1),
      rates: list(call('getAvailablePlaybackRates')).filter((r) => Number.isFinite(r)),
      quality: qualityWanted === 'auto' ? 'auto' : String(call('getPlaybackQuality') || 'auto'),
      qualities: list(call('getAvailableQualityLevels')).filter((q) => typeof q === 'string')
    };
  }

  document.addEventListener('wle-float-command', (event) => {
    let request;
    try {
      request = JSON.parse(String(event.detail));
    } catch {
      return;
    }

    if (Object.hasOwn(COMMANDS, String(request?.cmd))) COMMANDS[request.cmd](request.arg);

    document.dispatchEvent(new CustomEvent('wle-float-answer', {
      detail: JSON.stringify({ id: request?.id, state: state() })
    }));
  });
})();
