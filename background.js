/* eslint-disable no-undef */
// MV3 service worker: downloads + options only (LLM features removed)

// PDF.js setup for PDF text extraction in background
try {
  importScripts('lib/pdf.js');
  if (typeof pdfjsLib !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
    // Service worker cannot spawn dedicated Workers reliably; run pdf.js in same thread.
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.js');
    try { pdfjsLib.GlobalWorkerOptions.disableWorker = true; } catch(_) {}
  }
} catch (e) {
  // pdf.js not available; PDF extraction will be unavailable
}

// Offscreen document helpers (to run pdf.js with a DOM safely)
async function ensureOffscreenDocument() {
  if (!chrome.offscreen || !chrome.offscreen.createDocument) return false;
  try {
    if (chrome.offscreen.hasDocument) {
      const has = await chrome.offscreen.hasDocument();
      if (has) return true;
    }
  } catch (_) {}
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.DOM_SCRAPING],
      justification: 'Extract PDF text using pdf.js in a DOM context'
    });
    return true;
  } catch (e) {
    console.warn('[WTE] offscreen.createDocument failed', e);
    return false;
  }
}

async function closeOffscreenIfIdle() {
  try {
    if (chrome.offscreen && chrome.offscreen.closeDocument) {
      await chrome.offscreen.closeDocument();
    }
  } catch (_) {}
}

async function extractPdfTextViaOffscreen(url) {
  const ok = await ensureOffscreenDocument();
  if (!ok) throw new Error('offscreen unavailable');
  const resp = await chrome.runtime.sendMessage({ type: 'offscreen:extractPdfText', url });
  if (!resp || !resp.ok || !resp.text) throw new Error(resp?.error || 'offscreen extract failed');
  return resp.text;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'downloadText') return;
  (async () => {
    try {
      const text = typeof msg.text === 'string' ? msg.text : '';
      const dataUrl = 'data:text/plain;charset=utf-8,' + encodeURIComponent(text);
      await chrome.downloads.download({
        url: dataUrl,
        filename: msg.filename || 'webtext.txt',
        saveAs: false
      });
      sendResponse({ ok: true });
    } catch (e) {
      sendResponse({ ok: false, error: e?.message || 'download failed' });
    }
  })();
  return true; // async
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'dumpAllFramesText') return;
  (async () => {
    try {
      const tabId = sender?.tab?.id;
      if (!tabId) throw new Error('no tab');
      const results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => {
          try {
            const txt = (document.body && (document.body.innerText || document.body.textContent)) || '';
            return txt.replace(/\r\n?/g, '\n');
          } catch (e) {
            return '';
          }
        }
      });
      const combined = (results || []).map(r => r?.result || '').filter(Boolean).join('\n');
      sendResponse({ ok: true, text: combined });
    } catch (e) {
      sendResponse({ ok: false, error: e?.message || 'dumpAllFramesText failed' });
    }
  })();
  return true; // async
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'openOptionsPage') return;
  (async () => {
    try {
      if (chrome.runtime.openOptionsPage) {
        await chrome.runtime.openOptionsPage();
      } else {
        const url = chrome.runtime.getURL('options.html');
        await chrome.tabs.create({ url });
      }
      sendResponse({ ok: true });
    } catch (e) {
      sendResponse({ ok: false, error: e?.message || 'openOptionsPage failed' });
    }
  })();
  return true; // async
});

// Link navigation + scraping helpers (MV3 service worker)
async function waitForTabComplete(tabId, timeout = 45000) {
  return new Promise((resolve, reject) => {
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('tab load timeout'));
    }, timeout);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function waitForContentReady(tabId, tries = 20, delay = 500) {
  for (let i = 0; i < tries; i++) {
    try {
      const resp = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
      if (resp && resp.success) return;
    } catch (_) {}
    await new Promise(r => setTimeout(r, delay));
  }
  throw new Error('content script not ready');
}

function makeFileNameFromUrl(url, title) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./i, '');
    const path = u.pathname.replace(/\/+/g, '_').replace(/^_+|_+$/g, '') || 'index';
    const base = (title || path).slice(0, 80).replace(/[^\w\-]+/g, '_');
    const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    return `${host}_${base}_raw_${ts}.txt`;
  } catch (_) {
    const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    return `page_${ts}.txt`;
  }
}

