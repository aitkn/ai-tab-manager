/*
 * AI Tab Manager - Copyright (c) 2025 AI Tech Knowledge LLC
 * Favicon loading utilities with performance optimizations
 */

import { URLS } from './constants.js';

// Cache for loaded favicons to avoid duplicate requests
const faviconCache = new Map();
const pendingRequests = new Map();

// Persistent cache key for browser.storage
const FAVICON_STORAGE_KEY = 'faviconCache';
const STORAGE_CACHE_DURATION = 86400000; // 24 hours for persistent cache

// Load persisted favicon cache on module initialization
loadPersistedCache();

// Configuration
const FAVICON_CONFIG = {
  TIMEOUT: 3000, // 3 second timeout (reduced from 5s)
  PLACEHOLDER_DELAY: 100, // Show placeholder after 100ms
  MAX_RETRIES: 1,
  CACHE_DURATION: 300000 // 5 minutes
};

/**
 * Create optimized favicon element with timeout and fallback handling
 * @param {Object} tab - Tab object with favIconUrl and domain properties
 * @returns {HTMLImageElement} Optimized favicon image element
 */
export function createOptimizedFavicon(tab) {
  const favicon = document.createElement('img');
  favicon.className = 'favicon';
  // Start with placeholder visible immediately on first install
  favicon.src = URLS.DEFAULT_FAVICON;
  favicon.style.opacity = '1';  // Full opacity for better visibility
  favicon.style.transition = 'opacity 200ms ease';
  
  // Check if we have a cached favicon URL first
  const faviconUrl = getFaviconUrl(tab);
  const cacheKey = faviconUrl;
  
  if (faviconCache.has(cacheKey)) {
    const cachedData = faviconCache.get(cacheKey);
    if (Date.now() - cachedData.timestamp < STORAGE_CACHE_DURATION) {
      // We have a valid cached favicon, use it immediately
      favicon.src = cachedData.url;
      favicon.style.opacity = cachedData.success ? '1' : '0.5';
      favicon.classList.add(cachedData.success ? 'favicon-loaded' : 'favicon-failed');
      return favicon;
    }
  }
  
  // For Google's favicon service, we can set it directly without testing
  // Google's service is reliable and returns a default icon if none exists
  if (faviconUrl.includes('google.com/s2/favicons')) {
    favicon.src = faviconUrl;
    favicon.style.opacity = '1';
    favicon.classList.add('favicon-loaded');
    
    // Cache it for next time
    faviconCache.set(cacheKey, {
      url: faviconUrl,
      success: true,
      timestamp: Date.now()
    });
    scheduleCacheSave();
    
    return favicon;
  }
  
  // For other URLs, load asynchronously
  loadFaviconWithTimeout(tab, favicon);
  
  return favicon;
}

/**
 * Load favicon with timeout and caching
 * @param {Object} tab - Tab object
 * @param {HTMLImageElement} favicon - Favicon element to update
 */
async function loadFaviconWithTimeout(tab, favicon) {
  const faviconUrl = getFaviconUrl(tab);
  const cacheKey = faviconUrl;
  
  // Check cache first
  if (faviconCache.has(cacheKey)) {
    const cachedData = faviconCache.get(cacheKey);
    if (Date.now() - cachedData.timestamp < FAVICON_CONFIG.CACHE_DURATION) {
      applyFavicon(favicon, cachedData.url, cachedData.success);
      return;
    } else {
      faviconCache.delete(cacheKey);
    }
  }
  
  // Check if request is already pending
  if (pendingRequests.has(cacheKey)) {
    const result = await pendingRequests.get(cacheKey);
    applyFavicon(favicon, result.url, result.success);
    return;
  }
  
  // Create new request with timeout, pass tab for fallback options
  const loadPromise = loadWithTimeoutAndFallback(faviconUrl, tab);
  pendingRequests.set(cacheKey, loadPromise);
  
  try {
    const result = await loadPromise;
    
    // Cache the result
    faviconCache.set(cacheKey, {
      url: result.url,
      success: result.success,
      timestamp: Date.now()
    });
    
    // Schedule cache save to persist successful loads
    if (result.success) {
      scheduleCacheSave();
    }
    
    applyFavicon(favicon, result.url, result.success);
  } catch (error) {
    console.warn('Favicon loading failed:', error);
    applyFavicon(favicon, URLS.DEFAULT_FAVICON, false);
  } finally {
    pendingRequests.delete(cacheKey);
  }
}

/**
 * Load favicon with timeout and fallback handling
 * @param {string} url - Primary favicon URL to load
 * @param {Object} tab - Tab object for fallback options
 * @returns {Promise<Object>} Promise resolving to {url, success}
 */
