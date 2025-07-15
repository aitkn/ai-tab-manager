/*
 * AI Tab Manager - Copyright (c) 2025 AI Tech Knowledge LLC
 * Data Performance Test Module - Measures actual performance with large datasets
 */

import { TAB_CATEGORIES } from '../utils/constants.js';

/**
 * Performance testing module for data operations
 */
export class DataPerformanceTest {
  constructor() {
    this.testData = [];
    this.results = {};
  }

  /**
   * Generate test data that mimics real saved tabs
   * @param {number} count - Number of test records to generate
   * @returns {Array} - Generated test data
   */
  generateTestData(count = 10000) {
    console.log(`🔄 Generating ${count} test records...`);
    const start = performance.now();
    
    const testData = [];
    const domains = [
      'google.com', 'github.com', 'stackoverflow.com', 'reddit.com', 'youtube.com',
      'amazon.com', 'facebook.com', 'twitter.com', 'linkedin.com', 'microsoft.com',
      'apple.com', 'netflix.com', 'wikipedia.org', 'medium.com', 'dev.to',
      'news.ycombinator.com', 'techcrunch.com', 'vercel.com', 'netlify.com', 'cloudflare.com'
    ];
    
    const titlePrefixes = [
      'How to', 'Best practices for', 'Complete guide to', 'Understanding', 'Introduction to',
      'Advanced', 'Tutorial:', 'Tips for', 'Common mistakes in', 'Debugging',
      'Performance optimization', 'Security in', 'Testing', 'Deploy', 'Configure'
    ];
    
    const titleSuffixes = [
      'React development', 'JavaScript performance', 'CSS animations', 'Node.js APIs',
      'database design', 'authentication', 'deployment strategies', 'testing frameworks',
      'monitoring tools', 'CI/CD pipelines', 'microservices', 'API design', 'data structures',
      'algorithms', 'machine learning', 'cloud computing', 'DevOps', 'security practices'
    ];
    
    for (let i = 0; i < count; i++) {
      const domain = domains[Math.floor(Math.random() * domains.length)];
      const titlePrefix = titlePrefixes[Math.floor(Math.random() * titlePrefixes.length)];
      const titleSuffix = titleSuffixes[Math.floor(Math.random() * titleSuffixes.length)];
      const path = Math.random().toString(36).substring(2, 15);
      
      // Realistic category distribution
      let category;
      const rand = Math.random();
      if (rand < 0.05) category = TAB_CATEGORIES.UNCATEGORIZED;      // 5%
      else if (rand < 0.25) category = TAB_CATEGORIES.CAN_CLOSE;     // 20%
      else if (rand < 0.70) category = TAB_CATEGORIES.SAVE_LATER;    // 45%
      else category = TAB_CATEGORIES.IMPORTANT;                      // 30%
      
      const baseDate = new Date('2024-01-01');
      const randomDays = Math.floor(Math.random() * 365);
      const savedDate = new Date(baseDate.getTime() + randomDays * 24 * 60 * 60 * 1000);
      
      testData.push({
        id: i + 1,
        url: `https://${domain}/${path}`,
        title: `${titlePrefix} ${titleSuffix} - ${domain}`,
        domain: domain,
        category: category,
        savedDate: savedDate.toISOString(),
        firstSeen: savedDate.toISOString(),
        lastCategorized: savedDate.toISOString(),
        favicon: `https://www.google.com/s2/favicons?domain=${domain}&sz=16`
      });
    }
    
    const elapsed = performance.now() - start;
    console.log(`✅ Generated ${count} records in ${elapsed.toFixed(2)}ms`);
    
    this.testData = testData;
    return testData;
  }

  /**
   * Load data from actual IndexedDB for real-world testing
   * @returns {Array} - Real saved tabs data
   */
  async loadRealData() {
    console.log('🔄 Loading real data from IndexedDB...');
    const start = performance.now();
    
    try {
      if (!window.tabDatabase) {
        console.warn('⚠️ No tabDatabase available, using test data instead');
        return this.generateTestData(1000);
      }
      
      const realData = await window.tabDatabase.getSavedUrls([1, 2, 3]);
      const elapsed = performance.now() - start;
      
      console.log(`✅ Loaded ${realData.length} real records in ${elapsed.toFixed(2)}ms`);
      this.testData = realData;
      return realData;
    } catch (error) {
      console.error('❌ Error loading real data:', error);
      console.log('🔄 Falling back to test data...');
      return this.generateTestData(1000);
    }
  }

