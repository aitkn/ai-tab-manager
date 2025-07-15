/*
 * AI Tab Manager - Worker Manager
 * Manages Web Worker lifecycle for background training
 */

import { ML_CONFIG } from '../model-config.js';
import { recordMetric, FEATURE_VERSION } from '../storage/ml-database.js';
import logger from '../../utils/logger.js';

/**
 * Training Worker Manager
 */
export class WorkerManager {
  constructor() {
    this.worker = null;
    this.jobs = new Map();
    this.isInitialized = false;
    this.callbacks = new Map();
    this.restartAttempts = 0;
    this.maxRestartAttempts = 3;
  }
  
  /**
   * Initialize the worker
   */
  async initialize() {
    if (this.isInitialized) return;
    
    logger.mlTraining('🟡 WORKER MANAGER: Initializing Web Worker...');
    
    try {
      // Create worker - try without module type first
      logger.mlTraining('🟡 WORKER MANAGER: Creating worker from:', new URL('./training-worker.js', import.meta.url).href);
      this.worker = new Worker(
        new URL('./training-worker.js', import.meta.url)
        // Removed { type: 'module' } to use classic script
      );
      logger.mlTraining('🟡 WORKER MANAGER: Worker created successfully');
      
      // Set up message handler
      this.worker.addEventListener('message', (event) => {
        this.handleWorkerMessage(event.data);
      });
      
      // Set up error handler
      this.worker.addEventListener('error', (error) => {
        console.error('Worker error:', error);
        console.error('Worker error details:', {
          message: error.message,
          filename: error.filename,
          lineno: error.lineno,
          colno: error.colno
        });
        this.handleWorkerError(error);
      });
      
      // Initialize worker with shorter timeout
      const initJobId = this.generateJobId();
      const initPromise = new Promise((resolve, reject) => {
        this.callbacks.set(initJobId, { resolve, reject });
        
        // Send init message
        this.worker.postMessage({
          type: 'INIT',
          data: null,
          jobId: initJobId
        });
        
        // Shorter timeout for initialization (5 seconds)
        setTimeout(() => {
          if (this.callbacks.has(initJobId)) {
            this.callbacks.delete(initJobId);
            reject(new Error('Worker initialization timeout'));
          }
        }, 5000);
      });
      
      await initPromise;
      
      // Configure worker logging after initialization
      try {
        if (typeof window !== 'undefined' && window.logger) {
          const config = window.logger.getConfig();
          this.worker.postMessage({
            type: 'CONFIGURE_LOGGING',
            data: config
          });
        }
      } catch (error) {
        console.warn('Failed to configure worker logging:', error);
      }
      
      this.isInitialized = true;
      this.restartAttempts = 0; // Reset on successful init
      logger.mlArchitecture('Worker manager initialized');
      
    } catch (error) {
      console.error('Failed to initialize worker:', error);
      throw error;
    }
  }
  
  /**
   * Send message to worker
   */
  sendMessage(type, data = null, jobId = null) {
    return new Promise((resolve, reject) => {
      const id = jobId || this.generateJobId();
      
      // Store callbacks
      this.callbacks.set(id, { resolve, reject });
      
      // Send message
      this.worker.postMessage({
        type,
        data,
        jobId: id
      });
      
      // Set timeout - use longer timeout for training operations
      const timeoutDuration = type === 'TRAIN' ? 
        ML_CONFIG.backgroundTraining.maxTrainingTime : // Use config value for training
        30000; // 30 seconds for other operations
        
      setTimeout(() => {
        if (this.callbacks.has(id)) {
          // Send CANCEL message and let worker finish gracefully
          this.worker.postMessage({ type: 'CANCEL', jobId: id });
          // Worker will respond with CANCELLED message which resolves the promise
        }
      }, timeoutDuration);
    });
  }
  
  /**
   * Handle worker messages
   */
  handleWorkerMessage(message) {
    const { type, jobId, data, error } = message;
    
    switch (type) {
      case 'INITIALIZED':
        logger.mlTraining('Worker initialized:', data);
        if (data.backend) {
          logger.mlTraining(`🎮 TensorFlow.js backend in worker: ${data.backend}`);
        }
        if (jobId) {
          this.resolveJob(jobId, data);
        }
        break;
        
      case 'PROGRESS':
        this.handleProgress(jobId, data);
        break;
        
      case 'BATCH_PROGRESS':
        // Less frequent batch updates
        if (this.jobs.has(jobId)) {
          const job = this.jobs.get(jobId);
          if (job.onBatchProgress) {
            job.onBatchProgress(data);
          }
        }
        break;
        
      case 'TRAINING_COMPLETE':
        this.handleTrainingComplete(jobId, data);
        break;
        
      case 'PREDICTION_COMPLETE':
        this.resolvePrediction(jobId, data);
        break;
        
      case 'ERROR':
        this.handleError(jobId, error);
        break;
        
      case 'MEMORY_WARNING':
        console.warn('Worker memory warning:', data);
        this.handleMemoryWarning(data);
        break;
        
      case 'STATUS':
        this.resolveJob(jobId, data);
        break;
        
      case 'CHECKPOINT':
        this.handleCheckpoint(jobId, data, message.checkpointType);
        break;
        
      case 'CANCELLED':
        logger.mlTraining('Training cancelled for job:', jobId);
        // Clean up the job from our tracking
        if (this.jobs.has(jobId)) {
          const job = this.jobs.get(jobId);
          // Call the error callback to notify UI
          if (job.onError) {
            job.onError(new Error('Training cancelled'));
          }
          this.jobs.delete(jobId);
        }
        this.resolveJob(jobId, { cancelled: true, message: 'Training cancelled by user' });
        break;
        
      default:
        logger.warn('Unknown worker message:', type, data);
    }
  }
  
