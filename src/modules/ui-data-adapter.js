/*
 * AI Tab Manager - UI Data Adapter
 * Adapts processed data for UI rendering components
 */

import { CATEGORY_NAMES } from '../utils/constants.js';

/**
 * UI Data Adapter
 * Converts processed data from DataManager into UI-ready formats
 */
export class UIDataAdapter {
  constructor() {
    this.formatters = new Map();
    this.setupDefaultFormatters();
  }

  /**
   * Setup default data formatters
   */
  setupDefaultFormatters() {
    // Category formatter
    this.formatters.set('category', (categoryId) => {
      return CATEGORY_NAMES[categoryId] || `Category ${categoryId}`;
    });

    // Domain formatter
    this.formatters.set('domain', (domain) => {
      if (!domain || domain === 'unknown') return 'Unknown Domain';
      return domain.replace(/^www\./, '');
    });

    // Date formatter
    this.formatters.set('date', (date) => {
      try {
        return new Date(date).toLocaleDateString();
      } catch {
        return 'Unknown Date';
      }
    });

    // Time formatter
    this.formatters.set('time', (date) => {
      try {
        return new Date(date).toLocaleString();
      } catch {
        return 'Unknown Time';
      }
    });

    // Relative time formatter
    this.formatters.set('relativeTime', (date) => {
      try {
        const now = new Date();
        const then = new Date(date);
        const diffMs = now - then;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return this.formatters.get('date')(date);
      } catch {
        return 'Unknown Time';
      }
    });
  }

  /**
   * Add custom formatter
   * @param {string} name - Formatter name
   * @param {Function} formatter - Formatter function
   */
  addFormatter(name, formatter) {
    this.formatters.set(name, formatter);
  }

  /**
   * Format value using specified formatter
   * @param {*} value - Value to format
   * @param {string} formatter - Formatter name
   * @returns {string} Formatted value
   */
  format(value, formatter) {
    const formatterFn = this.formatters.get(formatter);
    if (!formatterFn) {
      return String(value);
    }

    try {
      return formatterFn(value);
    } catch (error) {
      console.warn(`Error formatting value with ${formatter}:`, error);
      return String(value);
    }
  }

  /**
   * Convert processed data to UI-ready format
   * @param {Object} processedData - Data from DataManager
   * @param {Object} options - Rendering options
   * @returns {Object} UI-ready data structure
   */
  adaptForUI(processedData, options = {}) {
    const {
      showCounters = true,
      showMetadata = false,
      formatDates = true,
      formatDomains = true,
      includeExpandableInfo = true
    } = options;

    const { groups, groupCounts, subCounts, pagination, metadata } = processedData;

    const adapted = {
      sections: [],
      summary: {
        totalGroups: metadata.counts.totalGroups,
        visibleGroups: metadata.counts.visibleGroups,
        totalItems: metadata.counts.filtered,
        filteredFromTotal: metadata.counts.raw
      },
      pagination: {
        ...pagination,
        canShowMore: pagination.hasMoreGroups || Object.values(pagination.hasMoreItems).some(Boolean)
      }
    };

    // Convert groups to UI sections
    // First collect all sections
    const sectionsToSort = [];
    
    // Special handling for category grouping to ensure proper order
    let groupEntries;
    if (metadata.grouping.fields.length === 1 && metadata.grouping.fields[0] === 'category') {
      // For categories, manually create entries in the correct order: 0, 3, 2, 1
      const categoryOrder = ['0', '3', '2', '1'];
      groupEntries = [];
      
      for (const key of categoryOrder) {
        if (groups[key]) {
          groupEntries.push([key, groups[key]]);
        }
      }
      
      // Add any other groups that aren't in the standard categories (like 'Ungrouped')
      for (const [key, value] of Object.entries(groups)) {
        if (!categoryOrder.includes(key)) {
          groupEntries.push([key, value]);
        }
      }
    } else {
      groupEntries = Object.entries(groups);
    }
    
    for (const [groupKey, groupItems] of groupEntries) {
      const section = {
        id: this.generateSectionId(groupKey),
        title: this.formatGroupTitle(groupKey, groupCounts[groupKey]),
        items: this.adaptItems(groupItems, { formatDates, formatDomains }),
        counters: showCounters ? this.adaptCounters(subCounts[groupKey]) : null,
        expandable: includeExpandableInfo ? {
          hasMore: pagination.hasMoreItems[groupKey] || false,
          totalCount: groupCounts[groupKey],
          visibleCount: groupItems.length,
          hiddenCount: Math.max(0, groupCounts[groupKey] - groupItems.length)
        } : null,
        groupKey: groupKey // Keep original key for sorting
      };

      sectionsToSort.push(section);
    }
    
    // Sort sections based on grouping type
    adapted.sections = this.sortSections(sectionsToSort, metadata.grouping);

    // Include metadata if requested
    if (showMetadata) {
      adapted.metadata = {
        processingTime: metadata.processingTime,
        sourceId: metadata.sourceId,
        timestamp: metadata.timestamp,
        filters: metadata.filters,
        sorting: metadata.sorting,
        grouping: metadata.grouping
      };
    }

    return adapted;
  }

