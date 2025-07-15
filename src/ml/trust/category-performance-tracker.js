/*
 * AI Tab Manager - Category-Specific Performance Tracker
 * Tracks accuracy per category for each prediction method
 */

import { ML_CONFIG } from '../model-config.js';

/**
 * Category-specific performance tracker
 */
export default class CategoryPerformanceTracker {
  constructor() {
    this.reset();
  }
  
  /**
   * Reset all metrics
   */
  reset() {
    // Initialize metrics for each method and category
    this.metrics = {};
    this.confusionMatrices = {};
    this.categoryWeights = {};
    
    const methods = ['rules', 'model', 'llm'];
    const categories = [1, 2, 3]; // Ignore, Useful, Important
    
    methods.forEach(method => {
      this.metrics[method] = {};
      this.confusionMatrices[method] = this.createConfusionMatrix();
      this.categoryWeights[method] = {};
      
      categories.forEach(category => {
        this.metrics[method][category] = {
          correct: 0,
          total: 0,
          recentAccuracy: [], // Rolling window
          precision: 0,
          recall: 0,
          f1Score: 0
        };
        
        // Initialize category-specific weights
        this.categoryWeights[method][category] = this.getInitialWeight(method, category);
      });
    });
    
    // Overall accuracy tracking
    this.overallAccuracy = {
      rules: 0,
      model: 0,
      llm: 0
    };
    
    // Track predictions for analysis
    this.recentPredictions = [];
    this.maxRecentPredictions = 1000;
  }
  
  /**
   * Get initial weight based on method and category
   */
  getInitialWeight(method, category) {
    // Based on empirical observations
    const initialWeights = {
      rules: {
        1: 0.95, // Rules are excellent for Ignore (explicit patterns)
        2: 0.20, // Rules are poor for Useful (no default bias)
        3: 0.90  // Rules are excellent for Important (explicit patterns)
      },
      model: {
        1: 0.70, // Model is good for Ignore
        2: 0.80, // Model is best for Useful (learns nuanced patterns)
        3: 0.75  // Model is good for Important
      },
      llm: {
        1: 0.85, // LLM is very good for Ignore
        2: 0.85, // LLM is very good for Useful
        3: 0.80  // LLM is good for Important
      }
    };
    
    return initialWeights[method]?.[category] || 0.5;
  }
  
  /**
   * Create empty confusion matrix
   */
  createConfusionMatrix() {
    // 3x3 matrix for categories 1, 2, 3
    return [
      [0, 0, 0], // Actual: Ignore
      [0, 0, 0], // Actual: Useful
      [0, 0, 0]  // Actual: Important
    ];
  }
  
  /**
   * Record a prediction
   * @param {string} method - Prediction method (rules, model, llm)
   * @param {number} predicted - Predicted category
   * @param {number} actual - Actual category
   * @param {number} confidence - Prediction confidence
   */
  recordPrediction(method, predicted, actual, confidence = 1.0) {
    if (!this.metrics[method] || !this.metrics[method][actual]) {
      console.warn(`Invalid method or category: ${method}, ${actual}`);
      return;
    }
    
    const isCorrect = predicted === actual;
    const metric = this.metrics[method][actual];
    
    // Update counts
    metric.total++;
    if (isCorrect) {
      metric.correct++;
    }
    
    // Update rolling window
    metric.recentAccuracy.push(isCorrect ? 1 : 0);
    if (metric.recentAccuracy.length > ML_CONFIG.performance.windowSize) {
      metric.recentAccuracy.shift();
    }
    
    // Update confusion matrix
    const actualIndex = actual - 1;
    const predictedIndex = predicted - 1;
    if (actualIndex >= 0 && actualIndex < 3 && predictedIndex >= 0 && predictedIndex < 3) {
      this.confusionMatrices[method][actualIndex][predictedIndex]++;
    }
    
    // Store recent prediction for analysis
    this.recentPredictions.push({
      method,
      predicted,
      actual,
      confidence,
      isCorrect,
      timestamp: Date.now()
    });
    
    // Trim recent predictions
    if (this.recentPredictions.length > this.maxRecentPredictions) {
      this.recentPredictions.shift();
    }
    
    // Update metrics
    this.updateMetrics(method);
  }
  
  /**
   * Update performance metrics for a method
   */
  updateMetrics(method) {
    const categories = [1, 2, 3];
    let totalCorrect = 0;
    let totalPredictions = 0;
    
    categories.forEach(category => {
      const metric = this.metrics[method][category];
      
      // Calculate recent accuracy
      const recentAcc = metric.recentAccuracy.length > 0
        ? metric.recentAccuracy.reduce((a, b) => a + b) / metric.recentAccuracy.length
        : 0;
      
      // Calculate all-time accuracy
      const allTimeAcc = metric.total > 0
        ? metric.correct / metric.total
        : 0;
      
      // Weighted combination (recent matters more)
      const accuracy = 0.7 * recentAcc + 0.3 * allTimeAcc;
      
      // Calculate precision, recall, F1 from confusion matrix
      const { precision, recall, f1 } = this.calculateMetricsFromConfusion(
        method, 
        category
      );
      
      metric.precision = precision;
      metric.recall = recall;
      metric.f1Score = f1;
      
      // Update category weight based on performance
      this.categoryWeights[method][category] = this.updateCategoryWeight(
        method,
        category,
        accuracy
      );
      
      totalCorrect += metric.correct;
      totalPredictions += metric.total;
    });
    
    // Update overall accuracy
    this.overallAccuracy[method] = totalPredictions > 0
      ? totalCorrect / totalPredictions
      : 0;
  }
  