function loadWithTimeoutAndFallback(url, tab) {
  return loadWithTimeout(url).catch(async () => {
    // If Google's service failed, try Chrome's native favicon as fallback
    const chromeFaviconUrl = getChromeNativeFaviconUrl(tab);
    if (chromeFaviconUrl && chromeFaviconUrl !== url) {
      // Only try Chrome's favicon if it's different from what we already tried
      return loadWithTimeout(chromeFaviconUrl).catch(() => {
        // If both failed, return the default favicon
        return { url: URLS.DEFAULT_FAVICON, success: false };
      });
    }
    return { url: URLS.DEFAULT_FAVICON, success: false };
  });
}

/**
 * Load favicon with timeout promise
 * @param {string} url - Favicon URL to load
 * @returns {Promise<Object>} Promise resolving to {url, success}
 */
function loadWithTimeout(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timeoutId = setTimeout(() => {
      img.onload = null;
      img.onerror = null;
      reject(new Error(`Favicon timeout: ${url}`));
    }, FAVICON_CONFIG.TIMEOUT);
    
    img.onload = () => {
      clearTimeout(timeoutId);
      // Check if this is Google's default globe icon (16x16 blank document icon)
      // Google returns a default icon when it doesn't have the favicon
      // We could detect this, but for now just accept any successful load
      resolve({ url, success: true });
    };
    
    img.onerror = () => {
      clearTimeout(timeoutId);
      reject(new Error(`Failed to load favicon: ${url}`));
    };
    
    img.src = url;
  });
}

/**
 * Apply favicon to element with smooth transition
 * @param {HTMLImageElement} favicon - Favicon element
 * @param {string} url - URL to set
 * @param {boolean} success - Whether the load was successful
 */
function applyFavicon(favicon, url, success) {
  favicon.src = url;
  favicon.style.opacity = success ? '1' : '0.5';
  
  // Add loading state classes for CSS styling
  if (success) {
    favicon.classList.remove('favicon-failed');
    favicon.classList.add('favicon-loaded');
  } else {
    favicon.classList.remove('favicon-loaded');
    favicon.classList.add('favicon-failed');
  }
}

/**
 * Get favicon URL with preference for tab's existing favicon
 * @param {Object} tab - Tab object
 * @returns {string} Favicon URL
 */
function getFaviconUrl(tab) {
  // Check for special URLs that shouldn't use favicon service
  if (tab.url) {
    if (tab.url.startsWith('chrome://') || 
        tab.url.startsWith('chrome-extension://') ||
        tab.url.startsWith('edge://') ||
        tab.url.startsWith('about:') ||
        tab.url.startsWith('file://')) {
      return URLS.DEFAULT_FAVICON;
    }
  }

  // First try Google's favicon service to avoid CORS issues
  if (tab.domain) {
    // Skip favicon loading for example.com or invalid domains
    if (tab.domain === 'example.com' || tab.domain === 'localhost' || !tab.domain.includes('.')) {
      return URLS.DEFAULT_FAVICON;
    }
    return URLS.FAVICON_API.replace('{domain}', tab.domain);
  }
  
  // Extract domain from URL if not provided
  try {
    const domain = new URL(tab.url).hostname;
    // Skip favicon loading for example.com or invalid domains
    if (domain === 'example.com' || domain === 'localhost' || !domain.includes('.') || !domain) {
      return URLS.DEFAULT_FAVICON;
    }
    return URLS.FAVICON_API.replace('{domain}', domain);
  } catch {
    return URLS.DEFAULT_FAVICON;
  }
}

/**
 * Get Chrome's native favicon URL if available
 * This is used as a fallback if Google's service fails
 */
function getChromeNativeFaviconUrl(tab) {
  if (tab.favIconUrl && isValidFaviconUrl(tab.favIconUrl)) {
    return tab.favIconUrl;
  }
  return null;
}


/**
 * Check if a favicon URL is valid and likely to work
 * @param {string} url - URL to validate
 * @returns {boolean} Whether the URL is valid
 */
function isValidFaviconUrl(url) {
  if (!url || typeof url !== 'string') return false;
  
  try {
    const urlObj = new URL(url);
    // Exclude chrome:// URLs and other internal schemes
    return urlObj.protocol === 'http:' || urlObj.protocol === 'https:' || urlObj.protocol === 'data:';
  } catch {
    return false;
  }
}

/**
 * Preload favicons for better performance
 * @param {Array} tabs - Array of tab objects to preload favicons for
 */
