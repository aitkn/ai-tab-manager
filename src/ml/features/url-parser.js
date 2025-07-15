/*
 * AI Tab Manager - URL Parser
 * Advanced URL feature extraction for ML model
 */

import { ML_CONFIG } from '../model-config.js';

/**
 * Parse URL and extract features
 * @param {string} urlString - URL to parse
 * @returns {Object} Extracted features
 */
export function parseURL(urlString) {
  try {
    // Check for browser-specific URLs that can't be parsed by URL constructor
    const browserProtocols = ['chrome://', 'about:', 'edge://', 'brave://', 'opera://', 'vivaldi://', 'chrome-extension://'];
    const isBrowserURL = browserProtocols.some(protocol => urlString.startsWith(protocol));
    
    if (isBrowserURL) {
      // Return browser-specific features instead of empty features
      return getBrowserURLFeatures(urlString);
    }
    
    const url = new URL(urlString);
    const features = {
      // Basic components
      protocol: url.protocol.replace(':', ''),
      hostname: url.hostname,
      port: url.port || getDefaultPort(url.protocol),
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
      
      // Derived features
      domain: extractDomain(url.hostname),
      subdomain: extractSubdomain(url.hostname),
      tld: extractTLD(url.hostname),
      pathSegments: extractPathSegments(url.pathname),
      queryParams: extractQueryParams(url.search),
      
      // Numerical features
      pathDepth: countPathDepth(url.pathname),
      queryCount: countQueryParams(url.search),
      urlLength: urlString.length,
      domainLength: url.hostname.length,
      pathLength: url.pathname.length
    };
    
    return features;
  } catch (error) {
    console.error('Error parsing URL:', error);
    console.warn('Returning empty features for invalid URL:', urlString);
    return getEmptyFeatures();
  }
}

/**
 * Extract domain from hostname
 */
function extractDomain(hostname) {
  const parts = hostname.split('.');
  if (parts.length >= 2) {
    return parts.slice(-2).join('.');
  }
  return hostname;
}

/**
 * Extract subdomain from hostname
 */
function extractSubdomain(hostname) {
  const parts = hostname.split('.');
  if (parts.length > 2) {
    return parts.slice(0, -2).join('.');
  }
  return '';
}

/**
 * Extract TLD from hostname
 */
function extractTLD(hostname) {
  const parts = hostname.split('.');
  return parts[parts.length - 1] || '';
}

/**
 * Extract path segments
 */
function extractPathSegments(pathname) {
  return pathname
    .split('/')
    .filter(segment => segment.length > 0)
    .map(segment => decodeURIComponent(segment).toLowerCase());
}

/**
 * Extract query parameters
 */
function extractQueryParams(search) {
  const params = {};
  if (search) {
    const searchParams = new URLSearchParams(search);
    for (const [key, value] of searchParams) {
      params[key] = value;
    }
  }
  return params;
}

/**
 * Count path depth
 */
function countPathDepth(pathname) {
  return pathname.split('/').filter(s => s.length > 0).length;
}

/**
 * Count query parameters
 */
function countQueryParams(search) {
  return search ? new URLSearchParams(search).size : 0;
}

/**
 * Get default port for protocol
 */
function getDefaultPort(protocol) {
  const defaults = {
    'http:': '80',
    'https:': '443',
    'ftp:': '21'
  };
  return defaults[protocol] || '';
}

/**
 * Get empty features object
 */
function getEmptyFeatures() {
  return {
    protocol: '',
    hostname: '',
    port: '',
    pathname: '/',
    search: '',
    hash: '',
    domain: '',
    subdomain: '',
    tld: '',
    pathSegments: [],
    queryParams: {},
    pathDepth: 0,
    queryCount: 0,
    urlLength: 0,
    domainLength: 0,
    pathLength: 0
  };
}

/**
 * Get features for browser-specific URLs
 * Extracts meaningful information even from non-standard URLs
 */
