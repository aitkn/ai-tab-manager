/*
 * AI Tab Manager - Copyright (c) 2025 AI Tech Knowledge LLC
 * Performance Test Runner - Quick console-based performance testing
 */

import { DataPerformanceTest } from '../services/DataPerformanceTest.js';

/**
 * Quick performance test runner for browser console
 */
class PerformanceTestRunner {
  constructor() {
    this.tester = new DataPerformanceTest();
  }

  /**
   * Run a quick test with common parameters
   * @param {number} size - Dataset size (default: 10000)
   * @param {boolean} useReal - Use real data (default: false)
   * @returns {Promise<Object>} - Test results
   */
  async quickTest(size = 10000, useReal = false) {
    console.log('🚀 Running quick performance test...');
    console.log(`📊 Dataset: ${size} records`);
    console.log(`📊 Data source: ${useReal ? 'Real IndexedDB' : 'Generated'}`);
    console.log('');
    
    const results = await this.tester.runComprehensiveTest(size, useReal);
    
    // Add memory usage estimate
    this.estimateMemoryUsage(size);
    
    return results;
  }

  /**
   * Run tests with multiple dataset sizes for scaling analysis
   * @param {Array} sizes - Array of sizes to test
   * @returns {Promise<Array>} - Array of results
   */
  async scalingTest(sizes = [1000, 5000, 10000]) {
    console.log('🔄 Running scaling analysis...');
    console.log(`📊 Testing sizes: [${sizes.join(', ')}]`);
    console.log('');
    
    const results = [];
    
    for (const size of sizes) {
      console.log(`\n🎯 Testing ${size} records...`);
      console.log('=' .repeat(40));
      
      const result = await this.tester.runComprehensiveTest(size, false);
      results.push({
        size: size,
        totalTime: result.metadata.totalTime,
        workflowTime: result.workflow.time,
        timePerRecord: result.metadata.totalTime / size,
        recordsPerSecond: size / (result.metadata.totalTime / 1000)
      });
      
      // Brief pause between tests
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Show scaling summary
    this.showScalingSummary(results);
    
    return results;
  }

  /**
   * Test specific operations in isolation
   * @param {number} size - Dataset size
   * @returns {Promise<Object>} - Isolated test results
   */
  async isolatedOperationsTest(size = 10000) {
    console.log('🔍 Testing isolated operations...');
    console.log(`📊 Dataset: ${size} records`);
    console.log('');
    
    // Generate test data
    const data = this.tester.generateTestData(size);
    
    // Test each operation separately
    const results = {
      dataGeneration: { time: 0, size: size },
      sorting: {},
      filtering: {},
      grouping: {},
      counting: {}
    };
    
    console.log('🔀 Testing sorting operations...');
    results.sorting.byDate = this.tester.testSort(data, 'savedDate');
    results.sorting.byTitle = this.tester.testSort(data, 'title');
    results.sorting.byDomain = this.tester.testSort(data, 'domain');
    
    console.log('\n🔍 Testing filtering operations...');
    results.filtering.category = this.tester.testFilter(data, { categories: [2, 3] });
    results.filtering.search = this.tester.testFilter(data, { searchQuery: 'javascript' });
    results.filtering.combined = this.tester.testFilter(data, { 
      categories: [2, 3], 
      searchQuery: 'react' 
    });
    
    console.log('\n📚 Testing grouping operations...');
    results.grouping.byDomain = this.tester.testGrouping(data, 'domain');
    results.grouping.byCategory = this.tester.testGrouping(data, 'category');
    results.grouping.byDate = this.tester.testGrouping(data, 'saveDate');
    
    console.log('\n🔢 Testing counting operations...');
    results.counting = this.tester.testCounting(data);
    
    this.showIsolatedSummary(results);
    
    return results;
  }

  /**
   * Test memory efficiency with large datasets
   * @param {number} maxSize - Maximum size to test
   * @returns {Promise<Object>} - Memory test results
   */
  async memoryTest(maxSize = 25000) {
    console.log('💾 Testing memory efficiency...');
    console.log(`📊 Max dataset: ${maxSize} records`);
    console.log('');
    
    const sizes = [1000, 5000, 10000, 15000, 20000, maxSize];
    const results = [];
    
    for (const size of sizes) {
      console.log(`🔄 Testing ${size} records...`);
      
      const startMemory = this.getMemoryUsage();
      const data = this.tester.generateTestData(size);
      const endMemory = this.getMemoryUsage();
      
      const memoryUsed = endMemory.usedJSHeapSize - startMemory.usedJSHeapSize;
      const bytesPerRecord = memoryUsed / size;
      
      results.push({
        size: size,
        memoryUsed: memoryUsed,
        bytesPerRecord: bytesPerRecord,
        totalHeapSize: endMemory.totalJSHeapSize,
        usedHeapSize: endMemory.usedJSHeapSize
      });
      
      console.log(`   Memory used: ${this.formatBytes(memoryUsed)}`);
      console.log(`   Bytes per record: ${bytesPerRecord.toFixed(2)}`);
      console.log(`   Total heap: ${this.formatBytes(endMemory.totalJSHeapSize)}`);
      console.log('');
      
      // Clear data to prevent accumulation
      data.length = 0;
      
      // Force garbage collection if available
      if (window.gc) {
        window.gc();
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    this.showMemorySummary(results);
    
    return results;
  }

  /**
   * Show scaling analysis summary
   * @param {Array} results - Scaling test results
   */
  showScalingSummary(results) {
    console.log('\n📈 SCALING ANALYSIS SUMMARY');
    console.log('==========================================');
    console.log('Size\t\tTotal Time\tWorkflow\tPer Record\tRec/Sec');
    console.log('----\t\t----------\t--------\t----------\t-------');
    
    results.forEach(r => {
      console.log(
        `${r.size.toString().padEnd(8)}\t` +
        `${r.totalTime.toFixed(1).padEnd(8)}ms\t` +
        `${r.workflowTime.toFixed(1).padEnd(6)}ms\t` +
        `${r.timePerRecord.toFixed(4)}ms\t` +
        `${r.recordsPerSecond.toFixed(0)}`
      );
    });
    
    // Calculate scaling factor
    if (results.length >= 2) {
      const first = results[0];
      const last = results[results.length - 1];
      const sizeMultiplier = last.size / first.size;
      const timeMultiplier = last.totalTime / first.totalTime;
      const efficiency = sizeMultiplier / timeMultiplier;
      
      console.log('\n📊 Scaling Efficiency:');
      console.log(`   Size increased: ${sizeMultiplier.toFixed(1)}x`);
      console.log(`   Time increased: ${timeMultiplier.toFixed(1)}x`);
      console.log(`   Efficiency ratio: ${efficiency.toFixed(2)} (1.0 = perfect linear scaling)`);
      
      if (efficiency > 0.8) {
        console.log('   ✅ Excellent scaling - nearly linear performance');
      } else if (efficiency > 0.6) {
        console.log('   ✅ Good scaling - performance degrades slowly');
      } else if (efficiency > 0.4) {
        console.log('   ⚠️  Fair scaling - some performance degradation');
      } else {
        console.log('   ❌ Poor scaling - significant performance degradation');
      }
    }
  }

  /**
   * Show isolated operations summary
   * @param {Object} results - Isolated test results
   */
  showIsolatedSummary(results) {
    console.log('\n🎯 ISOLATED OPERATIONS SUMMARY');
    console.log('==========================================');
    
    console.log('🔀 Sorting Performance:');
    Object.entries(results.sorting).forEach(([type, result]) => {
      console.log(`   ${type.padEnd(12)}: ${result.time.toFixed(2)}ms`);
    });
    
    console.log('\n🔍 Filtering Performance:');
    Object.entries(results.filtering).forEach(([type, result]) => {
      const reduction = result.reductionPercent || 0;
      console.log(`   ${type.padEnd(12)}: ${result.time.toFixed(2)}ms (${reduction}% filtered out)`);
    });
    
    console.log('\n📚 Grouping Performance:');
    Object.entries(results.grouping).forEach(([type, result]) => {
      console.log(`   ${type.padEnd(12)}: ${result.time.toFixed(2)}ms (${result.totalGroups} groups)`);
    });
    
    console.log(`\n🔢 Counting Performance: ${results.counting.time.toFixed(2)}ms`);
  }

  /**
   * Show memory usage summary
   * @param {Array} results - Memory test results
   */
  showMemorySummary(results) {
    console.log('\n💾 MEMORY USAGE SUMMARY');
    console.log('==========================================');
    console.log('Size\t\tMemory Used\tBytes/Record\tTotal Heap');
    console.log('----\t\t-----------\t------------\t----------');
    
    results.forEach(r => {
      console.log(
        `${r.size.toString().padEnd(8)}\t` +
        `${this.formatBytes(r.memoryUsed).padEnd(10)}\t` +
        `${r.bytesPerRecord.toFixed(0).padEnd(10)}\t` +
        `${this.formatBytes(r.totalHeapSize)}`
      );
    });
    
    // Calculate average bytes per record
    const avgBytesPerRecord = results.reduce((sum, r) => sum + r.bytesPerRecord, 0) / results.length;
    const maxSize = Math.max(...results.map(r => r.size));
    const estimatedMemory = avgBytesPerRecord * maxSize;
    
    console.log('\n📊 Memory Analysis:');
    console.log(`   Average bytes per record: ${avgBytesPerRecord.toFixed(0)}`);
    console.log(`   Estimated memory for ${maxSize} records: ${this.formatBytes(estimatedMemory)}`);
    
    // Memory efficiency assessment
    if (avgBytesPerRecord < 1000) {
      console.log('   ✅ Excellent memory efficiency');
    } else if (avgBytesPerRecord < 2000) {
      console.log('   ✅ Good memory efficiency');
    } else if (avgBytesPerRecord < 5000) {
      console.log('   ⚠️  Fair memory efficiency');
    } else {
      console.log('   ❌ Poor memory efficiency - consider optimization');
    }
  }

  /**
   * Estimate memory usage for a given dataset size
   * @param {number} size - Dataset size
   */
  estimateMemoryUsage(size) {
    const avgBytesPerRecord = 800; // Rough estimate based on our data structure
    const estimatedMemory = size * avgBytesPerRecord;
    
    console.log('\n💾 MEMORY ESTIMATION:');
    console.log(`   Estimated memory for ${size} records: ${this.formatBytes(estimatedMemory)}`);
    console.log(`   Chrome extension popup limit: ~10MB`);
    
    if (estimatedMemory < 5 * 1024 * 1024) { // 5MB
      console.log('   ✅ Well within memory limits');
    } else if (estimatedMemory < 10 * 1024 * 1024) { // 10MB
      console.log('   ⚠️  Approaching memory limits - monitor usage');
    } else {
      console.log('   ❌ May exceed popup memory limits - optimization needed');
    }
  }

  /**
   * Get current memory usage (if available)
   * @returns {Object} - Memory usage info
   */
  getMemoryUsage() {
    if (performance.memory) {
      return {
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
      };
    }
    return { usedJSHeapSize: 0, totalJSHeapSize: 0, jsHeapSizeLimit: 0 };
  }

  /**
   * Format bytes into human readable format
   * @param {number} bytes - Bytes
   * @returns {string} - Formatted string
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
}

// Export and make globally available
export const performanceRunner = new PerformanceTestRunner();

// Make available in browser console
if (typeof window !== 'undefined') {
  window.performanceRunner = performanceRunner;
  window.quickTest = (size, useReal) => performanceRunner.quickTest(size, useReal);
  window.scalingTest = (sizes) => performanceRunner.scalingTest(sizes);
  window.isolatedTest = (size) => performanceRunner.isolatedOperationsTest(size);
  window.memoryTest = (maxSize) => performanceRunner.memoryTest(maxSize);
  
  console.log('🎯 Performance Test Runner loaded!');
  console.log('📊 Available console commands:');
  console.log('   quickTest(size, useReal) - Quick test with specified size');
  console.log('   scalingTest([sizes]) - Test multiple sizes for scaling analysis');
  console.log('   isolatedTest(size) - Test individual operations');
  console.log('   memoryTest(maxSize) - Test memory usage patterns');
  console.log('');
  console.log('🚀 Example: quickTest(10000) - Test with 10,000 records');
}

export default PerformanceTestRunner;