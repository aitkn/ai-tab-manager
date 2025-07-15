/*
 * AI Tab Manager - Text Tokenizer
 * Tokenization for URLs and titles
 */

/**
 * Tokenize a URL into meaningful parts with n-grams
 * @param {string} url - URL to tokenize
 * @param {boolean} includeNGrams - Whether to include n-grams (default: true)
 * @returns {Array<string>} Array of tokens
 */
export function tokenizeURL(url, includeNGrams = true) {
  try {
    const urlObj = new URL(url);
    const tokens = [];
    
    // Protocol (without colon)
    tokens.push(urlObj.protocol.replace(':', ''));
    
    // Hostname parts with character n-grams for domains
    const hostParts = urlObj.hostname.split('.');
    tokens.push(...hostParts);
    
    // Add character n-grams for main domain (not subdomains or TLD)
    if (includeNGrams && hostParts.length >= 2) {
      const mainDomain = hostParts[hostParts.length - 2]; // e.g., 'github' from 'api.github.com'
      if (mainDomain.length >= 4) { // Only for domains 4+ chars
        const domainNGrams = extractCharNGrams(mainDomain, 3, 4);
        tokens.push(...domainNGrams.map(ngram => `dom_${ngram}`)); // Prefix to distinguish
      }
    }
    
    // Path segments
    const pathSegments = urlObj.pathname
      .split(/[\/\-_\.]/)
      .filter(segment => segment.length > 1 && !/^\d+$/.test(segment)); // Filter out numbers and single chars
    tokens.push(...pathSegments);
    
    // Add token bigrams for path segments (if we have multiple segments)
    if (includeNGrams && pathSegments.length >= 2) {
      const pathBigrams = extractNGrams(pathSegments, 2);
      tokens.push(...pathBigrams.map(bigram => `path_${bigram}`)); // Prefix to distinguish
    }
    
    // Query parameter keys (not values for privacy)
    if (urlObj.search) {
      const params = new URLSearchParams(urlObj.search);
      const paramKeys = Array.from(params.keys());
      tokens.push(...paramKeys);
      
      // Add parameter bigrams if we have multiple parameters
      if (includeNGrams && paramKeys.length >= 2) {
        const paramBigrams = extractNGrams(paramKeys, 2);
        tokens.push(...paramBigrams.map(bigram => `param_${bigram}`));
      }
    }
    
    // Clean and normalize tokens
    return tokens
      .map(token => token.toLowerCase())
      .filter(token => token.length > 0 && token !== 'www');
      
  } catch (error) {
    // Fallback for invalid URLs
    return url
      .toLowerCase()
      .split(/[^\w]+/)
      .filter(token => token.length > 1);
  }
}

/**
 * Tokenize a title into words with n-grams
 * @param {string} title - Title to tokenize
 * @param {boolean} includeNGrams - Whether to include n-grams (default: true)
 * @returns {Array<string>} Array of tokens
 */
export function tokenizeTitle(title, includeNGrams = true) {
  if (!title) return [];
  
  // Remove special characters and split by whitespace
  const tokens = title
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 1);
  
  // Remove common stop words
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these',
    'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'which',
    'who', 'when', 'where', 'why', 'how', 'all', 'each', 'every', 'some',
    'any', 'few', 'more', 'most', 'other', 'into', 'through', 'during',
    'before', 'after', 'above', 'below', 'up', 'down', 'out', 'off', 'over',
    'under', 'again', 'then', 'once'
  ]);
  
  const filteredTokens = tokens.filter(token => !stopWords.has(token));
  
  // Start with individual tokens
  const result = [...filteredTokens];
  
  if (includeNGrams && filteredTokens.length >= 2) {
    // Add word bigrams for common phrases
    const wordBigrams = extractNGrams(filteredTokens, 2);
    result.push(...wordBigrams.map(bigram => `title_${bigram}`)); // Prefix to distinguish
    
    // Add character n-grams for handling compound words, abbreviations, model numbers
    filteredTokens.forEach(token => {
      if (token.length >= 4) { // Only for longer tokens
        const charNGrams = extractCharNGrams(token, 3, 4);
        result.push(...charNGrams.map(ngram => `char_${ngram}`)); // Prefix to distinguish
      }
    });
  }
  
  return result;
}

/**
 * Extract n-grams from tokens
 * @param {Array<string>} tokens - Array of tokens
 * @param {number} n - Size of n-grams
 * @returns {Array<string>} Array of n-grams
 */