  /**
   * Calculate precision, recall, F1 from confusion matrix
   */
  calculateMetricsFromConfusion(method, category) {
    const matrix = this.confusionMatrices[method];
    const categoryIndex = category - 1;
    
    // True positives: correctly predicted this category
    const tp = matrix[categoryIndex][categoryIndex];
    
    // False positives: predicted this category but was wrong
    let fp = 0;
    for (let i = 0; i < 3; i++) {
      if (i !== categoryIndex) {
        fp += matrix[i][categoryIndex];
      }
    }
    
    // False negatives: should have predicted this category but didn't
    let fn = 0;
    for (let j = 0; j < 3; j++) {
      if (j !== categoryIndex) {
        fn += matrix[categoryIndex][j];
      }
    }
    
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0
      ? 2 * (precision * recall) / (precision + recall)
      : 0;
    
    return { precision, recall, f1 };
  }
  
  /**
   * Update category weight based on performance
   */
  updateCategoryWeight(method, category, accuracy) {
    const currentWeight = this.categoryWeights[method][category];
    const learningRate = 0.02;
    const minWeight = 0.1;
    const maxWeight = 0.95;
    
    // Adjust weight based on accuracy
    let newWeight = currentWeight + learningRate * (accuracy - currentWeight);
    
    // Apply constraints
    newWeight = Math.max(minWeight, Math.min(maxWeight, newWeight));
    
    return newWeight;
  }
  
  /**
   * Get category-specific accuracy for a method
   */
  getCategoryAccuracy(method, category) {
    const metric = this.metrics[method]?.[category];
    if (!metric || metric.total === 0) {
      return 0;
    }
    
    const recentAcc = metric.recentAccuracy.length > 0
      ? metric.recentAccuracy.reduce((a, b) => a + b) / metric.recentAccuracy.length
      : 0;
    
    const allTimeAcc = metric.correct / metric.total;
    
    // Weighted combination
    return 0.7 * recentAcc + 0.3 * allTimeAcc;
  }
  
  /**
   * Get category weight for ensemble voting
   */
  getCategoryWeight(method, category) {
    return this.categoryWeights[method]?.[category] || 0.5;
  }
  
  /**
   * Get performance report
   */
  getReport() {
    const report = {
      overallAccuracy: { ...this.overallAccuracy },
      categoryAccuracy: {},
      categoryWeights: {},
      confusionMatrices: {},
      recentTrends: {}
    };
    
    const methods = ['rules', 'model', 'llm'];
    
    methods.forEach(method => {
      report.categoryAccuracy[method] = {};
      report.categoryWeights[method] = {};
      report.confusionMatrices[method] = [...this.confusionMatrices[method]];
      
      [1, 2, 3].forEach(category => {
        const accuracy = this.getCategoryAccuracy(method, category);
        const metric = this.metrics[method][category];
        
        report.categoryAccuracy[method][category] = {
          accuracy,
          precision: metric.precision,
          recall: metric.recall,
          f1Score: metric.f1Score,
          totalPredictions: metric.total
        };
        
        report.categoryWeights[method][category] = this.categoryWeights[method][category];
      });
      
      // Calculate recent trend
      const recentForMethod = this.recentPredictions
        .filter(p => p.method === method)
        .slice(-100);
      
      if (recentForMethod.length > 0) {
        const recentCorrect = recentForMethod.filter(p => p.isCorrect).length;
        report.recentTrends[method] = {
          accuracy: recentCorrect / recentForMethod.length,
          sampleSize: recentForMethod.length
        };
      }
    });
    
    return report;
  }
  
  /**
   * Get confusion matrix for a method
   */
  getConfusionMatrix(method) {
    return this.confusionMatrices[method] || this.createConfusionMatrix();
  }
  
  /**
   * Export metrics for persistence
   */
  exportMetrics() {
    return {
      metrics: this.metrics,
      confusionMatrices: this.confusionMatrices,
      categoryWeights: this.categoryWeights,
      overallAccuracy: this.overallAccuracy,
      timestamp: Date.now()
    };
  }
  
  /**
   * Import metrics from persistence
   */
  importMetrics(data) {
    if (data.metrics) this.metrics = data.metrics;
    if (data.confusionMatrices) this.confusionMatrices = data.confusionMatrices;
    if (data.categoryWeights) this.categoryWeights = data.categoryWeights;
    if (data.overallAccuracy) this.overallAccuracy = data.overallAccuracy;
  }
  
  /**
   * Get best method for a specific category
   */
  getBestMethodForCategory(category) {
    const methods = ['rules', 'model', 'llm'];
    let bestMethod = null;
    let bestAccuracy = 0;
    
    methods.forEach(method => {
      const accuracy = this.getCategoryAccuracy(method, category);
      if (accuracy > bestAccuracy) {
        bestAccuracy = accuracy;
        bestMethod = method;
      }
    });
    
    return { method: bestMethod, accuracy: bestAccuracy };
  }
}

export { CategoryPerformanceTracker };