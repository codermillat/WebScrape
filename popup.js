// Popup script for Web Text Extractor (LLM features removed)
(function() {
  'use strict';

  // DOM elements with safe getter
  function safeGetElement(id) {
    const element = document.getElementById(id);
    if (!element) console.warn(`Element not found: ${id}`);
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

    // Full-page extraction
    get fullPageExtract() { return safeGetElement('fullPageExtract'); },
    get excludeBoilerplate() { return safeGetElement('excludeBoilerplate'); },
    get includeMetadataToggle() { return safeGetElement('includeMetadataToggle'); },

    // Save location controls (UI only, download uses chrome.downloads)
    get saveLocation() { return safeGetElement('saveLocation'); },
    get customPathGroup() { return safeGetElement('customPathGroup'); },
    get customPath() { return safeGetElement('customPath'); },
    get browsePathBtn() { return safeGetElement('browsePathBtn'); },

    // Header Download button
    get downloadHeaderBtn() { return safeGetElement('downloadHeaderBtn'); },
    // Scrape links button
    get scrapeLinksBtn() { return safeGetElement('scrapeLinksBtn'); },
  };

  // State
  let rawContent = '';
  let processedData = null;
  let currentUrl = '';
  let currentTitle = '';
  let settingsVisible = false;

  // Initialize text processor
  const textProcessor = new TextProcessor();

  // Logger utility
  const Logger = {
    error: (message, error, context = {}) => {
      console.error('Extension Error:', {
        timestamp: new Date().toISOString(),
        message,
        error: error?.message || error,
        stack: error?.stack,
        context,
        userAgent: navigator.userAgent,
        extensionVersion: chrome.runtime.getManifest().version
      });
    },
    warn: (message, context = {}) => console.warn('Extension Warning:', { message, context, timestamp: new Date().toISOString() }),
    info: (message, context = {}) => console.info('Extension Info:', { message, context, timestamp: new Date().toISOString() }),
  };

  // Views
  function showView(view) {
    const views = ['loading', 'error', 'content', 'welcome'];
    views.forEach(v => {
      const el = document.getElementById(v + 'Div');
      if (el) el.classList.toggle('hidden', v !== view);
    });
    if (view === 'loading') {
      const lt = document.getElementById('loadingText');
      if (lt) lt.textContent = 'Processing...';
    }
  }

  function showError(message) {
    if (elements.errorMessage) elements.errorMessage.textContent = message || 'An unknown error occurred';
    showView('error');
  }

  function updateStats(text) {
    const t = typeof text === 'string' ? text : '';
    const words = t.trim() ? t.trim().split(/\s+/).length : 0;
    const chars = t.length;
    if (elements.wordCount) elements.wordCount.textContent = `${words.toLocaleString()} words`;
    if (elements.charCount) elements.charCount.textContent = `${chars.toLocaleString()} characters`;
  }

  function sanitizeFilename(filename) {
    return filename.replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').substring(0, 80).toLowerCase();
  }

  function generateTitleFilename(format = 'clean') {
    let base = currentTitle || '';
    if (!base) {
      try { base = new URL(currentUrl).hostname; } catch { base = 'webpage-text'; }
    }
    const ext = format === 'json' ? '.json' : '.txt';
    return `${sanitizeFilename(base)}${ext}`;
  }

  // Try to derive an actual PDF URL from the tab URL (supports Chrome's built-in viewer)
  function derivePdfUrl(tabUrl) {
    try {
      if (!tabUrl) return '';
      const u = new URL(tabUrl);
      // Direct PDF only if the path ends with .pdf
      if (u.pathname && u.pathname.toLowerCase().endsWith('.pdf')) {
        return u.toString();
      }
      // Chrome/Edge PDF viewer: src= or file= query contains the real URL
      if (u.protocol === 'chrome-extension:' || u.protocol === 'edge:') {
        const q = u.searchParams.get('src') || u.searchParams.get('file') || '';
        if (!q) return '';
        const qUrl = new URL(q, tabUrl);
        if ((qUrl.protocol === 'http:' || qUrl.protocol === 'https:') &&
            qUrl.pathname.toLowerCase().endsWith('.pdf')) {
          return qUrl.toString();
        }
      }
      return '';
    } catch (_) {
      return '';
    }
  }

  function toggleSettings() {
    settingsVisible = !settingsVisible;
    if (elements.settingsDiv) elements.settingsDiv.classList.toggle('hidden', !settingsVisible);
    if (elements.settingsBtn) elements.settingsBtn.classList.toggle('active', settingsVisible);
  }

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

  function saveFullPagePreferences() {
    chrome.storage.local.set({
      ui_fullPage: !!elements.fullPageExtract?.checked,
      ui_excludeBoilerplate: !!elements.excludeBoilerplate?.checked,
      ui_includeMetadata: !!elements.includeMetadataToggle?.checked
    });
  }

  async function loadPreferences() {
    try {
      const result = await chrome.storage.local.get([
        'saveLocation',
        'customSavePath',
        'ui_removeDuplicates',
        'ui_removeUrls',
        'ui_removeNumbers',
        'ui_removeStopWords',
        'ui_extractSections',
        'ui_extractKeyPhrases',
        'ui_includeHidden',
        'ui_autoScroll',
        'ui_outputFormat',
        'ui_fullPage',
        'ui_excludeBoilerplate',
        'ui_includeMetadata'
      ]);

      if (elements.saveLocation && typeof result.saveLocation === 'string') elements.saveLocation.value = result.saveLocation;
      if (elements.customPath && typeof result.customSavePath === 'string') elements.customPath.value = result.customSavePath;

      if (elements.removeDuplicates && typeof result.ui_removeDuplicates === 'boolean') elements.removeDuplicates.checked = result.ui_removeDuplicates;
      if (elements.removeUrls && typeof result.ui_removeUrls === 'boolean') elements.removeUrls.checked = result.ui_removeUrls;
      if (elements.removeNumbers && typeof result.ui_removeNumbers === 'boolean') elements.removeNumbers.checked = result.ui_removeNumbers;
      if (elements.removeStopWords && typeof result.ui_removeStopWords === 'boolean') elements.removeStopWords.checked = result.ui_removeStopWords;
      if (elements.extractSections && typeof result.ui_extractSections === 'boolean') elements.extractSections.checked = result.ui_extractSections;
      if (elements.extractKeyPhrases && typeof result.ui_extractKeyPhrases === 'boolean') elements.extractKeyPhrases.checked = result.ui_extractKeyPhrases;

      const includeHiddenEl = document.getElementById('includeHidden');
      const autoScrollEl = document.getElementById('autoScroll');
      if (includeHiddenEl && typeof result.ui_includeHidden === 'boolean') includeHiddenEl.checked = result.ui_includeHidden;
      if (autoScrollEl && typeof result.ui_autoScroll === 'boolean') autoScrollEl.checked = result.ui_autoScroll;

      if (elements.outputFormat && typeof result.ui_outputFormat === 'string') elements.outputFormat.value = result.ui_outputFormat;

      if (elements.fullPageExtract && typeof result.ui_fullPage === 'boolean') elements.fullPageExtract.checked = result.ui_fullPage;
      if (elements.excludeBoilerplate && typeof result.ui_excludeBoilerplate === 'boolean') elements.excludeBoilerplate.checked = result.ui_excludeBoilerplate;
      if (elements.includeMetadataToggle && typeof result.ui_includeMetadata === 'boolean') elements.includeMetadataToggle.checked = result.ui_includeMetadata;
    } catch (error) {
      console.error('Error loading preferences:', error);
    }
  }

  // Extraction Core
  let extractionInProgress = false;
  let lastExtractionTime = 0;
  const EXTRACTION_COOLDOWN = 1000; // ms

  async function extractText() {
    const now = Date.now();
    if (extractionInProgress) {
      Logger.warn('Extraction already in progress');
      return;
    }
    if (now - lastExtractionTime < EXTRACTION_COOLDOWN) {
      showError('Please wait a moment before extracting again');
      return;
    }
    extractionInProgress = true;
    lastExtractionTime = now;

    try {
      showView('loading');
      Logger.info('Starting text extraction');

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) throw new Error('No active tab found');

      const restrictedProtocols = ['chrome://', 'chrome-extension://', 'edge://', 'about:', 'moz-extension://', 'file://'];
      const urlStr = tab.url || '';

      // If this tab represents a PDF (direct or via built-in viewer), extract via background
      const pdfCandidate = derivePdfUrl(urlStr);
      if (pdfCandidate) {
        currentUrl = pdfCandidate;
        currentTitle = tab.title || currentTitle;

        const pdfResp = await Promise.race([
          chrome.runtime.sendMessage({ type: 'extractPdfText', url: pdfCandidate }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('PDF extraction timeout')), 30000))
        ]);
        if (!pdfResp || !pdfResp.ok || !pdfResp.text) {
          throw new Error(pdfResp?.error || 'Failed to extract text from PDF');
        }

        rawContent = pdfResp.text;
        const options = getProcessingOptions();
        try {
          processedData = rawContent.length > 50000
            ? textProcessor.processLargeText(rawContent, options)
            : textProcessor.processForLLM(rawContent, options);
        } catch (processingError) {
          Logger.error('PDF text processing failed', processingError);
          throw new Error('Failed to process PDF text: ' + processingError.message);
        }

        updateDisplayedContent();
        showView('content');
        elements.extractedText?.focus();
        return;
      }

      if (restrictedProtocols.some(p => urlStr.startsWith(p))) {
        throw new Error('Cannot extract text from this type of page (system/local pages are restricted)');
      }

      currentUrl = urlStr;
      currentTitle = tab.title || '';

      // Ensure content script available
      const maxAttempts = 3;
      let contentScriptReady = false;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const pingResponse = await Promise.race([
            chrome.tabs.sendMessage(tab.id, { action: 'ping' }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Ping timeout')), 1500))
          ]);
          if (pingResponse && pingResponse.success) {
            if (pingResponse.version !== '3') {
              await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
              await new Promise(r => setTimeout(r, 400));
            }
            contentScriptReady = true;
            break;
          }
        } catch (err) {
          if (attempt < maxAttempts) {
            try {
              await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
              await new Promise(r => setTimeout(r, 500));
            } catch (injErr) {
              if (attempt === maxAttempts) throw new Error('Failed to inject content script after multiple attempts. Please refresh the page and try again.');
            }
          }
        }
      }
      if (!contentScriptReady) throw new Error('Content script not available after all attempts. Please refresh the page and try again.');

      const includeHidden = !!document.getElementById('includeHidden')?.checked;
      const autoScroll = !!document.getElementById('autoScroll')?.checked;
      const fullPage = !!elements.fullPageExtract?.checked;
      const excludeBoilerplate = !!elements.excludeBoilerplate?.checked;
      const includeMetadata = !!elements.includeMetadataToggle?.checked;

      chrome.storage.local.set({
        ui_includeHidden: includeHidden,
        ui_autoScroll: autoScroll,
        ui_fullPage: fullPage,
        ui_excludeBoilerplate: excludeBoilerplate,
        ui_includeMetadata: includeMetadata
      });

      // Ask content script to extract
      let response;
      try {
        response = await Promise.race([
          fullPage
            ? chrome.tabs.sendMessage(tab.id, { action: 'extractStructured', includeHidden, autoScroll, excludeBoilerplate, includeMetadata })
            : chrome.tabs.sendMessage(tab.id, { action: 'extractText', includeHidden, autoScroll }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Extraction timeout - page took too long to respond')), 20000))
        ]);
        if (!response) throw new Error('No response from content script');
        if (!response.success) throw new Error(response.error || 'Content script reported failure');

        rawContent = response.text;
        if (response.title && !currentTitle) currentTitle = response.title;
        if (!rawContent || typeof rawContent !== 'string' || rawContent.trim().length === 0) {
          throw new Error('Empty or invalid content from content script');
        }
      } catch (csError) {
        Logger.warn('Content script extraction failed', { error: csError.message });
        throw csError; // No network fallback to avoid CSP/connect-src issues
      }

      // Process content
      const options = getProcessingOptions();
      try {
        if (rawContent.length > 50000) {
          processedData = textProcessor.processLargeText(rawContent, options);
        } else {
          processedData = textProcessor.processForLLM(rawContent, options);
        }
      } catch (processingError) {
        Logger.error('Text processing failed', processingError);
        throw new Error('Failed to process extracted text: ' + processingError.message);
      }

      updateDisplayedContent();
      showView('content');
      elements.extractedText?.focus();
    } catch (error) {
      Logger.error('Text extraction failed', error, { url: currentUrl });
      let errorMessage = error.message || 'An error occurred while extracting text';
      if (/establish connection|Receiving end does not exist/i.test(errorMessage)) {
        errorMessage = 'Content script connection failed. Please refresh the page and try again.';
      } else if (/Cannot access|Cannot extract text from this type/i.test(errorMessage)) {
        errorMessage = 'Cannot access this page. Chrome system pages and local files are restricted.';
      } else if (/timeout/i.test(errorMessage)) {
        errorMessage = 'Request timed out. The page may be loading or unresponsive. Please try again.';
      }
      showError(errorMessage);
    } finally {
      extractionInProgress = false;
    }
  }

  // Batch-scrape external links from current page
  async function scrapeLinksFromPage() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) throw new Error('No active tab found');
      const urlStr = tab.url || '';
      const restrictedProtocols = ['chrome://', 'chrome-extension://', 'edge://', 'about:', 'moz-extension://', 'file://'];
      if (restrictedProtocols.some(p => urlStr.startsWith(p))) {
        throw new Error('Cannot run on this page type');
      }

      // Ensure content script is ready
      const maxAttempts = 3;
      let ready = false;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const ping = await Promise.race([
            chrome.tabs.sendMessage(tab.id, { action: 'ping' }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Ping timeout')), 1500))
          ]);
          if (ping && ping.success) { ready = true; break; }
        } catch {
          if (attempt < maxAttempts) {
            try {
              await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
              await new Promise(r => setTimeout(r, 400));
            } catch (injErr) {
              if (attempt === maxAttempts) throw injErr;
            }
          }
        }
      }
      if (!ready) throw new Error('Content script not available');

      // Trigger scraping via content script
      const limit = 10;           // max links to follow
      const onlySameHost = true;  // set to false to allow off-site links
      showView('loading');
      const lt = document.getElementById('loadingText');
      if (lt) lt.textContent = `Scraping up to ${limit} links...`;

      const resp = await Promise.race([
        chrome.tabs.sendMessage(tab.id, { action: 'scrapeExternalLinks', limit, onlySameHost }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Scrape timeout')), 60000))
      ]);
      if (!resp || !resp.success) throw new Error(resp?.error || 'Scrape failed');

      // Success: background worker downloads files and closes tabs
      showView('welcome');
    } catch (e) {
      Logger.error('Scrape links failed', e);
      showError(e.message || 'Scrape failed');
    }
  }

  // Processing
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

  function updateDisplayedContent() {
    if (!processedData) return;
    const fmt = elements.outputFormat?.value || 'clean';
    let displayContent = '';
    switch (fmt) {
      case 'raw':
        displayContent = rawContent;
        break;
      case 'clean':
        displayContent = processedData.processedText;
        break;
      case 'json':
        displayContent = textProcessor.createJSONFormat(processedData);
        break;
      default:
        displayContent = processedData.processedText;
    }
    if (elements.extractedText) {
      elements.extractedText.value = displayContent;
      elements.extractedText.setAttribute('data-filename', generateTitleFilename(fmt));
    }
    updateStatsWithProcessing(displayContent);
  }

  function updateStatsWithProcessing(content) {
    const words = content.trim().split(/\s+/).filter(Boolean).length;
    const chars = content.length;
    if (elements.wordCount) elements.wordCount.textContent = `${words.toLocaleString()} words`;
    if (elements.charCount) {
      elements.charCount.textContent = `${chars.toLocaleString()} characters`;
      if (processedData?.stats?.compressionRatio != null) {
        elements.charCount.textContent += ` (${(processedData.stats.compressionRatio * 100).toFixed(1)}% of original)`;
      }
    }
  }

  // Clipboard
  async function copyToClipboard() {
    try {
      const ta = elements.extractedText;
      if (!ta) { showError('Text area not found'); return; }
      const text = ta.value || '';
      if (!text.trim()) { showError('No content to copy'); return; }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        ta.select();
        const ok = document.execCommand('copy');
        if (!ok) throw new Error('Copy command failed');
        ta.blur();
      }
      if (elements.copyBtn) {
        const label = document.getElementById('copyBtnLabel');
        const original = label?.textContent;
        elements.copyBtn.classList.add('copied');
        if (label) label.textContent = 'Copied!';
        setTimeout(() => {
          elements.copyBtn?.classList.remove('copied');
          if (label && original) label.textContent = original;
        }, 1500);
      }
    } catch (e) {
      Logger.error('Failed to copy text', e);
      showError('Failed to copy text to clipboard: ' + e.message);
    }
  }

  // Downloads (always via background for reliability; includes page URL at top)
  async function downloadAsFile() {
    try {
      const content = elements.extractedText?.value || '';
      if (!content.trim()) { showError('No content to save'); return; }
      const filename = generateTitleFilename(elements.outputFormat?.value || 'clean');
      const payload = `URL: ${currentUrl}\n\n${content}`;
      const resp = await chrome.runtime.sendMessage({ type: 'downloadText', filename, text: payload });
      if (!resp?.ok) throw new Error(resp?.error || 'Background download failed');
      showSaveSuccess(filename);
    } catch (e) {
      Logger.error('Download error', e);
      showError('Failed to save file: ' + e.message);
    }
  }

  function showSaveSuccess(filename) {
    if (elements.downloadBtn) {
      const label = document.getElementById('downloadBtnLabel');
      const original = label?.textContent;
      if (label) label.textContent = 'Saved!';
      elements.downloadBtn.style.background = '#28a745';
      setTimeout(() => {
        if (elements.downloadBtn) {
          if (label && original) label.textContent = original;
          elements.downloadBtn.style.background = '';
        }
      }, 1500);
    }
  }

  // UI helpers
  function clearContent() {
    rawContent = '';
    processedData = null;
    if (elements.extractedText) {
      elements.extractedText.value = '';
      elements.extractedText.removeAttribute('data-filename');
    }
    updateStats('');
    showView('welcome');
  }

  function handleOutputFormatChange() {
    try {
      const fmt = elements.outputFormat?.value || 'clean';
      chrome.storage.local.set({ ui_outputFormat: fmt });
    } catch {}
    updateDisplayedContent();
  }

  function handleProcessingChange() {
    saveProcessingPreferencesToStorage();
    processCurrentContent();
  }

  function handleSaveLocationChange() {
    const isCustom = elements.saveLocation?.value === 'custom';
    if (elements.customPathGroup) elements.customPathGroup.classList.toggle('hidden', !isCustom);
    chrome.storage.local.set({ saveLocation: elements.saveLocation?.value || 'downloads' });
  }

  // Bind events
  function bindEventListeners() {
    if (elements.extractBtn) elements.extractBtn.addEventListener('click', debounce(extractText, 400));
    if (elements.downloadHeaderBtn) elements.downloadHeaderBtn.addEventListener('click', debounce(downloadAsFile, 400));
    if (elements.settingsBtn) {
      elements.settingsBtn.addEventListener('click', async () => {
        try {
          const resp = await chrome.runtime.sendMessage({ type: 'openOptionsPage' });
          if (!resp?.ok) throw new Error(resp?.error || 'openOptionsPage failed');
        } catch (e) {
          Logger.error('Failed to open options page', e);
          showError('Could not open Settings');
        }
      });
    }
    if (elements.copyBtn) elements.copyBtn.addEventListener('click', debounce(copyToClipboard, 250));
    if (elements.downloadBtn) elements.downloadBtn.addEventListener('click', debounce(downloadAsFile, 400));
    if (elements.scrapeLinksBtn) elements.scrapeLinksBtn.addEventListener('click', debounce(scrapeLinksFromPage, 400));
    if (elements.clearBtn) elements.clearBtn.addEventListener('click', clearContent);

    if (elements.saveLocation) elements.saveLocation.addEventListener('change', handleSaveLocationChange);
    if (elements.browsePathBtn) {
      elements.browsePathBtn.addEventListener('click', () => {
        // UI only; downloads use chrome.downloads in background for compatibility
        showError('Custom folder picker not supported in popup. Files will be saved to Downloads.');
      });
    }

    if (elements.outputFormat) elements.outputFormat.addEventListener('change', handleOutputFormatChange);

    // Full-page extraction toggles
    if (elements.fullPageExtract) elements.fullPageExtract.addEventListener('change', saveFullPagePreferences);
    if (elements.excludeBoilerplate) elements.excludeBoilerplate.addEventListener('change', saveFullPagePreferences);
    if (elements.includeMetadataToggle) elements.includeMetadataToggle.addEventListener('change', saveFullPagePreferences);

    // Settings checkboxes with debouncing
    [elements.removeDuplicates, elements.removeUrls, elements.removeNumbers,
     elements.removeStopWords, elements.extractSections, elements.extractKeyPhrases]
      .filter(Boolean)
      .forEach(el => el.addEventListener('change', debounce(handleProcessingChange, 250)));

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'e') {
          e.preventDefault();
          if (!extractionInProgress) extractText();
        } else if (e.key === 'c') {
          if (elements.contentDiv && !elements.contentDiv.classList.contains('hidden')) {
            e.preventDefault();
            copyToClipboard();
          }
        } else if (e.key === 's') {
          if (elements.contentDiv && !elements.contentDiv.classList.contains('hidden')) {
            e.preventDefault();
            downloadAsFile();
          }
        }
      }
    });
  }

  function debounce(fn, delay) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, args), delay);
    };
  }

  // Init
  async function init() {
    try {
      await loadPreferences();
      showView('welcome');
      bindEventListeners();
      if (elements.extractBtn) elements.extractBtn.focus();
    } catch (e) {
      Logger.error('Popup initialization failed', e);
      showError('Extension initialization failed: ' + e.message);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
