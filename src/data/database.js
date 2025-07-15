/*
 * AI Tab Manager - Copyright (c) 2025 AI Tech Knowledge LLC
 * Database - Normalized structure with URL and event tracking
 */

class TabDatabase {
  constructor() {
    this.dbName = 'AITabManagerDB';
    this.dbVersion = 4; // Version 4: Added currentTabs table
    this.db = null;
    
    // In-memory cache indexed by URL
    this.cache = {
      urls: new Map(),        // Map<url, urlRecord>
      urlsById: new Map(),    // Map<id, urlRecord> for quick ID lookups
      events: new Map(),      // Map<urlId, Array<event>>
      currentTabs: new Map(), // Map<url, currentTabRecord>
      initialized: false
    };
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => {
        console.error('Failed to open database:', request.error);
        reject(request.error);
      };

      request.onsuccess = async () => {
        this.db = request.result;
        try {
          await this.initializeCache();
          resolve();
        } catch (error) {
          console.error('Failed to initialize cache:', error);
          // Still resolve so the database is usable
          this.cache.initialized = false;
          resolve();
        }
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        console.log('Upgrading database schema from version', event.oldVersion, 'to', event.newVersion);

        // Delete old object stores if they exist
        const oldStores = ['tabs', 'savedTabs', 'collections', 'migrationStatus'];
        oldStores.forEach(storeName => {
          if (db.objectStoreNames.contains(storeName)) {
            console.log('Deleting old object store:', storeName);
            db.deleteObjectStore(storeName);
          }
        });

        // URLs table - stores unique URLs with their category
        if (!db.objectStoreNames.contains('urls')) {
          console.log('Creating urls object store');
          const urlStore = db.createObjectStore('urls', { keyPath: 'id', autoIncrement: true });
          // URL is unique - one entry per URL
          urlStore.createIndex('url', 'url', { unique: true });
          urlStore.createIndex('category', 'category', { unique: false });
          urlStore.createIndex('domain', 'domain', { unique: false });
          urlStore.createIndex('lastCategorized', 'lastCategorized', { unique: false });
          urlStore.createIndex('lastAccessed', 'lastAccessed', { unique: false });
        }

        // Events table - stores open/close events for each URL
        if (!db.objectStoreNames.contains('events')) {
          console.log('Creating events object store');
          const eventStore = db.createObjectStore('events', { keyPath: 'id', autoIncrement: true });
          eventStore.createIndex('urlId', 'urlId', { unique: false });
          eventStore.createIndex('openTime', 'openTime', { unique: false });
          eventStore.createIndex('closeTime', 'closeTime', { unique: false });
          // Composite index for finding sessions
          eventStore.createIndex('closeTime_urlId', ['closeTime', 'urlId'], { unique: false });
        }

        // Current tabs table - stores currently open tabs
        if (!db.objectStoreNames.contains('currentTabs')) {
          console.log('Creating currentTabs object store');
          const currentTabsStore = db.createObjectStore('currentTabs', { keyPath: 'id', autoIncrement: true });
          // URL is unique in currentTabs - one entry per unique URL
          currentTabsStore.createIndex('url', 'url', { unique: true });
          currentTabsStore.createIndex('domain', 'domain', { unique: false });
          currentTabsStore.createIndex('lastAccessed', 'lastAccessed', { unique: false });
        }

      };
    });
  }

  /**
   * Initialize in-memory cache with all database data
   */
  async initializeCache() {
    // const startTime = performance.now(); // Uncomment for performance debugging
    
    try {
      // Load all URLs
      const urlsTransaction = this.db.transaction(['urls'], 'readonly');
      const urlsStore = urlsTransaction.objectStore('urls');
      const urlsRequest = urlsStore.getAll();
      
      const urls = await new Promise((resolve, reject) => {
        urlsRequest.onsuccess = () => resolve(urlsRequest.result);
        urlsRequest.onerror = () => reject(urlsRequest.error);
      });
      
      // Load all events
      const eventsTransaction = this.db.transaction(['events'], 'readonly');
      const eventsStore = eventsTransaction.objectStore('events');
      const eventsRequest = eventsStore.getAll();
      
      const events = await new Promise((resolve, reject) => {
        eventsRequest.onsuccess = () => resolve(eventsRequest.result);
        eventsRequest.onerror = () => reject(eventsRequest.error);
      });
      
      // Load all current tabs (only if store exists - for backward compatibility)
      let currentTabs = [];
      if (this.db.objectStoreNames.contains('currentTabs')) {
        const currentTabsTransaction = this.db.transaction(['currentTabs'], 'readonly');
        const currentTabsStore = currentTabsTransaction.objectStore('currentTabs');
        const currentTabsRequest = currentTabsStore.getAll();
        
        currentTabs = await new Promise((resolve, reject) => {
          currentTabsRequest.onsuccess = () => resolve(currentTabsRequest.result);
          currentTabsRequest.onerror = () => reject(currentTabsRequest.error);
        });
      }
      
      // Populate URL caches
      urls.forEach(url => {
        this.cache.urls.set(url.url, url);
        this.cache.urlsById.set(url.id, url);
      });
      
      // Group events by URL ID
      events.forEach(event => {
        if (!this.cache.events.has(event.urlId)) {
          this.cache.events.set(event.urlId, []);
        }
        this.cache.events.get(event.urlId).push(event);
      });
      
      // Sort events by closeTime for each URL
      this.cache.events.forEach((eventList) => {
        eventList.sort((a, b) => {
          const aTime = new Date(a.closeTime || 0).getTime();
          const bTime = new Date(b.closeTime || 0).getTime();
          return bTime - aTime; // Most recent first
        });
      });
      
      // Populate current tabs cache
      currentTabs.forEach(tab => {
        this.cache.currentTabs.set(tab.url, tab);
      });
      
      this.cache.initialized = true;
      
      // const endTime = performance.now(); // Uncomment for performance debugging
    } catch (error) {
      console.error('Failed to initialize cache:', error);
      this.cache.initialized = false;
      throw error;
    }
  }


  /**
   * Helper method to update URL in database
   */
  async updateUrlInDB(urlData) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['urls'], 'readwrite');
      const store = transaction.objectStore('urls');
      const request = store.put(urlData);
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
  
  /**
   * Helper method to add URL to database
   */
  async addUrlToDB(urlData) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['urls'], 'readwrite');
      const store = transaction.objectStore('urls');
      const request = store.add(urlData);
      
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  
  /**
   * Get URL entry by URL
   * @param {string} url - URL to look up
   * @returns {Promise<Object|null>} URL data or null
   */
  async getUrlByUrl(url) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['urls'], 'readonly');
      const store = transaction.objectStore('urls');
      const index = store.index('url');
      
      const request = index.get(url);
      
      request.onsuccess = () => {
        resolve(request.result || null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get or create a URL entry
   * @param {Object} tabData - Tab data with url, title, domain
   * @param {number} category - Category (0=uncategorized, 1=can close, 2=save later, 3=important)
   * @returns {Promise<number>} URL ID
   */
  async getOrCreateUrl(tabData, category = 0) {
    if (!this.cache.initialized) {
      throw new Error('Database cache not initialized. This should never happen.');
    }
    
    const now = new Date().toISOString();
    const existing = this.cache.urls.get(tabData.url);
    
    if (existing) {
      // Update the record with new data
      let needsUpdate = false;
      
      // Update title if different (keep the latest title)
      if (existing.title !== tabData.title) {
        existing.title = tabData.title;
        needsUpdate = true;
      }
      
      // Update category if different and new category is not 0
      if (existing.category !== category && category !== 0) {
        existing.category = category;
        existing.lastCategorized = now;
        needsUpdate = true;
      }
      
      // Update favicon if provided
      if (tabData.favIconUrl && existing.favicon !== tabData.favIconUrl) {
        existing.favicon = tabData.favIconUrl;
        needsUpdate = true;
      }
      
      // Always update lastAccessed to track most recent access
      existing.lastAccessed = now;
      needsUpdate = true;
      
      // Check if we have temporal data from currentTabs to update
      const currentTab = this.cache.currentTabs.get(tabData.url);
      if (currentTab) {
        // Update firstOpened if currentTab has older data
        if (currentTab.firstOpened && (!existing.firstOpened || 
            new Date(currentTab.firstOpened) < new Date(existing.firstOpened))) {
          existing.firstOpened = currentTab.firstOpened;
          needsUpdate = true;
        }
        
        // Update lastOpened
        if (currentTab.lastOpened) {
          existing.lastOpened = currentTab.lastOpened;
          needsUpdate = true;
        }
      }
      
      if (needsUpdate) {
        // Update cache
        this.cache.urls.set(tabData.url, existing);
        this.cache.urlsById.set(existing.id, existing);
        
        // Persist to database
        await this.updateUrlInDB(existing);
      }
      
      return existing.id;
    } else {
      // Check if we have temporal data from currentTabs
      const currentTab = this.cache.currentTabs.get(tabData.url);
      
      // Create new URL entry
      const urlData = {
        url: tabData.url,
        title: tabData.title,
        domain: tabData.domain || this.extractDomain(tabData.url),
        category: category,
        firstSeen: now,
        lastCategorized: category !== 0 ? now : null,
        lastAccessed: now,
        favicon: tabData.favIconUrl || null,
        savedDate: now,
        // Use temporal data from currentTabs if available
        firstOpened: currentTab?.firstOpened || now,
        lastOpened: currentTab?.lastOpened || now
      };
      
      try {
        // Add to database and get ID
        const id = await this.addUrlToDB(urlData);
        urlData.id = id;
        
        // Update cache
        this.cache.urls.set(urlData.url, urlData);
        this.cache.urlsById.set(id, urlData);
        
        return id;
      } catch (error) {
        // Handle constraint error - URL already exists
        if (error.name === 'ConstraintError') {
          // Try to find the existing entry in the database
          const existingInDb = await this.getUrlByUrl(tabData.url);
          if (existingInDb) {
            // Add to cache
            this.cache.urls.set(existingInDb.url, existingInDb);
            this.cache.urlsById.set(existingInDb.id, existingInDb);
            
            // Update with new data
            let needsUpdate = false;
            
            if (existingInDb.title !== tabData.title) {
              existingInDb.title = tabData.title;
              needsUpdate = true;
            }
            
            if (existingInDb.category !== category && category !== 0) {
              existingInDb.category = category;
              existingInDb.lastCategorized = now;
              needsUpdate = true;
            }
            
            if (tabData.favIconUrl && existingInDb.favicon !== tabData.favIconUrl) {
              existingInDb.favicon = tabData.favIconUrl;
              needsUpdate = true;
            }
            
            existingInDb.lastAccessed = now;
            needsUpdate = true;
            
            if (needsUpdate) {
              await this.updateUrlInDB(existingInDb);
            }
            
            return existingInDb.id;
          }
        }
        
        // If we couldn't handle the error, re-throw it
        throw error;
      }
    }
  }

  /**
   * Record a tab open event
   * @param {number} urlId - URL ID from urls table
   * @param {number} tabId - Chrome tab ID
   * @returns {Promise<number>} Event ID
   */
  async recordOpenEvent(urlId, tabId) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['events'], 'readwrite');
      const store = transaction.objectStore('events');

      const eventData = {
        urlId: urlId,
        tabId: tabId,
        openTime: new Date().toISOString(),
        closeTime: null
      };

      const request = store.add(eventData);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Record a tab close event
   * @param {number} urlId - URL ID from urls table
   * @param {string} closeTime - Optional close time (defaults to now)
   * @returns {Promise<void>}
   */
  async recordCloseEvent(urlId, closeTime = null) {
    if (!this.cache.initialized) {
      throw new Error('Database cache not initialized. This should never happen.');
    }
    
    // Create a new close event
    const eventData = {
      urlId: urlId,
      closeTime: closeTime || new Date().toISOString()
    };
    
    // Add to database
    const eventId = await new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['events'], 'readwrite');
      const store = transaction.objectStore('events');
      const request = store.add(eventData);
      
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    
    eventData.id = eventId;
    
    // Update cache
    if (!this.cache.events.has(eventData.urlId)) {
      this.cache.events.set(eventData.urlId, []);
    }
    
    // Add to the beginning to maintain sort order (most recent first)
    this.cache.events.get(eventData.urlId).unshift(eventData);
  }

  /**
   * Save categorized tabs (called after LLM categorization)
   * @param {Object} categorizedTabs - Object with categories as keys and tab arrays as values
   * @returns {Promise<void>}
   */
  async saveCategorizedTabs(categorizedTabs) {
    const closeTime = new Date().toISOString();
    let errorCount = 0;

    for (const [category, tabs] of Object.entries(categorizedTabs)) {
      // Skip uncategorized - check both string and number
      if (category === '0' || category === 0 || parseInt(category) === 0) continue;

      for (const tab of tabs) {
        try {
          // Get or create URL entry with the category
          const urlId = await this.getOrCreateUrl(tab, parseInt(category));

          // Record close event for this URL
          await this.recordCloseEvent(urlId, closeTime);
        } catch (error) {
          errorCount++;
          console.error(`Error saving tab (${error.name}):`, {
            url: tab.url,
            title: tab.title,
            error: error.message
          });
          
          // Don't throw - continue processing other tabs
        }
      }
    }
    
    if (errorCount > 0) {
      console.warn(`saveCategorizedTabs completed with ${errorCount} errors`);
    }
  }

  /**
   * Get URL info by URL
   * @param {string} url - URL to look up
   * @returns {Promise<Object|null>} URL data or null
   */
  async getUrlInfo(url) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['urls'], 'readonly');
      const store = transaction.objectStore('urls');
      const index = store.index('url');

      // URL is now unique, so we can use get() instead of getAll()
      const request = index.get(url);
      request.onsuccess = () => {
        resolve(request.result || null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Update lastAccessed timestamp for a URL
   * @param {string} url - URL to update
   * @returns {Promise<boolean>} Success status
   */
  async updateLastAccessed(url) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['urls'], 'readwrite');
      const store = transaction.objectStore('urls');
      const index = store.index('url');
      
      // Find the URL record
      const request = index.get(url);
      request.onsuccess = () => {
        const record = request.result;
        if (!record) {
          resolve(false);
          return;
        }
        
        // Update only lastAccessed
        const now = new Date().toISOString();
        record.lastAccessed = now;
        
        const updateRequest = store.put(record);
        updateRequest.onsuccess = () => {
          // Update cache if initialized
          if (this.cache.initialized) {
            const cachedRecord = this.cache.urlsById.get(record.id);
            if (cachedRecord) {
              // Update the cached record
              cachedRecord.lastAccessed = record.lastAccessed;
              // Re-set in both maps to ensure consistency
              this.cache.urls.set(cachedRecord.url, cachedRecord);
              this.cache.urlsById.set(cachedRecord.id, cachedRecord);
            }
          }
          resolve(true);
        };
        updateRequest.onerror = () => reject(updateRequest.error);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Update URL category
   * @param {string} url - URL to update
   * @param {number} newCategory - New category
   * @returns {Promise<boolean>} Success status
   */
  async updateUrlCategory(url, newCategory) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['urls'], 'readwrite');
      const store = transaction.objectStore('urls');
      const index = store.index('url');
      
      // Find the URL record - now unique
      const request = index.get(url);
      request.onsuccess = () => {
        const record = request.result;
        if (!record) {
          resolve(false);
          return;
        }
        
        // Update the record
        const now = new Date().toISOString();
        record.category = newCategory;
        record.lastCategorized = now;
        record.lastAccessed = now;
        
        const updateRequest = store.put(record);
        updateRequest.onsuccess = () => {
          // Update cache if initialized
          if (this.cache.initialized) {
            const cachedRecord = this.cache.urlsById.get(record.id);
            if (cachedRecord) {
              // Update the cached record
              cachedRecord.category = newCategory;
              cachedRecord.lastCategorized = record.lastCategorized;
              cachedRecord.lastAccessed = record.lastAccessed;
              // Re-set in both maps to ensure consistency
              this.cache.urls.set(cachedRecord.url, cachedRecord);
              this.cache.urlsById.set(cachedRecord.id, cachedRecord);
            }
          }
          resolve(true);
        };
        updateRequest.onerror = () => reject(updateRequest.error);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all saved URLs by category
   * @param {number[]} categories - Array of categories to retrieve (default: [2,3] for save later & important)
   * @returns {Promise<Object[]>} Array of URL objects
   */
  async getSavedUrls(categories = [2, 3], includeEvents = false) {
    if (!this.cache.initialized) {
      throw new Error('Database cache not initialized. This should never happen.');
    }
    
    const results = [];
    
    for (const url of this.cache.urls.values()) {
      if (categories.includes(url.category)) {
        const urlData = { ...url };
        
        // Add events data if requested
        if (includeEvents && this.cache.events.has(url.id)) {
          const events = this.cache.events.get(url.id);
          const closeEvents = events.filter(e => e.closeTime);
          
          if (closeEvents.length > 0) {
            urlData.lastCloseTime = closeEvents[0].closeTime;
            urlData.closeEvents = closeEvents;
          }
        }
        
        results.push(urlData);
      }
    }
    
    return results;
  }

  /**
   * Get all URLs (for showing all saved tabs including "can close")
   * @returns {Promise<Object[]>} Array of all URL objects
   */
  async getAllUrls() {
    if (!this.cache.initialized) {
      throw new Error('Database cache not initialized. This should never happen.');
    }
    
    return Array.from(this.cache.urls.values());
  }

  /**
   * Get all saved tabs (alias for getSavedUrls with events)
   * @param {Object} options - Query options
   * @returns {Promise<Object[]>} Array of saved tab objects
   */
  async getAllSavedTabs(options = {}) {
    if (!this.cache.initialized) {
      throw new Error('Database cache not initialized. This should never happen.');
    }
    
    const categories = options.categories || [1, 2, 3]; // All categories by default
    const results = [];
    
    // Get URLs from cache
    for (const url of this.cache.urls.values()) {
      if (categories.includes(url.category)) {
        const urlData = { ...url };
        
        // Add events data if this URL has events
        if (this.cache.events.has(url.id)) {
          const events = this.cache.events.get(url.id);
          const closeEvents = events.filter(e => e.closeTime);
          
          if (closeEvents.length > 0) {
            urlData.lastCloseTime = closeEvents[0].closeTime; // Already sorted, most recent first
            urlData.closeEvents = closeEvents;
          }
        }
        
        results.push(urlData);
      }
    }
    
    return results;
  }

  /**
   * Get tabs closed at a specific time (for session restoration)
   * @param {string} closeTime - ISO timestamp
   * @returns {Promise<Object[]>} Array of URL objects
   */
  async getTabsClosedAt(closeTime) {
    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db.transaction(['events', 'urls'], 'readonly');
        const eventStore = transaction.objectStore('events');
        const urlStore = transaction.objectStore('urls');
        const index = eventStore.index('closeTime');

        const results = [];
        const urlIds = new Set();

        const request = index.openCursor(IDBKeyRange.only(closeTime));
        request.onsuccess = async (event) => {
          const cursor = event.target.result;
          if (cursor) {
            const urlId = cursor.value.urlId;
            if (!urlIds.has(urlId)) {
              urlIds.add(urlId);
              const urlRequest = urlStore.get(urlId);
              urlRequest.onsuccess = () => {
                if (urlRequest.result) {
                  results.push(urlRequest.result);
                }
              };
            }
            cursor.continue();
          } else {
            // Wait for all URL fetches to complete
            transaction.oncomplete = () => resolve(results);
          }
        };

        request.onerror = () => reject(request.error);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Get recent close sessions (grouped by close time)
   * @param {number} limit - Number of sessions to retrieve
   * @returns {Promise<Object[]>} Array of session objects
   */
  async getRecentSessions(limit = 10) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['events', 'urls'], 'readonly');
      const eventStore = transaction.objectStore('events');
      const closeTimeIndex = eventStore.index('closeTime');

      const sessions = new Map();
      const request = closeTimeIndex.openCursor(null, 'prev');

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor && sessions.size < limit) {
          const event = cursor.value;
          if (event.closeTime) {
            if (!sessions.has(event.closeTime)) {
              sessions.set(event.closeTime, {
                closeTime: event.closeTime,
                urlIds: new Set(),
                count: 0
              });
            }
            sessions.get(event.closeTime).urlIds.add(event.urlId);
            sessions.get(event.closeTime).count++;
          }
          cursor.continue();
        } else {
          resolve(Array.from(sessions.values()));
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Delete a URL and all its events
   * @param {number} urlId - URL ID to delete
   * @returns {Promise<void>}
   */
  async deleteUrl(urlId) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['urls', 'events'], 'readwrite');
      const urlStore = transaction.objectStore('urls');
      const eventStore = transaction.objectStore('events');
      const eventIndex = eventStore.index('urlId');

      // Delete URL
      urlStore.delete(urlId);

      // Delete all events for this URL
      const request = eventIndex.openCursor(IDBKeyRange.only(urlId));
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      transaction.oncomplete = () => {
        // Update cache if initialized - follows the pattern from getOrCreateUrl
        if (this.cache.initialized) {
          const urlRecord = this.cache.urlsById.get(urlId);
          if (urlRecord) {
            // Remove from both maps
            this.cache.urls.delete(urlRecord.url);
            this.cache.urlsById.delete(urlId);
            // Remove events from cache
            this.cache.events.delete(urlId);
          }
        }
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Update URL category by ID (deprecated - use updateUrlCategory with URL string)
   * @param {number} urlId - URL ID
   * @param {number} newCategory - New category
   * @returns {Promise<void>}
   */
  async updateUrlCategoryById(urlId, newCategory) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['urls'], 'readwrite');
      const store = transaction.objectStore('urls');

      const request = store.get(urlId);
      request.onsuccess = () => {
        const url = request.result;
        if (url) {
          url.category = newCategory;
          url.lastCategorized = new Date().toISOString();
          const updateRequest = store.put(url);
          updateRequest.onsuccess = () => {
            // Update cache if initialized - follows the pattern from getOrCreateUrl
            if (this.cache.initialized) {
              const cachedRecord = this.cache.urlsById.get(urlId);
              if (cachedRecord) {
                // Update the cached record
                cachedRecord.category = newCategory;
                cachedRecord.lastCategorized = url.lastCategorized;
                // Re-set in both maps to ensure consistency
                this.cache.urls.set(cachedRecord.url, cachedRecord);
                this.cache.urlsById.set(cachedRecord.id, cachedRecord);
              }
            }
            resolve();
          };
          updateRequest.onerror = () => reject(updateRequest.error);
        } else {
          reject(new Error('URL not found'));
        }
      };

      request.onerror = () => reject(request.error);
    });
  }



  // Utility functions
  extractDomain(url) {
    try {
      // Handle special URL schemes before using URL constructor
      if (url.startsWith('about:')) return 'about';
      if (url.startsWith('chrome://')) return 'chrome';
      if (url.startsWith('chrome-extension://')) return 'extension';
      if (url.startsWith('file://')) return 'local-file';
      if (url.startsWith('moz-extension://')) return 'extension';
      if (url.startsWith('data:')) return 'data';
      
      const urlObj = new URL(url);
      let hostname = urlObj.hostname.replace(/^www\./, '');
      
      // Extract root domain (primary domain)
      // Handle special TLDs
      const specialTLDs = ['co.uk', 'com.au', 'co.jp', 'co.in', 'com.br'];
      for (const tld of specialTLDs) {
        if (hostname.endsWith('.' + tld)) {
          const parts = hostname.split('.');
          // For special TLDs, we want to keep the last 3 parts (domain.co.uk)
          if (parts.length >= 3) {
            return parts.slice(-3).join('.');
          }
          return hostname;
        }
      }
      
      // Default: last two parts
      const parts = hostname.split('.');
      if (parts.length > 2) {
        return parts.slice(-2).join('.');
      }
      return hostname;
    } catch {
      return 'unknown';
    }
  }

  async exportData() {
    const urls = await this.getAllUrls();
    const events = await new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['events'], 'readonly');
      const store = transaction.objectStore('events');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return { urls, events, exportDate: new Date().toISOString() };
  }

  /**
   * Export tabs as CSV
   * @param {Array} urls - Array of URL objects to export (if not provided, exports all saved tabs)
   * @param {boolean} includeMLData - Whether to include ML prediction and training data
   * @returns {Promise<string>} CSV content
   */
  async exportAsCSV(urls = null, includeMLData = false) {
    // If no URLs provided, get all saved URLs
    if (!urls) {
      urls = await this.getSavedUrls([1, 2, 3], true);
    }
    
    // Escape fields that might contain commas or quotes
    const escapeCSV = (field) => {
      if (field === null || field === undefined) return '';
      const str = String(field);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };
    
    // Convert timestamp to UTC ISO string
    const timestampToUTC = (timestamp) => {
      if (!timestamp) return '';
      // Handle both epoch milliseconds and ISO strings
      const date = typeof timestamp === 'number' ? new Date(timestamp) : new Date(timestamp);
      return isNaN(date.getTime()) ? '' : date.toISOString();
    };
    
    // Build headers based on includeMLData flag
    const headers = [
      'url',
      'title', 
      'domain',
      'category',
      'firstSeen',
      'lastCategorized',
      'lastAccessed',
      'favicon',
      'savedDate',
      'firstOpened',
      'lastOpened',
      'lastCloseTime'
    ];
    
    if (includeMLData) {
      // Add ML prediction fields
      headers.push(
        'mlPredictionTimestamp',
        'rulesPredict',
        'rulesConfidence',
        'rulesWeight',
        'modelPredict',
        'modelConfidence',
        'modelWeight',
        'llmPredict',
        'llmConfidence',
        'llmWeight',
        'finalPredict',
        'predictionConfidence',
        'predictionAgreement',
        'corrected',
        // Training data fields
        'trainTimestamp',
        'trainSource',
        'trainConfidence'
      );
    }
    
    const rows = [headers];
    
    // If including ML data, we need to fetch it
    let mlDatabase = null;
    let getPredictionsByURL = null;
    let getTrainingDataByURL = null;
    
    if (includeMLData) {
      try {
        // Dynamically import ML database functions
        const mlDb = await import('./src/ml/storage/ml-database.js');
        getPredictionsByURL = mlDb.getPredictionsByURL;
        
        // We need to create a helper function to get training data by URL
        getTrainingDataByURL = async (url) => {
          const allTrainingData = await mlDb.getTrainingData(10000);
          return allTrainingData.find(td => td.url === url) || null;
        };
      } catch (error) {
        console.warn('ML database not available, exporting without ML data:', error);
        includeMLData = false;
      }
    }
    
    // Process each URL
    for (const url of urls) {
      const row = [
        escapeCSV(url.url),
        escapeCSV(url.title),
        escapeCSV(url.domain),
        escapeCSV(url.category), // Export as number (1,2,3) not name
        escapeCSV(timestampToUTC(url.firstSeen)),
        escapeCSV(timestampToUTC(url.lastCategorized)),
        escapeCSV(timestampToUTC(url.lastAccessed)),
        escapeCSV(url.favicon),
        escapeCSV(timestampToUTC(url.savedDate)),
        escapeCSV(timestampToUTC(url.firstOpened)),
        escapeCSV(timestampToUTC(url.lastOpened)),
        escapeCSV(timestampToUTC(url.lastCloseTime))
      ];
      
      if (includeMLData) {
        // Fetch ML data for this URL
        let predictionData = null;
        let trainingData = null;
        
        try {
          // Get most recent prediction
          const predictions = await getPredictionsByURL(url.url, 1);
          predictionData = predictions && predictions.length > 0 ? predictions[0] : null;
          
          // Get training data
          trainingData = await getTrainingDataByURL(url.url);
        } catch (error) {
          console.warn(`Failed to get ML data for ${url.url}:`, error);
        }
        
        // Add prediction data
        if (predictionData) {
          row.push(
            escapeCSV(timestampToUTC(predictionData.timestamp)),
            escapeCSV(predictionData.predictions?.rules),
            escapeCSV(predictionData.confidences?.rules),
            escapeCSV(predictionData.weights?.rules),
            escapeCSV(predictionData.predictions?.model),
            escapeCSV(predictionData.confidences?.model),
            escapeCSV(predictionData.weights?.model),
            escapeCSV(predictionData.predictions?.llm),
            escapeCSV(predictionData.confidences?.llm),
            escapeCSV(predictionData.weights?.llm),
            escapeCSV(predictionData.final),
            escapeCSV(predictionData.confidence),
            escapeCSV(predictionData.agreement),
            escapeCSV(predictionData.corrected)
          );
        } else {
          // Add empty values for prediction fields
          row.push(...Array(14).fill(''));
        }
        
        // Add training data
        if (trainingData) {
          row.push(
            escapeCSV(timestampToUTC(trainingData.timestamp)),
            escapeCSV(trainingData.source),
            escapeCSV(trainingData.trainingConfidence)
          );
        } else {
          // Add empty values for training fields
          row.push(...Array(3).fill(''));
        }
      }
      
      rows.push(row);
    }
    
    return rows.map(row => row.join(',')).join('\n');
  }

  /**
   * Get URL by ID
   * @param {number} id - URL ID
   * @returns {Promise<Object|null>} URL object or null
   */
  async getUrlById(id) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['urls'], 'readonly');
      const store = transaction.objectStore('urls');
      const request = store.get(id);
      
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Import tabs from CSV
   * @param {string} csvContent - CSV content to import
   * @param {Object} settings - Import settings
   * @returns {Promise<Object>} Import results
   */
  async importFromCSV(csvContent, settings = {}) {
    if (!csvContent || typeof csvContent !== 'string') {
      throw new Error('Invalid CSV content');
    }
    
    const lines = csvContent.split('\n').filter(line => line.trim());
    if (lines.length < 2) {
      throw new Error('CSV file must contain headers and at least one data row');
    }
    
    // Import parseCSVLine helper
    const { parseCSVLine } = await import('./src/utils/helpers.js');
    
    // Parse header to find column indices
    const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());
    const titleIdx = headers.findIndex(h => h === 'title' || h.includes('title'));
    const urlIdx = headers.findIndex(h => h === 'url' || (h.includes('url') && !h.includes('curl')));
    const domainIdx = headers.findIndex(h => h === 'domain' || h.includes('domain'));
    const categoryIdx = headers.findIndex(h => h === 'category' || h.includes('category'));
    // const savedDateIdx = headers.findIndex(h => h.includes('saved') && h.includes('date')); // Unused - for future use
    // const savedTimeIdx = headers.findIndex(h => h.includes('saved') && h.includes('time')); // Unused - for future use
    const closedDateIdx = headers.findIndex(h => h.includes('closed') && h.includes('date'));
    const closedTimeIdx = headers.findIndex(h => h.includes('closed') && h.includes('time'));
    
    if (titleIdx === -1 || urlIdx === -1) {
      throw new Error('CSV must contain at least Title and URL columns');
    }
    
    // Get existing URLs to check for duplicates
    const existingUrls = await this.getAllUrls();
    const existingUrlSet = new Set(existingUrls.map(url => url.url));
    
    // Process data rows
    const imported = [];
    const duplicates = [];
    const needsCategorization = [];
    const errors = [];
    let categorizedByRules = 0;
    
    for (let i = 1; i < lines.length; i++) {
      const row = parseCSVLine(lines[i]);
      if (row.length < 2) continue; // Skip empty rows
      
      const url = row[urlIdx]?.trim();
      const title = row[titleIdx]?.trim() || 'Untitled';
      
      if (!url) continue; // Skip rows without URL
      
      // Check for duplicates
      if (existingUrlSet.has(url)) {
        duplicates.push({ title, url, line: i + 1 });
        continue;
      }
      
      // Parse domain
      let domain = 'unknown';
      if (domainIdx !== -1 && row[domainIdx]) {
        domain = row[domainIdx].trim();
      } else {
        // Extract domain from URL
        try {
          if (url.startsWith('http')) {
            domain = new URL(url).hostname;
          }
        } catch (e) {
          // Keep 'unknown' as domain
        }
      }
      
      // Parse category
      let category = 0; // Default to uncategorized
      if (categoryIdx !== -1 && row[categoryIdx]) {
        const categoryStr = row[categoryIdx].trim().toLowerCase();
        // Map category names to numbers
        const categoryMap = {
          'ignore': 1,
          'can close': 1,
          'can be closed': 1,
          'useful': 2,
          'save for later': 2,
          'save later': 2,
          'important': 3
        };
        category = categoryMap[categoryStr] || 0;
      }
      
      // Parse dates
      // Note: savedDate parsing logic preserved but not currently used
      // This may be needed for future features that track import timestamps
      /*
      let savedDate = new Date().toISOString();
      if (savedDateIdx !== -1 && row[savedDateIdx]) {
        try {
          const dateStr = row[savedDateIdx].trim();
          const timeStr = savedTimeIdx !== -1 ? row[savedTimeIdx]?.trim() || '' : '';
          const combinedDateTime = timeStr ? `${dateStr} ${timeStr}` : dateStr;
          const parsedDate = new Date(combinedDateTime);
          if (!isNaN(parsedDate.getTime())) {
            savedDate = parsedDate.toISOString();
          }
        } catch (e) {
          // Use current date if parsing fails
        }
      }
      */
      
      // Apply rules if category is not set
      // const originalCategory = category; // Unused variable
      if (category === 0 && settings.rules && settings.rules.length > 0) {
        const { applyRulesToTabs } = await import('./src/modules/categorization-service.js');
        const tabData = { url, title, domain };
        const { categorizedByRules: ruleResults } = applyRulesToTabs([tabData], settings.rules);
        
        // Check if any rule matched
        for (const [cat, tabs] of Object.entries(ruleResults)) {
          if (tabs.length > 0) {
            category = parseInt(cat);
            categorizedByRules++;
            break;
          }
        }
      }
      
      try {
        // Only import categorized tabs (1, 2, 3)
        if (category > 0) {
          const urlId = await this.getOrCreateUrl({
            url: url,
            title: title,
            domain: domain
          }, category);
          
          // Record a close event if we have close date
          if (closedDateIdx !== -1 && row[closedDateIdx]) {
            try {
              const dateStr = row[closedDateIdx].trim();
              const timeStr = closedTimeIdx !== -1 ? row[closedTimeIdx]?.trim() || '' : '';
              const combinedDateTime = timeStr ? `${dateStr} ${timeStr}` : dateStr;
              const parsedDate = new Date(combinedDateTime);
              if (!isNaN(parsedDate.getTime())) {
                await this.recordOpenEvent(urlId, -1); // Dummy tab ID for imports
                await this.recordCloseEvent(urlId, parsedDate.toISOString());
              }
            } catch (e) {
              // Ignore close date parsing errors
            }
          }
          
          imported.push({ title, url, category, line: i + 1 });
        } else {
          needsCategorization.push({ title, url, line: i + 1 });
        }
      } catch (error) {
        errors.push({ 
          title, 
          url, 
          error: error.message, 
          line: i + 1 
        });
      }
    }
    
    return {
      imported: imported.length,
      duplicates: duplicates.length,
      needsCategorization: needsCategorization.length,
      errors: errors.length,
      categorizedByRules: categorizedByRules,
      details: {
        imported,
        duplicates,
        needsCategorization,
        errors
      }
    };
  }

  /**
   * Clean up uncategorized (category 0) records from database
   * @returns {Promise<number>} Number of records deleted
   */
  async cleanupUncategorizedRecords() {
    
    // First, collect all uncategorized URLs for ML cleanup
    const urlsToDelete = [];
    const readTransaction = this.db.transaction(['urls'], 'readonly');
    const readUrlStore = readTransaction.objectStore('urls');
    
    await new Promise((resolve, reject) => {
      const request = readUrlStore.openCursor();
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          if (cursor.value.category === 0) {
            urlsToDelete.push({
              id: cursor.value.id,
              url: cursor.value.url
            });
          }
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });
    
    
    // Delete ML data for each URL
    for (const urlData of urlsToDelete) {
      try {
        await this.deleteUrlFromMLDatabase(urlData.url);
      } catch (error) {
        console.error(`Error deleting ML data for URL ${urlData.url}:`, error);
      }
    }
    
    // Now delete from main database
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['urls', 'events'], 'readwrite');
      const urlStore = transaction.objectStore('urls');
      const eventStore = transaction.objectStore('events');
      let deletedCount = 0;
      
      const request = urlStore.openCursor();
      request.onsuccess = async (event) => {
        const cursor = event.target.result;
        if (cursor) {
          if (cursor.value.category === 0) {
            const urlId = cursor.value.id;
            
            // Delete URL record
            cursor.delete();
            deletedCount++;
            
            // Update cache if initialized
            if (this.cache.initialized) {
              const urlRecord = this.cache.urlsById.get(urlId);
              if (urlRecord) {
                this.cache.urls.delete(urlRecord.url);
                this.cache.urlsById.delete(urlId);
                this.cache.events.delete(urlId);
              }
            }
            
            // Delete associated events
            const eventIndex = eventStore.index('urlId');
            const eventRequest = eventIndex.openCursor(IDBKeyRange.only(urlId));
            eventRequest.onsuccess = (eventEvent) => {
              const eventCursor = eventEvent.target.result;
              if (eventCursor) {
                eventCursor.delete();
                eventCursor.continue();
              }
            };
          }
          cursor.continue();
        } else {
          resolve(deletedCount);
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Clean up URLs that haven't been accessed in the retention period
   * Only deletes tabs in the "Ignore" category (category 1)
   * "Useful" and "Important" tabs are kept indefinitely
   * Also deletes all related data (events, predictions, training data, etc.)
   * @returns {Promise<Object>} Cleanup results
   */
  async cleanupOldUrls() {
    
    // Import config if not available
    if (typeof CONFIG === 'undefined') {
      await import('./config.js');
    }
    
    const retentionSeconds = CONFIG.DATABASE?.URL_RETENTION_SECONDS || (365 * 24 * 60 * 60);
    const cutoffTime = Date.now() - (retentionSeconds * 1000);
    const cutoffISO = new Date(cutoffTime).toISOString();
    
    
    const results = {
      urlsDeleted: 0,
      eventsDeleted: 0,
      predictionsDeleted: 0,
      trainingDataDeleted: 0,
      metricsDeleted: 0,
      errors: []
    };
    
    try {
      // Collect URLs to delete
      const urlsToDelete = [];
      const transaction = this.db.transaction(['urls'], 'readonly');
      const urlStore = transaction.objectStore('urls');
      
      await new Promise((resolve, reject) => {
        const request = urlStore.openCursor();
        request.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            const url = cursor.value;
            // Only delete tabs in "Ignore" category (1) that are older than retention period
            // Categories: 1=Ignore, 2=Useful, 3=Important
            if (url.lastAccessed < cutoffISO && url.category === 1) {
              urlsToDelete.push({
                id: url.id,
                url: url.url,
                lastAccessed: url.lastAccessed,
                category: url.category
              });
            }
            cursor.continue();
          } else {
            resolve();
          }
        };
        request.onerror = () => reject(request.error);
      });
      
      
      // Delete each URL and its related data
      for (const urlData of urlsToDelete) {
        try {
          // Delete from ML database first
          const mlDeleteCounts = await this.deleteUrlFromMLDatabase(urlData.url);
          results.predictionsDeleted += mlDeleteCounts.predictions;
          results.trainingDataDeleted += mlDeleteCounts.trainingData;
          
          // Delete from main database
          await this.deleteUrl(urlData.id);
          results.urlsDeleted++;
          results.eventsDeleted++; // deleteUrl also deletes events
          
        } catch (error) {
          console.error(`Error deleting URL ${urlData.url}:`, error);
          results.errors.push({
            url: urlData.url,
            error: error.message
          });
        }
      }
      
      return results;
      
    } catch (error) {
      console.error('❌ Cleanup failed:', error);
      throw error;
    }
  }
  
  /**
   * Delete URL data from ML database
   * @private
   */
  async deleteUrlFromMLDatabase(url) {
    try {
      // First, try to use the performance tracker if available
      if (window.mlPerformanceTracker && typeof window.mlPerformanceTracker.handleUrlDeletion === 'function') {
        await window.mlPerformanceTracker.handleUrlDeletion(url);
        
        // Still need to delete training data separately
        // Import DB constants to get correct version
        const { DB_NAME, DB_VERSION } = await import('./src/ml/storage/ml-database.js');
        const mlDb = await new Promise((resolve, reject) => {
          const request = indexedDB.open(DB_NAME, DB_VERSION);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        
        let trainingDeleted = 0;
        const trainingTx = mlDb.transaction(['trainingData'], 'readwrite');
        const trainingStore = trainingTx.objectStore('trainingData');
        const trainingIndex = trainingStore.index('url');
        
        await new Promise((resolve) => {
          const request = trainingIndex.openCursor(IDBKeyRange.only(url));
          request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
              cursor.delete();
              trainingDeleted++;
              cursor.continue();
            } else {
              resolve();
            }
          };
        });
        
        mlDb.close();
        
        // Return approximate counts (we don't know exact prediction count from tracker)
        return { predictions: 1, trainingData: trainingDeleted };
      }
      
      // Fallback: Manual deletion with metrics adjustment
      // Import DB constants if not already imported
      const { DB_NAME, DB_VERSION } = await import('./src/ml/storage/ml-database.js');
      const mlDb = await new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      
      let deletedCounts = {
        predictions: 0,
        trainingData: 0
      };
      
      // First get predictions to calculate metrics adjustment
      const predReadTx = mlDb.transaction(['predictions'], 'readonly');
      const predReadStore = predReadTx.objectStore('predictions');
      const predReadIndex = predReadStore.index('url');
      
      const predictionsToDelete = [];
      await new Promise((resolve) => {
        const request = predReadIndex.openCursor(IDBKeyRange.only(url));
        request.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            predictionsToDelete.push(cursor.value);
            cursor.continue();
          } else {
            resolve();
          }
        };
      });
      
      // Calculate metrics adjustment
      const metricsAdjustment = {
        rules: { total: 0, correct: 0 },
        model: { total: 0, correct: 0 },
        llm: { total: 0, correct: 0 }
      };
      
      for (const prediction of predictionsToDelete) {
        if (prediction.predictions && prediction.final !== null && prediction.final !== undefined) {
          for (const method of ['rules', 'model', 'llm']) {
            const methodPrediction = prediction.predictions[method];
            if (methodPrediction !== null && methodPrediction !== undefined) {
              metricsAdjustment[method].total++;
              if (methodPrediction === prediction.final) {
                metricsAdjustment[method].correct++;
              }
            }
          }
        }
      }
      
      // Delete predictions
      const predTx = mlDb.transaction(['predictions'], 'readwrite');
      const predStore = predTx.objectStore('predictions');
      const predIndex = predStore.index('url');
      
      await new Promise((resolve, reject) => {
        const request = predIndex.openCursor(IDBKeyRange.only(url));
        request.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            cursor.delete();
            deletedCounts.predictions++;
            cursor.continue();
          } else {
            resolve();
          }
        };
        request.onerror = () => reject(request.error);
      });
      
      // Delete training data
      const trainingTx = mlDb.transaction(['trainingData'], 'readwrite');
      const trainingStore = trainingTx.objectStore('trainingData');
      const trainingIndex = trainingStore.index('url');
      
      await new Promise((resolve) => {
        const request = trainingIndex.openCursor(IDBKeyRange.only(url));
        request.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            cursor.delete();
            deletedCounts.trainingData++;
            cursor.continue();
          } else {
            resolve();
          }
        };
      });
      
      // Update metrics summary if we deleted predictions
      if (deletedCounts.predictions > 0) {
        try {
          // Load current metrics summary
          const summaryTx = mlDb.transaction(['metricsSummary'], 'readwrite');
          const summaryStore = summaryTx.objectStore('metricsSummary');
          
          const currentSummary = await new Promise((resolve) => {
            const request = summaryStore.get('allTimeMetrics');
            request.onsuccess = () => resolve(request.result);
          });
          
          if (currentSummary && currentSummary.metrics) {
            // Adjust the metrics
            for (const method of ['rules', 'model', 'llm']) {
              if (currentSummary.metrics[method] && metricsAdjustment[method].total > 0) {
                currentSummary.metrics[method].total -= metricsAdjustment[method].total;
                currentSummary.metrics[method].correct -= metricsAdjustment[method].correct;
                
                // Ensure non-negative
                currentSummary.metrics[method].total = Math.max(0, currentSummary.metrics[method].total);
                currentSummary.metrics[method].correct = Math.max(0, currentSummary.metrics[method].correct);
              }
            }
            
            // Save updated summary
            currentSummary.timestamp = Date.now();
            await new Promise((resolve, reject) => {
              const request = summaryStore.put(currentSummary);
              request.onsuccess = () => resolve();
              request.onerror = () => reject(request.error);
            });
            
          }
        } catch (error) {
          console.warn('Could not update metrics summary:', error);
        }
      }
      
      mlDb.close();
      
      return deletedCounts;
      
    } catch (error) {
      // ML database might not exist or be initialized
      console.warn('Could not delete from ML database:', error.message);
      return { predictions: 0, trainingData: 0 };
    }
  }

  // eslint-disable-next-line no-unused-vars
  async importData(data) {
    // Implementation for importing data
    // This would clear existing data and import the new data
    // TODO: Implement when needed - data parameter will be used then
  }

  /**
   * Update the category of a saved tab by URL
   * @param {string} url - The URL of the tab to update
   * @param {number} newCategory - The new category (1, 2, or 3)
   * @returns {Promise<Object>} Updated tab record
   */
  async updateTabCategory(url, newCategory) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['urls'], 'readwrite');
      const store = transaction.objectStore('urls');
      const index = store.index('url');

      // Find the tab by URL
      const getRequest = index.get(url);
      
      getRequest.onsuccess = () => {
        const urlRecord = getRequest.result;
        
        if (!urlRecord) {
          reject(new Error(`Tab not found with URL: ${url}`));
          return;
        }
        
        // Update the record with new category
        const updatedRecord = {
          ...urlRecord,
          category: newCategory,
          lastCategorized: Date.now()
        };
        
        // Save the updated record
        const putRequest = store.put(updatedRecord);
        
        putRequest.onsuccess = () => {
          resolve(updatedRecord);
        };
        
        putRequest.onerror = () => {
          reject(new Error(`Failed to update tab category: ${putRequest.error}`));
        };
      };
      
      getRequest.onerror = () => {
        reject(new Error(`Failed to find tab: ${getRequest.error}`));
      };
    });
  }

  /**
   * Get or create a current tab record
   * @param {Object} tabData - Tab data including url, title, etc.
   * @returns {Promise<Object>} The current tab record
   */
  async getOrCreateCurrentTab(tabData) {
    if (!this.db.objectStoreNames.contains('currentTabs')) {
      return null; // Table doesn't exist yet (backward compatibility)
    }

    const now = new Date().toISOString();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['currentTabs'], 'readwrite');
      const store = transaction.objectStore('currentTabs');
      const index = store.index('url');
      
      const getRequest = index.get(tabData.url);
      
      getRequest.onsuccess = () => {
        const existing = getRequest.result;
        
        if (existing) {
          // Update existing record
          const updated = {
            ...existing,
            title: tabData.title || existing.title,
            favicon: tabData.favicon || existing.favicon,
            lastAccessed: now,
            // Don't update firstOpened
          };
          
          // Update tab arrays
          if (tabData.tabId) {
            // Initialize arrays if they don't exist
            if (!updated.tabIds) updated.tabIds = [];
            if (!updated.windowIds) updated.windowIds = [];
            
            // Add tab ID if not already present
            if (!updated.tabIds.includes(tabData.tabId)) {
              updated.tabIds.push(tabData.tabId);
              updated.openCount = updated.tabIds.length;
            }
            
            // Add window ID if not already present
            if (tabData.windowId && !updated.windowIds.includes(tabData.windowId)) {
              updated.windowIds.push(tabData.windowId);
            }
          }
          
          // Initialize tabOpenTimes if it doesn't exist (for backward compatibility)
          if (!updated.tabOpenTimes) {
            updated.tabOpenTimes = {};
          }
          
          // Add this tab's open time if not already tracked
          if (tabData.tabId && !updated.tabOpenTimes[tabData.tabId]) {
            updated.tabOpenTimes[tabData.tabId] = now;
            console.log('🔍 DEBUG_TEMPORAL: Adding tab open time for existing URL:', tabData.url, 'tabId:', tabData.tabId);
          }
          
          const putRequest = store.put(updated);
          putRequest.onsuccess = () => {
            // Update cache
            this.cache.currentTabs.set(tabData.url, updated);
            resolve(updated);
          };
          putRequest.onerror = () => reject(putRequest.error);
        } else {
          // Create new record
          const newRecord = {
            url: tabData.url,
            title: tabData.title || '',
            domain: this.extractDomain(tabData.url),
            favicon: tabData.favicon || '',
            firstOpened: now,
            lastOpened: now,
            lastAccessed: now,
            openCount: 1,
            tabIds: [tabData.tabId],
            windowIds: [tabData.windowId],
            // Track individual tab open times
            tabOpenTimes: {
              [tabData.tabId]: now
            }
          };
          
          console.log('🔍 DEBUG_TEMPORAL: Creating new currentTab record:', tabData.url, 'tabId:', tabData.tabId, 'openTime:', now);
          
          const addRequest = store.add(newRecord);
          addRequest.onsuccess = () => {
            newRecord.id = addRequest.result;
            // Update cache
            this.cache.currentTabs.set(tabData.url, newRecord);
            resolve(newRecord);
          };
          addRequest.onerror = () => reject(addRequest.error);
        }
      };
      
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Update current tab when a new tab with same URL is opened
   * @param {string} url - The URL
   * @param {number} tabId - The new tab ID
   * @param {number} windowId - The window ID
   * @returns {Promise<Object>} Updated record
   */
  async addTabToCurrentTab(url, tabId, windowId) {
    if (!this.db.objectStoreNames.contains('currentTabs')) {
      return null;
    }

    const now = new Date().toISOString();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['currentTabs'], 'readwrite');
      const store = transaction.objectStore('currentTabs');
      const index = store.index('url');
      
      const getRequest = index.get(url);
      
      getRequest.onsuccess = () => {
        const existing = getRequest.result;
        
        if (existing) {
          // Add tab ID if not already present
          if (!existing.tabIds.includes(tabId)) {
            existing.tabIds.push(tabId);
            existing.openCount = existing.tabIds.length;
          }
          
          // Add window ID if not already present
          if (!existing.windowIds.includes(windowId)) {
            existing.windowIds.push(windowId);
          }
          
          // Initialize tabOpenTimes if it doesn't exist
          if (!existing.tabOpenTimes) {
            existing.tabOpenTimes = {};
          }
          
          // Track this tab's open time
          existing.tabOpenTimes[tabId] = now;
          
          existing.lastOpened = now;
          existing.lastAccessed = now;
          
          const putRequest = store.put(existing);
          putRequest.onsuccess = () => {
            // Update cache
            this.cache.currentTabs.set(url, existing);
            resolve(existing);
          };
          putRequest.onerror = () => reject(putRequest.error);
        } else {
          // Tab doesn't exist, create it
          resolve(this.getOrCreateCurrentTab({ url, tabId, windowId }));
        }
      };
      
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Remove a tab from current tab tracking
   * @param {string} url - The URL
   * @param {number} tabId - The tab ID to remove
   * @returns {Promise<boolean>} True if record was deleted (no more tabs), false if updated
   */
  async removeTabFromCurrentTab(url, tabId) {
    if (!this.db.objectStoreNames.contains('currentTabs')) {
      return false;
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['currentTabs'], 'readwrite');
      const store = transaction.objectStore('currentTabs');
      const index = store.index('url');
      
      const getRequest = index.get(url);
      
      getRequest.onsuccess = () => {
        const existing = getRequest.result;
        
        if (existing) {
          // Remove tab ID
          existing.tabIds = existing.tabIds.filter(id => id !== tabId);
          existing.openCount = existing.tabIds.length;
          
          // Remove tab open time
          if (existing.tabOpenTimes) {
            delete existing.tabOpenTimes[tabId];
          }
          
          if (existing.openCount === 0) {
            // No more tabs, delete the record
            const deleteRequest = store.delete(existing.id);
            deleteRequest.onsuccess = () => {
              // Remove from cache
              this.cache.currentTabs.delete(url);
              resolve(true);
            };
            deleteRequest.onerror = () => reject(deleteRequest.error);
          } else {
            // Still have tabs open, update the record
            const putRequest = store.put(existing);
            putRequest.onsuccess = () => {
              // Update cache
              this.cache.currentTabs.set(url, existing);
              resolve(false);
            };
            putRequest.onerror = () => reject(putRequest.error);
          }
        } else {
          // Record doesn't exist
          resolve(false);
        }
      };
      
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Remove all tabs from a window
   * @param {number} windowId - The window ID
   * @returns {Promise<void>}
   */
  async removeWindowFromCurrentTabs(windowId) {
    if (!this.db.objectStoreNames.contains('currentTabs')) {
      return;
    }

    const transaction = this.db.transaction(['currentTabs'], 'readwrite');
    const store = transaction.objectStore('currentTabs');
    const request = store.getAll();
    
    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const records = request.result;
        const promises = [];
        
        records.forEach(record => {
          if (record.windowIds.includes(windowId)) {
            // Remove window ID
            record.windowIds = record.windowIds.filter(id => id !== windowId);
            
            // For simplicity, we'll keep the tabs even if window is gone
            // The popup sync will clean up any orphaned tab IDs
            
            if (record.windowIds.length > 0) {
              promises.push(store.put(record));
              // Update cache
              this.cache.currentTabs.set(record.url, record);
            }
          }
        });
        
        Promise.all(promises).then(() => resolve()).catch(reject);
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all current tabs
   * @returns {Promise<Array>} Array of current tab records
   */
  async getAllCurrentTabs() {
    if (!this.db.objectStoreNames.contains('currentTabs')) {
      return [];
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['currentTabs'], 'readonly');
      const store = transaction.objectStore('currentTabs');
      const request = store.getAll();
      
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Clear all current tabs (used for sync)
   * @returns {Promise<void>}
   */
  async clearCurrentTabs() {
    if (!this.db.objectStoreNames.contains('currentTabs')) {
      return;
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['currentTabs'], 'readwrite');
      const store = transaction.objectStore('currentTabs');
      const request = store.clear();
      
      request.onsuccess = () => {
        // Clear cache
        this.cache.currentTabs.clear();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Find current tab by tab ID
   * @param {number} tabId - The tab ID to find
   * @returns {Promise<Object|null>} Current tab record or null
   */
  async findCurrentTabByTabId(tabId) {
    if (!this.db.objectStoreNames.contains('currentTabs')) {
      return null;
    }

    // Check cache first
    for (const [url, record] of this.cache.currentTabs) {
      if (record.tabIds && record.tabIds.includes(tabId)) {
        return record;
      }
    }

    // If not in cache, query database
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['currentTabs'], 'readonly');
      const store = transaction.objectStore('currentTabs');
      const request = store.getAll();
      
      request.onsuccess = () => {
        const records = request.result;
        const found = records.find(record => 
          record.tabIds && record.tabIds.includes(tabId)
        );
        resolve(found || null);
      };
      request.onerror = () => reject(request.error);
    });
  }
}

// Create and initialize the database instance
const tabDatabase = new TabDatabase();

// Expose to global scope immediately so it's available when imported
globalThis.tabDatabase = tabDatabase;

// Only assign to window if it exists (not in service worker)
if (typeof window !== 'undefined') {
  window.tabDatabase = tabDatabase;
}

// Initialize the database asynchronously
tabDatabase.init().then(() => {
}).catch(error => {
  console.error('❌ Failed to initialize database:', error);
});
