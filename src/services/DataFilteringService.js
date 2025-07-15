/*
 * AI Tab Manager - Data Filtering Service
 * Source-agnostic filtering functionality for any data type
 */

import { extractDomain } from '../utils/helpers.js';

/**
 * Data Filtering Service
 * Provides filtering capabilities independent of data source
 */
export class DataFilteringService {
  constructor() {
    this.filters = new Map();
  }

  /**
   * Add a filter to the service
   * @param {string} name - Filter name
   * @param {Function} filterFn - Filter function
   */
  addFilter(name, filterFn) {
    this.filters.set(name, filterFn);
  }

  /**
   * Remove a filter from the service
   * @param {string} name - Filter name
   */
  removeFilter(name) {
    this.filters.delete(name);
  }

  /**
   * Clear all filters
   */
  clearFilters() {
    this.filters.clear();
  }

  /**
   * Apply all active filters to data
   * @param {Array} data - Data to filter
   * @param {Object} schema - Data schema for field validation
   * @returns {Array} Filtered data
   */
  applyFilters(data, schema = {}) {
    if (!Array.isArray(data) || data.length === 0) {
      return [];
    }

    let filteredData = [...data];

    for (const [name, filterFn] of this.filters) {
      try {
        filteredData = filteredData.filter(item => filterFn(item, schema));
      } catch (error) {
        console.error(`Error applying filter '${name}':`, error);
      }
    }

    return filteredData;
  }

  /**
   * Get count of active filters
   * @returns {number} Number of active filters
   */
  getActiveFilterCount() {
    return this.filters.size;
  }

  /**
   * Get list of active filter names
   * @returns {Array<string>} Filter names
   */
  getActiveFilterNames() {
    return Array.from(this.filters.keys());
  }
}

/**
 * Text Search Filter
 * Filters data based on text search across searchable fields
 */
export class TextSearchFilter {
  constructor(query = '', options = {}) {
    this.query = query.toLowerCase().trim();
    this.caseSensitive = options.caseSensitive || false;
    this.searchFields = options.searchFields || [];
    this.exactMatch = options.exactMatch || false;
  }

  /**
   * Create filter function for text search
   * @returns {Function} Filter function
   */
  createFilter() {
    if (!this.query) {
      return () => true; // No filtering if no query
    }

    return (item, schema) => {
      // Determine searchable fields from schema or use provided fields
      const fieldsToSearch = this.searchFields.length > 0 
        ? this.searchFields 
        : this.getSearchableFields(schema);

      // Extract searchable text from item
      const searchableText = fieldsToSearch
        .map(field => this.extractFieldValue(item, field))
        .join(' ')
        .toLowerCase();

      if (this.exactMatch) {
        return searchableText === this.query;
      }
      
      // Multi-word search: split query and check that ALL words are present
      const searchWords = this.query.split(/\s+/).filter(word => word.length > 0);
      return searchWords.every(word => searchableText.includes(word));
    };
  }

  /**
   * Get searchable fields from schema
   * @param {Object} schema - Data schema
   * @returns {Array<string>} Searchable field names
   */
  getSearchableFields(schema) {
    return Object.entries(schema)
      .filter(([, config]) => config.searchable)
      .map(([field]) => field);
  }

  /**
   * Extract field value from item, handling nested fields
   * @param {Object} item - Data item
   * @param {string} field - Field name (supports dot notation)
   * @returns {string} Field value as string
   */
  extractFieldValue(item, field) {
    try {
      const value = field.split('.').reduce((obj, key) => obj?.[key], item);
      return String(value || '');
    } catch {
      return '';
    }
  }
}

/**
 * Category Filter
 * Filters data by category values
 */
export class CategoryFilter {
  constructor(categories = []) {
    this.categories = Array.isArray(categories) ? categories : [categories];
  }

  createFilter() {
    if (this.categories.length === 0) {
      return () => true;
    }

    return (item) => {
      return this.categories.includes(item.category);
    };
  }
}

/**
 * Date Range Filter
 * Filters data by date ranges
 */
export class DateRangeFilter {
  constructor(dateField, startDate = null, endDate = null) {
    this.dateField = dateField;
    this.startDate = startDate ? new Date(startDate) : null;
    this.endDate = endDate ? new Date(endDate) : null;
  }

