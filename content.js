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

  function selectMainContainer() {
    const candidates = [
      document.querySelector('main'),
      document.getElementById('content'),
      document.querySelector('.content'),
      document.querySelector('#main'),
      document.querySelector('article')
    ].filter(Boolean);
    return candidates[0] || document.body;
  }

  function getContainerSignature(el) {
    try {
      const txt = (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
      return `${txt.length}:${txt.slice(0, 200)}`;
    } catch (_) { return `${Date.now()}`; }
  }

  async function waitForContentMutation(el, prevSig, timeoutMs = 2500) {
    return new Promise(resolve => {
      let done = false;
      const check = () => {
        if (done) return;
        const nowSig = getContainerSignature(el);
        if (nowSig !== prevSig) {
          done = true;
          obs.disconnect();
          resolve(true);
        }
      };
      const obs = new MutationObserver(() => setTimeout(check, 30));
      obs.observe(el, { subtree: true, childList: true, characterData: true });
      const id = setTimeout(() => { if (!done) { done = true; obs.disconnect(); resolve(false); } }, timeoutMs);
      // immediate first check
      setTimeout(check, 50);
    });
  }

  function getPaginationElements() {
    const containers = Array.from(document.querySelectorAll('.pagination, nav[aria-label*="pagination" i], .page-numbers, .pager'));
    const inContainers = containers.flatMap(c => Array.from(c.querySelectorAll('a,button')));
    const candidates = inContainers.length ? inContainers : Array.from(document.querySelectorAll('a.page-link, .pagination a, .page-numbers a, button.page-link'));
    const numbered = candidates.filter(el => /\b\d+\b/.test((el.textContent || '').trim()) && !el.closest('[aria-disabled="true"], .disabled'));
    const nexters = candidates.filter(el => /(next|»|›)/i.test(el.textContent || el.getAttribute('aria-label') || ''));
    return { numbered, nexters };
  }

  function looksFeeLine(line) {
    return /(fee|sem|semester|year|₹|rs\.?|amount)/i.test(line);
  }

  async function sweepTabsAndAccordions() {
    const main = selectMainContainer();
    const items = Array.from(document.querySelectorAll('[data-toggle="tab"], [data-bs-toggle="tab"], [role="tab"], .tab-link, .accordion-button'));
    for (const el of items) {
      try {
        const prev = getContainerSignature(main);
        el.click();
        await new Promise(r => setTimeout(r, 80));
        await waitForContentMutation(main, prev, 800);
      } catch (_) {}
    }
  }

  async function sweepPaginationAndCollect(includeHidden = true, limit = 30) {
    const main = selectMainContainer();
    const results = new Set();
    const addLines = (text) => {
      if (!text) return;
      const lines = text.split(/\n+/).map(s => s.trim()).filter(Boolean);
      for (const line of lines) {
        if (looksFeeLine(line)) results.add(line);
      }
    };

    addLines(extractDomOrderedText(includeHidden));

    const { numbered, nexters } = getPaginationElements();
    const pageNumbers = Array.from(new Set(numbered.map(el => (el.textContent || '').trim()).filter(Boolean)))
      .map(s => parseInt(s, 10))
      .filter(n => !Number.isNaN(n))
      .sort((a,b) => a-b)
      .slice(0, limit);

    if (pageNumbers.length > 1) {
      for (const n of pageNumbers) {
        const el = numbered.find(e => parseInt((e.textContent||'').trim(),10) === n);
        if (!el) continue;
        try {
          const prev = getContainerSignature(main);
          el.click();
          await new Promise(r => setTimeout(r, 150));
          await waitForContentMutation(main, prev, 1500);
          addLines(extractDomOrderedText(includeHidden));
        } catch (_) {}
      }
      return Array.from(results).join('\n');
    }

    // Fallback: fetch other pages by following pagination hrefs
    const hrefs = Array.from(new Set(numbered
      .map(el => el.getAttribute('href') || '')
      .filter(h => h && h !== '#' && !/^javascript/i.test(h))
      .map(h => {
        try { return new URL(h, window.location.href).toString(); } catch (_) { return null; }
      })
      .filter(Boolean)));

    if (hrefs.length > 1) {
      const parser = new DOMParser();
      const toFetch = hrefs.slice(0, limit);
      for (const url of toFetch) {
        try {
          const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
          if (!res.ok) continue;
          const html = await res.text();
          const doc = parser.parseFromString(html, 'text/html');
          const feesOnly = extractFeesFromParsedDoc(doc);
          if (feesOnly && feesOnly.length) {
            addLines(feesOnly);
          } else {
            const text = extractDomOrderedTextFromDoc(doc);
            addLines(text);
          }
        } catch (_) {}
      }
      return Array.from(results).join('\n');
    }

    let safety = limit;
    while (safety-- > 0 && nexters[0]) {
      try {
        const prev = getContainerSignature(main);
        nexters[0].click();
        await new Promise(r => setTimeout(r, 150));
        const changed = await waitForContentMutation(main, prev, 1500);
        if (!changed) break;
        addLines(extractDomOrderedText(includeHidden));
      } catch (_) { break; }
    }
    return Array.from(results).join('\n');
  }

  function extractDomOrderedTextFromDoc(doc) {
    try {
      const selector = ['h1','h2','h3','h4','h5','h6','p','li','table','blockquote','dt','dd','figcaption'].join(',');
      const nodes = Array.from(doc.querySelectorAll(selector));
      const lines = [];
      let last = '';
      for (const node of nodes) {
        if (node.tagName === 'TABLE') {
          const trs = node.querySelectorAll('tr');
          trs.forEach(tr => {
            const cells = Array.from(tr.querySelectorAll('th,td')).map(c => (c.textContent||'').replace(/\s+/g,' ').trim()).filter(Boolean);
            if (cells.length === 2) lines.push(`${cells[0]}: ${cells[1]}`);
            else if (cells.length > 0) lines.push(cells.join(' | '));
          });
          continue;
        }
        let text = (node.textContent || '').replace(/\s+/g,' ').trim();
        if (!text) continue;
        if (node.tagName === 'LI') text = `• ${text}`;
        if (text !== last) { lines.push(text); last = text; }
      }
      return lines.join('\n');
    } catch (_) {
      return '';
    }
  }

  // Parse inline JSON variable `allCourses = [...]` to capture complete fee dataset
  function extractCoursesFromInlineJSON() {
    try {
      const scripts = Array.from(document.querySelectorAll('script'));
      let jsonText = '';
      for (const s of scripts) {
        const t = s.textContent || '';
        if (!t) continue;
        if (/allCourses\s*=\s*\[/i.test(t)) {
          const m = t.match(/allCourses\s*=\s*(\[[\s\S]*?\]);/i);
          if (m && m[1]) { jsonText = m[1]; break; }
          // fallback: bracket match
          const start = t.indexOf('[');
          if (start !== -1) {
            let depth = 0;
            for (let i = start; i < t.length; i++) {
              const ch = t[i];
              if (ch === '[') depth++;
              else if (ch === ']') { depth--; if (depth === 0) { jsonText = t.slice(start, i + 1); break; } }
            }
            if (jsonText) break;
          }
        }
      }
      if (!jsonText) return '';
      let arr;
      try { arr = JSON.parse(jsonText); } catch (_) { return ''; }
      if (!Array.isArray(arr) || arr.length === 0) return '';
      const lines = [];
      const asMoney = (v) => {
        if (!v || v === '0') return '';
        return v;
      };
      for (const item of arr) {
        const name = (item.course_name || item.title || '').trim();
        if (!name) continue;
        const yearly = [
          asMoney(item.fyear_fee) && `1st Year ${item.fyear_fee}`,
          asMoney(item.syear_fee) && `2nd Year ${item.syear_fee}`,
          asMoney(item.tyear_fee) && `3rd Year ${item.tyear_fee}`,
          asMoney(item.ftyear_fee) && `4th Year ${item.ftyear_fee}`,
          asMoney(item.fiftyear_fee) && `5th Year ${item.fiftyear_fee}`,
          asMoney(item.sixyear_fee) && `6th Year ${item.sixyear_fee}`
        ].filter(Boolean).join(' | ');
        const sem = [
          asMoney(item.firstsem_fee) && `1st Sem ${item.firstsem_fee}`,
          asMoney(item.secondsem_fee) && `2nd Sem ${item.secondsem_fee}`,
          asMoney(item.thirdsem_fee) && `3rd Sem ${item.thirdsem_fee}`,
          asMoney(item.fourthsem_fee) && `4th Sem ${item.fourthsem_fee}`,
          asMoney(item.fifthsem_fee) && `5th Sem ${item.fifthsem_fee}`,
          asMoney(item.sixsem_fee) && `6th Sem ${item.sixsem_fee}`,
          asMoney(item.seventhsem_fee) && `7th Sem ${item.seventhsem_fee}`,
          asMoney(item.eightsem_fee) && `8th Sem ${item.eightsem_fee}`,
          asMoney(item.ninethsem_fee) && `9th Sem ${item.ninethsem_fee}`,
          asMoney(item.tenthsem_fee) && `10th Sem ${item.tenthsem_fee}`,
          asMoney(item.eleventhsem_fee) && `11th Sem ${item.eleventhsem_fee}`,
          asMoney(item.twelfth_fee) && `12th Sem ${item.twelfth_fee}`
        ].filter(Boolean).join(' | ');
        if (yearly) lines.push(`${name} — Yearly Fee ${yearly}`);
        if (sem) lines.push(`${name} — Semester Fee ${sem}`);
      }
      return lines.join('\n');
    } catch (_) { return ''; }
  }

  function extractCoursesFromWindowGlobal() {
    try {
      const arr = (window && window.allCourses) ? window.allCourses : null;
      if (!Array.isArray(arr) || arr.length === 0) return '';
      const asMoney = (v) => { if (!v || v === '0') return ''; return v; };
      const lines = [];
      for (const item of arr) {
        const name = (item.course_name || item.title || '').trim();
        if (!name) continue;
        const yearly = [
          asMoney(item.fyear_fee) && `1st Year ${item.fyear_fee}`,
          asMoney(item.syear_fee) && `2nd Year ${item.syear_fee}`,
          asMoney(item.tyear_fee) && `3rd Year ${item.tyear_fee}`,
          asMoney(item.ftyear_fee) && `4th Year ${item.ftyear_fee}`,
          asMoney(item.fiftyear_fee) && `5th Year ${item.fiftyear_fee}`,
          asMoney(item.sixyear_fee) && `6th Year ${item.sixyear_fee}`
        ].filter(Boolean).join(' | ');
        const sem = [
          asMoney(item.firstsem_fee) && `1st Sem ${item.firstsem_fee}`,
          asMoney(item.secondsem_fee) && `2nd Sem ${item.secondsem_fee}`,
          asMoney(item.thirdsem_fee) && `3rd Sem ${item.thirdsem_fee}`,
          asMoney(item.fourthsem_fee) && `4th Sem ${item.fourthsem_fee}`,
          asMoney(item.fifthsem_fee) && `5th Sem ${item.fifthsem_fee}`,
          asMoney(item.sixsem_fee) && `6th Sem ${item.sixsem_fee}`,
          asMoney(item.seventhsem_fee) && `7th Sem ${item.seventhsem_fee}`,
          asMoney(item.eightsem_fee) && `8th Sem ${item.eightsem_fee}`,
          asMoney(item.ninethsem_fee) && `9th Sem ${item.ninethsem_fee}`,
          asMoney(item.tenthsem_fee) && `10th Sem ${item.tenthsem_fee}`,
          asMoney(item.eleventhsem_fee) && `11th Sem ${item.eleventhsem_fee}`,
          asMoney(item.twelfth_fee) && `12th Sem ${item.twelfth_fee}`
        ].filter(Boolean).join(' | ');
        if (yearly) lines.push(`${name} — Yearly Fee ${yearly}`);
        if (sem) lines.push(`${name} — Semester Fee ${sem}`);
      }
      return lines.join('\n');
    } catch (_) { return ''; }
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

  // Build a full-page structured extraction with metadata and sections
  function extractStructuredPage(options = {}) {
    const {
      includeHidden = false,
      excludeBoilerplate = false,
      includeMetadata = true
    } = options || {};

    const lines = [];

    // Helpers
    function getMetaByName(name) {
      const el = document.querySelector(`meta[name="${name}"]`);
      return el ? (el.getAttribute('content') || '').trim() : '';
    }
    function getMetaByProperty(prop) {
      const el = document.querySelector(`meta[property="${prop}"]`);
      return el ? (el.getAttribute('content') || '').trim() : '';
    }
    function isBoilerplate(el) {
      if (!excludeBoilerplate) return false;
      const boilerSelectors = [
        'header', 'footer', 'nav', 'aside',
        '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
        '[class*="nav"]', '[id*="nav"]', '[class*="menu"]', '[class*="footer"]', '[id*="footer"]',
        '[class*="sidebar"]', '.ads', '[class*="ad-" ]', '[id*="ad-" ]'
      ];
      try {
        return boilerSelectors.some(sel => el.closest && el.closest(sel));
      } catch (_) { return false; }
    }

    // Title
    const title = (document.querySelector('title')?.textContent || document.title || '').trim();
    if (title) {
      lines.push('== Title ==');
      lines.push(title);
      lines.push('');
    }

    // Metadata
    if (includeMetadata) {
      const metaLines = [];
      const desc = getMetaByName('description');
      const ogTitle = getMetaByProperty('og:title');
      const ogDesc = getMetaByProperty('og:description');
      const ogImage = getMetaByProperty('og:image');
      const ogType = getMetaByProperty('og:type');
      const ogUrl = getMetaByProperty('og:url');
      if (desc) metaLines.push(`Description: ${desc}`);
      if (ogTitle) metaLines.push(`OG Title: ${ogTitle}`);
      if (ogDesc) metaLines.push(`OG Description: ${ogDesc}`);
      if (ogImage) metaLines.push(`OG Image: ${ogImage}`);
      if (ogType) metaLines.push(`OG Type: ${ogType}`);
      if (ogUrl) metaLines.push(`OG URL: ${ogUrl}`);
      if (metaLines.length) {
        lines.push('== Metadata ==');
        lines.push(...metaLines);
        lines.push('');
      }
    }

    // Headings
    const headingNodes = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
    const headingOut = [];
    headingNodes.forEach(h => {
      if (!shouldIncludeElement(h, includeHidden)) return;
      if (isBoilerplate(h)) return;
      const txt = cleanText(h.textContent || '');
      if (!txt) return;
      headingOut.push(`${h.tagName.toUpperCase()}: ${txt}`);
    });
    if (headingOut.length) {
      lines.push('== Headings ==');
      lines.push(...headingOut);
      lines.push('');
    }

    // Paragraphs and blockquotes
    const pbNodes = Array.from(document.querySelectorAll('p,blockquote'));
    const pbOut = [];
    pbNodes.forEach(n => {
      if (!shouldIncludeElement(n, includeHidden)) return;
      if (isBoilerplate(n)) return;
      const txt = cleanText(n.textContent || '');
      if (!txt) return;
      const prefix = n.tagName === 'BLOCKQUOTE' ? '> ' : '';
      pbOut.push(prefix + txt);
    });
    if (pbOut.length) {
      lines.push('== Paragraphs ==');
      lines.push(...pbOut);
      lines.push('');
    }

    // Lists (ul/ol)
    const listItems = Array.from(document.querySelectorAll('li'));
    const listOut = [];
    listItems.forEach(li => {
      if (!shouldIncludeElement(li, includeHidden)) return;
      if (isBoilerplate(li)) return;
      const txt = cleanText(li.textContent || '');
      if (!txt) return;
      listOut.push(`• ${txt}`);
    });
    if (listOut.length) {
      lines.push('== Lists ==');
      lines.push(...listOut);
      lines.push('');
    }

    // Tables (raw) + Course Fees synthesis (group by nearest heading)
    const tableNodes = Array.from(document.querySelectorAll('table'));
    const tableLines = [];
    const feeSynthesis = [];

    function nearestHeading(el) {
      let sib = el;
      let hops = 0;
      while (sib && hops < 10) {
        sib = sib.previousElementSibling || sib.parentElement;
        hops += 1;
        if (!sib) break;
        if (/^H[1-6]$/.test(sib.tagName)) {
          return cleanText(sib.textContent || '');
        }
      }
      return '';
    }

    tableNodes.forEach(table => {
      if (!includeHidden && !isElementVisible(table)) return;
      if (isUnwantedElement(table) || isBoilerplate(table)) return;
      const rows = [];
      const trList = table.querySelectorAll('tr');
      trList.forEach(tr => {
        const cells = Array.from(tr.querySelectorAll('th, td'))
          .map(cell => cleanText(cell.textContent).replace(/\s*:\s*$/,'').replace(/^[:\-\s]+/, ''))
          .filter(t => t.length > 0);
        if (cells.length > 0) rows.push(cells);
      });
      if (rows.length === 0) return;

      // Raw table dump for completeness
      const captionEl = table.querySelector('caption');
      if (captionEl) tableLines.push(`# ${cleanText(captionEl.textContent || '')}`);
      const maxCols = Math.max(...rows.map(r => r.length));
      rows.forEach(r => {
        if (maxCols === 2 && r.length === 2) tableLines.push(`${r[0]}: ${r[1]}`);
        else tableLines.push(r.join(' | '));
      });
      tableLines.push('');

      // Fee synthesis heuristics
      const header = rows[0] || [];
      const headerJoined = header.map(h => h.toLowerCase()).join(' ');
      const looksLikeFees = /fee|year|semester|sem|annual|tuition|amount/.test(headerJoined);
      if (!looksLikeFees) return;
      const program = nearestHeading(table) || (captionEl ? cleanText(captionEl.textContent || '') : 'Program');
      const out = [];
      rows.slice(1).forEach(r => {
        const joined = r.join(' | ');
        if (/(^|\W)(rs\.?|₹|\$|amount|fee|sem|year)/i.test(joined)) {
          if (r.length === 2) out.push(`- ${r[0]}: ${r[1]}`);
          else out.push(`- ${joined}`);
        }
      });
      if (out.length) {
        feeSynthesis.push(`**${program}**`);
        feeSynthesis.push(...out);
        feeSynthesis.push('');
      }
    });
    if (feeSynthesis.length) {
      lines.push('== Course Fees (Synthesis) ==');
      lines.push(...feeSynthesis);
      lines.push('');
    }
    if (tableLines.length) {
      lines.push('== Tables ==');
      lines.push(...tableLines);
    }

    // Fee Cards (non-table) synthesis: handle card/list layouts with Semester/Yearly blocks
    try {
      const sections = Array.from(document.querySelectorAll('section, article, div'));
      const emittedKeys = new Set();
      sections.forEach(sec => {
        const secText = (sec.textContent || '').toLowerCase();
        if (!/(semester\s*fee|yearly\s*fee)/i.test(secText)) return;
        // Skip obvious boilerplate containers
        if (isBoilerplate(sec)) return;
        const program = (function() {
          const h = sec.querySelector('h1,h2,h3,h4,h5,h6');
          if (h) return cleanText(h.textContent || '');
          return nearestHeading(sec) || 'Program';
        })();
        const lineItems = [];
        const items = Array.from(sec.querySelectorAll('li, p, div'));
        items.forEach(el => {
          const raw = (el.textContent || '').replace(/\s+/g, ' ').trim();
          if (!raw) return;
          const feeLike = /(rs\.?|₹|\$|amount|fee)/i.test(raw);
          const periodLike = /(\b1st|2nd|3rd|4th|5th|6th|7th|8th\b).*sem|year|annual/i.test(raw);
          if (feeLike && (periodLike || /(semester\s*fee|yearly\s*fee)/i.test(raw))) {
            const cleaned = raw.replace(/\s*:\s*/g, ': ').replace(/\s{2,}/g, ' ');
            if (cleaned.length > 3) lineItems.push(`- ${cleaned}`);
          }
        });
        if (lineItems.length) {
          const key = program + '|' + lineItems.slice(0,2).join('|');
          if (!emittedKeys.has(key)) {
            lines.push('== Course Fees (Cards) ==');
            lines.push(`**${program}**`);
            lines.push(...lineItems);
            lines.push('');
            emittedKeys.add(key);
          }
        }
      });
    } catch (_) {}

    // Links
    const linkNodes = Array.from(document.querySelectorAll('a[href]'));
    const linkOut = [];
    const seenLinks = new Set();
    linkNodes.forEach(a => {
      if (!shouldIncludeElement(a, includeHidden)) return;
      if (isBoilerplate(a)) return;
      const text = cleanText(a.textContent || '');
      const href = a.href || '';
      const key = text + '|' + href;
      if (!text || !href || seenLinks.has(key)) return;
      seenLinks.add(key);
      linkOut.push(`[${text}] → ${href}`);
    });
    if (linkOut.length) {
      lines.push('');
      lines.push('== Links ==');
      lines.push(...linkOut);
      lines.push('');
    }

    // Images (alt/captions)
    const imageNodes = Array.from(document.querySelectorAll('img'));
    const imageOut = [];
    imageNodes.forEach(img => {
      if (!shouldIncludeElement(img, includeHidden)) return;
      if (isBoilerplate(img)) return;
      const alt = (img.getAttribute('alt') || '').trim();
      const src = img.currentSrc || img.src || '';
      if (!alt && !src) return;
      const figcaption = img.closest('figure')?.querySelector('figcaption')?.textContent || '';
      const cap = cleanText(figcaption);
      const parts = [];
      if (alt) parts.push(`Alt: ${alt}`);
      if (cap) parts.push(`Caption: ${cap}`);
      if (src) parts.push(`Src: ${src}`);
      if (parts.length) imageOut.push(`- ${parts.join(' | ')}`);
    });
    if (imageOut.length) {
      lines.push('== Images ==');
      lines.push(...imageOut);
      lines.push('');
    }

    return lines.join('\n').trim();
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
      if (request.action === 'extractStructured') {
        try {
          const { includeHidden, excludeBoilerplate, includeMetadata, autoScroll } = request;
          const doExtract = async () => {
            if (autoScroll) {
              await preloadLazyContent();
            }
            const structured = extractStructuredPage({ includeHidden: includeHidden === true, excludeBoilerplate: excludeBoilerplate === true, includeMetadata: includeMetadata !== false });
            if (!structured || structured.trim().length === 0) {
              sendResponse({ success: false, error: 'No content found for structured extraction' });
              return;
            }
            sendResponse({
              success: true,
              text: structured,
              url: window.location.href,
              title: document.title || '',
              tables: [],
              timestamp: new Date().toISOString()
            });
          };
          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => doExtract());
            return true;
          }
          doExtract();
          return true;
        } catch (err) {
          sendResponse({ success: false, error: err?.message || 'Structured extraction failed' });
          return true;
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
      // Try to sweep through tabs/pagination to reveal hidden fee items
      try { await sweepTabsAndAccordions(); } catch (_) {}
      const content = extractPageContent(includeHidden);
      let extraFees = '';
      try { extraFees = await sweepPaginationAndCollect(true, 30); } catch (_) {}
      let inline = '';
      try { inline = extractCoursesFromInlineJSON(); } catch (_) {}
      if (!inline) {
        try { inline = extractCoursesFromWindowGlobal(); } catch (_) {}
      }
      // Preserve DOM order for better context, merge with pagination/json fees
      const domOrderedText = extractDomOrderedText(true /* force include hidden for completeness */);
      const combinedText = [domOrderedText, extraFees, inline].filter(Boolean).join('\n').trim();
      const formattedText = combinedText && combinedText.length > 0 ? combinedText : formatContentAsText(content);
      
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

  // ========================
  // In-page Sider UI
  // ========================

  (function initSiderUI() {
    try {
      if (document.getElementById('wte-sider-root')) return;
      const root = document.createElement('div');
      root.id = 'wte-sider-root';
      root.style.position = 'fixed';
      root.style.top = '64px';
      root.style.right = '8px';
      root.style.width = '360px';
      root.style.maxHeight = '80vh';
      root.style.zIndex = '2147483647';
      root.style.boxShadow = '0 8px 24px rgba(0,0,0,0.2)';
      root.style.borderRadius = '8px';
      const shadow = root.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = `
        * { box-sizing: border-box; }
        .panel { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background:#f8fafc; color:#0f172a; border:1px solid #cbd5e1; border-radius:8px; overflow:hidden; }
        .header { display:flex; align-items:center; justify-content:space-between; padding:8px 10px; background:#e2e8f0; }
        .title { font-size:13px; font-weight:600; margin:0; }
        .btn { appearance:none; border:1px solid #94a3b8; background:#fff; color:#0f172a; border-radius:6px; padding:8px 12px; font-size:13px; font-weight:500; cursor:pointer; transition:all 0.2s; }
        .btn:hover:not(:disabled) { background:#f8fafc; border-color:#64748b; transform:translateY(-1px); box-shadow:0 2px 4px rgba(0,0,0,0.1); }
        .btn:active:not(:disabled) { transform:translateY(0); box-shadow:0 1px 2px rgba(0,0,0,0.1); }
        .btn:disabled { opacity:0.6; cursor:not-allowed; background:#f8fafc; }
        .btn.primary { background:linear-gradient(135deg,#3b82f6,#1d4ed8); color:white; border:none; }
        .btn.primary:hover:not(:disabled) { background:linear-gradient(135deg,#1d4ed8,#1e40af); }
        .btn.danger { background:linear-gradient(135deg,#ef4444,#dc2626); color:white; border:none; }
        .btn.danger:hover:not(:disabled) { background:linear-gradient(135deg,#dc2626,#b91c1c); }
        .btn.success { background:linear-gradient(135deg,#10b981,#059669); color:white; border:none; }
        .btn.success:hover:not(:disabled) { background:linear-gradient(135deg,#059669,#047857); }
        @keyframes slideIn { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slideOut { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(-10px); } }
        .body { padding:8px; max-height:60vh; overflow:auto; }
        .row { display:flex; gap:6px; margin-bottom:6px; }
        .input { width:100%; padding:6px 8px; border:1px solid #cbd5e1; border-radius:6px; font-size:12px; }
        .pages { border-top:1px solid #e2e8f0; margin-top:8px; padding-top:8px; }
        .page { background:#fff; border:1px solid #e2e8f0; border-radius:6px; margin-bottom:8px; }
        .pageHead { display:flex; align-items:center; justify-content:space-between; padding:6px 8px; background:#f1f5f9; }
        .pageTitle { font-size:12px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:240px; }
        .caps { padding:6px 8px; }
        .cap { display:flex; align-items:center; gap:6px; padding:4px 0; border-bottom:1px dashed #e2e8f0; }
        .cap:last-child { border-bottom:none; }
        .capLabel { flex:1; font-size:12px; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
        .muted { color:#64748b; font-size:11px; }
        .toolbar { display:flex; gap:6px; flex-wrap:wrap; }
        .caret { border:none; background:transparent; cursor:pointer; font-size:14px; line-height:1; padding:0 4px; }
        .collapsed .caps { display:none; }
        .overlay { position:absolute; inset:0; background:rgba(248,250,252,0.8); display:none; align-items:center; justify-content:center; }
        .spinner { width:22px; height:22px; border:3px solid #cbd5e1; border-top-color:#0ea5e9; border-radius:50%; animation:spin 0.9s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .capBtns { display:flex; gap:4px; align-items:center; }
        .capBtn { border:1px solid #cbd5e1; background:#fff; padding:2px 6px; border-radius:6px; font-size:11px; cursor:pointer; }
        .capSpin { width:16px; height:16px; border:2px solid #cbd5e1; border-top-color:#0ea5e9; border-radius:50%; animation:spin 0.9s linear infinite; display:none; }
        .capBtn:disabled { opacity:0.5; cursor:not-allowed; }
      `;
      shadow.appendChild(style);
      const wrap = document.createElement('div');
      wrap.className = 'panel';
      wrap.innerHTML = `
        <div class="header">
          <div class="title">Web Text Extractor – Sider</div>
          <div class="toolbar">
            <button id="wte-add" class="btn success" title="Add current tab content">Add</button>
            <button id="wte-process" class="btn primary">Process LLM</button>
            <button id="wte-dl-raw" class="btn">Download Raw</button>
            <button id="wte-dl-llm" class="btn">Download LLM</button>
            <button id="wte-clear-site" class="btn danger" title="Remove all for this site">Clear site</button>
            <button id="wte-settings" class="btn" title="Open Options">Settings</button>
          </div>
        </div>
        <div class="body">
          <div class="row">
            <input id="wte-label" class="input" placeholder="Label (e.g., Tab 1: Programme list)" />
          </div>
          <div class="muted">Select captures to process/download. Data is saved automatically.</div>
          <div class="row"><label class="muted"><input type="checkbox" id="wte-select-all"/> Select all</label></div>
          <div id="wte-toast" class="muted" style="display:none"></div>
          <div class="pages" id="wte-pages"></div>
        </div>
        <div class="overlay" id="wte-overlay"><div class="spinner"></div></div>
      `;
      shadow.appendChild(wrap);
      document.documentElement.appendChild(root);
      // Expose toggle via keyboard
      document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'e') {
          if (root.style.display === 'none') root.style.display = '';
          else root.style.display = 'none';
        }
      });

      // Storage helpers
      const STORAGE_KEY = 'wte_pages_v1';
      const nowIso = () => new Date().toISOString();
      function normalizeUrlKey(u){
        try{
          const x = new URL(u);
          const host = x.hostname.replace(/^www\./i,'').toLowerCase();
          let path = x.pathname.replace(/\/+/g,'/');
          if (path.length > 1 && path.endsWith('/')) path = path.slice(0,-1);
          return `${host}${path||'/'}`;
        }catch(_){ return u; }
      }
      const keyForUrl = (u) => normalizeUrlKey(u);

      // IndexedDB adapter for large texts
      const DB_NAME = 'wte_db_v1';
      const DB_STORE = 'captures';
      function openDB() {
        return new Promise((resolve, reject) => {
          const req = indexedDB.open(DB_NAME, 1);
          req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(DB_STORE)) {
              db.createObjectStore(DB_STORE, { keyPath: 'id' });
            }
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      }

      // AI consent gating
      async function isAiAllowed() {
        try {
          const { aiEnabled, aiConsentGranted } = await chrome.storage.local.get(['aiEnabled','aiConsentGranted']);
          return !!aiEnabled && !!aiConsentGranted;
        } catch (_) { return false; }
      }

      // Show AI consent modal
      function showAiConsentModal() {
        return new Promise((resolve) => {
          const modal = document.createElement('div');
          modal.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.8); z-index: 999999; display: flex;
            align-items: center; justify-content: center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          `;
          modal.innerHTML = `
            <div style="background: white; padding: 32px; border-radius: 16px; max-width: 520px; margin: 20px; box-shadow: 0 24px 48px rgba(0,0,0,0.4); text-align: center;">
              <div style="font-size: 48px; margin-bottom: 16px;">🧠</div>
              <h3 style="margin: 0 0 16px 0; color: #1a1a1a; font-size: 20px; font-weight: 600;">Enable AI Features</h3>
              <p style="margin: 0 0 24px 0; color: #666; line-height: 1.6; font-size: 15px;">
                AI features will send your extracted text to external services (DigitalOcean AI and Google Gemini) for processing and organization. 
                Your data will be processed according to their respective privacy policies.
              </p>
              <div style="display: flex; gap: 16px; justify-content: center;">
                <button id="ai-deny" style="padding: 12px 24px; border: 2px solid #e0e0e0; background: white; border-radius: 8px; cursor: pointer; font-size: 15px; font-weight: 500; color: #666; transition: all 0.2s;">Cancel</button>
                <button id="ai-allow" style="padding: 12px 24px; border: none; background: linear-gradient(135deg, #007bff, #0056b3); color: white; border-radius: 8px; cursor: pointer; font-size: 15px; font-weight: 500; box-shadow: 0 4px 12px rgba(0,123,255,0.3); transition: all 0.2s;">Enable AI</button>
              </div>
            </div>
          `;
          
          document.body.appendChild(modal);
          
          const allowBtn = modal.querySelector('#ai-allow');
          const denyBtn = modal.querySelector('#ai-deny');
          
          allowBtn.onmouseover = () => allowBtn.style.transform = 'translateY(-2px)';
          allowBtn.onmouseout = () => allowBtn.style.transform = 'translateY(0)';
          denyBtn.onmouseover = () => { denyBtn.style.borderColor = '#ccc'; denyBtn.style.color = '#333'; };
          denyBtn.onmouseout = () => { denyBtn.style.borderColor = '#e0e0e0'; denyBtn.style.color = '#666'; };
          
          allowBtn.onclick = async () => {
            try {
              await chrome.storage.local.set({ aiEnabled: true, aiConsentGranted: true });
              document.body.removeChild(modal);
              showToast('AI features enabled successfully!', 'success');
              resolve(true);
            } catch (e) {
              console.error('Failed to enable AI:', e);
              showToast('Failed to enable AI features', 'error');
              resolve(false);
            }
          };
          
          denyBtn.onclick = () => {
            document.body.removeChild(modal);
            resolve(false);
          };
          
          modal.onclick = (e) => {
            if (e.target === modal) {
              document.body.removeChild(modal);
              resolve(false);
            }
          };
        });
      }

      async function applyAiUiState(shadowRoot) {
        const allowed = await isAiAllowed();
        const proc = shadowRoot.getElementById('wte-process'); 
        if (proc) {
          proc.disabled = !allowed;
          proc.style.opacity = allowed ? '1' : '0.6';
          proc.title = allowed ? 'Process selected captures with LLM' : 'Click to enable AI features';
        }
        
        shadowRoot.querySelectorAll('.capBtn.capProc').forEach(btn => { 
          btn.disabled = !allowed; 
          btn.style.opacity = allowed ? '1' : '0.6';
          btn.title = allowed ? 'Process this capture with LLM' : 'Click to enable AI features'; 
        });
        
        const hint = shadowRoot.getElementById('wte-ai-hint');
        if (!allowed) {
          if (!hint) {
            const p = document.createElement('div'); 
            p.id='wte-ai-hint'; 
            p.className='muted'; 
            p.style.cssText = 'padding: 12px; background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; margin: 8px 0; text-align: center;';
            p.innerHTML = `
              <div style="font-size: 24px; margin-bottom: 8px;">🔒</div>
              <div>AI features are disabled. <button id="enable-ai-btn" style="background: #007bff; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px;">Enable Now</button></div>
            `;
            shadowRoot.querySelector('.body')?.insertBefore(p, shadowRoot.querySelector('.pages'));
            
            p.querySelector('#enable-ai-btn').onclick = async () => {
              const enabled = await showAiConsentModal();
              if (enabled) {
                await applyAiUiState(shadowRoot);
              }
            };
          }
        } else if (hint) { hint.remove(); }
      }
      async function putCaptureText(captureId, kind, text) {
        try {
          const db = await openDB();
          await new Promise((resolve, reject) => {
            const tx = db.transaction(DB_STORE, 'readwrite');
            const store = tx.objectStore(DB_STORE);
            const id = `${captureId}:${kind}`;
            store.put({ id, text });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          });
        } catch (_) {}
      }
      async function getCaptureText(captureId, kind) {
        try {
          const db = await openDB();
          return await new Promise((resolve, reject) => {
            const tx = db.transaction(DB_STORE, 'readonly');
            const store = tx.objectStore(DB_STORE);
            const id = `${captureId}:${kind}`;
            const req = store.get(id);
            req.onsuccess = () => resolve(req.result?.text || '');
            req.onerror = () => reject(req.error);
          });
        } catch (_) { return ''; }
      }
      async function loadAll() {
        try { const { [STORAGE_KEY]: data } = await chrome.storage.local.get([STORAGE_KEY]); return data || { pages:{}, order:[] }; } catch { return { pages:{}, order:[] }; }
      }
      async function saveAll(data) { try { await chrome.storage.local.set({ [STORAGE_KEY]: data }); } catch(_) {} }
      const SITE_MEM_PREFIX = 'wte_site_mem_';
      function domainOf(u){ try { return new URL(u).hostname; } catch(_) { return 'unknown'; } }
      function siteKey(u){ return SITE_MEM_PREFIX + domainOf(u); }
      async function loadSiteMem(u){ const k=siteKey(u); const { [k]:mem }=await chrome.storage.local.get([k]); return mem||{ keys:{} }; }
      async function saveSiteMem(u,mem){ const k=siteKey(u); await chrome.storage.local.set({ [k]: mem }); }
      function hashText(str) {
        let h = 5381; for (let i = 0; i < str.length; i++) { h = ((h << 5) + h) ^ str.charCodeAt(i); }
        return (h >>> 0).toString(36);
      }
      // Allowed target university domains
      function isAllowedDomain(u){
        try {
          const h = new URL(u).hostname.toLowerCase();
          return /(sharda\.ac\.in|amity\.edu|galgotiasuniversity\.edu\.in|niu\.edu\.in|noidainternationaluniversity\.com)/.test(h);
        } catch(_) { return false; }
      }
      async function sha256Hex(str){
        try {
          const enc = new TextEncoder().encode(str);
          const buf = await crypto.subtle.digest('SHA-256', enc);
          return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
        } catch(_) { return 'hash_error'; }
      }
      function stableSignature(text){
        const t = (text||'').toLowerCase().replace(/[0-9]+/g,'#').replace(/\s+/g,' ').trim();
        return hashText(t.slice(0,3000));
      }
      function showToast(msg, type = 'info', ms = 3000) {
        const el = shadow.getElementById('wte-toast'); if (!el) return;
        
        // Clear any existing timeout
        if (el._timeout) clearTimeout(el._timeout);
        
        // Set message and styling based on type
        el.textContent = msg;
        el.className = `toast toast-${type}`;
        el.style.cssText = `
          display: block; padding: 12px; margin: 8px 0; border-radius: 6px; 
          font-size: 13px; font-weight: 500; text-align: center;
          ${type === 'success' ? 'background: #d4edda; color: #155724; border: 1px solid #c3e6cb;' : 
            type === 'error' ? 'background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb;' :
            type === 'warning' ? 'background: #fff3cd; color: #856404; border: 1px solid #ffeaa7;' :
            'background: #d1ecf1; color: #0c5460; border: 1px solid #bee5eb;'}
          animation: slideIn 0.3s ease-out;
        `;
        
        el._timeout = setTimeout(() => {
          el.style.animation = 'slideOut 0.3s ease-in forwards';
          setTimeout(() => { el.style.display = 'none'; }, 300);
        }, ms);
      }
      async function addCaptureFor(url, title, label, rawText) {
        const id = Math.random().toString(36).slice(2,10);
        const k = keyForUrl(url);
        const db = await loadAll();
        if (!db.pages[k]) { db.pages[k] = { url, title: title||'', captures: [], createdAt: nowIso(), updatedAt: nowIso(), pageSig: '' }; db.order.unshift(k); }
        const sig = hashText(rawText || '');
        const sig2 = stableSignature(rawText||'');
        const exists = (db.pages[k].captures||[]).some(c => c.sig === sig || c.sig2 === sig2);
        if (exists) { showToast('Duplicate capture ignored'); return { db, id: null, k }; }
        // Prevent a duplicate page group after reload by maintaining a pageSig across sessions
        const pageSig = db.pages[k].pageSig || hashText((document.title||'') + '|' + location.pathname);
        db.pages[k].pageSig = pageSig;
        const preview = (rawText||'').slice(0, 2000);
        // Store full rawText so later LLM processing has access (bug fix)
        db.pages[k].captures.push({ id, label: label || `Capture ${db.pages[k].captures.length+1}`, preview, rawText: rawText || '', sig, sig2, timestamp: nowIso(), selected: true });
        db.pages[k].updatedAt = nowIso();
        await saveAll(db);
        await putCaptureText(id, 'raw', rawText||'');
        return { db, id, k };
      }
      async function setCaptureLLM(url, capId, llmText) {
        const k = keyForUrl(url); const db = await loadAll(); const page = db.pages[k]; if (!page) return;
        const cap = page.captures.find(c=>c.id===capId); if (!cap) return; cap.llmText = llmText; page.updatedAt = nowIso(); await saveAll(db);
      }
      async function setPageLLM(url, llmText) { const k=keyForUrl(url); const db=await loadAll(); const page=db.pages[k]; if(!page) return; page.combinedLLM = llmText; page.updatedAt=nowIso(); await saveAll(db); }

      // UI render
      async function render() {
        const box = shadow.getElementById('wte-pages');
        if (!box) return;
        const db = await loadAll();
        // Group pages by domain
        const byDomain = new Map();
        const keys = db.order.length ? db.order : Object.keys(db.pages);
        for (const k of keys) {
          const p = db.pages[k]; if (!p) continue;
          let host = 'unknown';
          try { host = new URL(p.url).hostname.replace(/^www\./i,''); } catch(_) {}
          if (!byDomain.has(host)) byDomain.set(host, []);
          byDomain.get(host).push({ k, p });
        }
        const frag = document.createDocumentFragment();
        for (const [host, list] of byDomain.entries()) {
          const domainDiv = document.createElement('div');
          const allCaps = list.flatMap(x => x.p.captures || []);
          const domainAllSelected = allCaps.length>0 && allCaps.every(c=>!!c.selected);
          domainDiv.innerHTML = `<div class="pageHead"><div style="display:flex;align-items:center;gap:6px"><strong>${host}</strong></div><div style="display:flex;gap:8px;align-items:center"><label class="muted"><input type="checkbox" class="domain-select" data-domain="${host}" ${domainAllSelected?'checked':''}/> Select all</label><div class="muted">${allCaps.length} items</div></div></div>`;
          for (const {k, p} of list) {
            const allSelected = (p.captures||[]).length>0 && (p.captures||[]).every(c=>!!c.selected);
            const page = document.createElement('div'); page.className = 'page' + (p.collapsed? ' collapsed':'');
            page.innerHTML = `<div class="pageHead"><div style="display:flex;align-items:center;gap:6px"><button class="caret" data-toggle="${k}">${p.collapsed?'▸':'▾'}</button><input type="checkbox" class="page-select" data-page="${k}" ${allSelected?'checked':''}/><div class="pageTitle" title="${p.url}">${p.title || p.url}</div></div><div style="display:flex;gap:6px;align-items:center"><div class="muted">${(p.captures||[]).length} items</div><button class="capBtn page-del" data-page="${k}">✕</button></div></div>`;
            const caps = document.createElement('div'); caps.className = 'caps';
            (p.captures||[]).forEach(c => {
              const row = document.createElement('div'); row.className = 'cap';
            const checked = c.selected ? 'checked' : '';
            const sizeHint = (c.preview||'').length;
            row.innerHTML = `<input type="checkbox" ${checked} data-page="${k}" data-id="${c.id}"/> <div class="capLabel" title="${c.label}">${c.label}</div> <div class="muted">${sizeHint} chars${c.llmText? ', LLM ✓':''}</div> <div class="capBtns"><button class="capBtn capProc" data-page="${k}" data-id="${c.id}">LLM</button><button class="capBtn capDel" data-page="${k}" data-id="${c.id}">✕</button><div class="capSpin" id="spin_${c.id}"></div></div>`;
              caps.appendChild(row);
            });
            page.appendChild(caps);
            domainDiv.appendChild(page);
          }
          frag.appendChild(domainDiv);
        }
        box.innerHTML = ''; box.appendChild(frag);
        // Sync top-level select-all checkbox state
        const topSel = shadow.getElementById('wte-select-all');
        if (topSel) {
          const total = Array.from(box.querySelectorAll('input[type="checkbox"][data-page][data-id]')).length;
          const selected = Array.from(box.querySelectorAll('input[type="checkbox"][data-page][data-id]:checked')).length;
          topSel.checked = total>0 && selected === total;
        }
      }

      // Extraction for sider
      async function captureNow() {
        try {
          showToast('Capturing page content...', 'info', 1500);
          const label = shadow.getElementById('wte-label').value.trim() || `Tab ${Date.now().toString().slice(-4)}`;
          const url = window.location.href; 
          const title = document.title || new URL(url).hostname;
          if (!isAllowedDomain(url)) {
            showToast('Domain not in allowlist (skipped)', 'warning');
            return;
          }
          // Fast capture: DOM-order text including hidden
          const text = extractDomOrderedText(true) || '';
          if (!text || text.length < 50) {
            showToast('No meaningful content found to capture', 'warning');
            return;
          }
          
          await addCaptureFor(url, title, label, text);
          shadow.getElementById('wte-label').value = '';
          await render();
          showToast(`Captured "${label}" successfully!`, 'success');
        } catch (error) {
          console.error('Capture failed:', error);
          showToast(`Capture failed: ${error.message}`, 'error');
        }
      }

      // LLM processing
      async function processSelectedLLM() {
        // Check AI consent first
        const allowed = await isAiAllowed();
        if (!allowed) {
          const enabled = await showAiConsentModal();
          if (!enabled) {
            showToast('AI features are required for LLM processing', 'warning');
            return;
          }
          await applyAiUiState(shadow);
        }
        
        const checks = Array.from(shadow.querySelectorAll('input[type="checkbox"]:checked'));
        if (!checks.length) { showToast('Nothing selected'); return; }
        const byPage = new Map();
        const db = await loadAll();
        for (const el of checks) {
          const pg = db.pages[el.dataset.page]; if (!pg) continue;
          const cap = pg.captures.find(c=>c.id===el.dataset.id); if (!cap) continue;
          const arr = byPage.get(pg) || []; arr.push({ cap, pageKey: el.dataset.page }); byPage.set(pg, arr);
        }
        for (const [pg, items] of byPage.entries()) {
          if (!isAllowedDomain(pg.url)) {
            showToast('Skipped non-allowlisted domain for LLM');
            continue;
          }
          // Dedupe lines against site memory
          const rawCombined = items.map(x => x.cap.rawText).join('\n');
          const deduped = await dedupeAgainstSite(pg.url, rawCombined);
          try {
            const out = await organizeChunked(pg.title || 'Page', pg.url, deduped);
            if (out) {
              for (const it of items) { await setCaptureLLM(pg.url, it.cap.id, out); }
              await setPageLLM(pg.url, out);
              await updateSiteMemory(pg.url, out);
            }
          } catch (_) {}
        }
        await render();
      }

      // Downloads
      async function downloadSelected(which) { // which: 'raw'|'llm'
        try {
          const checks = Array.from(shadow.querySelectorAll('input[type="checkbox"]:checked'));
          if (!checks.length) { showToast('Nothing selected to download', 'warning'); return; }
          
          showToast(`Preparing ${which} download...`, 'info', 1500);
        const db = await loadAll();
        const byPageKey = new Map();
        for (const el of checks) {
          const pKey = el.dataset.page; const pg = db.pages[pKey]; if (!pg) continue;
          const cap = pg.captures.find(c=>c.id===el.dataset.id); if (!cap) continue;
          const raw = await getCaptureText(cap.id, 'raw');
          const chunk = (which === 'llm' && pg.combinedLLM) ? pg.combinedLLM : (which === 'llm' && cap.llmText) ? cap.llmText : raw || '';
          const arr = byPageKey.get(pKey) || []; arr.push(chunk); byPageKey.set(pKey, arr);
        }
        for (const [pKey, pieces] of byPageKey.entries()) {
          const pg = db.pages[pKey];
          // Always combine selected pieces; for LLM, prefer page.combinedLLM if exists, else combine capture llmText
          const combined = (which === 'raw')
            ? pieces.join('\n')
            : (pg.combinedLLM && pieces.length > 0 ? pg.combinedLLM : pieces.join('\n'));
          // For raw: no site dedupe to avoid empty files; For LLM: dedupe but fallback if emptied
          let cleaned = combined;
          if (which === 'llm') {
            const ded = await dedupeAgainstSite(pg.url, combined, false);
            cleaned = ded && ded.trim().length ? ded : combined;
          }
          // Ensure Source line present
          const hash = await sha256Hex(cleaned);
          if (!/\bSource:\s*https?:\/\//i.test(cleaned)) {
            cleaned = cleaned.trim() + `\n\nSource: ${pg.url}`;
          }
          if (!/HASH:\s*sha256:[0-9a-f]{64}/i.test(cleaned)) {
            cleaned = cleaned.trim() + `\nHASH: sha256:${hash}`;
          }
          const ts = new Date().toISOString().replace(/[:T]/g,'-').slice(0,19);
          const slug = (pg.title || new URL(pg.url).pathname).slice(0,80).replace(/[^\w\-]+/g,'_');
          const name = `${domainOf(pg.url)}_${slug}_${which}_${ts}.txt`;
          try {
            const resp = await chrome.runtime.sendMessage({ type: 'downloadText', filename: name, text: cleaned });
            if (!resp || !resp.ok) throw new Error(resp?.error || 'bg download failed');
          } catch (downloadErr) {
            console.warn('Background download failed, trying direct:', downloadErr);
            try {
              const blob = new Blob([cleaned], { type: 'text/plain' });
              const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.style.display='none';
              document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 2000);
            } catch (e) { 
              console.error('Direct download also failed:', e);
              throw new Error('Download failed: ' + e.message);
            }
          }
        }
        showToast(`${which === 'raw' ? 'Raw' : 'LLM'} files downloaded successfully!`, 'success');
      } catch (error) {
        console.error('Download error:', error);
        showToast(`Download failed: ${error.message}`, 'error');
      }
      }

      shadow.getElementById('wte-add').addEventListener('click', captureNow);
      shadow.getElementById('wte-process').addEventListener('click', processSelectedLLM);
      shadow.getElementById('wte-dl-raw').addEventListener('click', () => downloadSelected('raw'));
      shadow.getElementById('wte-dl-llm').addEventListener('click', () => downloadSelected('llm'));
      shadow.getElementById('wte-select-all').addEventListener('change', async (e) => {
        const db = await loadAll(); const checked = !!e.target.checked;
        Object.values(db.pages).forEach(p => (p.captures||[]).forEach(c => { c.selected = checked; }));
        await saveAll(db); await render();
      });
      shadow.getElementById('wte-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
      shadow.getElementById('wte-clear-site').addEventListener('click', async () => {
        const db = await loadAll();
        const host = location.hostname;
        const keys = Object.keys(db.pages);
        for (const k of keys) { if (new URL(db.pages[k].url).hostname === host) { delete db.pages[k]; db.order = db.order.filter(x=>x!==k); } }
        await saveAll(db);
        await chrome.storage.local.remove(siteKey(location.href));
        await render();
      });

      // Remove duplicate chapters across all sites/pages
      const dupBtn = document.createElement('button'); dupBtn.className='btn'; dupBtn.textContent='Remove duplicates'; dupBtn.style.marginLeft='6px';
      shadow.querySelector('.toolbar')?.appendChild(dupBtn);
      dupBtn.addEventListener('click', async () => {
        const db = await loadAll();
        const seen = new Set();
        const keys = Object.keys(db.pages);
        for (const k of keys) {
          const p = db.pages[k]; if (!p) continue;
          const kept = [];
          for (const c of (p.captures||[])) {
            const sig = c.sig || hashText(c.rawText||'');
            if (seen.has(sig)) continue;
            seen.add(sig); kept.push({ ...c, sig });
          }
          p.captures = kept;
        }
        await saveAll(db); await render();
        showToast('Duplicates removed');
      });
      // Page-level and item-level selection + collapse (event delegation)
      shadow.getElementById('wte-pages').addEventListener('change', async (e) => {
        const t = e.target;
        const db = await loadAll();
        if (t.classList.contains('domain-select')) {
          const host = t.getAttribute('data-domain');
          const checked = !!t.checked;
          for (const [k, p] of Object.entries(db.pages)) {
            try { if (new URL(p.url).hostname.replace(/^www\./i,'') === host) { (p.captures||[]).forEach(c => c.selected = checked); } } catch(_) {}
          }
          await saveAll(db); await render(); return;
        }
        if (t.classList.contains('page-select')) {
          const k = t.dataset.page; const p = db.pages[k]; if (!p) return;
          (p.captures||[]).forEach(c => { c.selected = !!t.checked; });
          await saveAll(db); await render(); return;
        }
        if (t.matches('input[type="checkbox"][data-page][data-id]')) {
          const k = t.dataset.page; const id = t.dataset.id; const p = db.pages[k]; if (!p) return;
          const c = p.captures.find(x=>x.id===id); if (!c) return; c.selected = !!t.checked;
          await saveAll(db); return;
        }
      });
      shadow.getElementById('wte-pages').addEventListener('click', async (e) => {
        const t = e.target; if (!(t instanceof Element)) return;
        if (t.classList.contains('caret')) {
          const k = t.dataset.toggle; const db = await loadAll(); const p = db.pages[k]; if (!p) return;
          p.collapsed = !p.collapsed; await saveAll(db); await render();
          return;
        }
        if (t.classList.contains('page-del')) {
          const k = t.getAttribute('data-page');
          const db = await loadAll(); delete db.pages[k]; db.order = db.order.filter(x=>x!==k); await saveAll(db); await render();
          return;
        }
        if (t.classList.contains('capDel')) {
          const k = t.getAttribute('data-page'); const id = t.getAttribute('data-id');
          const db = await loadAll(); const p = db.pages[k]; if (!p) return;
          p.captures = (p.captures||[]).filter(c => c.id !== id); await saveAll(db); await render();
          return;
        }
        if (t.classList.contains('capProc')) {
          // Check AI consent first
          const allowed = await isAiAllowed();
          if (!allowed) {
            const enabled = await showAiConsentModal();
            if (!enabled) {
              showToast('AI features are required for LLM processing', 'warning');
              return;
            }
            await applyAiUiState(shadow);
          }
          
          const k = t.getAttribute('data-page'); const id = t.getAttribute('data-id'); const spin = shadow.getElementById(`spin_${id}`); if (spin) spin.style.display='inline-block';
          const dbPre = await loadAll(); const pgPre = dbPre.pages[k]; if (!pgPre || !isAllowedDomain(pgPre.url)) { showToast('Domain not in allowlist', 'warning'); if (spin) spin.style.display='none'; return; }
          const db = await loadAll(); const pg = db.pages[k]; if (!pg) return;
          const cap = pg.captures.find(c=>c.id===id); if (!cap) return;
          const deduped = await dedupeAgainstSite(pg.url, cap.rawText);
          try {
            const out = await organizeChunked(pg.title || 'Page', pg.url, deduped);
            if (out) { await setCaptureLLM(pg.url, cap.id, out); await updateSiteMemory(pg.url, out); }
            showToast('LLM processing completed!', 'success');
          } catch(e) {
            console.error('LLM processing failed:', e);
            showToast('LLM processing failed: ' + (e.message || 'Unknown error'), 'error');
          }
          if (spin) spin.style.display='none'; await render();
        }
      });

      render();
      applyAiUiState(shadow);
      chrome.storage.onChanged.addListener((changes, area) => { if (area==='local' && changes[STORAGE_KEY]) render(); });
      chrome.storage.onChanged.addListener((changes, area) => { if (area==='local' && (changes.aiEnabled || changes.aiConsentGranted)) applyAiUiState(shadow); });

      // Maintain size on zoom (approximate)
      const baseDPR = window.devicePixelRatio || 1;
      function syncScale() {
        const cur = window.devicePixelRatio || 1; const scale = baseDPR / cur;
        root.style.transformOrigin = 'top right';
        root.style.transform = `scale(${scale})`;
      }
      window.addEventListener('resize', syncScale, { passive: true });
      syncScale();

      // Text dedupe helpers
      function normLine(s){ return (s||'').toLowerCase().replace(/[^a-z0-9₹$€\.\-]+/gi,' ').replace(/\s+/g,' ').trim(); }
      async function dedupeAgainstSite(url, text, update=true){
        const mem = await loadSiteMem(url); const keep=[]; const keys=mem.keys||{};
        for (const line of (text||'').split(/\n+/)) { const k = normLine(line); if (!k) continue; if (!keys[k]) { keep.push(line); if (update) keys[k]=1; } }
        if (update) { mem.keys = keys; await saveSiteMem(url, mem); }
        return keep.join('\n');
      }

      async function updateSiteMemory(url, text) { await dedupeAgainstSite(url, text, true); }

      // LLM helpers (chunked)
      function chunkText(text, max=12000) {
        if (!text) return [];
        const out=[]; let cur='';
        for (const line of text.split(/\n/)) {
          if ((cur + (cur? '\n':'') + line).length > max) { if (cur) out.push(cur); cur = line; }
          else { cur += (cur? '\n':'') + line; }
        }
        if (cur) out.push(cur);
        return out;
      }
      async function callLLM(prompt) {
        try {
          const doResp = await chrome.runtime.sendMessage({ type: 'llmOrganize', provider: 'do', prompt });
          if (doResp && doResp.ok && doResp.text) return doResp.text;
        } catch (_) {}
        const ge = await chrome.runtime.sendMessage({ type: 'llmOrganize', provider: 'gemini', prompt });
        if (ge && ge.ok && ge.text) return ge.text;
        throw new Error('LLM calls failed');
      }
      function buildStructuredPrompt(title, url, content) {
        return `Return plain text ONLY. Do not fabricate. Extract ONLY data present in content.
Sections (omit if absent) in this order:
RANKING
COURSES
FEES
ELIGIBILITY
ADMISSION PROCESS
SCHOLARSHIPS
PAYMENTS
VISA_FRRO
CONTACT
NOTES
Each section header alone on its own line. Keep INR symbols and semester/year labels. Consolidate duplicates. End with:
Source: ${url}

TITLE: ${title}
URL: ${url}

CONTENT START
${content}
CONTENT END`;
      }
      function buildSynthesisPrompt(title, url, segments) {
        return `Synthesize the following cleaned segments into one concise, deduplicated plain-text output. Keep only factual, relevant info. End with 'Source: ${url}'.\n\nTitle: ${title}\nURL: ${url}\n\nSEGMENTS:\n${segments.map((s,i)=>`--- Segment ${i+1} ---\n${s}`).join('\n')}`;
      }
      async function organizeChunked(title, url, text) {
        const chunks = chunkText(text, 12000);
        if (chunks.length <= 1) {
          return callLLM(buildStructuredPrompt(title, url, text));
        }
        const cleaned = [];
        for (let i=0;i<chunks.length;i++) {
          // sequential to avoid rate limits
          const out = await callLLM(buildStructuredPrompt(title, url, chunks[i]));
          cleaned.push(out);
        }
        return callLLM(buildSynthesisPrompt(title, url, cleaned));
      }
    } catch (e) {
      console.warn('Failed to init sider UI', e);
    }
  })();

})();
