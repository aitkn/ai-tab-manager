/*
 * AI Tab Manager - Tab Classifier Model
 * Main neural network for tab categorization
 */

import { ML_CONFIG } from '../model-config.js';
import { loadTensorFlow, getTensorFlow } from '../tensorflow-loader.js';
import { createFeatureEmbedder, prepareEmbeddingInputs } from '../embeddings/embedding-model.js';
import { saveModel, loadModel, FEATURE_VERSION } from '../storage/ml-database.js';
import { getOrCreateVocabulary } from '../features/vocabulary.js';
import logger from '../../utils/logger.js';

/**
 * Tab Classifier Neural Network
 */
export class TabClassifier {
  constructor(vocabulary = null) {
    this.vocabulary = vocabulary;
    this.embedder = null;
    this.classifier = null;
    this.model = null;
    this.isLoaded = false;
    this.metadata = {
      version: Date.now().toString(),
      createdAt: Date.now(),
      accuracy: 0,
      trainingSamples: 0
    };
  }
  
  /**
   * Initialize the model
   */
  async initialize() {
    // Load TensorFlow.js if not already loaded
    const tf = await loadTensorFlow();
    
    // If TensorFlow is not available, mark as loaded but disabled
    if (!tf) {
      logger.warn('TensorFlow.js not available - ML classifier disabled');
      this.isLoaded = true;
      this.disabled = true;
      return;
    }
    
    // Skip initialization if model already loaded AND has correct vocabulary size
    if (this.model && this.isLoaded) {
      // Check if model's embedding layer matches current vocabulary size
      const embeddingLayer = this.model.layers.find(l => l.name === 'token_embeddings');
      if (embeddingLayer && this.vocabulary) {
        const currentVocabSize = this.vocabulary.size();
        if (embeddingLayer.inputDim !== currentVocabSize) {
          logger.mlArchitecture(`⚠️ Model embedding layer (${embeddingLayer.inputDim}) doesn't match vocabulary size (${currentVocabSize}). Rebuilding model...`);
          this.model = null; // Force rebuild
        } else {
          logger.mlArchitecture('Tab classifier already initialized with correct vocabulary size, skipping rebuild');
          return;
        }
      }
    }
    
    // Get or create vocabulary
    if (!this.vocabulary) {
      this.vocabulary = await getOrCreateVocabulary();
    }
    
    // If vocabulary is not finalized, build it from training data
    if (!this.vocabulary.finalized || this.vocabulary.size() < 4) {
      logger.mlFeatures('📚 Vocabulary not finalized. Building from training data...');
      
      // Import the necessary function
      const { updateVocabulary } = await import('../features/vocabulary.js');
      const { getTrainingData } = await import('../storage/ml-database.js');
      
      // Get training data to build vocabulary
      const trainingData = await getTrainingData(10000); // Get up to 10k samples
      
      if (trainingData.length === 0) {
        throw new Error('Cannot build vocabulary: no training data available');
      }
      
      logger.mlFeatures(`Building vocabulary from ${trainingData.length} training samples...`);
      
      // Build vocabulary from training data
      this.vocabulary = await updateVocabulary(trainingData, { allowRefinement: false });
      
      if (!this.vocabulary.finalized) {
        throw new Error('Failed to build vocabulary from training data');
      }
      
      logger.mlFeatures(`✅ Vocabulary built with ${this.vocabulary.size()} tokens`);
    }
    
    // Build model architecture
    this.buildModel();
    
    this.isLoaded = true;
    this.needsInitialTraining = true; // Flag that this model needs training
    logger.mlArchitecture('Tab classifier initialized with new model (needs training)');
  }
  
