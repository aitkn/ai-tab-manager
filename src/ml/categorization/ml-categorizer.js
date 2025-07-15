/*
 * AI Tab Manager - ML Categorizer
 * Integrates ML system with categorization flow
 */

import { getTabClassifier } from '../models/tab-classifier.js';
import { getEnsembleVoter } from '../voting/ensemble-voter.js';
import { getFeedbackProcessor } from '../learning/feedback-processor.js';
import { getPerformanceTracker } from '../trust/performance-tracker.js';
import { ML_CONFIG } from '../model-config.js';
import logger from '../../utils/logger.js';
import { TAB_CATEGORIES } from '../../utils/constants.js';

/**
 * ML Categorizer for tab categorization
 */
export class MLCategorizer {
  constructor() {
    this.classifier = null;
    this.voter = null;
    this.feedbackProcessor = null;
    this.performanceTracker = null;
    this.isInitialized = false;
  }
  
  /**
   * Initialize the ML categorizer
   * @param {Object} settings - Optional settings to determine if ML should be loaded
   */
  async initialize(settings = null) {
    if (this.isInitialized) return;
    
    // Check if training is being resumed - avoid conflicts with model loading
    // In Web Worker context, window is not available, use typeof check
    if (typeof window !== 'undefined' && window._trainingInProgress) {
      logger.mlTraining('🔄 Training in progress - deferring ML categorizer initialization');
      // Don't initialize the classifier now, but mark as initialized to prevent retry
      this.isInitialized = true;
      this.classifier = null; // Will be loaded later when training completes
      this.voter = getEnsembleVoter();
      this.feedbackProcessor = getFeedbackProcessor();
      this.performanceTracker = getPerformanceTracker();
      return;
    }
    
    try {
      // Check if ML is enabled
      const mlEnabled = settings ? settings.useML !== false : true;
      
      if (mlEnabled) {
        // Load components with WebGL error handling
        this.classifier = await this.loadClassifierWithFallback();
      } else {
        console.log('ML is disabled in settings - skipping TensorFlow initialization');
        this.classifier = null;
      }
      
      // Always initialize these components (they don't require TensorFlow)
      this.voter = getEnsembleVoter();
      this.feedbackProcessor = getFeedbackProcessor();
      this.performanceTracker = getPerformanceTracker();
      
      // Check if classifier is disabled or model doesn't exist
      if (this.classifier && this.classifier.disabled) {
        console.log('ML classifier disabled - no training data available yet');
      } else if (this.classifier) {
        const modelExists = await this.classifier.exists();
        if (!modelExists) {
          logger.mlArchitecture('ML model not found, will use rules/LLM only');
        }
      }
      
      this.isInitialized = true;
      
    } catch (error) {
      console.error('Error initializing ML categorizer:', error);
      // Continue without ML - fallback to rules/LLM
      this.isInitialized = true;
    }
  }
  
  /**
   * Load classifier with WebGL error fallback
   */
  async loadClassifierWithFallback() {
    try {
      const classifier = await getTabClassifier();
      
      // Check if classifier is disabled (no training data)
      if (classifier && classifier.disabled) {
        console.log('Classifier is disabled due to no training data - skipping CPU fallback');
        return classifier;
      }
      
      // Check if the model loaded properly
      // A model is valid if it has the model property set (regardless of accuracy)
      if (classifier && classifier.model) {
        logger.mlArchitecture('Classifier loaded successfully on WebGL');
        return classifier;
      } else {
        // Model structure loaded but the actual model failed to load
        logger.mlArchitecture('Model failed to load properly, attempting CPU fallback');
        return await this.attemptCPUFallback();
      }
      
    } catch (error) {
      console.error('Error loading classifier:', error);
      
      // Check if it's a specific WebGL context or memory error that requires CPU fallback
      if (error.message && (
        error.message.includes('Maximum call stack') ||  // Stack overflow issue
        error.message.includes('WebGL context lost') ||  // Context lost
        error.message.includes('Out of memory') ||       // GPU memory issue
        error.message.includes('Failed to create WebGL context') || // Context creation failed
        error.name === 'RangeError'                      // Stack overflow
      )) {
        logger.mlArchitecture('Detected WebGL/memory issue, attempting CPU fallback:', error.message);
        return await this.attemptCPUFallback();
      } else if (error.message && (error.message.includes('Cannot build vocabulary') || 
                                    error.message.includes('No training data available'))) {
        // This is a data issue, not a WebGL issue - don't switch backends
        // getTabClassifier will return a disabled classifier
        throw error; // Re-throw to let the initialize method handle it
      } else {
        throw error; // Re-throw other errors
      }
    }
  }
  