  createFilter() {
    if (!this.startDate && !this.endDate) {
      return () => true;
    }

    return (item) => {
      const itemDate = new Date(item[this.dateField]);
      
      if (isNaN(itemDate.getTime())) {
        return false; // Invalid date
      }

      if (this.startDate && itemDate < this.startDate) {
        return false;
      }

      if (this.endDate && itemDate > this.endDate) {
        return false;
      }

      return true;
    };
  }
}

/**
 * Domain Filter
 * Filters data by domain patterns
 */
export class DomainFilter {
  constructor(domains = [], exclude = false) {
    this.domains = Array.isArray(domains) ? domains : [domains];
    this.exclude = exclude; // If true, exclude these domains instead of including
  }

  createFilter() {
    if (this.domains.length === 0) {
      return () => true;
    }

    return (item) => {
      const itemDomain = item.domain || this.extractDomain(item.url || '');
      const matches = this.domains.some(domain => 
        itemDomain.includes(domain) || domain.includes(itemDomain)
      );

      return this.exclude ? !matches : matches;
    };
  }

  extractDomain(url) {
    // Use the imported extractDomain function from helpers to ensure consistent domain extraction
    // This will use getRootDomain to extract the primary domain
    return extractDomain(url);
  }
}

/**
 * Custom Field Filter
 * Generic filter for any field with custom comparison logic
 */
export class CustomFieldFilter {
  constructor(field, value, compareFn = null) {
    this.field = field;
    this.value = value;
    this.compareFn = compareFn || this.defaultCompare;
  }

  defaultCompare(itemValue, filterValue) {
    return itemValue === filterValue;
  }

  createFilter() {
    return (item) => {
      const itemValue = this.extractFieldValue(item, this.field);
      return this.compareFn(itemValue, this.value);
    };
  }

  extractFieldValue(item, field) {
    return field.split('.').reduce((obj, key) => obj?.[key], item);
  }
}

/**
 * Composite Filter
 * Combines multiple filters with AND/OR logic
 */
export class CompositeFilter {
  constructor(filters = [], operator = 'AND') {
    this.filters = filters;
    this.operator = operator.toUpperCase();
  }

  createFilter() {
    if (this.filters.length === 0) {
      return () => true;
    }

    return (item, schema) => {
      const results = this.filters.map(filter => {
        const filterFn = typeof filter === 'function' ? filter : filter.createFilter();
        return filterFn(item, schema);
      });

      return this.operator === 'OR' 
        ? results.some(result => result)
        : results.every(result => result);
    };
  }
}

/**
 * Filter Builder
 * Fluent interface for building complex filters
 */
export class FilterBuilder {
  constructor() {
    this.filters = [];
  }

  /**
   * Add text search filter
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {FilterBuilder} this for chaining
   */
  search(query, options = {}) {
    const filter = new TextSearchFilter(query, options);
    this.filters.push(filter);
    return this;
  }

  /**
   * Add category filter
   * @param {Array|number} categories - Category IDs
   * @returns {FilterBuilder} this for chaining
   */
  categories(categories) {
    const filter = new CategoryFilter(categories);
    this.filters.push(filter);
    return this;
  }

  /**
   * Add date range filter
   * @param {string} field - Date field name
   * @param {Date|string} start - Start date
   * @param {Date|string} end - End date
   * @returns {FilterBuilder} this for chaining
   */
  dateRange(field, start, end) {
    const filter = new DateRangeFilter(field, start, end);
    this.filters.push(filter);
    return this;
  }

  /**
   * Add domain filter
   * @param {Array|string} domains - Domains to filter
   * @param {boolean} exclude - Whether to exclude domains
   * @returns {FilterBuilder} this for chaining
   */
  domains(domains, exclude = false) {
    const filter = new DomainFilter(domains, exclude);
    this.filters.push(filter);
    return this;
  }

  /**
   * Add custom field filter
   * @param {string} field - Field name
   * @param {*} value - Value to compare
   * @param {Function} compareFn - Custom comparison function
   * @returns {FilterBuilder} this for chaining
   */
  customField(field, value, compareFn) {
    const filter = new CustomFieldFilter(field, value, compareFn);
    this.filters.push(filter);
    return this;
  }

  /**
   * Build composite filter
   * @param {string} operator - 'AND' or 'OR'
   * @returns {CompositeFilter} Combined filter
   */
  build(operator = 'AND') {
    return new CompositeFilter(this.filters, operator);
  }

  /**
   * Clear all filters
   * @returns {FilterBuilder} this for chaining
   */
  clear() {
    this.filters = [];
    return this;
  }
}