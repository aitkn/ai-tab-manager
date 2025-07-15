/*
 * AI Tab Manager - Data Sorting Service
 * Source-agnostic sorting functionality for any data type
 */

/**
 * Data Sorting Service
 * Provides flexible sorting capabilities independent of data source
 */
export class DataSortingService {
  constructor() {
    this.sortCriteria = [];
  }

  /**
   * Add sort criterion
   * @param {string} field - Field to sort by
   * @param {string} direction - 'asc' or 'desc'
   * @param {Function} compareFn - Optional custom comparison function
   */
  addSort(field, direction = 'asc', compareFn = null) {
    this.sortCriteria.push({
      field,
      direction: direction.toLowerCase(),
      compareFn: compareFn || this.getDefaultCompareFn(field)
    });
  }

  /**
   * Clear all sort criteria
   */
  clearSort() {
    this.sortCriteria = [];
  }

  /**
   * Sort data using all configured criteria
   * @param {Array} data - Data to sort
   * @param {Object} schema - Data schema for field type information
   * @returns {Array} Sorted data (new array)
   */
  sortData(data, schema = {}) {
    if (!Array.isArray(data) || data.length === 0 || this.sortCriteria.length === 0) {
      return [...data];
    }

    return [...data].sort((a, b) => {
      for (const criterion of this.sortCriteria) {
        const result = this.compareItems(a, b, criterion, schema);
        if (result !== 0) {
          return result;
        }
      }
      return 0;
    });
  }

  /**
   * Compare two items based on a sort criterion
   * @param {Object} a - First item
   * @param {Object} b - Second item
   * @param {Object} criterion - Sort criterion
   * @param {Object} schema - Data schema
   * @returns {number} Comparison result (-1, 0, 1)
   */
  compareItems(a, b, criterion, schema) {
    const { field, direction, compareFn } = criterion;
    
    const valueA = this.extractFieldValue(a, field);
    const valueB = this.extractFieldValue(b, field);
    
    let result = compareFn(valueA, valueB, schema[field]);
    
    if (direction === 'desc') {
      result *= -1;
    }
    
    return result;
  }

  /**
   * Extract field value from item, handling nested fields
   * @param {Object} item - Data item
   * @param {string} field - Field name (supports dot notation)
   * @returns {*} Field value
   */
  extractFieldValue(item, field) {
    return field.split('.').reduce((obj, key) => obj?.[key], item);
  }

  /**
   * Get default comparison function for a field
   * @param {string} field - Field name
   * @returns {Function} Comparison function
   */
  // eslint-disable-next-line no-unused-vars
  getDefaultCompareFn(field) {
    // Return a general-purpose comparison function
    // Note: field parameter is kept for potential field-specific logic in the future
    return (a, b, fieldConfig) => {
      // Handle null/undefined values
      if (a == null && b == null) return 0;
      if (a == null) return -1;
      if (b == null) return 1;

      // Use field config type if available
      if (fieldConfig?.type) {
        switch (fieldConfig.type) {
          case 'number':
            return this.compareNumbers(a, b);
          case 'string':
            return this.compareStrings(a, b);
          case 'boolean':
            return this.compareBooleans(a, b);
          default:
            return this.compareGeneral(a, b);
        }
      }

      // Auto-detect type and compare
      return this.compareGeneral(a, b);
    };
  }

  /**
   * Compare numbers
   */
  compareNumbers(a, b) {
    const numA = Number(a);
    const numB = Number(b);
    
    if (isNaN(numA) && isNaN(numB)) return 0;
    if (isNaN(numA)) return -1;
    if (isNaN(numB)) return 1;
    
    return numA - numB;
  }

  /**
   * Compare strings (case-insensitive)
   */
  compareStrings(a, b) {
    const strA = String(a).toLowerCase();
    const strB = String(b).toLowerCase();
    return strA.localeCompare(strB);
  }

  /**
   * Compare booleans
   */
  compareBooleans(a, b) {
    return Boolean(a) - Boolean(b);
  }

  /**
   * General-purpose comparison
   */
  compareGeneral(a, b) {
    // Try number comparison first
    if (typeof a === 'number' && typeof b === 'number') {
      return this.compareNumbers(a, b);
    }

    // Handle dates
    if (a instanceof Date && b instanceof Date) {
      return a.getTime() - b.getTime();
    }

    // Handle date-like strings
    if (this.isDateLike(a) && this.isDateLike(b)) {
      return new Date(a).getTime() - new Date(b).getTime();
    }

    // Fallback to string comparison
    return this.compareStrings(a, b);
  }