  /**
   * Build the unified model architecture (no separate embedder/classifier)
   */
  buildModel() {
    const tf = getTensorFlow();
    if (!tf) throw new Error('TensorFlow.js not loaded');
    
    const config = ML_CONFIG.model.inputFeatures;
    const vocabSize = this.vocabulary.size();
    
    // Validate vocabulary size
    if (vocabSize < 4) {
      logger.error('❌ Invalid vocabulary size:', vocabSize);
      logger.error('Vocabulary tokens:', this.vocabulary.idToToken);
      throw new Error(`Vocabulary size (${vocabSize}) is too small. Minimum is 4 for special tokens.`);
    }
    
    logger.mlArchitecture(`🏗️ Building model with vocabulary size: ${vocabSize}`);
    
    // Create inputs
    const urlInput = tf.input({ 
      shape: [config.maxUrlLength], 
      name: 'url_tokens',
      dtype: 'int32'
    });
    
    const titleInput = tf.input({ 
      shape: [config.maxTitleLength], 
      name: 'title_tokens',
      dtype: 'int32'
    });
    
    const featuresInput = tf.input({
      shape: [ML_CONFIG.features.urlPatterns.length + 
              ML_CONFIG.features.importantTokens.length + 
              10], // numerical features
      name: 'engineered_features'
    });
    
    // Shared embedding layer
    const embeddingLayer = tf.layers.embedding({
      inputDim: vocabSize,
      outputDim: config.embeddingDim,
      embeddingsInitializer: 'randomUniform',
      embeddingsRegularizer: tf.regularizers.l2({ l2: 0.01 }),
      name: 'token_embeddings'
    });
    
    // Apply embeddings
    const urlEmbeddings = embeddingLayer.apply(urlInput);
    const titleEmbeddings = embeddingLayer.apply(titleInput);
    
    // Average pooling for variable-length sequences
    const urlPooled = tf.layers.globalAveragePooling1d({ 
      name: 'url_pooling' 
    }).apply(urlEmbeddings);
    
    const titlePooled = tf.layers.globalAveragePooling1d({ 
      name: 'title_pooling' 
    }).apply(titleEmbeddings);
    
    // Concatenate all features
    const concatenated = tf.layers.concatenate({ 
      name: 'feature_concatenation' 
    }).apply([urlPooled, titlePooled, featuresInput]);
    
    // Feature transformation layer
    const featureTransform = tf.layers.dense({
      units: ML_CONFIG.model.architecture.featureTransformUnits,
      activation: 'relu',
      kernelRegularizer: tf.regularizers.l2({ l2: 0.01 }),
      name: 'feature_transformation'
    }).apply(concatenated);
    
    const featureDropout = tf.layers.dropout({
      rate: 0.2,
      name: 'feature_dropout'
    }).apply(featureTransform);
    
    // Classification layers (directly connected)
    let x = featureDropout;
    
    // Add hidden layers from config
    ML_CONFIG.model.architecture.hiddenUnits.forEach((units, index) => {
      const denseLayer = tf.layers.dense({
        units,
        activation: 'relu',
        kernelRegularizer: tf.regularizers.l2({ 
          l2: ML_CONFIG.model.architecture.l2Regularization 
        }),
        name: `hidden_${index + 1}`
      });
      x = denseLayer.apply(x);
      
      // Add batch normalization for better training
      const batchNormLayer = tf.layers.batchNormalization({
        name: `batch_norm_${index + 1}`
      });
      x = batchNormLayer.apply(x);
      
      // Add dropout
      const dropoutLayer = tf.layers.dropout({
        rate: ML_CONFIG.model.architecture.dropout,
        name: `dropout_${index + 1}`
      });
      x = dropoutLayer.apply(x);
    });
    
    // Output layer
    const output = tf.layers.dense({
      units: ML_CONFIG.model.output.numClasses,
      activation: ML_CONFIG.model.output.activation,
      name: 'category_output'
    }).apply(x);
    
    // Create ONE unified model (no separate embedder/classifier)
    this.model = tf.model({
      inputs: [urlInput, titleInput, featuresInput],
      outputs: output,
      name: 'unified_tab_classifier'
    });
    
    // Remove separate models (unified architecture)
    this.embedder = null;
    this.classifier = null;
    
    // Compile the model
    this.compile();
  }
  
  /**
   * Compile the model with optimizer and loss
   * @param {number} learningRate - Optional learning rate (defaults to 0.001)
   */
  compile(learningRate = 0.001) {
    const tf = getTensorFlow();
    
    this.model.compile({
      optimizer: tf.train.adam(learningRate),
      loss: 'categoricalCrossentropy',
      metrics: ['accuracy', 'categoricalCrossentropy']
    });
    
  }
  
