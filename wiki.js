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
  function setCurrent(id) {
    navLinks.forEach((link) => {
      if (link.getAttribute('href') === `#${id}`) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });
  }

  function watchSections() {
    if (!('IntersectionObserver' in window)) {
      setCurrent(sections[0]?.id);
      return;
    }

    const visible = new Set();

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        });

        // The topmost visible section wins, so the marker never jumps ahead.
        const current = sections.find((section) => visible.has(section.id));
        if (current) setCurrent(current.id);
      },
      { rootMargin: '-120px 0px -65% 0px', threshold: 0 }
    );

    sections.forEach((section) => observer.observe(section));
  }

  // ---------- Search ----------
  function applySearch(rawQuery) {
    const query = rawQuery.trim().toLowerCase();

    if (!query) {
      index.forEach(({ section, id }) => {
        section.classList.remove('hidden');
        linkById.get(id)?.classList.remove('hidden');
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
      linkById.get(id)?.classList.toggle('hidden', !hit);
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

  // ---------- Deep links ----------
  function openRequestedSection() {
    const id = window.location.hash.replace('#', '');
    if (!id) return;
    setCurrent(id);
    document.getElementById(id)?.scrollIntoView();
  }

  watchSections();
  setupSearch();
  setupToTop();
  openRequestedSection();
})();
