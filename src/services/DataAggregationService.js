/*
 * AI Tab Manager - Data Aggregation Service
 * Central coordinator for all data processing operations
 */

import { DataSourceInterface } from './DataSourceInterface.js';
import { DataFilteringService } from './DataFilteringService.js';
import { DataSortingService } from './DataSortingService.js';
import { DataGroupingService } from './DataGroupingService.js';

/**
 * Data Aggregation Service
 * Coordinates filtering, sorting, grouping, and limiting operations
 * Completely decoupled from data sources and UI
 */
export class DataAggregationService {
  constructor() {
    this.dataSources = new Map();
    this.activeSourceId = null;
    this.filteringService = new DataFilteringService();
    this.sortingService = new DataSortingService();
    this.groupingService = new DataGroupingService();
    this.limits = {
      maxGroups: null,
      maxItemsPerGroup: null,
      expandThreshold: 10 // Show "show more" if group has more items
    };
    // Caching removed for simplicity - always run full pipeline
  }

  /**
   * Register a data source
   * @param {DataSourceInterface} dataSource - Data source to register
   */
  registerDataSource(dataSource) {
    if (!(dataSource instanceof DataSourceInterface)) {
      throw new Error('Data source must implement DataSourceInterface');
    }
    
    this.dataSources.set(dataSource.getSourceId(), dataSource);
  }

  /**
   * Set active data source
   * @param {string} sourceId - Source identifier
   */
  setActiveDataSource(sourceId) {
    if (!this.dataSources.has(sourceId)) {
      throw new Error(`Data source '${sourceId}' not registered`);
    }
    
    this.activeSourceId = sourceId;
  }

  /**
   * Get the active data source
   * @returns {DataSourceInterface} Active data source
   */
  getActiveDataSource() {
    if (!this.activeSourceId || !this.dataSources.has(this.activeSourceId)) {
      return null;
    }
    
    return this.dataSources.get(this.activeSourceId);
  }

  /**
   * Set display limits
   * @param {Object} limits - Limit configuration
   */
  setLimits(limits) {
    this.limits = { ...this.limits, ...limits };
  }

  /**
   * Get current display limits
   * @returns {Object} Current limits configuration
   */
  getLimits() {
    return { ...this.limits };
  }


  /**
   * Process data through the complete pipeline
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} Processed data result
   */
  async processData(options = {}) {
    try {
      // Get active data source
      const dataSource = this.getActiveDataSource();
      if (!dataSource) {
        throw new Error('No active data source set');
      }

      // Check if source is available
      if (!(await dataSource.isAvailable())) {
        throw new Error('Data source is not available');
      }

      // Get raw data
      const rawData = await dataSource.getData();
      const schema = dataSource.getSchema();

      // Process data through pipeline - always run full pipeline
      const result = this.processPipeline(rawData, schema, options);

      return result;
    } catch (error) {
      console.error('Error processing data:', error);
      throw error;
    }
  }

  /**
   * Process data through the complete pipeline
   * @param {Array} rawData - Raw data from source
   * @param {Object} schema - Data schema
   * @param {Object} options - Processing options
   * @returns {Object} Processed result
   */
  processPipeline(rawData, schema) {
    const startTime = performance.now();
    
    // Step 1: Apply filters
    const filteredData = this.filteringService.applyFilters(rawData, schema);
    
    // Step 2: Apply sorting
    const sortedData = this.sortingService.sortData(filteredData, schema);
    
    // Step 3: Apply grouping
    const groupedResult = this.groupingService.groupData(sortedData, schema);
    
    // Step 4: Apply limits
    const limitedResult = this.applyLimits(groupedResult);
    
    // Step 5: Calculate metadata
    const metadata = this.generateMetadata(rawData, filteredData, sortedData, groupedResult, limitedResult);
    
    const processingTime = performance.now() - startTime;

    return {
      ...limitedResult,
      metadata: {
        ...metadata,
        processingTime,
        sourceId: this.activeSourceId,
        timestamp: new Date().toISOString()
      }
    };
  }

