/*
 * AI Tab Manager - Ensemble Voter
 * Implements weighted voting system for combining predictions
 */

import { getTrustManager } from '../trust/trust-manager.js';
import { ML_CONFIG } from '../model-config.js';

/**
 * Ensemble Voter for combining predictions from multiple methods
 */
export class EnsembleVoter {
  constructor() {
    this.trustManager = getTrustManager();
    this.votingHistory = [];
  }
  
  /**
   * Vote on tab categories using all available methods
   * @param {Object} allPredictions - Predictions from all methods
   * @returns {Object} Final categorizations with metadata
   */
  async vote(allPredictions) {
    const { rules, model, llm } = allPredictions;
    const results = {};
    const metadata = {};
    
    // Get current trust weights
    const trustWeights = await this.trustManager.getTrustWeights();
    
    // Process each tab
    const tabIds = this.getAllTabIds(allPredictions);
    
    for (const tabId of tabIds) {
      // Gather predictions for this tab
      const predictions = {
        rules: rules?.[tabId]?.category,
        model: model?.[tabId]?.category,
        llm: llm?.[tabId]?.category
      };
      
      // Gather confidence scores
      const confidences = {
        rules: rules?.[tabId]?.confidence || 1.0, // Rules are deterministic
        model: model?.[tabId]?.confidence || 0.5,
        llm: llm?.[tabId]?.confidence || 0.8
      };
      
      // Make decision using trust manager
      const decision = await this.trustManager.makeDecision(predictions, confidences);
      
      // Store result only if we have a valid category
      if (decision.category !== null && decision.category !== undefined) {
        results[tabId] = decision.category;
      } else {
        // No category - tab remains uncategorized
        console.log(`Tab ${tabId} has no predictions and remains uncategorized`);
        continue; // Skip this tab
      }
      
      // Calculate combined confidence
      const combinedConfidence = await this.calculateCombinedConfidence(
        predictions, 
        confidences, 
        decision.category
      );
      
      // Store metadata for transparency
      metadata[tabId] = {
        ...decision,
        predictions,
        confidences,
        combinedConfidence,
        trustWeights: { ...trustWeights },
        agreement: this.calculateAgreement(predictions)
      };
    }
    
    // Record voting session
    this.recordVotingSession(results, metadata);
    
    return {
      categories: results,
      metadata,
      summary: this.generateSummary(results, metadata)
    };
  }
  
  /**
   * Get all unique tab IDs from predictions
   */
  getAllTabIds(allPredictions) {
    const tabIds = new Set();
    
    Object.values(allPredictions).forEach(methodPredictions => {
      if (methodPredictions) {
        Object.keys(methodPredictions).forEach(tabId => tabIds.add(tabId));
      }
    });
    
    return Array.from(tabIds);
  }
  
  /**
   * Perform simple majority voting (for comparison)
   * @param {Object} predictions - Predictions from each method
   * @returns {number} Winning category
   */
  majorityVote(predictions) {
    const votes = {};
    
    Object.values(predictions).forEach(category => {
      if (category !== undefined && category !== null) {
        votes[category] = (votes[category] || 0) + 1;
      }
    });
    
    // Find category with most votes
    let maxVotes = 0;
    let winner = 2; // Default to Useful
    
    Object.entries(votes).forEach(([category, count]) => {
      if (count > maxVotes) {
        maxVotes = count;
        winner = parseInt(category);
      }
    });
    
    return winner;
  }
  
  /**
   * Calculate agreement between methods
   * @param {Object} predictions - Predictions from each method
   * @returns {number} Agreement score (0-1)
   */
  calculateAgreement(predictions) {
    const values = Object.values(predictions).filter(v => v !== undefined && v !== null);
    
    if (values.length <= 1) return 1.0;
    
    const uniqueValues = new Set(values);
    return 1 - (uniqueValues.size - 1) / (values.length - 1);
  }
  