function getBrowserURLFeatures(urlString) {
  // Extract protocol
  const protocolMatch = urlString.match(/^([^:]+):/);
  const protocol = protocolMatch ? protocolMatch[1] : '';
  
  // Extract the part after protocol://
  const afterProtocol = urlString.replace(/^[^:]+:\/\//, '');
  
  // For about: URLs, the entire string after about: is the "pathname"
  if (protocol === 'about') {
    return {
      protocol: 'about',
      hostname: 'browser',
      port: '',
      pathname: afterProtocol || 'blank',
      search: '',
      hash: '',
      domain: 'browser',
      subdomain: '',
      tld: '',
      pathSegments: afterProtocol ? [afterProtocol] : ['blank'],
      queryParams: {},
      pathDepth: 1,
      queryCount: 0,
      urlLength: urlString.length,
      domainLength: 7, // 'browser'.length
      pathLength: afterProtocol.length
    };
  }
  
  // For chrome://, edge://, etc. - parse the page name
  const parts = afterProtocol.split('/');
  const hostname = parts[0] || protocol; // e.g., 'settings', 'extensions'
  const pathParts = parts.slice(1).filter(p => p);
  
  return {
    protocol: protocol,
    hostname: hostname || protocol,
    port: '',
    pathname: '/' + pathParts.join('/'),
    search: '',
    hash: '',
    domain: protocol,
    subdomain: '',
    tld: '',
    pathSegments: pathParts,
    queryParams: {},
    pathDepth: pathParts.length,
    queryCount: 0,
    urlLength: urlString.length,
    domainLength: hostname.length,
    pathLength: pathParts.join('/').length
  };
}

/**
 * Extract binary features based on patterns
 * @param {string} url - URL string
 * @returns {Array<number>} Binary feature array
 */
export function extractPatternFeatures(url) {
  const features = [];
  
  for (const patternConfig of ML_CONFIG.features.urlPatterns) {
    features.push(patternConfig.pattern.test(url) ? 1 : 0);
  }
  
  return features;
}

/**
 * Check if URL contains important tokens
 * @param {string} url - URL string
 * @returns {Array<number>} Binary array for each important token
 */
export function extractTokenFeatures(url) {
  const lowerUrl = url.toLowerCase();
  return ML_CONFIG.features.importantTokens.map(token => 
    lowerUrl.includes(token) ? 1 : 0
  );
}

/**
 * Extract numerical features
 * @param {Object} parsedUrl - Parsed URL object
 * @returns {Array<number>} Normalized numerical features
 */
export function extractNumericalFeatures(parsedUrl) {
  return [
    // Normalize lengths (0-1 range)
    Math.min(parsedUrl.urlLength / 200, 1),
    Math.min(parsedUrl.domainLength / 50, 1),
    Math.min(parsedUrl.pathLength / 100, 1),
    Math.min(parsedUrl.pathDepth / 10, 1),
    Math.min(parsedUrl.queryCount / 10, 1),
    
    // Protocol features
    parsedUrl.protocol === 'https' ? 1 : 0,
    parsedUrl.protocol === 'http' ? 1 : 0,
    
    // Special cases
    parsedUrl.hostname === 'localhost' ? 1 : 0,
    parsedUrl.hostname.startsWith('192.168') ? 1 : 0,
    parsedUrl.hostname.includes('.local') ? 1 : 0
  ];
}

/**
 * Extract all features for ML model
 * @param {string} url - URL string
 * @returns {Object} Complete feature set
 */
export function extractAllFeatures(url) {
  const parsed = parseURL(url);
  const patterns = extractPatternFeatures(url);
  const tokens = extractTokenFeatures(url);
  const numerical = extractNumericalFeatures(parsed);
  
  return {
    parsed,
    patterns,
    tokens,
    numerical,
    // Concatenated feature vector
    vector: [...patterns, ...tokens, ...numerical]
  };
}

/**
 * Get feature names for debugging
 */
export function getFeatureNames() {
  const names = [];
  
  // Pattern features
  ML_CONFIG.features.urlPatterns.forEach(p => {
    names.push(`pattern_${p.name}`);
  });
  
  // Token features
  ML_CONFIG.features.importantTokens.forEach(token => {
    names.push(`token_${token}`);
  });
  
  // Numerical features
  names.push(
    'url_length_norm',
    'domain_length_norm',
    'path_length_norm',
    'path_depth_norm',
    'query_count_norm',
    'is_https',
    'is_http',
    'is_localhost',
    'is_local_ip',
    'is_local_domain'
  );
  
  return names;
}

export default {
  parseURL,
  extractPatternFeatures,
  extractTokenFeatures,
  extractNumericalFeatures,
  extractAllFeatures,
  getFeatureNames
};