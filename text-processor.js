/**
 * Text Processor for Chrome Extension
 * JavaScript implementation of text preprocessing for LLM training
 */

class TextProcessor {
  constructor() {
    // Input validation patterns
    this.MAX_TEXT_LENGTH = 10000000; // 10MB max
    this.MALICIOUS_PATTERNS = [
      /<script[^>]*>.*?<\/script>/gi,
      /javascript:/gi,
      /on\w+\s*=/gi,
      /<iframe[^>]*>/gi,
      /<object[^>]*>/gi,
      /<embed[^>]*>/gi
    ];

    // Common stop words
    this.stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
      'by', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
      'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must',
      'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they',
      'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his', 'her', 'its', 'our', 'their'
    ]);

    // Web-specific stop words
    this.webStopWords = new Set([
      'javascript', 'void', 'http', 'https', 'www', 'com', 'html', 'click', 'link',
      'page', 'website', 'web', 'online', 'url', 'menu', 'navigation', 'header',
      'footer', 'sidebar', 'home', 'contact', 'about', 'login', 'register', 'search',
      'view', 'more', 'read', 'see', 'show', 'hide', 'toggle', 'button', 'tab',
      'window', 'close', 'open', 'new', 'skip', 'content', 'main', 'top', 'bottom'
    ]);

    // Combined stop words
    this.allStopWords = new Set([...this.stopWords, ...this.webStopWords]);
  }
  /**
   * Merge extracted tables into processedData for LLM formatting
   * tables: Array<{ caption: string, rows: string[][] }>
   */
  enrichWithTables(processedData, tables = []) {
    if (!tables || tables.length === 0) return processedData;
    const sections = { ...(processedData.sections || {}) };
    const lines = [];
    tables.forEach(tbl => {
      if (tbl.caption) {
        lines.push(tbl.caption.toUpperCase());
      }
      const maxCols = Math.max(...tbl.rows.map(r => r.length));
      tbl.rows.forEach(r => {
        if (maxCols === 2 && r.length === 2) {
          lines.push(`- ${r[0]}: ${r[1]}`);
        } else {
          lines.push(`- ${r.join(' | ')}`);
        }
      });
      lines.push('');
    });
    sections.fee_tables = lines.join('\n');
    return { ...processedData, sections };
  }

  /**
   * Validate and sanitize input text with improved performance
   */
  validateInput(text) {
    if (!text || typeof text !== 'string') {
      throw new Error('Invalid input: text must be a non-empty string');
    }

    if (text.length > this.MAX_TEXT_LENGTH) {
      throw new Error(`Input too large: maximum ${this.MAX_TEXT_LENGTH.toLocaleString()} characters allowed`);
    }

    // Efficient malicious pattern checking
    let sanitizedText = text;
    let foundMaliciousContent = false;
    
    for (const pattern of this.MALICIOUS_PATTERNS) {
      if (pattern.test(sanitizedText)) {
        foundMaliciousContent = true;
        sanitizedText = sanitizedText.replace(pattern, '');
      }
    }
    
    if (foundMaliciousContent) {
      console.warn('Potentially malicious content detected and sanitized');
    }

    return sanitizedText;
  }

  /**
   * Clean and normalize text
   */
  cleanText(text, options = {}) {
    try {
      text = this.validateInput(text);
    } catch (error) {
      console.error('Text validation failed:', error);
      return '';
    }

    let cleaned = text;

    // Convert to lowercase only if explicitly requested
    if (options.lowercase === true) {
      cleaned = cleaned.toLowerCase();
    }

    // Remove URLs
    if (options.removeUrls !== false) {
      cleaned = cleaned.replace(/https?:\/\/[^\s]+/g, '');
      cleaned = cleaned.replace(/www\.[^\s]+/g, '');
    }

    // Remove email addresses
    if (options.removeEmails !== false) {
      cleaned = cleaned.replace(/\S+@\S+\.\S+/g, '');
    }

    // Remove phone numbers
    if (options.removePhones !== false) {
      cleaned = cleaned.replace(/[\+]?[\d\s\-\(\)]{10,}/g, '');
    }

    // Remove special navigation patterns
    cleaned = cleaned.replace(/javascript:void\(0\)/gi, '');
    cleaned = cleaned.replace(/\bvoid\s*0\b/gi, '');
    cleaned = cleaned.replace(/\[.*?\]\s*-\s*https?:\/\/\S+/g, '');

    // Remove excessive punctuation and special characters
    if (options.removePunctuation) {
      cleaned = cleaned.replace(/[^\w\s]/g, ' ');
    } else {
      cleaned = cleaned.replace(/[^\w\s\.\,\!\?;:]/g, ' ');
    }

    // Remove numbers if requested
    if (options.removeNumbers) {
      cleaned = cleaned.replace(/\b\d+\b/g, '');
    }

    // Normalize whitespace but preserve line breaks (paragraphs)
    cleaned = cleaned.replace(/\r\n?/g, '\n');
    cleaned = cleaned
      .split('\n')
      .map(line => line.replace(/\s+/g, ' ').trim())
      .filter(line => line.length > 0)
      .join('\n');

    // Remove common web UI noise
    const NOISE_PATTERNS = [
      /\bapply now\b/gi,
      /\bimage gallery\b/gi,
      /\bvideo gallery\b/gi,
      /\bquick links\b/gi,
      /\bvirtual tour\b/gi,
      /\bdisclaimer\b/gi,
      /\bprivacy policy\b/gi,
      /\bterms of use\b/gi,
      /\bwhat'?s new\b/gi,
      /\bhello\s+how can i help\b/gi
    ];
    for (const pattern of NOISE_PATTERNS) {
      cleaned = cleaned.replace(pattern, '');
    }

    return cleaned;
  }

  /**
   * Remove duplicate sentences
   */
  removeDuplicates(text) {
    if (!text) return '';

    const sentences = this.sentenceTokenize(text);
    const uniqueSentences = [];
    const seen = new Set();

    for (const sentence of sentences) {
      const cleanSentence = sentence.replace(/\s+/g, ' ').trim();
      if (cleanSentence.length > 10 && !seen.has(cleanSentence)) {
        seen.add(cleanSentence);
        uniqueSentences.push(sentence);
      }
    }

    return uniqueSentences.join('. ');
  }

  /**
   * Remove duplicate lines while preserving structure
   */
  removeDuplicateLines(text) {
    if (!text) return '';
    const lines = text.split('\n');
    const seen = new Set();
    const unique = [];
    for (const line of lines) {
      const normalized = line.replace(/\s+/g, ' ').trim();
      if (normalized.length === 0) continue;
      if (!seen.has(normalized)) {
        seen.add(normalized);
        unique.push(line);
      }
    }
    return unique.join('\n');
  }

  /**
   * Simple sentence tokenization
   */
  sentenceTokenize(text) {
    return text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  }

  /**
   * Word tokenization with improved performance
   */
  wordTokenize(text) {
    if (!text || typeof text !== 'string') {
      return [];
    }
    
    return text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 0 && word.length < 50); // Filter out extremely long words
  }

  /**
   * Remove stop words from tokens
   */
  removeStopWords(tokens, includeWebStopWords = true) {
    const stopWordSet = includeWebStopWords ? this.allStopWords : this.stopWords;
    return tokens.filter(token => 
      token.length > 2 && 
      !stopWordSet.has(token.toLowerCase()) &&
      true
    );
  }

  /**
   * Remove stop words directly from a text while preserving punctuation/newlines
   */
  removeStopWordsFromText(text, includeWebStopWords = true) {
    const stopWordSet = includeWebStopWords ? this.allStopWords : this.stopWords;
    return text
      .split('\n')
      .map(line => {
        const parts = line.split(/(\W+)/); // keep separators
        const filtered = parts.map(token => {
          if (/^\w+$/.test(token)) {
            const isStop = stopWordSet.has(token.toLowerCase());
            return isStop ? '' : token;
          }
          return token;
        }).join('');
        return filtered.replace(/\s+/g, ' ').trim();
      })
      .filter(l => l.length > 0)
      .join('\n');
  }

  /**
   * Extract key sections from webpage content
   */
  extractSections(text) {
    const sections = {
      title: '',
      main_content: '',
      navigation: '',
      contact_info: '',
      programs: '',
      faculty: '',
      testimonials: ''
    };

    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);

    // Extract title (first meaningful line)
    for (const line of lines.slice(0, 5)) {
      if (line.length < 100 && (
        line.includes('university') || 
        line.includes('college') || 
        line.includes('school') ||
        line.includes('institute')
      )) {
        sections.title = line;
        break;
      }
    }

    // Extract faculty information
    const facultyPattern = /prof\.?\s+.*?(?=prof\.|\n|$)/gi;
    const facultyMatches = text.match(facultyPattern) || [];
    sections.faculty = facultyMatches.slice(0, 10).join(' ');

    // Extract program information
    const programKeywords = ['programme', 'program', 'course', 'degree', 'mba', 'phd', 'bachelor', 'master'];
    const programLines = lines.filter(line => 
      programKeywords.some(keyword => line.toLowerCase().includes(keyword)) && 
      line.length < 200
    );
    sections.programs = programLines.slice(0, 20).join(' ');

    // Extract testimonials
    const testimonialKeywords = ['testimonial', 'placed in', 'experience', 'studying', 'delighted'];
    const testimonialLines = lines.filter(line =>
      testimonialKeywords.some(keyword => line.toLowerCase().includes(keyword))
    );
    sections.testimonials = testimonialLines.slice(0, 5).join(' ');

    // Extract contact information
    const contactPattern = /(?:contact|phone|email|address).*?(?=\n|$)/gi;
    const contactMatches = text.match(contactPattern) || [];
    sections.contact_info = contactMatches.slice(0, 5).join(' ');

    // Main content (everything else)
    sections.main_content = text.replace(sections.faculty, '')
                               .replace(sections.programs, '')
                               .replace(sections.testimonials, '')
                               .trim();

    return sections;
  }

  /**
   * Extract key phrases using n-grams
   */
  extractKeyPhrases(tokens, nGrams = 2) {
    if (tokens.length < nGrams) return [];

    const phrases = [];
    for (let i = 0; i <= tokens.length - nGrams; i++) {
      phrases.push(tokens.slice(i, i + nGrams).join(' '));
    }

    // Count phrase frequency
    const phraseCount = {};
    phrases.forEach(phrase => {
      phraseCount[phrase] = (phraseCount[phrase] || 0) + 1;
    });

    // Return most common phrases
    return Object.entries(phraseCount)
      .filter(([phrase, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([phrase]) => phrase);
  }

  /**
   * Calculate text statistics
   */
  calculateStats(originalText, processedText, tokens) {
    const uniqueTokens = [...new Set(tokens)];
    
    return {
      originalLength: originalText.length,
      processedLength: processedText.length,
      compressionRatio: processedText.length / originalText.length,
      tokenCount: tokens.length,
      uniqueTokens: uniqueTokens.length,
      vocabularyDiversity: uniqueTokens.length / tokens.length,
      sentenceCount: this.sentenceTokenize(processedText).length
    };
  }

  /**
   * Process large text in chunks for better performance.
   *
   * Supports both signatures for backward-compatibility:
   * - processLargeText(text, chunkSize)
   * - processLargeText(text, options, chunkSize)
   *
   * When options are provided, they are passed through to processForLLM
   * so that large-text processing respects user settings.
   */
  processLargeText(text, optionsOrChunkSize = {}, maybeChunkSize = 100000) {
    // Determine provided parameters
    const isNumberSecondParam = typeof optionsOrChunkSize === 'number';
    const processingOptions = isNumberSecondParam ? undefined : optionsOrChunkSize || {};
    const chunkSize = isNumberSecondParam
      ? optionsOrChunkSize
      : (typeof maybeChunkSize === 'number' ? maybeChunkSize : 100000);

    if (!text || typeof text !== 'string') {
      return this.processForLLM('');
    }

    if (text.length <= chunkSize) {
      return this.processForLLM(text, processingOptions);
    }
    
    const chunks = [];
    for (let i = 0; i < text.length; i += chunkSize) {
      const nextChunk = text.substring(i, i + chunkSize);
      if (nextChunk && nextChunk.length > 0) {
        chunks.push(nextChunk);
      }
    }
    
    const processedChunks = chunks.map(chunk => this.processForLLM(chunk, processingOptions));
    
    // Merge the results
    const mergedText = processedChunks.map(p => p.processedText).join(' ');
    const mergedSections = processedChunks.reduce((acc, p) => {
      Object.keys(p.sections || {}).forEach(key => {
        acc[key] = (acc[key] || '') + ' ' + (p.sections[key] || '');
      });
      return acc;
    }, {});
    
    const mergedKeyPhrases = [...new Set(processedChunks.flatMap(p => p.keyPhrases || []))];
    const mergedTokens = processedChunks.flatMap(p => p.tokens || []);
    
    return {
      processedText: mergedText,
      sections: mergedSections,
      keyPhrases: mergedKeyPhrases.slice(0, 50), // Limit key phrases
      tokens: mergedTokens,
      stats: this.calculateStats(text, mergedText, mergedTokens),
      sentences: this.sentenceTokenize(mergedText)
    };
  }

  /**
   * Complete preprocessing pipeline with performance optimizations
   */
  processForLLM(rawText, options = {}) {
    const processingOptions = {
      removeDuplicates: true,
      removeUrls: true,
      removeEmails: true,
      removePhones: true,
      removeNumbers: false,
      removePunctuation: false,
      includeStopWords: false,
      extractSections: true,
      extractKeyPhrases: true,
      ...options
    };

    // Step 1: Clean text
    const cleanedText = this.cleanText(rawText, processingOptions);

    // Step 2: Remove duplicates (line-aware to preserve structure)
    const deduplicatedText = processingOptions.removeDuplicates ? 
      this.removeDuplicateLines(cleanedText) : cleanedText;

    // Step 3: Extract sections
    const sections = processingOptions.extractSections ? 
      this.extractSections(deduplicatedText) : {};

    // Step 4: Tokenize
    const tokens = this.wordTokenize(deduplicatedText);

    // Step 5: Remove stop words
    const filteredTokens = processingOptions.includeStopWords ? 
      tokens : this.removeStopWords(tokens);

    // Step 6: Extract key phrases
    const keyPhrases = processingOptions.extractKeyPhrases ? 
      this.extractKeyPhrases(filteredTokens) : [];

    // Step 7: Calculate statistics
    const stats = this.calculateStats(rawText, deduplicatedText, filteredTokens);

    // Optionally remove stopwords from the output text for the "clean" view
    const finalProcessedText = processingOptions.includeStopWords ?
      deduplicatedText : this.removeStopWordsFromText(deduplicatedText);

    return {
      processedText: finalProcessedText,
      sections,
      keyPhrases,
      tokens: filteredTokens,
      stats,
      sentences: this.sentenceTokenize(deduplicatedText)
    };
  }

  /**
   * Create LLM-ready format
   */
  createLLMFormat(processedData) {
    const { sections, keyPhrases, stats } = processedData;

    return `INSTITUTION: ${sections.title || 'Webpage Content'}

OVERVIEW:
${sections.main_content ? sections.main_content.substring(0, 500) + '...' : 'No overview available'}

ACADEMIC PROGRAMS:
${sections.programs || 'No program information found'}

FACULTY HIGHLIGHTS:
${sections.faculty || 'No faculty information found'}

STUDENT TESTIMONIALS:
${sections.testimonials || 'No testimonials found'}

CONTACT INFORMATION:
${sections.contact_info || 'No contact information found'}

HOSTEL/FEES TABLES:
${sections.fee_tables || 'No fee tables found'}

KEY TOPICS: ${keyPhrases.slice(0, 10).join(', ')}

CONTENT STATISTICS:
- Original length: ${stats.originalLength.toLocaleString()} characters
- Processed length: ${stats.processedLength.toLocaleString()} characters
- Unique tokens: ${stats.uniqueTokens.toLocaleString()}
- Compression ratio: ${(stats.compressionRatio * 100).toFixed(1)}%
- Vocabulary diversity: ${(stats.vocabularyDiversity * 100).toFixed(1)}%`;
  }

  /**
   * Create structured JSON format
   */
  createJSONFormat(processedData) {
    return JSON.stringify({
      metadata: {
        processed_at: new Date().toISOString(),
        stats: processedData.stats
      },
      content: {
        sections: processedData.sections,
        key_phrases: processedData.keyPhrases,
        processed_text: processedData.processedText
      }
    }, null, 2);
  }
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TextProcessor;
} else {
  window.TextProcessor = TextProcessor;
}