  /**
   * Calculate combined confidence based on individual confidences and agreement
   * Using probabilistic methods for proper confidence combination
   * 
   * Mathematical approaches used:
   * 1. Bayesian combination using log-odds averaging
   * 2. Agreement-based adjustments:
   *    - Perfect agreement: Multiplicative rule P(all correct) = 1 - ∏(1 - p_i)
   *    - Low agreement: Harmonic mean (conservative)
   *    - Mixed agreement: Geometric mean
   * 
   * @param {Object} predictions - Predictions from each method
   * @param {Object} confidences - Individual confidence scores
   * @param {number} finalCategory - The final decided category
   * @returns {number} Combined confidence (0-1)
   */
  async calculateCombinedConfidence(predictions, confidences, finalCategory) {
    // Get methods that participated in prediction
    const activeMethods = Object.entries(predictions)
      .filter(([_, pred]) => pred !== undefined && pred !== null);
    
    if (activeMethods.length === 0) return 0.3; // Default low confidence
    
    const trustWeights = await this.trustManager.getTrustWeights();
    
    // STEP 1: Apply trust weights to confidences FIRST
    const weightedConfidences = {};
    activeMethods.forEach(([method, _]) => {
      const confidence = confidences[method] || 0.5;
      const weight = trustWeights[method] || 0.33;
      // Apply trust weight to get weighted confidence
      weightedConfidences[method] = confidence * weight;
    });
    
    // Method 1: Weighted Bayesian combination using pre-weighted confidences
    // For each method, we have P(correct|method_predicts_category)
    // We want P(correct|all_methods_predictions)
    
    // Collect probabilities for and against the final category
    let logOddsSum = 0;
    let methodCount = 0;
    
    activeMethods.forEach(([method, prediction]) => {
      const weightedConf = weightedConfidences[method];
      
      // If method predicted the final category, use weighted confidence as-is
      // If method predicted differently, adjust accordingly
      let probCorrect;
      if (prediction === finalCategory) {
        probCorrect = weightedConf;
      } else {
        // Method predicted something else
        // Probability it should have been finalCategory is lower
        const numCategories = 4; // 0-3
        probCorrect = (1 - weightedConf) / (numCategories - 1);
      }
      
      // Prevent extreme values
      probCorrect = Math.max(0.01, Math.min(0.99, probCorrect));
      
      // Convert to log odds
      const logOdds = Math.log(probCorrect / (1 - probCorrect));
      
      logOddsSum += logOdds;
      methodCount++;
    });
    
    // Average log odds
    const avgLogOdds = logOddsSum / methodCount;
    
    // Convert back to probability
    const combinedProb = 1 / (1 + Math.exp(-avgLogOdds));
    
    // Method 2: Agreement-based adjustment
    // Calculate how much methods agree
    const agreement = this.calculateAgreement(predictions);
    const agreeingWithFinal = activeMethods.filter(([_, pred]) => pred === finalCategory).length;
    const agreementRatio = agreeingWithFinal / activeMethods.length;
    
    
    // Adjust confidence based on agreement
    // High agreement = higher confidence, low agreement = lower confidence
    let finalConfidence;
    
    if (agreement === 1.0) {
      // All methods agree - use multiplicative combination for boost
      // P(all_correct) = 1 - P(all_wrong) = 1 - ∏(1 - weighted_p_i)
      let probAllWrong = 1;
      activeMethods.forEach(([method, _]) => {
        const weightedConf = weightedConfidences[method];
        // Use pre-weighted confidence
        probAllWrong *= (1 - weightedConf);
      });
      finalConfidence = 1 - probAllWrong;
    } else if (agreementRatio < 0.5) {
      // Majority disagrees - significant uncertainty
      // Use harmonic mean for conservative estimate
      let harmonicSum = 0;
      let count = 0;
      activeMethods.forEach(([method, prediction]) => {
        if (prediction === finalCategory) {
          const weightedConf = weightedConfidences[method];
          harmonicSum += 1 / weightedConf;
          count++;
        }
      });
      finalConfidence = count > 0 ? count / harmonicSum : combinedProb;
      // Further reduce by disagreement factor
      finalConfidence *= agreementRatio;
    } else {
      // Mixed agreement - use geometric mean of weighted confidences
      let logSum = 0;
      let count = 0;
      activeMethods.forEach(([method, prediction]) => {
        const weightedConf = prediction === finalCategory ? 
          weightedConfidences[method] : 
          (1 - weightedConfidences[method]) / 3;
        const logConf = Math.log(Math.max(0.01, weightedConf));
        logSum += logConf;
        count++;
      });
      finalConfidence = Math.exp(logSum / count);
    }
    
    // Combine both methods with agreement weighting
    const combined = (combinedProb * 0.6 + finalConfidence * 0.4);
    
    // Ensure within reasonable bounds
    const bounded = Math.max(0.05, Math.min(0.95, combined));
    
    return bounded;
  }
  
