/*
 * AI Tab Manager - Data Source Interface
 * Abstract interface for all data sources (current tabs, saved tabs, etc.)
 */

import { extractDomain } from '../utils/helpers.js';

/**
 * Abstract Data Source Interface
 * Defines the contract all data sources must implement
 */
export class DataSourceInterface {
  /**
   * Get raw data from the source
   * @returns {Promise<Array>} Raw data array
   */
  async getData() {
    throw new Error('getData() must be implemented by subclass');
  }

  /**
   * Get schema definition for this data source
   * @returns {Object} Schema with field definitions
   */
  getSchema() {
    throw new Error('getSchema() must be implemented by subclass');
  }

  /**
   * Get source identifier
   * @returns {string} Unique identifier for this data source
   */
  getSourceId() {
    throw new Error('getSourceId() must be implemented by subclass');
  }

  /**
   * Check if source is available/ready
   * @returns {Promise<boolean>} Whether source is ready
   */
  async isAvailable() {
    return true;
  }

  /**
   * Get metadata about the data source
   * @returns {Object} Metadata object
   */
  getMetadata() {
    return {
      sourceId: this.getSourceId(),
      schema: this.getSchema(),
      lastUpdated: new Date().toISOString()
    };
  }

  /**
   * Extract domain from URL
   * @param {string} url - URL to extract domain from
   * @returns {string} Domain name or 'unknown'
   */
  extractDomain(url) {
    // Use the imported extractDomain function from helpers to ensure consistent domain extraction
    // This will use getRootDomain to extract the primary domain
    return extractDomain(url);
  }

  /**
   * Get week number for a date
   * @param {Date} date - Date to get week number for
   * @returns {number} Week number
   */
  getWeekNumber(date) {
    const startOfYear = new Date(date.getFullYear(), 0, 1);
    const pastDaysOfYear = (date - startOfYear) / 86400000;
    return Math.ceil((pastDaysOfYear + startOfYear.getDay() + 1) / 7);
  }

  /**
   * Get month-year string for a date
   * @param {Date} date - Date to get month-year for
   * @returns {string} Month-year string (YYYY-MM)
   */
  getMonthYear(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  /**
   * Get year-quarter string for a date
   * @param {Date} date - Date to get year-quarter for
   * @returns {string} Year-quarter string (YYYY-QN)
   */
  getYearQuarter(date) {
    const quarter = Math.ceil((date.getMonth() + 1) / 3);
    return `${date.getFullYear()}-Q${quarter}`;
  }
}

/**
 * Current Tabs Data Source
 * Provides access to currently open browser tabs
 */
export class CurrentTabsDataSource extends DataSourceInterface {
  constructor(tabsProcessor) {
    super();
    this.tabsProcessor = tabsProcessor;
  }

  getSourceId() {
    return 'current_tabs';
  }

  getSchema() {
    return {
      id: { type: 'number', indexed: true },
      url: { type: 'string', indexed: true, searchable: true },
      title: { type: 'string', searchable: true },
      domain: { type: 'string', indexed: true, searchable: true, groupable: true },
      category: { type: 'number', indexed: true, groupable: true },
      favIconUrl: { type: 'string' },
      windowId: { type: 'number', indexed: true, groupable: true },
      index: { type: 'number', sortable: true },
      active: { type: 'boolean', indexed: true },
      pinned: { type: 'boolean', indexed: true, groupable: true },
      audible: { type: 'boolean', indexed: true },
      mutedInfo: { type: 'object' },
      lastAccessed: { type: 'number', sortable: true, indexed: true },
      duplicateIds: { type: 'array' },
      isUncategorized: { type: 'boolean', indexed: true }
    };
  }

  async isAvailable() {
    return this.tabsProcessor !== null;
  }

  async getData() {
    if (!this.tabsProcessor) {
      return [];
    }

    try {
      const { categorizedTabs, urlToDuplicateIds } = await this.tabsProcessor.getCurrentTabsWithCategories();
      
      // Flatten categorized tabs into single array with consistent schema
      const allTabs = [];
      
      for (const [category, tabs] of Object.entries(categorizedTabs)) {
        for (const tab of tabs) {
          // Normalize tab object to match schema
          const lastAccessedDate = new Date(tab.lastAccessed || Date.now());
          const isValidLastAccessed = !isNaN(lastAccessedDate.getTime());
          
          const normalizedTab = {
            ...tab,
            category: parseInt(category),
            domain: this.extractDomain(tab.url),
            duplicateIds: urlToDuplicateIds[tab.url] || [],
            isUncategorized: parseInt(category) === 0,
            lastAccessed: tab.lastAccessed || Date.now(),
            // Add time-based grouping fields for lastAccessed
            lastAccessedWeekNumber: isValidLastAccessed ? this.getWeekNumber(lastAccessedDate) : null,
            lastAccessedMonthYear: isValidLastAccessed ? this.getMonthYear(lastAccessedDate) : null,
            lastAccessedYearQuarter: isValidLastAccessed ? this.getYearQuarter(lastAccessedDate) : null
          };
          
          allTabs.push(normalizedTab);
        }
      }
      
      return allTabs;
    } catch (error) {
      console.error('Error getting current tabs data:', error);
      return [];
    }
  }
}

/**
 * Saved Tabs Data Source
 * Provides access to tabs saved in IndexedDB
 */
export class SavedTabsDataSource extends DataSourceInterface {
  constructor(database) {
    super();
    this.database = database;
  }

