/*
 * AI Tab Manager - Temporal Data Generator
 * Implements temporal data splitting to prevent data leakage
 * 
 * DEPRECATED: This file is no longer used after migration to random splitting.
 * Random splitting is now handled by random-data-generator.js with URL-based
 * deterministic assignment at database write time.
 * 
 * This file is kept for reference but should be removed in a future cleanup.
 */

import { ML_CONFIG } from '../model-config.js';

/**
 * Temporal Data Generator for training
 * Ensures validation data is always newer than training data
 */
export default class TemporalDataGenerator {
  constructor(data) {
    this.data = data;
    this.validateData();
  }
  
  /**
   * Validate that data has timestamps
   */
  validateData() {
    const hasTimestamps = this.data.every(item => 
      item.timestamp !== undefined || item.createdAt !== undefined
    );
    
    if (!hasTimestamps) {
      console.warn('Data lacks timestamps, falling back to random split');
    }
  }
  
  /**
   * Get timestamp from data item
   */
  getTimestamp(item) {
    return item.timestamp || item.createdAt || Date.now();
  }
  
  /**
   * Split data temporally into train and validation sets
   * @param {number} validationSplit - Fraction of data for validation
   * @param {Object} options - Split options
   * @returns {Object} Train and validation data
   */
  splitDataTemporally(validationSplit = 0.2, options = {}) {
    const {
      ensureMinPerCategory = true,
      minSamplesPerCategory = 10,
      randomSeed = null
    } = options;
    
    // Sort data by timestamp, then by URL for consistent ordering
    const sortedData = [...this.data].sort((a, b) => {
      const timeDiff = this.getTimestamp(a) - this.getTimestamp(b);
      if (timeDiff !== 0) return timeDiff;
      // Secondary sort by URL for consistent ordering when timestamps are equal
      return (a.url || '').localeCompare(b.url || '');
    });
    
    // Calculate split point
    const splitPoint = Math.floor(sortedData.length * (1 - validationSplit));
    
    // Initial split
    let trainData = sortedData.slice(0, splitPoint);
    let validData = sortedData.slice(splitPoint);
    
    // Ensure minimum samples per category if requested
    if (ensureMinPerCategory) {
      const result = this.ensureMinimumSamples(
        trainData, 
        validData, 
        minSamplesPerCategory
      );
      trainData = result.trainData;
      validData = result.validData;
    }
    
    // Log split statistics
    this.logSplitStatistics(trainData, validData);
    
    return { trainData, validData };
  }
  
  /**
   * Ensure minimum samples per category in both sets
   * IMPORTANT: To preserve temporal ordering, we move oldest validation samples 
   * to training when needed, rather than moving newest training to validation
   */
  ensureMinimumSamples(trainData, validData, minSamples) {
    const trainByCategory = this.groupByCategory(trainData);
    const validByCategory = this.groupByCategory(validData);
    
    // Check each category
    const categories = new Set([
      ...Object.keys(trainByCategory),
      ...Object.keys(validByCategory)
    ]);
    
    for (const category of categories) {
      const trainCount = (trainByCategory[category] || []).length;
      const validCount = (validByCategory[category] || []).length;
      
      // If validation doesn't have enough samples, move from training OR
      // if training doesn't have enough, move from validation
      if (validCount < minSamples && trainCount > minSamples) {
        // Need more in validation, but we should NOT move recent training samples
        // as that would break temporal ordering. Instead, accept the imbalance
        // or consider a different strategy
      } else if (trainCount < minSamples && validCount > minSamples) {
        // Move oldest validation samples to training to maintain temporal order
        const needed = minSamples - trainCount;
        const canMove = Math.min(needed, validCount - minSamples);
        
        if (canMove > 0) {
          // Move oldest validation samples to training
          const toMove = validByCategory[category]
            .sort((a, b) => this.getTimestamp(a) - this.getTimestamp(b))
            .slice(0, canMove);
          
          
          validData = validData.filter(item => !toMove.includes(item));
          trainData = [...trainData, ...toMove];
        }
      }
    }
    
    return { trainData, validData };
  }
  
