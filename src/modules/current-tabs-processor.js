/**
 * Current Tabs Processor
 * Handles fetching current tabs from browser and matching with database
 * Connects to background script for real-time tab event updates
 */

import { TAB_CATEGORIES } from '../utils/constants.js';
import { ChromeAPIService } from '../services/ChromeAPIService.js';
import { extractDomain } from '../utils/helpers.js';
import logger from '../utils/logger.js';

export class CurrentTabsProcessor {
  constructor(database) {
    this.database = database;
  }

  /**
   * Get all current tabs with category information from database
   * @returns {Promise<{categorizedTabs: Object, urlToDuplicateIds: Object}>}
   */
  async getCurrentTabsWithCategories() {
    try {
      // 1. Get all open tabs from browser
      const allTabs = await browser.tabs.query({});
      
      
      // 2. Get all saved URLs from database for matching
      const savedUrls = await this.database.getSavedUrls([1, 2, 3]); // All categories
      const urlToCategoryMap = new Map();
      
      // Build lookup map with URL as key
      savedUrls.forEach(urlInfo => {
        // Use URL only for matching (one entry per URL)
        urlToCategoryMap.set(urlInfo.url, {
          category: urlInfo.category,
          urlId: urlInfo.id,
          savedTitle: urlInfo.title, // Keep saved title for reference
          lastAccessed: urlInfo.lastAccessed // Keep lastAccessed for daily update check
        });
      });
      
      // 3. Initialize categorized tabs structure
      const categorizedTabs = {
        [TAB_CATEGORIES.UNCATEGORIZED]: [],
        [TAB_CATEGORIES.CAN_CLOSE]: [],
        [TAB_CATEGORIES.SAVE_LATER]: [],
        [TAB_CATEGORIES.IMPORTANT]: []
      };
      
      const urlToDuplicateIds = {};
      const urlToTabsMap = new Map(); // For duplicate detection
      const matchedUrls = new Set(); // Track URLs that match saved URLs
      
      // 4. Process each tab
      for (const tab of allTabs) {
        if (!tab.url) {
          continue;
        }
        
        // Exclude the extension's own tabs to prevent closing the extension itself
        const extensionId = ChromeAPIService.getExtensionId();
        const extensionPopupUrl = ChromeAPIService.getExtensionURL('popup.html');
        
        // Check if tab URL starts with extension popup URL (ignoring query parameters like ?popup=)
        if (extensionId && extensionPopupUrl && tab.url && tab.url.startsWith(extensionPopupUrl)) {
            continue;
        }
        
        // Exclude Safari favorites:// URLs
        if (tab.url.startsWith('favorites://')) {
            continue;
        }
        
        
        // Check if saved in database (by URL only)
        const savedInfo = urlToCategoryMap.get(tab.url);
        const category = savedInfo ? savedInfo.category : TAB_CATEGORIES.UNCATEGORIZED;
        
        // Get temporal data from currentTabs cache if available
        const currentTabData = this.database.cache.currentTabs.get(tab.url);
        
        // Create tab entry
        // Get the specific open time for this tab
        const tabOpenTime = currentTabData?.tabOpenTimes?.[tab.id] || 
                           currentTabData?.firstOpened || 
                           Date.now();
        
        const tabEntry = {
          id: tab.id,
          url: tab.url,
          title: tab.title || 'Loading...',
          favIconUrl: tab.favIconUrl || this.getDefaultFavicon(tab.url),
          windowId: tab.windowId,
          index: tab.index,
          pinned: tab.pinned,
          audible: tab.audible,
          mutedInfo: tab.mutedInfo,
          lastAccessed: tab.lastAccessed || Date.now(),
          domain: extractDomain(tab.url),
          // Include temporal data from background tracking
          firstOpened: currentTabData?.firstOpened || Date.now(),
          lastOpened: currentTabData?.lastOpened || Date.now(),
          // Individual tab open time
          tabOpenTime: tabOpenTime
        };
        
        // Mark as saved if found in database
        if (savedInfo) {
          tabEntry.alreadySaved = true;
          
          // Only update lastAccessed if the date has changed (daily granularity)
          const todayDate = new Date().toDateString();
          const existingDate = savedInfo.lastAccessed ? new Date(savedInfo.lastAccessed).toDateString() : null;
          
          if (!existingDate || existingDate !== todayDate) {
            // Track this URL for lastAccessed update
            matchedUrls.add(tab.url);
          }
        }
        
        // Track duplicates
        if (!urlToTabsMap.has(tab.url)) {
          urlToTabsMap.set(tab.url, []);
        }
        urlToTabsMap.get(tab.url).push(tab.id);
        
        // Check if this URL already exists in the category
        const existingIndex = categorizedTabs[category].findIndex(t => t.url === tab.url);
        
        if (existingIndex !== -1) {
          // URL already exists - add to duplicates
          const existingTab = categorizedTabs[category][existingIndex];
          if (!existingTab.duplicateIds) {
            existingTab.duplicateIds = [existingTab.id];
          }
          existingTab.duplicateIds.push(tab.id);
          existingTab.duplicateCount = existingTab.duplicateIds.length;
          
          // Also store all tab open times for time-based grouping
          if (!existingTab.allTabOpenTimes) {
            existingTab.allTabOpenTimes = {[existingTab.id]: existingTab.tabOpenTime};
          }
          existingTab.allTabOpenTimes[tab.id] = tabEntry.tabOpenTime;
        } else {
          // New URL in this category
          categorizedTabs[category].push(tabEntry);
        }
      }
      
      // 5. Build duplicate mapping
      urlToTabsMap.forEach((tabIds, url) => {
        if (tabIds.length > 1) {
          urlToDuplicateIds[url] = tabIds;
        }
      });
      
      // 6. Update lastAccessed for URLs that haven't been accessed today
      if (matchedUrls.size > 0) {
        logger.dataPipeline(`🔄 Updating lastAccessed for ${matchedUrls.size} URLs (daily update)`);
        // Update all matched URLs asynchronously
        const updatePromises = Array.from(matchedUrls).map(url => 
          this.database.updateLastAccessed(url).catch(err => {
            logger.error(`Failed to update lastAccessed for ${url}:`, err);
          })
        );
        // Don't wait for updates to complete - do it in background
        Promise.all(updatePromises);
      }
      
      // Removed categorization summary log
      
      return { categorizedTabs, urlToDuplicateIds };
      
    } catch (error) {
      logger.error('Error processing current tabs:', error);
      return { 
        categorizedTabs: {
          [TAB_CATEGORIES.UNCATEGORIZED]: [],
          [TAB_CATEGORIES.CAN_CLOSE]: [],
          [TAB_CATEGORIES.SAVE_LATER]: [],
          [TAB_CATEGORIES.IMPORTANT]: []
        }, 
        urlToDuplicateIds: {} 
      };
    }
  }
  
