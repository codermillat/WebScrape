(function() {
  'use strict';

  async function $(id) { return document.getElementById(id); }

  async function load() {
    const { geminiApiKey, doApiKey, aiEnabled, aiConsentGranted } = await chrome.storage.local.get(['geminiApiKey', 'doApiKey', 'aiEnabled', 'aiConsentGranted']);
    (await $('geminiKey')).value = geminiApiKey || '';
    (await $('doKey')).value = doApiKey || '';
    (await $('enableAi')).checked = !!aiEnabled;
  }

  async function save() {
    const geminiKey = (await $('geminiKey')).value.trim();
    const doKey = (await $('doKey')).value.trim();
    const enableAi = (await $('enableAi')).checked;
    await chrome.storage.local.set({ geminiApiKey: geminiKey || undefined, doApiKey: doKey || undefined, aiEnabled: enableAi });
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