async function extractPdfTextFromUrl(url) {
  try {
    console.log('[WTE] extractPdfTextFromUrl start', url);

    // Prefer offscreen (DOM) for pdf.js to avoid "document is not defined" in SW
    if (chrome.offscreen) {
      try {
        const text = await extractPdfTextViaOffscreen(url);
        console.log('[WTE] extractPdfTextFromUrl via offscreen success', { length: text.length });
        return text;
      } catch (e) {
        console.warn('[WTE] offscreen extract failed, falling back to SW pdf.js:', e?.message || e);
      }
    }

    // Fallback: run pdf.js in service worker (disable worker)
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    if (typeof pdfjsLib === 'undefined') throw new Error('pdf.js not available in SW');
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
    const text = out.join('\n').trim();
    console.log('[WTE] extractPdfTextFromUrl SW success', { pages: pdf.numPages, length: text.length });
    return text;
  } catch (e) {
    console.error('[WTE] extractPdfTextFromUrl error', e);
    throw new Error(`PDF extract failed: ${e?.message || String(e)}`);
  }
}

async function openAndScrape(url, opts = {}) {
  const { active = false, closeAfter = true, includeHidden = true, autoScroll = true } = opts;

  // Short-circuit for PDFs: extract text via pdf.js; fallback to saving original PDF
  if (((() => { try { const u = new URL(url); return !!(u.pathname && u.pathname.toLowerCase().endsWith('.pdf')); } catch (_) { return false; } })())) {
    try {
      const text = await extractPdfTextFromUrl(url);
      const name = makeFileNameFromUrl(url, '').replace(/_raw_/, '_pdf_text_').replace(/\.txt$/,'') + '.txt';
      const dataUrl = 'data:text/plain;charset=utf-8,' + encodeURIComponent((text ? text + '\n\n' : '') + `Source: ${url}`);
      await chrome.downloads.download({ url: dataUrl, filename: name, saveAs: false });
      return { ok: true, tabId: null, name };
    } catch (e) {
      const namePdf = makeFileNameFromUrl(url, '').replace(/_raw_/, '_pdf_').replace(/\.txt$/,'') + '.pdf';
      await chrome.downloads.download({ url, filename: namePdf, saveAs: false });
      return { ok: true, tabId: null, name: namePdf, fallback: true, error: e?.message || String(e) };
    }
  }

  const tab = await chrome.tabs.create({ url, active });
  const tabId = tab.id;
  try {
    await waitForTabComplete(tabId);
    await waitForContentReady(tabId);
    const resp = await chrome.tabs.sendMessage(tabId, {
      action: 'extractStructured',
      includeHidden,
      excludeBoilerplate: false,
      includeMetadata: true,
      autoScroll
    });
    if (!resp || !resp.success) throw new Error(resp?.error || 'extractStructured failed');
    const text = (resp.text || '').trim();
    const name = makeFileNameFromUrl(url, resp.title || '');
    const dataUrl = 'data:text/plain;charset=utf-8,' + encodeURIComponent((text ? text + '\n\n' : '') + `Source: ${url}`);
    await chrome.downloads.download({ url: dataUrl, filename: name, saveAs: false });
    return { ok: true, tabId, name };
  } catch (e) {
    return { ok: false, tabId, error: e?.message || String(e) };
  } finally {
    if (closeAfter) {
      try { await chrome.tabs.remove(tabId); } catch (_) {}
    }
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'extractPdfText') return;
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
      sendResponse({ ok: false, error: e?.message || 'extractPdfText failed' });
    }
  })();
  return true; // async
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || (msg.type !== 'scrapeUrl' && msg.type !== 'scrapeUrlBatch')) return;
  (async () => {
    try {
      if (msg.type === 'scrapeUrl') {
        const r = await openAndScrape(msg.url, msg.options || {});
        sendResponse(r);
        return;
      }
      const urls = Array.isArray(msg.urls) ? msg.urls.slice(0, 10) : [];
      const results = [];
      for (const u of urls) {
        const r = await openAndScrape(u, msg.options || {});
        results.push({ url: u, ...r });
      }
      sendResponse({ ok: true, results });
    } catch (e) {
      sendResponse({ ok: false, error: e?.message || 'scrape failed' });
    }
  })();
  return true; // async
});
