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
  let settingsVisible = false;
  let customSavePath = '';
  let directoryHandle = null;
  
  // Rate limiting and debouncing
  let extractionInProgress = false;
  let extractionTimeout = null;
  let lastExtractionTime = 0;
  const EXTRACTION_COOLDOWN = 1000; // 1 second between extractions
  
  // Initialize text processor
  const textProcessor = new TextProcessor();

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
      Logger.info('Attempting extraction from URL', { url: currentUrl });

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

      // Send extraction message with extended timeout
      Logger.info('Sending extraction request to content script');
      const response = await Promise.race([
        chrome.tabs.sendMessage(tab.id, { action: 'extractText' }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Extraction timeout - page took too long to respond')), 8000)
        )
      ]);

      if (!response) {
        throw new Error('No response from content script');
      }

      if (!response.success) {
        throw new Error(response.error || 'Content script reported failure');
      }

      // Validate extracted content
      rawContent = response.text;
      if (!rawContent || typeof rawContent !== 'string') {
        throw new Error('Invalid response format from content script');
      }
      
      if (rawContent.trim().length === 0) {
        throw new Error('No visible text found on this page');
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
      updateDisplayedContent();
      
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
        const originalText = elements.copyBtn.innerHTML;
        elements.copyBtn.classList.add('copied');
        elements.copyBtn.innerHTML = originalText.replace('Copy All', 'Copied!');
        
        setTimeout(() => {
          if (elements.copyBtn) {
            elements.copyBtn.classList.remove('copied');
            elements.copyBtn.innerHTML = originalText;
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
      const contentToDownload = elements.extractedText.value;
      
      if (!contentToDownload.trim()) {
        showError('No content to save');
        return;
      }
      
      // Get filename from data attribute or generate one
      let filename = elements.extractedText.getAttribute('data-filename') || 'webpage-text';
      
      // Ensure proper extension
      const format = elements.outputFormat.value;
      if (format === 'json' && !filename.endsWith('.json')) {
        filename += '.json';
      } else if (!filename.endsWith('.txt') && format !== 'json') {
        filename += '.txt';
      }
      
      // Sanitize filename
      filename = sanitizeFilename(filename.replace(/\.(txt|json)$/, '')) + 
                 (format === 'json' ? '.json' : '.txt');
      
      const saveLocation = elements.saveLocation.value;
      
      if (saveLocation === 'custom' && directoryHandle) {
        // Use File System Access API for custom path
        await saveToCustomPath(contentToDownload, filename, format);
      } else {
        // Use Chrome Downloads API for default location
        await saveToDownloads(contentToDownload, filename, format);
      }
      
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
      const originalText = elements.downloadBtn.innerHTML;
      elements.downloadBtn.innerHTML = originalText.replace('Download', 'Saved!');
      elements.downloadBtn.style.background = '#28a745';
      
      setTimeout(() => {
        if (elements.downloadBtn) {
          elements.downloadBtn.innerHTML = originalText;
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
  function updateDisplayedContent() {
    if (!processedData) return;
    
    const format = elements.outputFormat.value;
    let displayContent = '';
    let filename = 'extracted-text';
    
    switch (format) {
      case 'raw':
        displayContent = rawContent;
        filename = 'raw-text';
        break;
      case 'clean':
        displayContent = processedData.processedText;
        filename = 'clean-text';
        break;
      case 'llm':
        displayContent = textProcessor.createLLMFormat(processedData);
        filename = 'llm-format';
        break;
      case 'json':
        displayContent = textProcessor.createJSONFormat(processedData);
        filename = 'structured-data.json';
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
  function init() {
    try {
      Logger.info('Initializing popup');
      
      // Load saved preferences
      loadPreferences();
      
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
   * Bind event listeners with null safety
   */
  function bindEventListeners() {
    // Primary action listeners
    if (elements.extractBtn) {
      elements.extractBtn.addEventListener('click', debounce(extractText, 500));
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
    
    // Settings change listeners
    if (elements.outputFormat) {
      elements.outputFormat.addEventListener('change', updateDisplayedContent);
    }
    
    // Settings checkboxes with debouncing
    [elements.removeDuplicates, elements.removeUrls, elements.removeNumbers,
     elements.removeStopWords, elements.extractSections, elements.extractKeyPhrases]
      .filter(el => el) // Filter out null elements
      .forEach(el => el.addEventListener('change', debounce(processCurrentContent, 300)));

    // Keyboard shortcuts with improved safety
    document.addEventListener('keydown', handleKeyboardShortcuts);
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