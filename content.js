// Content script for extracting text from web pages
(function() {
  'use strict';

  // Increment this when content script behavior changes
  const CONTENT_SCRIPT_VERSION = '2';

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
    // Preserve newlines to keep rows/labels separate; trim spaces within lines
    const normalized = text
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map(line => line.replace(/\s+/g, ' ').trim())
      .filter(line => line.length > 0)
      .join('\n');
    return normalized;
  }

  function shouldIncludeElement(el, includeHidden) {
    if (!el) return false;
    if (isUnwantedElement(el)) return false;
    return includeHidden || isElementVisible(el);
  }

  // Scroll through the page to trigger lazy-loaded content
  async function preloadLazyContent() {
    try {
      const total = Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0, window.innerHeight * 2);
      const step = Math.max(300, Math.floor(window.innerHeight * 0.9));
      for (let y = 0; y < total; y += step) {
        window.scrollTo(0, y);
        await new Promise(r => setTimeout(r, 80));
      }
      window.scrollTo(0, 0);
      await new Promise(r => setTimeout(r, 80));
    } catch (_) {
      // ignore
    }
  }

  // Extract in DOM order to preserve context for LLMs
  function extractDomOrderedText(includeHidden = false) {
    const selector = [
      'h1','h2','h3','h4','h5','h6',
      'p','li','table','blockquote','dt','dd','figcaption'
    ].join(',');
    const nodes = Array.from(document.querySelectorAll(selector));
    const lines = [];
    let last = '';

    nodes.forEach(node => {
      if (!shouldIncludeElement(node, includeHidden)) return;

      if (node.tagName === 'TABLE') {
        const tblRows = [];
        const trs = node.querySelectorAll('tr');
        trs.forEach(tr => {
          const cells = Array.from(tr.querySelectorAll('th,td'))
            .map(c => cleanText(c.textContent).replace(/\s*:\s*$/,'').replace(/^[:\-\s]+/,''))
            .filter(Boolean);
          if (cells.length === 2) {
            tblRows.push(`${cells[0]}: ${cells[1]}`);
          } else if (cells.length > 0) {
            tblRows.push(cells.join(' | '));
          }
        });
        if (tblRows.length) {
          tblRows.forEach(row => {
            if (row && row !== last) {
              lines.push(row);
              last = row;
            }
          });
        }
        return;
      }

      let text = cleanText(node.textContent || '');
      if (!text) return;
      if (node.tagName === 'LI') {
        text = `• ${text}`;
      }
      if (text && text !== last) {
        lines.push(text);
        last = text;
      }
    });

    return lines.join('\n');
  }

  // Extract course/fee tables from a parsed Document (used for view-source:)
  function extractFeesFromParsedDoc(doc) {
    try {
      const tables = Array.from(doc.querySelectorAll('table'));
      const feeLines = [];
      tables.forEach(table => {
        const rows = Array.from(table.querySelectorAll('tr'));
        if (rows.length < 2) return;
        const headerCells = Array.from(rows[0].querySelectorAll('th,td')).map(c => (c.textContent||'').trim().toLowerCase());
        const headerJoined = headerCells.join(' ');
        // Heuristics: identify fee tables
        const looksLikeFees = /fee|year|semester/.test(headerJoined) ||
                              (headerCells.includes('programme') || headerCells.includes('program') || headerCells.includes('course'));
        if (!looksLikeFees) return;

        // Collect column indices
        const colNames = headerCells.map(h => h.replace(/\s+/g,' '));
        feeLines.push('');
        rows.slice(1).forEach(r => {
          const cols = Array.from(r.querySelectorAll('td,th')).map(c => (c.textContent||'').replace(/\s+/g,' ').trim());
          if (cols.every(v => !v)) return;
          let name = cols[0];
          // Some tables may have program name in second column
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
          if (name && parts.length) {
            feeLines.push(`${name} — ${parts.join(', ')}`);
          } else if (name) {
            feeLines.push(name);
          }
        });
      });
      return feeLines.filter(Boolean).join('\n').trim();
    } catch (_) {
      return '';
    }
  }

  /**
   * Extract text content from the page
   * includeHidden: when true, include elements even if not visible (still skip unwanted)
   */
  function extractPageContent(includeHidden = false) {
    const content = {
      title: '',
      headings: [],
      paragraphs: [],
      lists: [],
      links: [],
      tables: []
    };

    // Extract title
    const titleElement = document.querySelector('title');
    if (titleElement) {
      content.title = cleanText(titleElement.textContent);
    }

    // Extract headings (h1-h6)
    const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    headings.forEach(heading => {
      if ((includeHidden || isElementVisible(heading)) && !isUnwantedElement(heading)) {
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
      if ((includeHidden || isElementVisible(p)) && !isUnwantedElement(p)) {
        const text = cleanText(p.textContent);
        if (text.length > 0) {
          content.paragraphs.push(text);
        }
      }
    });

    // Extract list items
    const listItems = document.querySelectorAll('li');
    listItems.forEach(li => {
      if ((includeHidden || isElementVisible(li)) && !isUnwantedElement(li)) {
        const text = cleanText(li.textContent);
        if (text.length > 0) {
          content.lists.push(text);
        }
      }
    });

    // Extract links
    const links = document.querySelectorAll('a[href]');
    links.forEach(link => {
      if ((includeHidden || isElementVisible(link)) && !isUnwantedElement(link)) {
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

    // Extract visible tables (fees and other structured data)
    const tables = document.querySelectorAll('table');
    tables.forEach(table => {
      if (!includeHidden && !isElementVisible(table)) return;
      if (isUnwantedElement(table)) return;

      const rows = [];
      const trList = table.querySelectorAll('tr');
      trList.forEach(tr => {
        const cells = Array.from(tr.querySelectorAll('th, td'))
          .map(cell => cleanText(cell.textContent).replace(/\s*:\s*$/,'').replace(/^[:\-\s]+/,'').replace(/\s+\|\s+/g,' '))
          .filter(t => t.length > 0);
        if (cells.length > 0) rows.push(cells);
      });

      if (rows.length === 0) return;

      // Try to find a nearby heading/caption for context
      let caption = '';
      const capEl = table.querySelector('caption');
      if (capEl) caption = cleanText(capEl.textContent);
      if (!caption) {
        // look backwards up to 5 siblings for a heading
        let sib = table.previousElementSibling;
        let hops = 0;
        while (sib && hops < 6 && !caption) {
          if (/^H[1-6]$/.test(sib.tagName)) {
            caption = cleanText(sib.textContent);
            break;
          }
          sib = sib.previousElementSibling;
          hops += 1;
        }
      }

      content.tables.push({ caption, rows });
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

    // Add tabular data (fees etc.)
    if (content.tables && content.tables.length > 0) {
      formattedText += 'Tabular Data (Extracted):\n';
      content.tables.forEach(tbl => {
        if (tbl.caption) {
          formattedText += tbl.caption + '\n';
          formattedText += '-'.repeat(Math.min(tbl.caption.length, 50)) + '\n';
        }
        // Decide formatting by column count
        const maxCols = Math.max(...tbl.rows.map(r => r.length));
        tbl.rows.forEach(r => {
          if (maxCols === 2 && r.length === 2) {
            formattedText += `${r[0]}: ${r[1]}\n`;
          } else {
            formattedText += r.join(' | ') + '\n';
          }
        });
        formattedText += '\n';
      });
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
        sendResponse({ success: true, message: 'Content script is ready', version: CONTENT_SCRIPT_VERSION });
        return true;
      }
      
      if (request.action === 'extractText') {
        try {
          // Check if page is still loading
          if (document.readyState === 'loading') {
            console.warn('Page still loading, waiting...');
            document.addEventListener('DOMContentLoaded', () => {
              performExtraction(sendResponse, request.includeHidden === true, request.autoScroll === true);
            });
            return true; // Keep channel open
          }
          
          performExtraction(sendResponse, request.includeHidden === true, request.autoScroll === true);
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
  async function performExtraction(sendResponse, includeHidden = false, autoScroll = false) {
    try {
      // Handle view-source: by parsing the raw HTML displayed
      if (window.location.href.startsWith('view-source:')) {
        try {
          const rawHtml = document.body ? (document.body.innerText || document.body.textContent || '') : '';
          if (rawHtml && rawHtml.trim().length > 0) {
            const parsed = new DOMParser().parseFromString(rawHtml, 'text/html');
            // Reuse our extractors against a detached document
            const title = parsed.querySelector('title')?.textContent || '';
            // Priority: extract course/fee tables when present
            const feesOnly = extractFeesFromParsedDoc(parsed);
            if (feesOnly && feesOnly.length > 0) {
              const header = (title ? title + '\n' + '='.repeat(Math.min(title.length,80)) + '\n' : '');
              const payload = header + feesOnly;
              sendResponse({
                success: true,
                text: payload,
                url: window.location.href.replace(/^view-source:/,''),
                title,
                tables: [],
                timestamp: new Date().toISOString()
              });
              return;
            }

            // Build a simple ordered text from parsed doc as fallback
            const tempDoc = parsed;
            const selector = ['h1','h2','h3','h4','h5','h6','p','li','table','blockquote','dt','dd','figcaption'].join(',');
            const nodes = Array.from(tempDoc.querySelectorAll(selector));
            const lines = [];
            let last = '';
            nodes.forEach(node => {
              if (node.tagName === 'TABLE') {
                const trs = node.querySelectorAll('tr');
                trs.forEach(tr => {
                  const cells = Array.from(tr.querySelectorAll('th,td')).map(c => (c.textContent||'').trim()).filter(Boolean);
                  if (cells.length === 2) lines.push(`${cells[0]}: ${cells[1]}`);
                  else if (cells.length > 0) lines.push(cells.join(' | '));
                });
                return;
              }
              let text = (node.textContent || '').replace(/\s+/g,' ').trim();
              if (!text) return;
              if (node.tagName === 'LI') text = `• ${text}`;
              if (text !== last) { lines.push(text); last = text; }
            });
            const formatted = lines.join('\n');
            if (formatted && formatted.trim().length > 0) {
              sendResponse({
                success: true,
                text: formatted,
                url: window.location.href.replace(/^view-source:/,''),
                title,
                tables: [],
                timestamp: new Date().toISOString()
              });
              return;
            }
          }
        } catch (e) {
          console.warn('view-source parse failed:', e.message);
        }
      }
      if (autoScroll) {
        await preloadLazyContent();
      }
      const content = extractPageContent(includeHidden);
      // Preserve DOM order for better context
      const domOrderedText = extractDomOrderedText(includeHidden);
      const formattedText = domOrderedText && domOrderedText.length > 0 ? domOrderedText : formatContentAsText(content);
      
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
        title: content.title || document.title || '',
        tables: content.tables || [],
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