  /**
   * Train model in background - simplified interface for ml-dashboard
   * @param {Object} params - Training parameters
   * @returns {Object} Job object with id and promise
   */
  async train(params) {
    const { trainingData, validationData, epochs, incremental, batchSize, learningRate, earlyStoppingPatience, onProgress, onComplete, onError } = params;
    
    // Enhanced logging for debugging multiple training issue
    logger.mlTraining(`🚀 TRAINING REQUEST: epochs=${epochs}, incremental=${incremental}, dataSize=${trainingData?.length || 0}`);
    logger.mlTraining(`📊 Current jobs: ${this.jobs.size} total, ${Array.from(this.jobs.values()).filter(j => j.type === 'training').length} training`);
    
    // Check if training is already in progress or being cancelled
    const activeTrainingJobs = Array.from(this.jobs.values()).filter(
      job => job.type === 'training' && (job.status === 'running' || job.status === 'cancelling')
    );
    
    if (activeTrainingJobs.length > 0) {
      logger.warn(`🔄 TRAINING CONFLICT: ${activeTrainingJobs.length} active training jobs, skipping new request`);
      logger.warn(`   Existing job: ${activeTrainingJobs[0].id} (status: ${activeTrainingJobs[0].status})`);
      const existingJob = activeTrainingJobs[0];
      return { 
        id: existingJob.id, 
        promise: Promise.resolve({ 
          success: false, 
          reason: 'training_in_progress',
          message: 'Training is already running in background'
        })
      };
    }
    
    logger.mlTraining(`✅ STARTING NEW TRAINING: No conflicts detected`);
    
    // Check for interrupted training from previous sessions
    const { promoteTrainingModel, getTrainingCheckpoint } = await import('../storage/ml-database.js');
    
    // Check for training_last checkpoint
    const interruptedModel = await getTrainingCheckpoint('last');
    
    if (interruptedModel) {
      const trainingAge = Date.now() - interruptedModel.metadata.startedAt;
      const ageMinutes = Math.floor(trainingAge / 60000);
      // Use training history length as source of truth for epoch count
      // If history exists, use its length; otherwise fall back to stored epoch
      const trainingHistoryLength = interruptedModel.metadata?.trainingHistory?.loss?.length ?? 0;
      const storedEpoch = interruptedModel.metadata.epoch ?? 0;
      
      // If there's a mismatch, truncate the history to match the stored epoch
      if (trainingHistoryLength > 0 && storedEpoch > 0 && trainingHistoryLength !== storedEpoch) {
        logger.mlTraining(`⚠️ Epoch mismatch detected: history length ${trainingHistoryLength} vs stored epoch ${storedEpoch}`);
        logger.mlTraining(`   Using training history length (${trainingHistoryLength}) as source of truth`);
      }
      
      const lastEpoch = trainingHistoryLength || storedEpoch;
      
      logger.mlTraining(`⏳ Found interrupted training from ${ageMinutes} minutes ago at epoch ${lastEpoch}`);
      logger.mlTraining(`📊 Interrupted model accuracy: ${(interruptedModel.metadata.accuracy * 100).toFixed(1)}%`);
      // Check if training actually reached completion criteria
      if (logger.isEnabled('ml.diagnostics')) {
        logger.mlDiagnostic('🔍 DEBUG_PROMOTION: Checking if interrupted training is complete');
        logger.mlDiagnostic(`   Last epoch: ${lastEpoch}`);
        logger.mlDiagnostic(`   Epochs without improvement: ${interruptedModel.metadata.epochsWithoutImprovement ?? 0}`);
      }
      
      // Get the actual target epochs and early stopping configuration
      const targetEpochs = params.epochs; // Must be provided, no fallback
      // Early stopping patience must come from params
      const earlyStoppingPatience = params.earlyStoppingPatience;
      const minEpochs = ML_CONFIG.training.earlyStopping.minEpochs;
      
      if (logger.isEnabled('ml.diagnostics')) {
        logger.mlDiagnostic(`   Target epochs: ${targetEpochs}`);
        logger.mlDiagnostic(`   Early stopping patience: ${earlyStoppingPatience}`);
        logger.mlDiagnostic(`   Min epochs required: ${minEpochs}`);
      }
      
      // Training is only considered complete if:
      // 1. Reached target epochs, OR
      // 2. Met minimum epochs AND exceeded early stopping patience
      const reachedTargetEpochs = lastEpoch >= targetEpochs;
      const metMinEpochs = lastEpoch >= minEpochs;
      const exceededPatience = (interruptedModel.metadata.epochsWithoutImprovement ?? 0) >= earlyStoppingPatience;
      const earlyStoppingTriggered = metMinEpochs && exceededPatience;
      
      if (logger.isEnabled('ml.diagnostics')) {
        logger.mlDiagnostic(`   Reached target epochs: ${reachedTargetEpochs}`);
        logger.mlDiagnostic(`   Met min epochs: ${metMinEpochs}`);
        logger.mlDiagnostic(`   Exceeded patience: ${exceededPatience}`);
        logger.mlDiagnostic(`   Early stopping triggered: ${earlyStoppingTriggered}`);
      }
      
      const isComplete = reachedTargetEpochs || earlyStoppingTriggered;
      
      if (logger.isEnabled('ml.diagnostics')) {
        logger.mlDiagnostic(`   Training is complete: ${isComplete}`);
      }
      
      if (isComplete) {
        logger.mlTraining('✅ Interrupted training was complete, promoting best checkpoint to current...');
        
        // Import additional functions we need
        const { deleteTrainingCheckpoint } = await import('../storage/ml-database.js');
        
        // Check if we have a best checkpoint
        const bestModel = await getTrainingCheckpoint('best');
        
        if (bestModel) {
          await promoteTrainingModel('training_best');
          
          // Clean up training_last after promoting best
          await deleteTrainingCheckpoint('last');
        } else {
          // Fallback: promote last checkpoint if no best checkpoint exists
          logger.mlTraining('⚠️ No best checkpoint found, promoting last checkpoint...');
          await promoteTrainingModel('training_last');
        }
        
        return { 
          id: 'completed_' + Date.now(), 
          promise: Promise.resolve({ 
            success: true, 
            completed: true,
            accuracy: interruptedModel.metadata.accuracy,
            message: `Completed training from epoch ${lastEpoch} (${earlyStoppingTriggered ? 'early stopped' : 'reached target'})`
          })
        };
      } else {
        logger.mlTraining(`▶️ Resuming training from epoch ${lastEpoch + 1}...`);
        // Continue with normal training flow - the training worker will load the checkpoint
        // and continue from where it left off
      }
    }
    
    const jobId = this.generateJobId();
    
    // Create job object that will handle training in worker
    const job = {
      id: jobId,
      type: 'training',
      startTime: Date.now(),
      status: 'running',
      progress: 0,
      onProgress,
      onComplete,
      onError
    };
    
    // Store job
    this.jobs.set(jobId, job);
    
    // Execute training in worker
    const promise = this.executeTrainingInWorker(jobId, trainingData, {
      epochs,
      incremental,
      batchSize,
      learningRate,
      earlyStoppingPatience,
      validationData
    });
    
    return { id: jobId, promise };
  }
  
