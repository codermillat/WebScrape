// Content script for extracting text from web pages
(function() {
  'use strict';

  /**
   * Check if an element is visible
   */
  function isElementVisible(element) {
    if (!element) return false;
    
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && 
           style.visibility !== 'hidden' && 
           style.opacity !== '0' &&
           element.offsetHeight > 0 &&
           element.offsetWidth > 0;
  }

  /**
   * Check if element is likely an ad or unwanted content
   */
  function isUnwantedElement(element) {
    const unwantedSelectors = [
      'script', 'style', 'noscript', 'iframe', 'object', 'embed',
      '[class*="ad"]', '[id*="ad"]', '[class*="ads"]', '[id*="ads"]',
      '[class*="advertisement"]', '[class*="sponsor"]', '[class*="promo"]',
      '.sidebar', '.footer', '.header', '.nav', '.navigation', '.menu'
    ];
    
    for (const selector of unwantedSelectors) {
      if (element.matches && element.matches(selector)) {
        return true;
      }
    }
    
    const className = element.className || '';
    const id = element.id || '';
    const unwantedKeywords = ['ad', 'ads', 'advertisement', 'sponsor', 'promo', 'banner'];
    
    return unwantedKeywords.some(keyword => 
      className.toLowerCase().includes(keyword) || 
      id.toLowerCase().includes(keyword)
    );
  }

  /**
   * Clean and normalize text
   */
  function cleanText(text) {
    return text
      .replace(/\s+/g, ' ')
      .replace(/[\r\n]+/g, ' ')
      .trim();
  }

  /**
   * Extract text content from the page
   */
  function extractPageContent() {
    const content = {
      title: '',
      headings: [],
      paragraphs: [],
      lists: [],
      links: []
    };

    // Extract title
    const titleElement = document.querySelector('title');
    if (titleElement) {
      content.title = cleanText(titleElement.textContent);
    }

    // Extract headings (h1-h6)
    const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    headings.forEach(heading => {
      if (isElementVisible(heading) && !isUnwantedElement(heading)) {
        const text = cleanText(heading.textContent);
        if (text.length > 0) {
          content.headings.push({
            level: heading.tagName.toLowerCase(),
            text: text
          });
        }
      }
    });

    // Extract paragraphs
    const paragraphs = document.querySelectorAll('p');
    paragraphs.forEach(p => {
      if (isElementVisible(p) && !isUnwantedElement(p)) {
        const text = cleanText(p.textContent);
        if (text.length > 0) {
          content.paragraphs.push(text);
        }
      }
    });

    // Extract list items
    const listItems = document.querySelectorAll('li');
    listItems.forEach(li => {
      if (isElementVisible(li) && !isUnwantedElement(li)) {
        const text = cleanText(li.textContent);
        if (text.length > 0) {
          content.lists.push(text);
        }
      }
    });

    // Extract links
    const links = document.querySelectorAll('a[href]');
    links.forEach(link => {
      if (isElementVisible(link) && !isUnwantedElement(link)) {
        const text = cleanText(link.textContent);
        const href = link.href;
        if (text.length > 0 && href) {
          content.links.push({
            text: text,
            url: href
          });
        }
      }
    });

    return content;
  }

  /**
   * Format extracted content into readable text
   */
  function formatContentAsText(content) {
    let formattedText = '';

    // Add title
    if (content.title) {
      formattedText += content.title + '\n';
      formattedText += '='.repeat(content.title.length) + '\n\n';
    }

    // Add headings and create sections
    const processedParagraphs = new Set();
    
    content.headings.forEach(heading => {
      formattedText += heading.text + '\n';
      formattedText += '-'.repeat(Math.min(heading.text.length, 50)) + '\n\n';
    });

    // Add paragraphs
    if (content.paragraphs.length > 0) {
      content.paragraphs.forEach(paragraph => {
        if (!processedParagraphs.has(paragraph) && paragraph.length > 10) {
          formattedText += paragraph + '\n\n';
          processedParagraphs.add(paragraph);
        }
      });
    }

    // Add list items
    if (content.lists.length > 0) {
      formattedText += 'Key Points:\n';
      content.lists.forEach(item => {
        if (item.length > 5) {
          formattedText += '• ' + item + '\n';
        }
      });
      formattedText += '\n';
    }

    // Add links
    if (content.links.length > 0) {
      formattedText += 'Links:\n';
      const processedLinks = new Set();
      content.links.forEach(link => {
        const linkStr = `[${link.text}] - ${link.url}`;
        if (!processedLinks.has(linkStr) && link.text.length > 2) {
          formattedText += linkStr + '\n';
          processedLinks.add(linkStr);
        }
      });
    }

    return formattedText.trim();
  }

  // Prevent multiple script injections
  if (window.webTextExtractorContentScript) {
    console.log('Content script already loaded, skipping re-injection');
    return;
  }
  window.webTextExtractorContentScript = true;

  // Listen for messages from popup with enhanced error handling
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Content script received message:', request);
    
    try {
      if (request.action === 'ping') {
        sendResponse({ success: true, message: 'Content script is ready' });
        return true;
      }
      
      if (request.action === 'extractText') {
        try {
          // Check if page is still loading
          if (document.readyState === 'loading') {
            console.warn('Page still loading, waiting...');
            document.addEventListener('DOMContentLoaded', () => {
              performExtraction(sendResponse);
            });
            return true; // Keep channel open
          }
          
          performExtraction(sendResponse);
          return true; // Keep message channel open for async response
        } catch (error) {
          console.error('Content script extraction error:', error);
          sendResponse({
            success: false,
            error: error.message || 'Unknown extraction error'
          });
        }
      }
    } catch (error) {
      console.error('Content script message handling error:', error);
      sendResponse({
        success: false,
        error: 'Message handling failed: ' + error.message
      });
    }
    
    return true; // Always keep channel open
  });

  /**
   * Perform the actual text extraction
   */
  function performExtraction(sendResponse) {
    try {
      const content = extractPageContent();
      const formattedText = formatContentAsText(content);
      
      if (!formattedText || formattedText.trim().length === 0) {
        sendResponse({
          success: false,
          error: 'No readable content found on this page'
        });
        return;
      }
      
      console.log('Content extracted successfully, length:', formattedText.length);
      
      sendResponse({
        success: true,
        text: formattedText,
        url: window.location.href,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Text extraction failed:', error);
      sendResponse({
        success: false,
        error: error.message || 'Text extraction failed'
      });
    }
  }

  // Log when content script loads
  console.log('Web Text Extractor content script loaded on:', window.location.href);

})(); 