  /**
   * Resolve conflicts between predictions
   * @param {Object} predictions - Predictions from each method
   * @param {Object} confidences - Confidence scores
   * @param {string} strategy - Conflict resolution strategy
   * @returns {Object} Resolved decision
   */
  async resolveConflict(predictions, confidences, strategy = 'highest_confidence') {
    switch (strategy) {
      case 'highest_confidence':
        return this.highestConfidenceResolution(predictions, confidences);
        
      case 'trust_weighted':
        return await this.trustWeightedResolution(predictions, confidences);
        
      case 'conservative':
        return this.conservativeResolution(predictions);
        
      case 'aggressive':
        return this.aggressiveResolution(predictions);
        
      default:
        return this.highestConfidenceResolution(predictions, confidences);
    }
  }
  
  /**
   * Resolve by highest confidence
   */
  highestConfidenceResolution(predictions, confidences) {
    let bestMethod = null;
    let bestConfidence = 0;
    let bestCategory = 2; // Default
    
    Object.entries(predictions).forEach(([method, category]) => {
      if (category !== undefined && category !== null) {
        const confidence = confidences[method] || 0;
        if (confidence > bestConfidence) {
          bestConfidence = confidence;
          bestMethod = method;
          bestCategory = category;
        }
      }
    });
    
    return {
      category: bestCategory,
      source: bestMethod || 'default',
      confidence: bestConfidence,
      reasoning: `Highest confidence from ${bestMethod}`
    };
  }
  
  /**
   * Resolve using trust weights
   */
  async trustWeightedResolution(predictions, confidences) {
    const trustWeights = await this.trustManager.getTrustWeights();
    let bestScore = 0;
    let bestMethod = null;
    let bestCategory = 2;
    
    Object.entries(predictions).forEach(([method, category]) => {
      if (category !== undefined && category !== null) {
        const confidence = confidences[method] || 1.0;
        const trust = trustWeights[method] || 0.33;
        const score = confidence * trust;
        
        if (score > bestScore) {
          bestScore = score;
          bestMethod = method;
          bestCategory = category;
        }
      }
    });
    
    return {
      category: bestCategory,
      source: bestMethod || 'default',
      confidence: bestScore,
      reasoning: `Trust-weighted decision from ${bestMethod}`
    };
  }
  
  /**
   * Conservative resolution - prefer safer categories
   */
  conservativeResolution(predictions) {
    // Priority order: Important > Useful > Ignore
    const priority = [3, 2, 1, 0];
    
    for (const targetCategory of priority) {
      const methods = Object.entries(predictions)
        .filter(([_, cat]) => cat === targetCategory)
        .map(([method, _]) => method);
      
      if (methods.length > 0) {
        return {
          category: targetCategory,
          source: methods.join('+'),
          confidence: 0.7,
          reasoning: `Conservative choice: ${this.getCategoryName(targetCategory)}`
        };
      }
    }
    
    return {
      category: 2,
      source: 'default',
      confidence: 0.5,
      reasoning: 'Conservative default to Useful'
    };
  }
  
  /**
   * Aggressive resolution - prefer action categories
   */
  aggressiveResolution(predictions) {
    // Priority order: Ignore > Important > Useful
    const priority = [1, 3, 2, 0];
    
    for (const targetCategory of priority) {
      const methods = Object.entries(predictions)
        .filter(([_, cat]) => cat === targetCategory)
        .map(([method, _]) => method);
      
      if (methods.length > 0) {
        return {
          category: targetCategory,
          source: methods.join('+'),
          confidence: 0.7,
          reasoning: `Aggressive choice: ${this.getCategoryName(targetCategory)}`
        };
      }
    }
    
    return {
      category: 1,
      source: 'default',
      confidence: 0.5,
      reasoning: 'Aggressive default to Ignore'
    };
  }
  
  /**
   * Get category name
   */
  getCategoryName(category) {
    const names = ['Uncategorized', 'Ignore', 'Useful', 'Important'];
    return names[category] || 'Unknown';
  }
  
