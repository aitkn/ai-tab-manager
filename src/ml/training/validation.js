/*
 * AI Tab Manager - Training Data Validation
 * Validates training data quality and integrity
 */

import { ML_CONFIG } from '../model-config.js';

/**
 * Validate training data
 * @param {Array} data - Training data array
 * @returns {Object} Validation result
 */
export function validateTrainingData(data) {
  const errors = [];
  const warnings = [];
  
  // Check if data is empty
  if (!data || data.length === 0) {
    errors.push('No training data provided');
    return { isValid: false, errors, warnings };
  }
  
  // Check minimum data requirements
  if (data.length < ML_CONFIG.training.minTrainingExamples) {
    errors.push(`Insufficient training data: ${data.length} examples (minimum: ${ML_CONFIG.training.minTrainingExamples})`);
  }
  
  // Validate each example
  const invalidExamples = [];
  const categoryCount = {};
  const urlSet = new Set();
  const duplicates = [];
  
  data.forEach((example, index) => {
    const exampleErrors = validateExample(example);
    
    if (exampleErrors.length > 0) {
      invalidExamples.push({ index, errors: exampleErrors });
    }
    
    // Count categories
    if (example.category !== undefined) {
      categoryCount[example.category] = (categoryCount[example.category] || 0) + 1;
    }
    
    // Check for duplicates
    if (example.url) {
      if (urlSet.has(example.url)) {
        duplicates.push(example.url);
      }
      urlSet.add(example.url);
    }
  });
  
  // Report invalid examples
  if (invalidExamples.length > 0) {
    errors.push(`${invalidExamples.length} invalid examples found`);
    
    // Show first few invalid examples
    invalidExamples.slice(0, 5).forEach(({ index, errors: exampleErrors }) => {
      errors.push(`Example ${index}: ${exampleErrors.join(', ')}`);
    });
  }
  
  // Check class distribution
  const categories = Object.keys(categoryCount);
  if (categories.length === 0) {
    errors.push('No valid categories found in data');
  } else {
    // Check if all categories are present
    const expectedCategories = [0, 1, 2, 3];
    const missingCategories = expectedCategories.filter(cat => !categoryCount[cat]);
    
    if (missingCategories.length > 0) {
      warnings.push(`Missing categories: ${missingCategories.join(', ')}`);
    }
    
    // Check minimum examples per category
    for (const [category, count] of Object.entries(categoryCount)) {
      if (count < ML_CONFIG.training.minExamplesPerClass) {
        warnings.push(`Category ${category} has only ${count} examples (minimum: ${ML_CONFIG.training.minExamplesPerClass})`);
      }
    }
    
    // Check class imbalance
    const counts = Object.values(categoryCount);
    const minCount = Math.min(...counts);
    const maxCount = Math.max(...counts);
    
    if (maxCount / minCount > 10) {
      warnings.push(`Severe class imbalance detected (ratio: ${(maxCount/minCount).toFixed(2)}:1)`);
    } else if (maxCount / minCount > 5) {
      warnings.push(`Class imbalance detected (ratio: ${(maxCount/minCount).toFixed(2)}:1)`);
    }
  }
  
  // Check duplicates
  if (duplicates.length > 0) {
    warnings.push(`${duplicates.length} duplicate URLs found`);
  }
  
  // Check data freshness
  const timestamps = data.map(d => d.timestamp).filter(t => t);
  if (timestamps.length > 0) {
    const oldestTimestamp = Math.min(...timestamps);
    const daysSinceOldest = (Date.now() - oldestTimestamp) / (1000 * 60 * 60 * 24);
    
    if (daysSinceOldest > 180) {
      warnings.push(`Data includes examples older than 6 months`);
    }
  }
  
  const isValid = errors.length === 0;
  
  return {
    isValid,
    errors,
    warnings,
    statistics: {
      totalExamples: data.length,
      validExamples: data.length - invalidExamples.length,
      categoryDistribution: categoryCount,
      uniqueUrls: urlSet.size,
      duplicateCount: duplicates.length
    }
  };
}

/**
 * Validate single training example
 * @param {Object} example - Training example
 * @returns {Array} Array of error messages
 */
function validateExample(example) {
  const errors = [];
  
  // Check required fields
  if (!example.url || typeof example.url !== 'string') {
    errors.push('Missing or invalid URL');
  } else {
    // Validate URL format
    try {
      new URL(example.url);
    } catch (e) {
      errors.push('Invalid URL format');
    }
  }
  
  if (example.title === undefined || example.title === null || typeof example.title !== 'string') {
    errors.push('Missing or invalid title');
  }
  
  if (example.category === undefined || example.category === null) {
    errors.push('Missing category');
  } else if (!Number.isInteger(example.category) || example.category < 0 || example.category > 3) {
    errors.push('Invalid category (must be 0-3)');
  }
  
  // Check optional fields
  if (example.features && typeof example.features !== 'object') {
    errors.push('Features must be an object');
  }
  
  if (example.source && typeof example.source !== 'string') {
    errors.push('Invalid source type');
  }
  
  return errors;
}