  /**
   * Attempt to load classifier on CPU backend
   */
  async attemptCPUFallback() {
    // Switch to CPU backend
    const { switchBackend } = await import('../tensorflow-loader.js');
    await switchBackend('cpu');
    
    // Reset classifier cache and try loading again on CPU
    const { resetTabClassifierCache } = await import('../models/tab-classifier.js');
    resetTabClassifierCache();
    
    // Try loading classifier again on CPU
    const classifier = await getTabClassifier(true); // Force reload
    
    // Switch back to GPU for inference if possible
    // The CPU fallback was only needed for model loading, not inference
    const { getBackendInfo } = await import('../tensorflow-loader.js');
    const backendInfo = getBackendInfo();
    if (backendInfo.available.includes('webgl')) {
      try {
        await switchBackend('webgl');
        logger.mlArchitecture('Switched back to GPU for inference after successful model loading on CPU');
      } catch (switchError) {
        logger.mlArchitecture('Could not switch back to GPU, staying on CPU:', switchError.message);
      }
    }
    
    return classifier;
  }
  
  /**
   * Categorize tabs using ML + rules + LLM ensemble
   * @param {Array} tabs - Tabs to categorize
   * @param {Object} options - Categorization options
   * @returns {Object} Categorization results with metadata
   */
  async categorizeTabs(tabs, options = {}) {
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    const {
      rules = [],
      llmResults = null,
      useLLM = true,
      useML = true,
      useRules = true
    } = options;
    
    // Prepare predictions from each method
    const allPredictions = {};
    
    // 1. Rule-based predictions
    if (useRules && rules.length > 0) {
      allPredictions.rules = await this.getRulePredictions(tabs, rules);
    }
    
    // 2. ML predictions
    if (useML && this.classifier && await this.classifier.exists()) {
      try {
        allPredictions.model = await this.getMLPredictions(tabs);
      } catch (error) {
        console.error('Error getting ML predictions:', error);
        // Propagate ML errors to stop categorization
        throw new Error(`ML categorization failed: ${error.message}`);
      }
    }
    
    // 3. LLM predictions (passed in from existing categorization)
    if (useLLM && llmResults) {
      allPredictions.llm = this.formatLLMResults(tabs, llmResults);
    }
    
    // 4. Ensemble voting
    const votingResults = await this.voter.vote(allPredictions);
    
    // 5. Format final results
    const finalResults = this.formatFinalResults(tabs, votingResults);
    
    // 6. Track performance for enabled methods
    await this.trackPerformance(votingResults);
    
    return finalResults;
  }
  
  /**
   * Get rule-based predictions
   */
  async getRulePredictions(tabs, rules) {
    const predictions = {};
    
    // Import rule application logic
    const { applyRulesToTabs } = await import('../../modules/categorization-service.js');
    const { extractDomain } = await import('../../utils/helpers.js');
    const { RULE_TYPES, RULE_FIELDS } = await import('../../utils/constants.js');
    
    // Apply rules to each tab
    tabs.forEach(tab => {
      let category = null;
      let confidence = 1.0; // Rules are deterministic
      
      // Check each rule
      for (const rule of rules) {
        if (!rule.enabled) continue;
        
        let matches = false;
        
        switch (rule.type) {
          case RULE_TYPES.DOMAIN:
            const tabDomain = extractDomain(tab.url);
            matches = tabDomain === rule.value;
            break;
            
          case RULE_TYPES.URL_CONTAINS:
            matches = tab.url.includes(rule.value);
            break;
            
          case RULE_TYPES.TITLE_CONTAINS:
            matches = tab.title && tab.title.includes(rule.value);
            break;
            
          case RULE_TYPES.REGEX:
            try {
              const regex = new RegExp(rule.value);
              const field = rule.field === RULE_FIELDS.TITLE ? tab.title : tab.url;
              matches = regex.test(field);
            } catch (e) {
              console.error('Invalid regex:', rule.value, e);
            }
            break;
        }
        
        if (matches) {
          category = rule.category;
          break; // Apply first matching rule only
        }
      }
      
      // Store prediction if matched
      if (category !== null) {
        predictions[tab.id] = {
          category,
          confidence,
          source: 'rules'
        };
      }
    });
    
    return predictions;
  }
  