  /**
   * Execute training in Web Worker
   */
  async executeTrainingInWorker(jobId, trainingData, options) {
    const timings = { start: Date.now() };
    
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }
      timings.afterInit = Date.now();
      
      // Get model configuration
      const { ML_CONFIG } = await import('../model-config.js');
      const { getOrCreateVocabulary } = await import('../features/vocabulary.js');
      
      // Get current vocabulary for model config
      const vocabulary = await getOrCreateVocabulary();
      timings.afterVocab = Date.now();
      
      // Prepare model configuration
      const modelConfig = {
        vocabSize: vocabulary.size(),
        embeddingDim: ML_CONFIG.model.inputFeatures.embeddingDim, // Fixed path
        maxUrlLength: ML_CONFIG.model.inputFeatures.maxUrlLength,
        maxTitleLength: ML_CONFIG.model.inputFeatures.maxTitleLength,
        numClasses: 4,
        featureTransformUnits: ML_CONFIG.model.architecture.featureTransformUnits,
        hiddenUnits: ML_CONFIG.model.architecture.hiddenUnits, // Add hidden units config
        dropout: ML_CONFIG.model.architecture.dropout,
        learningRate: options.learningRate  // Use learning rate from options
      };
      
      // Prepare training data - reuse stored features when available
      const preparedData = [];
      let maxTimestamp = 0;
      const itemsNeedingFeatures = [];
      
      // First pass: identify items with and without features
      for (const item of trainingData) {
        // Track the newest training data timestamp
        if (item.timestamp && item.timestamp > maxTimestamp) {
          maxTimestamp = item.timestamp;
        }
        
        // Check if features are already stored and compatible with current version
        if (item.features && item.features.urlTokens && item.features.titleTokens && item.features.engineeredFeatures && item.featureVersion === FEATURE_VERSION) {
          // Use existing features - much faster!
          // Validate confidence values
          if (typeof item.trainingConfidence !== 'number' || item.trainingConfidence < 0 || item.trainingConfidence > 1) {
            throw new Error(`Invalid trainingConfidence for ${item.url}: ${item.trainingConfidence}`);
          }
          if (typeof item.combinedConfidence !== 'number' || item.combinedConfidence < 0 || item.combinedConfidence > 1) {
            throw new Error(`Invalid combinedConfidence for ${item.url}: ${item.combinedConfidence}`);
          }
          
          preparedData.push({
            url: item.url,
            title: item.title,
            category: item.category,
            features: item.features,
            trainingConfidence: item.trainingConfidence,
            combinedConfidence: item.combinedConfidence,
            // Preserve timestamp fields for temporal sorting
            timestamp: item.timestamp,
            createdAt: item.createdAt,
            lastAccessed: item.lastAccessed,
            savedAt: item.savedAt,
            categorizedAt: item.categorizedAt,
            lastUpdated: item.lastUpdated
          });
        } else {
          // Mark for feature extraction
          itemsNeedingFeatures.push(item);
        }
      }
      
      // Second pass: extract features for items that need them
      if (itemsNeedingFeatures.length > 0) {
        logger.mlTraining(`📊 Extracting features for ${itemsNeedingFeatures.length} training samples (${trainingData.length - itemsNeedingFeatures.length} already had features)`);
        
        // Import feature extraction
        const { prepareEmbeddingInputs } = await import('../embeddings/embedding-model.js');
        const featureUpdates = [];
        
        for (const item of itemsNeedingFeatures) {
          const inputs = prepareEmbeddingInputs(item, vocabulary);
          const features = {
            urlTokens: inputs.urlTokens,
            titleTokens: inputs.titleTokens,
            engineeredFeatures: inputs.features
          };
          
          // Validate confidence values
          if (typeof item.trainingConfidence !== 'number' || item.trainingConfidence < 0 || item.trainingConfidence > 1) {
            throw new Error(`Invalid trainingConfidence for ${item.url}: ${item.trainingConfidence}`);
          }
          if (typeof item.combinedConfidence !== 'number' || item.combinedConfidence < 0 || item.combinedConfidence > 1) {
            throw new Error(`Invalid combinedConfidence for ${item.url}: ${item.combinedConfidence}`);
          }
          
          preparedData.push({
            url: item.url,
            title: item.title,
            category: item.category,
            features: features,
            trainingConfidence: item.trainingConfidence,
            combinedConfidence: item.combinedConfidence,
            // Preserve timestamp fields for temporal sorting
            timestamp: item.timestamp,
            createdAt: item.createdAt,
            lastAccessed: item.lastAccessed,
            savedAt: item.savedAt,
            categorizedAt: item.categorizedAt,
            lastUpdated: item.lastUpdated
          });
          
          // Collect updates for batch storage
          featureUpdates.push({
            url: item.url,
            updates: {
              features: features,
              featureVersion: FEATURE_VERSION
            }
          });
        }
        
        // Batch update all missing features to database
        if (featureUpdates.length > 0) {
          try {
            const { updateTrainingDataBatch } = await import('../storage/ml-database.js');
            await updateTrainingDataBatch(featureUpdates);
            logger.mlTraining(`✅ Stored features for ${featureUpdates.length} training samples`);
          } catch (error) {
            console.error('Failed to store calculated features:', error);
          }
        }
      }
      timings.afterFeatures = Date.now();
      