  /**
   * Split data with temporal validation for each category
   * Ensures temporal ordering within each category
   */
  splitDataTemporallyStratified(validationSplit = 0.2) {
    // Step 1: Sort entire dataset by timestamp, then by URL for consistency
    const sortedData = [...this.data].sort((a, b) => {
      const timeDiff = this.getTimestamp(a) - this.getTimestamp(b);
      if (timeDiff !== 0) return timeDiff;
      return (a.url || '').localeCompare(b.url || '');
    });
    
    // Step 2: Separate data by categories
    const categorized = this.groupByCategory(sortedData);
    
    console.log('WEIGHT-BASED STRATIFIED SPLIT:');
    console.log(`Total samples: ${sortedData.length}`);
    console.log('Category distribution:', Object.fromEntries(
      Object.entries(categorized).map(([cat, examples]) => [cat, examples.length])
    ));
    
    // Step 3: Split each category 80/20 by cumulative weight
    const categoryTrainParts = {};
    const categoryValidParts = {};
    const categoryWeights = {};
    
    for (const [category, examples] of Object.entries(categorized)) {
      // Sort category examples by timestamp (oldest first)
      const sortedCategory = examples.sort((a, b) => {
        const timeDiff = this.getTimestamp(a) - this.getTimestamp(b);
        if (timeDiff !== 0) return timeDiff;
        return (a.url || '').localeCompare(b.url || '');
      });
      
      // Calculate cumulative weights
      const weights = sortedCategory.map(item => item.trainingConfidence || 0.5);
      const totalWeight = weights.reduce((sum, w) => sum + w, 0);
      const targetTrainWeight = totalWeight * (1 - validationSplit);
      
      // Find split point by cumulative weight (not count!)
      let cumulativeWeight = 0;
      let splitIndex = 0;
      for (let i = 0; i < weights.length; i++) {
        cumulativeWeight += weights[i];
        if (cumulativeWeight >= targetTrainWeight) {
          splitIndex = i + 1; // Include this sample in training
          break;
        }
      }
      
      categoryTrainParts[category] = sortedCategory.slice(0, splitIndex);
      categoryValidParts[category] = sortedCategory.slice(splitIndex);
      
      const trainWeight = weights.slice(0, splitIndex).reduce((sum, w) => sum + w, 0);
      const validWeight = weights.slice(splitIndex).reduce((sum, w) => sum + w, 0);
      
      categoryWeights[category] = {
        total: totalWeight,
        train: trainWeight,
        valid: validWeight
      };
      
      console.log(`${category}: ${categoryTrainParts[category].length} train (weight: ${trainWeight.toFixed(2)}), ${categoryValidParts[category].length} validation (weight: ${validWeight.toFixed(2)})`);
    }
    
    // Step 4: Find max weight from biggest category (80/20 parts)
    const maxTrainWeight = Math.max(...Object.values(categoryWeights).map(w => w.train));
    const maxValidWeight = Math.max(...Object.values(categoryWeights).map(w => w.valid));
    
    console.log(`Max weights - Train: ${maxTrainWeight.toFixed(2)}, Validation: ${maxValidWeight.toFixed(2)}`);
    
    // Step 5: Pad smaller categories with round-robin from end to approximate same weight
    const paddedTrainParts = {};
    const paddedValidParts = {};
    
    for (const category of Object.keys(categorized)) {
      // Pad training part by weight
      const trainPart = categoryTrainParts[category];
      const currentTrainWeight = categoryWeights[category].train;
      
      if (trainPart.length > 0 && currentTrainWeight < maxTrainWeight) {
        const paddedTrain = this.padToTargetWeight(trainPart, currentTrainWeight, maxTrainWeight);
        paddedTrainParts[category] = paddedTrain;
        const newWeight = paddedTrain.reduce((sum, item) => sum + (item.trainingConfidence || 0.5), 0);
        console.log(`  ${category} train: padded from weight ${currentTrainWeight.toFixed(2)} to ${newWeight.toFixed(2)} (${trainPart.length} → ${paddedTrain.length} samples)`);
      } else {
        paddedTrainParts[category] = trainPart;
      }
      
      // Pad validation part by weight
      const validPart = categoryValidParts[category];
      const currentValidWeight = categoryWeights[category].valid;
      
      if (validPart.length > 0 && currentValidWeight < maxValidWeight) {
        console.log(`  ${category} validation needs padding: current=${currentValidWeight.toFixed(2)}, target=${maxValidWeight.toFixed(2)}, gap=${(maxValidWeight - currentValidWeight).toFixed(2)}`);
        const paddedValid = this.padToTargetWeight(validPart, currentValidWeight, maxValidWeight);
        paddedValidParts[category] = paddedValid;
        const newWeight = paddedValid.reduce((sum, item) => sum + (item.trainingConfidence || 0.5), 0);
        console.log(`  ${category} validation: padded from weight ${currentValidWeight.toFixed(2)} to ${newWeight.toFixed(2)} (${validPart.length} → ${paddedValid.length} samples)`);
        console.log(`  ${category} validation weight ratio: ${(newWeight / maxValidWeight * 100).toFixed(1)}% of target`);
      } else {
        paddedValidParts[category] = validPart;
        if (currentValidWeight >= maxValidWeight) {
          console.log(`  ${category} validation: already at max weight ${currentValidWeight.toFixed(2)}`);
        }
      }
    }
    
    // Step 6: Merge training parts and validation parts separately
    const trainData = [];
    const validData = [];
    
    for (const category of Object.keys(categorized)) {
      trainData.push(...paddedTrainParts[category]);
      validData.push(...paddedValidParts[category]);
    }
    
    // Step 7: Shuffle each part separately (safe to shuffle within balanced groups)
    this.shuffleArray(trainData);
    this.shuffleArray(validData);
    
    const finalTrainWeight = trainData.reduce((sum, item) => sum + (item.trainingConfidence || 0.5), 0);
    const finalValidWeight = validData.reduce((sum, item) => sum + (item.trainingConfidence || 0.5), 0);
    
    console.log(`Final weights - Train: ${finalTrainWeight.toFixed(2)}, Validation: ${finalValidWeight.toFixed(2)}`);
    
    // Log final category distribution
    const finalTrainCats = {};
    const finalValidCats = {};
    trainData.forEach(item => finalTrainCats[item.category] = (finalTrainCats[item.category] || 0) + 1);
    validData.forEach(item => finalValidCats[item.category] = (finalValidCats[item.category] || 0) + 1);
    console.log(`Training categories: ${JSON.stringify(finalTrainCats)}`);
    console.log(`Validation categories: ${JSON.stringify(finalValidCats)}`);
    console.log(`Final counts - Train: ${trainData.length}, Validation: ${validData.length}`);
    
    // Log split statistics with stratified flag  
    this.logSplitStatistics(trainData, validData, true);
    
    // Return separate balanced training and validation data
    return { 
      trainData: trainData,   // Balanced, shuffled training data
      validData: validData,   // Balanced, shuffled validation data
      _debug: {
        finalTrainWeight: finalTrainWeight,
        finalValidWeight: finalValidWeight,
        trainSize: trainData.length,
        validSize: validData.length
      }
    };
  }
  
