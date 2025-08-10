/* eslint-disable no-undef */
// Offscreen document script to run pdf.js in a DOM context

(function () {
  'use strict';

  // Configure pdf.js to use the bundled worker
  try {
    if (typeof pdfjsLib !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.js');
      // In offscreen (DOM) we can allow real worker; keep default (disableWorker = false)
      // pdfjsLib.GlobalWorkerOptions.disableWorker = false; // default
      // Optionally set cMap, if needed:
      // pdfjsLib.GlobalWorkerOptions.cMapUrl = chrome.runtime.getURL('lib/cmaps/');
      // pdfjsLib.GlobalWorkerOptions.cMapPacked = true;
    }
  } catch (e) {
    // ignore
  }

  async function extractPdfTextFromUrl(url) {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    if (typeof pdfjsLib === 'undefined') throw new Error('pdf.js not available');
    const loadingTask = pdfjsLib.getDocument({ data: buf });
    const pdf = await loadingTask.promise;
    const out = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const strings = content.items.map(it => (it.str || '').trim()).filter(Boolean);
      if (strings.length) {
        out.push(`-- Page ${p} --`);
        out.push(strings.join(' '));
        out.push('');
      }
    }
    return out.join('\n').trim();
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== 'offscreen:extractPdfText') return;
    (async () => {
      try {
        const url = msg.url || '';
        if (!url) throw new Error('Not a PDF URL');
        try {
          const u = new URL(url);
          if (!u.pathname || !u.pathname.toLowerCase().endsWith('.pdf')) throw new Error('Not a PDF URL');
        } catch (_) {
          throw new Error('Not a PDF URL');
        }
        const text = await extractPdfTextFromUrl(url);
        sendResponse({ ok: true, text });
      } catch (e) {
        sendResponse({ ok: false, error: e?.message || String(e) });
      }
    })();
    return true; // async
  });

  // Optional: handle a request to close the offscreen document
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'offscreen:closeIfIdle') {
      // Extensions can programmatically close offscreen docs from the service worker.
      // No-op here; background will call chrome.offscreen.closeDocument() when appropriate.
    }
  });
})();