      // Prepare validation data if provided
      let preparedValidationData = null;
      if (options.validationData && options.validationData.length > 0) {
        logger.mlTraining(`📊 Preparing validation data features for ${options.validationData.length} samples`);
        preparedValidationData = [];
        
        // Import feature extraction
        const { prepareEmbeddingInputs } = await import('../embeddings/embedding-model.js');
        
        for (const item of options.validationData) {
          if (!item.features || item.featureVersion !== FEATURE_VERSION) {
            // Calculate features for validation data
            const inputs = prepareEmbeddingInputs(item, vocabulary);
            const features = {
              urlTokens: inputs.urlTokens,
              titleTokens: inputs.titleTokens,
              engineeredFeatures: inputs.features
            };
            
            // Validate confidence values
            if (typeof item.trainingConfidence !== 'number' || item.trainingConfidence < 0 || item.trainingConfidence > 1) {
              throw new Error(`Invalid trainingConfidence for validation data ${item.url}: ${item.trainingConfidence}`);
            }
            if (typeof item.combinedConfidence !== 'number' || item.combinedConfidence < 0 || item.combinedConfidence > 1) {
              throw new Error(`Invalid combinedConfidence for validation data ${item.url}: ${item.combinedConfidence}`);
            }
            
            preparedValidationData.push({
              url: item.url,
              title: item.title,
              category: item.category,
              features: features,
              trainingConfidence: item.trainingConfidence,
              combinedConfidence: item.combinedConfidence,
              // Preserve timestamp fields
              timestamp: item.timestamp,
              createdAt: item.createdAt,
              lastAccessed: item.lastAccessed,
              savedAt: item.savedAt,
              categorizedAt: item.categorizedAt,
              lastUpdated: item.lastUpdated
            });
          } else {
            // Use existing features
            // Validate confidence values
            if (typeof item.trainingConfidence !== 'number' || item.trainingConfidence < 0 || item.trainingConfidence > 1) {
              throw new Error(`Invalid trainingConfidence for validation data ${item.url}: ${item.trainingConfidence}`);
            }
            if (typeof item.combinedConfidence !== 'number' || item.combinedConfidence < 0 || item.combinedConfidence > 1) {
              throw new Error(`Invalid combinedConfidence for validation data ${item.url}: ${item.combinedConfidence}`);
            }
            preparedValidationData.push(item);
          }
        }
        logger.mlTraining(`✅ Prepared validation data features for ${preparedValidationData.length} samples`);
      }
      
      // Load existing model weights for incremental training or resuming
      let existingWeights = null;
      let startEpoch = 0;
      
      // Helper function to extract training state from any model record
      const extractTrainingState = async (model, source) => {
        if (!model) return null;
        
        // For current model, we need to load the TensorFlow.js model weights separately
        let weights = model.weights;
        if (!weights && source === 'current model') {
          try {
            // Try to load the TensorFlow.js model
            const tf = await import('../tensorflow-loader.js').then(m => m.getTensorFlow());
            if (tf) {
              const tfModel = await tf.loadLayersModel('indexeddb://tab-classifier-model');
              if (tfModel) {
                // Extract weights from the TensorFlow model
                const modelWeights = tfModel.getWeights();
                weights = await Promise.all(
                  modelWeights.map(async (w) => ({
                    shape: w.shape,
                    data: await w.data()
                  }))
                );
                // Dispose the tensors
                modelWeights.forEach(w => w.dispose());
                tfModel.dispose();
                logger.mlTraining('✅ Loaded TensorFlow.js model weights for incremental training');
              }
            }
          } catch (error) {
            logger.mlTraining('⚠️ Could not load TensorFlow.js model weights:', error.message);
          }
        }
        
        if (!weights) {
          logger.mlTraining(`⚠️ No weights found in ${source}`);
          return null;
        }
        
        // Get training history from model metadata (single source of truth)
        let trainingHistory = model.metadata?.trainingHistory;
        
        // For incremental training, ensure we have the complete history from current model
        if (!trainingHistory && source === 'current model') {
          logger.mlTraining('⚠️ Current model missing training history for incremental training');
          // For incremental training without history, start fresh
          trainingHistory = {
            loss: [],
            accuracy: [],
            val_loss: [],
            val_accuracy: []
          };
        }
        
        // Determine the actual epoch count - ALWAYS use training history length as source of truth
        let epochCount = 0;
        if (trainingHistory && trainingHistory.loss && trainingHistory.loss.length > 0) {
          // Use training history length as the definitive epoch count
          epochCount = trainingHistory.loss.length;
          logger.mlTraining(`📊 Determined epoch count from training history: ${epochCount}`);
        } else if (model.metadata?.epoch !== undefined) {
          // Fallback to metadata only if no training history
          epochCount = model.metadata.epoch;
        } else {
          // No reliable epoch information found
          epochCount = 0;
        }
        
        const state = {
          weights: weights,  // Use the weights we loaded (either from model or TF.js)
          epoch: epochCount,
          bestAccuracy: model.metadata?.bestAccuracy ?? model.metadata?.accuracy ?? model.accuracy ?? 0,
          epochsWithoutImprovement: model.metadata?.epochsWithoutImprovement ?? 0,
          trainingHistory: trainingHistory
        };
        
        logger.mlTraining(`📊 Loaded ${source} with state:`, {
          epoch: state.epoch,
          bestAccuracy: (state.bestAccuracy * 100).toFixed(1) + '%',
          hasHistory: !!state.trainingHistory
        });
        
        return state;
      };
      
      // Try to load training state from checkpoint or current model
      let trainingState = null;
      
      // First check for interrupted training checkpoint
      const { getTrainingCheckpoint } = await import('../storage/ml-database.js');
      const checkpoint = await getTrainingCheckpoint('last');
      if (checkpoint) {
        trainingState = await extractTrainingState(checkpoint, 'checkpoint');
      }
      
