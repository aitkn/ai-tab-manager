/*
 * AI Tab Manager - Trust Manager
 * Manages dynamic trust weights and decision strategies
 */

import { ML_CONFIG } from '../model-config.js';
import { getPerformanceTracker } from './performance-tracker.js';
import { recordMetric } from '../storage/ml-database.js';

/**
 * Trust Manager for adaptive categorization
 */
export class TrustManager {
  constructor() {
    this.performanceTracker = getPerformanceTracker();
    this.currentStrategy = 'balanced';
    this.strategyHistory = [];
    this.decisionHistory = [];
  }
  
  /**
   * Get current trust weights
   * @returns {Object} Trust weights for each method
   */
  async getTrustWeights() {
    await this.performanceTracker.ensureInitialized();
    return this.performanceTracker.getTrustWeights();
  }
  
  /**
   * Determine categorization strategy based on system state
   * @param {Object} systemStats - Current system statistics
   * @returns {Object} Strategy configuration
   */
  async determineStrategy(systemStats) {
    const modelStats = systemStats.methods.model;
    const weights = await this.getTrustWeights();
    
    // Not enough model data - rely on rules and LLM
    if (modelStats.totalPredictions < ML_CONFIG.training.minTrainingExamples) {
      return {
        name: 'early_stage',
        description: 'Not enough data for ML model',
        weights: {
          rules: 0.5,
          model: 0.0,
          llm: 0.5
        },
        useModel: false,
        fallbackOrder: ['rules', 'llm']
      };
    }
    
    // Model is learning but not confident yet
    if (modelStats.totalPredictions < 500 || modelStats.confidence < 0.7) {
      return {
        name: 'learning',
        description: 'Model is still learning',
        weights: weights,
        useModel: true,
        modelThreshold: ML_CONFIG.confidence.mediumConfidence,
        fallbackOrder: ['rules', 'model', 'llm']
      };
    }
    
    // Check if any method is significantly better
    const accuracies = Object.values(systemStats.methods).map(m => m.accuracy);
    const maxAccuracy = Math.max(...accuracies);
    const avgAccuracy = accuracies.reduce((sum, acc) => sum + acc, 0) / accuracies.length;
    
    // One method is dominant
    if (maxAccuracy - avgAccuracy > 0.15) {
      const dominantMethod = Object.entries(systemStats.methods)
        .find(([_, stats]) => stats.accuracy === maxAccuracy)[0];
      
      return {
        name: 'dominant',
        description: `${dominantMethod} is significantly better`,
        weights: weights,
        useModel: true,
        primaryMethod: dominantMethod,
        fallbackOrder: this.orderByAccuracy(systemStats.methods)
      };
    }
    
    // Model is improving rapidly
    if (modelStats.trend === 'improving' && modelStats.accuracy > 0.7) {
      // Boost model weight temporarily
      const boostedWeights = { ...weights };
      boostedWeights.model = Math.min(0.7, boostedWeights.model * 1.5);
      
      // Renormalize
      const total = Object.values(boostedWeights).reduce((sum, w) => sum + w, 0);
      Object.keys(boostedWeights).forEach(method => {
        boostedWeights[method] /= total;
      });
      
      return {
        name: 'model_boost',
        description: 'Model is improving rapidly',
        weights: boostedWeights,
        useModel: true,
        modelThreshold: ML_CONFIG.confidence.lowConfidence,
        fallbackOrder: ['model', 'rules', 'llm']
      };
    }
    
    // Balanced approach - all methods contribute
    return {
      name: 'balanced',
      description: 'Using weighted voting from all methods',
      weights: weights,
      useModel: true,
      votingStrategy: 'weighted',
      conflictResolution: 'highest_confidence'
    };
  }
  
  /**
   * Order methods by accuracy
   * @param {Object} methodStats - Statistics for each method
   * @returns {Array<string>} Methods ordered by accuracy
   */
  orderByAccuracy(methodStats) {
    return Object.entries(methodStats)
      .sort((a, b) => b[1].accuracy - a[1].accuracy)
      .map(([method, _]) => method);
  }
  
  /**
   * Make a decision based on predictions from all methods
   * @param {Object} predictions - Predictions from each method
   * @param {Object} confidences - Confidence scores
   * @returns {Object} Final decision with reasoning
   */
  async makeDecision(predictions, confidences = {}) {
    const systemStats = this.performanceTracker.getSystemStats();
    const strategy = await this.determineStrategy(systemStats);
    
    // Log strategy selection (only once per batch)
    if (!this._strategyLogged) {
      this._strategyLogged = true;
      // Reset flag after a delay to show strategy periodically
      setTimeout(() => { this._strategyLogged = false; }, 60000);
    }
    
    // Record strategy if changed
    if (strategy.name !== this.currentStrategy) {
      this.currentStrategy = strategy.name;
      this.strategyHistory.push({
        timestamp: Date.now(),
        strategy: strategy.name,
        reason: strategy.description
      });
      
      await recordMetric({
        method: 'system',
        type: 'strategy_change',
        value: 1,
        metadata: strategy
      });
    }
    
    // Apply strategy
    let decision;
    switch (strategy.name) {
      case 'early_stage':
        decision = this.earlyStageDecision(predictions, strategy);
        break;
        
      case 'learning':
        decision = this.learningStageDecision(predictions, confidences, strategy);
        break;
        
      case 'dominant':
        decision = this.dominantMethodDecision(predictions, confidences, strategy);
        break;
        
      case 'model_boost':
        decision = this.modelBoostDecision(predictions, confidences, strategy);
        break;
        
      case 'balanced':
      default:
        decision = this.balancedDecision(predictions, confidences, strategy);
    }
    
    // Add metadata
    decision.strategy = strategy.name;
    decision.timestamp = Date.now();
    
    // Record decision
    this.decisionHistory.push(decision);
    
    return decision;
  }
  