  /**
   * Create time-based folds for cross-validation
   * @param {number} numFolds - Number of folds
   * @returns {Array} Array of fold objects
   */
  getTemporalFolds(numFolds = 5) {
    // Sort data by timestamp
    const sortedData = [...this.data].sort((a, b) => 
      this.getTimestamp(a) - this.getTimestamp(b)
    );
    
    const foldSize = Math.floor(sortedData.length / numFolds);
    const folds = [];
    
    for (let i = 0; i < numFolds; i++) {
      const start = i * foldSize;
      const end = i === numFolds - 1 ? sortedData.length : (i + 1) * foldSize;
      
      const testData = sortedData.slice(start, end);
      const trainData = [
        ...sortedData.slice(0, start),
        ...sortedData.slice(end)
      ];
      
      folds.push({
        fold: i,
        train: trainData,
        test: testData,
        trainTimeRange: this.getTimeRange(trainData),
        testTimeRange: this.getTimeRange(testData)
      });
    }
    
    return folds;
  }
  
  /**
   * Get time range of data
   */
  getTimeRange(data) {
    if (data.length === 0) return { start: null, end: null };
    
    const timestamps = data.map(item => this.getTimestamp(item));
    return {
      start: new Date(Math.min(...timestamps)),
      end: new Date(Math.max(...timestamps))
    };
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
   * Log split statistics
   * @param {boolean} isStratified - Whether this is a stratified split
   */
  logSplitStatistics(trainData, validData, isStratified = false) {
    const trainRange = this.getTimeRange(trainData);
    const validRange = this.getTimeRange(validData);
    
    console.log(`Temporal Split Statistics${isStratified ? ' (Stratified)' : ''}:`);
    console.log(`Training: ${trainData.length} samples (${trainRange.start?.toISOString()} to ${trainRange.end?.toISOString()})`);
    console.log(`Validation: ${validData.length} samples (${validRange.start?.toISOString()} to ${validRange.end?.toISOString()})`);
    
    // Check for overlap - only warn for non-stratified splits
    // Stratified splits may have temporal overlap between categories, which is expected
    if (!isStratified && trainRange.end && validRange.start && trainRange.end > validRange.start) {
      console.warn('WARNING: Temporal overlap detected between training and validation sets!');
    }
    
    // Category distribution
    const trainCategories = this.getCategoryDistribution(trainData);
    const validCategories = this.getCategoryDistribution(validData);
    
    console.log('Training category distribution:', trainCategories);
    console.log('Validation category distribution:', validCategories);
  }
  
  /**
   * Get category distribution
   */
  getCategoryDistribution(data) {
    const distribution = {};
    
    data.forEach(item => {
      const category = item.category;
      distribution[category] = (distribution[category] || 0) + 1;
    });
    
    // Convert to percentages
    const total = data.length;
    for (const category in distribution) {
      distribution[category] = {
        count: distribution[category],
        percentage: ((distribution[category] / total) * 100).toFixed(1) + '%'
      };
    }
    
    return distribution;
  }
  
  /**
   * Balance classes with temporal awareness
   * Oversample from recent data to maintain temporal ordering
   */
  balanceClassesTemporally(data, options = {}) {
    const {
      strategy = 'oversample', // oversample, undersample, or smote
      targetDistribution = null // If null, balance all classes equally
    } = options;
    
    const categorized = this.groupByCategory(data);
    const maxSize = Math.max(...Object.values(categorized).map(arr => arr.length));
    
    const balanced = [];
    
    for (const [category, examples] of Object.entries(categorized)) {
      // Sort by timestamp (newest first for oversampling), then by URL
      const sorted = examples.sort((a, b) => {
        const timeDiff = this.getTimestamp(b) - this.getTimestamp(a);
        if (timeDiff !== 0) return timeDiff;
        // Secondary sort by URL for consistent ordering when timestamps are equal
        return (a.url || '').localeCompare(b.url || '');
      });
      
      // Add all original examples
      balanced.push(...examples);
      
      if (strategy === 'oversample') {
        const targetSize = targetDistribution 
          ? Math.floor(data.length * targetDistribution[category])
          : maxSize;
        
        const needed = targetSize - examples.length;
        
        if (needed > 0) {
          // Oversample from recent examples
          const oversampled = this.oversampleRecent(sorted, needed);
          balanced.push(...oversampled);
        }
      }
    }
    
    // Sort by timestamp to maintain temporal order, then by URL
    return balanced.sort((a, b) => {
      const timeDiff = this.getTimestamp(a) - this.getTimestamp(b);
      if (timeDiff !== 0) return timeDiff;
      // Secondary sort by URL for consistent ordering when timestamps are equal
      return (a.url || '').localeCompare(b.url || '');
    });
  }
  
  /**
   * Oversample from recent examples
   */
  oversampleRecent(examples, count) {
    const oversampled = [];
    
    // Use only recent 50% of examples for oversampling
    const recentCount = Math.max(1, Math.floor(examples.length * 0.5));
    const recentExamples = examples.slice(0, recentCount);
    
    for (let i = 0; i < count; i++) {
      const index = i % recentExamples.length;
      const example = recentExamples[index];
      
      // Create augmented version
      const augmented = {
        ...example,
        augmented: true
      };
      
      oversampled.push(augmented);
    }
    
    return oversampled;
  }
  
  /**
   * Filter data by time window
   * @param {number} startTime - Start timestamp
   * @param {number} endTime - End timestamp
   * @returns {Array} Filtered data
   */
  filterByTimeWindow(startTime, endTime) {
    return this.data.filter(item => {
      const timestamp = this.getTimestamp(item);
      return timestamp >= startTime && timestamp <= endTime;
    });
  }
  
  /**
   * Get data statistics with temporal information
   */
  getTemporalStatistics() {
    const timeRange = this.getTimeRange(this.data);
    const dayMs = 24 * 60 * 60 * 1000;
    const spanDays = (timeRange.end - timeRange.start) / dayMs;
    
    // Group by day
    const byDay = {};
    this.data.forEach(item => {
      const date = new Date(this.getTimestamp(item)).toDateString();
      byDay[date] = (byDay[date] || 0) + 1;
    });
    
    // Group by week
    const byWeek = {};
    this.data.forEach(item => {
      const date = new Date(this.getTimestamp(item));
      const week = `${date.getFullYear()}-W${Math.ceil(date.getDate() / 7)}`;
      byWeek[week] = (byWeek[week] || 0) + 1;
    });
    
    return {
      timeRange,
      spanDays: spanDays.toFixed(1),
      totalExamples: this.data.length,
      examplesPerDay: (this.data.length / spanDays).toFixed(1),
      dailyDistribution: byDay,
      weeklyDistribution: byWeek,
      oldestExample: this.data.reduce((oldest, item) => 
        this.getTimestamp(item) < this.getTimestamp(oldest) ? item : oldest
      ),
      newestExample: this.data.reduce((newest, item) => 
        this.getTimestamp(item) > this.getTimestamp(newest) ? item : newest
      )
    };
  }
  
  /**
   * Pad data to target weight using round-robin from end
   * @param {Array} data - Original data samples
   * @param {number} currentWeight - Current cumulative weight
   * @param {number} targetWeight - Target cumulative weight
   * @returns {Array} Padded data
   */
  padToTargetWeight(data, currentWeight, targetWeight) {
    if (currentWeight >= targetWeight || data.length === 0) {
      return [...data];
    }
    
    const result = [...data];
    const weightNeeded = targetWeight - currentWeight;
    let addedWeight = 0;
    let sampleIndex = data.length - 1; // Start from end (most recent)
    
    // Round-robin from end until we reach target weight
    let cycles = 0;
    const maxCycles = 20; // Allow up to 20 full cycles through the data
    
    while (addedWeight < weightNeeded && cycles < maxCycles) {
      const sampleToAdd = data[sampleIndex];
      const sampleWeight = sampleToAdd.trainingConfidence || 0.5;
      
      // Stop if adding this sample would overshoot by more than 10%
      if (addedWeight + sampleWeight > weightNeeded * 1.1) {
        // Try to get closer by using a partial weight
        const remainingWeight = weightNeeded - addedWeight;
        if (remainingWeight > sampleWeight * 0.1) { // Only if meaningful weight remains
          // Create augmented version with adjusted weight
          const augmented = {
            ...sampleToAdd,
            augmented: true,
            trainingConfidence: remainingWeight // Adjust weight to hit target exactly
          };
          result.push(augmented);
          addedWeight += remainingWeight;
        }
        break;
      }
      
      // Create augmented version
      const augmented = {
        ...sampleToAdd,
        augmented: true
      };
      
      result.push(augmented);
      addedWeight += sampleWeight;
      
      // Move to previous sample (round-robin from end)
      sampleIndex = (sampleIndex - 1 + data.length) % data.length;
      if (sampleIndex === data.length - 1) {
        cycles++; // Completed a full cycle
      }
    }
    
    console.log(`    Padding result: needed ${weightNeeded.toFixed(3)}, added ${addedWeight.toFixed(3)}, cycles: ${cycles}, final size: ${result.length}`);
    
    if (cycles >= maxCycles) {
      console.log(`    ⚠️ Padding stopped at max cycles (${maxCycles}) - may not reach exact target weight`);
    }
    
    return result;
  }
  
  /**
   * Shuffle array in place using Fisher-Yates algorithm
   * @param {Array} array - Array to shuffle
   */
  shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }
}

export { TemporalDataGenerator };