  /**
   * Test sorting performance
   * @param {Array} data - Data to sort
   * @param {string} sortBy - Field to sort by
   * @returns {Object} - Sort results and timing
   */
  testSort(data, sortBy = 'savedDate') {
    console.log(`🔄 Testing sort by '${sortBy}' on ${data.length} records...`);
    const start = performance.now();
    
    const sortedData = [...data].sort((a, b) => {
      switch (sortBy) {
        case 'savedDate':
        case 'lastCategorized':
          return new Date(b[sortBy]) - new Date(a[sortBy]); // Newest first
        case 'title':
        case 'domain':
          return a[sortBy].localeCompare(b[sortBy]);
        case 'category':
          return b.category - a.category; // Important first
        default:
          return 0;
      }
    });
    
    const elapsed = performance.now() - start;
    console.log(`✅ Sorted ${data.length} records in ${elapsed.toFixed(2)}ms`);
    
    return {
      data: sortedData,
      time: elapsed,
      count: sortedData.length
    };
  }

  /**
   * Test filtering performance
   * @param {Array} data - Data to filter
   * @param {Object} filters - Filter criteria
   * @returns {Object} - Filter results and timing
   */
  testFilter(data, filters = {}) {
    const { categories = [2, 3], searchQuery = '', domains = [] } = filters;
    
    console.log(`🔄 Testing filter on ${data.length} records...`);
    console.log(`   Categories: [${categories.join(', ')}]`);
    console.log(`   Search: "${searchQuery}"`);
    console.log(`   Domains: [${domains.join(', ')}]`);
    
    const start = performance.now();
    
    const filteredData = data.filter(item => {
      // Category filter
      if (categories.length > 0 && !categories.includes(item.category)) {
        return false;
      }
      
      // Domain filter
      if (domains.length > 0 && !domains.includes(item.domain)) {
        return false;
      }
      
      // Search query filter
      if (searchQuery) {
        const searchText = [
          item.title || '',
          item.url || '',
          item.domain || ''
        ].join(' ').toLowerCase();
        
        if (!searchText.includes(searchQuery.toLowerCase())) {
          return false;
        }
      }
      
      return true;
    });
    
    const elapsed = performance.now() - start;
    console.log(`✅ Filtered ${data.length} → ${filteredData.length} records in ${elapsed.toFixed(2)}ms`);
    
    return {
      data: filteredData,
      time: elapsed,
      originalCount: data.length,
      filteredCount: filteredData.length,
      reductionPercent: ((data.length - filteredData.length) / data.length * 100).toFixed(1)
    };
  }