  /**
   * Record voting session for analysis
   */
  recordVotingSession(results, metadata) {
    // Calculate confidence statistics
    const confidenceStats = {
      avgCombined: 0,
      avgIndividual: 0,
      perfectAgreementBoost: 0,
      disagreementPenalty: 0,
      count: 0
    };
    
    Object.values(metadata).forEach(meta => {
      if (meta.combinedConfidence !== undefined) {
        confidenceStats.avgCombined += meta.combinedConfidence;
        confidenceStats.avgIndividual += (meta.confidence || 0);
        confidenceStats.count++;
        
        // Track boost/penalty from agreement
        if (meta.agreement === 1.0) {
          confidenceStats.perfectAgreementBoost += (meta.combinedConfidence - meta.confidence);
        } else if (meta.agreement < 0.5) {
          confidenceStats.disagreementPenalty += (meta.confidence - meta.combinedConfidence);
        }
      }
    });
    
    if (confidenceStats.count > 0) {
      confidenceStats.avgCombined /= confidenceStats.count;
      confidenceStats.avgIndividual /= confidenceStats.count;
    }
    
    const session = {
      timestamp: Date.now(),
      tabCount: Object.keys(results).length,
      distribution: this.calculateDistribution(results),
      agreementStats: this.calculateAgreementStats(metadata),
      confidenceStats,
      strategyUsed: metadata[Object.keys(metadata)[0]]?.strategy || 'unknown'
    };
    
    this.votingHistory.push(session);
    
    // Keep only recent history
    if (this.votingHistory.length > 100) {
      this.votingHistory.shift();
    }
  }
  
  /**
   * Calculate category distribution
   */
  calculateDistribution(results) {
    const distribution = { 0: 0, 1: 0, 2: 0, 3: 0 };
    
    Object.values(results).forEach(category => {
      distribution[category] = (distribution[category] || 0) + 1;
    });
    
    return distribution;
  }
  
  /**
   * Calculate agreement statistics
   */
  calculateAgreementStats(metadata) {
    let totalAgreement = 0;
    let count = 0;
    
    Object.values(metadata).forEach(meta => {
      if (meta.predictions) {
        const agreement = this.calculateAgreement(meta.predictions);
        totalAgreement += agreement;
        count++;
      }
    });
    
    return {
      averageAgreement: count > 0 ? totalAgreement / count : 0,
      perfectAgreement: Object.values(metadata).filter(meta => 
        this.calculateAgreement(meta.predictions || {}) === 1.0
      ).length,
      totalDisagreement: Object.values(metadata).filter(meta => 
        this.calculateAgreement(meta.predictions || {}) === 0
      ).length
    };
  }
  
  /**
   * Generate voting summary
   */
  generateSummary(results, metadata) {
    const distribution = this.calculateDistribution(results);
    const agreementStats = this.calculateAgreementStats(metadata);
    
    // Count decision sources
    const sources = {};
    Object.values(metadata).forEach(meta => {
      const source = meta.source || 'unknown';
      sources[source] = (sources[source] || 0) + 1;
    });
    
    // Calculate average combined confidence
    const avgCombinedConfidence = Object.values(metadata)
      .reduce((sum, m) => sum + (m.combinedConfidence || 0), 0) / Object.keys(metadata).length;
    
    // Calculate average individual method confidence (for comparison)
    const avgIndividualConfidence = Object.values(metadata)
      .reduce((sum, m) => sum + (m.confidence || 0), 0) / Object.keys(metadata).length;
    
    return {
      totalTabs: Object.keys(results).length,
      distribution,
      agreementStats,
      decisionSources: sources,
      dominantSource: Object.entries(sources)
        .sort((a, b) => b[1] - a[1])[0]?.[0] || 'none',
      averageConfidence: avgCombinedConfidence, // Use combined confidence
      averageIndividualConfidence: avgIndividualConfidence, // Keep individual for comparison
      confidenceBoost: avgCombinedConfidence - avgIndividualConfidence // How much agreement helped
    };
  }
  
  /**
   * Get voting statistics
   */
  getStatistics() {
    if (this.votingHistory.length === 0) {
      return { message: 'No voting history available' };
    }
    
    const recentSessions = this.votingHistory.slice(-10);
    
    return {
      totalSessions: this.votingHistory.length,
      recentSessions,
      averageTabsPerSession: this.votingHistory
        .reduce((sum, s) => sum + s.tabCount, 0) / this.votingHistory.length,
      averageAgreement: recentSessions
        .reduce((sum, s) => sum + s.agreementStats.averageAgreement, 0) / recentSessions.length,
      strategyDistribution: this.getStrategyDistribution()
    };
  }
  
  /**
   * Get distribution of strategies used
   */
  getStrategyDistribution() {
    const strategies = {};
    
    this.votingHistory.forEach(session => {
      const strategy = session.strategyUsed;
      strategies[strategy] = (strategies[strategy] || 0) + 1;
    });
    
    return strategies;
  }
}

// Export singleton
let voterInstance = null;

export function getEnsembleVoter() {
  if (!voterInstance) {
    voterInstance = new EnsembleVoter();
  }
  return voterInstance;
}

export default {
  EnsembleVoter,
  getEnsembleVoter
};