  /**
   * Early stage decision - no model yet
   */
  earlyStageDecision(predictions) {
    // Prefer rules if available
    if (predictions.rules !== undefined && predictions.rules !== null) {
      return {
        category: predictions.rules,
        source: 'rules',
        confidence: 0.8,
        reasoning: 'Using rule-based categorization'
      };
    }
    
    // Fall back to LLM
    if (predictions.llm !== undefined && predictions.llm !== null) {
      return {
        category: predictions.llm,
        source: 'llm',
        confidence: 0.7,
        reasoning: 'Using LLM categorization (no rules matched)'
      };
    }
    
    // No predictions available - return null to indicate uncategorizable
    return {
      category: null,
      source: 'none',
      confidence: 0,
      reasoning: 'No predictions available - tab remains uncategorized'
    };
  }
  
  /**
   * Learning stage decision - model is training
   */
  learningStageDecision(predictions, confidences, strategy) {
    const modelConfidence = confidences.model || 0;
    
    // Use model if confident enough
    if (predictions.model !== undefined && modelConfidence >= strategy.modelThreshold) {
      return {
        category: predictions.model,
        source: 'model',
        confidence: modelConfidence,
        reasoning: `Model prediction with ${(modelConfidence * 100).toFixed(0)}% confidence`
      };
    }
    
    // Fall back to other methods
    return this.fallbackDecision(predictions, confidences, strategy.fallbackOrder);
  }
  
  /**
   * Dominant method decision
   */
  dominantMethodDecision(predictions, confidences, strategy) {
    const primary = strategy.primaryMethod;
    
    if (predictions[primary] !== undefined && predictions[primary] !== null) {
      return {
        category: predictions[primary],
        source: primary,
        confidence: confidences[primary] || strategy.weights[primary],
        reasoning: `Using ${primary} (highest accuracy method)`
      };
    }
    
    // Fallback if primary method has no prediction
    return this.fallbackDecision(predictions, confidences, strategy.fallbackOrder);
  }
  
  /**
   * Model boost decision - model is improving
   */
  modelBoostDecision(predictions, confidences, strategy) {
    const modelConfidence = confidences.model || 0;
    
    // Prefer model even with lower confidence
    if (predictions.model !== undefined && modelConfidence >= strategy.modelThreshold) {
      return {
        category: predictions.model,
        source: 'model',
        confidence: modelConfidence,
        reasoning: 'Prioritizing improving model'
      };
    }
    
    // Weighted voting as fallback
    return this.balancedDecision(predictions, confidences, strategy);
  }
  
  /**
   * Balanced decision - weighted voting
   */
  balancedDecision(predictions, confidences, strategy) {
    const weights = strategy.weights;
    const votes = {};
    const voteDetails = [];
    
    // Calculate weighted votes for each category
    for (let category = 0; category <= 3; category++) {
      votes[category] = 0;
    }
    
    // Add weighted votes from each method
    for (const method of ['rules', 'model', 'llm']) {
      if (predictions[method] !== undefined && predictions[method] !== null) {
        const category = predictions[method];
        const confidence = confidences[method] || 1.0;
        const weight = weights[method];
        const vote = weight * confidence;
        
        votes[category] += vote;
        
        voteDetails.push({
          method,
          category,
          weight,
          confidence,
          vote
        });
      }
    }
    
    // Find winning category
    let bestCategory = null; // No default
    let bestScore = 0;
    let totalVotes = 0;
    
    for (const [category, score] of Object.entries(votes)) {
      totalVotes += score;
      if (score > bestScore) {
        bestScore = score;
        bestCategory = parseInt(category);
      }
    }
    
    // Calculate decision confidence
    const decisionConfidence = totalVotes > 0 ? bestScore / totalVotes : 0;
    
    // If no votes, return null category
    if (totalVotes === 0 || bestCategory === null) {
      return {
        category: null,
        source: 'none',
        confidence: 0,
        reasoning: 'No predictions to vote on - tab remains uncategorized'
      };
    }
    
    // Handle ties or low confidence
    if (decisionConfidence < 0.4) {
      return this.handleLowConfidence(predictions, confidences, voteDetails);
    }
    
    return {
      category: bestCategory,
      source: 'weighted_vote',
      confidence: decisionConfidence,
      reasoning: this.explainVoting(voteDetails, bestCategory),
      votes,
      voteDetails
    };
  }
  