  /**
   * Test grouping performance
   * @param {Array} data - Data to group
   * @param {string} groupBy - Field to group by
   * @returns {Object} - Grouping results and timing
   */
  testGrouping(data, groupBy = 'domain') {
    console.log(`🔄 Testing grouping by '${groupBy}' on ${data.length} records...`);
    const start = performance.now();
    
    const groups = {};
    const groupCounts = {};
    
    data.forEach(item => {
      let groupKey;
      
      switch (groupBy) {
        case 'domain':
          groupKey = item.domain;
          break;
        case 'category':
          groupKey = this.getCategoryName(item.category);
          break;
        case 'saveDate':
          groupKey = item.savedDate ? item.savedDate.split('T')[0] : 'No Date';
          break;
        case 'saveMonth':
          if (item.savedDate) {
            const date = new Date(item.savedDate);
            groupKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          } else {
            groupKey = 'No Date';
          }
          break;
        default:
          groupKey = 'Unknown';
      }
      
      if (!groups[groupKey]) {
        groups[groupKey] = [];
        groupCounts[groupKey] = 0;
      }
      
      groups[groupKey].push(item);
      groupCounts[groupKey]++;
    });
    
    const elapsed = performance.now() - start;
    const groupCount = Object.keys(groups).length;
    
    console.log(`✅ Grouped ${data.length} records into ${groupCount} groups in ${elapsed.toFixed(2)}ms`);
    
    // Show top 10 groups by size
    const topGroups = Object.entries(groupCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    
    console.log('📊 Top groups:');
    topGroups.forEach(([group, count], index) => {
      console.log(`   ${index + 1}. ${group}: ${count} items`);
    });
    
    return {
      groups: groups,
      groupCounts: groupCounts,
      time: elapsed,
      totalGroups: groupCount,
      totalItems: data.length,
      topGroups: topGroups
    };
  }

  /**
   * Test count calculation performance
   * @param {Array} data - Data to count
   * @returns {Object} - Count results and timing
   */
  testCounting(data) {
    console.log(`🔄 Testing count calculations on ${data.length} records...`);
    const start = performance.now();
    
    const counts = {
      total: data.length,
      byCategory: {},
      byDomain: {},
      bySaveDate: {},
      byMonth: {}
    };
    
    data.forEach(item => {
      // Category counts
      const category = item.category;
      counts.byCategory[category] = (counts.byCategory[category] || 0) + 1;
      
      // Domain counts
      const domain = item.domain;
      counts.byDomain[domain] = (counts.byDomain[domain] || 0) + 1;
      
      // Date counts
      if (item.savedDate) {
        const saveDate = item.savedDate.split('T')[0];
        counts.bySaveDate[saveDate] = (counts.bySaveDate[saveDate] || 0) + 1;
        
        const date = new Date(item.savedDate);
        const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        counts.byMonth[month] = (counts.byMonth[month] || 0) + 1;
      }
    });
    
    const elapsed = performance.now() - start;
    
    console.log(`✅ Calculated counts for ${data.length} records in ${elapsed.toFixed(2)}ms`);
    console.log(`📊 Summary:`);
    console.log(`   Total: ${counts.total}`);
    console.log(`   Categories: ${Object.keys(counts.byCategory).length}`);
    console.log(`   Domains: ${Object.keys(counts.byDomain).length}`);
    console.log(`   Unique dates: ${Object.keys(counts.bySaveDate).length}`);
    console.log(`   Unique months: ${Object.keys(counts.byMonth).length}`);
    
    return {
      counts: counts,
      time: elapsed,
      totalRecords: data.length
    };
  }

  /**
   * Run comprehensive performance test suite
   * @param {number} dataSize - Size of test dataset
   * @param {boolean} useRealData - Whether to use real data instead of generated
   * @returns {Object} - Complete test results
   */
  async runComprehensiveTest(dataSize = 10000, useRealData = false) {
    console.log('🚀 Starting comprehensive performance test...');
    console.log(`📊 Dataset size: ${dataSize}`);
    console.log(`📊 Using real data: ${useRealData}`);
    
    const overallStart = performance.now();
    
    // 1. Load/Generate data
    const data = useRealData ? 
      await this.loadRealData() : 
      this.generateTestData(dataSize);
    
    // 2. Test sorting
    const sortResults = {
      byDate: this.testSort(data, 'savedDate'),
      byTitle: this.testSort(data, 'title'),
      byDomain: this.testSort(data, 'domain'),
      byCategory: this.testSort(data, 'category')
    };
    
    // 3. Test filtering
    const filterResults = {
      categoryFilter: this.testFilter(data, { categories: [2, 3] }),
      searchFilter: this.testFilter(data, { searchQuery: 'javascript' }),
      domainFilter: this.testFilter(data, { domains: ['github.com', 'stackoverflow.com'] }),
      combinedFilter: this.testFilter(data, { 
        categories: [2, 3], 
        searchQuery: 'react',
        domains: ['github.com']
      })
    };
    
    // 4. Test grouping
    const groupResults = {
      byDomain: this.testGrouping(data, 'domain'),
      byCategory: this.testGrouping(data, 'category'),
      bySaveDate: this.testGrouping(data, 'saveDate'),
      bySaveMonth: this.testGrouping(data, 'saveMonth')
    };
    
    // 5. Test counting
    const countResults = this.testCounting(data);
    
    // 6. Test combined operations (realistic workflow)
    console.log('🔄 Testing combined operations (realistic workflow)...');
    const workflowStart = performance.now();
    
    const sortedData = this.testSort(data, 'savedDate').data;
    const filteredData = this.testFilter(sortedData, { categories: [2, 3], searchQuery: 'javascript' }).data;
    this.testGrouping(filteredData, 'domain');
    this.testCounting(filteredData);
    
    const workflowTime = performance.now() - workflowStart;
    console.log(`✅ Complete workflow completed in ${workflowTime.toFixed(2)}ms`);
    
    const overallTime = performance.now() - overallStart;
    
    // Compile final results
    const results = {
      metadata: {
        dataSize: data.length,
        useRealData: useRealData,
        totalTime: overallTime,
        timestamp: new Date().toISOString()
      },
      sorting: sortResults,
      filtering: filterResults,
      grouping: groupResults,
      counting: countResults,
      workflow: {
        time: workflowTime,
        steps: {
          sort: 'savedDate',
          filter: 'categories [2,3] + search "javascript"',
          group: 'domain',
          count: 'all dimensions'
        },
        finalDataSize: filteredData.length
      }
    };
    
    this.results = results;
    this.printSummary();
    
    return results;
  }

  /**
   * Print performance summary
   */
  printSummary() {
    if (!this.results) {
      console.log('❌ No test results available');
      return;
    }
    
    const r = this.results;
    
    console.log('\n🎯 PERFORMANCE SUMMARY');
    console.log('==========================================');
    console.log(`📊 Dataset: ${r.metadata.dataSize} records`);
    console.log(`⏱️  Total time: ${r.metadata.totalTime.toFixed(2)}ms`);
    console.log('');
    
    console.log('🔀 SORTING PERFORMANCE:');
    Object.entries(r.sorting).forEach(([type, result]) => {
      console.log(`   ${type}: ${result.time.toFixed(2)}ms`);
    });
    console.log('');
    
    console.log('🔍 FILTERING PERFORMANCE:');
    Object.entries(r.filtering).forEach(([type, result]) => {
      console.log(`   ${type}: ${result.time.toFixed(2)}ms (${result.originalCount} → ${result.filteredCount})`);
    });
    console.log('');
    
    console.log('📚 GROUPING PERFORMANCE:');
    Object.entries(r.grouping).forEach(([type, result]) => {
      console.log(`   ${type}: ${result.time.toFixed(2)}ms (${result.totalGroups} groups)`);
    });
    console.log('');
    
    console.log(`🔢 COUNTING PERFORMANCE: ${r.counting.time.toFixed(2)}ms`);
    console.log('');
    
    console.log(`🔄 WORKFLOW PERFORMANCE: ${r.workflow.time.toFixed(2)}ms`);
    console.log(`   (Sort → Filter → Group → Count)`);
    console.log('');
    
    // Performance assessment
    const avgTime = r.metadata.totalTime / r.metadata.dataSize;
    console.log('📈 PERFORMANCE ASSESSMENT:');
    console.log(`   Average time per record: ${avgTime.toFixed(4)}ms`);
    
    if (avgTime < 0.01) {
      console.log('   ✅ EXCELLENT - Very fast operations');
    } else if (avgTime < 0.05) {
      console.log('   ✅ GOOD - Acceptable performance');
    } else if (avgTime < 0.1) {
      console.log('   ⚠️  FAIR - May need optimization for larger datasets');
    } else {
      console.log('   ❌ POOR - Optimization required');
    }
  }

  /**
   * Get category name for grouping
   * @param {number} category - Category number
   * @returns {string} - Category name
   */
  getCategoryName(category) {
    switch (category) {
      case TAB_CATEGORIES.UNCATEGORIZED: return 'Uncategorized';
      case TAB_CATEGORIES.CAN_CLOSE: return 'Can Close';
      case TAB_CATEGORIES.SAVE_LATER: return 'Save Later';
      case TAB_CATEGORIES.IMPORTANT: return 'Important';
      default: return 'Unknown';
    }
  }
}

// Export for testing
export default DataPerformanceTest;