  /**
   * Prepare training data
   * @param {Array} trainingData - Array of {url, title, category} objects
   * @returns {Object} Prepared tensors and sample weights
   */
  prepareTrainingData(trainingData) {
    const tf = getTensorFlow();
    
    const urlTokens = [];
    const titleTokens = [];
    const features = [];
    const labels = [];
    const sampleWeights = [];
    
    let storedFeatureCount = 0;
    let calculatedFeatureCount = 0;
    
    // Data has already been filtered for confidence > 0 in trainer.prepareTrainingData()
    trainingData.forEach(example => {
      // Check if features are already stored and version matches
      if (example.features && example.features.urlTokens && 
          example.features.titleTokens && example.features.engineeredFeatures &&
          example.featureVersion === FEATURE_VERSION) { // Current feature version
        // Use pre-calculated features
        urlTokens.push(example.features.urlTokens);
        titleTokens.push(example.features.titleTokens);
        features.push(example.features.engineeredFeatures);
        storedFeatureCount++;
      } else {
        // Fall back to calculating features on-the-fly
        const inputs = prepareEmbeddingInputs(
          { url: example.url, title: example.title },
          this.vocabulary
        );
        
        urlTokens.push(inputs.urlTokens);
        titleTokens.push(inputs.titleTokens);
        features.push(inputs.features);
        calculatedFeatureCount++;
      }
      
      // Validate category is in valid range [0, 3]
      const category = example.category;
      if (typeof category !== 'number' || category < 0 || category > 3 || !Number.isInteger(category)) {
        logger.error(`Invalid category at index ${labels.length}: ${category}`, example);
        throw new Error(`Invalid category value: ${category}. Must be integer in range [0, 3]`);
      }
      
      labels.push(category);
      
      // Use training confidence as sample weight
      // We know it's > 0 because data was already filtered
      sampleWeights.push(example.trainingConfidence);
    });
    
    // Log feature usage statistics
    if (storedFeatureCount > 0 || calculatedFeatureCount > 0) {
      const percentStored = (storedFeatureCount / trainingData.length * 100).toFixed(1);
      // Feature optimization stats
      if (calculatedFeatureCount > 0 && percentStored < 50) {
        logger.mlTraining(`Feature optimization: ${percentStored}% using cached features. Consider re-saving training data.`);
      }
    }
    
    // Log sample weight distribution
    const weightStats = {
      min: Math.min(...sampleWeights),
      max: Math.max(...sampleWeights),
      avg: sampleWeights.reduce((a, b) => a + b, 0) / sampleWeights.length,
      high: sampleWeights.filter(w => w >= 0.8).length,
      medium: sampleWeights.filter(w => w >= 0.5 && w < 0.8).length,
      low: sampleWeights.filter(w => w < 0.5).length
    };
    // Log weight statistics (informational only - low confidence is expected for older data)
    logger.mlTraining(`Training data confidence distribution: high(≥0.8): ${weightStats.high}, medium(0.5-0.8): ${weightStats.medium}, low(<0.5): ${weightStats.low}`);
    
    
    // Check for NaN in features before creating tensors
    let hasNaNFeatures = false;
    features.forEach((featureVec, idx) => {
      if (featureVec.some(val => isNaN(val) || val === null || val === undefined)) {
        logger.mlDiagnostic(`NaN/null feature found at index ${idx}:`, featureVec);
        hasNaNFeatures = true;
      }
    });
    
    if (hasNaNFeatures) {
      logger.error('ERROR: Training data contains NaN/null features!');
    }
    
    // Validate token IDs before creating tensors
    const vocabSize = this.vocabulary.size();
    let hasInvalidTokens = false;
    
    urlTokens.forEach((tokens, idx) => {
      const invalid = tokens.filter(t => t >= vocabSize);
      if (invalid.length > 0) {
        logger.error(`❌ Invalid URL tokens at index ${idx}:`, invalid, `(vocab size: ${vocabSize})`);
        logger.error('  URL:', trainingData[idx].url);
        hasInvalidTokens = true;
      }
    });
    
    titleTokens.forEach((tokens, idx) => {
      const invalid = tokens.filter(t => t >= vocabSize);
      if (invalid.length > 0) {
        logger.error(`❌ Invalid title tokens at index ${idx}:`, invalid, `(vocab size: ${vocabSize})`);
        logger.error('  Title:', trainingData[idx].title);
        hasInvalidTokens = true;
      }
    });
    
    if (hasInvalidTokens) {
      throw new Error(`Found tokens exceeding vocabulary size (${vocabSize}). This usually means the vocabulary changed but the model wasn't rebuilt.`);
    }
    
    // Convert to tensors
    const xs = [
      tf.tensor2d(urlTokens, null, 'int32'),
      tf.tensor2d(titleTokens, null, 'int32'),
      tf.tensor2d(features)
    ];
    
    // Debug: Check label values before one-hot encoding
    const uniqueLabels = [...new Set(labels)];
    
    // Check for any invalid labels that somehow passed validation
    const invalidLabels = labels.filter(l => l < 0 || l >= ML_CONFIG.model.output.numClasses);
    if (invalidLabels.length > 0) {
      logger.error('❌ Found invalid labels before one-hot encoding:', invalidLabels);
      throw new Error(`Invalid labels found: ${invalidLabels}. Valid range is [0, ${ML_CONFIG.model.output.numClasses - 1}]`);
    }
    
    // One-hot encode labels
    const ys = tf.oneHot(
      tf.tensor1d(labels, 'int32'),
      ML_CONFIG.model.output.numClasses
    );
    
    return { xs, ys, sampleWeights };
  }
  
