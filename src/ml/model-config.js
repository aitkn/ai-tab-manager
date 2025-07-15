/*
 * AI Tab Manager - ML Model Configuration
 * Central configuration for all ML-related parameters
 */

export const ML_CONFIG = {
  // Model Architecture
  model: {
    inputFeatures: {
      maxUrlLength: 20,      // Reduced from 20 - shorter sequences
      maxTitleLength: 20,    // Reduced from 30 - shorter sequences  
      embeddingDim: 16,     // Reduced from 32 - smaller embeddings
      vocabSize: 10000       // Restored to accommodate existing token IDs
    },
    
    architecture: {
      featureTransformUnits: 32,  // Reduced from 128 - much smaller
      hiddenUnits: [16, 8],          // Reduced from [64, 32] - single small layer
      dropout: 0.3,                 // Increased from 0.1 - more regularization
      l2Regularization: 0.01         // Increased from 0.01 - stronger regularization
    },
     
    output: {
      numClasses: 4,         // Number of categories (0-3)
      activation: 'softmax'  // Output activation
    }
  },
  
  // Training Configuration
  training: { 
    // Note: batchSize, learningRate, and earlyStopping.patience are managed via user settings
    // See state-manager.js for defaults: mlBatchSize, mlLearningRate, mlEarlyStoppingPatience
    // epochs is defined here in model-config.js (no user control)
    epochs: 10000,  // Maximum training epochs - early stopping will handle actual stopping
    validationSplit: 0.2,
    splittingStrategy: 'random', // 'random' uses URL-based deterministic assignment, 'temporal' uses chronological split
    earlyStopping: {    
      minDelta: 0.001,    // Reduced from 0.005 - more sensitive to improvements
      minEpochs: 10       // Minimum epochs before early stopping can trigger
    },
    
    // Minimum training data requirements
    minTrainingExamples: 20,  // Minimum total examples before training
    minExamplesPerClass: 5,   // Minimum corrections before incremental training
    
    
    // Confidence filtering
    minConfidenceThreshold: 0.01  // Temporarily reduced from 0.7 for initial training data collection
  }, 
  
  // Trust System Configuration
  trust: {
    // Initial trust weights
    initialWeights: {
      rules: 0.4,
      model: 0.2,  // Starts low
      llm: 0.4
    },
    
    // Trust adjustment parameters
    adjustment: {
      correctPredictionBoost: 0.02,
      incorrectPredictionPenalty: 0.03,
      maxWeight: 0.7,
      minWeight: 0.1
    },
    
    // Rolling window for accuracy calculation
    accuracyWindow: 100,
    
    // Minimum predictions before trust adjustment
    minPredictionsForAdjustment: 20
  },
  
  // Confidence Thresholds
  confidence: {
    highConfidence: 0.8,
    mediumConfidence: 0.6,
    lowConfidence: 0.4,
    
    // Below this, defer to other methods
    minimumConfidence: 0.3
  },
  
  // Feature Engineering
  features: {
    // URL pattern features
    urlPatterns: [
      { pattern: /^https?:\/\/(www\.)?/, name: 'has_protocol' },
      { pattern: /localhost|127\.0\.0\.1/, name: 'is_localhost' },
      { pattern: /\.(jpg|png|gif|pdf|doc|zip)$/i, name: 'is_file' },
      { pattern: /\?.*=/, name: 'has_query_params' },
      { pattern: /\/api\//, name: 'is_api' },
      { pattern: /\d{4,}/, name: 'has_long_number' },
      { pattern: /[a-f0-9]{8}-[a-f0-9]{4}/, name: 'has_uuid' }
    ],
    
    // Common tokens to track
    importantTokens: [
      'login', 'signin', 'auth',
      'checkout', 'payment', 'order',
      'dashboard', 'admin', 'settings',
      'docs', 'documentation', 'guide',
      'blog', 'article', 'post',
      'search', 'results', 'query'
    ]
  },
  
  // Storage Configuration
  storage: {
    modelStorageKey: 'tab_classifier_model',
    vocabularyStorageKey: 'tab_classifier_vocab',
    trainingDataStorageKey: 'tab_training_data',
    metricsStorageKey: 'tab_classifier_metrics',
    
    // Storage limits
    maxTrainingDataSize: 50000,  // Maximum training examples to store (increased from 10k)
    maxMetricsHistory: 1000      // Maximum metric records
  },
  
  // Background Training
  backgroundTraining: {
    enabled: true,
    schedule: 'daily',           // 'hourly', 'daily', 'weekly'
    minNewExamples: 3,           // Minimum new examples before retraining
    maxTrainingTime: 36000000,   // Max training time in ms (10 hour)
    
    // Resource constraints
    requiresIdle: false,         // Only train when browser is idle
    requiresCharging: false      // Only train when plugged in (if supported)
  },
  
  // Performance Optimization
  optimization: {
    // Model quantization (reduce size)
    quantization: {
      enabled: true,
      dtype: 'int8'              // Quantize to 8-bit integers
    },
    
    // Caching
    cache: {
      predictionCache: true,
      cacheSize: 1000,           // Number of predictions to cache
      cacheTTL: 3600000          // Cache TTL in ms (1 hour)
    }
  },
  
  // Debug and Logging
  debug: {
    logPredictions: false,
    logTraining: true,
    logTrustAdjustments: true,
    saveTrainingHistory: true
  },

  // Centralized Logging Configuration
  logging: {
    // Production logging (always enabled)
    errors: true,
    warnings: true,
    info: true,
    
    // Debug logging (disabled by default)
    debug: false,
    verbose: false,
    
    // Diagnostic logging (disabled by default)
    diagnostics: false,
    training: false,
    features: false,
    architecture: false,
    confusion: false,
    
    // Development utilities (disabled by default)
    dev: false
  },
  
  // Training Charts Configuration
  charts: {
    recentEpochsCount: 500,  // Number of recent epochs to show in recent chart
    fullChartWidth: 60,      // Full chart width percentage
    recentChartWidth: 40,    // Recent chart width percentage
    smoothing: {
      enabled: true,         // Enable/disable smoothing
      windowSize: 10,        // Default smoothing window size
      adaptive: true,        // Use adaptive smoothing based on data length
      minWindow: 3,          // Minimum smoothing window
      maxWindow: 50          // Maximum smoothing window
    }
  }
};

// Derived configurations
export const FEATURE_SIZE = 
  ML_CONFIG.model.inputFeatures.maxUrlLength + 
  ML_CONFIG.model.inputFeatures.maxTitleLength +
  ML_CONFIG.features.urlPatterns.length +
  10; // Additional meta features

// Export convenience functions
export function getInitialTrustWeights() {
  return { ...ML_CONFIG.trust.initialWeights };
}

export function shouldUseMlPrediction(confidence) {
  return confidence >= ML_CONFIG.confidence.minimumConfidence;
}

export function isHighConfidence(confidence) {
  return confidence >= ML_CONFIG.confidence.highConfidence;
}

export default ML_CONFIG;