  /**
   * Get default favicon for a URL
   */
  getDefaultFavicon(url) {
    try {
      const domain = new URL(url).hostname;
      return `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
    } catch {
      return '';
    }
  }
  
  /**
   * Handle real-time tab updates by connecting to background script
   * Background script tracks all tab events even when popup is closed
   */
  setupTabEventListeners(onTabChange) {
    let port;
    
    try {
      // Check if we can connect to the background script
      // Safari may throw if the service worker is not ready
      if (!browser.runtime || !browser.runtime.connect) {
        return null;
      }
      
      // Connect to background script for tab events
      port = browser.runtime.connect({ name: 'popup-background' });
      
      // Immediately check for lastError to clear it (prevents Safari console errors)
      if (browser.runtime.lastError) {
        // Clear the error by reading it - this prevents console spam in Safari
        browser.runtime.lastError;
        return null;
      }
      
      // Handle messages from background
      port.onMessage.addListener((message) => {
        if (message.type === 'fullState') {
          // Initial state - sync with background's current tabs tracking
          this.syncWithBackgroundState(message.data.currentTabs);
        } else if (onTabChange) {
          // Tab events
          const eventMap = {
            'tabCreated': 'created',
            'tabRemoved': 'removed',
            'tabUpdated': 'updated',
            'tabActivated': 'activated',
            'windowRemoved': 'windowRemoved'
          };
          
          const changeType = eventMap[message.type];
          if (changeType) {
            onTabChange({
              changeType: changeType,
              tab: message.data.tab || { id: message.data.tabId },
              changeInfo: message.data.changeInfo,
              timestamp: message.timestamp || Date.now()
            });
          }
        }
      });
      
      // Handle disconnect - critical for Safari error prevention
      port.onDisconnect.addListener(() => {
        // Always check lastError first to clear it and prevent console errors
        if (browser.runtime.lastError) {
          // Clear the error by reading it - this prevents Safari console spam
          browser.runtime.lastError;
          
          // Don't retry if this is a Safari service worker suspension
          return;
        }
        
        // Normal disconnect - attempt to reconnect after a delay
        setTimeout(() => {
          this.setupTabEventListeners(onTabChange);
        }, 2000);
      });
      
    } catch (error) {
      // Always check lastError after any runtime operation to prevent console errors
      if (browser.runtime.lastError) {
        // Clear the error by reading it
        browser.runtime.lastError;
      }
      
      return null;
    }
    
    return port;
  }
  
  /**
   * Sync with background's current tab state
   * @param {Array} currentTabs - Current tabs from background
   */
  async syncWithBackgroundState(currentTabs) {
    if (!currentTabs || !Array.isArray(currentTabs)) return;
    
    // Update saved URLs with temporal data from background tracking
    for (const bgTab of currentTabs) {
      const savedUrl = await this.database.cache.urls.get(bgTab.url);
      if (savedUrl) {
        // Update temporal fields if background has older data
        if (bgTab.firstOpened && (!savedUrl.firstOpened || 
            new Date(bgTab.firstOpened) < new Date(savedUrl.firstOpened))) {
          savedUrl.firstOpened = bgTab.firstOpened;
        }
        
        if (bgTab.lastOpened) {
          savedUrl.lastOpened = bgTab.lastOpened;
        }
        
        if (bgTab.lastAccessed) {
          savedUrl.lastAccessed = bgTab.lastAccessed;
        }
        
        // Update in database
        await this.database.updateLastAccessed(bgTab.url);
      }
    }
  }
}