  /**
   * Apply display limits to grouped data
   * @param {Object} groupedResult - Result from grouping service
   * @returns {Object} Limited result with pagination info
   */
  applyLimits(groupedResult) {
    const { groups, groupCounts, subCounts, totalCount, ungroupedCount } = groupedResult;
    const result = {
      groups: {},
      groupCounts: {},
      subCounts: {},
      totalCount,
      ungroupedCount,
      pagination: {
        hasMoreGroups: false,
        hasMoreItems: {},
        visibleGroupCount: 0,
        totalGroupCount: Object.keys(groups).length,
        hiddenGroupCount: 0
      }
    };

    // Special handling for categories to preserve order
    let groupEntries;
    const groupingFields = this.groupingService.groupBy;
    
    if (groupingFields.length === 1 && groupingFields[0] === 'category') {
      // For categories, manually create entries in the correct order
      const categoryOrder = ['0', '3', '2', '1'];
      groupEntries = [];
      for (const key of categoryOrder) {
        if (groups[key]) {
          groupEntries.push([key, groups[key]]);
        }
      }
      // Add any other groups that aren't in the standard categories
      for (const [key, value] of Object.entries(groups)) {
        if (!categoryOrder.includes(key)) {
          groupEntries.push([key, value]);
        }
      }
    } else {
      groupEntries = Object.entries(groups);
    }
    
    const maxGroups = this.limits.maxGroups;
    const maxItemsPerGroup = this.limits.maxItemsPerGroup;

    // Sort groups before limiting to ensure consistent ordering
    let sortedGroupEntries = groupEntries;
    
    // Apply appropriate sorting based on grouping type
    if (groupingFields.length === 1) {
      const groupBy = groupingFields[0];
      
      switch (groupBy) {
        case 'category':
          // Categories are already in the correct order from above
          sortedGroupEntries = groupEntries;
          break;
          
        case 'domain':
        case 'windowId':
          // Sort alphabetically
          sortedGroupEntries = groupEntries.sort((a, b) => a[0].localeCompare(b[0]));
          break;
          
        case 'savedDate':
        case 'lastAccessed':
        case 'lastAccessedDate':
        case 'monthYear':
        case 'yearQuarter':
        case 'weekNumber':
        case 'lastAccessedWeekNumber':
          // Sort chronologically in descending order (newest first)
          sortedGroupEntries = groupEntries.sort((a, b) => b[0].localeCompare(a[0]));
          break;
          
        default:
          // Default to alphabetical sorting
          sortedGroupEntries = groupEntries.sort((a, b) => a[0].localeCompare(b[0]));
          break;
      }
    }

    // Limit number of groups AFTER sorting
    const visibleGroups = maxGroups ? sortedGroupEntries.slice(0, maxGroups) : sortedGroupEntries;
    result.pagination.hasMoreGroups = maxGroups && groupEntries.length > maxGroups;
    result.pagination.visibleGroupCount = visibleGroups.length;
    result.pagination.hiddenGroupCount = Math.max(0, groupEntries.length - visibleGroups.length);

    // Process each visible group
    for (const [groupKey, groupData] of visibleGroups) {
      // Limit items within group
      const visibleItems = maxItemsPerGroup ? groupData.slice(0, maxItemsPerGroup) : groupData;
      const hasMoreItems = maxItemsPerGroup && groupData.length > maxItemsPerGroup;
      
      result.groups[groupKey] = visibleItems;
      result.groupCounts[groupKey] = groupCounts[groupKey]; // Keep original count
      result.subCounts[groupKey] = subCounts[groupKey];
      result.pagination.hasMoreItems[groupKey] = hasMoreItems;
    }

    return result;
  }

