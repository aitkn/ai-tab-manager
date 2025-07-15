/*
 * AI Tab Manager - Data Manager
 * UI layer adapter for the clean data processing architecture
 */

import { DataAggregationService, AggregationBuilder } from '../services/DataAggregationService.js';
import logger from '../utils/logger.js';
import { CurrentTabsDataSource, SavedTabsDataSource } from '../services/DataSourceInterface.js';
import { 
  TextSearchFilter, 
  CategoryFilter, 
  DateRangeFilter, 
  DomainFilter
} from '../services/DataFilteringService.js';
import { 
  TabSortConfigurations
} from '../services/DataSortingService.js';
import { 
  TabGroupingConfigurations
} from '../services/DataGroupingService.js';
import { GROUPING_OPTIONS } from '../utils/constants.js';

/**
 * Data Manager
 * Bridge between the clean data processing architecture and UI layer
 * Provides a high-level interface for UI components
 */
export class DataManager {
  constructor() {
    this.aggregationService = new DataAggregationService();
    this.currentTabsProcessor = null;
    this.database = null;
    this.isInitialized = false;
  }

  /**
   * Initialize the data manager with required dependencies
   * @param {Object} currentTabsProcessor - Current tabs processor
   * @param {Object} database - Database instance
   */
  async initialize(currentTabsProcessor, database) {
    this.currentTabsProcessor = currentTabsProcessor;
    this.database = database;

    // Register data sources
    const currentTabsSource = new CurrentTabsDataSource(currentTabsProcessor);
    const savedTabsSource = new SavedTabsDataSource(database);

    this.aggregationService.registerDataSource(currentTabsSource);
    this.aggregationService.registerDataSource(savedTabsSource);

    // Set default limits based on UI requirements
    this.aggregationService.setLimits({
      maxGroups: 10, // Show first 10 groups initially
      maxItemsPerGroup: null, // Don't limit items within groups - let expand button handle it
      expandThreshold: 10
    });

    this.isInitialized = true;
  }

  /**
   * Check if data manager is ready
   * @returns {boolean} Whether initialized
   */
  isReady() {
    return this.isInitialized;
  }

