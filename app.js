/* LotS.github.io — theme, language and catalogue filtering.
   No dependencies, no build step needed for this file. */
(function () {
  'use strict';

  var root = document.documentElement;
  var metaTheme = document.querySelector('meta[name="theme-color"]');

  function paintThemeColor(theme) {
    if (metaTheme) metaTheme.setAttribute('content', theme === 'light' ? '#f6f7f9' : '#07090d');
  }

  /* ---------- theme ---------- */
  var themeBtn = document.getElementById('btnTheme');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      root.setAttribute('data-theme', next);
      paintThemeColor(next);
      try { localStorage.setItem('lots.theme', next); } catch (e) {}
      themeBtn.setAttribute('aria-label', next === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
    });
    themeBtn.setAttribute('aria-label',
      root.getAttribute('data-theme') === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
  }

  /* ---------- language ---------- */
  function syncSearchCopy() {
    var search = document.getElementById('q');
    if (!search) return;
    var zh = root.getAttribute('data-lang') === 'zh';
    search.placeholder = zh ? '搜索应用' : 'Search apps';
    search.setAttribute('aria-label', zh ? '搜索应用' : 'Search apps');
  }

  var langBtn = document.getElementById('btnLang');
  if (langBtn) {
    langBtn.addEventListener('click', function () {
      var next = root.getAttribute('data-lang') === 'zh' ? 'en' : 'zh';
      root.setAttribute('data-lang', next);
      root.setAttribute('lang', next === 'zh' ? 'zh-Hans' : 'en');
      try { localStorage.setItem('lots.lang', next); } catch (e) {}
      langBtn.setAttribute('aria-label', next === 'zh' ? '切换到英文 / Switch to English' : '切换到华文 / Switch to Chinese');
      syncSearchCopy();
    });
    langBtn.setAttribute(
      'aria-label',
      root.getAttribute('data-lang') === 'zh'
        ? '切换到英文 / Switch to English'
        : '切换到华文 / Switch to Chinese'
    );
  }

  syncSearchCopy();

  /* ---------- year ---------- */
  var year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());

  /* ---------- catalogue filter + search ---------- */
  var cards = Array.prototype.slice.call(document.querySelectorAll('[data-tags]'));
  var filterBar = document.getElementById('filters');
  var search = document.getElementById('q');
  var empty = document.getElementById('empty');

  if (cards.length && (filterBar || search)) {
    var activeTag = 'all';

    function apply() {
      var q = (search && search.value ? search.value : '').trim().toLowerCase();
      var shown = 0;

      cards.forEach(function (card) {
        var tags = (card.getAttribute('data-tags') || '').split(/\s+/);
        var tagOk = activeTag === 'all' || tags.indexOf(activeTag) !== -1;
        var textOk = !q || (card.textContent || '').toLowerCase().indexOf(q) !== -1;
        var visible = tagOk && textOk;
        card.hidden = !visible;
        if (visible) shown++;
      });

      if (empty) empty.hidden = shown !== 0;
    }

    if (filterBar) {
      var buttons = Array.prototype.slice.call(filterBar.querySelectorAll('button'));
      buttons.forEach(function (btn) {
        btn.addEventListener('click', function () {
          activeTag = btn.getAttribute('data-filter') || 'all';
          buttons.forEach(function (b) { b.setAttribute('aria-pressed', String(b === btn)); });
          apply();
        });
      });
    }

    if (search) {
      search.addEventListener('input', apply);
      search.addEventListener('search', apply);
    }

    apply();
  }
})();