  /**
   * Get ML predictions
   */
  async getMLPredictions(tabs) {
    const predictions = {};
    
    try {
      // Process all tabs - ML should handle browser URLs gracefully
      // Prepare input data for all tabs
      const inputData = tabs.map(tab => ({
        url: tab.url || '',
        title: tab.title || '',
        id: tab.id
      }));
      
      if (inputData.length === 0) {
        return predictions;
      }
      
      // Get predictions from classifier
      const results = await this.classifier.predict(inputData);
      
      // Format predictions
      results.forEach((result, index) => {
        const tab = tabs[index];
        predictions[tab.id] = {
          category: result.category,
          confidence: result.confidence,
          source: 'model',
          probabilities: result.probabilities
        };
      });
      
    } catch (error) {
      console.error('Error in ML predictions:', error);
    }
    
    return predictions;
  }
  
  /**
   * Get ML prediction for a single tab without ensemble voting
   * @param {Object} tab - Tab data
   * @returns {Promise<Object>} Prediction result
   */
  async getSingleMLPrediction(tab) {
    try {
      const predictions = await this.getMLPredictions([tab]);
      const prediction = predictions[tab.id];
      
      if (prediction) {
        return {
          category: prediction.category,
          confidence: prediction.confidence,
          source: 'ml_model'
        };
      }
    } catch (error) {
      console.error('Error getting single ML prediction:', error);
    }
    
    return { category: null, confidence: 0, source: 'ml_error' };
  }
  
  /**
   * Format LLM results for voting
   */
  formatLLMResults(tabs, llmResults) {
    const predictions = {};
    
    // LLM results are in format: { 1: [tabs], 2: [tabs], 3: [tabs] }
    Object.entries(llmResults).forEach(([category, categoryTabs]) => {
      categoryTabs.forEach(tab => {
        predictions[tab.id] = {
          category: parseInt(category),
          confidence: 0.8, // Default LLM confidence
          source: 'llm'
        };
      });
    });
    
    return predictions;
  }
  
  /**
   * Format final results for categorization service
   */
  formatFinalResults(tabs, votingResults) {
    const categorized = {
      [TAB_CATEGORIES.UNCATEGORIZED]: [],
      [TAB_CATEGORIES.CAN_CLOSE]: [],
      [TAB_CATEGORIES.SAVE_LATER]: [],
      [TAB_CATEGORIES.IMPORTANT]: []
    };
    
    const metadata = votingResults.metadata || {};
    
    // Group tabs by category
    tabs.forEach(tab => {
      const category = votingResults.categories[tab.id];
      if (category !== undefined && categorized[category]) {
        // Add metadata to tab
        const tabWithMetadata = {
          ...tab,
          mlMetadata: metadata[tab.id]
        };
        categorized[category].push(tabWithMetadata);
      } else {
        // Uncategorized
        categorized[TAB_CATEGORIES.UNCATEGORIZED].push(tab);
      }
    });
    
    return {
      categorized,
      metadata,
      summary: votingResults.summary
    };
  }
  
  /**
   * Track performance of predictions
   */
  async trackPerformance(votingResults) {
    // Performance tracking happens when user accepts/corrects
    // This is handled by feedback processor
  }
  
  /**
   * Process user accepting categorization
   */
  async processAcceptance(tabs, categorization) {
    await this.feedbackProcessor.processAcceptance(tabs, categorization);
  }
  