  /**
   * Generate section ID from group key
   * @param {string} groupKey - Group key
   * @returns {string} Section ID
   */
  generateSectionId(groupKey) {
    return groupKey.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /**
   * Format group title with count
   * @param {string} groupKey - Group key
   * @param {number} count - Item count
   * @returns {string} Formatted title
   */
  formatGroupTitle(groupKey, count) {
    let title = groupKey;

    // Apply special formatting for known group types
    if (groupKey.match(/^\d+$/)) {
      // Numeric category
      title = this.format(parseInt(groupKey), 'category');
    } else if (groupKey.includes('.')) {
      // Domain
      title = this.format(groupKey, 'domain');
    } else if (groupKey.match(/^\d{4}-\d{2}$/)) {
      // Month-year format
      title = this.formatMonthYear(groupKey);
    } else if (groupKey.match(/^\d{4}-Q\d$/)) {
      // Year-quarter format
      title = groupKey; // Already formatted
    }

    return `${title} ( ${count} )`;
  }

  /**
   * Format month-year string
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
   * Adapt items for UI rendering
   * @param {Array} items - Raw items
   * @param {Object} options - Formatting options
   * @returns {Array} UI-ready items
   */
  adaptItems(items, options = {}) {
    const { formatDates = true, formatDomains = true } = options;

    return items.map(item => {
      const adapted = { ...item };

      // Format dates
      if (formatDates) {
        if (adapted.savedDate) {
          adapted.savedDateFormatted = this.format(adapted.savedDate, 'date');
          adapted.savedDateRelative = this.format(adapted.savedDate, 'relativeTime');
        }
        if (adapted.lastAccessed) {
          adapted.lastAccessedFormatted = this.format(adapted.lastAccessed, 'date');
          adapted.lastAccessedRelative = this.format(adapted.lastAccessed, 'relativeTime');
        }
      }

      // Format domains
      if (formatDomains && adapted.domain) {
        adapted.domainFormatted = this.format(adapted.domain, 'domain');
      }

      // Format category
      if (adapted.category !== undefined) {
        adapted.categoryFormatted = this.format(adapted.category, 'category');
      }

      // Add UI-specific properties
      adapted.displayTitle = this.truncateTitle(adapted.title);
      adapted.displayUrl = this.truncateUrl(adapted.url);
      adapted.isDuplicate = adapted.duplicateIds && adapted.duplicateIds.length > 0;
      adapted.duplicateCount = adapted.duplicateIds ? adapted.duplicateIds.length : 0;

      return adapted;
    });
  }

  /**
   * Adapt counters for UI display
   * @param {Object} subCounts - Sub-counters object
   * @returns {Array} UI-ready counters
   */
  adaptCounters(subCounts) {
    if (!subCounts) return [];

    const counters = [];

    for (const [field, counts] of Object.entries(subCounts)) {
      if (field === 'total') continue; // Skip total, it's shown elsewhere

      const counter = {
        type: field,
        label: this.getCounterLabel(field),
        items: []
      };

      for (const [value, count] of Object.entries(counts)) {
        counter.items.push({
          name: this.formatCounterValue(value, field),
          count: count,
          percentage: this.calculatePercentage(count, subCounts.total)
        });
      }

      // Sort by count descending
      counter.items.sort((a, b) => b.count - a.count);

      counters.push(counter);
    }

    return counters;
  }

  /**
   * Get counter label for field
   * @param {string} field - Field name
   * @returns {string} Human-readable label
   */
  getCounterLabel(field) {
    const labels = {
      category: 'Categories',
      domain: 'Domains',
      lastAccessed: 'Last Accessed',
      windowId: 'Windows'
    };
    return labels[field] || field;
  }

  /**
   * Format counter value
   * @param {*} value - Counter value
   * @param {string} field - Field name
   * @returns {string} Formatted value
   */
  formatCounterValue(value, field) {
    switch (field) {
      case 'category':
        return this.format(value, 'category');
      case 'domain':
        return this.format(value, 'domain');
      default:
        return String(value);
    }
  }

  /**
   * Calculate percentage
   * @param {number} value - Value
   * @param {number} total - Total
   * @returns {number} Percentage (0-100)
   */
  calculatePercentage(value, total) {
    if (!total || total === 0) return 0;
    return Math.round((value / total) * 100);
  }

  /**
   * Truncate title for display
   * @param {string} title - Original title
   * @param {number} maxLength - Maximum length
   * @returns {string} Truncated title
   */
  truncateTitle(title, maxLength = 60) {
    if (!title || title.length <= maxLength) return title;
    return title.substring(0, maxLength - 3) + '...';
  }

  /**
   * Truncate URL for display
   * @param {string} url - Original URL
   * @param {number} maxLength - Maximum length
   * @returns {string} Truncated URL
   */
  truncateUrl(url, maxLength = 80) {
    if (!url || url.length <= maxLength) return url;
    
    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname;
      const path = urlObj.pathname + urlObj.search;
      
      if (domain.length + path.length <= maxLength) {
        return url;
      }
      
      const availablePathLength = maxLength - domain.length - 6; // Account for protocol and ellipsis
      if (availablePathLength > 10) {
        return `${domain}${path.substring(0, availablePathLength)}...`;
      } else {
        return `${domain}/...`;
      }
    } catch {
      return url.substring(0, maxLength - 3) + '...';
    }
  }

