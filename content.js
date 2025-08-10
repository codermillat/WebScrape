// Content script for extracting text from web pages
(function() {
  'use strict';

  // Increment this when content script behavior changes
  const CONTENT_SCRIPT_VERSION = '3';

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

  // Heuristic boilerplate detector (headers, footers, navs, breadcrumbs, sidebars)
  function isBoilerplateElement(el) {
    try {
      const sels = [
        'header','footer','nav','aside',
        '[role="navigation"]','[aria-label*="breadcrumb" i]',
        '.breadcrumb','.breadcrumbs','.menu','.navbar',
        '.sidebar','.site-header','.site-footer','.topbar'
      ];
      return sels.some(s => el.closest && el.closest(s));
    } catch (_) { return false; }
  }

  // Positional header/footer filter
  function isInHeaderFooterZone(el) {
    try {
      if (!el || !el.getBoundingClientRect) return false;
      const rect = el.getBoundingClientRect();
      const vh = Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0);
      const nearTop = rect.top < 140;
      const nearBottom = rect.bottom > (vh - 180);
      const inHeader = el.closest && (el.closest('header,[role="banner"],nav') != null);
      const inFooter = el.closest && (el.closest('footer,[role="contentinfo"]') != null);
      return (nearTop && inHeader) || (nearBottom && inFooter) || inHeader || inFooter;
    } catch (_) { return false; }
  }

  // Find the main content container to reduce header/footer/menu noise
  function findMainContentContainer() {
    try {
      const prefer = [
        'main','[role="main"]','article','#content','.content',
        '#primary','.main','.main-content','.content-area','.site-content'
      ];
      const direct = prefer.map(sel => document.querySelector(sel)).filter(Boolean);
      const pool = direct.length
        ? direct
        : Array.from(document.querySelectorAll('main, article, #content, .content, #primary, .site-content, .container'));
      let best = selectMainContainer();
      let bestScore = 0;
      for (const el of pool) {
        if (!el) continue;
        const textLen = ((el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()).length;
        const penalty = (el.querySelectorAll('nav, header, footer, .sidebar, [role="navigation"], .menu, .breadcrumbs, .breadcrumb').length || 0) * 200;
        const score = textLen - penalty;
        if (score > bestScore) { bestScore = score; best = el; }
      }
      return best || selectMainContainer();
    } catch (_) { return selectMainContainer(); }
  }

  // Extract text within a specific root to avoid global boilerplate
  function extractDomOrderedTextWithin(root, includeHidden = false) {
    try {
      const selector = [
        'h1','h2','h3','h4','h5','h6',
        'p','li','table','blockquote','dt','dd','figcaption'
      ].join(',');
      const nodes = Array.from((root || document).querySelectorAll(selector));
      const lines = [];
      let last = '';

      nodes.forEach(node => {
        if (isBoilerplateElement(node)) return;
        if (!shouldIncludeElement(node, includeHidden)) return;
        if (isInHeaderFooterZone(node)) return;

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
    } catch (_) {
      return '';
    }
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

  // In-page dynamic pagination collector (click through tabs/numbers within same URL)
  function discoverInPagePagers() {
    const main = selectMainContainer();
    const els = Array.from(main.querySelectorAll('a,button,[role="tab"], .page-link, .page-numbers a, .pagination a, .page-item, [data-page], [data-index]'));
    const numbered = [];
    const nexters = [];
    els.forEach(el => {
      const t = (el.textContent || '').trim();
      if (/^\d+$/.test(t)) numbered.push(el);
      else if (/(next|»|›)/i.test(t) || el.getAttribute('rel') === 'next') nexters.push(el);
    });
    return { numbered, nexters };
  }

  async function collectDynamicAllText(limit = 50) {
    try {
      const main = selectMainContainer();
      const seenSigs = new Set();
      const out = new Set();
      const addText = (text) => {
        if (!text) return;
        text.split(/\n+/).forEach(s => { const t = s.trim(); if (t) out.add(t); });
      };

      addText(extractDomOrderedText(true));
      seenSigs.add(getContainerSignature(main));

      const { numbered, nexters } = discoverInPagePagers();
      const pageNumbers = Array.from(new Set(numbered.map(el => parseInt((el.textContent || '').trim(), 10)).filter(n => !Number.isNaN(n))))
        .sort((a, b) => a - b)
        .slice(0, limit);

      for (const n of pageNumbers) {
        const el = numbered.find(e => parseInt((e.textContent || '').trim(), 10) === n);
        if (!el) continue;
        try {
          const prev = getContainerSignature(main);
          el.click();
          await new Promise(r => setTimeout(r, 150));
          const changed = await waitForContentMutation(main, prev, 1500);
          if (!changed) continue;
          const sig = getContainerSignature(main);
          if (seenSigs.has(sig)) continue;
          seenSigs.add(sig);
          addText(extractDomOrderedText(true));
        } catch (_) {}
      }

      let safety = limit;
      while (safety-- > 0 && nexters[0]) {
        try {
          const prev = getContainerSignature(main);
          nexters[0].click();
          await new Promise(r => setTimeout(r, 150));
          const changed = await waitForContentMutation(main, prev, 1500);
          if (!changed) break;
          const sig = getContainerSignature(main);
          if (seenSigs.has(sig)) break;
          seenSigs.add(sig);
          addText(extractDomOrderedText(true));
        } catch (_) { break; }
      }

      return Array.from(out).join('\n');
    } catch (_) {
      return extractDomOrderedText(true);
    }
  }

  // Special handling for Sharda course-fee (two-phase state machine)
  function isShardaCourseFeePage() {
    try {
      const u = new URL(location.href);
      return /sharda\.ac\.in$/i.test(u.hostname) && u.pathname.replace(/\/+$/,'') === '/course-fee';
    } catch (_) { return false; }
  }

  function _textMatch(el, re) {
    try { return re.test((el.textContent || el.innerText || '').trim()); } catch(_) { return false; }
  }

  function findListRootSharda() {
    try {
      const pool = Array.from(document.querySelectorAll('main, #content, .content, #main, article, .container, .row, body *'));
      let best = null, bestScore = 0;
      for (const c of pool.slice(0, 500)) {
        const btns = c.querySelectorAll('a,button');
        let score = 0;
        btns.forEach(b => { if (_textMatch(b, /(yearly\s*fee|semester\s*fee)/i)) score++; });
        if (score > bestScore) { bestScore = score; best = c; }
      }
      return best || selectMainContainer();
    } catch (_) { return selectMainContainer(); }
  }

  function getPagerNear(root) {
    const zones = new Set();
    let a = root;
    for (let i = 0; i < 4 && a; i++, a = a.parentElement) zones.add(a);
    const all = Array.from(document.querySelectorAll('ul.pagination, .pagination, nav[aria-label*="pagination" i], .page-numbers'));
    const cand = all.filter(p => {
      let x = p, d = 0;
      while (x && d < 6) { if (zones.has(x)) return true; x = x.parentElement; d++; }
      return false;
    });
    const pager = cand[0] || all[0] || null;
    if (!pager) return { pager: null, numbers: [], next: null };
    const anchors = Array.from(pager.querySelectorAll('a,button'));
    const numbers = anchors.filter(el => /^\d+$/.test((el.textContent || '').trim()));
    const next = anchors.find(el => /(next|»|›)/i.test(el.textContent || el.getAttribute('aria-label') || ''));
    return { pager, numbers, next };
  }

  function getActivePageNumberNear(root) {
    try {
      const { pager } = getPagerNear(root);
      if (!pager) return null;
      const cur = pager.querySelector('.active, [aria-current="page"], .current');
      const t = (cur?.textContent || '').trim();
      const n = parseInt(t, 10);
      return Number.isFinite(n) ? n : null;
    } catch (_) { return null; }
  }

  async function clickPagerNumberNear(root, number, timeout = 2500) {
    const { pager } = getPagerNear(root);
    if (!pager) return false;
    const el = Array.from(pager.querySelectorAll('a,button')).find(a => parseInt((a.textContent || '').trim(), 10) === number);
    if (!el) return false;
    const prev = getContainerSignature(root);
    el.click();
    await new Promise(r => setTimeout(r, 120));
    const changed = await waitForContentMutation(root, prev, timeout);
    return !!changed;
  }

  async function drillDownFeesInList(root) {
    const toggles = Array.from(root.querySelectorAll('a,button')).filter(el => _textMatch(el, /(yearly\s*fee|semester\s*fee)/i));
    const seenParents = new WeakSet();
    for (const el of toggles) {
      try {
        const parent = el.closest('.card, li, .course, .program, .programme, .row, .col') || root;
        if (seenParents.has(parent)) continue;
        seenParents.add(parent);
        const prev = getContainerSignature(parent);
        el.click();
        await new Promise(r => setTimeout(r, 80));
        await waitForContentMutation(parent, prev, 900);
      } catch (_) {}
    }
  }

  async function scrapeShardaCourseFees(options = {}) {
    const maxPages = typeof options.maxPages === 'number' ? options.maxPages : 50;
    const listRoot = findListRootSharda();

    const out = new Set();
    const addText = (txt) => {
      if (!txt) return;
      txt.split(/\n+/).forEach(s => { const t = s.trim(); if (t) out.add(t); });
    };

    const visited = new Set();
    let safety = maxPages;
    let active = getActivePageNumberNear(listRoot);
    if (!Number.isFinite(active) || active <= 0) active = 1;

    while (safety-- > 0) {
      if (!visited.has(active)) {
        await drillDownFeesInList(listRoot);
        addText(extractDomOrderedTextWithin(listRoot, true));
        visited.add(active);
      }

      const { pager } = getPagerNear(listRoot);
      if (!pager) break;

      const desired = active + 1;

      // Prefer clicking the numeric next page (active+1); fallback to "Next"
      const buttons = Array.from(pager.querySelectorAll('a,button'));
      let target = buttons.find(a => parseInt((a.textContent || '').trim(), 10) === desired) ||
                   buttons.find(a => /(next|»|›)/i.test(a.textContent || a.getAttribute('aria-label') || ''));

      if (!target) break;

      const prevSig = getContainerSignature(listRoot);
      target.click();
      await new Promise(r => setTimeout(r, 120));
      const changed = await waitForContentMutation(listRoot, prevSig, 2500);
      if (!changed) break;

      let newActive = getActivePageNumberNear(listRoot);
      if (!Number.isFinite(newActive)) newActive = active;

      // If pager reflows and we didn't advance, try to locate the smallest unseen number > current
      if (newActive <= active || visited.has(newActive)) {
        const nums = buttons
          .map(a => parseInt((a.textContent || '').trim(), 10))
          .filter(n => Number.isFinite(n) && !visited.has(n));
        const candidates = nums.filter(n => n > active);
        const nextNum = (candidates.length ? Math.min(...candidates) : Math.min(...nums.filter(n => !visited.has(n)) || [NaN]));
        if (Number.isFinite(nextNum) && nextNum !== active) {
          const el = buttons.find(a => parseInt((a.textContent || '').trim(), 10) === nextNum);
          if (el) {
            const sig2 = getContainerSignature(listRoot);
            el.click();
            await new Promise(r => setTimeout(r, 120));
            await waitForContentMutation(listRoot, sig2, 2500);
            newActive = getActivePageNumberNear(listRoot) ?? nextNum;
          }
        }
      }

      if (newActive === active || visited.has(newActive)) break;
      active = newActive;
    }

    return Array.from(out).join('\n');
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

  // Collect embedded PDF URLs from the page (embed/object/iframe/anchors)
  function collectEmbeddedPdfUrls() {
    try {
      const out = [];
      const seen = new Set();
      const base = location.href;
      const pushAbs = (u) => {
        try {
          const abs = new URL(u, base).toString();
          const key = abs.split('#')[0];
          if (seen.has(key)) return;
          if (/\.pdf(?:$|[?#])/i.test(abs)) {
            seen.add(key); out.push(abs);
          }
        } catch (_) {}
      };
      const embeds = document.querySelectorAll('embed[type="application/pdf"], object[type="application/pdf"], iframe[src$=".pdf"], iframe[src*=".pdf?"], iframe[src*=".pdf#"]');
      embeds.forEach(el => {
        const src = el.getAttribute('src') || el.getAttribute('data') || '';
        if (src) pushAbs(src);
      });
      // Anchor fallbacks
      document.querySelectorAll('a[href$=".pdf"], a[href*=".pdf?"], a[href*=".pdf#"]').forEach(a => {
        const href = a.getAttribute('href') || '';
        if (href) pushAbs(href);
      });
      return out;
    } catch (_) { return []; }
  }

  // Derive real PDF URL when viewing via Chrome/Edge built-in PDF viewer
  function derivePdfUrlFromLocation() {
    try {
      const tabUrl = window.location.href || '';
      if (!tabUrl) return '';
      const u = new URL(tabUrl);
      // Direct PDF only if pathname ends with .pdf
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

    // Embedded PDFs on page
    try {
      const pdfs = collectEmbeddedPdfUrls();
      if (pdfs.length) {
        lines.push('== Embedded PDFs ==');
        pdfs.slice(0, 50).forEach((u, i) => lines.push(`PDF ${i+1}: ${u}`));
        lines.push('');
      }
    } catch (_) {}

    // Headings
    const headingNodes = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
    const headingOut = [];
    headingNodes.forEach(h => {
      if (!shouldIncludeElement(h, includeHidden)) return;
      if (isBoilerplate(h)) return;
      if (isInHeaderFooterZone(h)) return;
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
      if (isInHeaderFooterZone(n)) return;
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
      if (isInHeaderFooterZone(li)) return;
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
      if (request.action === 'scrapeExternalLinks') {
        // Collect external/eligible links, limited by request.limit
        try {
          const limit = Math.max(1, Math.min(50, Number(request.limit) || 10));
          const onlySameHost = !!request.onlySameHost;
          const cur = new URL(location.href);
          const anchors = Array.from(document.querySelectorAll('a[href]'));
          const urls = [];
          const seen = new Set();
          for (const a of anchors) {
            const href = (a.getAttribute('href') || '').trim();
            if (!href || href.startsWith('javascript:') || href === '#') continue;
            let abs = '';
            try { abs = new URL(href, cur.href).toString(); } catch { continue; }
            try {
              const u = new URL(abs);
              if (!(u.protocol === 'http:' || u.protocol === 'https:')) continue;
              if (onlySameHost && u.hostname !== cur.hostname) continue;
              // skip obvious nav/boilerplate links
              const text = cleanText(a.textContent || '');
              if (!text && (u.pathname === '/' || u.pathname === cur.pathname)) continue;
              const key = abs.split('#')[0];
              if (seen.has(key)) continue;
              seen.add(key);
              urls.push(abs);
            } catch (_) { continue; }
            if (urls.length >= limit) break;
          }
          // Prioritize embedded PDFs discovered in the page
          try {
            const pdfs = collectEmbeddedPdfUrls();
            for (const u of pdfs) {
              if (urls.length >= limit) break;
              const key = u.split('#')[0];
              if (!seen.has(key)) { seen.add(key); urls.push(u); }
            }
          } catch (_) {}

          chrome.runtime.sendMessage({ type: 'scrapeUrlBatch', urls, options: { active: false, closeAfter: true, includeHidden: true, autoScroll: true } })
            .then(resp => {
              sendResponse({ success: !!resp?.ok, results: resp?.results || [] });
            })
            .catch(err => {
              sendResponse({ success: false, error: err?.message || 'scrapeUrlBatch dispatch failed' });
            });
          return true;
        } catch (e) {
          sendResponse({ success: false, error: e?.message || 'collect links failed' });
          return true;
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
      const mainRoot = findMainContentContainer();
      const domOrderedText = extractDomOrderedTextWithin(mainRoot, true /* force include hidden for completeness */);
      const combinedText = [domOrderedText, extraFees, inline].filter(Boolean).join('\n').trim();
      const formattedText = combinedText && combinedText.length > 0 ? combinedText : formatContentAsText(content);
      
      if (!formattedText || formattedText.trim().length === 0) {
        // Final fallbacks: visible text nodes, then raw innerText dump
        try {
          const visibleText = (function collectAllVisibleText(){
            try {
              const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
                acceptNode(node) {
                  const s = (node.nodeValue || '').replace(/\s+/g,' ').trim();
                  if (!s) return NodeFilter.FILTER_REJECT;
                  const el = node.parentElement;
                  if (!el) return NodeFilter.FILTER_REJECT;
                  if (/^(script|style|noscript|iframe|object|embed)$/i.test(el.tagName)) return NodeFilter.FILTER_REJECT;
                  const cs = getComputedStyle(el);
                  if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return NodeFilter.FILTER_REJECT;
                  return NodeFilter.FILTER_ACCEPT;
                }
              });
              const parts = [];
              let n;
              while ((n = walker.nextNode())) {
                const t = (n.nodeValue || '').replace(/\s+/g,' ').trim();
                if (t) parts.push(t);
                if (parts.length > 8000) break; // guard
              }
              return cleanText(parts.join('\n'));
            } catch (_) {
              return '';
            }
          })();

          if (visibleText && visibleText.trim().length >= 20) {
            console.log('[WTE][performExtraction] using visibleText fallback', { len: visibleText.length });
            sendResponse({
              success: true,
              text: visibleText,
              url: window.location.href,
              title: document.title || '',
              tables: [],
              timestamp: new Date().toISOString()
            });
            return;
          }

          const rawDump = ((document.body && (document.body.innerText || document.body.textContent)) || '').replace(/\r\n?/g,'\n');
          const rawClean = cleanText(rawDump);
          if (rawClean && rawClean.trim().length >= 10) {
            console.log('[WTE][performExtraction] using rawDump fallback', { len: rawClean.length });
            sendResponse({
              success: true,
              text: rawClean,
              url: window.location.href,
              title: document.title || '',
              tables: [],
              timestamp: new Date().toISOString()
            });
            return;
          }
        } catch (e) {
          console.warn('[WTE][performExtraction] fallbacks errored', e?.message || e);
        }

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
        .domain-group.collapsed .page { display: none; }
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
                        <button id="wte-dl-raw" class="btn">Download Raw</button>
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
      async function deleteCaptureText(captureId, kinds = ['raw','llm']) {
        try {
          const db = await openDB();
          await Promise.all(kinds.map(kind => new Promise((resolve, reject) => {
            const tx = db.transaction(DB_STORE, 'readwrite');
            const store = tx.objectStore(DB_STORE);
            const id = `${captureId}:${kind}`;
            store.delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          })));
        } catch (_) {}
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
      async function addCaptureFor(url, title, label, rawText, opts = {}) {
        const id = Math.random().toString(36).slice(2,10);
        const k = keyForUrl(url);
        const db = await loadAll();
        const force = !!(opts && opts.force);
        if (!db.pages[k]) { db.pages[k] = { url, title: title||'', captures: [], createdAt: nowIso(), updatedAt: nowIso(), pageSig: '' }; db.order.unshift(k); }
        const sig = hashText(rawText || '');
        const sig2 = stableSignature(rawText||'');
        const exists = (db.pages[k].captures||[]).some(c => c.sig === sig || c.sig2 === sig2);
        if (!force && exists) { showToast('Duplicate capture ignored', 'warning', 4000); return { db, id: null, k }; }
        // Global capture-level duplicate check across all pages/sites
        try {
          const gmem = await loadGlobalMem();
          const seenCaps = gmem.caps || {};
          if (!force && (seenCaps[sig] || seenCaps[sig2])) { showToast('Global duplicate ignored', 'warning', 4000); return { db, id: null, k }; }
        } catch (_) {}
        // Prevent a duplicate page group after reload by maintaining a pageSig across sessions
        const pageSig = db.pages[k].pageSig || hashText((document.title||'') + '|' + location.pathname);
        db.pages[k].pageSig = pageSig;
        const preview = (rawText||'').slice(0, 10000);
        const len = (rawText||'').length;
        db.pages[k].captures.push({ id, label: label || `Capture ${db.pages[k].captures.length+1}`, preview, len, sig, sig2, timestamp: nowIso(), selected: true });
        db.pages[k].updatedAt = nowIso();
        await saveAll(db);
        await putCaptureText(id, 'raw', rawText||'');
        // Record capture signatures globally
        try {
          const gmem = await loadGlobalMem();
          const seenCaps = gmem.caps || {};
          seenCaps[sig] = { ts: nowIso(), url };
          seenCaps[sig2] = { ts: nowIso(), url };
          gmem.caps = seenCaps;
          await saveGlobalMem(gmem);
        } catch (_) {}
        return { db, id, k };
      }
            
      // UI render (programmatic DOM creation to avoid injection vulnerabilities)
      async function render() {
        const box = shadow.getElementById('wte-pages');
        if (!box) return;
        const db = await loadAll();
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
          domainDiv.className = 'domain-group';
          const isDomainCollapsed = list.length > 0 && list.every(({ p }) => p.collapsed);
          if (isDomainCollapsed) {
            domainDiv.classList.add('collapsed');
          }
          const allCaps = list.flatMap(x => x.p.captures || []);
          const domainAllSelected = allCaps.length > 0 && allCaps.every(c => !!c.selected);

          const domainHead = document.createElement('div');
          domainHead.className = 'pageHead';
          const strong = document.createElement('strong');
          strong.textContent = host;
          const d1 = document.createElement('div');
          d1.style.cssText = 'display:flex;align-items:center;gap:6px';

          const domainCaret = document.createElement('button');
          domainCaret.className = 'caret';
          domainCaret.dataset.toggleDomain = host;
          domainCaret.textContent = isDomainCollapsed ? '▸' : '▾';

          d1.appendChild(domainCaret);
          d1.appendChild(strong);
          const d2 = document.createElement('div');
          d2.style.cssText = 'display:flex;gap:8px;align-items:center';
          const label = document.createElement('label');
          label.className = 'muted';
          const chk = document.createElement('input');
          chk.type = 'checkbox';
          chk.className = 'domain-select';
          chk.dataset.domain = host;
          chk.checked = domainAllSelected;
          label.appendChild(chk);
          label.append(' Select all');
          const itemsMuted = document.createElement('div');
          itemsMuted.className = 'muted';
          itemsMuted.textContent = `${allCaps.length} items`;
          d2.appendChild(label);
          d2.appendChild(itemsMuted);
          domainHead.appendChild(d1);
          domainHead.appendChild(d2);
          domainDiv.appendChild(domainHead);

          if (!isDomainCollapsed) {
            for (const { k, p } of list) {
              const allSelected = (p.captures || []).length > 0 && (p.captures || []).every(c => !!c.selected);
              const page = document.createElement('div');
              page.className = 'page' + (p.collapsed ? ' collapsed' : '');

              const pageHead = document.createElement('div');
              pageHead.className = 'pageHead';
              const ph1 = document.createElement('div');
              ph1.style.cssText = 'display:flex;align-items:center;gap:6px';
              const caret = document.createElement('button');
              caret.className = 'caret';
              caret.dataset.toggle = k;
              caret.textContent = p.collapsed ? '▸' : '▾';
              const pageChk = document.createElement('input');
              pageChk.type = 'checkbox';
              pageChk.className = 'page-select';
              pageChk.dataset.page = k;
              pageChk.checked = allSelected;
              const pageTitle = document.createElement('div');
              pageTitle.className = 'pageTitle';
              pageTitle.title = p.url;
              pageTitle.textContent = p.title || p.url;
              ph1.appendChild(caret);
              ph1.appendChild(pageChk);
              ph1.appendChild(pageTitle);

              const ph2 = document.createElement('div');
              ph2.style.cssText = 'display:flex;gap:6px;align-items:center';
              const pageItemsMuted = document.createElement('div');
              pageItemsMuted.className = 'muted';
              pageItemsMuted.textContent = `${(p.captures || []).length} items`;
              const delBtn = document.createElement('button');
              delBtn.className = 'capBtn page-del';
              delBtn.dataset.page = k;
              delBtn.textContent = '✕';
              ph2.appendChild(pageItemsMuted);
              ph2.appendChild(delBtn);

              pageHead.appendChild(ph1);
              pageHead.appendChild(ph2);
              page.appendChild(pageHead);

              const caps = document.createElement('div');
              caps.className = 'caps';
              if (!p.collapsed) {
                (p.captures || []).forEach(c => {
                  const row = document.createElement('div');
                row.className = 'cap';
                const capChk = document.createElement('input');
                capChk.type = 'checkbox';
                capChk.checked = !!c.selected;
                capChk.dataset.page = k;
                capChk.dataset.id = c.id;
                const capLabel = document.createElement('div');
                capLabel.className = 'capLabel';
                capLabel.title = c.label;
                capLabel.textContent = c.label;
                const sizeHint = document.createElement('div');
                sizeHint.className = 'muted';
                sizeHint.textContent = `${c.len || (c.preview || '').length} chars`;
                const capBtns = document.createElement('div');
                capBtns.className = 'capBtns';
                const capDelBtn = document.createElement('button');
                capDelBtn.className = 'capBtn capDel';
                capDelBtn.dataset.page = k;
                capDelBtn.dataset.id = c.id;
                capDelBtn.textContent = '✕';
                capBtns.appendChild(capDelBtn);
                row.appendChild(capChk);
                row.appendChild(capLabel);
                row.appendChild(sizeHint);
                row.appendChild(capBtns);
                caps.appendChild(row);
                });
              }
              page.appendChild(caps);
              domainDiv.appendChild(page);
            }
          }
          frag.appendChild(domainDiv);
        }
        box.innerHTML = '';
        box.appendChild(frag);
        const topSel = shadow.getElementById('wte-select-all');
        if (topSel) {
          const total = Array.from(box.querySelectorAll('input[type="checkbox"][data-page][data-id]')).length;
          const selected = Array.from(box.querySelectorAll('input[type="checkbox"][data-page][data-id]:checked')).length;
          topSel.checked = total > 0 && selected === total;
        }
      }

      // Extraction for sider
      async function captureNow(opts = {}) {
        const overlay = shadow.getElementById('wte-overlay');
        try {
          if (overlay) overlay.style.display = 'flex';
          showToast('Capturing page content...', 'info', 1500);
          const label = shadow.getElementById('wte-label').value.trim() || `Tab ${Date.now().toString().slice(-4)}`;
          const url = window.location.href;
          const title = document.title || new URL(url).hostname;
          
          // If current page is a PDF viewer or embeds PDFs, try background PDF extraction first
          try {
            // 1) Built-in viewer (chrome-extension://.../pdf-viewer/index.html?src=...)
            const viewerPdf = derivePdfUrlFromLocation();
            if (viewerPdf) {
              const resp = await chrome.runtime.sendMessage({ type: 'extractPdfText', url: viewerPdf });
              if (resp && resp.ok && resp.text && resp.text.trim().length > 0) {
                const { id } = await addCaptureFor(url, title, label + ' (PDF)', resp.text, opts);
                await render();
                if (id) {
                  showToast('Captured PDF text successfully!', 'success');
                }
                return;
              }
            }
            // 2) Embedded/linked PDFs present on the page are no longer auto-extracted
            // To avoid false positives, we only extract when the current tab is an actual PDF viewer.
          } catch (e) {
            console.warn('PDF extraction attempt failed:', e?.message || e);
          }
          
          // Dynamic capture with site-specific strategy for Sharda course-fee
          let text = '';
          try {
            await preloadLazyContent();
            let dyn = '';
            if (isShardaCourseFeePage()) {
              dyn = await scrapeShardaCourseFees({ maxPages: 50 });
            } else {
              await sweepTabsAndAccordions();
              dyn = await collectDynamicAllText(50);
            }
            const domMain = extractDomOrderedTextWithin(findMainContentContainer(), true) || '';
            console.log('[WTE][capture] lengths', { dynLen: (dyn||'').length, domLen: domMain.length });
            text = (dyn && dyn.length >= 200) ? dyn : domMain;
          } catch (e) {
            console.warn('[WTE][capture] primary extraction failed, fallback to extractDomOrderedText', e?.message || e);
            text = extractDomOrderedText(true) || '';
          }
          if (!text || text.length < 50) {
            // Fallbacks: visible text nodes, then raw innerText dump
            try {
              const visibleText = (function collectAllVisibleText(){
                try {
                  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
                    acceptNode(node) {
                      const s = (node.nodeValue || '').replace(/\s+/g,' ').trim();
                      if (!s) return NodeFilter.FILTER_REJECT;
                      const el = node.parentElement;
                      if (!el) return NodeFilter.FILTER_REJECT;
                      if (/^(script|style|noscript|iframe|object|embed)$/i.test(el.tagName)) return NodeFilter.FILTER_REJECT;
                      const cs = getComputedStyle(el);
                      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return NodeFilter.FILTER_REJECT;
                      return NodeFilter.FILTER_ACCEPT;
                    }
                  });
                  const parts = [];
                  let n;
                  while ((n = walker.nextNode())) {
                    const t = (n.nodeValue || '').replace(/\s+/g,' ').trim();
                    if (t) parts.push(t);
                    if (parts.length > 8000) break; // guard
                  }
                  return cleanText(parts.join('\n'));
                } catch (_) {
                  return '';
                }
              })();
              if (visibleText && visibleText.length >= 20) {
                console.log('[WTE][capture] using visibleText fallback', { len: visibleText.length });
                text = visibleText;
              } else {
                const rawDump = ((document.body && (document.body.innerText || document.body.textContent)) || '').replace(/\r\n?/g,'\n');
                const rawClean = cleanText(rawDump);
                if (rawClean && rawClean.length >= 20) {
                  console.log('[WTE][capture] using rawDump fallback', { len: rawClean.length });
                  text = rawClean;
                } else {
                  const msg = `No meaningful content found to capture (dyn/dom/visible/raw all short)`;
                  console.warn('[WTE][capture] ' + msg);
                  showToast(msg, 'warning');
                  return;
                }
              }
            } catch (err) {
              const rawDump = ((document.body && (document.body.innerText || document.body.textContent)) || '').replace(/\r\n?/g,'\n');
              const rawClean = cleanText(rawDump);
              if (rawClean && rawClean.length >= 20) {
                console.log('[WTE][capture] using rawDump fallback after error', err?.message || err);
                text = rawClean;
              } else {
                showToast('No meaningful content found to capture', 'warning');
                return;
              }
            }
          }

          const { id } = await addCaptureFor(url, title, label, text, opts);
          shadow.getElementById('wte-label').value = '';
          await render();
          if (id) {
            showToast(`Captured "${label}" successfully!`, 'success');
          }
        } catch (error) {
          console.error('Capture failed:', error);
          showToast(`Capture failed: ${error.message}`, 'error');
        } finally {
          if (overlay) overlay.style.display = 'none';
        }
      }

            // Post-process cleaner to strip boilerplate from RAW text on download
      function postProcessAndCleanText(url, text) {
        try {
          if (!text || !text.trim()) return text || '';
          const host = (() => { try { return new URL(url).hostname.replace(/^www\./i,''); } catch (_) { return ''; } })();
          const isSharda = /sharda\.ac\.in$/i.test(host);
          const isNIU = /niu\.edu\.in$/i.test(host);

          const keepCourseRe = /\b(B\.?Tech|B\.?Sc|B\.?A|B\.?Com|BCA|BBA|M\.?Tech|M\.?Sc|MBA|MCA|LLB|LL\.?M|Pharm\.?|Physiotherapy|Optometry|Zoology|Chemistry|Physics|Biology|Biotechnology|Microbiology|Forensic|Nursing|Journalism|Design|Architecture|Economics|Political Science|History|Sociology|Computer Science|Data Science)\b/i;
          const keepFeeRe = /(fee|fees|semester|sem|year|yearly|annual|tuition|₹|rs\.?|amount|enquire now|1st|2nd|3rd|4th|5th|6th|7th|8th|9th|10th)/i;
          const numericInfoRe = /[:|]\s*\d|₹|\d{2,}/;

          // Obvious boilerplate headings/sections to drop
          const dropSectionStarts = [
            'programme 2025-26','schools','academic info','quick links','applying to sharda','suat 2025','study abroad',
            'placements','campus life','about','connect','international','for students','admissions','other links',
            'follow sharda university','subscribe newsletter','no. of visitors','disclaimer','privacy policy','terms of use',
            'virtual tour','plot no.','copyright','©','nba'
          ];
          const dropSectionExact = new Set([
            'A+','A-','A','Programme 2025-26','Schools','Academic Info','Quick Links','Admissions','Connect','International','For Students',
            'APPLY NOW','Apply Now','Apply Now 2025'
          ].map(s => s.toLowerCase()));

          // Site-specific noisy tokens
          const dropShardaTokens = [
            'sharda school','sharda university','suat','world is here','fm radio: suno sharda',
            'the shardans','account help desk','digilocker','webmail','paramarsh'
          ];
          const dropNIUTokens = [
            'noida international university','niu','admission helpline','virtual tour','iqac','iic','nisp'
          ];

          // Script and widget injections
          const dropCodeRe = /(window\.\$superbot|agent\.js|_sb_visitor|<script|www-widgetapi\.js)/i;

          const lines = text.split(/\r?\n/);
          const seen = new Set();
          const out = [];
          let blankRun = 0;

          const looksPaginationBullet = (s) => /^•?\s*(?:«|»|…|\.\.\.|[0-9]{1,3})\s*$/.test(s);
          const looksMenuOnly = (s) => {
            const w = s.replace(/•/g,'').trim();
            if (!w) return true;
            const hasDigit = /\d/.test(w);
            if (hasDigit) return false;
            // short, mostly single tokens often are menus
            const tokens = w.split(/\s+/);
            return tokens.length <= 3 && !keepCourseRe.test(w) && !keepFeeRe.test(w);
          };

          for (let raw of lines) {
            let s = (raw || '').trim();
            if (!s) { blankRun++; if (blankRun <= 1) out.push(''); continue; }
            blankRun = 0;

            const lower = s.toLowerCase();

            // Drop inline script/widget noise
            if (dropCodeRe.test(s)) continue;

            // Drop pagination bullets like "• 1", "• …"
            if (looksPaginationBullet(s)) continue;

            // Drop obvious boilerplate sections
            if (dropSectionExact.has(lower)) continue;
            if (dropSectionStarts.some(k => lower.startsWith(k))) continue;

            // Drop site-specific boilerplate tokens
            if (isSharda && dropShardaTokens.some(t => lower.includes(t))) {
              // keep if this line still looks like fee info
              if (!keepFeeRe.test(s) && !numericInfoRe.test(s)) continue;
            }
            if (isNIU && dropNIUTokens.some(t => lower.includes(t))) {
              if (!keepFeeRe.test(s) && !numericInfoRe.test(s)) continue;
            }

            // Drop long navigation link clusters (menu-looking lines without digits/fees)
            if (looksMenuOnly(s)) {
              // keep if obviously a program/course or has colon with value
              if (!(keepCourseRe.test(s) || /:/.test(s))) continue;
            }

            // Prefer keeping fee/program lines
            const keep = keepFeeRe.test(s) || keepCourseRe.test(s) || numericInfoRe.test(s);
            if (!keep) {
              // heuristics: if line is very long and not boilerplate, keep
              if (s.length < 20) continue;
            }

            // Deduplicate lines globally within this file
            const key = s.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);

            out.push(s);
          }

          // Collapse excessive blank lines
          const cleaned = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
          return cleaned || text;
        } catch (_) {
          return text;
        }
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
          // Apply post-processing cleanup for RAW; For LLM: dedupe but fallback if emptied
          let cleaned = combined;
          if (which === 'raw') {
            cleaned = postProcessAndCleanText(pg.url, combined);
                    }
          // Ensure Source line present
          if (!/\bSource:\s*https?:\/\//i.test(cleaned)) {
            cleaned = cleaned.trim() + `\n\nSource: ${pg.url}`;
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
              const dataUrl = 'data:text/plain;charset=utf-8,' + encodeURIComponent(cleaned);
              const a = document.createElement('a'); a.href = dataUrl; a.download = name; a.style.display='none';
              document.body.appendChild(a); a.click(); setTimeout(()=>{ a.remove(); }, 2000);
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

      shadow.getElementById('wte-add').addEventListener('click', (e) => captureNow({ force: !!e.altKey }));
            shadow.getElementById('wte-dl-raw').addEventListener('click', () => downloadSelected('raw'));
            shadow.getElementById('wte-select-all').addEventListener('change', async (e) => {
        const db = await loadAll(); const checked = !!e.target.checked;
        Object.values(db.pages).forEach(p => (p.captures||[]).forEach(c => { c.selected = checked; }));
        await saveAll(db); await render();
      });
      shadow.getElementById('wte-settings').addEventListener('click', async () => {
        try {
          const resp = await chrome.runtime.sendMessage({ type: 'openOptionsPage' });
          if (!resp || !resp.ok) throw new Error(resp?.error || 'openOptionsPage failed');
        } catch (e) {
          console.error('Failed to open options page:', e);
          showToast('Could not open Settings', 'error');
        }
      });
      shadow.getElementById('wte-clear-site').addEventListener('click', async () => {
        const db = await loadAll();
        const host = location.hostname.replace(/^www\./i,'');
        // Gather pages to remove
        const toRemove = Object.keys(db.pages).filter(k => {
          try { return new URL(db.pages[k].url).hostname.replace(/^www\./i,'') === host; } catch (_) { return false; }
        });
        // Cleanup IDB and global mem for their captures
        try {
          const gmem = await loadGlobalMem();
          for (const k of toRemove) {
            const p = db.pages[k];
            if (p && Array.isArray(p.captures)) {
              for (const c of p.captures) {
                try { await deleteCaptureText(c.id); } catch (_) {}
                if (c.sig && gmem.caps && gmem.caps[c.sig]) {
                  delete gmem.caps[c.sig];
                }
              }
            }
            delete db.pages[k];
            db.order = db.order.filter(x=>x!==k);
          }
          await saveGlobalMem(gmem);
        } catch (_) {
          for (const k of toRemove) {
            delete db.pages[k];
            db.order = db.order.filter(x=>x!==k);
          }
        }
        await saveAll(db);
        await chrome.storage.local.remove(siteKey(location.href));
        await render();
      });

      // Reset global duplicate memory (clears dedupe signatures)
      const resetBtn = document.createElement('button'); resetBtn.className='btn'; resetBtn.textContent='Reset mem'; resetBtn.style.marginLeft='6px'; resetBtn.title='Clear global duplicate memory';
      shadow.querySelector('.toolbar')?.appendChild(resetBtn);
      resetBtn.addEventListener('click', async () => {
        try {
          const gmem = await loadGlobalMem();
          gmem.caps = {};
          await saveGlobalMem(gmem);
          showToast('Global duplicate memory cleared', 'success');
        } catch (e) {
          showToast('Failed to clear memory', 'error');
        }
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
          const domain = t.dataset.toggleDomain;
          const pageKey = t.dataset.toggle;
          const db = await loadAll();

          if (domain) {
            const keys = Object.keys(db.pages).filter(k => {
              try {
                return new URL(db.pages[k].url).hostname.replace(/^www\./i, '') === domain;
              } catch (_) {
                return false;
              }
            });
            const isCollapsed = !db.pages[keys[0]].collapsed;
            keys.forEach(k => {
              db.pages[k].collapsed = isCollapsed;
            });
          } else if (pageKey) {
            const p = db.pages[pageKey];
            if (p) {
              p.collapsed = !p.collapsed;
            }
          }

          await saveAll(db);
          await render();
          return;
        }
        if (t.classList.contains('page-del')) {
          const k = t.getAttribute('data-page');
          const db = await loadAll();
          const p = db.pages[k];
          // Cleanup IDB and global signatures for all captures in this page
          try {
            const gmem = await loadGlobalMem();
            if (p && Array.isArray(p.captures)) {
              for (const c of p.captures) {
                try { await deleteCaptureText(c.id); } catch (_) {}
                if (c.sig && gmem.caps && gmem.caps[c.sig]) {
                  delete gmem.caps[c.sig];
                }
              }
              await saveGlobalMem(gmem);
            }
          } catch (_) {}
          delete db.pages[k];
          db.order = db.order.filter(x=>x!==k);
          await saveAll(db);
          await render();
          return;
        }
        if (t.classList.contains('capDel')) {
          const k = t.getAttribute('data-page'); const id = t.getAttribute('data-id');
          const db = await loadAll(); const p = db.pages[k]; if (!p) return;
          const removed = (p.captures || []).find(c => c.id === id);
          p.captures = (p.captures||[]).filter(c => c.id !== id);
          await saveAll(db);
          // Cleanup IDB blobs
          try { await deleteCaptureText(id); } catch (_) {}
          // Cleanup global duplicate signatures
          if (removed && (removed.sig || removed.sig2)) {
            try {
              const gmem = await loadGlobalMem();
              if (removed.sig && gmem.caps && gmem.caps[removed.sig]) {
                delete gmem.caps[removed.sig];
              }
              if (removed.sig2 && gmem.caps && gmem.caps[removed.sig2]) {
                delete gmem.caps[removed.sig2];
              }
              await saveGlobalMem(gmem);
            } catch (_) {}
          }
          await render();
          return;
        }
              });

      render();
            chrome.storage.onChanged.addListener((changes, area) => { if (area==='local' && changes[STORAGE_KEY]) render(); });
      
      // Maintain size on zoom (approximate)
      const baseDPR = window.devicePixelRatio || 1;
      function syncScale() {
        const cur = window.devicePixelRatio || 1; const scale = baseDPR / cur;
        root.style.transformOrigin = 'top right';
        root.style.transform = `scale(${scale})`;
      }
      window.addEventListener('resize', syncScale, { passive: true });
      syncScale();

      
      // Global memory across all sites (line-level) + capture-level signatures
      const GLOBAL_MEM_KEY = 'wte_global_mem_v1';
      async function loadGlobalMem(){
        try {
          const { [GLOBAL_MEM_KEY]: mem } = await chrome.storage.local.get([GLOBAL_MEM_KEY]);
          return mem || { keys: {}, caps: {} };
        } catch (_) { return { keys: {}, caps: {} }; }
      }
      async function saveGlobalMem(mem){
        try { await chrome.storage.local.set({ [GLOBAL_MEM_KEY]: mem }); } catch (_) {}
      }
      
      
          } catch (e) {
      console.warn('Failed to init sider UI', e);
    }
  })();

})();
