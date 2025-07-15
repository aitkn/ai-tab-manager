/*
 * AI Tab Manager - Random Data Generator
 * Handles random train/validation splitting with deterministic URL-based assignment
 */

import { ML_CONFIG } from '../model-config.js';
import logger from '../../utils/logger.js';

/**
 * Random Data Generator for training with deterministic URL-based splitting
 * Replaces temporal splitting with random assignment done at database write time
 */
export default class RandomDataGenerator {
  constructor(data) {
    this.data = data;
  }
  
  /**
   * Split data into train and validation sets using pre-assigned isValidation flag
   * @param {number} validationSplit - Not used, kept for compatibility (split determined at write time)
   * @returns {Object} Train and validation data with stratified balancing
   */
  splitDataRandomly(validationSplit = 0.2) {
    // Check isValidation field presence
    const hasValidationFlag = this.data.filter(item => item.isValidation !== undefined).length;
    
    // Filter by pre-assigned isValidation flag
    const trainData = this.data.filter(item => !item.isValidation);
    const validData = this.data.filter(item => item.isValidation);
    
    
    logger.mlTraining(`📊 Random split results: ${trainData.length} training, ${validData.length} validation`);
    
    // If no validation data found, do a manual split to ensure proper balancing
    if (validData.length === 0 && trainData.length > 0) {
      // Shuffle and split
      const shuffled = this.shuffle([...trainData]);
      const splitIndex = Math.floor(shuffled.length * 0.8);
      const manualTrainData = shuffled.slice(0, splitIndex);
      const manualValidData = shuffled.slice(splitIndex);
      
      logger.mlTraining(`📊 Manual split: ${manualTrainData.length} training, ${manualValidData.length} validation`);
      
      // Apply stratified balancing to maintain category distribution
      return this.applyStratifiedBalancing(manualTrainData, manualValidData, validationSplit);
    }
    
    // Apply stratified balancing to maintain category distribution
    return this.applyStratifiedBalancing(trainData, validData, validationSplit);
  }
  
  /**
   * Apply stratified balancing to ensure category representation
   * Reuses the weight-based balancing logic from temporal generator
   * @param {Array} trainData - Training data
   * @param {Array} validData - Validation data  
   * @param {number} validationSplit - Target validation ratio for verification
   * @returns {Object} Balanced train and validation data
   */
  applyStratifiedBalancing(trainData, validData, validationSplit) {
    // Group by category
    const trainByCategory = this.groupByCategory(trainData);
    const validByCategory = this.groupByCategory(validData);
    
    // Calculate statistics
    const trainStats = this.calculateCategoryStats(trainByCategory);
    const validStats = this.calculateCategoryStats(validByCategory);
    
    logger.mlTraining('📊 Random split category distribution:');
    logger.mlTraining('  Training:', trainStats);
    logger.mlTraining('  Validation:', validStats);
    
    // Apply weight-based balancing to training data only
    // (validation data stays as-is to maintain unbiased evaluation)
    const balancedTrainData = this.balanceTrainingData(trainData);
    
    
    // Ensure minimum samples per category
    this.validateMinimumSamples(balancedTrainData, validData);
    
    return {
      trainData: balancedTrainData,
      validData: validData
    };
  }
  
  /**
   * Balance training data using weight-based oversampling
   * Reuses existing balancing logic but applies only to training set
   * @param {Array} trainData - Training data to balance
   * @returns {Array} Balanced training data
   */
  balanceTrainingData(trainData) {
    const categorized = this.groupByCategory(trainData);
    
    // Calculate weights (trainingConfidence) for each category
    const categoryWeights = {};
    for (const [category, examples] of Object.entries(categorized)) {
      categoryWeights[category] = examples.reduce((sum, item) => 
        sum + (item.trainingConfidence || 1.0), 0
      );
    }
    
    // Find target weight (use max category weight)
    const maxWeight = Math.max(...Object.values(categoryWeights));
    
    const balanced = [];
    
    for (const [category, examples] of Object.entries(categorized)) {
      // Add all original examples
      balanced.push(...examples);
      
      // Calculate how much weight we need to add
      const currentWeight = categoryWeights[category];
      const neededWeight = maxWeight - currentWeight;
      
      if (neededWeight > 0) {
        // Oversample to reach target weight
        const oversampled = this.oversampleByWeight(examples, neededWeight);
        balanced.push(...oversampled);
      }
    }
    
    // Shuffle the balanced data
    return this.shuffle(balanced);
  }
  