export function extractNGrams(tokens, n = 2) {
  const ngrams = [];
  
  for (let i = 0; i <= tokens.length - n; i++) {
    ngrams.push(tokens.slice(i, i + n).join('_'));
  }
  
  return ngrams;
}

/**
 * Extract character n-grams from a string
 * @param {string} text - Text to extract character n-grams from
 * @param {number} minN - Minimum n-gram size
 * @param {number} maxN - Maximum n-gram size
 * @returns {Array<string>} Array of character n-grams
 */
export function extractCharNGrams(text, minN = 3, maxN = 4) {
  const ngrams = [];
  const cleanText = text.toLowerCase().replace(/[^a-z0-9]/g, '');
  
  if (cleanText.length < minN) {
    return ngrams;
  }
  
  for (let n = minN; n <= maxN; n++) {
    for (let i = 0; i <= cleanText.length - n; i++) {
      const ngram = cleanText.slice(i, i + n);
      // Filter out n-grams that are all numbers or too repetitive
      if (!/^\d+$/.test(ngram) && !isRepetitive(ngram)) {
        ngrams.push(ngram);
      }
    }
  }
  
  return ngrams;
}

/**
 * Check if a string is too repetitive (same character repeated)
 * @param {string} str - String to check
 * @returns {boolean} True if repetitive
 */
function isRepetitive(str) {
  if (str.length <= 2) return false;
  const firstChar = str[0];
  return str.split('').every(char => char === firstChar);
}

/**
 * Combine URL and title tokens with proper weighting
 * @param {Array<string>} urlTokens - URL tokens
 * @param {Array<string>} titleTokens - Title tokens
 * @returns {Array<string>} Combined tokens
 */
export function combineTokens(urlTokens, titleTokens) {
  // Give more weight to domain and title tokens
  const combined = [];
  
  // Domain tokens (first few URL tokens) get added twice
  combined.push(...urlTokens.slice(0, 3));
  combined.push(...urlTokens.slice(0, 3));
  
  // All URL tokens
  combined.push(...urlTokens);
  
  // Title tokens get added twice for importance
  combined.push(...titleTokens);
  combined.push(...titleTokens);
  
  return combined;
}

/**
 * Clean and normalize a token
 * @param {string} token - Token to clean
 * @returns {string} Cleaned token
 */
export function cleanToken(token) {
  return token
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * Check if token is valid
 * @param {string} token - Token to check
 * @returns {boolean} True if valid
 */
export function isValidToken(token) {
  // Token should be:
  // - At least 2 characters
  // - Not all numbers
  // - Not a common file extension
  const invalidExtensions = new Set(['html', 'htm', 'php', 'asp', 'jsp', 'cgi']);
  
  return token.length >= 2 && 
         !/^\d+$/.test(token) && 
         !invalidExtensions.has(token);
}

/**
 * Extract special tokens that indicate importance
 * @param {string} url - URL string
 * @param {string} title - Title string
 * @returns {Object} Special token indicators
 */
export function extractSpecialTokens(url, title) {
  const combined = (url + ' ' + title).toLowerCase();
  
  return {
    hasLogin: /login|signin|auth/.test(combined),
    hasCheckout: /checkout|payment|order|cart/.test(combined),
    hasDocs: /docs?|documentation|guide|tutorial|manual/.test(combined),
    hasAPI: /api|endpoint|webhook/.test(combined),
    hasAdmin: /admin|dashboard|panel|console/.test(combined),
    hasSearch: /search|query|results/.test(combined),
    hasSettings: /settings|preferences|config/.test(combined),
    hasProfile: /profile|account|user/.test(combined),
    hasDownload: /download|export|save/.test(combined),
    hasUpload: /upload|import|attach/.test(combined)
  };
}

/**
 * Get token statistics
 * @param {Array<string>} tokens - Array of tokens
 * @returns {Object} Token statistics
 */
export function getTokenStats(tokens) {
  const stats = {
    count: tokens.length,
    uniqueCount: new Set(tokens).size,
    avgLength: tokens.reduce((sum, t) => sum + t.length, 0) / tokens.length || 0,
    maxLength: Math.max(...tokens.map(t => t.length), 0),
    diversity: new Set(tokens).size / tokens.length || 0
  };
  
  return stats;
}

export default {
  tokenizeURL,
  tokenizeTitle,
  extractNGrams,
  extractCharNGrams,
  combineTokens,
  cleanToken,
  isValidToken,
  extractSpecialTokens,
  getTokenStats
};