/*
 * AI Tab Manager - Data Generator
 * Handles data preparation and augmentation for training
 * 
 * DEPRECATED: The splitData() method from this file has been extracted and
 * enhanced in random-data-generator.js. This file contains generic data
 * manipulation utilities that may still be useful, but the main splitting
 * logic has been moved.
 * 
 * Consider consolidating useful utilities or removing if fully superseded.
 */

import { ML_CONFIG } from '../model-config.js';

/**
 * Data Generator for training
 */
export default class DataGenerator {
  constructor(data) {
    this.data = data;
    this.indices = Array.from({ length: data.length }, (_, i) => i);
  }
  
  /**
   * Split data into train and validation sets
   * @param {number} validationSplit - Fraction of data for validation
   * @returns {Object} Train and validation data
   */
  splitData(validationSplit = 0.2) {
    // Shuffle indices
    const shuffled = this.shuffle([...this.indices]);
    
    // Calculate split point
    const splitPoint = Math.floor(this.data.length * (1 - validationSplit));
    
    // Split indices
    const trainIndices = shuffled.slice(0, splitPoint);
    const validIndices = shuffled.slice(splitPoint);
    
    // Get data subsets
    const trainData = trainIndices.map(i => this.data[i]);
    const validData = validIndices.map(i => this.data[i]);
    
    return { trainData, validData };
  }
  
  /**
   * Balance classes by oversampling minority classes
   * @param {Array} data - Training data
   * @returns {Array} Balanced data
   */
  balanceClasses(data) {
    // Group by category
    const categorized = this.groupByCategory(data);
    
    // Find max class size
    const maxSize = Math.max(...Object.values(categorized).map(arr => arr.length));
    
    // Oversample minority classes
    const balanced = [];
    
    for (const [category, examples] of Object.entries(categorized)) {
      // Add all original examples
      balanced.push(...examples);
      
      // Oversample if needed
      const needed = maxSize - examples.length;
      if (needed > 0) {
        const oversampled = this.oversample(examples, needed);
        balanced.push(...oversampled);
      }
    }
    
    // Shuffle the balanced data
    return this.shuffle(balanced);
  }
  
  /**
   * Undersample majority classes
   * @param {Array} data - Training data
   * @param {number} maxSamplesPerClass - Maximum samples per class
   * @returns {Array} Undersampled data
   */
  undersampleClasses(data, maxSamplesPerClass = null) {
    const categorized = this.groupByCategory(data);
    
    // Find min class size if not specified
    if (!maxSamplesPerClass) {
      maxSamplesPerClass = Math.min(...Object.values(categorized).map(arr => arr.length));
    }
    
    const undersampled = [];
    
    for (const [category, examples] of Object.entries(categorized)) {
      const sampled = this.shuffle(examples).slice(0, maxSamplesPerClass);
      undersampled.push(...sampled);
    }
    
    return this.shuffle(undersampled);
  }
  
  /**
   * Group data by category
   */
  groupByCategory(data) {
    const groups = {};
    
    data.forEach(example => {
      const category = example.category;
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(example);
    });
    
    return groups;
  }
  
  /**
   * Oversample examples
   */
  oversample(examples, count) {
    const oversampled = [];
    
    for (let i = 0; i < count; i++) {
      const index = Math.floor(Math.random() * examples.length);
      const example = examples[index];
      
      // Create augmented version
      const augmented = this.augmentExample(example);
      oversampled.push(augmented);
    }
    
    return oversampled;
  }
  
  /**
   * Augment a training example
   */
  augmentExample(example) {
    // For now, just copy the example
    // In the future, we could add noise or variations
    return {
      ...example,
      augmented: true,
      augmentationType: 'copy'
    };
  }
  
  /**
   * Shuffle array
   */
  shuffle(array) {
    const shuffled = [...array];
    
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    
    return shuffled;
  }
  
  /**
   * Generate batches for training
   * @param {Array} data - Training data
   * @param {number} batchSize - Batch size
   * @param {boolean} shuffle - Whether to shuffle
   * @yields {Array} Batch of examples
   */
  *generateBatches(data, batchSize, shuffle = true) {
    const indices = shuffle ? this.shuffle([...Array(data.length).keys()]) : 
                             [...Array(data.length).keys()];
    
    for (let i = 0; i < indices.length; i += batchSize) {
      const batchIndices = indices.slice(i, i + batchSize);
      const batch = batchIndices.map(idx => data[idx]);
      yield batch;
    }
  }
  
  /**
   * Get stratified folds for cross-validation
   * @param {number} numFolds - Number of folds
   * @returns {Array} Array of fold objects
   */
  getStratifiedFolds(numFolds = 5) {
    const categorized = this.groupByCategory(this.data);
    const folds = Array(numFolds).fill(null).map(() => []);
    
    // Distribute each category across folds
    for (const [category, examples] of Object.entries(categorized)) {
      const shuffled = this.shuffle(examples);
      
      shuffled.forEach((example, index) => {
        const foldIndex = index % numFolds;
        folds[foldIndex].push(example);
      });
    }
    
    // Create train/test splits for each fold
    const splits = [];
    
    for (let i = 0; i < numFolds; i++) {
      const testData = folds[i];
      const trainData = [];
      
      for (let j = 0; j < numFolds; j++) {
        if (j !== i) {
          trainData.push(...folds[j]);
        }
      }
      
      splits.push({
        fold: i,
        train: this.shuffle(trainData),
        test: this.shuffle(testData)
      });
    }
    
    return splits;
  }
  
  /**
   * Get data statistics
   */
  getStatistics() {
    const categorized = this.groupByCategory(this.data);
    const categoryStats = {};
    
    for (const [category, examples] of Object.entries(categorized)) {
      categoryStats[category] = {
        count: examples.length,
        percentage: (examples.length / this.data.length * 100).toFixed(2)
      };
    }
    
    return {
      totalExamples: this.data.length,
      categoriesPresent: Object.keys(categorized).length,
      categoryDistribution: categoryStats,
      isBalanced: this.isBalanced(categorized),
      sources: this.getSourceDistribution()
    };
  }
  
  /**
   * Check if data is balanced
   */
  isBalanced(categorized) {
    const counts = Object.values(categorized).map(arr => arr.length);
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    
    // Consider balanced if max/min ratio is less than 2
    return max / min < 2;
  }
  
  /**
   * Get distribution of data sources
   */
  getSourceDistribution() {
    const sources = {};
    
    this.data.forEach(example => {
      const source = example.source || 'unknown';
      sources[source] = (sources[source] || 0) + 1;
    });
    
    return sources;
  }
  
  /**
   * Filter data by criteria
   * @param {Object} criteria - Filter criteria
   * @returns {Array} Filtered data
   */
  filterData(criteria) {
    return this.data.filter(example => {
      if (criteria.category !== undefined && example.category !== criteria.category) {
        return false;
      }
      
      if (criteria.source && example.source !== criteria.source) {
        return false;
      }
      
      if (criteria.corrected !== undefined && example.corrected !== criteria.corrected) {
        return false;
      }
      
      if (criteria.minTimestamp && example.timestamp < criteria.minTimestamp) {
        return false;
      }
      
      return true;
    });
  }
  
  /**
   * Get recent examples
   * @param {number} days - Number of days
   * @returns {Array} Recent examples
   */
  getRecentExamples(days = 7) {
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
    return this.filterData({ minTimestamp: cutoff });
  }
  
  /**
   * Get user corrections
   * @returns {Array} Corrected examples
   */
  getUserCorrections() {
    return this.filterData({ 
      corrected: true,
      source: 'user_correction'
    });
  }
}

export { DataGenerator };