  /**
   * Process user correction
   */
  async processCorrection(tab, oldCategory, newCategory, metadata) {
    await this.feedbackProcessor.processCorrection(tab, oldCategory, newCategory, metadata);
  }
  
  /**
   * Get ML system status
   */
  async getStatus() {
    const status = {
      initialized: this.isInitialized,
      modelExists: false,
      modelAccuracy: null,
      trustWeights: null,
      feedbackStats: null
    };
    
    if (this.isInitialized) {
      try {
        // Check model
        if (this.classifier) {
          // If classifier is disabled (no training data), model doesn't exist
          if (this.classifier.disabled) {
            status.modelExists = false;
            status.modelDisabled = true;
            status.modelDisabledReason = 'No training data available';
          } else {
            status.modelExists = await this.classifier.exists();
            if (status.modelExists) {
              // Get the promoted model's accuracy from the database
              // This ensures we show the accuracy of the last promoted model,
              // not a training checkpoint or outdated model
              const { loadModel } = await import('../storage/ml-database.js');
              const promotedModel = await loadModel();
              
              if (promotedModel) {
                // Use top-level accuracy if available (this is the actual accuracy of the promoted checkpoint)
                // Fall back to metadata.accuracy if top-level not available
                // Never use metadata.bestAccuracy as that's the best seen during training, not the promoted model's accuracy
                status.modelAccuracy = promotedModel.accuracy ?? promotedModel.metadata?.accuracy ?? null;
                // Using promoted model accuracy
                // Promoted model data extracted
              } else {
                // Fallback to current classifier's accuracy if no promoted model found
                const summary = this.classifier.getSummary();
                status.modelAccuracy = summary.metadata?.accuracy;
                console.log('🔍 DEBUG_PROMOTED_ACCURACY: No promoted model found, using current classifier accuracy:', status.modelAccuracy);
              }
            }
          }
        } else {
          // If classifier is null (e.g., during training), still try to get promoted model accuracy
          const { loadModel } = await import('../storage/ml-database.js');
          const promotedModel = await loadModel();
          
          if (promotedModel) {
            status.modelExists = true; // Model exists in storage
            // Use top-level accuracy if available (this is the actual accuracy of the promoted checkpoint)
            // Fall back to metadata.accuracy if top-level not available
            status.modelAccuracy = promotedModel.accuracy ?? promotedModel.metadata?.accuracy ?? null;
            console.log('🔍 DEBUG_PROMOTED_ACCURACY: Classifier null (training?), using promoted model accuracy from DB:', status.modelAccuracy);
          }
        }
        
        // Get trust weights
        const { getTrustManager } = await import('../trust/trust-manager.js');
        const trustManager = getTrustManager();
        status.trustWeights = await trustManager.getTrustWeights();
        
        // Get feedback stats
        if (this.feedbackProcessor) {
          status.feedbackStats = this.feedbackProcessor.getStatistics();
        }
        
      } catch (error) {
        console.error('Error getting ML status:', error);
      }
    }
    
    return status;
  }
  
  /**
   * Check if ML is available and should be used
   */
  async isMLAvailable() {
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    // Check if classifier exists and is not disabled
    return this.classifier && !this.classifier.disabled && await this.classifier.exists();
  }
  
  /**
   * Get insights from ML system
   */
  async getInsights() {
    const insights = [];
    
    if (this.feedbackProcessor) {
      const feedbackInsights = this.feedbackProcessor.generateInsights();
      insights.push(...feedbackInsights);
    }
    
    return insights;
  }
}

// Export singleton
let categorizerInstance = null;

export async function getMLCategorizer(forceReload = false, settings = null) {
  if (!categorizerInstance || forceReload) {
    categorizerInstance = new MLCategorizer();
    await categorizerInstance.initialize(settings);
  }
  return categorizerInstance;
}

/**
 * Reset the ML categorizer instance to force reload
 */
export function resetMLCategorizerCache() {
  categorizerInstance = null;
}

export default {
  MLCategorizer,
  getMLCategorizer
};