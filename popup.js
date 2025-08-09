// Popup script for Web Text Extractor
(function() {
  'use strict';

  // DOM elements with safe getter
  function safeGetElement(id) {
    const element = document.getElementById(id);
    if (!element) {
      console.warn(`Element not found: ${id}`);
    }
    return element;
  }

  const elements = {
    get extractBtn() { return safeGetElement('extractBtn'); },
    get settingsBtn() { return safeGetElement('settingsBtn'); },
    get copyBtn() { return safeGetElement('copyBtn'); },
    get downloadBtn() { return safeGetElement('downloadBtn'); },
    get clearBtn() { return safeGetElement('clearBtn'); },
    get extractedText() { return safeGetElement('extractedText'); },
    get loadingDiv() { return safeGetElement('loadingDiv'); },
    get errorDiv() { return safeGetElement('errorDiv'); },
    get errorMessage() { return safeGetElement('errorMessage'); },
    get contentDiv() { return safeGetElement('contentDiv'); },
    get welcomeDiv() { return safeGetElement('welcomeDiv'); },
    get settingsDiv() { return safeGetElement('settingsDiv'); },
    get wordCount() { return safeGetElement('wordCount'); },
    get charCount() { return safeGetElement('charCount'); },
    
    // Settings controls
    get removeDuplicates() { return safeGetElement('removeDuplicates'); },
    get removeUrls() { return safeGetElement('removeUrls'); },
    get removeNumbers() { return safeGetElement('removeNumbers'); },
    get removeStopWords() { return safeGetElement('removeStopWords'); },
    get extractSections() { return safeGetElement('extractSections'); },
    get extractKeyPhrases() { return safeGetElement('extractKeyPhrases'); },
    get outputFormat() { return safeGetElement('outputFormat'); },
    
    // Save location controls
    get saveLocation() { return safeGetElement('saveLocation'); },
    get customPathGroup() { return safeGetElement('customPathGroup'); },
    get customPath() { return safeGetElement('customPath'); },
    get browsePathBtn() { return safeGetElement('browsePathBtn'); }
  };

  // State
  let extractedContent = '';
  let rawContent = '';
  let processedData = null;
  let currentUrl = '';
  let currentTitle = '';
  let settingsVisible = false;
  let customSavePath = '';
  let directoryHandle = null;
  let lastExtractedTables = [];
  
  // IndexedDB storage for persistent directory handles
  const HandleStore = (() => {
    const DB_NAME = 'webtext-extractor';
    const STORE_NAME = 'handles';
    const KEY = 'customDirectory';

    function openDB() {
      return new Promise((resolve, reject) => {
        if (!('indexedDB' in window)) {
          return reject(new Error('IndexedDB not supported'));
        }
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    async function saveDirectoryHandle(handle) {
      try {
        const db = await openDB();
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          const store = tx.objectStore(STORE_NAME);
          store.put(handle, KEY);
        });
      } catch (error) {
        Logger.warn('Failed to persist directory handle', { error: error.message });
      }
    }

    async function loadDirectoryHandle() {
      try {
        const db = await openDB();
        return await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readonly');
          tx.onerror = () => reject(tx.error);
          const store = tx.objectStore(STORE_NAME);
          const getReq = store.get(KEY);
          getReq.onsuccess = () => resolve(getReq.result || null);
          getReq.onerror = () => reject(getReq.error);
        });
      } catch (error) {
        Logger.warn('Failed to load directory handle', { error: error.message });
        return null;
      }
    }

    async function clearDirectoryHandle() {
      try {
        const db = await openDB();
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          const store = tx.objectStore(STORE_NAME);
          store.delete(KEY);
        });
      } catch (error) {
        Logger.warn('Failed to clear directory handle', { error: error.message });
      }
    }

    return { saveDirectoryHandle, loadDirectoryHandle, clearDirectoryHandle };
  })();
  
  // Rate limiting and debouncing
  let extractionInProgress = false;
  let extractionTimeout = null;
  let lastExtractionTime = 0;
  const EXTRACTION_COOLDOWN = 1000; // 1 second between extractions
  
  // Initialize text processor
  const textProcessor = new TextProcessor();

  // Heuristic filter to remove code-like lines before sending to LLMs
  function stripCodeLikeLines(text) {
    if (!text || typeof text !== 'string') return '';
    const codeKeyword = /(function|var|let|const|class|=>|return|if\s*\(|else|switch\s*\(|case\s|for\s*\(|while\s*\(|try\s*\{|catch|finally|new\s+\w+|import\s+|export\s+|document\.|window\.|console\.|addEventListener\(|\$\(|jQuery|<\/?script|<\/?style)/i;
    const keepCurrencyOrNumbers = /[₹$€]|\b\d{1,3}(?:[\,\s]\d{3})*(?:\.\d+)?\b/;
    const keepNaturalText = /[A-Za-z]{3,}[^\n]*\s+[A-Za-z]{3,}/;
    const lines = text.split(/\n+/);
    const out = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const symbolDensity = (trimmed.replace(/[A-Za-z0-9\s]/g, '').length) / Math.max(1, trimmed.length);
      const isCodey = codeKeyword.test(trimmed) || symbolDensity > 0.35 || /;\s*$/.test(trimmed);
      const looksUseful = keepNaturalText.test(trimmed) || keepCurrencyOrNumbers.test(trimmed);
      if (!isCodey || looksUseful) {
        out.push(trimmed);
      }
    }
    return out.join('\n');
  }

  // Load API keys securely from storage
  async function getApiKeys() {
    try {
      const { geminiApiKey, doApiKey } = await chrome.storage.local.get(['geminiApiKey', 'doApiKey']);
      return { geminiApiKey, doApiKey };
    } catch (_) {
      return { geminiApiKey: undefined, doApiKey: undefined };
    }
  }

  // Gemini API client (keys loaded at runtime from chrome.storage)
  const GeminiClient = (() => {
    // Prefer latest, then stable fallbacks
    const MODELS = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash'];
    const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models/';
    const TIMEOUT_MS = 25000;
    const MAX_CHARS_PER_CHUNK = 40000; // smaller chunks for large pages
    const MAX_RETRIES = 2; // per model

    async function endpoint(model) {
      const { geminiApiKey } = await getApiKeys();
      if (!geminiApiKey) throw new Error('Gemini API key not set. Use Options to configure.');
      return `${BASE_URL}${model}:generateContent?key=${geminiApiKey}`;
    }

    function fetchWithTimeout(url, options = {}, timeoutMs = TIMEOUT_MS) {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);
      return fetch(url, { ...options, signal: controller.signal })
        .finally(() => clearTimeout(id));
    }

    async function callGemini(model, prompt) {
      const body = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 8192,
          responseMimeType: 'text/plain'
        }
      };
      const url = await endpoint(model);
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const error = new Error(`Gemini ${model} error ${res.status}: ${text}`);
        error.status = res.status;
        throw error;
      }
      const data = await res.json();
      const out = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (!out) throw new Error('Empty response from Gemini');
      return out;
    }

    async function callWithRetry(prompt) {
      for (let m = 0; m < MODELS.length; m++) {
        const model = MODELS[m];
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          try {
            return await callGemini(model, prompt);
          } catch (err) {
            Logger.warn('Gemini call failed', { model, attempt, error: err.message });
            if (attempt === MAX_RETRIES - 1) break; // try next model
            await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
          }
        }
      }
      throw new Error('All Gemini attempts failed');
    }

    function buildChunkPrompt(chunk, meta, tablesJSON, idx, total) {
      return `You are a data cleaning assistant. Clean and organize this webpage extraction CHUNK ${idx}/${total}.\n\nGuidelines:\n- Keep only domain-relevant facts; remove menus/nav/ads.\n- Ignore any code, JavaScript/CSS, variable names or minified tokens.\n- Preserve numeric values and currency as written.\n- Convert fee tables to clear bullet lists.\n- Return plain text only.\n\nTITLE: ${meta.title || 'Webpage'}\nURL: ${meta.url}\n\nTABLES(JSON):\n${tablesJSON}\n\nRAW CHUNK ${idx}/${total}:\n${chunk}`;
    }

    function buildSynthesisPrompt(segments, meta) {
      return `Synthesize the following cleaned segments into one concise dataset context file.\nSections: University Information, Hostel Fee Structure Overview (subsections per hostel), Course Fee Tables, Notes, Contact (if present).\nIgnore any code/JS/CSS tokens.\nReturn plain text only.\n\nTITLE: ${meta.title || 'Webpage'}\nURL: ${meta.url}\n\nSEGMENTS:\n${segments.map((s, i) => `--- Segment ${i + 1} ---\n${s}`).join('\n')}`;
    }

    async function organizeText(raw, meta, tables = [], onProgress) {
      let prepared = stripCodeLikeLines(raw || '');
      if (prepared.length > 300000) prepared = prepared.slice(0, 300000);
      const tablesJSON = tables && tables.length ? JSON.stringify(tables).slice(0, 60000) : '[]';
      if (!prepared || prepared.length <= MAX_CHARS_PER_CHUNK) {
        const prompt = buildChunkPrompt(prepared, meta, tablesJSON, 1, 1);
        if (typeof onProgress === 'function') onProgress({ phase: 'chunk', index: 1, total: 1 });
        return callWithRetry(prompt);
      }

      // Chunk then synthesize
      const chunks = [];
      for (let i = 0; i < prepared.length; i += MAX_CHARS_PER_CHUNK) {
        chunks.push(prepared.slice(i, i + MAX_CHARS_PER_CHUNK));
      }
      const cleanedSegments = [];
      for (let i = 0; i < chunks.length; i++) {
        if (typeof onProgress === 'function') onProgress({ phase: 'chunk', index: i + 1, total: chunks.length });
        const segment = await callWithRetry(buildChunkPrompt(chunks[i], meta, tablesJSON, i + 1, chunks.length));
        cleanedSegments.push(segment);
      }
      if (typeof onProgress === 'function') onProgress({ phase: 'synthesis' });
      return callWithRetry(buildSynthesisPrompt(cleanedSegments, meta));
    }

    return { organizeText };
  })();

  // DigitalOcean AI fallback client (keys loaded at runtime from chrome.storage)
  const DOClient = (() => {
    const ENDPOINT = 'https://inference.do-ai.run/v1/chat/completions';
    const MODEL = 'llama3.3-70b-instruct';
    const TIMEOUT_MS = 25000;
    const MAX_CHARS_PER_CHUNK = 40000;
    const MAX_RETRIES = 2;

    function fetchWithTimeoutDo(url, options = {}, timeoutMs = TIMEOUT_MS) {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);
      return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
    }

    async function callDo(prompt) {
      const { doApiKey } = await getApiKeys();
      if (!doApiKey) throw new Error('DO Inference API key not set. Use Options to configure.');
      const body = {
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 8192
      };
      const res = await fetchWithTimeoutDo(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${doApiKey}`
        },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`DO LLM error ${res.status}: ${text}`);
      }
      const data = await res.json();
      const out = data?.choices?.[0]?.message?.content?.trim();
      if (!out) throw new Error('Empty response from DO LLM');
      return out;
    }

    async function callWithRetry(prompt) {
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          return await callDo(prompt);
        } catch (err) {
          Logger.warn('DO LLM call failed', { attempt, error: err.message });
          if (attempt === MAX_RETRIES - 1) throw err;
          await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
        }
      }
    }

    function buildChunkPrompt(chunk, meta, tablesJSON, idx, total) {
      return `You are a data cleaning assistant. Clean and organize this webpage extraction CHUNK ${idx}/${total}.\n\nGuidelines:\n- Keep only domain-relevant facts; remove menus/nav/ads.\n- Ignore any code, JavaScript/CSS, variable names or minified tokens.\n- Preserve numeric values and currency as written.\n- Convert fee tables to clear bullet lists.\n- Return plain text only.\n\nTITLE: ${meta.title || 'Webpage'}\nURL: ${meta.url}\n\nTABLES(JSON):\n${tablesJSON}\n\nRAW CHUNK ${idx}/${total}:\n${chunk}`;
    }

    function buildSynthesisPrompt(segments, meta) {
      return `Synthesize the following cleaned segments into one concise dataset context file.\nSections: University Information, Hostel Fee Structure Overview (subsections per hostel), Course Fee Tables, Notes, Contact (if present).\nIgnore any code/JS/CSS tokens.\nReturn plain text only.\n\nTITLE: ${meta.title || 'Webpage'}\nURL: ${meta.url}\n\nSEGMENTS:\n${segments.map((s, i) => `--- Segment ${i + 1} ---\n${s}`).join('\n')}`;
    }

    async function organizeText(raw, meta, tables = [], onProgress) {
      let prepared = stripCodeLikeLines(raw || '');
      if (prepared.length > 300000) prepared = prepared.slice(0, 300000);
      const tablesJSON = tables && tables.length ? JSON.stringify(tables).slice(0, 60000) : '[]';
      if (!prepared || prepared.length <= MAX_CHARS_PER_CHUNK) {
        const prompt = buildChunkPrompt(prepared, meta, tablesJSON, 1, 1);
        if (typeof onProgress === 'function') onProgress({ phase: 'chunk', index: 1, total: 1 });
        return callWithRetry(prompt);
      }

      const chunks = [];
      for (let i = 0; i < prepared.length; i += MAX_CHARS_PER_CHUNK) {
        chunks.push(prepared.slice(i, i + MAX_CHARS_PER_CHUNK));
      }
      const cleanedSegments = [];
      for (let i = 0; i < chunks.length; i++) {
        if (typeof onProgress === 'function') onProgress({ phase: 'chunk', index: i + 1, total: chunks.length });
        const segment = await callWithRetry(buildChunkPrompt(chunks[i], meta, tablesJSON, i + 1, chunks.length));
        cleanedSegments.push(segment);
      }
      if (typeof onProgress === 'function') onProgress({ phase: 'synthesis' });
      return callWithRetry(buildSynthesisPrompt(cleanedSegments, meta));
    }

    return { organizeText };
  })();
  // Generic fetch with timeout for robust network calls
  async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      return res;
    } finally {
      clearTimeout(id);
    }
  }

  // HTML fetch + parse fallback for cases where content script cannot extract
  async function htmlFetchExtract(targetUrl) {
    const res = await fetchWithTimeout(targetUrl, { cache: 'no-store' }, 15000);
    if (!res.ok) throw new Error(`Fallback fetch failed (${res.status})`);
    const html = await res.text();
    const parsed = parseHtmlToOrderedText(html);
    const scriptData = await collectScriptData(html, targetUrl);
    const header = parsed.title ? `${parsed.title}\n${'='.repeat(Math.min(parsed.title.length, 80))}\n\n` : '';
    const scriptSection = scriptData.filtered.length
      ? `\n\nScript Data (filtered):\n${scriptData.filtered.join('\n')}`
      : '';
    return {
      text: `${header}${parsed.text}${scriptSection}`,
      title: parsed.title || '',
      tables: parsed.tables || []
    };
  }

  // Parse raw HTML (used for view-source: fallback)
  function parseHtmlToOrderedText(htmlString) {
    try {
      const doc = new DOMParser().parseFromString(htmlString, 'text/html');
      const title = doc.querySelector('title')?.textContent || '';

      function extractFeesFromParsedDoc(docNode) {
        const tables = Array.from(docNode.querySelectorAll('table'));
        const feeLines = [];
        const outTables = [];
        tables.forEach(table => {
          const rows = Array.from(table.querySelectorAll('tr'));
          if (rows.length < 2) return;
          const headerCells = Array.from(rows[0].querySelectorAll('th,td')).map(c => (c.textContent||'').trim().toLowerCase());
          const headerJoined = headerCells.join(' ');
          const looksLikeFees = /fee|year|semester/.test(headerJoined) || (headerCells.includes('programme') || headerCells.includes('program') || headerCells.includes('course'));
          if (!looksLikeFees) return;
          const colNames = headerCells.map(h => h.replace(/\s+/g,' '));
          const tableRows = [];
          rows.slice(1).forEach(r => {
            const cols = Array.from(r.querySelectorAll('td,th')).map(c => (c.textContent||'').replace(/\s+/g,' ').trim());
            if (cols.every(v => !v)) return;
            let name = cols[0];
            if (/^(s\.?no\.?|serial|#)$/i.test(colNames[0] || '')) {
              name = cols[1] || name;
            }
            const parts = [];
            for (let i=0; i<cols.length; i++) {
              const h = colNames[i] || `col${i+1}`;
              if (/^(s\.?no\.?|serial|#)$/i.test(h)) continue;
              if (i === 0 || (i === 1 && name === cols[1] && /programme|program|course/.test(colNames[1]||''))) continue;
              const val = cols[i];
              if (!val) continue;
              parts.push(`${h}: ${val}`);
            }
            if (name && parts.length) tableRows.push([name, parts.join(', ')]);
          });
          if (tableRows.length) {
            outTables.push({ caption: '', rows: tableRows });
            tableRows.forEach(([n, v]) => feeLines.push(`${n} — ${v}`));
          }
        });
        return { lines: feeLines.join('\n'), tables: outTables };
      }

      const fees = extractFeesFromParsedDoc(doc);
      if (fees.lines) {
        return { title, text: fees.lines, tables: fees.tables };
      }

      // Fallback: DOM ordered text
      const selector = ['h1','h2','h3','h4','h5','h6','p','li','table','blockquote','dt','dd','figcaption'].join(',');
      const nodes = Array.from(doc.querySelectorAll(selector));
      const lines = [];
      let last = '';
      const outTables = [];
      nodes.forEach(node => {
        if (node.tagName === 'TABLE') {
          const rows = Array.from(node.querySelectorAll('tr')).map(tr => Array.from(tr.querySelectorAll('th,td')).map(c => (c.textContent||'').replace(/\s+/g,' ').trim()).filter(Boolean));
          const filtered = rows.filter(r => r.length);
          if (filtered.length) {
            const maxCols = Math.max(...filtered.map(r => r.length));
            const tRows = [];
            filtered.forEach(r => {
              if (maxCols === 2 && r.length === 2) { lines.push(`${r[0]}: ${r[1]}`); tRows.push([r[0], r[1]]); }
              else { lines.push(r.join(' | ')); tRows.push(r); }
            });
            outTables.push({ caption: '', rows: tRows });
          }
          return;
        }
        let text = (node.textContent||'').replace(/\s+/g,' ').trim();
        if (!text) return;
        if (node.tagName === 'LI') text = `• ${text}`;
        if (text !== last) { lines.push(text); last = text; }
      });
      return { title, text: lines.join('\n'), tables: outTables };
    } catch (e) {
      throw new Error('HTML parse failed: ' + e.message);
    }
  }

  // Collect inline and external script data from HTML
  async function collectScriptData(htmlString, baseUrl) {
    const MAX_SCRIPTS = 10;
    const PER_SCRIPT_MAX_BYTES = 300000; // 300 KB
    const TOTAL_MAX_BYTES = 2000000; // 2 MB cap
    const FETCH_TIMEOUT_MS = 8000;

    function fetchWithTimeout(url) {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      return fetch(url, { signal: controller.signal })
        .finally(() => clearTimeout(t));
    }

    const doc = new DOMParser().parseFromString(htmlString, 'text/html');
    const scripts = Array.from(doc.querySelectorAll('script'));
    const inlineTexts = scripts
      .filter(s => !s.src)
      .map(s => (s.textContent || '').trim())
      .filter(Boolean);

    const srcUrls = [];
    scripts.filter(s => s.src).forEach(s => {
      try {
        const u = new URL(s.src, baseUrl).toString();
        if (!srcUrls.includes(u)) srcUrls.push(u);
      } catch (_) { /* ignore bad URLs */ }
    });

    const limited = srcUrls.slice(0, MAX_SCRIPTS);
    const externalTexts = [];
    let totalBytes = 0;
    for (const url of limited) {
      try {
        const res = await fetchWithTimeout(url);
        if (!res.ok) continue;
        let txt = await res.text();
        if (typeof txt !== 'string') continue;
        if (txt.length > PER_SCRIPT_MAX_BYTES) {
          txt = txt.slice(0, PER_SCRIPT_MAX_BYTES) + `\n/* ... truncated ${txt.length - PER_SCRIPT_MAX_BYTES} bytes ... */`;
        }
        externalTexts.push(`// ${url}\n${txt}`);
        totalBytes += txt.length;
        if (totalBytes >= TOTAL_MAX_BYTES) break;
      } catch (e) {
        Logger.warn('Script fetch failed', { url, error: e.message });
      }
    }

    const interestingLine = /fee|fees?|tuition|amount|price|semester|year|programme|program|course/i;
    function filterLines(blocks) {
      const out = [];
      blocks.forEach(b => {
        b.split(/\n+/).forEach(line => {
          const trimmed = line.trim();
          if (trimmed.length > 0 && interestingLine.test(trimmed)) out.push(trimmed);
        });
      });
      return Array.from(new Set(out)).slice(0, 500);
    }

    return {
      inlineTexts,
      externalTexts,
      filtered: filterLines([...inlineTexts, ...externalTexts])
    };
  }

  // Error logging utility
  const Logger = {
    error: (message, error, context = {}) => {
      const errorDetails = {
        timestamp: new Date().toISOString(),
        message,
        error: error?.message || error,
        stack: error?.stack,
        context,
        userAgent: navigator.userAgent,
        extensionVersion: chrome.runtime.getManifest().version
      };
      console.error('Extension Error:', errorDetails);
      
      // Could be extended to send to analytics service
      // Analytics.track('extension_error', errorDetails);
    },
    
    warn: (message, context = {}) => {
      console.warn('Extension Warning:', { message, context, timestamp: new Date().toISOString() });
    },
    
    info: (message, context = {}) => {
      console.info('Extension Info:', { message, context, timestamp: new Date().toISOString() });
    }
  };

  // Error categories for better user experience
  const ERROR_CATEGORIES = {
    NETWORK: 'network',
    PERMISSION: 'permission', 
    CONTENT: 'content',
    STORAGE: 'storage',
    VALIDATION: 'validation',
    SYSTEM: 'system'
  };

  // User-friendly error messages
  const ERROR_MESSAGES = {
    [ERROR_CATEGORIES.NETWORK]: 'Connection issue. Please check your internet and try again.',
    [ERROR_CATEGORIES.PERMISSION]: 'Permission denied. Please refresh the page and try again.',
    [ERROR_CATEGORIES.CONTENT]: 'Unable to extract text from this page. Try a different page.',
    [ERROR_CATEGORIES.STORAGE]: 'Storage error. Please check available disk space.',
    [ERROR_CATEGORIES.VALIDATION]: 'Invalid content detected. Please try a different page.',
    [ERROR_CATEGORIES.SYSTEM]: 'System error occurred. Please restart the browser and try again.'
  };

  /**
   * Show specific view and hide others with null safety
   */
  function showView(viewName) {
    const views = ['loading', 'error', 'content', 'welcome'];
    views.forEach(view => {
      const element = elements[view + 'Div'];
      if (element) {
        element.classList.toggle('hidden', view !== viewName);
      } else {
        Logger.warn(`View element not found: ${view}Div`);
      }
    });
    if (viewName === 'loading') {
      const lt = document.getElementById('loadingText');
      if (lt) lt.textContent = 'Processing...';
    }
  }

  /**
   * Update text statistics with null safety
   */
  function updateStats(text) {
    if (!text || typeof text !== 'string') {
      text = '';
    }
    
    const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
    const charCount = text.length;
    
    if (elements.wordCount) {
      elements.wordCount.textContent = `${wordCount.toLocaleString()} words`;
    }
    if (elements.charCount) {
      elements.charCount.textContent = `${charCount.toLocaleString()} characters`;
    }
  }

  /**
   * Show error message with null safety
   */
  function showError(message) {
    if (elements.errorMessage) {
      elements.errorMessage.textContent = message || 'An unknown error occurred';
    }
    showView('error');
    Logger.error('Error shown to user', { message });
  }

  /**
   * Extract text from current tab with improved error handling and rate limiting
   */
  async function extractText() {
    // Rate limiting check
    const now = Date.now();
    if (extractionInProgress) {
      Logger.warn('Extraction already in progress, ignoring request');
      return;
    }
    
    if (now - lastExtractionTime < EXTRACTION_COOLDOWN) {
      Logger.warn('Extraction rate limited', { timeSinceLastExtraction: now - lastExtractionTime });
      showError('Please wait a moment before extracting again');
      return;
    }

    extractionInProgress = true;
    lastExtractionTime = now;

    try {
      showView('loading');
      Logger.info('Starting text extraction');
      
      // Get current active tab with error handling
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      
      if (!tab) {
        throw new Error('No active tab found');
      }

      if (!tab.id) {
        throw new Error('Invalid tab ID');
      }

      // Check if URL is valid for content script injection
      const restrictedProtocols = ['chrome://', 'chrome-extension://', 'edge://', 'about:', 'moz-extension://', 'file://'];
      if (restrictedProtocols.some(protocol => tab.url.startsWith(protocol))) {
        throw new Error('Cannot extract text from this type of page (system/local pages are restricted)');
      }

      currentUrl = tab.url;
      currentTitle = tab.title || '';
      Logger.info('Attempting extraction from URL', { url: currentUrl });

      // Special case: view-source pages - fetch original HTML and parse in popup
      if (currentUrl.startsWith('view-source:')) {
        const originalUrl = currentUrl.replace(/^view-source:/, '');
        Logger.info('View-source mode detected. Fetching original HTML', { originalUrl });
        try {
          const { text, title, tables } = await htmlFetchExtract(originalUrl);
          rawContent = text;
          lastExtractedTables = tables;
          processedData = textProcessor.processForLLM(rawContent, getProcessingOptions());
          currentTitle = currentTitle || title;
          updateDisplayedContent(lastExtractedTables);
          showView('content');
          if (elements.extractedText) elements.extractedText.focus();
          return;
        } catch (e) {
          Logger.warn('View-source fallback failed, showing error', { error: e.message });
          throw new Error('Failed to read page source. Please reload the tab and try again.');
        }
      }

      // Enhanced content script injection with better error handling
      let contentScriptReady = false;
      const maxAttempts = 3;
      
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          Logger.info(`Content script connection attempt ${attempt}/${maxAttempts}`);
          
          // Test if content script is available
          const pingResponse = await Promise.race([
            chrome.tabs.sendMessage(tab.id, { action: 'ping' }),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Ping timeout')), 1500)
            )
          ]);
          
          if (pingResponse && pingResponse.success) {
            if (pingResponse.version !== '2') {
              Logger.warn('Outdated content script detected, reinjecting');
              await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
              await new Promise(r => setTimeout(r, 400));
            }
            contentScriptReady = true;
            Logger.info('Content script ready');
            break;
          }
        } catch (pingError) {
          Logger.warn(`Ping attempt ${attempt} failed`, { error: pingError.message });
          
          if (attempt < maxAttempts) {
            try {
              Logger.info('Injecting content script...');
              
              // Clear any existing failed injections
              await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => {
                  // Clean up any existing listeners
                  if (window.webTextExtractorLoaded) {
                    console.log('Cleaning up existing content script');
                  }
                  window.webTextExtractorLoaded = true;
                }
              });
              
              // Inject the content script
              await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['content.js']
              });
              
              // Give the script more time to initialize
              await new Promise(resolve => setTimeout(resolve, 500));
              
            } catch (injectionError) {
              Logger.error('Content script injection failed', injectionError, { attempt });
              
              if (attempt === maxAttempts) {
                throw new Error('Failed to inject content script after multiple attempts. Please refresh the page and try again.');
              }
            }
          }
        }
      }
      
      if (!contentScriptReady) {
        throw new Error('Content script not available after all attempts. Please refresh the page and try again.');
      }

      // Read extraction options
      const includeHidden = !!document.getElementById('includeHidden')?.checked;
      const autoScroll = !!document.getElementById('autoScroll')?.checked;

      // Persist extraction preferences
      chrome.storage.local.set({ ui_includeHidden: includeHidden, ui_autoScroll: autoScroll });

      // Send extraction message with extended timeout (with HTML fetch fallback)
      Logger.info('Sending extraction request to content script');
      let response;
      try {
        response = await Promise.race([
          chrome.tabs.sendMessage(tab.id, { action: 'extractText', includeHidden, autoScroll }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Extraction timeout - page took too long to respond')), 15000))
        ]);
        if (!response) throw new Error('No response from content script');
        if (!response.success) throw new Error(response.error || 'Content script reported failure');
        // Validate extracted content
        rawContent = response.text;
        const extractedTables = Array.isArray(response.tables) ? response.tables : [];
        lastExtractedTables = extractedTables;
        if (response.title && !currentTitle) currentTitle = response.title;
        if (!rawContent || typeof rawContent !== 'string' || rawContent.trim().length === 0) {
          throw new Error('Empty or invalid content from content script');
        }
      } catch (csError) {
        Logger.warn('Content script extraction failed, attempting HTML fetch fallback', { error: csError.message });
        try {
          const { text, title, tables } = await htmlFetchExtract(currentUrl);
          rawContent = text;
          lastExtractedTables = tables;
          currentTitle = currentTitle || title;
        } catch (fbError) {
          Logger.error('HTML fetch fallback failed', fbError);
          throw new Error(csError.message || 'Extraction failed');
        }
      }

      Logger.info('Text extraction successful', { 
        textLength: rawContent.length,
        url: currentUrl 
      });
      
      // Process the content with current settings (use chunking for large texts)
      const options = getProcessingOptions();
      
      try {
        // Use chunked processing for texts larger than 50KB
        if (rawContent.length > 50000) {
          Logger.info('Processing large text with chunking', { textLength: rawContent.length });
          processedData = textProcessor.processLargeText(rawContent, options);
        } else {
          processedData = textProcessor.processForLLM(rawContent, options);
        }
      } catch (processingError) {
        Logger.error('Text processing failed', processingError);
        throw new Error('Failed to process extracted text: ' + processingError.message);
      }
      
      // Update display based on selected format
      updateDisplayedContent(lastExtractedTables);
      
      showView('content');
      
      // Focus on text area for easy reading
      if (elements.extractedText) {
        elements.extractedText.focus();
      }

    } catch (error) {
      Logger.error('Text extraction failed', error, { url: currentUrl });
      
      // Enhanced error categorization
      let errorMessage = error.message || 'An error occurred while extracting text';
      
      if (error.message.includes('Could not establish connection') || 
          error.message.includes('Receiving end does not exist')) {
        errorMessage = 'Content script connection failed. Please refresh the page and try again.';
      } else if (error.message.includes('Cannot access') || 
                 error.message.includes('Cannot extract text from this type')) {
        errorMessage = 'Cannot access this page. Chrome system pages and local files are restricted.';
      } else if (error.message.includes('timeout')) {
        errorMessage = 'Request timed out. The page may be loading or unresponsive. Please try again.';
      } else if (error.message.includes('No visible text found')) {
        errorMessage = 'No readable text content found on this page.';
      } else if (error.message.includes('Invalid tab')) {
        errorMessage = 'Unable to access the current tab. Please try refreshing the page.';
      }
      
      showError(errorMessage);
    } finally {
      extractionInProgress = false;
    }
  }

  /**
   * Copy text to clipboard with improved error handling
   */
  async function copyToClipboard() {
    try {
      if (!elements.extractedText) {
        showError('Text area not found');
        return;
      }
      
      const contentToCopy = elements.extractedText.value || '';
      
      if (!contentToCopy.trim()) {
        showError('No content to copy');
        return;
      }
      
      // Try modern clipboard API first
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(contentToCopy);
      } else {
        // Fallback for older browsers
        elements.extractedText.select();
        const success = document.execCommand('copy');
        if (!success) {
          throw new Error('Copy command failed');
        }
        elements.extractedText.blur();
      }
      
      Logger.info('Text copied to clipboard', { contentLength: contentToCopy.length });
      
      // Show feedback with null safety
      if (elements.copyBtn) {
        const label = document.getElementById('copyBtnLabel');
        const originalText = label ? label.textContent : null;
        elements.copyBtn.classList.add('copied');
        if (label) label.textContent = 'Copied!';
        setTimeout(() => {
          if (elements.copyBtn) {
            elements.copyBtn.classList.remove('copied');
            if (label && originalText) label.textContent = originalText;
          }
        }, 2000);
      }
      
    } catch (error) {
      Logger.error('Failed to copy text', error);
      showError('Failed to copy text to clipboard: ' + error.message);
    }
  }

  /**
   * Download text as file with custom path support
   */
  async function downloadAsFile() {
    try {
      const contentToDownload = elements.extractedText.value || '';
      
      if (!contentToDownload.trim()) {
        showError('No content to save');
        return;
      }
      
      // Build filename from page title (always .txt)
      const filename = generateTitleFilename();

      // Prepend page URL to the saved file content
      const contentToDownloadWithLink = `URL: ${currentUrl}\n\n${contentToDownload}`;

      // Prefer custom directory (one-time choose). Fallback to Downloads.
      const canUseFSA = typeof window.showDirectoryPicker === 'function';
      if (canUseFSA) {
        // Try to ensure we have a directory handle (persisted or prompt once)
        if (!directoryHandle) {
          directoryHandle = await HandleStore.loadDirectoryHandle();
        }
        if (!directoryHandle) {
          try {
            directoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
            const dirName = directoryHandle.name;
            customSavePath = dirName;
            elements.customPath.value = dirName;
            await chrome.storage.local.set({ customSavePath: dirName, hasCustomFolder: true, saveLocation: 'custom' });
            await HandleStore.saveDirectoryHandle(directoryHandle);
            // Reflect UI state
            if (elements.saveLocation) {
              elements.saveLocation.value = 'custom';
              handleSaveLocationChange();
            }
          } catch (pickErr) {
            if (pickErr.name !== 'AbortError') {
              Logger.warn('Directory picker failed, falling back to Downloads', { error: pickErr.message });
            }
          }
        }
        // If we have a handle now, save to custom path; else fallback
        if (directoryHandle) {
          await saveToCustomPath(contentToDownloadWithLink, filename, 'txt');
          return;
        }
      }

      // Fallback: save to Downloads
      await saveToDownloads(contentToDownloadWithLink, filename, 'txt');
      
    } catch (error) {
      console.error('Download error:', error);
      showError('Failed to save file: ' + error.message);
    }
  }

  /**
   * Save file to custom path using File System Access API
   */
  async function saveToCustomPath(content, filename, format) {
    try {
      // Attempt to ensure we have a directory handle
      if (!directoryHandle) {
        directoryHandle = await HandleStore.loadDirectoryHandle();
      }

      if (!directoryHandle) {
        throw new Error('No directory selected. Please choose a folder first.');
      }

      // Check if we have permission to write to the directory
      const permission = await directoryHandle.queryPermission({ mode: 'readwrite' });
      if (permission !== 'granted') {
        const newPermission = await directoryHandle.requestPermission({ mode: 'readwrite' });
        if (newPermission !== 'granted') {
          throw new Error('Permission denied to write to selected folder');
        }
      }

      // Create file handle
      const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
      
      // Create writable stream
      const writable = await fileHandle.createWritable();
      
      // Write content
      await writable.write(content);
      await writable.close();
      
      // Show success feedback
      showSaveSuccess(filename, customSavePath);
      
    } catch (error) {
      if (error.name === 'AbortError') {
        return; // User cancelled
      }
      throw new Error(`Failed to save to custom location: ${error.message}`);
    }
  }

  /**
   * Save file to Downloads folder using Chrome Downloads API with proper cleanup
   */
  async function saveToDownloads(content, filename, format) {
    let blobUrl = null;
    
    try {
      const mimeType = format === 'json' ? 'application/json' : 'text/plain';
      const blob = new Blob([content], { type: mimeType });
      blobUrl = URL.createObjectURL(blob);
      
      Logger.info('Attempting to save file to Downloads', { filename, format, size: content.length });
      
      // Use Chrome Downloads API
      if (chrome.downloads && chrome.downloads.download) {
        const downloadId = await chrome.downloads.download({
          url: blobUrl,
          filename: filename,
          saveAs: false // Set to true if you want to show save dialog
        });
        
        Logger.info('File download initiated', { downloadId, filename });
        
        // Clean up blob URL after a brief delay
        setTimeout(() => {
          if (blobUrl) {
            URL.revokeObjectURL(blobUrl);
            blobUrl = null;
          }
        }, 2000);
        
        showSaveSuccess(filename, 'Downloads folder');
      } else {
        // Fallback for browsers without chrome.downloads
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        // Clean up immediately in fallback
        URL.revokeObjectURL(blobUrl);
        blobUrl = null;
        
        showSaveSuccess(filename, 'Default location');
      }
      
    } catch (error) {
      // Ensure cleanup on error
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
        blobUrl = null;
      }
      Logger.error('Failed to save to downloads', error);
      throw new Error(`Failed to save to downloads: ${error.message}`);
    }
  }

  /**
   * Show success feedback after saving with null safety
   */
  function showSaveSuccess(filename, location) {
    Logger.info('File saved successfully', { filename, location });
    
    if (elements.downloadBtn) {
      const label = document.getElementById('downloadBtnLabel');
      const originalText = label ? label.textContent : null;
      if (label) label.textContent = 'Saved!';
      elements.downloadBtn.style.background = '#28a745';
      
      setTimeout(() => {
        if (elements.downloadBtn) {
          if (label && originalText) label.textContent = originalText;
          elements.downloadBtn.style.background = '';
        }
      }, 2000);
    }
  }

  /**
   * Clear extracted content with null safety
   */
  function clearContent() {
    rawContent = '';
    processedData = null;
    
    if (elements.extractedText) {
      elements.extractedText.value = '';
      elements.extractedText.removeAttribute('data-filename');
    }
    
    updateStats('');
    showView('welcome');
    Logger.info('Content cleared');
  }

  /**
   * Sanitize filename for download
   */
  function sanitizeFilename(filename) {
    return filename
      .replace(/[^\w\s-]/g, '') // Remove special characters
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .substring(0, 50) // Limit length
      .toLowerCase();
  }

  /**
   * Toggle settings panel
   */
  function toggleSettings() {
    settingsVisible = !settingsVisible;
    
    if (settingsVisible) {
      elements.settingsDiv.classList.remove('hidden');
      elements.settingsBtn.classList.add('active');
    } else {
      elements.settingsDiv.classList.add('hidden');
      elements.settingsBtn.classList.remove('active');
    }
  }

  /**
   * Get current processing options from UI with null safety
   */
  function getProcessingOptions() {
    return {
      removeDuplicates: elements.removeDuplicates?.checked ?? true,
      removeUrls: elements.removeUrls?.checked ?? true,
      removeNumbers: elements.removeNumbers?.checked ?? false,
      includeStopWords: !(elements.removeStopWords?.checked ?? true),
      extractSections: elements.extractSections?.checked ?? true,
      extractKeyPhrases: elements.extractKeyPhrases?.checked ?? true
    };
  }

  /**
   * Process current content with updated settings
   */
  function processCurrentContent() {
    if (!rawContent) return;
    
    try {
      const options = getProcessingOptions();
      processedData = textProcessor.processForLLM(rawContent, options);
      updateDisplayedContent();
    } catch (error) {
      console.error('Processing error:', error);
      showError('Error processing text with current settings');
    }
  }

  /**
   * Update displayed content based on output format
   */
  function updateDisplayedContent(extractedTables = []) {
    if (!processedData) return;
    
    const format = elements.outputFormat.value;
    let displayContent = '';
    let filename = generateTitleFilename(format);
    
    switch (format) {
      case 'raw':
        displayContent = rawContent;
        break;
      case 'clean':
        displayContent = processedData.processedText;
        break;
      case 'llm':
        displayContent = textProcessor.createLLMFormat(
          textProcessor.enrichWithTables(processedData, extractedTables)
        );
        break;
      case 'json':
        displayContent = textProcessor.createJSONFormat(processedData);
        break;
      default:
        displayContent = processedData.processedText;
    }
    
    elements.extractedText.value = displayContent;
    elements.extractedText.setAttribute('data-filename', filename);
    
         // Update stats with processing info
     updateStatsWithProcessing(displayContent);
  }

  /**
   * Update word and character counts with processing info
   */
  function updateStatsWithProcessing(content) {
    const words = content.trim().split(/\s+/).filter(word => word.length > 0).length;
    const chars = content.length;
    
    elements.wordCount.textContent = `${words.toLocaleString()} words`;
    elements.charCount.textContent = `${chars.toLocaleString()} characters`;
    
    // Add processing stats if available
    if (processedData && processedData.stats) {
      const stats = processedData.stats;
      const compressionInfo = ` (${(stats.compressionRatio * 100).toFixed(1)}% of original)`;
      elements.charCount.textContent += compressionInfo;
    }
  }

  /**
   * Browse for custom save folder
   */
  async function browseSaveFolder() {
    try {
      // Check if File System Access API is supported
      if (!window.showDirectoryPicker) {
        showError('Custom folder selection is not supported in this browser. Files will be saved to Downloads folder.');
        return;
      }

      // Show directory picker
      directoryHandle = await window.showDirectoryPicker({
        mode: 'readwrite'
      });

      // Get directory name and path
      const dirName = directoryHandle.name;
      customSavePath = dirName;
      
      // Update UI
      elements.customPath.value = dirName;
      
      // Store the directory handle for persistence
      await chrome.storage.local.set({
        customSavePath: dirName,
        hasCustomFolder: true
      });
      await HandleStore.saveDirectoryHandle(directoryHandle);
      
    } catch (error) {
      if (error.name === 'AbortError') {
        return; // User cancelled
      }
      console.error('Folder selection error:', error);
      showError('Failed to select folder: ' + error.message);
    }
  }

  /**
   * Handle save location change
   */
  function handleSaveLocationChange() {
    const isCustom = elements.saveLocation.value === 'custom';
    
    if (isCustom) {
      elements.customPathGroup.classList.remove('hidden');
      
      // Check if File System Access API is supported
      if (!window.showDirectoryPicker) {
        showError('Custom folder selection is not supported in this browser');
        elements.saveLocation.value = 'downloads';
        elements.customPathGroup.classList.add('hidden');
        return;
      }
    } else {
      elements.customPathGroup.classList.add('hidden');
      directoryHandle = null;
      customSavePath = '';
    }
    
    // Save preference
    chrome.storage.local.set({
      saveLocation: elements.saveLocation.value
    });
  }

  /**
   * Load saved preferences
   */
  async function loadPreferences() {
    try {
      const result = await chrome.storage.local.get([
        'saveLocation',
        'customSavePath',
        'hasCustomFolder'
      ]);
      
      if (result.saveLocation) {
        elements.saveLocation.value = result.saveLocation;
        handleSaveLocationChange();
      }
      
      if (result.customSavePath) {
        customSavePath = result.customSavePath;
        elements.customPath.value = result.customSavePath;
      }
      
      if (result.hasCustomFolder) {
        // Try to rehydrate the directory handle from IndexedDB
        const handle = await HandleStore.loadDirectoryHandle();
        if (handle) {
          directoryHandle = handle;
          Logger.info('Custom directory handle restored');
        }
      }
      
    } catch (error) {
      console.error('Error loading preferences:', error);
    }
  }

  /**
   * Test connection to content script
   */
  async function testConnection() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (!tab) {
        console.log('No active tab found');
        return false;
      }

      console.log('Testing connection to tab:', tab.url);

      // Try to ping the content script
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
      console.log('Connection test response:', response);
      return true;
    } catch (error) {
      console.log('Connection test failed:', error.message);
      return false;
    }
  }

  /**
   * Initialize popup with enhanced error handling
   */
  async function init() {
    try {
      Logger.info('Initializing popup');
      
      // Load saved preferences
      await loadPreferences();
      await hydrateAiSettings();
      
      // Test connection on startup
      testConnection();
      
      // Show welcome view initially
      showView('welcome');

      // Safe event listener binding
      bindEventListeners();

      // Auto-focus extract button
      if (elements.extractBtn) {
        elements.extractBtn.focus();
      }
      
      Logger.info('Popup initialization complete');
    } catch (error) {
      Logger.error('Popup initialization failed', error);
      showError('Extension initialization failed: ' + error.message);
    }
  }

  /**
   * Generate a sanitized filename from the page title (always .txt)
   */
  function generateTitleFilename(format = 'clean') {
    let base = currentTitle && typeof currentTitle === 'string' ? currentTitle : '';
    if (!base) {
      try {
        base = new URL(currentUrl).hostname;
      } catch (_) {
        base = 'webpage-text';
      }
    }
    const ext = format === 'json' ? '.json' : '.txt';
    return `${sanitizeFilename(base)}${ext}`;
  }

  /**
   * Bind event listeners with null safety
   */
  function bindEventListeners() {
    // Primary action listeners
    if (elements.extractBtn) {
      elements.extractBtn.addEventListener('click', debounce(extractText, 500));
    }
    const oneClickBtn = document.getElementById('oneClickBtn');
    if (oneClickBtn) {
      oneClickBtn.addEventListener('click', debounce(oneClickExtractOrganizeSave, 600));
    }
    const headerDownloadBtn = document.getElementById('downloadHeaderBtn');
    if (headerDownloadBtn) {
      headerDownloadBtn.addEventListener('click', debounce(downloadAsFile, 500));
    }
    if (elements.settingsBtn) {
      elements.settingsBtn.addEventListener('click', toggleSettings);
    }
    if (elements.copyBtn) {
      elements.copyBtn.addEventListener('click', debounce(copyToClipboard, 300));
    }
    if (elements.downloadBtn) {
      elements.downloadBtn.addEventListener('click', debounce(downloadAsFile, 500));
    }
    const aiBtn = document.getElementById('aiOrganizeBtn');
    if (aiBtn) {
      aiBtn.addEventListener('click', debounce(organizeWithAI, 600));
    }
    if (elements.clearBtn) {
      elements.clearBtn.addEventListener('click', clearContent);
    }
    
    // Save location listeners
    if (elements.saveLocation) {
      elements.saveLocation.addEventListener('change', handleSaveLocationChange);
    }
    if (elements.browsePathBtn) {
      elements.browsePathBtn.addEventListener('click', browseSaveFolder);
    }
    
    const manageBtn = document.getElementById('manageApiKeysBtn');
    if (manageBtn) {
      manageBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());
    }
    const aiToggle = document.getElementById('enableAiToggle');
    if (aiToggle) {
      aiToggle.addEventListener('change', async (e) => {
        const enabled = !!e.target.checked;
        await chrome.storage.local.set({ aiEnabled: enabled });
        updateAiVisibility();
      });
    }

    // Settings change listeners
    if (elements.outputFormat) {
      elements.outputFormat.addEventListener('change', handleOutputFormatChange);
    }
    
    // Settings checkboxes with debouncing
    [elements.removeDuplicates, elements.removeUrls, elements.removeNumbers,
     elements.removeStopWords, elements.extractSections, elements.extractKeyPhrases]
      .filter(el => el) // Filter out null elements
      .forEach(el => el.addEventListener('change', debounce(handleProcessingChange, 300)));

    // Keyboard shortcuts with improved safety
    document.addEventListener('keydown', handleKeyboardShortcuts);
  }

  function updateAiVisibility() {
    chrome.storage.local.get(['aiEnabled'], ({ aiEnabled }) => {
      const aiBtn = document.getElementById('aiOrganizeBtn');
      const oneClickBtn = document.getElementById('oneClickBtn');
      const shouldShow = !!aiEnabled;
      if (aiBtn) aiBtn.style.display = shouldShow ? '' : 'none';
      if (oneClickBtn) oneClickBtn.style.display = shouldShow ? '' : 'none';
    });
  }

  async function hydrateAiSettings() {
    const { aiEnabled } = await chrome.storage.local.get(['aiEnabled']);
    const toggle = document.getElementById('enableAiToggle');
    if (toggle) toggle.checked = !!aiEnabled;
    updateAiVisibility();
  }

  async function ensureAiAllowed() {
    const { aiEnabled, aiConsentGranted } = await chrome.storage.local.get(['aiEnabled', 'aiConsentGranted']);
    if (!aiEnabled) {
      showError('Enable AI features first in Settings');
      return false;
    }
    if (aiConsentGranted) return true;
    return await showAiConsentModal();
  }

  function showAiConsentModal() {
    return new Promise((resolve) => {
      const modal = document.getElementById('aiConsentModal');
      if (!modal) return resolve(false);
      modal.classList.remove('hidden');
      const onAccept = async () => {
        modal.classList.add('hidden');
        document.getElementById('aiConsentAccept')?.removeEventListener('click', onAccept);
        document.getElementById('aiConsentCancel')?.removeEventListener('click', onCancel);
        await chrome.storage.local.set({ aiConsentGranted: true, aiEnabled: true });
        const toggle = document.getElementById('enableAiToggle');
        if (toggle) toggle.checked = true;
        updateAiVisibility();
        resolve(true);
      };
      const onCancel = () => {
        modal.classList.add('hidden');
        document.getElementById('aiConsentAccept')?.removeEventListener('click', onAccept);
        document.getElementById('aiConsentCancel')?.removeEventListener('click', onCancel);
        resolve(false);
      };
      document.getElementById('aiConsentAccept')?.addEventListener('click', onAccept);
      document.getElementById('aiConsentCancel')?.addEventListener('click', onCancel);
    });
  }

  function handleOutputFormatChange() {
    try {
      const fmt = elements.outputFormat?.value || 'clean';
      chrome.storage.local.set({ ui_outputFormat: fmt });
    } catch (_) {}
    updateDisplayedContent();
  }

  function handleProcessingChange() {
    saveProcessingPreferencesToStorage();
    processCurrentContent();
  }

  function saveProcessingPreferencesToStorage() {
    const prefs = {
      ui_removeDuplicates: elements.removeDuplicates?.checked ?? true,
      ui_removeUrls: elements.removeUrls?.checked ?? true,
      ui_removeNumbers: elements.removeNumbers?.checked ?? false,
      ui_removeStopWords: elements.removeStopWords?.checked ?? true,
      ui_extractSections: elements.extractSections?.checked ?? true,
      ui_extractKeyPhrases: elements.extractKeyPhrases?.checked ?? true
    };
    chrome.storage.local.set(prefs);
  }
  async function organizeWithAI() {
    try {
      if (!rawContent || rawContent.trim().length === 0) {
        showError('Extract content first');
        return;
      }
      showView('loading');
      const lt = document.getElementById('loadingText');
      if (lt) lt.textContent = 'Organizing with Gemini...';
      const meta = { title: currentTitle, url: currentUrl };
      let organized;
      try {
        organized = await GeminiClient.organizeText(
          rawContent,
          meta,
          lastExtractedTables,
          (progress) => {
            const el = document.getElementById('loadingText');
            if (!el || !progress) return;
            if (progress.phase === 'chunk') {
              el.textContent = `Cleaning content ${progress.index}/${progress.total}...`;
            } else if (progress.phase === 'synthesis') {
              el.textContent = 'Synthesizing final output...';
            }
          }
        );
      } catch (gemErr) {
        Logger.warn('Gemini failed, falling back to DO LLM', { error: gemErr.message });
        if (lt) lt.textContent = 'Gemini failed. Organizing with Llama (DO)...';
        organized = await DOClient.organizeText(
          rawContent,
          meta,
          lastExtractedTables,
          (progress) => {
            const el = document.getElementById('loadingText');
            if (!el || !progress) return;
            if (progress.phase === 'chunk') {
              el.textContent = `Cleaning content ${progress.index}/${progress.total}...`;
            } else if (progress.phase === 'synthesis') {
              el.textContent = 'Synthesizing final output...';
            }
          }
        );
      }
      elements.extractedText.value = organized;
      updateStatsWithProcessing(organized);
      elements.extractedText.setAttribute('data-filename', generateTitleFilename());
      showView('content');
    } catch (error) {
      Logger.error('AI organize failed', error);
      showError('AI organize failed: ' + (error?.message || 'Unknown error'));
    }
  }

  // One-click: extract → organize with fallback → save
  async function oneClickExtractOrganizeSave() {
    try {
      showView('loading');
      const lt = document.getElementById('loadingText');
      if (lt) lt.textContent = 'Extracting page...';

      await extractText();

      if (!rawContent || rawContent.trim().length === 0) {
        throw new Error('No content extracted');
      }

      if (elements.outputFormat) elements.outputFormat.value = 'llm';
      if (lt) lt.textContent = 'Organizing with Gemini...';
      const meta = { title: currentTitle, url: currentUrl };
      let organized;
      try {
        organized = await GeminiClient.organizeText(rawContent, meta, lastExtractedTables);
      } catch (gemErr) {
        Logger.warn('Gemini failed in one-click, switching to DO', { error: gemErr.message });
        if (lt) lt.textContent = 'Gemini failed. Organizing with Llama (DO)...';
        organized = await DOClient.organizeText(rawContent, meta, lastExtractedTables);
      }

      elements.extractedText.value = organized;
      updateStatsWithProcessing(organized);
      elements.extractedText.setAttribute('data-filename', generateTitleFilename());
      if (lt) lt.textContent = 'Saving file...';
      await downloadAsFile();
      showView('content');
    } catch (err) {
      Logger.error('One-click flow failed', err);
      showError('One-click failed: ' + (err?.message || 'Unknown error'));
    }
  }

  /**
   * Handle keyboard shortcuts safely
   */
  function handleKeyboardShortcuts(e) {
    if (e.ctrlKey || e.metaKey) {
      switch (e.key) {
        case 'e':
          e.preventDefault();
          if (!extractionInProgress) {
            extractText();
          }
          break;
        case 'c':
          if (rawContent && elements.contentDiv && !elements.contentDiv.classList.contains('hidden')) {
            e.preventDefault();
            copyToClipboard();
          }
          break;
        case 's':
          if (rawContent && elements.contentDiv && !elements.contentDiv.classList.contains('hidden')) {
            e.preventDefault();
            downloadAsFile();
          }
          break;
      }
    }
  }

  /**
   * Debounce function to prevent rapid successive calls
   */
  function debounce(func, delay) {
    let timeoutId;
    return function (...args) {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => func.apply(this, args), delay);
    };
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(); 