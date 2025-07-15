/*
 * AI Tab Manager - Data Grouping Service
 * Source-agnostic grouping functionality with counter support
 */

/**
 * Data Grouping Service
 * Provides flexible grouping capabilities with nested counters
 */
export class DataGroupingService {
  constructor() {
    this.groupBy = [];
    this.countBy = [];
    this.includeUngrouped = true;
  }

  /**
   * Set fields to group by (supports nested grouping)
   * @param {Array<string>} fields - Field names to group by
   */
  setGroupBy(fields) {
    this.groupBy = Array.isArray(fields) ? fields : [fields];
  }

  /**
   * Set fields to count by (for sub-counters within groups)
   * @param {Array<string>} fields - Field names to count by
   */
  setCountBy(fields) {
    this.countBy = Array.isArray(fields) ? fields : [fields];
  }

  /**
   * Set whether to include ungrouped items
   * @param {boolean} include - Whether to include ungrouped items
   */
  setIncludeUngrouped(include) {
    this.includeUngrouped = include;
  }

  /**
   * Group data according to configuration
   * @param {Array} data - Data to group
   * @param {Object} schema - Data schema for field information
   * @returns {Object} Grouped data with counters
   */
  // eslint-disable-next-line no-unused-vars
  groupData(data, schema = {}) {
    // Note: schema parameter is kept for potential field validation in the future
    if (!Array.isArray(data) || data.length === 0) {
      return {
        groups: {},
        totalCount: 0,
        ungroupedCount: 0,
        groupCounts: {},
        subCounts: {}
      };
    }

    if (this.groupBy.length === 0) {
      // No grouping - return all data as single group
      return {
        groups: { 'all': data },
        totalCount: data.length,
        ungroupedCount: 0,
        groupCounts: { 'all': data.length },
        subCounts: { 'all': this.calculateSubCounts(data) }
      };
    }

    const result = {
      groups: {},
      totalCount: data.length,
      ungroupedCount: 0,
      groupCounts: {},
      subCounts: {}
    };

    // Group data by primary grouping fields
    const grouped = this.performGrouping(data, this.groupBy);
    
    // Special handling for category grouping to ensure proper order
    if (this.groupBy.length === 1 && this.groupBy[0] === 'category') {
      // Process groups in the desired order: 0 (Uncategorized), 3 (Important), 2 (Save Later), 1 (Can Close)
      const categoryOrder = ['0', '3', '2', '1'];
      
      for (const groupKey of categoryOrder) {
        if (grouped[groupKey]) {
          result.groups[groupKey] = grouped[groupKey];
          result.groupCounts[groupKey] = grouped[groupKey].length;
          result.subCounts[groupKey] = this.calculateSubCounts(grouped[groupKey]);
        }
      }
      
      // Handle any other groups that might exist (including __ungrouped__)
      for (const [groupKey, groupData] of Object.entries(grouped)) {
        if (!categoryOrder.includes(groupKey) && groupKey !== '__ungrouped__') {
          result.groups[groupKey] = groupData;
          result.groupCounts[groupKey] = groupData.length;
          result.subCounts[groupKey] = this.calculateSubCounts(groupData);
        }
      }
      
      // Handle ungrouped separately
      if (grouped['__ungrouped__']) {
        result.ungroupedCount = grouped['__ungrouped__'].length;
        if (this.includeUngrouped) {
          result.groups['Ungrouped'] = grouped['__ungrouped__'];
          result.groupCounts['Ungrouped'] = grouped['__ungrouped__'].length;
          result.subCounts['Ungrouped'] = this.calculateSubCounts(grouped['__ungrouped__']);
        }
      }
    } else {
      // Process each group normally for non-category groupings
      for (const [groupKey, groupData] of Object.entries(grouped)) {
        if (groupKey === '__ungrouped__') {
          result.ungroupedCount = groupData.length;
          if (this.includeUngrouped) {
            result.groups['Ungrouped'] = groupData;
            result.groupCounts['Ungrouped'] = groupData.length;
            result.subCounts['Ungrouped'] = this.calculateSubCounts(groupData);
          }
        } else {
          result.groups[groupKey] = groupData;
          result.groupCounts[groupKey] = groupData.length;
          result.subCounts[groupKey] = this.calculateSubCounts(groupData);
        }
      }
    }

    return result;
  }