  /**
   * Sort sections based on grouping type
   * @param {Array} sections - Sections to sort
   * @param {Object} groupingMetadata - Grouping metadata from data manager
   * @returns {Array} Sorted sections
   */
  sortSections(sections) {
    // All sorting is now handled in DataAggregationService before limiting
    // This ensures consistent ordering when "Show more groups" is clicked
    // Just return sections in the order they were provided
    return sections;
  }

  /**
   * Create empty UI data structure
   * @returns {Object} Empty UI data
   */
  createEmptyData() {
    return {
      sections: [],
      summary: {
        totalGroups: 0,
        visibleGroups: 0,
        totalItems: 0,
        filteredFromTotal: 0
      },
      pagination: {
        hasMoreGroups: false,
        hasMoreItems: {},
        canShowMore: false
      }
    };
  }

  /**
   * Merge multiple UI data structures
   * @param {Array<Object>} dataStructures - UI data structures to merge
   * @returns {Object} Merged UI data
   */
  mergeUIData(dataStructures) {
    if (!dataStructures || dataStructures.length === 0) {
      return this.createEmptyData();
    }

    if (dataStructures.length === 1) {
      return dataStructures[0];
    }

    const merged = {
      sections: [],
      summary: {
        totalGroups: 0,
        visibleGroups: 0,
        totalItems: 0,
        filteredFromTotal: 0
      },
      pagination: {
        hasMoreGroups: false,
        hasMoreItems: {},
        canShowMore: false
      }
    };

    // Merge sections and summaries
    for (const data of dataStructures) {
      merged.sections.push(...data.sections);
      merged.summary.totalGroups += data.summary.totalGroups;
      merged.summary.visibleGroups += data.summary.visibleGroups;
      merged.summary.totalItems += data.summary.totalItems;
      merged.summary.filteredFromTotal += data.summary.filteredFromTotal;

      // Merge pagination info
      merged.pagination.hasMoreGroups = merged.pagination.hasMoreGroups || data.pagination.hasMoreGroups;
      Object.assign(merged.pagination.hasMoreItems, data.pagination.hasMoreItems);
      merged.pagination.canShowMore = merged.pagination.canShowMore || data.pagination.canShowMore;
    }

    return merged;
  }
}

// Create singleton instance
export const uiDataAdapter = new UIDataAdapter();