  /**
   * Oversample examples to reach target weight
   * @param {Array} examples - Examples to oversample from
   * @param {number} targetWeight - Weight to add through oversampling
   * @returns {Array} Oversampled examples
   */
  oversampleByWeight(examples, targetWeight) {
    const oversampled = [];
    let addedWeight = 0;
    
    while (addedWeight < targetWeight && oversampled.length < examples.length * 3) {
      const randomExample = examples[Math.floor(Math.random() * examples.length)];
      const exampleWeight = randomExample.trainingConfidence || 1.0;
      
      // Create augmented version with slight timestamp jitter for uniqueness
      const augmented = {
        ...randomExample,
        timestamp: randomExample.timestamp + Math.random() * 1000,
        augmented: true,
        augmentationType: 'weight_balancing'
      };
      
      oversampled.push(augmented);
      addedWeight += exampleWeight;
    }
    
    return oversampled;
  }
  
  /**
   * Group data by category
   * @param {Array} data - Data to group
   * @returns {Object} Data grouped by category
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
   * Calculate category statistics
   * @param {Object} categorized - Data grouped by category
   * @returns {Object} Statistics per category
   */
  calculateCategoryStats(categorized) {
    const stats = {};
    const totalItems = Object.values(categorized).reduce((sum, arr) => sum + arr.length, 0);
    
    for (const [category, examples] of Object.entries(categorized)) {
      const weight = examples.reduce((sum, item) => sum + (item.trainingConfidence || 1.0), 0);
      stats[category] = {
        count: examples.length,
        weight: weight.toFixed(2),
        percentage: totalItems > 0 ? (examples.length / totalItems * 100).toFixed(1) : '0.0'
      };
    }
    
    return stats;
  }
  
  /**
   * Validate minimum samples per category
   * @param {Array} trainData - Training data
   * @param {Array} validData - Validation data
   */
  validateMinimumSamples(trainData, validData) {
    const trainByCategory = this.groupByCategory(trainData);
    const validByCategory = this.groupByCategory(validData);
    
    const minExamplesPerClass = ML_CONFIG.training.minExamplesPerClass || 5;
    
    // Check training data
    for (const [category, examples] of Object.entries(trainByCategory)) {
      if (examples.length < minExamplesPerClass) {
        console.warn(`⚠️ Category ${category} has only ${examples.length} training examples (minimum: ${minExamplesPerClass})`);
      }
    }
    
    // Check validation data
    for (const [category, examples] of Object.entries(validByCategory)) {
      if (examples.length < 2) {
        console.warn(`⚠️ Category ${category} has only ${examples.length} validation examples (minimum: 2)`);
      }
    }
  }
  
  /**
   * Shuffle array using Fisher-Yates algorithm
   * @param {Array} array - Array to shuffle
   * @returns {Array} Shuffled array
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
   * Get data statistics
   * @returns {Object} Statistics about the data
   */
  getStatistics() {
    const trainData = this.data.filter(item => !item.isValidation);
    const validData = this.data.filter(item => item.isValidation);
    
    const trainStats = this.calculateCategoryStats(this.groupByCategory(trainData));
    const validStats = this.calculateCategoryStats(this.groupByCategory(validData));
    
    return {
      totalExamples: this.data.length,
      trainExamples: trainData.length,
      validExamples: validData.length,
      splitRatio: {
        train: (trainData.length / this.data.length * 100).toFixed(1),
        validation: (validData.length / this.data.length * 100).toFixed(1)
      },
      trainCategoryDistribution: trainStats,
      validCategoryDistribution: validStats,
      splitMethod: 'random_deterministic_url_based'
    };
  }
}

export { RandomDataGenerator };