  /**
   * Perform the actual grouping logic
   * @param {Array} data - Data to group
   * @param {Array} groupFields - Fields to group by
   * @returns {Object} Grouped data
   */
  performGrouping(data, groupFields) {
    const groups = {};

    for (const item of data) {
      const groupKey = this.generateGroupKey(item, groupFields);
      
      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }
      
      groups[groupKey].push(item);
    }

    return groups;
  }

  /**
   * Generate group key for an item
   * @param {Object} item - Data item
   * @param {Array} fields - Grouping fields
   * @returns {string} Group key
   */
  generateGroupKey(item, fields) {
    const keyParts = fields.map(field => {
      const value = this.extractFieldValue(item, field);
      // For category field, use the numeric value directly to preserve ordering
      if (field === 'category') {
        return value != null ? String(value) : null;
      }
      return this.formatGroupValue(value, field);
    });

    // Filter out null/undefined values
    const validParts = keyParts.filter(part => part !== null && part !== undefined);
    
    if (validParts.length === 0) {
      return '__ungrouped__';
    }

    return validParts.join(' | ');
  }

  /**
   * Format group value for display
   * @param {*} value - Field value
   * @param {string} field - Field name
   * @returns {string} Formatted value
   */
  formatGroupValue(value, field) {
    if (value == null) return null;

    // Handle special field formatting
    switch (field) {
      case 'category':
        return this.formatCategoryValue(value);
      case 'savedDate':
      case 'lastAccessed':
        return this.formatDateValue(value);
      case 'weekNumber':
      case 'lastAccessedWeekNumber':
        return value != null && !isNaN(value) ? `Week ${value}` : 'Ungrouped';
      case 'monthYear':
      case 'lastAccessedMonthYear':
        return value != null ? this.formatMonthYear(value) : 'Ungrouped';
      case 'yearQuarter':
      case 'lastAccessedYearQuarter':
        return value != null ? this.formatYearQuarter(value) : 'Ungrouped';
      case 'domain':
        return this.formatDomainValue(value);
      default:
        return String(value);
    }
  }

  /**
   * Format category value
   * @param {number} category - Category ID
   * @returns {string} Category name
   */
  formatCategoryValue(category) {
    const categoryNames = {
      0: 'Uncategorized',
      1: 'Ignore',
      2: 'Useful',
      3: 'Important'
    };
    return categoryNames[category] || `Category ${category}`;
  }

  /**
   * Format date value for grouping
   * @param {number|string|Date} date - Date value
   * @returns {string} Formatted date
   */
  formatDateValue(date) {
    try {
      const d = new Date(date);
      return d.toLocaleDateString();
    } catch {
      return 'Unknown Date';
    }
  }

  /**
   * Format month-year value
   * @param {string} monthYear - Month-year string (YYYY-MM)
   * @returns {string} Formatted month-year
   */
  formatMonthYear(monthYear) {
    try {
      const [year, month] = monthYear.split('-');
      const date = new Date(year, month - 1);
      return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
    } catch {
      return monthYear;
    }
  }

  /**
   * Format year-quarter value
   * @param {string} yearQuarter - Year-quarter string (YYYY-QN)
   * @returns {string} Formatted year-quarter
   */
  formatYearQuarter(yearQuarter) {
    try {
      const [year, quarter] = yearQuarter.split('-Q');
      return `${year} Q${quarter}`;
    } catch {
      return yearQuarter;
    }
  }

  /**
   * Format domain value
   * @param {string} domain - Domain name
   * @returns {string} Formatted domain
   */
  formatDomainValue(domain) {
    if (!domain || domain === 'unknown') {
      return 'Unknown Domain';
    }
    
    // Remove www. prefix for cleaner display
    return domain.replace(/^www\./, '');
  }

  /**
   * Calculate sub-counters for a group
   * @param {Array} groupData - Data in the group
   * @returns {Object} Sub-counters
   */
  calculateSubCounts(groupData) {
    const subCounts = {};

    for (const field of this.countBy) {
      subCounts[field] = this.countByField(groupData, field);
    }

    // Always include total count
    subCounts.total = groupData.length;

    return subCounts;
  }

  /**
   * Count items by field value
   * @param {Array} data - Data to count
   * @param {string} field - Field to count by
   * @returns {Object} Field value counts
   */
  countByField(data, field) {
    const counts = {};

    for (const item of data) {
      const value = this.extractFieldValue(item, field);
      const key = this.formatGroupValue(value, field) || 'Unknown';
      
      counts[key] = (counts[key] || 0) + 1;
    }

    return counts;
  }

  /**
   * Extract field value from item
   * @param {Object} item - Data item
   * @param {string} field - Field name
   * @returns {*} Field value
   */
  extractFieldValue(item, field) {
    return field.split('.').reduce((obj, key) => obj?.[key], item);
  }
}