export function preloadFavicons(tabs) {
  const uniqueUrls = new Set();
  
  tabs.forEach(tab => {
    const url = getFaviconUrl(tab);
    if (url !== URLS.DEFAULT_FAVICON && !faviconCache.has(url)) {
      uniqueUrls.add(url);
    }
  });
  
  // Limit concurrent preload requests
  const maxConcurrent = 5;
  const urlArray = Array.from(uniqueUrls);
  
  for (let i = 0; i < Math.min(maxConcurrent, urlArray.length); i++) {
    const url = urlArray[i];
    if (!pendingRequests.has(url)) {
      const loadPromise = loadWithTimeout(url);
      pendingRequests.set(url, loadPromise);
      
      loadPromise
        .then(result => {
          faviconCache.set(url, {
            url: result.url,
            success: result.success,
            timestamp: Date.now()
          });
          
          // Schedule cache save for successful preloads
          if (result.success) {
            scheduleCacheSave();
          }
        })
        .catch(() => {
          // Ignore preload errors
        })
        .finally(() => {
          pendingRequests.delete(url);
        });
    }
  }
}

/**
 * Clear favicon cache (useful for testing or memory management)
 */
export function clearFaviconCache() {
  faviconCache.clear();
  // Don't clear pending requests as they're in flight
}

/**
 * Get cache statistics for debugging
 * @returns {Object} Cache statistics
 */
export function getFaviconCacheStats() {
  return {
    cacheSize: faviconCache.size,
    pendingRequests: pendingRequests.size,
    cacheEntries: Array.from(faviconCache.keys())
  };
}

/**
 * Update pending favicons in the UI after they've been preloaded
 * @param {Array} tabs - Array of tabs that were preloaded
 */
export function updatePendingFavicons(tabs) {
  tabs.forEach(tab => {
    const faviconUrl = getFaviconUrl(tab);
    const cacheKey = faviconUrl;
    
    // Check if we now have this favicon in cache
    if (faviconCache.has(cacheKey)) {
      const cachedData = faviconCache.get(cacheKey);
      
      // Find all favicon elements for this tab (there might be multiple if duplicates)
      const favicons = document.querySelectorAll(`.favicon-pending[data-tab-url="${tab.url}"]`);
      
      favicons.forEach(favicon => {
        favicon.src = cachedData.url;
        favicon.style.opacity = cachedData.success ? '1' : '0.5';
        favicon.classList.remove('favicon-pending');
        favicon.classList.add(cachedData.success ? 'favicon-loaded' : 'favicon-failed');
      });
    }
  });
}

/**
 * Preload favicons and update UI when complete
 * @param {Array} tabs - Array of tab objects to preload favicons for
 */
export async function preloadAndUpdateFavicons(tabs) {
  // First pass: load all favicons into cache
  await preloadFavicons(tabs);
  
  // Second pass: update UI with loaded favicons
  updatePendingFavicons(tabs);
}

/**
 * Load persisted favicon cache from browser.storage
 */
async function loadPersistedCache() {
  try {
    // Check if browser API is available (not in Worker context)
    if (typeof browser === 'undefined') {
      return;
    }
    const result = await browser.storage.local.get(FAVICON_STORAGE_KEY);
    if (result[FAVICON_STORAGE_KEY]) {
      const persistedCache = result[FAVICON_STORAGE_KEY];
      const now = Date.now();
      
      // Load valid entries into memory cache
      Object.entries(persistedCache).forEach(([key, data]) => {
        // Check if entry is still valid (24 hour expiry for persistent cache)
        if (data.timestamp && (now - data.timestamp < STORAGE_CACHE_DURATION)) {
          faviconCache.set(key, data);
        }
      });
    }
  } catch (error) {
    console.warn('Failed to load persisted favicon cache:', error);
  }
}

/**
 * Save favicon cache to browser.storage for persistence
 */
async function savePersistedCache() {
  try {
    // Convert Map to object for storage
    const cacheObject = {};
    const now = Date.now();
    
    faviconCache.forEach((data, key) => {
      // Only persist successful loads and recent entries
      if (data.success && (now - data.timestamp < FAVICON_CONFIG.CACHE_DURATION)) {
        cacheObject[key] = data;
      }
    });
    
    // Save to browser.storage
    await browser.storage.local.set({
      [FAVICON_STORAGE_KEY]: cacheObject
    });
  } catch (error) {
    console.warn('Failed to save favicon cache:', error);
  }
}

// Save cache periodically and when new favicons are loaded
let saveTimeout = null;
function scheduleCacheSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => savePersistedCache(), 1000); // Debounce saves
}