  /**
   * Train with custom weighted loss - DEPRECATED
   * All training should go through WorkerManager
   * @deprecated This method is now handled in training-worker.js
   */
  async trainWithCustomWeights(xs, ys, sampleWeights, config) {
    throw new Error('Custom weighted training moved to training-worker.js');
  }
  
  /**
   * Check if model weights are valid (not NaN or Infinity)
   * @returns {Promise<boolean>} True if model is valid
   */
  async checkModelHealth() {
    const tf = getTensorFlow();
    
    // Create a dummy input to test the model
    const numFeatures = ML_CONFIG.features.urlPatterns.length + 
                       ML_CONFIG.features.importantTokens.length + 
                       10; // numerical features
    
    const dummyInput = [
      tf.zeros([1, ML_CONFIG.model.inputFeatures.maxUrlLength], 'int32'),
      tf.zeros([1, ML_CONFIG.model.inputFeatures.maxTitleLength], 'int32'),
      tf.zeros([1, numFeatures])
    ];
    
    try {
      // Get model prediction
      const prediction = this.model.predict(dummyInput);
      const predArray = await prediction.array();
      
      // Clean up
      dummyInput.forEach(t => t.dispose());
      prediction.dispose();
      
      // Check for NaN or Infinity
      const hasNaN = predArray.some(row => row.some(val => isNaN(val) || !isFinite(val)));
      
      if (hasNaN) {
        logger.error('Model health check failed: predictions contain NaN or Infinity');
        return false;
      }
      
      return true;
    } catch (error) {
      logger.error('Model health check error:', error);
      return false;
    }
  }

  /**
   * Train the model - DEPRECATED
   * All training should go through WorkerManager for background execution
   * @deprecated Use WorkerManager.startTraining() instead
   */
  async train(trainingData, options = {}) {
    throw new Error('Direct training is deprecated. Use WorkerManager.startTraining() for background training.');
  }
  
  /**
   * Predict categories for tabs
   * @param {Array} tabs - Array of tab objects
   * @returns {Promise<Array>} Predictions
   */
  async predict(tabs) {
    if (!this.isLoaded) {
      await this.initialize();
    }
    
    // If disabled, return empty predictions
    if (this.disabled) {
      return tabs.map(tab => ({
        tabId: tab.id,
        category: null,
        confidence: 0,
        probabilities: []
      }));
    }
    
    const tf = getTensorFlow();
    
    // Prepare inputs
    const urlTokens = [];
    const titleTokens = [];
    const features = [];
    
    tabs.forEach(tab => {
      const inputs = prepareEmbeddingInputs(tab, this.vocabulary);
      urlTokens.push(inputs.urlTokens);
      titleTokens.push(inputs.titleTokens);
      features.push(inputs.features);
    });
    
    // Convert to tensors
    const xs = [
      tf.tensor2d(urlTokens, null, 'int32'),
      tf.tensor2d(titleTokens, null, 'int32'),
      tf.tensor2d(features)
    ];
    
    // Get predictions
    const predictions = await this.model.predict(xs);
    const probabilities = await predictions.array();
    
    // Get predicted classes and confidences
    const results = probabilities.map((probs, index) => {
      const maxIndex = probs.indexOf(Math.max(...probs));
      const confidence = probs[maxIndex];
      
      return {
        tabId: tabs[index].id,
        category: maxIndex,
        confidence,
        probabilities: probs,
        // Include confidence breakdown
        breakdown: {
          ignore: probs[1],
          useful: probs[2],
          important: probs[3],
          uncategorized: probs[0]
        }
      };
    });
    
    // Clean up tensors
    xs.forEach(x => x.dispose());
    predictions.dispose();
    
    return results;
  }
  