/**
 * Predefined Grouping Configurations
 * Common grouping patterns for tabs
 */
export class TabGroupingConfigurations {
  /**
   * Group by category
   */
  static byCategory() {
    const service = new DataGroupingService();
    service.setGroupBy(['category']);
    service.setCountBy(['domain']);
    return service;
  }

  /**
   * Group by domain
   */
  static byDomain() {
    const service = new DataGroupingService();
    service.setGroupBy(['domain']);
    service.setCountBy(['category']);
    return service;
  }

  /**
   * Group by save date (for saved tabs)
   */
  static bySaveDate() {
    const service = new DataGroupingService();
    service.setGroupBy(['savedDate']);
    service.setCountBy(['category', 'domain']);
    return service;
  }

  /**
   * Group by month-year
   */
  static byMonthYear() {
    const service = new DataGroupingService();
    service.setGroupBy(['monthYear']);
    service.setCountBy(['category', 'domain']);
    return service;
  }

  /**
   * Group by week
   */
  static byWeek() {
    const service = new DataGroupingService();
    service.setGroupBy(['weekNumber']);
    service.setCountBy(['category', 'domain']);
    return service;
  }

  /**
   * Group by year-quarter
   */
  static byYearQuarter() {
    const service = new DataGroupingService();
    service.setGroupBy(['yearQuarter']);
    service.setCountBy(['category', 'domain']);
    return service;
  }

  /**
   * Group by window (for current tabs)
   */
  static byWindow() {
    const service = new DataGroupingService();
    service.setGroupBy(['windowId']);
    service.setCountBy(['category', 'domain']);
    return service;
  }

  /**
   * Group by category and domain (nested grouping)
   */
  static byCategoryAndDomain() {
    const service = new DataGroupingService();
    service.setGroupBy(['category', 'domain']);
    service.setCountBy(['lastAccessed']);
    return service;
  }

  /**
   * Group by domain and category (reversed nesting)
   */
  static byDomainAndCategory() {
    const service = new DataGroupingService();
    service.setGroupBy(['domain', 'category']);
    service.setCountBy(['lastAccessed']);
    return service;
  }

  /**
   * No grouping (all items in one group)
   */
  static none() {
    const service = new DataGroupingService();
    service.setGroupBy([]); // No grouping fields
    service.setCountBy(['category', 'domain']);
    return service;
  }
}

/**
 * Group Builder
 * Fluent interface for building complex grouping configurations
 */
export class GroupBuilder {
  constructor() {
    this.service = new DataGroupingService();
  }

  /**
   * Set grouping fields
   * @param {...string} fields - Field names
   * @returns {GroupBuilder} this for chaining
   */
  by(...fields) {
    this.service.setGroupBy(fields);
    return this;
  }

  /**
   * Set counting fields
   * @param {...string} fields - Field names
   * @returns {GroupBuilder} this for chaining
   */
  countBy(...fields) {
    this.service.setCountBy(fields);
    return this;
  }

  /**
   * Group by category
   * @returns {GroupBuilder} this for chaining
   */
  byCategory() {
    return this.by('category');
  }

  /**
   * Group by domain
   * @returns {GroupBuilder} this for chaining
   */
  byDomain() {
    return this.by('domain');
  }

  /**
   * Group by date field
   * @param {string} field - Date field name
   * @returns {GroupBuilder} this for chaining
   */
  byDate(field) {
    return this.by(field);
  }

  /**
   * Group by month
   * @returns {GroupBuilder} this for chaining
   */
  byMonth() {
    return this.by('monthYear');
  }

  /**
   * Group by week
   * @returns {GroupBuilder} this for chaining
   */
  byWeek() {
    return this.by('weekNumber');
  }

  /**
   * Group by quarter
   * @returns {GroupBuilder} this for chaining
   */
  byQuarter() {
    return this.by('yearQuarter');
  }

  /**
   * Include ungrouped items
   * @param {boolean} include - Whether to include ungrouped items
   * @returns {GroupBuilder} this for chaining
   */
  includeUngrouped(include = true) {
    this.service.setIncludeUngrouped(include);
    return this;
  }

  /**
   * Build the grouping service
   * @returns {DataGroupingService} Configured grouping service
   */
  build() {
    return this.service;
  }
}