/**
 * Validate model predictions
 * @param {Array} predictions - Model predictions
 * @param {Array} tabs - Original tabs
 * @returns {Object} Validation result
 */
export function validatePredictions(predictions, tabs) {
  const errors = [];
  
  if (!predictions || !Array.isArray(predictions)) {
    errors.push('Invalid predictions format');
    return { isValid: false, errors };
  }
  
  if (predictions.length !== tabs.length) {
    errors.push(`Prediction count (${predictions.length}) doesn't match tab count (${tabs.length})`);
  }
  
  predictions.forEach((pred, index) => {
    if (!pred.category && pred.category !== 0) {
      errors.push(`Missing category for prediction ${index}`);
    }
    
    if (!pred.confidence && pred.confidence !== 0) {
      errors.push(`Missing confidence for prediction ${index}`);
    } else if (pred.confidence < 0 || pred.confidence > 1) {
      errors.push(`Invalid confidence ${pred.confidence} for prediction ${index}`);
    }
    
    if (pred.probabilities && !Array.isArray(pred.probabilities)) {
      errors.push(`Invalid probabilities for prediction ${index}`);
    }
  });
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Clean training data
 * @param {Array} data - Raw training data
 * @returns {Array} Cleaned data
 */
export function cleanTrainingData(data) {
  const cleaned = [];
  const skipped = [];
  
  data.forEach((example, index) => {
    // Validate example
    const errors = validateExample(example);
    
    if (errors.length === 0) {
      // Clean and normalize
      const cleanExample = {
        url: example.url.trim(),
        title: example.title.trim(),
        category: parseInt(example.category),
        timestamp: example.timestamp || Date.now(),
        source: example.source || 'unknown',
        corrected: example.corrected || false,
        metadata: example.metadata || {}
      };
      
      cleaned.push(cleanExample);
    } else {
      skipped.push({ index, example, errors });
    }
  });
  
  console.log(`Cleaned ${cleaned.length} examples, skipped ${skipped.length}`);
  
  return { cleaned, skipped };
}

/**
 * Analyze data quality
 * @param {Array} data - Training data
 * @returns {Object} Quality metrics
 */
export function analyzeDataQuality(data) {
  const validation = validateTrainingData(data);
  
  // Calculate quality score
  let qualityScore = 100;
  
  // Deduct for errors
  qualityScore -= validation.errors.length * 10;
  
  // Deduct for warnings
  qualityScore -= validation.warnings.length * 5;
  
  // Deduct for class imbalance
  const categoryCount = validation.statistics.categoryDistribution;
  if (categoryCount) {
    const counts = Object.values(categoryCount);
    const minCount = Math.min(...counts);
    const maxCount = Math.max(...counts);
    const imbalanceRatio = maxCount / minCount;
    
    if (imbalanceRatio > 5) {
      qualityScore -= Math.min(20, (imbalanceRatio - 5) * 2);
    }
  }
  
  // Ensure score is between 0 and 100
  qualityScore = Math.max(0, Math.min(100, qualityScore));
  
  return {
    qualityScore,
    validation,
    recommendations: getQualityRecommendations(validation, qualityScore)
  };
}

/**
 * Get recommendations for improving data quality
 */
function getQualityRecommendations(validation, qualityScore) {
  const recommendations = [];
  
  if (qualityScore < 50) {
    recommendations.push('Critical: Data quality is too low for reliable training');
  }
  
  if (validation.errors.length > 0) {
    recommendations.push('Fix data errors before training');
  }
  
  // Check for specific issues
  const stats = validation.statistics;
  
  if (stats.totalExamples < 500) {
    recommendations.push('Collect more training examples for better model performance');
  }
  
  if (stats.categoryDistribution) {
    const counts = Object.values(stats.categoryDistribution);
    const minCount = Math.min(...counts);
    
    if (minCount < 20) {
      recommendations.push('Collect more examples for underrepresented categories');
    }
  }
  
  if (validation.warnings.includes('class imbalance')) {
    recommendations.push('Consider using class balancing techniques during training');
  }
  
  if (stats.duplicateCount > stats.totalExamples * 0.1) {
    recommendations.push('Remove duplicate URLs to improve training efficiency');
  }
  
  return recommendations;
}

export default {
  validateTrainingData,
  validateExample,
  validatePredictions,
  cleanTrainingData,
  analyzeDataQuality
};