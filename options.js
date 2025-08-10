(function() {
  'use strict';

  function $(id) { return document.getElementById(id); }

  async function load() {
    try {
      const {
        ui_fullPage,
        ui_excludeBoilerplate,
        ui_includeMetadata
      } = await chrome.storage.local.get([
        'ui_fullPage',
        'ui_excludeBoilerplate',
        'ui_includeMetadata'
      ]);

      const full = $('optFullPage');
      const excl = $('optExcludeBoiler');
      const meta = $('optIncludeMetadata');

      if (full) full.checked = !!ui_fullPage;
      if (excl) excl.checked = !!ui_excludeBoilerplate;
      if (meta) meta.checked = typeof ui_includeMetadata === 'boolean' ? ui_includeMetadata : true;
    } catch (e) {
      console.warn('Options load failed:', e);
    }
  }

  async function save() {
    try {
      const full = $('optFullPage')?.checked ?? false;
      const excl = $('optExcludeBoiler')?.checked ?? false;
      const meta = $('optIncludeMetadata')?.checked ?? true;

      await chrome.storage.local.set({
        ui_fullPage: full,
        ui_excludeBoilerplate: excl,
        ui_includeMetadata: meta
      });

      const status = $('status');
      if (status) {
        status.textContent = 'Saved successfully';
        setTimeout(() => { status.textContent = ''; }, 2000);
      }
    } catch (e) {
      console.error('Options save failed:', e);
      const status = $('status');
      if (status) {
        status.style.color = '#c62828';
        status.textContent = 'Save failed';
        setTimeout(() => { status.textContent = ''; status.style.color = '#2d8f42'; }, 2500);
      }
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    await load();
    $('saveBtn')?.addEventListener('click', save);
  });
})();