  /**
   * Get current tabs data with processing options
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} Processed current tabs data
   */
  async getCurrentTabsData(options = {}) {
    if (!this.isReady()) {
      logger.error('❌ DataManager.getCurrentTabsData: Not initialized!', {
        isInitialized: this.isInitialized,
        currentTabsProcessor: !!this.currentTabsProcessor,
        database: !!this.database
      });
      throw new Error('DataManager not initialized - check app-initializer.js');
    }
    

    const {
      searchQuery = '',
      categories = null,
      groupBy = 'category',
      sortBy = null,
      domains = null,
      limits = null
    } = options;

    const builder = new AggregationBuilder(this.aggregationService)
      .from('current_tabs');

    // Configure filtering
    builder.filter(filteringService => {
      filteringService.clearFilters();

      // Add search filter
      if (searchQuery) {
        const searchFilter = new TextSearchFilter(searchQuery, {
          searchFields: ['title', 'url', 'domain']
        });
        filteringService.addFilter('search', searchFilter.createFilter());
      }

      // Add category filter
      if (categories && categories.length > 0) {
        const categoryFilter = new CategoryFilter(categories);
        filteringService.addFilter('categories', categoryFilter.createFilter());
      }

      // Add domain filter
      if (domains && domains.length > 0) {
        const domainFilter = new DomainFilter(domains);
        filteringService.addFilter('domains', domainFilter.createFilter());
      }
    });

    // Configure sorting
    builder.sort(sortingService => {
      sortingService.clearSort();

      if (sortBy) {
        switch (sortBy) {
          case 'title':
            Object.assign(sortingService, TabSortConfigurations.byTitle());
            break;
          case 'domain':
            Object.assign(sortingService, TabSortConfigurations.byDomain());
            break;
          case 'lastAccessed':
            Object.assign(sortingService, TabSortConfigurations.byLastAccessed());
            break;
          case 'priority':
            Object.assign(sortingService, TabSortConfigurations.byPriority());
            break;
          case 'window':
            Object.assign(sortingService, TabSortConfigurations.byWindowAndIndex());
            break;
          default:
            // Default to category and title
            Object.assign(sortingService, TabSortConfigurations.byCategoryAndTitle());
        }
      } else {
        // Default sorting
        Object.assign(sortingService, TabSortConfigurations.byCategoryAndTitle());
      }
    });

    // Configure grouping
    logger.dataGrouping('🔧 DataManager.getCurrentTabsData - configuring grouping:', groupBy);
    
    builder.group(groupingService => {
      switch (groupBy) {
        case GROUPING_OPTIONS.CATEGORY:
        case 'category':
          Object.assign(groupingService, TabGroupingConfigurations.byCategory());
          break;
        case GROUPING_OPTIONS.DOMAIN:
        case 'domain':
          Object.assign(groupingService, TabGroupingConfigurations.byDomain());
          break;
        
        // NEW CURRENT TAB GROUPINGS
        case GROUPING_OPTIONS.OPENED:
        case 'opened':
          logger.dataGrouping('🔧 Using custom grouping for OPENED');
          // For new groupings, we need to bypass the aggregation service
          // and use our custom grouping logic
          groupingService.setGroupBy(['__custom_opened__']);
          groupingService.setCountBy(['category', 'domain']);
          break;
        case GROUPING_OPTIONS.LAST_ACTIVE:
        case 'lastActive':
          logger.dataGrouping('🔧 Using custom grouping for LAST_ACTIVE');
          groupingService.setGroupBy(['__custom_lastActive__']);
          groupingService.setCountBy(['category', 'domain']);
          break;
        case GROUPING_OPTIONS.TIME_OPEN:
        case 'timeOpen':
          logger.dataGrouping('🔧 Using custom grouping for TIME_OPEN');
          groupingService.setGroupBy(['__custom_timeOpen__']);
          groupingService.setCountBy(['category', 'domain']);
          break;
        
        // Legacy groupings
        case 'window':
          Object.assign(groupingService, TabGroupingConfigurations.byWindow());
          break;
        case GROUPING_OPTIONS.LAST_ACCESSED_DATE:
        case 'lastAccessedDate':
          // Group by last accessed date
          groupingService.setGroupBy(['lastAccessed']);
          groupingService.setCountBy(['category', 'domain']);
          break;
        case GROUPING_OPTIONS.LAST_ACCESSED_WEEK:
        case 'lastAccessedWeek':
          // Group by last accessed week
          groupingService.setGroupBy(['lastAccessedWeekNumber']);
          groupingService.setCountBy(['category', 'domain']);
          break;
        case GROUPING_OPTIONS.LAST_ACCESSED_MONTH:
        case 'lastAccessedMonth':
          // Group by last accessed month
          groupingService.setGroupBy(['lastAccessedMonthYear']);
          groupingService.setCountBy(['category', 'domain']);
          break;
        case 'none':
          Object.assign(groupingService, TabGroupingConfigurations.none());
          break;
        default:
          logger.dataGrouping('🔧 WARNING: Unknown grouping type, falling back to category:', groupBy);
          Object.assign(groupingService, TabGroupingConfigurations.byCategory());
      }
    });

    // Apply custom limits if provided
    if (limits) {
      builder.limit(limits);
    }

    const result = await builder.execute();
    
    
    return result;
  }