  /**
   * Predict single tab
   * @param {Object} tab - Tab object
   * @returns {Promise<Object>} Prediction
   */
  async predictOne(tab) {
    const results = await this.predict([tab]);
    return results[0];
  }
  
  /**
   * Clear stored model from IndexedDB
   */
  async clearStoredModel() {
    try {
      const tf = getTensorFlow();
      
      // Remove model from IndexedDB
      await tf.io.removeModel('indexeddb://tab-classifier-model');
      logger.mlArchitecture('Cleared stored model from IndexedDB');
      
      // Clear our custom metadata by importing the database module
      const { clearStoredModel: clearModelMetadata } = await import('../storage/ml-database.js');
      if (clearModelMetadata) {
        await clearModelMetadata();
        logger.mlArchitecture('Cleared model metadata');
      }
      
      return true;
    } catch (error) {
      logger.error('Error clearing stored model:', error);
      return false;
    }
  }

  /**
   * Save the model using TensorFlow.js standard save format
   */
  async save() {
    try {
      // Save the complete model to IndexedDB using TensorFlow.js standard format
      await this.model.save('indexeddb://tab-classifier-model');
      
      // Save vocabulary and metadata separately using our custom storage
      await saveModel({
        version: this.metadata.version,
        vocabulary: this.vocabulary.export(),
        accuracy: this.metadata.accuracy,
        trainingSamples: this.metadata.trainingSamples,
        inputShape: this.model.inputs.map(i => i.shape),
        outputShape: [[null, 4]], // We know the output is always [batch_size, 4 categories]
        metadata: this.metadata
      });
      
    } catch (saveError) {
      logger.error('Error saving model:', saveError);
      // Continue anyway - don't let save errors break the flow
    }
    
    // Reset the singleton cache so next getTabClassifier() call will reload the saved model
    classifierInstance = null;
    
    // Also reset ML categorizer cache since it holds a reference to the old classifier
    try {
      const { resetMLCategorizerCache } = await import('../categorization/ml-categorizer.js');
      resetMLCategorizerCache();
    } catch (error) {
      logger.mlArchitecture('Could not reset ML categorizer cache:', error);
    }
  }
  
  /**
   * Load weights with GPU/CPU fallback handling
   */
  static async loadWeightsWithFallback(classifier, weights) {
    const { switchBackend, getBackendInfo, getTensorFlow } = await import('../tensorflow-loader.js');
    const tf = getTensorFlow();
    const originalBackend = getBackendInfo().backend;
    
    // Try loading on current backend first with tidy() to prevent memory leaks
    logger.mlArchitecture(`Attempting to load weights on ${originalBackend} backend...`);
    try {
      // Use tf.tidy() to prevent memory accumulation that can cause stack overflow
      const success = tf.tidy(() => {
        try {
          classifier.model.setWeights(weights);
          return true;
        } catch (error) {
          logger.mlArchitecture(`Weight loading failed in tidy context:`, error.message);
          return false;
        }
      });
      
      if (success) {
        logger.mlArchitecture(`Weights loaded successfully on ${originalBackend} backend`);
        return true;
      }
    } catch (error) {
      logger.mlArchitecture(`Weight loading failed on ${originalBackend}:`, error.message);
      
      // Check if this is the known TensorFlow.js issue #5508 (large input stack overflow)
      if (error.message.includes('Maximum call stack') || error.name === 'RangeError') {
        logger.mlArchitecture('Detected TensorFlow.js issue #5508 - large input causing stack overflow');
      }
    }
    
    // If current backend failed and we're on GPU, try CPU with fresh WebGL context
    if (originalBackend === 'webgl') {
      try {
        logger.mlArchitecture('Switching to CPU backend for weight loading (WebGL context may be corrupted)...');
        await switchBackend('cpu');
        
        // Wait a moment for WebGL context to fully release
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const success = tf.tidy(() => {
          try {
            classifier.model.setWeights(weights);
            return true;
          } catch (error) {
            logger.mlArchitecture(`CPU weight loading failed in tidy context:`, error.message);
            return false;
          }
        });
        
        if (success) {
          logger.mlArchitecture('Weights loaded successfully on CPU backend');
          
          // Try to switch back to GPU for inference with fresh context
          try {
            await switchBackend('webgl');
            logger.mlArchitecture('Switched back to GPU for inference with fresh WebGL context');
          } catch (switchError) {
            logger.mlArchitecture('Could not switch back to GPU, staying on CPU:', switchError.message);
          }
          
          return true;
        }
      } catch (cpuError) {
        logger.error('Weight loading failed on CPU as well:', cpuError.message);
      }
    }
    
    return false;
  }

