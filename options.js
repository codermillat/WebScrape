(function() {
  'use strict';

  async function $(id) { return document.getElementById(id); }

  async function load() {
    const { geminiApiKey, doApiKey, aiEnabled, aiConsentGranted, ui_fullPage, ui_excludeBoilerplate, ui_includeMetadata } = await chrome.storage.local.get(['geminiApiKey', 'doApiKey', 'aiEnabled', 'aiConsentGranted', 'ui_fullPage', 'ui_excludeBoilerplate', 'ui_includeMetadata']);
    (await $('geminiKey')).value = geminiApiKey || '';
    (await $('doKey')).value = doApiKey || '';
    (await $('enableAi')).checked = !!aiEnabled;
    (await $('optFullPage')).checked = !!ui_fullPage;
    (await $('optExcludeBoiler')).checked = !!ui_excludeBoilerplate;
    (await $('optIncludeMetadata')).checked = typeof ui_includeMetadata === 'boolean' ? ui_includeMetadata : true;
  }

  async function save() {
    const geminiKey = (await $('geminiKey')).value.trim();
    const doKey = (await $('doKey')).value.trim();
    const enableAi = (await $('enableAi')).checked;
    const ui_fullPage = (await $('optFullPage')).checked;
    const ui_excludeBoilerplate = (await $('optExcludeBoiler')).checked;
    const ui_includeMetadata = (await $('optIncludeMetadata')).checked;
    await chrome.storage.local.set({ geminiApiKey: geminiKey || undefined, doApiKey: doKey || undefined, aiEnabled: enableAi, ui_fullPage, ui_excludeBoilerplate, ui_includeMetadata });
    const status = await $('status');
    status.textContent = 'Saved successfully';
    setTimeout(() => status.textContent = '', 2000);
  }

  async function clearKeys() {
    await chrome.storage.local.set({ geminiApiKey: undefined, doApiKey: undefined });
    (await $('geminiKey')).value = '';
    (await $('doKey')).value = '';
    const status = await $('status');
    status.textContent = 'Keys cleared';
    setTimeout(() => status.textContent = '', 2000);
  }

  document.addEventListener('DOMContentLoaded', async () => {
    await load();
    (await $('saveBtn')).addEventListener('click', save);
    (await $('clearBtn')).addEventListener('click', clearKeys);
  });
})();