  /**
   * Get saved tabs data with processing options
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} Processed saved tabs data
   */
  async getSavedTabsData(options = {}) {
    if (!this.isReady()) {
      logger.error('❌ DataManager.getSavedTabsData: Not initialized!', {
        isInitialized: this.isInitialized,
        currentTabsProcessor: !!this.currentTabsProcessor,
        database: !!this.database
      });
      throw new Error('DataManager not initialized - check app-initializer.js');
    }
    


    const {
      searchQuery = '',
      categories = null,
      groupBy = 'monthYear',
      sortBy = 'savedDate',
      domains = null,
      dateRange = null,
      limits = null
    } = options;

    const builder = new AggregationBuilder(this.aggregationService)
      .from('saved_tabs');

    // Debug: Check raw data source
    const savedTabsDataSource = this.aggregationService.dataSources.get('saved_tabs');
    if (savedTabsDataSource) {
      // Data source is available for processing
    }

    // Configure filtering
    builder.filter(filteringService => {
      filteringService.clearFilters();

      // Add search filter
      if (searchQuery) {
        const searchFilter = new TextSearchFilter(searchQuery, {
          searchFields: ['title', 'url', 'domain']
        });
        filteringService.addFilter('search', searchFilter.createFilter());
      }

      // Add category filter
      if (categories && categories.length > 0) {
        const categoryFilter = new CategoryFilter(categories);
        filteringService.addFilter('categories', categoryFilter.createFilter());
      }

      // Add domain filter
      if (domains && domains.length > 0) {
        const domainFilter = new DomainFilter(domains);
        filteringService.addFilter('domains', domainFilter.createFilter());
      }

      // Add date range filter
      if (dateRange && (dateRange.start || dateRange.end)) {
        const dateFilter = new DateRangeFilter('savedDate', dateRange.start, dateRange.end);
        filteringService.addFilter('dateRange', dateFilter.createFilter());
      }
    });

    // Configure sorting
    builder.sort(sortingService => {
      sortingService.clearSort();

      switch (sortBy) {
        case 'title':
          Object.assign(sortingService, TabSortConfigurations.byTitle());
          break;
        case 'domain':
          Object.assign(sortingService, TabSortConfigurations.byDomain());
          break;
        case 'savedDate':
          Object.assign(sortingService, TabSortConfigurations.bySavedDate());
          break;
        case 'lastAccessed':
          Object.assign(sortingService, TabSortConfigurations.byLastAccessed());
          break;
        case 'recency':
          Object.assign(sortingService, TabSortConfigurations.byRecency());
          break;
        default:
          Object.assign(sortingService, TabSortConfigurations.bySavedDate());
      }
    });

    // Configure grouping
    builder.group(groupingService => {
      switch (groupBy) {
        case GROUPING_OPTIONS.CATEGORY:
        case 'category':
          Object.assign(groupingService, TabGroupingConfigurations.byCategory());
          break;
        case GROUPING_OPTIONS.DOMAIN:
        case 'domain':
          Object.assign(groupingService, TabGroupingConfigurations.byDomain());
          break;
        case GROUPING_OPTIONS.SAVED_DATE:
        case 'savedDate':
        case 'saveDate':
          Object.assign(groupingService, TabGroupingConfigurations.bySaveDate());
          break;
        case GROUPING_OPTIONS.SAVED_WEEK:
        case 'savedWeek':
        case 'week':
          Object.assign(groupingService, TabGroupingConfigurations.byWeek());
          break;
        case GROUPING_OPTIONS.SAVED_MONTH:
        case 'savedMonth':
        case 'monthYear':
          Object.assign(groupingService, TabGroupingConfigurations.byMonthYear());
          break;
        case GROUPING_OPTIONS.LAST_ACCESSED_DATE:
        case 'lastAccessedDate':
          // Group by last accessed date
          groupingService.setGroupBy(['lastAccessed']);
          groupingService.setCountBy(['category', 'domain']);
          break;
        case GROUPING_OPTIONS.LAST_ACCESSED_WEEK:
        case 'lastAccessedWeek':
          // Group by last accessed week
          groupingService.setGroupBy(['lastAccessedWeekNumber']);
          groupingService.setCountBy(['category', 'domain']);
          break;
        case GROUPING_OPTIONS.LAST_ACCESSED_MONTH:
        case 'lastAccessedMonth':
          // Group by last accessed month
          groupingService.setGroupBy(['lastAccessedMonthYear']);
          groupingService.setCountBy(['category', 'domain']);
          break;
        case GROUPING_OPTIONS.CLOSE_TIME:
        case 'closeTime':
          // Group by close time - use savedDate as proxy
          groupingService.setGroupBy(['savedDate']);
          groupingService.setCountBy(['category', 'domain']);
          break;
          
        // NEW SAVED TAB GROUPINGS
        case GROUPING_OPTIONS.ORIGINALLY_OPENED:
        case 'originallyOpened':
          logger.dataGrouping('🔧 Using custom grouping for ORIGINALLY_OPENED');
          groupingService.setGroupBy(['__custom_originallyOpened__']);
          groupingService.setCountBy(['category', 'domain']);
          break;
        case GROUPING_OPTIONS.LAST_VIEWED:
        case 'lastViewed':
          logger.dataGrouping('🔧 Using custom grouping for LAST_VIEWED');
          groupingService.setGroupBy(['__custom_lastViewed__']);
          groupingService.setCountBy(['category', 'domain']);
          break;
        case GROUPING_OPTIONS.SAVED:
        case 'saved':
          logger.dataGrouping('🔧 Using custom grouping for SAVED');
          groupingService.setGroupBy(['__custom_saved__']);
          groupingService.setCountBy(['category', 'domain']);
          break;
        case GROUPING_OPTIONS.TOTAL_AGE:
        case 'totalAge':
          logger.dataGrouping('🔧 Using custom grouping for TOTAL_AGE');
          groupingService.setGroupBy(['__custom_totalAge__']);
          groupingService.setCountBy(['category', 'domain']);
          break;
        case GROUPING_OPTIONS.TIME_SINCE_VIEWED:
        case 'timeSinceViewed':
          logger.dataGrouping('🔧 Using custom grouping for TIME_SINCE_VIEWED');
          groupingService.setGroupBy(['__custom_timeSinceViewed__']);
          groupingService.setCountBy(['category', 'domain']);
          break;
        case GROUPING_OPTIONS.PREDICTION_CONFIDENCE:
        case 'predictionConfidence':
          logger.dataGrouping('🔧 Using custom grouping for PREDICTION_CONFIDENCE');
          groupingService.setGroupBy(['__custom_predictionConfidence__']);
          groupingService.setCountBy(['category', 'domain']);
          break;
        case GROUPING_OPTIONS.PREDICTION_AGREEMENT:
        case 'predictionAgreement':
          logger.dataGrouping('🔧 Using custom grouping for PREDICTION_AGREEMENT');
          groupingService.setGroupBy(['__custom_predictionAgreement__']);
          groupingService.setCountBy(['category', 'domain']);
          break;
          
        case 'quarter':
          Object.assign(groupingService, TabGroupingConfigurations.byYearQuarter());
          break;
        case 'none':
          Object.assign(groupingService, TabGroupingConfigurations.none());
          break;
        default:
          Object.assign(groupingService, TabGroupingConfigurations.byMonthYear());
      }
    });

    // Apply custom limits if provided
    if (limits) {
      builder.limit(limits);
    }

    const result = await builder.execute();
    
    
    return result;
  }