  getSourceId() {
    return 'saved_tabs';
  }

  getSchema() {
    return {
      id: { type: 'number', indexed: true },
      url: { type: 'string', indexed: true, searchable: true },
      title: { type: 'string', searchable: true },
      domain: { type: 'string', indexed: true, searchable: true, groupable: true },
      category: { type: 'number', indexed: true, groupable: true },
      favIconUrl: { type: 'string' },
      savedDate: { type: 'number', sortable: true, indexed: true, groupable: true },
      lastSeen: { type: 'number', sortable: true, indexed: true },
      lastAccessedDay: { type: 'string', indexed: true, groupable: true },
      weekNumber: { type: 'number', groupable: true },
      monthYear: { type: 'string', groupable: true },
      yearQuarter: { type: 'string', groupable: true },
      lastCloseTime: { type: 'string', sortable: true, indexed: true },
      lastAccessed: { type: 'number', sortable: true, indexed: true },
      lastAccessedWeekNumber: { type: 'number', groupable: true },
      lastAccessedMonthYear: { type: 'string', groupable: true },
      lastAccessedYearQuarter: { type: 'string', groupable: true },
      isCurrentlyOpen: { type: 'boolean', indexed: true }
    };
  }

  async isAvailable() {
    return this.database !== null && typeof this.database.getAllSavedTabs === 'function';
  }

  async getData() {
    if (!this.database) {
      return [];
    }

    try {
      const savedTabs = await this.database.getAllSavedTabs();
      
      // Try to load ML metadata for saved tabs
      let mlDataAvailable = false;
      let getPredictionsByURL;
      try {
        const mlModule = await import('../ml/storage/ml-database.js');
        getPredictionsByURL = mlModule.getPredictionsByURL;
        mlDataAvailable = true;
      } catch (error) {
        console.debug('ML module not available for saved tabs enrichment');
      }
      
      // Get current tab URLs for matching
      let currentTabUrls = new Set();
      try {
        const tabs = await browser.tabs.query({});
        currentTabUrls = new Set(tabs.map(tab => tab.url));
      } catch (error) {
        console.warn('Could not fetch current tabs for matching:', error);
      }
      
      // Normalize saved tabs to match schema
      const enrichedTabs = [];
      
      for (const tab of savedTabs) {
        const savedDate = new Date(tab.savedDate);
        const isValidDate = !isNaN(savedDate.getTime());
        
        // Use lastCloseTime as lastAccessed for saved tabs
        // This allows "Open Date" grouping to work properly
        const lastAccessedTime = tab.lastCloseTime || tab.savedDate || Date.now();
        const lastAccessedDate = new Date(lastAccessedTime);
        const isValidLastAccessed = !isNaN(lastAccessedDate.getTime());
        
        
        const enrichedTab = {
          ...tab,
          domain: this.extractDomain(tab.url),
          weekNumber: isValidDate ? this.getWeekNumber(savedDate) : null,
          monthYear: isValidDate ? this.getMonthYear(savedDate) : null,
          yearQuarter: isValidDate ? this.getYearQuarter(savedDate) : null,
          // Add lastAccessed fields for "Open Date" grouping support
          lastAccessed: new Date(lastAccessedTime).getTime(),
          lastAccessedWeekNumber: isValidLastAccessed ? this.getWeekNumber(lastAccessedDate) : null,
          lastAccessedMonthYear: isValidLastAccessed ? this.getMonthYear(lastAccessedDate) : null,
          lastAccessedYearQuarter: isValidLastAccessed ? this.getYearQuarter(lastAccessedDate) : null,
          // Add flag if this saved tab URL exists in current tabs
          isCurrentlyOpen: currentTabUrls.has(tab.url)
        };
        
        // Try to load ML metadata if available
        if (mlDataAvailable && getPredictionsByURL) {
          try {
            const predictions = await getPredictionsByURL(tab.url, 1); // Get latest prediction
            if (predictions && predictions.length > 0) {
              const latestPrediction = predictions[0];
              enrichedTab.mlMetadata = {
                confidence: latestPrediction.confidence || 0,
                predictions: latestPrediction.predictions || {},
                agreement: latestPrediction.agreement || 0,
                source: latestPrediction.source || 'unknown',
                timestamp: latestPrediction.timestamp,
                corrected: latestPrediction.corrected || false
              };
            }
          } catch (error) {
            console.debug('Could not load ML metadata for URL:', tab.url);
          }
        }
        
        enrichedTabs.push(enrichedTab);
      }
      
      return enrichedTabs;
    } catch (error) {
      console.error('Error getting saved tabs data:', error);
      return [];
    }
  }
}