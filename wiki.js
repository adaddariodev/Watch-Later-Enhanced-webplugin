// ============================================
// USER GUIDE (wiki.html)
// Keeps the page navigable: table of contents highlighting, a search that
// narrows the guide to the matching sections, and a back-to-top button.
// The extension CSP forbids inline styles, so state changes go through
// classes only.
// ============================================
(() => {
  'use strict';

  const CONFIG = {
    SEARCH_DEBOUNCE: 120,
    TO_TOP_AFTER: 400
  };

  const sections = Array.from(document.querySelectorAll('.wiki-section'));
  const navLinks = Array.from(document.querySelectorAll('.wiki-nav-list a'));
  const searchInput = document.getElementById('wiki-search');
  const searchStatus = document.getElementById('wiki-search-status');
  const noResults = document.getElementById('wiki-no-results');
  const clearSearchBtn = document.getElementById('wiki-clear-search');
  const toTopBtn = document.getElementById('wiki-to-top');

  // Searchable text, read once: the guide is static.
  const index = sections.map((section) => ({
    section,
    id: section.id,
    text: (section.textContent || '').toLowerCase()
  }));

  const linkById = new Map(
    navLinks.map((link) => [link.getAttribute('href').replace('#', ''), link])
  );

  function debounce(fn, wait) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  // ---------- Table of contents highlighting ----------
  // The answer is recomputed every frame the page scrolls, and is the same
  // answer most of those frames: one smooth jump down the guide asked for 49
  // attribute writes to make 8 actual changes. Nothing is touched unless the
  // section has really changed.
  let currentId = null;

  function setCurrent(id) {
    if (id === currentId) return;
    currentId = id;

    navLinks.forEach((link) => {
      if (link.getAttribute('href') === `#${id}`) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });
  }

  function headerHeight() {
    const header = document.querySelector('.wiki-header');
    return header ? header.getBoundingClientRect().height : 0;
  }

  /**
   * Where a section counts as reached. It is the stylesheet's own
   * scroll-padding-top — the place an anchored section is parked, under the
   * sticky header — read rather than restated, because a line even a pixel
   * above it would leave a section you have just jumped to sitting one short
   * of its own mark, and the entry above it highlighted instead.
   */
  function readingLine() {
    const parked = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop);
    return (Number.isFinite(parked) ? parked : headerHeight() + 16) + 2;
  }

  /**
   * The section being read: the last one whose heading has reached the line
   * just under the sticky header. Worked out from where the sections are
   * rather than from which of them an observer happens to be holding — two
   * are in its band at once whenever one ends near the top of the screen, and
   * picking the first of those in document order left a deep link marking the
   * section above the one it had just opened. Hidden ones are skipped: a
   * filtered section measures as a zero-height box at the top of the page,
   * which every rule of this kind reads as "reached".
   */
  function currentSection() {
    const visible = sections.filter((s) => !s.classList.contains('hidden'));
    if (!visible.length) return null;

    // The last section or two never reach the line: the page runs out of
    // scroll before their headings get that far up the screen, so by the rule
    // below they could never be the answer and the marker stopped one short of
    // the end of the guide. Hitting the bottom is what marks the last of them.
    // Only when there is a bottom to hit — a guide filtered down to one screen
    // is not scrolled to its end, it simply fits.
    const scrollable = document.documentElement.scrollHeight > window.innerHeight + 1;
    const atBottom = window.scrollY + window.innerHeight
      >= document.documentElement.scrollHeight - 2;
    if (scrollable && atBottom) return visible[visible.length - 1];

    const line = readingLine();
    let current = null;

    for (const section of visible) {
      if (section.getBoundingClientRect().top - line > 1) break;
      current = section;
    }

    return current || visible[0];
  }

  function markCurrentSection() {
    const current = currentSection();
    if (current) setCurrent(current.id);
  }

  /**
   * The scroll itself, throttled to a frame, rather than an
   * IntersectionObserver watching a band. The observer only fires when a
   * section crosses that band, and this page scrolls smoothly: jumping to a
   * section animates for the best part of a second, the last crossing happens
   * before the animation settles, and nothing re-asks afterwards — which left
   * the contents marking the section above the one you had just opened. A
   * scroll listener is told when the scrolling stops.
   */
  function watchSections() {
    let frame = null;

    const schedule = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        markCurrentSection();
      });
    };

    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    markCurrentSection();
  }

  // ---------- Search ----------
  function applySearch(rawQuery) {
    const query = rawQuery.trim().toLowerCase();

    if (!query) {
      index.forEach(({ section, id }) => {
        section.classList.remove('hidden');
        // The list item, not the link: on narrow screens the items are flex
        // children, and an emptied one still claims its gap.
        linkById.get(id)?.parentElement?.classList.remove('hidden');
      });
      noResults?.classList.add('hidden');
      if (searchStatus) searchStatus.textContent = '';
      return;
    }

    let matches = 0;

    index.forEach(({ section, id, text }) => {
      const hit = text.includes(query);
      if (hit) matches += 1;
      section.classList.toggle('hidden', !hit);
      linkById.get(id)?.parentElement?.classList.toggle('hidden', !hit);
    });

    noResults?.classList.toggle('hidden', matches > 0);
    if (searchStatus) {
      searchStatus.textContent = matches > 0
        ? `${matches} section${matches === 1 ? '' : 's'} match`
        : '';
    }
  }

  function setupSearch() {
    if (!searchInput) return;

    searchInput.addEventListener('input', debounce(() => applySearch(searchInput.value), CONFIG.SEARCH_DEBOUNCE));

    searchInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      searchInput.value = '';
      applySearch('');
    });

    clearSearchBtn?.addEventListener('click', () => {
      searchInput.value = '';
      applySearch('');
      searchInput.focus();
    });

    // A section reached from the table of contents must never stay filtered out.
    navLinks.forEach((link) => {
      link.addEventListener('click', () => {
        if (!searchInput.value) return;
        searchInput.value = '';
        applySearch('');
      });
    });
  }

  // ---------- Back to top ----------
  function setupToTop() {
    if (!toTopBtn) return;

    const update = () => {
      toTopBtn.classList.toggle('visible', window.scrollY > CONFIG.TO_TOP_AFTER);
    };

    window.addEventListener('scroll', update, { passive: true });
    toTopBtn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    update();
  }

  // ---------- Sticky header offset ----------
  // The header grows when the search box wraps onto its own row, so the space
  // anchors have to clear cannot be a constant.
  function trackHeaderHeight() {
    const header = document.querySelector('.wiki-header');
    if (!header) return;

    const apply = () => {
      const height = Math.round(header.getBoundingClientRect().height);
      if (height > 0) {
        document.documentElement.style.setProperty('--header-height', `${height}px`);
      }
    };

    apply();

    if ('ResizeObserver' in window) new ResizeObserver(apply).observe(header);
    else window.addEventListener('resize', apply);
  }

  // ---------- Deep links ----------
  function openRequestedSection() {
    const id = window.location.hash.replace('#', '');
    if (!id) return;

    const target = document.getElementById(id);
    if (!target) return;

    // Marked at once so the contents is right before the smooth scroll has
    // travelled; the scroll listener takes it from there and settles on the
    // same section.
    setCurrent(id);
    target.scrollIntoView();
  }

  trackHeaderHeight();
  watchSections();
  setupSearch();
  setupToTop();
  openRequestedSection();
})();