  /**
   * Get data with custom filter/sort/group configuration
   * @param {string} sourceId - Data source ID ('current_tabs' or 'saved_tabs')
   * @param {Object} config - Custom configuration
   * @returns {Promise<Object>} Processed data
   */
  async getCustomData(sourceId, config = {}) {
    if (!this.isReady()) {
      throw new Error('DataManager not initialized');
    }


    const builder = new AggregationBuilder(this.aggregationService)
      .from(sourceId);

    // Apply custom configuration
    if (config.filter) {
      builder.filter(config.filter);
    }

    if (config.sort) {
      builder.sort(config.sort);
    }

    if (config.group) {
      builder.group(config.group);
    }

    if (config.limits) {
      builder.limit(config.limits);
    }

    // Caching removed - always run full pipeline

    return await builder.execute(config.options || {});
  }


  /**
   * Get processing statistics
   * @returns {Object} Statistics
   */
  getStatistics() {
    if (!this.isReady()) {
      return { error: 'Not initialized' };
    }

    return this.aggregationService.getStatistics();
  }

  /**
   * Get available data sources
   * @returns {Array<string>} Source IDs
   */
  getAvailableDataSources() {
    if (!this.isReady()) {
      return [];
    }

    return Array.from(this.aggregationService.getDataSources().keys());
  }

  /**
   * Update limits configuration
   * @param {Object} limits - New limits
   */
  updateLimits(limits) {
    if (this.isReady()) {
      this.aggregationService.setLimits(limits);
    }
  }

}

// Create singleton instance
export const dataManager = new DataManager();