/*
 * AI Tab Manager - Copyright (c) 2025 AI Tech Knowledge LLC
 * Chrome API wrapper service for centralized API access
 */

/**
 * ChromeAPIService - Wrapper for all Chrome Extension APIs
 * Provides Promise-based interface and error handling
 */
export class ChromeAPIService {
  
  // === Tab Management ===
  
  /**
   * Get all tabs matching query
   * @param {Object} queryInfo - Chrome tabs query object
   * @returns {Promise<Array>} Array of tabs
   */
  static async queryTabs(queryInfo = {}) {
    try {
      return await browser.tabs.query(queryInfo);
    } catch (error) {
      console.error('Failed to query tabs:', error);
      throw error;
    }
  }
  
  /**
   * Get current window tabs
   * @returns {Promise<Array>} Array of tabs in current window
   */
  static async getCurrentWindowTabs() {
    return this.queryTabs({ currentWindow: true });
  }
  
  /**
   * Get all tabs from all windows
   * @returns {Promise<Array>} Array of all tabs
   */
  static async getAllTabs() {
    return this.queryTabs({});
  }
  
  /**
   * Create a new tab
   * @param {Object} createProperties - Tab creation properties
   * @returns {Promise<Object>} Created tab object
   */
  static async createTab(createProperties) {
    try {
      return await browser.tabs.create(createProperties);
    } catch (error) {
      console.error('Failed to create tab:', error);
      throw error;
    }
  }
  
  /**
   * Remove tabs by IDs
   * @param {number|Array<number>} tabIds - Tab ID(s) to remove
   * @returns {Promise<void>}
   */
  static async removeTabs(tabIds) {
    try {
      return await browser.tabs.remove(tabIds);
    } catch (error) {
      console.error('Failed to remove tabs:', error);
      throw error;
    }
  }
  
  /**
   * Update a tab
   * @param {number} tabId - Tab ID to update
   * @param {Object} updateProperties - Properties to update
   * @returns {Promise<Object>} Updated tab object
   */
  static async updateTab(tabId, updateProperties) {
    try {
      return await browser.tabs.update(tabId, updateProperties);
    } catch (error) {
      console.error('Failed to update tab:', error);
      throw error;
    }
  }
  
  // === Storage Management ===
  
  /**
   * Get items from Chrome storage
   * @param {string|Array<string>|null} keys - Keys to retrieve (null for all)
   * @returns {Promise<Object>} Storage items
   */
  static async getStorageData(keys = null) {
    try {
      return await browser.storage.local.get(keys);
    } catch (error) {
      console.error('Failed to get storage data:', error);
      throw error;
    }
  }
  
  /**
   * Set items in Chrome storage
   * @param {Object} items - Items to store
   * @returns {Promise<void>}
   */
  static async setStorageData(items) {
    try {
      return await browser.storage.local.set(items);
    } catch (error) {
      console.error('Failed to set storage data:', error);
      throw error;
    }
  }
  
  /**
   * Remove items from Chrome storage
   * @param {string|Array<string>} keys - Keys to remove
   * @returns {Promise<void>}
   */
  static async removeStorageData(keys) {
    try {
      return await browser.storage.local.remove(keys);
    } catch (error) {
      console.error('Failed to remove storage data:', error);
      throw error;
    }
  }
  
  /**
   * Clear all Chrome storage
   * @returns {Promise<void>}
   */
  static async clearStorage() {
    return new Promise((resolve, reject) => {
      browser.storage.local.clear(() => {
        if (browser.runtime.lastError) {
          reject(new Error(browser.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }
  
  // === Runtime Messaging ===
  
  /**
   * Send message to background script
   * @param {Object} message - Message to send
   * @returns {Promise<any>} Response from background script
   */
  static async sendMessage(message) {
    try {
      const response = await browser.runtime.sendMessage(message);
      if (response && response.error) {
        throw new Error(response.error);
      }
      return response;
    } catch (error) {
      console.error('Failed to send message:', error);
      throw error;
    }
  }
  
  /**
   * Get extension URL
   * @param {string} path - Path within extension
   * @returns {string} Full URL
   */
  static getURL(path) {
    return browser.runtime.getURL(path);
  }
  
  // === Bookmarks Management ===
  
  /**
   * Create a bookmark
   * @param {Object} bookmark - Bookmark details
   * @returns {Promise<Object>} Created bookmark
   */
  static async createBookmark(bookmark) {
    try {
      return await browser.bookmarks.create(bookmark);
    } catch (error) {
      console.error('Failed to create bookmark:', error);
      throw error;
    }
  }
  
  // === Windows Management ===
  
  /**
   * Get current window
   * @returns {Promise<Object>} Current window object
   */
  static async getCurrentWindow() {
    try {
      return await browser.windows.getCurrent();
    } catch (error) {
      console.error('Failed to get current window:', error);
      throw error;
    }
  }
  
  /**
   * Update a window
   * @param {number} windowId - Window ID to update
   * @param {Object} updateInfo - Properties to update
   * @returns {Promise<Object>} Updated window object
   */
  static async updateWindow(windowId, updateInfo) {
    try {
      return await browser.windows.update(windowId, updateInfo);
    } catch (error) {
      console.error('Failed to update window:', error);
      throw error;
    }
  }
  
  // === Utility Methods ===
  
  /**
   * Check if running in extension context
   * @returns {boolean} True if browser.runtime is available
   */
  static isExtensionContext() {
    return typeof chrome !== 'undefined' && browser.runtime && browser.runtime.id;
  }
  
  /**
   * Get the current extension ID
   * @returns {string|null} Extension ID or null if not in extension context
   */
  static getExtensionId() {
    return browser.runtime && browser.runtime.id ? browser.runtime.id : null;
  }
  
  /**
   * Get full extension URL for a resource
   * @param {string} path - Resource path (e.g., 'popup.html')
   * @returns {string|null} Full extension URL or null if not in extension context
   */
  static getExtensionURL(path = '') {
    return browser.runtime && browser.runtime.getURL ? browser.runtime.getURL(path) : null;
  }
  
  /**
   * Get last error message
   * @returns {string|null} Error message or null
   */
  static getLastError() {
    return browser.runtime.lastError ? browser.runtime.lastError.message : null;
  }
  
  /**
   * Batch create tabs with rate limiting
   * @param {Array<string>} urls - URLs to open
   * @param {number} batchSize - Number of tabs per batch
   * @param {number} delayMs - Delay between batches
   * @returns {Promise<Array>} Created tabs
   */
  static async batchCreateTabs(urls, batchSize = 10, delayMs = 100) {
    const results = [];
    
    for (let i = 0; i < urls.length; i += batchSize) {
      const batch = urls.slice(i, i + batchSize);
      const batchPromises = batch.map(url => this.createTab({ url }));
      
      try {
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
      } catch (error) {
        console.error('Error creating batch of tabs:', error);
      }
      
      // Delay between batches
      if (i + batchSize < urls.length) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    
    return results;
  }
}

// Export as default as well for convenience
export default ChromeAPIService;