      // If no checkpoint but incremental training requested, load current model
      if (!trainingState && options.incremental) {
        logger.mlTraining('🔄 No checkpoint found, loading current model for incremental training...');
        const { loadModel } = await import('../storage/ml-database.js');
        const currentModel = await loadModel();
        if (currentModel) {
          logger.mlTraining('📊 Current model found:', {
            hasWeights: !!currentModel.weights,
            hasMetadata: !!currentModel.metadata,
            metadataEpoch: currentModel.metadata?.epoch,
            accuracy: currentModel.accuracy
          });
          trainingState = await extractTrainingState(currentModel, 'current model');
        } else {
          logger.mlTraining('⚠️ No current model found for incremental training');
        }
      }
      
      // Apply the loaded state
      if (trainingState) {
        existingWeights = trainingState.weights;
        startEpoch = trainingState.epoch + 1;
        options.bestAccuracy = trainingState.bestAccuracy;
        options.epochsWithoutImprovement = trainingState.epochsWithoutImprovement;
        options.trainingHistory = trainingState.trainingHistory;
        
        logger.mlTraining(`🔄 ${checkpoint ? 'Resuming from checkpoint' : 'Incremental training'} at epoch ${startEpoch}`, {
          loadedEpoch: trainingState.epoch,
          historyLength: trainingState.trainingHistory?.loss?.length || 0,
          bestAccuracy: (trainingState.bestAccuracy * 100).toFixed(1) + '%'
        });
      } else {
        logger.mlTraining('⚠️ No training state loaded, starting from epoch 0');
      }
      
      // Store the max training data timestamp in the job for later use
      const job = this.jobs.get(jobId);
      if (job && maxTimestamp > 0) {
        job.trainingDataTimestamp = maxTimestamp;
      }
      timings.beforeSend = Date.now();
      
      // Log timing breakdown
      logger.mlDiagnostic('⏱️ Training preparation timings:', {
        initialization: timings.afterInit - timings.start,
        vocabulary: timings.afterVocab - timings.afterInit,
        features: timings.afterFeatures - timings.afterVocab,
        weights: timings.beforeSend - timings.afterFeatures,
        total: timings.beforeSend - timings.start
      });
      