  /**
   * Load saved model using TensorFlow.js loadLayersModel
   */
  static async load() {
    try {
      const tf = await loadTensorFlow();
      if (!tf) return null;
      
      // Try to load the full model from IndexedDB
      const loadedModel = await tf.loadLayersModel('indexeddb://tab-classifier-model');
      
      // Load vocabulary and metadata separately
      const modelData = await loadModel();
      
      // Recreate vocabulary
      let vocab;
      if (modelData && modelData.vocabulary) {
        const { Vocabulary } = await import('../features/vocabulary.js');
        vocab = Vocabulary.fromData(modelData.vocabulary);
      } else {
        // Fallback to default vocabulary
        const { getOrCreateVocabulary } = await import('../features/vocabulary.js');
        vocab = await getOrCreateVocabulary();
      }
      
      // Create classifier instance
      const classifier = new TabClassifier(vocab);
      
      // Replace the model and embedder with loaded versions
      classifier.model = loadedModel;
      
      // Check if model's embedding layer matches vocabulary size
      const embeddingLayer = loadedModel.layers.find(l => l.name === 'token_embeddings');
      if (embeddingLayer) {
        const modelVocabSize = embeddingLayer.inputDim;
        const actualVocabSize = vocab.size();
        
        if (modelVocabSize !== actualVocabSize) {
          logger.error(`❌ Model vocabulary mismatch: model expects ${modelVocabSize} tokens but vocabulary has ${actualVocabSize}`);
          logger.mlArchitecture('Clearing corrupted model...');
          await classifier.clearStoredModel();
          return null; // This will trigger creation of a new model
        }
      }
      
      // CRITICAL: Recompile the loaded model
      classifier.compile();
      
      // Restore metadata
      classifier.metadata = (modelData && modelData.metadata) || {};
      classifier.isLoaded = true;
      
      // IMPORTANT: Set needsInitialTraining to false for loaded models
      // This prevents BackgroundMLService from thinking the model needs training
      classifier.needsInitialTraining = false;
      
      // Check if loaded model is healthy
      const isHealthy = await classifier.checkModelHealth();
      if (!isHealthy) {
        logger.error('Loaded model is corrupted. Clearing and returning null...');
        await classifier.clearStoredModel();
        return null; // This will trigger creation of a new model
      }
      
      return classifier;
      
    } catch (error) {
      // Silently handle model loading errors - this is expected for new installations
      return null; // Return null so getTabClassifier will create a new instance
    }
  }
  
  /**
   * Check if model exists in IndexedDB
   */
  async exists() {
    try {
      const tf = await loadTensorFlow();
      if (!tf) return false;
      
      // Try to list models in IndexedDB
      const models = await tf.io.listModels();
      return 'indexeddb://tab-classifier-model' in models;
    } catch (error) {
      return false;
    }
  }
  
  /**
   * Get model summary
   */
  getSummary() {
    // If model is disabled, return basic info
    if (this.disabled) {
      return {
        architecture: { inputs: [], outputs: [] },
        parameters: 0,
        metadata: this.metadata
      };
    }
    
    return {
      architecture: {
        inputs: this.model.inputs.map(i => ({
          name: i.name,
          shape: i.shape
        })),
        outputs: this.model.outputs.map(o => ({
          name: o.name,
          shape: o.shape
        })),
        totalParams: this.model.countParams(),
        layers: this.model.layers.length
      },
      vocabulary: {
        size: this.vocabulary.size(),
        coverage: this.vocabulary.calculateCoverage()
      },
      metadata: this.metadata
    };
  }
  