  /**
   * Generate processing metadata
   * @param {Array} rawData - Original raw data
   * @param {Array} filteredData - Filtered data
   * @param {Array} sortedData - Sorted data
   * @param {Object} groupedResult - Grouped data
   * @param {Object} limitedResult - Final limited data
   * @returns {Object} Metadata object
   */
  generateMetadata(rawData, filteredData, sortedData, groupedResult, limitedResult) {
    return {
      counts: {
        raw: rawData.length,
        filtered: filteredData.length,
        sorted: sortedData.length,
        totalGroups: Object.keys(groupedResult.groups).length,
        visibleGroups: Object.keys(limitedResult.groups).length,
        ungrouped: groupedResult.ungroupedCount
      },
      filters: {
        active: this.filteringService.getActiveFilterCount(),
        names: this.filteringService.getActiveFilterNames()
      },
      sorting: {
        criteria: this.sortingService.sortCriteria.length,
        fields: this.sortingService.sortCriteria.map(c => `${c.field}:${c.direction}`)
      },
      grouping: {
        fields: this.groupingService.groupBy,
        countFields: this.groupingService.countBy
      },
      limits: {
        applied: this.limits.maxGroups !== null || this.limits.maxItemsPerGroup !== null,
        maxGroups: this.limits.maxGroups,
        maxItemsPerGroup: this.limits.maxItemsPerGroup
      }
    };
  }


  /**
   * Get filtering service for configuration
   * @returns {DataFilteringService} Filtering service instance
   */
  getFilteringService() {
    return this.filteringService;
  }

  /**
   * Get sorting service for configuration
   * @returns {DataSortingService} Sorting service instance
   */
  getSortingService() {
    return this.sortingService;
  }

  /**
   * Get grouping service for configuration
   * @returns {DataGroupingService} Grouping service instance
   */
  getGroupingService() {
    return this.groupingService;
  }

  /**
   * Get registered data sources
   * @returns {Map} Data sources map
   */
  getDataSources() {
    return new Map(this.dataSources);
  }

  /**
   * Get processing statistics
   * @returns {Object} Statistics object
   */
  getStatistics() {
    return {
      registeredSources: this.dataSources.size,
      activeSource: this.activeSourceId,
      cacheSize: this.cache.size,
      cacheEnabled: this.cacheEnabled,
      limits: this.limits
    };
  }
}

/**
 * Aggregation Builder
 * Fluent interface for configuring data aggregation
 */
export class AggregationBuilder {
  constructor(aggregationService = null) {
    this.service = aggregationService || new DataAggregationService();
  }

  /**
   * Use a specific data source
   * @param {string} sourceId - Source identifier
   * @returns {AggregationBuilder} this for chaining
   */
  from(sourceId) {
    this.service.setActiveDataSource(sourceId);
    return this;
  }

  /**
   * Apply filters using the filtering service
   * @param {Function} configureFn - Function to configure filtering service
   * @returns {AggregationBuilder} this for chaining
   */
  filter(configureFn) {
    const filteringService = this.service.getFilteringService();
    configureFn(filteringService);
    return this;
  }

  /**
   * Apply sorting using the sorting service
   * @param {Function} configureFn - Function to configure sorting service
   * @returns {AggregationBuilder} this for chaining
   */
  sort(configureFn) {
    const sortingService = this.service.getSortingService();
    configureFn(sortingService);
    return this;
  }

  /**
   * Apply grouping using the grouping service
   * @param {Function} configureFn - Function to configure grouping service
   * @returns {AggregationBuilder} this for chaining
   */
  group(configureFn) {
    const groupingService = this.service.getGroupingService();
    configureFn(groupingService);
    return this;
  }

  /**
   * Set display limits
   * @param {Object} limits - Limit configuration
   * @returns {AggregationBuilder} this for chaining
   */
  limit(limits) {
    this.service.setLimits(limits);
    return this;
  }


  /**
   * Execute the aggregation pipeline
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} Processed data result
   */
  async execute(options = {}) {
    return await this.service.processData(options);
  }

  /**
   * Get the underlying aggregation service
   * @returns {DataAggregationService} Aggregation service instance
   */
  build() {
    return this.service;
  }
}