      // Dispatch training started event for charts
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('trainingStarted', {
          detail: { isIncremental: options.incremental }
        }));
      }
      
      // Send training request to worker with vocabulary and existing weights
      const result = await this.sendMessage('TRAIN', {
        modelConfig,
        vocabulary: {
          tokenToId: vocabulary.tokenToId,
          idToToken: vocabulary.idToToken,
          size: vocabulary.size()
        },
        trainingData: preparedData,
        validationData: preparedValidationData, // Pass prepared validation data
        existingWeights: existingWeights, // Pass existing weights for incremental training
        options: {
          epochs: options.epochs,
          batchSize: options.batchSize,
          learningRate: options.learningRate,
          validationSplit: ML_CONFIG.training.validationSplit,
          incremental: options.incremental, // Pass incremental flag to worker
          startEpoch: startEpoch, // Resume from this epoch if continuing interrupted training
          bestAccuracy: options.bestAccuracy, // Pass checkpoint state for resuming
          epochsWithoutImprovement: options.epochsWithoutImprovement, // Pass checkpoint state for resuming
          trainingHistory: options.trainingHistory, // Pass training history for resuming
          // Early stopping parameters
          maxEpochs: options.epochs, // Must be provided, no fallback
          minEpochs: ML_CONFIG.training.earlyStopping.minEpochs, // Same for incremental and regular
          earlyStoppingPatience: options.earlyStoppingPatience,
          earlyStoppingMinDelta: ML_CONFIG.training.earlyStopping.minDelta
        }
      }, jobId);
      
      return result;
      
    } catch (error) {
      console.error('Training execution error:', error);
      const job = this.jobs.get(jobId);
      if (job && job.onError) {
        job.onError(error);
      }
      this.jobs.delete(jobId);
      throw error;
    }
  }

  /**
   * Train model in background
   * @param {Object} modelConfig - Model configuration
   * @param {Array} trainingData - Training data
   * @param {Object} options - Training options
   * @returns {Promise<Object>} Training results
   */
  async trainModel(modelConfig, trainingData, options = {}) {
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    const jobId = this.generateJobId();
    
    // Create job record
    const job = {
      id: jobId,
      type: 'training',
      startTime: Date.now(),
      status: 'running',
      progress: 0,
      onProgress: options.onProgress,
      onBatchProgress: options.onBatchProgress,
      onComplete: options.onComplete,
      onError: options.onError
    };
    
    this.jobs.set(jobId, job);
    
    try {
      // Check if should train based on conditions
      if (!this.shouldTrain()) {
        throw new Error('Training conditions not met');
      }
      
      // Send training request
      const result = await this.sendMessage('TRAIN', {
        modelConfig,
        trainingData,
        options: {
          epochs: options.epochs, // Must be provided, no fallback
          batchSize: options.batchSize,
          validationSplit: options.validationSplit || ML_CONFIG.training.validationSplit
        }
      }, jobId);
      
      return result;
      
    } catch (error) {
      // Clean up job
      this.jobs.delete(jobId);
      throw error;
    }
  }
  
  /**
   * Make predictions using worker
   * @param {Object} modelWeights - Model weights
   * @param {Array} inputData - Input data
   * @param {Object} modelConfig - Model configuration
   * @returns {Promise<Object>} Predictions
   */
  async predict(modelWeights, inputData, modelConfig) {
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    return this.sendMessage('PREDICT', {
      modelWeights,
      inputData,
      modelConfig
    });
  }
  
  /**
   * Cancel training job
   * @param {string} jobId - Job ID to cancel
   */
  cancelJob(jobId) {
    logger.mlTraining(`🚫 cancelJob called for: ${jobId}`);
    if (this.jobs.has(jobId)) {
      const job = this.jobs.get(jobId);
      logger.mlTraining(`🚫 Found job ${jobId} with status: ${job.status}`);
      
      // Mark as cancelling, don't delete yet
      job.status = 'cancelling';
      logger.mlTraining(`🚫 Sending CANCEL message for job ${jobId}`);
      
      // Send cancel message to worker
      this.sendMessage('CANCEL', null, jobId);
      
      // Don't delete the job here - wait for CANCELLED response from worker
      // The handleWorkerMessage will clean up when it receives CANCELLED
    } else {
      logger.mlTraining(`🚫 Job ${jobId} not found in jobs map`);
    }
  }
  
  /**
   * Get worker status
   */
  async getStatus() {
    if (!this.isInitialized) {
      return { initialized: false };
    }
    
    const status = await this.sendMessage('STATUS');
    
    return {
      initialized: true,
      ...status,
      activeJobs: Array.from(this.jobs.values()).map(job => ({
        id: job.id,
        type: job.type,
        status: job.status,
        progress: job.progress,
        duration: Date.now() - job.startTime
      }))
    };
  }
  
  /**
   * Handle training progress
   */
  handleProgress(jobId, data) {
    if (!this.jobs.has(jobId)) return;
    
    const job = this.jobs.get(jobId);
    job.progress = data.epoch / data.totalEpochs;
    
    // Dispatch training progress event for charts
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('trainingProgress', {
        detail: {
          epoch: data.epoch,
          totalEpochs: data.totalEpochs,
          loss: data.loss,
          trainAccuracy: data.trainAccuracy,
          accuracy: data.accuracy,
          valLoss: data.valLoss,
          valAccuracy: data.valAccuracy,
          progress: job.progress
        }
      }));
    }
    
    // Call progress callback
    if (job.onProgress) {
      job.onProgress({
        ...data,
        progress: job.progress,
        elapsed: Date.now() - job.startTime
      });
    }
    
    // Progress tracking without logging
  }
  
  /**
   * Handle training completion
   */
  async handleTrainingComplete(jobId, data) {
    if (!this.jobs.has(jobId)) return;
    
    const job = this.jobs.get(jobId);
    job.status = 'completed';
    
    try {
      // Import required modules
      const { cleanupTrainingModels } = await import('../storage/ml-database.js');
      const { getTabClassifier } = await import('../models/tab-classifier.js');
      const classifier = await getTabClassifier();
      
      if (logger.isEnabled('ml.diagnostics')) {
        logger.mlDiagnostic('🔍 DEBUG_PROMOTION: Training completion validation');
        logger.mlDiagnostic(`   Actual epochs completed: ${data.actualEpochs ?? 0}`);
        logger.mlDiagnostic(`   Early stopping triggered: ${data.earlyStoppingTriggered || false}`);
        logger.mlDiagnostic(`   Final accuracy: ${((data.finalAccuracy ?? 0) * 100).toFixed(1)}%`);
      }
      
      // Additional validation: Only promote if training actually completed
      if (!data.actualEpochs || data.actualEpochs === 0) {
        throw new Error('Training completed with 0 epochs - this indicates a training failure, not promoting model');
      }
      
      // Training is complete - promote the training model
      const currentAccuracy = classifier.metadata?.accuracy ?? 0;
      
      // Determine which accuracy to report based on whether we're using an earlier checkpoint
      let reportedAccuracy;
      let accuracyDescription;
      if (data.usedEarlierCheckpoint && data.bestEpoch < data.actualEpochs) {
        // We're promoting a checkpoint from an earlier epoch
        reportedAccuracy = data.finalAccuracy; // This is the checkpoint's accuracy when promotionData exists
        accuracyDescription = `Best checkpoint accuracy from epoch ${data.bestEpoch}`;
      } else {
        // We're using the final epoch's model
        reportedAccuracy = data.finalAccuracy ?? data.bestAccuracy ?? 0;
        accuracyDescription = 'Final accuracy';
      }
      
      logger.mlTraining(`Training complete after ${data.actualEpochs} epochs`);
      logger.mlTraining(`${accuracyDescription}: ${(reportedAccuracy * 100).toFixed(1)}% (previous: ${(currentAccuracy * 100).toFixed(1)}%)`);
      
      // print modelImproved status
      logger.mlTraining(`Model improved: ${data.modelImproved}`);

      // Check if model improved (based on validation loss for incremental training)
      if (data.modelImproved === false) {
        logger.mlTraining('⚠️ Model did not improve from baseline - keeping current model');
        if (data.sessionStartValLoss !== undefined) {
          logger.mlTraining(`   Baseline val_loss: ${data.sessionStartValLoss?.toFixed(4)}, Best val_loss: ${data.finalLoss?.toFixed(4)}`);
        }
        
        // Clean up training checkpoints without promoting
        const { deleteTrainingCheckpoint } = await import('../storage/ml-database.js');
        await deleteTrainingCheckpoint('last');
        await deleteTrainingCheckpoint('best');
        logger.mlTraining('✓ Cleaned up training checkpoints without promotion');
        
        // Complete the job with a message about no improvement
        job.status = 'completed';
        const result = {
          success: true,
          improved: false,
          accuracy: currentAccuracy, // Keep current accuracy
          message: 'Training completed but model did not improve',
          actualEpochs: data.actualEpochs
        };
        
        if (job.onComplete) {
          job.onComplete(result);
        }
        
        this.resolveJob(jobId, result);
        return;
      }
      
      logger.mlTraining('✅ Model improved - promoting new model');
      
      // Promote the best checkpoint to current model
      const { promoteTrainingModel, deleteTrainingCheckpoint, getTrainingCheckpoint } = await import('../storage/ml-database.js');
      
      // Wait a moment for checkpoint to be saved (race condition fix)
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Check if best checkpoint exists, fall back to last if needed
      const bestCheckpoint = await getTrainingCheckpoint('best');
      if (bestCheckpoint) {
        logger.mlTraining('📊 Promoting best checkpoint:', {
          hasWeights: !!bestCheckpoint.weights,
          epoch: bestCheckpoint.metadata?.epoch,
          accuracy: bestCheckpoint.accuracy
        });
        await promoteTrainingModel('training_best');
      } else {
        logger.mlTraining('⚠️ Best checkpoint not found, checking for last checkpoint...');
        const lastCheckpoint = await getTrainingCheckpoint('last');
        if (lastCheckpoint) {
          logger.mlTraining('📊 Promoting last checkpoint:', {
            hasWeights: !!lastCheckpoint.weights,
            epoch: lastCheckpoint.metadata?.epoch,
            accuracy: lastCheckpoint.accuracy
          });
          await promoteTrainingModel('training_last');
        } else {
          throw new Error('No training checkpoints found to promote');
        }
      }
      
      // Training history is now stored in model metadata - no separate save needed
      // The promoted checkpoint already contains the truncated history in its metadata
      
      // Delete training checkpoints after promotion
      await deleteTrainingCheckpoint('last');
      await deleteTrainingCheckpoint('best');
      
      logger.mlTraining('✓ Cleaned up checkpoint models after promotion');
      
      // CRITICAL: We need to reconstruct the TensorFlow.js model from the promoted weights
      // The promoted model has weights in our custom format, but tab-classifier needs them in TF format
      
      // First, load the promoted model data
      const { loadModel } = await import('../storage/ml-database.js');
      const promotedModel = await loadModel();
      
      logger.mlTraining('📊 Promoted model state:', {
        hasWeights: !!promotedModel?.weights,
        epoch: promotedModel?.metadata?.epoch,
        accuracy: promotedModel?.accuracy || promotedModel?.metadata?.accuracy,
        trainingSamples: promotedModel?.trainingSamples || promotedModel?.metadata?.trainingSamples
      });
      
      if (!promotedModel || !promotedModel.weights) {
        throw new Error('Promoted model has no weights!');
      }
      
      // Create a new classifier instance
      const { TabClassifier } = await import('../models/tab-classifier.js');
      const freshClassifier = new TabClassifier();
      await freshClassifier.initialize();
      
      // Load the weights from the promoted model
      logger.mlTraining('🔄 Loading promoted weights into classifier...');
      const tf = await import('../tensorflow-loader.js').then(m => m.getTensorFlow());
      const weightTensors = promotedModel.weights.map(w => 
        tf.tensor(w.data, w.shape)
      );
      freshClassifier.model.setWeights(weightTensors);
      
      // Dispose tensors to prevent memory leak
      weightTensors.forEach(t => t.dispose());
      
      // Update classifier metadata with promoted model's metadata
      freshClassifier.metadata = {
        ...promotedModel.metadata,
        version: Date.now().toString(),
        accuracy: promotedModel.accuracy ?? promotedModel.metadata?.accuracy ?? 0,
        trainingSamples: promotedModel.metadata?.epoch ?? promotedModel.trainingSamples ?? 0
      };
      
      // Now save the complete model (both TF format and metadata)
      await freshClassifier.save();
      
      // Reset the singleton caches - both classifier and categorizer
      const { resetTabClassifierCache } = await import('../models/tab-classifier.js');
      resetTabClassifierCache();
      
      // Also reset ML categorizer cache since it holds a reference to the old classifier
      const { resetMLCategorizerCache } = await import('../categorization/ml-categorizer.js');
      resetMLCategorizerCache();
      
      logger.mlTraining('✓ Model saved to IndexedDB for next startup');
      
      if (reportedAccuracy >= currentAccuracy) {
        logger.mlTraining('Model promoted with improved accuracy');
      } else {
        logger.mlTraining('Model promoted - includes user corrections (temporary accuracy drop expected)');
      }
      
      // Dispatch event to notify UI that model has been promoted
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('mlModelPromoted', {
          detail: { accuracy: reportedAccuracy, epoch: data.bestEpoch }
        }));
      }
      
      // Record metrics
      await recordMetric({
        method: 'model',
        type: 'training_complete',
        value: data.finalAccuracy,
        metadata: {
          duration: data.duration,
          finalLoss: data.finalLoss,
          epochs: (data.history.loss && data.history.loss.length) ?? data.actualEpochs ?? 0,
          inWorker: true
        }
      });
      
      // Create success result
      const result = {
        success: true,
        accuracy: reportedAccuracy, // Use the same accuracy we reported in the logs
        loss: data.finalLoss,
        duration: data.duration,
        history: data.history,
        usedEarlierCheckpoint: data.usedEarlierCheckpoint,
        bestEpoch: data.bestEpoch
      };
      
      // Call completion callback
      if (job.onComplete) {
        job.onComplete(result);
      }
      
      // Resolve promise
      this.resolveJob(jobId, result);
      
    } catch (error) {
      console.error('Error handling training completion:', error);
      if (job.onError) {
        job.onError(error);
      }
      this.rejectJob(jobId, error);
    }
    
    // Clean up
    this.jobs.delete(jobId);
    
    const stoppingInfo = data.earlyStoppingTriggered ? 
      ` (early stopped at epoch ${data.actualEpochs})` : 
      ` (${data.actualEpochs} epochs)`;
    
    logger.mlTraining(`Training completed in ${(data.duration / 1000).toFixed(1)}s with accuracy: ${(data.finalAccuracy * 100).toFixed(1)}%${stoppingInfo}`);
  }
  
  /**
   * Handle prediction completion
   */
  resolvePrediction(jobId, data) {
    this.resolveJob(jobId, data);
  }
  
  /**
   * Handle worker error
   */
  handleError(jobId, error) {
    console.error('Worker error for job', jobId, ':', error);
    
    // Safely extract error message with more robust handling
    let errorMessage = 'Unknown worker error';
    try {
      if (error === null || error === undefined) {
        errorMessage = 'Worker error with no details';
      } else if (error && typeof error === 'object') {
        errorMessage = error.message || error.toString() || 'Unknown worker error';
      } else if (typeof error === 'string' && error && error.length > 0) {
        errorMessage = error;
      } else if (error) {
        errorMessage = String(error);
      }
    } catch (e) {
      console.error('Error while extracting error message:', e);
      errorMessage = 'Unknown worker error';
    }
    
    const errorObject = new Error(errorMessage);
    
    if (this.jobs.has(jobId)) {
      const job = this.jobs.get(jobId);
      job.status = 'error';
      
      if (job.onError) {
        job.onError(errorObject);
      }
      
      this.jobs.delete(jobId);
    }
    
    this.rejectJob(jobId, errorObject);
  }
  
  /**
   * Handle worker crash
   */
  handleWorkerError(error) {
    console.error('Worker crashed:', error);
    
    // Cancel all active jobs
    this.jobs.forEach((job, jobId) => {
      if (job.onError) {
        job.onError(new Error('Worker crashed'));
      }
      this.rejectJob(jobId, error);
    });
    
    this.jobs.clear();
    this.isInitialized = false;
    
    // Attempt to restart with limit
    this.restartAttempts++;
    if (this.restartAttempts <= this.maxRestartAttempts) {
      setTimeout(() => {
        console.log(`Attempting to restart worker... (attempt ${this.restartAttempts}/${this.maxRestartAttempts})`);
        this.initialize().catch(console.error);
      }, 5000);
    } else {
      console.error(`Worker failed to start after ${this.maxRestartAttempts} attempts. Giving up.`);
    }
  }
  
  /**
   * Handle memory warning
   */
  handleMemoryWarning(memoryInfo) {
    console.warn('High memory usage:', memoryInfo);
    
    // Record metric
    recordMetric({
      method: 'system',
      type: 'memory_warning',
      value: memoryInfo.numBytes,
      metadata: memoryInfo
    });
  }
  
  /**
   * Handle training checkpoint
   */
  async handleCheckpoint(jobId, data, checkpointType) {
    if (!this.jobs.has(jobId)) return;
    
    const job = this.jobs.get(jobId);
    
    try {
      // Import database functions
      const { saveTrainingCheckpoint } = await import('../storage/ml-database.js');
      
      // Get current vocabulary for saving with model
      const { getOrCreateVocabulary } = await import('../features/vocabulary.js');
      const vocabulary = await getOrCreateVocabulary();
      
      // Save checkpoint with specific type
      const checkpointData = {
        weights: data.weights,
        vocabulary: {
          tokenToId: vocabulary.tokenToId,
          idToToken: vocabulary.idToToken,
          size: vocabulary.size()
        },
        accuracy: data.accuracy,
        trainingSamples: data.epoch,
        trainedUpTo: job.trainingDataTimestamp || Date.now(),
        metadata: {
          epoch: data.epoch,
          bestAccuracy: data.bestAccuracy,
          epochsWithoutImprovement: data.epochsWithoutImprovement,
          jobId: jobId,
          trainedUpTo: job.trainingDataTimestamp || Date.now(),
          valLoss: data.valLoss, // Include validation loss for best model tracking
          trainingHistory: data.trainingHistory // Include synchronized history
        }
      };
      
      await saveTrainingCheckpoint(checkpointData, checkpointType);
      
      logger.mlTraining(`✓ Saved ${checkpointType} checkpoint at epoch ${data.epoch}`);
      
    } catch (error) {
      console.error(`Failed to save ${checkpointType} checkpoint:`, error);
    }
  }
  
  /**
   * Check if should train based on conditions
   */
  shouldTrain() {
    const config = ML_CONFIG.backgroundTraining;
    
    // Check if enabled
    if (!config.enabled) {
      console.log('Background training disabled');
      return false;
    }
    
    // Check if requires idle (simplified check)
    if (config.requiresIdle && document.visibilityState !== 'hidden') {
      console.log('Not idle - postponing training');
      return false;
    }
    
    return true;
  }
  
  /**
   * Generate unique job ID
   */
  generateJobId() {
    return `job_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
  
  /**
   * Resolve job promise
   */
  resolveJob(jobId, data) {
    if (this.callbacks.has(jobId)) {
      const { resolve } = this.callbacks.get(jobId);
      resolve(data);
      this.callbacks.delete(jobId);
    }
  }
  
  /**
   * Reject job promise
   */
  rejectJob(jobId, error) {
    if (this.callbacks.has(jobId)) {
      const { reject } = this.callbacks.get(jobId);
      reject(error);
      this.callbacks.delete(jobId);
    }
  }
  
  /**
   * Cancel all active training jobs without terminating the worker
   */
  cancelAllTrainingJobs() {
    const trainingJobs = Array.from(this.jobs.entries())
      .filter(([_, job]) => job.type === 'training' && job.status === 'running');
    
    trainingJobs.forEach(([jobId, job]) => {
      logger.mlTraining(`Cancelling training job: ${jobId}`);
      this.cancelJob(jobId);
    });
    
    return trainingJobs.length;
  }
  
  /**
   * Force clear all training jobs (for emergency cleanup)
   */
  forceCleanupTrainingJobs() {
    const trainingJobs = Array.from(this.jobs.entries())
      .filter(([_, job]) => job.type === 'training');
    
    trainingJobs.forEach(([jobId, job]) => {
      logger.mlTraining(`Force removing training job: ${jobId} (status: ${job.status})`);
      // Send cancel message just in case
      if (job.status === 'running') {
        this.sendMessage('CANCEL', null, jobId);
      }
      // Force remove from jobs map
      this.jobs.delete(jobId);
      // Clean up callbacks
      if (this.callbacks.has(jobId)) {
        this.callbacks.delete(jobId);
      }
    });
    
    logger.mlTraining(`Force cleaned up ${trainingJobs.length} training job(s)`);
    return trainingJobs.length;
  }
  
  /**
   * Terminate worker
   */
  terminate() {
    if (this.worker) {
      // Cancel all active jobs
      this.jobs.forEach((_, jobId) => {
        this.cancelJob(jobId);
      });
      
      // Terminate worker
      this.worker.terminate();
      this.worker = null;
      this.isInitialized = false;
      
      logger.mlTraining('Worker terminated');
    }
  }
}

// Export singleton
let managerInstance = null;

export function getWorkerManager() {
  if (!managerInstance) {
    managerInstance = new WorkerManager();
  }
  return managerInstance;
}

export default {
  WorkerManager,
  getWorkerManager
};