  /**
   * Print simplified model summary
   */
  printModel() {
    if (this.disabled || !this.model) {
      return;
    }
    
    logger.mlArchitecture(`Model: ${this.model.countParams().toLocaleString()} parameters, ${this.model.layers.length} layers`);
    
    if (this.metadata?.accuracy) {
      logger.mlArchitecture(`Accuracy: ${(this.metadata.accuracy * 100).toFixed(1)}%`);
    }
  }
  
  /**
   * Evaluate model on test data
   * @param {Array} testData - Test examples
   * @returns {Promise<Object>} Evaluation metrics
   */
  async evaluate(testData) {
    const tf = getTensorFlow();
    
    // Prepare test data
    const { xs, ys } = this.prepareTrainingData(testData);
    
    // Evaluate
    const result = await this.model.evaluate(xs, ys);
    const [loss, accuracy] = await Promise.all(result.map(t => t.data()));
    
    // Get detailed predictions for confusion matrix
    const predictions = await this.model.predict(xs);
    const predClasses = await tf.argMax(predictions, -1).array();
    const trueClasses = await tf.argMax(ys, -1).array();
    
    // Calculate confusion matrix
    const confusionMatrix = this.calculateConfusionMatrix(trueClasses, predClasses);
    
    // Clean up
    xs.forEach(x => x.dispose());
    ys.dispose();
    result.forEach(t => t.dispose());
    predictions.dispose();
    
    return {
      loss,
      accuracy,
      confusionMatrix,
      perClassMetrics: this.calculatePerClassMetrics(confusionMatrix)
    };
  }
  
  /**
   * Calculate confusion matrix
   */
  calculateConfusionMatrix(trueLabels, predictions) {
    const numClasses = ML_CONFIG.model.output.numClasses;
    const matrix = Array(numClasses).fill(null).map(() => Array(numClasses).fill(0));
    
    for (let i = 0; i < trueLabels.length; i++) {
      matrix[trueLabels[i]][predictions[i]]++;
    }
    
    return matrix;
  }
  
  /**
   * Calculate per-class metrics from confusion matrix
   */
  calculatePerClassMetrics(confusionMatrix) {
    const metrics = [];
    const numClasses = confusionMatrix.length;
    
    for (let i = 0; i < numClasses; i++) {
      const tp = confusionMatrix[i][i];
      const fp = confusionMatrix.reduce((sum, row, j) => sum + (j !== i ? row[i] : 0), 0);
      const fn = confusionMatrix[i].reduce((sum, val, j) => sum + (j !== i ? val : 0), 0);
      
      const precision = tp / (tp + fp) || 0;
      const recall = tp / (tp + fn) || 0;
      const f1 = 2 * (precision * recall) / (precision + recall) || 0;
      
      metrics.push({
        class: i,
        precision,
        recall,
        f1,
        support: tp + fn
      });
    }
    
    return metrics;
  }
}

// Export singleton instance
let classifierInstance = null;

export async function getTabClassifier(forceReload = false) {
  if (!classifierInstance || forceReload) {
    // Try to load saved model first
    classifierInstance = await TabClassifier.load();
    
    // If no saved model, check if we have training data before creating new one
    if (!classifierInstance) {
      logger.mlArchitecture('🆕 ML Model: No existing model found, checking training data...');
      
      // Check if we have any training data
      const { getTrainingData } = await import('../storage/ml-database.js');
      // First check if ANY data exists
      const sampleData = await getTrainingData(1);
      
      if (sampleData.length === 0) {
        logger.mlArchitecture('📭 No training data available - cannot create model yet');
        // Return a disabled classifier instance that won't throw errors
        classifierInstance = new TabClassifier();
        classifierInstance.disabled = true;
        classifierInstance.isLoaded = true;
        classifierInstance.needsInitialTraining = true;
        return classifierInstance;
      }
      
      // Get actual count for logging
      const allTrainingData = await getTrainingData(10000);
      const trainingDataCount = allTrainingData.length;
      logger.mlArchitecture(`📊 Found ${trainingDataCount} training samples - creating new model`);
      classifierInstance = new TabClassifier();
      await classifierInstance.initialize();
    }
  }
  
  return classifierInstance;
}

/**
 * Reset the classifier instance to force reload from storage
 */
export function resetTabClassifierCache() {
  classifierInstance = null;
}

export default {
  TabClassifier,
  getTabClassifier
};