  /**
   * Fallback decision when primary method unavailable
   */
  fallbackDecision(predictions, confidences, order) {
    for (const method of order) {
      if (predictions[method] !== undefined && predictions[method] !== null) {
        return {
          category: predictions[method],
          source: method,
          confidence: confidences[method] || 0.5,
          reasoning: `Using ${method} as fallback`
        };
      }
    }
    
    // No predictions available - return null to indicate uncategorizable
    return {
      category: null,
      source: 'none',
      confidence: 0,
      reasoning: 'No predictions available - tab remains uncategorized'
    };
  }
  
  /**
   * Handle low confidence situations
   */
  handleLowConfidence(predictions, confidences, voteDetails) {
    // Check if methods agree
    const categories = Object.entries(predictions)
      .filter(([_, cat]) => cat !== undefined && cat !== null)
      .map(([_, cat]) => cat);
    
    if (categories.length === 0) {
      return {
        category: null,
        source: 'none',
        confidence: 0,
        reasoning: 'No predictions available - tab remains uncategorized'
      };
    }
    
    // Check for consensus
    const uniqueCategories = [...new Set(categories)];
    
    if (uniqueCategories.length === 1) {
      // All methods agree
      return {
        category: uniqueCategories[0],
        source: 'consensus',
        confidence: 0.8,
        reasoning: 'All methods agree on category',
        voteDetails
      };
    }
    
    // No consensus - use method with highest individual confidence
    let bestMethod = null;
    let bestConfidence = 0;
    
    for (const [method, confidence] of Object.entries(confidences)) {
      if (confidence > bestConfidence && predictions[method] !== undefined) {
        bestConfidence = confidence;
        bestMethod = method;
      }
    }
    
    if (bestMethod) {
      return {
        category: predictions[bestMethod],
        source: bestMethod,
        confidence: bestConfidence * 0.8, // Reduce confidence due to disagreement
        reasoning: `Using ${bestMethod} with highest confidence despite disagreement`,
        voteDetails
      };
    }
    
    // No confident predictions - return null
    return {
      category: null,
      source: 'none',
      confidence: 0,
      reasoning: 'Low confidence in all predictions - tab remains uncategorized',
      voteDetails
    };
  }
  
  /**
   * Explain voting decision
   */
  explainVoting(voteDetails, winningCategory) {
    const categoryVotes = voteDetails.filter(v => v.category === winningCategory);
    const supportingMethods = categoryVotes.map(v => v.method);
    
    if (supportingMethods.length === 3) {
      return 'All methods agree on this category';
    }
    
    const explanation = `Voted by ${supportingMethods.join(' and ')}`;
    
    // Add confidence info
    const avgConfidence = categoryVotes.reduce((sum, v) => sum + v.confidence, 0) / categoryVotes.length;
    
    return `${explanation} with ${(avgConfidence * 100).toFixed(0)}% average confidence`;
  }
  
  /**
   * Update trust based on user feedback
   * @param {Object} decision - Original decision
   * @param {number} actualCategory - Actual category (user corrected)
   */
  async updateTrust(decision, actualCategory) {
    const wasCorrect = decision.category === actualCategory;
    
    // Update performance tracker
    const predictions = decision.voteDetails ? 
      Object.fromEntries(decision.voteDetails.map(v => [v.method, v.category])) :
      { [decision.source]: decision.category };
    
    await this.performanceTracker.recordPrediction(
      predictions,
      actualCategory,
      wasCorrect ? 'confirmed' : 'corrected'
    );
    
    // Record trust update
    await recordMetric({
      method: 'system',
      type: 'trust_update',
      value: wasCorrect ? 1 : 0,
      metadata: {
        decision,
        actualCategory,
        strategy: this.currentStrategy
      }
    });
  }
  
  /**
   * Reset trust weights and performance data
   */
  async resetTrust() {
    // Reset performance tracker
    if (this.performanceTracker && typeof this.performanceTracker.reset === 'function') {
      await this.performanceTracker.reset();
    }
    
    // Reset strategy to default
    this.currentStrategy = 'balanced';
    this.strategyHistory = [];
    this.decisionHistory = [];
    
  }

  /**
   * Get trust manager statistics
   */
  getStatistics() {
    return {
      currentStrategy: this.currentStrategy,
      trustWeights: this.getTrustWeights(),
      systemStats: this.performanceTracker.getSystemStats(),
      recentDecisions: this.decisionHistory.slice(-10),
      strategyHistory: this.strategyHistory.slice(-10)
    };
  }
}

// Export singleton
let trustManagerInstance = null;

export function getTrustManager() {
  if (!trustManagerInstance) {
    trustManagerInstance = new TrustManager();
  }
  return trustManagerInstance;
}

export default {
  TrustManager,
  getTrustManager
};