  /**
   * Check if value looks like a date
   */
  isDateLike(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return false;
    const date = new Date(value);
    return !isNaN(date.getTime());
  }
}

/**
 * Predefined Sort Configurations
 * Common sorting patterns for tabs
 */
export class TabSortConfigurations {
  /**
   * Sort by title alphabetically
   */
  static byTitle(direction = 'asc') {
    const service = new DataSortingService();
    service.addSort('title', direction);
    return service;
  }

  /**
   * Sort by domain
   */
  static byDomain(direction = 'asc') {
    const service = new DataSortingService();
    service.addSort('domain', direction);
    return service;
  }

  /**
   * Sort by last accessed time
   */
  static byLastAccessed(direction = 'desc') {
    const service = new DataSortingService();
    service.addSort('lastAccessed', direction);
    return service;
  }

  /**
   * Sort by saved date (for saved tabs)
   */
  static bySavedDate(direction = 'desc') {
    const service = new DataSortingService();
    service.addSort('savedDate', direction);
    return service;
  }

  /**
   * Sort by category, then by title
   */
  static byCategoryAndTitle() {
    const service = new DataSortingService();
    service.addSort('category', 'asc');
    service.addSort('title', 'asc');
    return service;
  }

  /**
   * Sort by domain, then by title
   */
  static byDomainAndTitle() {
    const service = new DataSortingService();
    service.addSort('domain', 'asc');
    service.addSort('title', 'asc');
    return service;
  }

  /**
   * Sort by recency (last accessed, then saved date)
   */
  static byRecency() {
    const service = new DataSortingService();
    service.addSort('lastAccessed', 'desc');
    service.addSort('savedDate', 'desc');
    return service;
  }

  /**
   * Sort by window and tab index (for current tabs)
   */
  static byWindowAndIndex() {
    const service = new DataSortingService();
    service.addSort('windowId', 'asc');
    service.addSort('index', 'asc');
    return service;
  }

  /**
   * Custom sort for tab priority (pinned first, then active, then others)
   */
  static byPriority() {
    const service = new DataSortingService();
    
    // Custom comparison function for tab priority
    const priorityCompareFn = (a, b) => {
      // Priority: pinned > active > audible > others
      const getPriority = (tab) => {
        if (tab.pinned) return 4;
        if (tab.active) return 3;
        if (tab.audible) return 2;
        return 1;
      };
      
      return getPriority(b) - getPriority(a); // Higher priority first
    };
    
    service.addSort('priority', 'desc', priorityCompareFn);
    service.addSort('title', 'asc'); // Secondary sort by title
    return service;
  }
}

/**
 * Sort Builder
 * Fluent interface for building complex sorts
 */
export class SortBuilder {
  constructor() {
    this.service = new DataSortingService();
  }

  /**
   * Add sort by field
   * @param {string} field - Field name
   * @param {string} direction - 'asc' or 'desc'
   * @param {Function} compareFn - Optional custom comparison
   * @returns {SortBuilder} this for chaining
   */
  by(field, direction = 'asc', compareFn = null) {
    this.service.addSort(field, direction, compareFn);
    return this;
  }

  /**
   * Sort by title
   * @param {string} direction - 'asc' or 'desc'
   * @returns {SortBuilder} this for chaining
   */
  byTitle(direction = 'asc') {
    return this.by('title', direction);
  }

  /**
   * Sort by domain
   * @param {string} direction - 'asc' or 'desc'
   * @returns {SortBuilder} this for chaining
   */
  byDomain(direction = 'asc') {
    return this.by('domain', direction);
  }

  /**
   * Sort by category
   * @param {string} direction - 'asc' or 'desc'
   * @returns {SortBuilder} this for chaining
   */
  byCategory(direction = 'asc') {
    return this.by('category', direction);
  }

  /**
   * Sort by date field
   * @param {string} field - Date field name
   * @param {string} direction - 'asc' or 'desc'
   * @returns {SortBuilder} this for chaining
   */
  byDate(field, direction = 'desc') {
    return this.by(field, direction);
  }

  /**
   * Clear all sorts
   * @returns {SortBuilder} this for chaining
   */
  clear() {
    this.service.clearSort();
    return this;
  }

  /**
   * Build the sorting service
   * @returns {DataSortingService} Configured sorting service
   */
  build() {
    return this.service;
  }
}