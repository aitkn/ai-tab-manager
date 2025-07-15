/*
 * AI Tab Manager - Training Worker
 * Web Worker for background model training
 * 
 * IMPORTANT: TensorFlow.js Bug Workaround
 * model.fit() reports training loss that's ~6.57x higher than model.evaluate()
 * on the same data. This worker implements a workaround by using manual
 * evaluation to get accurate training loss metrics for progress reporting.
 */

// Assertion function for fail-fast validation
function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

// Worker state
let isTraining = false;
let currentJob = null;
let tf = null;

// Import feature extraction functions
let extractPatternFeatures, extractTokenFeatures, extractNumericalFeatures;

// Import ML Logger
let mlLogger;

// Load TensorFlow.js in Web Worker
async function loadTensorFlowInWorker() {
  try {
    mlLogger.info('Loading TensorFlow.js modules in worker...');
    
    // Get the base URL from the worker location
    const workerUrl = self.location.href;
    const baseUrl = workerUrl.substring(0, workerUrl.lastIndexOf('/src/ml/workers/'));
    mlLogger.mlDiagnostic('Base URL:', baseUrl);
    
    // Use importScripts for classic workers
    importScripts(
      baseUrl + '/lib/tf-core.min.js',
      baseUrl + '/lib/tf-backend-cpu.min.js',
      baseUrl + '/lib/tf-backend-webgl.min.js',
      baseUrl + '/lib/tf-layers.min.js'
    );
    
    tf = self.tf;
    
    if (!tf) {
      throw new Error('TensorFlow.js global not found after imports');
    }
    
    // Let TensorFlow.js choose the best available backend
    await tf.ready();
    const backend = tf.getBackend();
    
    mlLogger.info(`TensorFlow.js loaded in worker with ${backend} backend`);
    return true;
  } catch (error) {
    console.error('Failed to load TensorFlow.js in worker:', error);
    return false;
  }
}

// Message handler
self.addEventListener('message', async (event) => {
  const { type, data, jobId } = event.data;
  
  
  try {
    switch (type) {
      case 'INIT':
        await handleInit(jobId);
        break;
        
      case 'TRAIN':
        await handleTrain(data, jobId);
        break;
        
      case 'PREDICT':
        await handlePredict(data, jobId);
        break;
        
      case 'CANCEL':
        handleCancel(jobId);
        break;
        
      case 'STATUS':
        handleStatus();
        break;
        
      case 'CONFIGURE_LOGGING':
        handleLoggingConfig(data);
        break;
        
      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  } catch (error) {
    // Safely extract error information
    let errorMessage = 'Unknown worker error';
    let errorStack = '';
    
    try {
      if (error && typeof error === 'object') {
        errorMessage = error.message || error.toString() || 'Unknown worker error';
        errorStack = error.stack || '';
      } else if (error && typeof error === 'string') {
        errorMessage = error;
      } else if (error) {
        errorMessage = String(error);
      }
    } catch (e) {
      console.error('Error while extracting worker error:', e);
      errorMessage = 'Unknown worker error';
    }
    
    self.postMessage({
      type: 'ERROR',
      jobId,
      error: {
        message: errorMessage,
        stack: errorStack
      }
    });
  }
});

/**
 * Initialize the worker
 */
async function handleInit(jobId) {
  // Starting worker initialization... (using mlLogger.info once initialized)
  
  // Initialize logger with default config (all debug logging disabled)
  mlLogger = {
    isEnabled: () => false, // Default to disabled in workers
    mlDiagnostic: () => {},
    diagnostic: () => {}, // Legacy support
    verbose: () => {},
    mlArchitecture: () => {},
    architecture: () => {}, // Legacy support
    mlTraining: () => {},
    training: () => {}, // Legacy support
    mlFeatures: () => {},
    features: () => {}, // Legacy support
    mlConfusion: () => {},
    confusion: () => {}, // Legacy support
    debug: () => {},
    error: console.error,
    warn: console.warn,
    info: () => {}  // Silent by default - will be enabled via configuration
  };
  
  // Starting worker initialization using proper logger
  mlLogger.info('Starting worker initialization...');
  
  // Try to load TensorFlow.js
  const loaded = await loadTensorFlowInWorker();
  
  mlLogger.info('TensorFlow load result:', loaded);
  
  if (loaded && tf) {
    self.postMessage({
      type: 'INITIALIZED',
      jobId: jobId,
      data: {
        tfVersion: tf.version ? tf.version.tfjs || 'loaded' : 'loaded',
        backend: tf.getBackend ? tf.getBackend() : 'cpu'
      }
    });
  } else {
    self.postMessage({
      type: 'INITIALIZED',
      jobId: jobId,
      data: {
        tfVersion: 'unavailable',
        backend: 'none',
        message: 'TensorFlow.js not available - please download it first'
      }
    });
  }
}

/**
 * Handle training request
 */
async function handleTrain(data, jobId) {
  // Check if TensorFlow.js is available
  if (!tf) {
    throw new Error('TensorFlow.js not loaded - please download it first');
  }
  
  if (isTraining) {
    throw new Error('Training already in progress');
  }
  
  // Validate training data
  if (!data) {
    throw new Error('No training data provided');
  }
  
  if (!data.trainingData || !Array.isArray(data.trainingData)) {
    throw new Error('Invalid training data - expected array');
  }
  
  isTraining = true;
  currentJob = { id: jobId, startTime: Date.now() };
  
  mlLogger.mlTraining('🏃 Starting training with:', {
    incremental: data.options?.incremental,
    startEpoch: data.options?.startEpoch || 0,
    learningRate: data.modelConfig?.learningRate,
    samples: data.trainingData.length,
    validationSamples: data.validationData ? data.validationData.length : 'internal split'
  });
  
  try {
    const { modelConfig, vocabulary, trainingData, validationData, existingWeights, options } = data;
    
    
    // Analyze training data distribution
    const trainCategories = {};
    const trainWeights = {};
    trainingData.forEach(item => {
      const cat = item.category;
      trainCategories[cat] = (trainCategories[cat] || 0) + 1;
      // Validate confidence
      assert(typeof item.trainingConfidence === 'number', `Invalid trainingConfidence type: ${typeof item.trainingConfidence} for item ${item.url}`);
      assert(item.trainingConfidence >= 0 && item.trainingConfidence <= 1, `Training confidence out of range: ${item.trainingConfidence} for item ${item.url}`);
      trainWeights[cat] = (trainWeights[cat] || 0) + item.trainingConfidence;
    });
    
    if (validationData && validationData.length > 0) {
      const valCategories = {};
      const valWeights = {};
      validationData.forEach(item => {
        const cat = item.category;
        valCategories[cat] = (valCategories[cat] || 0) + 1;
        // Validate confidence
        assert(typeof item.trainingConfidence === 'number', `Invalid trainingConfidence type: ${typeof item.trainingConfidence} for item ${item.url}`);
        assert(item.trainingConfidence >= 0 && item.trainingConfidence <= 1, `Training confidence out of range: ${item.trainingConfidence} for item ${item.url}`);
        valWeights[cat] = (valWeights[cat] || 0) + item.trainingConfidence;
      });
    }
    
    // Build model
    const model = buildModel(modelConfig);
    
    // Model ready for training
    
    // Load existing weights for incremental training
    if (options.incremental && existingWeights) {
      try {
        mlLogger.mlTraining('🔄 Loading existing weights for incremental training...');
        mlLogger.mlTraining(`   Number of weight tensors: ${existingWeights.length}`);
        
        // Convert weights data back to tensors and set them
        const weightTensors = existingWeights.map(weight => {
          return tf.tensor(weight.data, weight.shape, weight.dtype);
        });
        
        model.setWeights(weightTensors);
        mlLogger.mlTraining('✅ Successfully loaded existing weights for incremental training');
        
        // If resuming from checkpoint, log the resume state
        if (options.startEpoch > 0) {
          mlLogger.mlTraining(`📊 Resuming from checkpoint:`);
          mlLogger.mlTraining(`   - Starting at epoch ${options.startEpoch}`);
          mlLogger.mlTraining(`   - Best accuracy so far: ${options.bestAccuracy ? (options.bestAccuracy * 100).toFixed(1) : 0.0}%`);
          mlLogger.mlTraining(`   - Epochs without improvement: ${options.epochsWithoutImprovement || 0}`);
        }
        
        // Dispose temporary tensors
        weightTensors.forEach(tensor => tensor.dispose());
      } catch (error) {
        console.warn('Failed to load existing weights, training from scratch:', error);
      }
    }
    
    // Prepare data
    const { xs, ys, sampleWeights, classImbalanceRatio } = prepareData(trainingData, modelConfig, vocabulary);
    
    // If resuming, evaluate the loaded model to verify weights loaded correctly
    if (options.startEpoch > 0 && options.incremental) {
      try {
        // Compile the model first for evaluation
        model.compile({
          optimizer: tf.train.adam(modelConfig.learningRate),
          loss: 'categoricalCrossentropy',
          metrics: ['accuracy']
        });
        
        const evalResult = await model.evaluate(xs, ys, { batchSize: options.batchSize });
        const evalLoss = await evalResult[0].data();
        const evalAccuracy = await evalResult[1].data();
        mlLogger.mlTraining(`📊 Loaded model evaluation: loss=${evalLoss[0].toFixed(4)}, accuracy=${(evalAccuracy[0] * 100).toFixed(1)}%`);
        
        // Dispose eval tensors
        evalResult.forEach(t => t.dispose());
      } catch (error) {
        console.warn('Could not evaluate loaded model:', error);
      }
    }
    
    // Removed unused callbacks object - cancellation is handled in fitOptions.callbacks below
    
    // Custom weighted training - exact copy from tab-classifier.js trainWithCustomWeights
    // Custom weighted training implementation
    
    
    // Custom weighted loss function with proper weighted average
    const weightedLoss = (yWeighted, yPred) => {
      return tf.tidy(() => {
        try {
          // Extract weights by summing weighted one-hot vectors
          const weights = tf.sum(yWeighted, 1);
          
          // Convert back to one-hot using sign function (more robust)
          const yTrue = tf.sign(yWeighted);
          
          // Use built-in categorical cross-entropy for numerical stability
          const crossEntropy = tf.metrics.categoricalCrossentropy(yTrue, yPred);
          
          // Apply sample weights
          const weightedCrossEntropy = tf.mul(crossEntropy, weights);
          
          // Simple approach: Use mean of weighted losses (like standard TensorFlow)
          // This should have the same scale as validation loss
          const finalLoss = tf.mean(weightedCrossEntropy);
          
          // Loss debug code removed for cleaner output
          
          return finalLoss;
        } catch (error) {
          console.error('Error in weightedLoss:', error);
          throw error;
        }
      });
    };
    
    // Custom accuracy metric with proper normalization
    const weightedAccuracy = (yWeighted, yPred) => {
      return tf.tidy(() => {
        // Convert back to one-hot using sign function  
        const yTrue = tf.sign(yWeighted);
        
        const trueClasses = tf.argMax(yTrue, 1);
        const predictedClasses = tf.argMax(yPred, 1);
        const correct = tf.equal(trueClasses, predictedClasses);
        return tf.mean(tf.cast(correct, 'float32'));
      });
    };
    
    // ✅ ENABLED: Custom weighted loss for handling confidence scores
    mlLogger.mlTraining('⚖️ Using custom weighted loss function for confidence-based training');
    
    // Compile model with custom weighted loss and metrics
    model.compile({
      optimizer: tf.train.adam(modelConfig.learningRate),
      loss: weightedLoss,
      metrics: [weightedAccuracy]
    });
    
    // 🔍 CRITICAL DEBUG: Print full model architecture
    // Model architecture analysis (conditional logging)
    if (mlLogger && mlLogger.isEnabled('architecture')) {
      mlLogger.architecture('\n🏗️ MODEL ARCHITECTURE ANALYSIS:');
      mlLogger.architecture('📐 Model Summary:');
      // Only call model.summary() if architecture logging is enabled
      if (mlLogger.isEnabled('ml.architecture') || mlLogger.isEnabled('architecture')) {
        try {
          model.summary();
        } catch (e) {
          // Handle case where model.summary() fails
          mlLogger.architecture('Model summary unavailable:', e.message);
        }
      }
      
      mlLogger.architecture('\n📊 Layer Details:');
      model.layers.forEach((layer, i) => {
        mlLogger.architecture(`  Layer ${i}: ${layer.name} (${layer.constructor.name})`);
        mlLogger.architecture(`    Input shape: ${layer.inputShape || 'N/A'}`);
        mlLogger.architecture(`    Output shape: ${layer.outputShape || 'N/A'}`);
        if (layer.units) mlLogger.architecture(`    Units: ${layer.units}`);
        if (layer.activation) mlLogger.architecture(`    Activation: ${layer.activation}`);
        if (layer.inputDim) mlLogger.architecture(`    Input dim: ${layer.inputDim}`);
        if (layer.outputDim) mlLogger.architecture(`    Output dim: ${layer.outputDim}`);
      });
      
      mlLogger.architecture('\n🔢 Model Configuration Used:');
      mlLogger.architecture('  Config passed to buildModel:', JSON.stringify(modelConfig, null, 2));
      mlLogger.architecture('🏗️ END MODEL ARCHITECTURE\n');
    }
    
    // Early stopping configuration - USE PASSED CONFIG, NO HARDCODED VALUES
    assert(typeof options.epochs === 'number' && options.epochs > 0, `Invalid epochs: ${options.epochs}`);
    assert(typeof options.earlyStoppingPatience === 'number' && options.earlyStoppingPatience > 0, `Invalid earlyStoppingPatience: ${options.earlyStoppingPatience}`);
    assert(typeof options.earlyStoppingMinDelta === 'number' && options.earlyStoppingMinDelta > 0, `Invalid earlyStoppingMinDelta: ${options.earlyStoppingMinDelta}`);
    assert(typeof options.minEpochs === 'number' && options.minEpochs > 0, `Invalid minEpochs: ${options.minEpochs}`);
    
    // Differentiate between fresh training and resumption
    const isResuming = options.startEpoch !== undefined && options.startEpoch > 0;
    
    let bestAccuracy, epochsWithoutImprovement, actualEpochs, startEpoch;
    
    if (isResuming) {
      // When resuming, assert that ALL checkpoint data is valid
      assert(typeof options.startEpoch === 'number' && options.startEpoch >= 0, `Invalid startEpoch: ${options.startEpoch}`);
      assert(typeof options.bestAccuracy === 'number' && options.bestAccuracy >= 0, `Invalid bestAccuracy: ${options.bestAccuracy}`);
      assert(typeof options.epochsWithoutImprovement === 'number' && options.epochsWithoutImprovement >= 0, `Invalid epochsWithoutImprovement: ${options.epochsWithoutImprovement}`);
      
      bestAccuracy = options.bestAccuracy;
      epochsWithoutImprovement = options.epochsWithoutImprovement;
      actualEpochs = options.startEpoch;
      startEpoch = options.startEpoch;
    } else {
      // Fresh training - use clean initial values
      bestAccuracy = 0;
      epochsWithoutImprovement = 0;
      actualEpochs = 0;
      startEpoch = 0;
    }
    
    // Validate epochs is provided
    assert(typeof options.epochs === 'number' && options.epochs > 0, 
      `Epochs must be a positive number, got: ${options.epochs}`);
    
    // For incremental training, we need to add the requested epochs to the starting epoch
    const targetEpochs = options.incremental && startEpoch > 0 
      ? startEpoch + options.epochs  // Continue for N more epochs
      : options.epochs;               // Fresh training to N epochs
      
    const earlyStoppingConfig = {
      patience: options.earlyStoppingPatience, // Use passed config from ML_CONFIG
      minDelta: options.earlyStoppingMinDelta, // Use passed config from ML_CONFIG  
      maxEpochs: targetEpochs, // Target epochs adjusted for incremental training
      minEpochs: options.minEpochs // Use passed config from ML_CONFIG
    };
    
    // For incremental training, we track best model only within current session
    let bestValLoss = undefined;
    let sessionStartValLoss = undefined; // Validation loss at start of this training session
    
    // Checkpoint timing and history tracking
    let lastCheckpointTime = Date.now();
    const CHECKPOINT_INTERVAL_MS = 5000; // 5 seconds
    let trainingHistory = options.trainingHistory || {
      loss: [],
      accuracy: [],
      val_loss: [],
      val_accuracy: []
    };
    let bestCheckpointData = null; // Track best checkpoint for final promotion
    
    if (startEpoch > 0) {
      mlLogger.mlTraining(`📊 Resuming with state: bestAccuracy=${(bestAccuracy * 100).toFixed(1)}%, epochsWithoutImprovement=${epochsWithoutImprovement}`);
    }
    
    // Log data split information
    if (validationData && validationData.length > 0) {
      // Using separate validation data
      mlLogger.mlTraining(`📊 Using separate pre-balanced data:`);
      mlLogger.mlTraining(`   Training samples: ${trainingData.length}`);
      mlLogger.mlTraining(`   Validation samples: ${validationData.length}`);
      mlLogger.mlTraining(`   Total samples: ${trainingData.length + validationData.length}`);
      if (startEpoch > 0) {
        mlLogger.mlTraining(`   Resuming from epoch: ${startEpoch}`);
        mlLogger.mlTraining(`   Will train until epoch: ${targetEpochs} (${options.epochs} additional epochs)`);
      }
    } else {
      // Calculate and log internal training/validation split
      const totalSamples = xs[0].shape[0];
      const validationSplit = options.validationSplit || 0.2;
      const validationSamples = Math.floor(totalSamples * validationSplit);
      const trainingSamples = totalSamples - validationSamples;
      
      mlLogger.mlTraining(`📊 Internal TensorFlow split:`);
      mlLogger.mlTraining(`   Total samples: ${totalSamples}`);
      mlLogger.mlTraining(`   Training samples: ${trainingSamples} (${((1 - validationSplit) * 100).toFixed(0)}%)`);
      mlLogger.mlTraining(`   Validation samples: ${validationSamples} (${(validationSplit * 100).toFixed(0)}%)`);
    }
    if (startEpoch > 0) {
      mlLogger.mlTraining(`   Resuming from epoch: ${startEpoch}`);
    }
    
    // 🔍 Apply class balancing to training portion only (before creating tensors)
    let balancedXs = xs;
    let balancedYs = ys;
    let balancedSampleWeights = sampleWeights;
    
    // Check if we need to balance classes (only when using internal splitting)
    const needsBalancing = classImbalanceRatio > 3 && (!validationData || validationData.length === 0);
    
    
    if (needsBalancing) {
      mlLogger.mlTraining('📊 Applying class balancing to training portion only...');
      
      // We need to split the data first, then balance only the training portion
      // Since TensorFlow will split internally, we need to do the split manually
      const validationSplit = options.validationSplit || 0.2;
      const totalSamples = xs[0].shape[0];
      const trainingSamples = Math.floor(totalSamples * (1 - validationSplit));
      
      // Extract training portion (TensorFlow takes first N samples for training)
      const trainXs = xs.map(x => tf.slice(x, [0, 0], [trainingSamples, -1]));
      const trainYs = tf.slice(ys, [0, 0], [trainingSamples, -1]);
      const trainWeights = sampleWeights.slice(0, trainingSamples);
      
      // Data split completed
      
      // Extract validation portion  
      const valXs = xs.map(x => tf.slice(x, [trainingSamples, 0], [totalSamples - trainingSamples, -1]));
      const valYs = tf.slice(ys, [trainingSamples, 0], [totalSamples - trainingSamples, -1]);
      const valWeights = sampleWeights.slice(trainingSamples);
      
      // Apply oversampling to training data only
      const { balancedTrainXs, balancedTrainYs, balancedTrainWeights } = oversampleTrainingData(
        trainXs, trainYs, trainWeights
      );
      
      // Combine balanced training with original validation
      balancedXs = balancedTrainXs.map((trainX, i) => tf.concat([trainX, valXs[i]], 0));
      balancedYs = tf.concat([balancedTrainYs, valYs], 0);
      balancedSampleWeights = [...balancedTrainWeights, ...valWeights];
      
      // Update validation split ratio for the new balanced dataset
      const newTotalSamples = balancedSampleWeights.length;
      const newValidationSplit = valWeights.length / newTotalSamples;
      options.validationSplit = newValidationSplit;
      
      mlLogger.mlTraining(`📊 Balanced training data: ${trainingSamples} → ${balancedTrainWeights.length} samples`);
      mlLogger.mlTraining(`📊 New train/val split: ${balancedTrainWeights.length}/${valWeights.length} (${(newValidationSplit * 100).toFixed(1)}% validation)`);
      
      // Clean up intermediate tensors
      trainXs.forEach(x => x.dispose());
      trainYs.dispose();
      valXs.forEach(x => x.dispose()); 
      valYs.dispose();
    }
    
    // Prepare weighted labels for training using balanced data
    const weightedLabels = tf.tidy(() => {
      // Convert one-hot labels to weighted format
      return tf.mul(balancedYs, tf.expandDims(tf.tensor1d(balancedSampleWeights), 1));
    });
    
    const batchSize = options.batchSize; // Must be provided, no fallback
    mlLogger.mlTraining(`🎯 Training with batch size: ${batchSize} (using weighted loss${needsBalancing ? ' + balanced data' : ''})`);
    
    // Prepare validation data if provided separately
    let validationTensors = null;
    if (validationData && validationData.length > 0) {
      mlLogger.mlTraining(`📊 Using separate validation data: ${validationData.length} samples`);
      const { xs: valXs, ys: valYs } = prepareData(validationData, modelConfig, vocabulary);
      validationTensors = [valXs, valYs];
      
      // Log validation data diagnostics (same as training)
      const valSampleWeights = validationData.map(item => {
        assert(typeof item.trainingConfidence === 'number', `Invalid trainingConfidence type: ${typeof item.trainingConfidence}`);
        assert(item.trainingConfidence >= 0 && item.trainingConfidence <= 1, `Training confidence out of range: ${item.trainingConfidence}`);
        return item.trainingConfidence;
      });
      const valLabels = validationData.map(item => item.category);
      
      mlLogger.mlDiagnostic(`⚖️ Validation sample weights: min=${Math.min(...valSampleWeights).toFixed(2)}, max=${Math.max(...valSampleWeights).toFixed(2)}, avg=${(valSampleWeights.reduce((a,b) => a+b) / valSampleWeights.length).toFixed(2)}`);
      
      const valCategoryCount = {};
      const valCategoryWeights = {};
      valLabels.forEach((label, i) => {
        valCategoryCount[label] = (valCategoryCount[label] || 0) + 1;
        valCategoryWeights[label] = (valCategoryWeights[label] || 0) + valSampleWeights[i];
      });
      
      mlLogger.mlDiagnostic('🔍 Validation category distribution:', valCategoryCount);
      mlLogger.mlDiagnostic('🔍 Validation category total weights:', Object.fromEntries(
        Object.entries(valCategoryWeights).map(([k,v]) => [k, v.toFixed(2)])
      ));
      mlLogger.mlDiagnostic('🔍 Validation category avg weights:', Object.fromEntries(
        Object.entries(valCategoryWeights).map(([k,v]) => [k, (v / valCategoryCount[k]).toFixed(2)])
      ));
    }
    
    // Log validation approach
    if (validationTensors) {
      mlLogger.mlTraining(`📊 Training with separate validation data (${validationData.length} samples)`);
    } else {
      mlLogger.mlTraining(`📊 Training with internal validation split (${(options.validationSplit * 100).toFixed(0)}%)`);
    }
    
    // 🔍 CRITICAL DEBUG: Verify training pipeline before fit()
    // Training pipeline verification (conditional logging)
    if (mlLogger && mlLogger.isEnabled('verbose')) {
      mlLogger.verbose('\n🚨 TRAINING PIPELINE VERIFICATION:');
      
      // 1. Check input shapes
      mlLogger.verbose('📐 Input Shapes:');
      balancedXs.forEach((x, i) => mlLogger.verbose(`    Input ${i}: ${x.shape}`));
      mlLogger.verbose(`    Labels: ${weightedLabels.shape}`);
      mlLogger.verbose(`    Sample weights length: ${balancedSampleWeights.length}`);
      
      // 2. Verify model can predict (forward pass works)
      mlLogger.verbose('🔮 Forward Pass Test:');
      const testPred = model.predict(balancedXs.map(x => tf.slice(x, [0, 0], [1, -1])));
      const testPredData = await testPred.data();
      mlLogger.verbose(`    Single prediction: [${Array.from(testPredData).map(x => x.toFixed(3)).join(', ')}]`);
      testPred.dispose();
      
      // 3. Check initial loss
      mlLogger.verbose('📊 Initial Loss Check:');
      const predictions = model.predict(balancedXs);
      const initialLoss = weightedLoss(weightedLabels, predictions);
      const initialLossValue = await initialLoss.data();
      mlLogger.verbose(`    Initial weighted loss: ${initialLossValue[0].toFixed(4)}`);
      initialLoss.dispose();
      predictions.dispose();
      
      // 4. Verify gradients exist (basic sanity check)
      mlLogger.verbose('🎯 Gradient Check:');
      const weights = model.getWeights();
      mlLogger.verbose(`    Model has ${weights.length} weight tensors`);
      mlLogger.verbose(`    Sample weight shapes: [${weights.slice(0, 3).map(w => w.shape.join('x')).join(', ')}...]`);
      
      // 5. Sample feature-label pairs
      mlLogger.verbose('🔗 Feature-Label Alignment Check:');
      for (let i = 0; i < Math.min(3, balancedXs[0].shape[0]); i++) {
        const labelData = await tf.slice(weightedLabels, [i, 0], [1, -1]).data();
        const trueClass = labelData.findIndex(x => x > 0);
        mlLogger.verbose(`    Sample ${i}: True class = ${trueClass}, Weight = ${balancedSampleWeights[i].toFixed(2)}`);
      }
      mlLogger.verbose('🚨 END PIPELINE VERIFICATION\n');
    }

    // For incremental training: evaluate the existing model's validation loss as baseline
    // Note: incremental training can start from epoch 0 if the model exists but has no history
    if (options.incremental) {
      try {
        mlLogger.mlTraining('📊 Evaluating existing model on validation data for baseline...');
        
        let baselineValLoss;
        let baselineValAccuracy;
        if (validationTensors && validationTensors.length >= 2) {
          // Use separate validation data
          const [valXs, valYs] = validationTensors;
          const evalResult = model.evaluate(valXs, valYs, { batchSize: options.batchSize });
          
          if (Array.isArray(evalResult)) {
            const lossData = await evalResult[0].data();
            const accuracyData = await evalResult[1].data();
            baselineValLoss = lossData[0];
            baselineValAccuracy = accuracyData[0];
            evalResult.forEach(t => t.dispose());
          } else {
            const lossData = await evalResult.data();
            baselineValLoss = lossData[0];
            baselineValAccuracy = 0; // No accuracy metric available
            evalResult.dispose();
          }
        } else {
          // Use validation split from training data
          const valSplit = options.validationSplit || 0.2;
          const totalSamples = balancedXs[0].shape[0];
          const valStart = Math.floor(totalSamples * (1 - valSplit));
          
          const valXs = balancedXs.map(x => tf.slice(x, [valStart, 0], [totalSamples - valStart, -1]));
          const valYs = tf.slice(balancedYs, [valStart, 0], [totalSamples - valStart, -1]);
          
          const evalResult = model.evaluate(valXs, valYs, { batchSize: options.batchSize });
          
          if (Array.isArray(evalResult)) {
            const lossData = await evalResult[0].data();
            const accuracyData = await evalResult[1].data();
            baselineValLoss = lossData[0];
            baselineValAccuracy = accuracyData[0];
            evalResult.forEach(t => t.dispose());
          } else {
            const lossData = await evalResult.data();
            baselineValLoss = lossData[0];
            baselineValAccuracy = 0; // No accuracy metric available
            evalResult.dispose();
          }
          
          // Clean up temporary slices
          valXs.forEach(x => x.dispose());
          valYs.dispose();
        }
        
        sessionStartValLoss = baselineValLoss;
        mlLogger.mlTraining(`✅ Baseline validation loss (before training): ${sessionStartValLoss.toFixed(4)}, val_accuracy: ${(baselineValAccuracy * 100).toFixed(1)}%`);
        mlLogger.mlTraining(`   Model must achieve val_loss < ${sessionStartValLoss.toFixed(4)} to be promoted`);
        
      } catch (error) {
        mlLogger.mlTraining(`⚠️ Failed to evaluate baseline validation loss: ${error.message}`);
        // Continue without baseline - will use first epoch as fallback
      }
    }
    
    // Prepare fit options with all settings
    const fitOptions = {
      epochs: earlyStoppingConfig.maxEpochs,
      initialEpoch: startEpoch,  // CRITICAL: This tells TensorFlow.js to continue from this epoch
      batchSize: batchSize,
      shuffle: true, // Safe since we feed training and validation data separately
      // Use either separate validation data or internal split
      ...(validationTensors ? {
        validationData: validationTensors
      } : {
        validationSplit: options.validationSplit
      }),
      callbacks: {
        onEpochEnd: async (epoch, logs) => {
          // Check if training was cancelled
          if (currentJob && currentJob.cancelled) {
            mlLogger.mlTraining(`Training cancelled at epoch ${epoch + 1}`);
            // Use the same method as early stopping
            model.stopTraining = true;
            // Don't send CANCELLED message here - already sent in handleCancel
            return; // Exit early from callback
          }
          
          // When using initialEpoch, TensorFlow's epoch parameter represents absolute epoch numbers
          // For incremental training: epoch = 74 means we just completed epoch 74
          // For fresh training: epoch = 0 means we just completed epoch 1
          actualEpochs = startEpoch > 0 ? epoch : epoch + 1;
          
          // Log epoch progress for incremental training clarity
          if (startEpoch > 0 && epoch === 0) {
            mlLogger.mlTraining(`📊 Continuing incremental training from epoch ${actualEpochs}/${earlyStoppingConfig.maxEpochs}`);
          }
          
          // Use explicit validation instead of || fallbacks to avoid masking valid 0 values
          const valAccuracy = (typeof logs.val_weightedAccuracy === 'number') ? logs.val_weightedAccuracy :
                              (typeof logs.val_acc === 'number') ? logs.val_acc : undefined;
          const trainAccuracy = (typeof logs.weightedAccuracy === 'number') ? logs.weightedAccuracy :
                                (typeof logs.acc === 'number') ? logs.acc : undefined;
          const trainLoss = (typeof logs.loss === 'number') ? logs.loss : 0;
          const valLoss = (typeof logs.val_loss === 'number') ? logs.val_loss : trainLoss;
          
          // Log epoch results (add this regular epoch logging)
          if (valAccuracy !== undefined) {
            mlLogger.mlTraining(`Epoch ${actualEpochs}, val_loss: ${valLoss.toFixed(4)}, val_accuracy: ${(valAccuracy * 100).toFixed(1)}%`);
          } else {
            mlLogger.mlTraining(`Epoch ${actualEpochs}, val_loss: ${valLoss.toFixed(4)}`);
          }
          
          // 🔍 TensorFlow.js Bug Workaround: fit() reports inflated training loss (6.57x)
          // Use manual evaluation for accurate training loss reporting
          // Progress tracking without logging
          
          // Get corrected training loss via manual evaluation (TensorFlow.js bug workaround)
          let correctedTrainLoss = trainLoss;
          let correctedTrainAcc = trainAccuracy;
          
          try {
            const trainEval = model.evaluate(balancedXs, weightedLabels, { batchSize: options.batchSize });
            if (Array.isArray(trainEval)) {
              const manualLoss = await trainEval[0].data();
              const manualAcc = await trainEval[1].data();
              correctedTrainLoss = manualLoss[0];
              correctedTrainAcc = manualAcc[0];
              trainEval.forEach(t => t.dispose());
            }
          } catch (e) {
            mlLogger.mlDiagnostic(`  Manual eval failed: ${e.message}`);
          }
          
          // Progress tracking without detailed logging
          
          // Use validation loss for early stopping (more sensitive than accuracy)
          // Track both best loss and accuracy for comprehensive monitoring
          if (valLoss !== undefined && valAccuracy !== undefined) {
            let improved = false;
            
            // Check if validation loss improved (primary metric)
            if (bestValLoss === undefined || valLoss < bestValLoss - earlyStoppingConfig.minDelta) {
              bestValLoss = valLoss;
              improved = true;
              // Best validation loss updated
            }
            
            // Also track best accuracy for reporting
            if (valAccuracy > bestAccuracy + earlyStoppingConfig.minDelta) {
              bestAccuracy = valAccuracy;
              // Best validation accuracy updated
            }
            
            // Reset patience if either metric improved
            if (improved) {
              epochsWithoutImprovement = 0;
            } else {
              epochsWithoutImprovement++;
            }
            
            // Only trigger early stopping after minEpochs
            if (actualEpochs >= earlyStoppingConfig.minEpochs) {
              // Log when getting close to early stopping
              if (epochsWithoutImprovement >= earlyStoppingConfig.patience - 2) {
                mlLogger.mlTraining(`No improvement for ${epochsWithoutImprovement} epochs (best loss: ${bestValLoss?.toFixed(4) || 'N/A'}, best acc: ${(bestAccuracy * 100).toFixed(1)}%, patience: ${earlyStoppingConfig.patience})`);
              }
              
              if (epochsWithoutImprovement >= earlyStoppingConfig.patience) {
                mlLogger.mlTraining(`Early stopping triggered after ${actualEpochs} epochs`);
                // Set stop training flag
                model.stopTraining = true;
              }
            }
          }
          
          // Send progress (removed verbose logging)
          self.postMessage({
            type: 'PROGRESS',
            jobId,
            data: {
              epoch: actualEpochs,
              totalEpochs: earlyStoppingConfig.maxEpochs,
              loss: correctedTrainLoss, // Use corrected loss instead of inflated fit() loss
              trainAccuracy: correctedTrainAcc, // Add training accuracy
              accuracy: valAccuracy,
              valLoss: valLoss,
              valAccuracy: valAccuracy,
              progress: actualEpochs / earlyStoppingConfig.maxEpochs,
              bestAccuracy: bestAccuracy,
              epochsWithoutImprovement: epochsWithoutImprovement,
              earlyStoppingTriggered: model.stopTraining === true
            }
          });
          
          // Update training history
          trainingHistory.loss.push(correctedTrainLoss);
          trainingHistory.accuracy.push(correctedTrainAcc);
          trainingHistory.val_loss.push(valLoss);
          trainingHistory.val_accuracy.push(valAccuracy);
          
          // Save checkpoint based on timer and best model tracking
          const currentTime = Date.now();
          const timeSinceLastCheckpoint = currentTime - lastCheckpointTime;
          const shouldSaveCheckpoint = timeSinceLastCheckpoint >= CHECKPOINT_INTERVAL_MS;
          
          // For incremental training: only save best checkpoint if better than session start
          // For fresh training: save best checkpoint if better than any previous epoch
          let shouldSaveBestCheckpoint = false;
          
          if (options.incremental && sessionStartValLoss !== undefined) {
            // Incremental training: must be better than session start AND better than any previous epoch
            const betterThanBaseline = valLoss < sessionStartValLoss;
            const betterThanPreviousBest = !bestCheckpointData || valLoss < bestCheckpointData.valLoss;
            shouldSaveBestCheckpoint = betterThanBaseline && betterThanPreviousBest;
            
            if (betterThanBaseline && bestCheckpointData === null) {
              mlLogger.mlTraining(`✅ Model improved from session start (${sessionStartValLoss.toFixed(4)} → ${valLoss.toFixed(4)}, val_accuracy: ${(valAccuracy * 100).toFixed(1)}%)`);
            } else if (shouldSaveBestCheckpoint && bestCheckpointData !== null) {
              mlLogger.mlTraining(`✅ New best model in session (${bestCheckpointData.valLoss.toFixed(4)} → ${valLoss.toFixed(4)}, val_accuracy: ${(valAccuracy * 100).toFixed(1)}%)`);
            } else if (betterThanBaseline && !betterThanPreviousBest) {
              mlLogger.mlTraining(`📊 Model better than baseline but not the best (baseline: ${sessionStartValLoss.toFixed(4)}, current: ${valLoss.toFixed(4)}, val_accuracy: ${(valAccuracy * 100).toFixed(1)}%, best: ${bestCheckpointData.valLoss.toFixed(4)})`);
            }
          } else {
            // Fresh training: only save if this is actually the best we've seen
            // Check against the best checkpoint we've saved, not the bestValLoss variable
            shouldSaveBestCheckpoint = !bestCheckpointData || valLoss < bestCheckpointData.valLoss;
          }
          
          if (shouldSaveBestCheckpoint) {
            try {
              const modelWeights = model.getWeights();
              const weightsData = await Promise.all(
                modelWeights.map(async (w) => ({
                  shape: w.shape,
                  data: await w.data()
                }))
              );
              
              bestCheckpointData = {
                epoch: trainingHistory.loss.length, // Use history length to ensure consistency
                accuracy: valAccuracy,
                valLoss: valLoss,
                bestAccuracy: bestAccuracy,
                weights: weightsData,
                epochsWithoutImprovement: epochsWithoutImprovement,
                // Deep copy training history at this epoch - this ensures that if we promote
                // this checkpoint, the history is correctly truncated to this epoch, allowing
                // incremental training to resume from the right point
                trainingHistory: JSON.parse(JSON.stringify(trainingHistory))
              };
              
              mlLogger.mlTraining(`📈 New best model found at epoch ${actualEpochs} (val_loss: ${valLoss.toFixed(4)}, val_accuracy: ${(valAccuracy * 100).toFixed(1)}%)`);
            } catch (error) {
              console.error('Failed to capture best model weights:', error);
            }
          }
          
          // Save checkpoints based on timer
          if (shouldSaveCheckpoint) {
            try {
              // Get current weights for "last" checkpoint
              const modelWeights = model.getWeights();
              const weightsData = await Promise.all(
                modelWeights.map(async (w) => ({
                  shape: w.shape,
                  data: await w.data()
                }))
              );
              
              // Save "last" checkpoint (for resuming interruptions)
              // CRITICAL: Ensure epoch count matches training history length
              // The training history is the source of truth for epoch count
              const historyLength = trainingHistory.loss.length;
              if (historyLength !== actualEpochs) {
                mlLogger.mlTraining(`⚠️ Epoch mismatch detected: actualEpochs=${actualEpochs}, historyLength=${historyLength}`);
                mlLogger.mlTraining(`   Using history length as source of truth`);
              }
              
              self.postMessage({
                type: 'CHECKPOINT',
                jobId,
                checkpointType: 'last',
                data: {
                  epoch: historyLength, // Use history length as epoch count to ensure consistency
                  accuracy: valAccuracy,
                  valLoss: valLoss,
                  bestAccuracy: bestAccuracy,
                  weights: weightsData,
                  epochsWithoutImprovement: epochsWithoutImprovement,
                  trainingHistory: trainingHistory // Include synchronized history
                }
              });
              
              // Also save best checkpoint if we have one
              if (bestCheckpointData) {
                self.postMessage({
                  type: 'CHECKPOINT',
                  jobId,
                  checkpointType: 'best',
                  data: bestCheckpointData
                });
              }
              
              lastCheckpointTime = currentTime;
              mlLogger.mlTraining(`💾 Checkpoints saved at epoch ${historyLength} (${(timeSinceLastCheckpoint/1000).toFixed(1)}s since last save)`);
              
              // DO NOT dispose modelWeights - they are references to the model's internal weights!
            } catch (error) {
              console.error('Failed to save checkpoint:', error);
            }
          }
        }
      }
    };
    
    // Execute the training with weighted labels for custom loss function
    const history = await model.fit(balancedXs, weightedLabels, fitOptions);
    
    // Check if training was cancelled
    if (currentJob && currentJob.cancelled) {
      mlLogger.mlTraining('Training was cancelled, not sending complete message');
      // Clean up tensors
      balancedXs.forEach(x => x.dispose());
      balancedYs.dispose();
      weightedLabels.dispose();
      if (validationTensors) {
        validationTensors.forEach(t => t.dispose());
      }
      model.dispose();
      return; // Exit early without sending TRAINING_COMPLETE
    }
    
    mlLogger.info(`Weighted training completed successfully after ${actualEpochs} epochs`);
    
    // 🔍 FINAL: Confusion matrices for training vs validation
    try {
      // Final confusion matrices (conditional logging)
      if (mlLogger && mlLogger.isEnabled('confusion')) {
        mlLogger.confusion(`\n🔍 Final Confusion Matrices After Training:`);
        
        // Calculate confusion matrix for training data (using original unpadded training data)
        mlLogger.confusion(`🔍 Using original training data for confusion matrix (${trainingData.length} samples)`);
        const { xs: origTrainXs, ys: origTrainYs } = prepareData(trainingData, modelConfig, vocabulary);
      const trainPreds = model.predict(origTrainXs);
      const trainPredClasses = tf.argMax(trainPreds, 1);
      const trainTrueClasses = tf.argMax(origTrainYs, 1);
      
      const trainPredArray = await trainPredClasses.data();
      const trainTrueArray = await trainTrueClasses.data();
      
      // Calculate confusion matrix for validation data (use separate validation data if available)
      let valPreds, valPredClasses, valTrueClasses;
      
      if (validationTensors && validationTensors.length >= 2) {
        // Use the separate validation data that was provided
        mlLogger.mlConfusion(`🔍 Using separate validation data for confusion matrix (${validationData.length} samples)`);
        const [valXs, valYs] = validationTensors;
        valPreds = model.predict(valXs);
        valPredClasses = tf.argMax(valPreds, 1);
        valTrueClasses = tf.argMax(valYs, 1);
      } else {
        // Fall back to internal split from training data
        mlLogger.mlConfusion(`🔍 Using internal validation split for confusion matrix`);
        const valSplit = options.validationSplit || 0.2;
        const totalSamples = balancedXs[0].shape[0];
        const valStart = Math.floor(totalSamples * (1 - valSplit));
        
        const valXs = balancedXs.map(x => tf.slice(x, [valStart, 0], [totalSamples - valStart, -1]));
        const valYs = tf.slice(balancedYs, [valStart, 0], [totalSamples - valStart, -1]);
        
        valPreds = model.predict(valXs);
        valPredClasses = tf.argMax(valPreds, 1);
        valTrueClasses = tf.argMax(valYs, 1);
      }
      
      const valPredArray = await valPredClasses.data();
      const valTrueArray = await valTrueClasses.data();
      
      // Store the original probabilities for comparison
      const originalValProbs = await valPreds.data();
      
      // Build confusion matrices
      const trainConfMatrix = buildConfusionMatrix(trainTrueArray, trainPredArray);
      const valConfMatrix = buildConfusionMatrix(valTrueArray, valPredArray);
      
      mlLogger.mlConfusion('TRAINING:');
      logConfusionMatrix(trainConfMatrix, 'train');
      mlLogger.mlConfusion('VALIDATION:');
      logConfusionMatrix(valConfMatrix, 'val');
      
      // Check model output probabilities distribution
      mlLogger.mlDiagnostic('\n🔍 Model Output Analysis:');
      const sampleXs = xs.map(x => tf.slice(x, [0, 0], [Math.min(10, x.shape[0]), -1])); // First 10 training samples
      const samplePreds = model.predict(sampleXs);
      const sampleProbs = await samplePreds.data();
      const numSamples = Math.min(10, sampleXs[0].shape[0]);
      mlLogger.mlDiagnostic(`Sample predictions (first ${numSamples}, 4 classes each):`);
      for (let i = 0; i < numSamples; i++) {
        const probs = [
          sampleProbs[i*4].toFixed(3),
          sampleProbs[i*4+1].toFixed(3), 
          sampleProbs[i*4+2].toFixed(3),
          sampleProbs[i*4+3].toFixed(3)
        ];
        mlLogger.mlDiagnostic(`  Sample ${i}: [${probs.join(', ')}]`);
      }
      samplePreds.dispose();
      sampleXs.forEach(x => x.dispose());
      
      // 🔍 DETAILED EVALUATION: Show URLs/titles by prediction vs actual  
      mlLogger.mlDiagnostic('\n🔍 Detailed Evaluation Results:');
      // Create predictions for actual validation data used in confusion matrix
      await logDetailedEvaluationSimple(
        data.trainingData, 
        model, 
        valPredArray, 
        valTrueArray,
        validationData,
        options,
        originalValProbs
      );
      
      // Clean up tensors
      trainPreds.dispose();
      trainPredClasses.dispose();
      trainTrueClasses.dispose();
      valXs.forEach(x => x.dispose());
        valYs.dispose();
        valPreds.dispose();
        valPredClasses.dispose();
        valTrueClasses.dispose();
      }
      
    } catch (e) {
      mlLogger.mlDiagnostic(`Final confusion matrix calculation failed: ${e.message}`);
    }
    
    // Clean up weighted labels tensor
    weightedLabels.dispose();
    
    // Get final model weights
    const modelWeights = await model.getWeights();
    const weightsData = await Promise.all(
      modelWeights.map(async (w) => ({
        shape: w.shape,
        data: await w.data()
      }))
    );
    
    // Clean up tensors
    xs.forEach(x => x.dispose()); // Original xs tensors
    ys.dispose(); // Original ys tensor
    if (needsBalancing) {
      balancedXs.forEach(x => x.dispose()); // Balanced xs tensors (if different from original)
      balancedYs.dispose(); // Balanced ys tensor (if different from original)
    }
    // sampleWeights is an array, not a tensor
    // weightedLabels already disposed above
    // Don't dispose modelWeights - they're still owned by the model
    // DON'T dispose model here - we need it for final evaluation!
    
    mlLogger.info('✅ Training completed successfully');
    mlLogger.info('Training history:', history.history);
    mlLogger.info('weightedAccuracy:', history.history.weightedAccuracy);
    mlLogger.info('acc:', history.history.acc);

    // Get the final accuracy from the best epoch or last epoch
    const hasWeightedAccuracy = history.history.weightedAccuracy && history.history.weightedAccuracy.length > 0;
    const hasStandardAccuracy = history.history.acc && history.history.acc.length > 0;
    
    if (hasWeightedAccuracy) {
      mlLogger.mlDiagnostic('Weighted accuracy:', history.history.weightedAccuracy[history.history.weightedAccuracy.length - 1]);
    }
    if (hasStandardAccuracy) {
      mlLogger.mlDiagnostic('Standard accuracy:', history.history.acc[history.history.acc.length - 1]);
    }
    
    const finalAccuracy = bestAccuracy || 
                         (hasWeightedAccuracy ? history.history.weightedAccuracy[history.history.weightedAccuracy.length - 1] : 0) ||
                         (hasStandardAccuracy ? history.history.acc[history.history.acc.length - 1] : 0) || 0;
    
    mlLogger.info(`Final accuracy: ${(finalAccuracy * 100).toFixed(1)}%`);

    // Get corrected final loss - MUST use validation data for incremental training decisions
    // Since TensorFlow.js fit() reports inflated loss, use manual evaluation for final result
    let finalCorrectedLoss = (history.history.loss && history.history.loss.length > 0) ? 
                            history.history.loss[history.history.loss.length - 1] : 0;
    mlLogger.mlDiagnostic(`Final training loss (from fit): ${finalCorrectedLoss.toFixed(4)}`);
    
    // CRITICAL: For incremental training, we MUST evaluate on validation data
    // Otherwise we're comparing training loss to validation baseline!
    if (options.incremental && validationData && validationData.length > 0) {
      try {
        // Ensure TensorFlow is available
        if (!tf || !tf.tensor2d) {
          throw new Error('TensorFlow.js is not available for final evaluation');
        }
        
        mlLogger.mlTraining('📊 Evaluating final model on validation data...');
        
        // Prepare validation data tensors using the same logic as training
        const valFeatures = validationData.map(item => item.features);
        const valLabels = validationData.map(item => item.category);
        
        // Create input tensors (same as prepareData function)
        const valUrlTokens = tf.tensor2d(valFeatures.map(f => f.urlTokens), 
          [valFeatures.length, modelConfig.maxUrlLength]);
        const valTitleTokens = tf.tensor2d(valFeatures.map(f => f.titleTokens), 
          [valFeatures.length, modelConfig.maxTitleLength]);
        const valEngineeredFeatures = tf.tensor2d(valFeatures.map(f => f.engineeredFeatures));
        const valXs = [valUrlTokens, valTitleTokens, valEngineeredFeatures];
        
        // Create one-hot encoded labels
        const valYs = tf.oneHot(tf.tensor1d(valLabels, 'int32'), modelConfig.numClasses);
        
        // Evaluate on validation data
        const finalEval = model.evaluate(valXs, valYs, { batchSize: options.batchSize });
        if (Array.isArray(finalEval)) {
          const finalLoss = await finalEval[0].data();
          finalCorrectedLoss = finalLoss[0];
          mlLogger.mlTraining(`✅ Final validation loss: ${finalCorrectedLoss.toFixed(4)}`);
          finalEval.forEach(t => t.dispose());
        } else {
          const finalLoss = await finalEval.data();
          finalCorrectedLoss = finalLoss[0];
          mlLogger.mlTraining(`✅ Final validation loss: ${finalCorrectedLoss.toFixed(4)}`);
          finalEval.dispose();
        }
        
        // Clean up
        valXs.forEach(x => x.dispose());
        valYs.dispose();
        
      } catch (e) {
        // This is CRITICAL - if we can't evaluate on validation data, we can't make promotion decisions
        mlLogger.error('❌ CRITICAL: Final validation evaluation failed:', e.message);
        mlLogger.error('   Stack:', e.stack);
        // Don't fall back to training loss - this would be comparing apples to oranges
        throw new Error(`Cannot evaluate on validation data for incremental training: ${e.message}`);
      }
    } else {
      // For fresh training, try to get corrected training loss
      try {
        if (tf && tf.getBackend) {
          const finalEval = model.evaluate(balancedXs, weightedLabels, { batchSize: options.batchSize });
          if (Array.isArray(finalEval)) {
            const finalLoss = await finalEval[0].data();
            finalCorrectedLoss = finalLoss[0];
            finalEval.forEach(t => t.dispose());
          }
        }
      } catch (e) {
        mlLogger.mlDiagnostic('Final training evaluation failed, using fit() loss:', e.message);
      }
    }
    
    // Save final checkpoint if enough time has passed
    const finalTime = Date.now();
    const timeSinceLastCheckpoint = finalTime - lastCheckpointTime;
    if (timeSinceLastCheckpoint >= CHECKPOINT_INTERVAL_MS || !bestCheckpointData) {
      // Save final "last" checkpoint
      self.postMessage({
        type: 'CHECKPOINT',
        jobId,
        checkpointType: 'last',
        data: {
          epoch: actualEpochs,
          accuracy: finalAccuracy,
          valLoss: finalCorrectedLoss,
          bestAccuracy: bestAccuracy,
          weights: weightsData,
          epochsWithoutImprovement: epochsWithoutImprovement,
          trainingHistory: trainingHistory
        }
      });
      
      // For incremental training: only update best if better than session start
      // For fresh training: update best if better than any previous
      let shouldUpdateFinalBest = false;
      
      if (options.incremental && sessionStartValLoss !== undefined) {
        // Incremental: must be better than session start
        shouldUpdateFinalBest = finalCorrectedLoss < sessionStartValLoss;
      } else {
        // Fresh training: update if better than current best
        shouldUpdateFinalBest = !bestCheckpointData || finalCorrectedLoss < bestCheckpointData.valLoss;
      }
      
      if (shouldUpdateFinalBest) {
        bestCheckpointData = {
          epoch: trainingHistory.loss.length, // Use history length for consistency
          accuracy: finalAccuracy,
          valLoss: finalCorrectedLoss,
          bestAccuracy: bestAccuracy,
          weights: weightsData,
          epochsWithoutImprovement: epochsWithoutImprovement,
          trainingHistory: trainingHistory
        };
      }
      
      // Save best checkpoint
      if (bestCheckpointData) {
        self.postMessage({
          type: 'CHECKPOINT',
          jobId,
          checkpointType: 'best',
          data: bestCheckpointData
        });
      }
      
      mlLogger.mlTraining(`💾 Final checkpoints saved at completion`);
    }
    
    // Send results - use best checkpoint data for promotion
    // For incremental training: only promote if we have a best checkpoint that beat the baseline
    let promotionData;
    if (options.incremental && sessionStartValLoss !== undefined && !bestCheckpointData) {
      // No improvement from baseline - don't create promotion data
      promotionData = null;
    } else {
      promotionData = bestCheckpointData || {
        weights: weightsData,
        accuracy: finalAccuracy,
        valLoss: finalCorrectedLoss,
        bestAccuracy: bestAccuracy,
        epoch: actualEpochs,
        epochsWithoutImprovement: epochsWithoutImprovement,
        trainingHistory: trainingHistory
      };
    }
    
    // Log if we're using an earlier checkpoint
    if (bestCheckpointData && bestCheckpointData.epoch < actualEpochs) {
      mlLogger.mlTraining(`📊 Using best checkpoint from epoch ${bestCheckpointData.epoch} (trained to ${actualEpochs})`);
    }
    
    // Check if model improved for incremental training
    // For incremental training: model improved only if we found a checkpoint better than baseline
    const modelImproved = options.incremental && sessionStartValLoss !== undefined ? 
                         (bestCheckpointData !== null) : 
                         true; // Fresh training always "improves" since there's no baseline
    

    self.postMessage({
      type: 'TRAINING_COMPLETE',
      jobId,
      data: {
        history: history.history,
        weights: promotionData ? promotionData.weights : weightsData, // Fallback to final weights if no promotion
        modelConfig: modelConfig,
        vocabulary: vocabulary,
        duration: Date.now() - currentJob.startTime,
        finalLoss: promotionData ? promotionData.valLoss : finalCorrectedLoss,
        finalAccuracy: promotionData ? promotionData.accuracy : finalAccuracy,
        actualEpochs: actualEpochs,
        earlyStoppingTriggered: epochsWithoutImprovement >= earlyStoppingConfig.patience,
        bestAccuracy: bestAccuracy,
        bestEpoch: promotionData ? promotionData.epoch : actualEpochs,
        trainingHistory: promotionData ? promotionData.trainingHistory : trainingHistory,
        // Flag to indicate if we're using an earlier checkpoint
        usedEarlierCheckpoint: bestCheckpointData && bestCheckpointData.epoch < actualEpochs,
        // For incremental training: did model improve from session start?
        modelImproved: modelImproved,
        sessionStartValLoss: sessionStartValLoss // Include for logging purposes
      }
    });
    
    // Now we can safely dispose the model after all evaluations are complete
    model.dispose();
    
  } catch (error) {
    throw error;
  } finally {
    isTraining = false;
    currentJob = null;
  }
}

/**
 * Build model from configuration - must match tab-classifier.js exactly
 */
function buildModel(config) {
  // Calculate number of engineered features (must match tab-classifier.js)
  // This is hardcoded to 35 based on:
  // - 7 URL pattern features (from ML_CONFIG.features.urlPatterns)
  // - 18 important token features (from ML_CONFIG.features.importantTokens)
  // - 10 numerical features
  const numFeatures = 35;
  
  // Create inputs - must match tab-classifier.js names exactly
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
    shape: [numFeatures],
    name: 'engineered_features'
  });
  
  // Shared embedding layer
  const embeddingLayer = tf.layers.embedding({
    inputDim: config.vocabSize,
    outputDim: config.embeddingDim, // Must be provided from config
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
    units: config.featureTransformUnits || 64,
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
  
  // Hidden layers - must match ML_CONFIG
  const hiddenUnits = config.hiddenUnits; // Must be provided from config
  hiddenUnits.forEach((units, index) => {
    const denseLayer = tf.layers.dense({
      units,
      activation: 'relu',
      kernelRegularizer: tf.regularizers.l2({ l2: 0.01 }),
      name: `hidden_${index + 1}`
    });
    x = denseLayer.apply(x);
    
    // Add batch normalization
    const batchNormLayer = tf.layers.batchNormalization({
      name: `batch_norm_${index + 1}`
    });
    x = batchNormLayer.apply(x);
    
    // Add dropout
    const dropoutLayer = tf.layers.dropout({
      rate: config.dropout || 0.3,
      name: `dropout_${index + 1}`
    });
    x = dropoutLayer.apply(x);
  });
  
  // Output layer
  const output = tf.layers.dense({
    units: config.numClasses || 4,
    activation: 'softmax',
    name: 'category_output'
  }).apply(x);
  
  // Create unified model with exact same name as tab-classifier.js
  const model = tf.model({
    inputs: [urlInput, titleInput, featuresInput],
    outputs: output,
    name: 'unified_tab_classifier'
  });
  
  model.compile({
    optimizer: tf.train.adam(config.learningRate),
    loss: 'categoricalCrossentropy',
    metrics: ['accuracy', 'categoricalCrossentropy']
  });
  
  return model;
}

/**
 * Prepare training data - exact copy from tab-classifier.js prepareTrainingData
 */
function prepareData(trainingData, config, vocabulary) {
  // Sort training data deterministically for reproducible results
  // Multi-level sorting to handle batch categorization where many tabs have same timestamp
  const sortedTrainingData = [...trainingData].sort((a, b) => {
    // Helper function to get all available timestamps as array
    const getAllTimestamps = (item) => [
      item.categorizedAt || 0,   // When categorized (batch operations have same time)
      item.savedAt || 0,         // When saved to database
      item.lastUpdated || 0,     // When record was last modified
      item.lastAccessed || 0,    // When tab was last accessed/focused
      item.timestamp || 0,       // Generic timestamp
      item.createdAt || 0        // When record was created
    ];
    
    const timestampsA = getAllTimestamps(a);
    const timestampsB = getAllTimestamps(b);
    
    // Compare timestamps in priority order
    for (let i = 0; i < timestampsA.length; i++) {
      const timeA = timestampsA[i];
      const timeB = timestampsB[i];
      
      // Skip if both are 0 (no timestamp)
      if (timeA === 0 && timeB === 0) continue;
      
      // If only one has timestamp, prioritize it
      if (timeA > 0 && timeB === 0) return -1;
      if (timeA === 0 && timeB > 0) return 1;
      
      // If both have timestamps and they're different, sort by time
      if (timeA !== timeB) {
        return timeA - timeB;
      }
      
      // If timestamps are identical, continue to next timestamp level
    }
    
    // Final fallback: sort by URL for deterministic ordering
    return a.url.localeCompare(b.url);
  });
  
  // Training data sorted temporally
  
  const urlTokens = [];
  const titleTokens = [];
  const features = [];
  const labels = [];
  const sampleWeights = [];

  sortedTrainingData.forEach(example => {
    // Use pre-tokenized features from WorkerManager
    if (example.features && example.features.urlTokens && example.features.titleTokens) {
      urlTokens.push(example.features.urlTokens);
      titleTokens.push(example.features.titleTokens);
      
      // Use engineered features from WorkerManager
      if (example.features.engineeredFeatures) {
        features.push(example.features.engineeredFeatures);
      } else {
        // Fallback to dummy features if not provided
        mlLogger.warn('Missing engineered features for example');
        features.push(new Array(35).fill(0));
      }
      
      // Validate category
      const category = example.category;
      if (typeof category !== 'number' || category < 0 || category > 3 || !Number.isInteger(category)) {
        mlLogger.error(`Invalid category: ${category}`, example);
        throw new Error(`Invalid category value: ${category}. Must be integer in range [0, 3]`);
      }
      
      labels.push(category);
      sampleWeights.push(example.trainingConfidence);
    }
  });
  
  if (urlTokens.length === 0) {
    throw new Error('No valid training data found');
  }
  
  if (mlLogger.isEnabled('ml.diagnostics')) {
    mlLogger.mlDiagnostic(`⚖️ Sample weights: min=${Math.min(...sampleWeights).toFixed(2)}, max=${Math.max(...sampleWeights).toFixed(2)}, avg=${(sampleWeights.reduce((a,b) => a+b) / sampleWeights.length).toFixed(2)}`);
  }
  
  // Log category distribution with weights
  const categoryCount = {};
  const categoryWeights = {};
  labels.forEach((label, i) => {
    categoryCount[label] = (categoryCount[label] || 0) + 1;
    categoryWeights[label] = (categoryWeights[label] || 0) + sampleWeights[i];
  });
  
  if (mlLogger.isEnabled('ml.diagnostics')) {
    mlLogger.mlDiagnostic('🔍 Category distribution:', categoryCount);
    mlLogger.mlDiagnostic('🔍 Category total weights:', Object.fromEntries(
      Object.entries(categoryWeights).map(([k,v]) => [k, v.toFixed(2)])
    ));
    mlLogger.mlDiagnostic('🔍 Category avg weights:', Object.fromEntries(
      Object.entries(categoryWeights).map(([k,v]) => [k, (v / categoryCount[k]).toFixed(2)])
    ));
  }
  
  // 🔍 Class imbalance analysis
  const maxCount = Math.max(...Object.values(categoryCount));
  const minCount = Math.min(...Object.values(categoryCount));
  const classImbalanceRatio = maxCount / minCount;
  
  if (mlLogger.isEnabled('ml.diagnostics')) {
    mlLogger.mlDiagnostic(`🔍 Class imbalance ratio: ${classImbalanceRatio.toFixed(1)}:1 (max class has ${classImbalanceRatio.toFixed(1)}x more samples than min class)`);
    
    if (classImbalanceRatio > 3) {
      mlLogger.mlDiagnostic('⚠️ WARNING: Severe class imbalance detected! This will cause model collapse.');
      mlLogger.mlDiagnostic('💡 SOLUTION: Will apply class balancing AFTER train/validation split to prevent data leakage.');
      mlLogger.mlDiagnostic(`💡 CURRENT: Learning rate = ${config.learningRate}`);
      mlLogger.mlDiagnostic('📊 Note: Balancing will be applied only to training set, not validation set.');
    }
  }
  
  // Check available timestamps in training data  
  if (mlLogger.isEnabled('ml.diagnostics')) {
    const timestampSample = sortedTrainingData.slice(0, 3).map(item => {
      const allFields = Object.keys(item);
      const timeFields = allFields.filter(key => 
        key.toLowerCase().includes('time') || 
        key.toLowerCase().includes('date') || 
        key.toLowerCase().includes('at') ||
        key.toLowerCase().includes('created') ||
        key.toLowerCase().includes('updated') ||
        key.toLowerCase().includes('saved')
      );
      
      return {
        url: item.url.substring(0, 50) + '...',
        allFields: allFields.length,
        timeFields: timeFields,
        timestamps: {
          timestamp: typeof item.timestamp + ' = ' + item.timestamp,
          createdAt: typeof item.createdAt + ' = ' + item.createdAt,
          lastAccessed: typeof item.lastAccessed + ' = ' + item.lastAccessed,
          savedAt: typeof item.savedAt + ' = ' + item.savedAt,
          categorizedAt: typeof item.categorizedAt + ' = ' + item.categorizedAt,
          lastUpdated: typeof item.lastUpdated + ' = ' + item.lastUpdated
        }
      };
    });
    mlLogger.mlDiagnostic('🔍 Available timestamps sample:', timestampSample);
  }
  
  // Convert to tensors - multi-input format
  const xs = [
    tf.tensor2d(urlTokens, null, 'int32'),
    tf.tensor2d(titleTokens, null, 'int32'),
    tf.tensor2d(features)
  ];
  
  // 🔍 COMPREHENSIVE DATA DIAGNOSTICS (conditional logging)
  if (mlLogger && mlLogger.isEnabled('diagnostics')) {
    mlLogger.diagnostic('\n🔍 === COMPREHENSIVE TRAINING DATA DIAGNOSTICS ===');
  
    // 1. Feature vector analysis
    mlLogger.diagnostic('📊 Feature Analysis:');
    mlLogger.diagnostic(`   URL tokens shape: ${urlTokens.length} samples × ${urlTokens[0].length} features`);
    mlLogger.diagnostic(`   Title tokens shape: ${titleTokens.length} samples × ${titleTokens[0].length} features`);
    mlLogger.diagnostic(`   Engineered features shape: ${features.length} samples × ${features[0].length} features`);
  
  // 2. Sample actual feature values (first 3 samples)
  // Sample features validated
  
    // 3. Feature statistics
    mlLogger.diagnostic('\n📈 Feature Statistics:');
  
  // URL tokens stats
  const urlTokenStats = {
    min: Math.min(...urlTokens.flat()),
    max: Math.max(...urlTokens.flat()),
    nonZeros: urlTokens.flat().filter(x => x !== 0).length,
    zeros: urlTokens.flat().filter(x => x === 0).length
  };
    mlLogger.diagnostic(`   URL tokens: min=${urlTokenStats.min}, max=${urlTokenStats.max}, non-zeros=${urlTokenStats.nonZeros}, zeros=${urlTokenStats.zeros}`);
    
    // Title tokens stats  
    const titleTokenStats = {
      min: Math.min(...titleTokens.flat()),
      max: Math.max(...titleTokens.flat()),
      nonZeros: titleTokens.flat().filter(x => x !== 0).length,
      zeros: titleTokens.flat().filter(x => x === 0).length
    };
    mlLogger.diagnostic(`   Title tokens: min=${titleTokenStats.min}, max=${titleTokenStats.max}, non-zeros=${titleTokenStats.nonZeros}, zeros=${titleTokenStats.zeros}`);
  
  // Engineered features stats
  const engineeredStats = {
    min: Math.min(...features.flat()),
    max: Math.max(...features.flat()),
    mean: features.flat().reduce((a, b) => a + b) / features.flat().length,
    nonZeros: features.flat().filter(x => x !== 0).length,
    zeros: features.flat().filter(x => x === 0).length
  };
  mlLogger.diagnostic(`   Engineered features: min=${engineeredStats.min.toFixed(3)}, max=${engineeredStats.max.toFixed(3)}, mean=${engineeredStats.mean.toFixed(3)}, non-zeros=${engineeredStats.nonZeros}, zeros=${engineeredStats.zeros}`);
  
  // 4. Label distribution analysis
  mlLogger.diagnostic('\n🏷️ Label Analysis:');
  const labelStats = {};
  labels.forEach(label => labelStats[label] = (labelStats[label] || 0) + 1);
  Object.entries(labelStats).forEach(([label, count]) => {
    const percentage = (count / labels.length * 100).toFixed(1);
    mlLogger.diagnostic(`   Class ${label}: ${count} samples (${percentage}%)`);
  });
  
  // 5. Sample weights analysis
  mlLogger.diagnostic('\n⚖️ Sample Weights Analysis:');
  const weightsByClass = {};
  labels.forEach((label, i) => {
    if (!weightsByClass[label]) weightsByClass[label] = [];
    weightsByClass[label].push(sampleWeights[i]);
  });
  
  Object.entries(weightsByClass).forEach(([label, weights]) => {
    const avg = weights.reduce((a, b) => a + b) / weights.length;
    const min = Math.min(...weights);
    const max = Math.max(...weights);
    mlLogger.diagnostic(`   Class ${label}: avg=${avg.toFixed(3)}, min=${min.toFixed(3)}, max=${max.toFixed(3)}, count=${weights.length}`);
  });
  
  // 6. Data quality checks
  mlLogger.diagnostic('\n🔬 Data Quality Checks:');
  
  // Check for NaN or infinite values
  const hasNaNFeatures = features.some(row => row.some(val => isNaN(val) || !isFinite(val)));
  const hasNaNWeights = sampleWeights.some(w => isNaN(w) || !isFinite(w));
  const hasInvalidLabels = labels.some(l => isNaN(l) || l < 0 || l > 3 || !Number.isInteger(l));
  
  mlLogger.diagnostic(`   NaN/Infinite in engineered features: ${hasNaNFeatures}`);
  mlLogger.diagnostic(`   NaN/Infinite in sample weights: ${hasNaNWeights}`);
  mlLogger.diagnostic(`   Invalid labels: ${hasInvalidLabels}`);
  
  // Check feature variance (features with zero variance won't help)
  const featureVariances = [];
  for (let featureIdx = 0; featureIdx < features[0].length; featureIdx++) {
    const values = features.map(row => row[featureIdx]);
    const mean = values.reduce((a, b) => a + b) / values.length;
    const variance = values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / values.length;
    featureVariances.push(variance);
  }
  
  const zeroVarianceFeatures = featureVariances.filter(v => v === 0).length;
  const lowVarianceFeatures = featureVariances.filter(v => v > 0 && v < 0.001).length;
  mlLogger.diagnostic(`   Zero variance features: ${zeroVarianceFeatures}/${features[0].length}`);
  mlLogger.diagnostic(`   Low variance features (< 0.001): ${lowVarianceFeatures}/${features[0].length}`);
  
  // ⚠️ CRITICAL FIXES FOR CONVERGENCE ISSUES
  if (zeroVarianceFeatures > 0) {
    mlLogger.diagnostic(`⚠️ FIXING: Removing ${zeroVarianceFeatures} zero-variance features...`);
    
    // Identify zero variance feature indices
    const goodFeatureIndices = [];
    featureVariances.forEach((variance, idx) => {
      if (variance > 0) {
        goodFeatureIndices.push(idx);
      }
    });
    
    // Filter out zero variance features
    const filteredFeatures = features.map(row => 
      goodFeatureIndices.map(idx => row[idx])
    );
    
    mlLogger.diagnostic(`   Filtered features: ${features[0].length} → ${filteredFeatures[0].length} features`);
    
    // Update features array
    features.length = 0;
    features.push(...filteredFeatures);
  }
  
  // Fix extreme weight imbalance
  const weightImbalanceRatio = Math.max(...Object.values(weightsByClass).map(weights => 
    weights.reduce((a, b) => a + b) / weights.length
  )) / Math.min(...Object.values(weightsByClass).map(weights => 
    weights.reduce((a, b) => a + b) / weights.length
  ));
  
  if (weightImbalanceRatio > 1.5) {
    mlLogger.diagnostic(`⚠️ FIXING: Normalizing extreme weight imbalance (${weightImbalanceRatio.toFixed(2)}:1)...`);
    
    // Normalize weights to reduce extreme differences
    const targetWeight = 0.5; // Target average weight
    const normalizedWeights = sampleWeights.map((weight, i) => {
      const label = labels[i];
      const classAvgWeight = weightsByClass[label].reduce((a, b) => a + b) / weightsByClass[label].length;
      
      // Scale weights toward target while preserving relative differences
      const scaleFactor = targetWeight / classAvgWeight;
      return Math.min(Math.max(weight * scaleFactor, 0.3), 0.7); // Clamp between 0.3-0.7
    });
    
    // Update sample weights
    sampleWeights.length = 0;
    sampleWeights.push(...normalizedWeights);
    
    mlLogger.diagnostic(`   Weight normalization: ratio reduced from ${weightImbalanceRatio.toFixed(2)}:1 to ~1.5:1`);
  }
  
  // 7. Check for problematic duplicate samples (same features, different labels)
  const featureToSamples = new Map();
  let totalDuplicates = 0;
  let problematicDuplicates = 0;
  
  features.forEach((featureRow, i) => {
    const key = `${urlTokens[i].join(',')}_${titleTokens[i].join(',')}_${featureRow.join(',')}`;
    if (!featureToSamples.has(key)) {
      featureToSamples.set(key, []);
    }
    featureToSamples.get(key).push(i);
  });
  
  const problematicGroups = {};
  
  for (const [key, indices] of featureToSamples.entries()) {
    if (indices.length > 1) {
      totalDuplicates += indices.length - 1; // Count extras as duplicates
      
      // Check if all have same label  
      const sampleLabels = indices.map(i => labels[i]);
      const uniqueLabels = [...new Set(sampleLabels)];
      
      if (uniqueLabels.length > 1) {
        // Problematic: same features, different labels
        problematicDuplicates += indices.length - 1;
        problematicGroups[key] = indices;
      }
    }
  }
  
  mlLogger.diagnostic(`   Total duplicate feature vectors: ${totalDuplicates}/${features.length} (expected from balancing)`);
  mlLogger.diagnostic(`   Problematic duplicates (same features, different labels): ${problematicDuplicates}/${features.length}`);
  
  // 🔍 DEEP DEBUG: Analyze problematic duplicates if any exist
  if (problematicDuplicates > 0) { // Any problematic duplicates
    mlLogger.diagnostic('🚨 PROBLEMATIC DUPLICATES - ANALYZING FEATURE EXTRACTION:');
    
    // Sample some problematic duplicate groups
    let groupCount = 0;
    for (const [key, indices] of Object.entries(problematicGroups)) {
      if (indices.length > 0 && groupCount < 3) { // Show first 3 duplicate groups
        mlLogger.diagnostic(`\n  Duplicate Group ${groupCount + 1} (${indices.length + 1} samples):`);
        
        // Find the original (first occurrence)
        const originalIdx = features.findIndex((_, i) => {
          const testKey = `${urlTokens[i].join(',')}_${titleTokens[i].join(',')}_${features[i].join(',')}`;
          return testKey === key;
        });
        
        [originalIdx, ...indices].forEach((idx, pos) => {
          const item = sortedTrainingData[idx];
          mlLogger.diagnostic(`    [${pos === 0 ? 'ORIG' : 'DUP'}] Cat:${item.category} URL:${(item.url || '').substring(0, 40)}...`);
          mlLogger.diagnostic(`          Title: ${(item.title || 'No title').substring(0, 40)}...`);
          mlLogger.diagnostic(`          URLTokens: [${urlTokens[idx].slice(0, 8).join(',')}${urlTokens[idx].length > 8 ? '...' : ''}]`);
          mlLogger.diagnostic(`          TitleTokens: [${titleTokens[idx].slice(0, 8).join(',')}${titleTokens[idx].length > 8 ? '...' : ''}]`);
          mlLogger.diagnostic(`          EngFeatures: [${features[idx].slice(0, 8).map(f => f.toFixed(2)).join(',')}${features[idx].length > 8 ? '...' : ''}]`);
        });
        groupCount++;
      }
    }
    
    // Vocabulary diagnostic
    mlLogger.diagnostic(`\n🔍 Vocabulary Info:`);
    mlLogger.diagnostic(`    Size: ${vocabulary ? Object.keys(vocabulary.tokenToId || {}).length : 'No vocabulary'}`);
    if (vocabulary && vocabulary.tokenToId) {
      const sampleTokens = Object.keys(vocabulary.tokenToId).slice(0, 10);
      mlLogger.diagnostic(`    Sample tokens: [${sampleTokens.join(', ')}]`);
    }
    
    // Feature variance analysis
    mlLogger.diagnostic(`\n📊 Feature Analysis:`);
    const featureVariances = [];
    for (let f = 0; f < features[0].length; f++) {
      const values = features.map(row => row[f]);
      const mean = values.reduce((a, b) => a + b) / values.length;
      const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
      featureVariances.push(variance);
    }
    const lowVarianceFeatures = featureVariances.filter(v => v < 0.001).length;
    mlLogger.mlDiagnostic(`    Low variance features (<0.001): ${lowVarianceFeatures}/${featureVariances.length}`);
    mlLogger.mlDiagnostic(`    Variance range: ${Math.min(...featureVariances).toFixed(6)} to ${Math.max(...featureVariances).toFixed(3)}`);
  }
  
    mlLogger.diagnostic('🔍 === END DIAGNOSTICS ===\n');
  }

  // One-hot encode labels
  const ys = tf.oneHot(tf.tensor1d(labels, 'int32'), config.numClasses || 4);
  
  return { xs, ys, sampleWeights, classImbalanceRatio }; // Return array, not tensor
}

/**
 * Handle prediction request
 */
async function handlePredict(data, jobId) {
  const { modelWeights, inputData, modelConfig } = data;
  
  try {
    // Rebuild model
    const model = buildModel(modelConfig);
    
    // Load weights
    const weights = modelWeights.map(w => 
      tf.tensor(w.data, w.shape)
    );
    model.setWeights(weights);
    
    // Prepare input
    const input = tf.tensor2d(inputData.map(d => d.features));
    
    // Make predictions
    const predictions = await model.predict(input);
    const probabilities = await predictions.array();
    
    // Get predicted classes
    const classes = await predictions.argMax(-1).array();
    
    // Clean up
    input.dispose();
    predictions.dispose();
    weights.forEach(w => w.dispose());
    model.dispose();
    
    // Send results
    self.postMessage({
      type: 'PREDICTION_COMPLETE',
      jobId,
      data: {
        predictions: classes,
        probabilities,
        confidence: probabilities.map(probs => Math.max(...probs))
      }
    });
    
  } catch (error) {
    throw error;
  }
}

/**
 * Handle cancel request
 */
function handleCancel(jobId) {
  mlLogger.mlTraining(`🛑 CANCEL request received for job: ${jobId}`);
  mlLogger.mlTraining(`🛑 Current job: ${currentJob ? currentJob.id : 'none'}`);
  
  if (currentJob && currentJob.id === jobId) {
    mlLogger.mlTraining(`🛑 Cancelling training job: ${jobId}`);
    
    // Set cancellation flag to be checked in training callbacks
    currentJob.cancelled = true;
    
    // Clear training state
    isTraining = false;
    
    // Don't clear currentJob here - let the training callback handle it
    // so that the onEpochEnd callback can still check currentJob.cancelled
    
    self.postMessage({
      type: 'CANCELLED',
      jobId
    });
  } else {
    mlLogger.mlTraining(`🛑 CANCEL ignored - job ID mismatch or no current job`);
  }
}

/**
 * Handle status request
 */
function handleStatus() {
  self.postMessage({
    type: 'STATUS',
    data: {
      isTraining,
      currentJob: currentJob ? {
        id: currentJob.id,
        duration: Date.now() - currentJob.startTime
      } : null,
      tfBackend: tf ? tf.getBackend() : null,
      memoryInfo: tf ? tf.memory() : null
    }
  });
}

/**
 * Handle logging configuration from main thread
 */
function handleLoggingConfig(config) {
  if (mlLogger && config) {
    // Update the logger configuration
    const enabledCategories = new Set();
    
    // Handle both flat and nested config formats
    function addEnabledCategories(obj, prefix = '') {
      Object.keys(obj).forEach(key => {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (typeof obj[key] === 'boolean' && obj[key] === true) {
          enabledCategories.add(fullKey);
          enabledCategories.add(key); // Also add short name for backward compatibility
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          addEnabledCategories(obj[key], fullKey);
        }
      });
    }
    
    addEnabledCategories(config);
    
    // Update isEnabled function
    mlLogger.isEnabled = (category) => enabledCategories.has(category);
    
    // Update all logging methods to use isEnabled
    mlLogger.mlDiagnostic = (...args) => {
      if (mlLogger.isEnabled('ml.diagnostics') || mlLogger.isEnabled('diagnostics')) {
        console.log('🔍 [ML-DIAGNOSTIC]', ...args);
      }
    };
    
    mlLogger.diagnostic = mlLogger.mlDiagnostic; // Legacy support
    
    mlLogger.mlArchitecture = (...args) => {
      if (mlLogger.isEnabled('ml.architecture') || mlLogger.isEnabled('architecture')) {
        console.log('🏗️ [ML-ARCHITECTURE]', ...args);
      }
    };
    
    mlLogger.architecture = mlLogger.mlArchitecture; // Legacy support
    
    mlLogger.mlTraining = (...args) => {
      if (mlLogger.isEnabled('ml.training') || mlLogger.isEnabled('training')) {
        console.log('🏋️ [ML-TRAINING]', ...args);
      }
    };
    
    mlLogger.training = mlLogger.mlTraining; // Legacy support
    
    mlLogger.mlConfusion = (...args) => {
      if (mlLogger.isEnabled('ml.confusion') || mlLogger.isEnabled('confusion')) {
        console.log('🔍 [ML-CONFUSION]', ...args);
      }
    };
    
    mlLogger.confusion = mlLogger.mlConfusion; // Legacy support
    
    mlLogger.verbose = (...args) => {
      if (mlLogger.isEnabled('verbose')) {
        console.log('[VERBOSE]', ...args);
      }
    };
    
    mlLogger.mlDiagnostic('Worker logging configured:', config);
  }
}

/**
 * Oversample training data to balance classes
 * Works directly with tensor data to avoid data leakage
 */
function oversampleTrainingData(trainXs, trainYs, trainWeights) {
  // Prepare data for oversampling
  
  // Convert tensors to arrays for manipulation
  const trainData = {
    urlTokens: trainXs[0].arraySync(),
    titleTokens: trainXs[1].arraySync(), 
    features: trainXs[2].arraySync(),
    labels: tf.argMax(trainYs, 1).arraySync(), // Use tf.argMax instead of trainYs.argMax
    oneHotLabels: trainYs.arraySync(),
    weights: trainWeights
  };
  
  // Group by category
  const categorized = {};
  for (let i = 0; i < trainData.labels.length; i++) {
    const category = trainData.labels[i];
    if (!categorized[category]) {
      categorized[category] = [];
    }
    categorized[category].push(i);
  }
  
  // Find max class size
  const maxSize = Math.max(...Object.values(categorized).map(arr => arr.length));
  
  // Create balanced arrays
  const balancedData = {
    urlTokens: [...trainData.urlTokens],
    titleTokens: [...trainData.titleTokens],
    features: [...trainData.features], 
    oneHotLabels: [...trainData.oneHotLabels],
    weights: [...trainData.weights]
  };
  
  // Oversample minority classes
  for (const [category, indices] of Object.entries(categorized)) {
    const needed = maxSize - indices.length;
    if (needed > 0) {
      mlLogger.mlTraining(`📊 Oversampling category ${category}: adding ${needed} samples`);
      
      // Oversample from existing examples
      for (let i = 0; i < needed; i++) {
        const sourceIndex = indices[i % indices.length];
        balancedData.urlTokens.push(trainData.urlTokens[sourceIndex]);
        balancedData.titleTokens.push(trainData.titleTokens[sourceIndex]);
        balancedData.features.push(trainData.features[sourceIndex]);
        balancedData.oneHotLabels.push(trainData.oneHotLabels[sourceIndex]);
        balancedData.weights.push(trainData.weights[sourceIndex]);
      }
    }
  }
  
  // Convert back to tensors
  const balancedTrainXs = [
    tf.tensor2d(balancedData.urlTokens, null, 'int32'),
    tf.tensor2d(balancedData.titleTokens, null, 'int32'),
    tf.tensor2d(balancedData.features)
  ];
  const balancedTrainYs = tf.tensor2d(balancedData.oneHotLabels);
  const balancedTrainWeights = balancedData.weights;
  
  return { balancedTrainXs, balancedTrainYs, balancedTrainWeights };
}

/**
 * Balance classes temporally while preserving order within each category
 * Based on TemporalDataGenerator.balanceClassesTemporally
 */
function balanceClassesTemporally(data, options = {}) {
  const { strategy = 'oversample' } = options;
  
  // Group by category while preserving temporal order within each group
  const categorized = {};
  data.forEach(example => {
    const category = example.category;
    if (!categorized[category]) {
      categorized[category] = [];
    }
    categorized[category].push(example);
  });
  
  // Find max class size for balancing target
  const maxSize = Math.max(...Object.values(categorized).map(arr => arr.length));
  
  const balanced = [];
  
  for (const [category, examples] of Object.entries(categorized)) {
    // Add all original examples first (already temporally sorted)
    balanced.push(...examples);
    
    if (strategy === 'oversample') {
      const needed = maxSize - examples.length;
      
      if (needed > 0) {
        // Oversample from recent examples (last 50% of the category)
        const recentCount = Math.max(1, Math.floor(examples.length * 0.5));
        const recentExamples = examples.slice(-recentCount); // Take most recent
        
        mlLogger.mlTraining(`📊 Oversampling category ${category}: adding ${needed} samples from ${recentCount} recent examples`);
        
        for (let i = 0; i < needed; i++) {
          const index = i % recentExamples.length;
          const example = recentExamples[index];
          
          // Create augmented version with timestamp jitter to maintain temporal order
          const getTimestamp = (item) => 
            item.categorizedAt || item.savedAt || item.lastUpdated || 
            item.lastAccessed || item.timestamp || item.createdAt || Date.now();
          
          const augmented = {
            ...example,
            augmented: true,
            originalTimestamp: getTimestamp(example),
            // Add small random jitter to timestamp (±30 minutes)
            timestamp: getTimestamp(example) + (Math.random() - 0.5) * 1800000,
            categorizedAt: getTimestamp(example) + (Math.random() - 0.5) * 1800000
          };
          
          balanced.push(augmented);
        }
      }
    }
  }
  
  // Re-sort by timestamp to maintain overall temporal order
  return balanced.sort((a, b) => {
    const getTimestamp = (item) => 
      item.categorizedAt || item.savedAt || item.lastUpdated || 
      item.lastAccessed || item.timestamp || item.createdAt || 0;
    
    const timeA = getTimestamp(a);
    const timeB = getTimestamp(b);
    
    if (timeA !== timeB) {
      return timeA - timeB;
    }
    
    // Fallback to URL for deterministic ordering
    return a.url.localeCompare(b.url);
  });
}

/**
 * Build confusion matrix from true and predicted class arrays
 */
function buildConfusionMatrix(trueClasses, predClasses) {
  const numClasses = 4; // 0=uncategorized, 1=ignore, 2=useful, 3=important
  const matrix = Array(numClasses).fill(null).map(() => Array(numClasses).fill(0));
  
  for (let i = 0; i < trueClasses.length; i++) {
    const trueClass = Math.floor(trueClasses[i]);
    const predClass = Math.floor(predClasses[i]);
    if (trueClass >= 0 && trueClass < numClasses && predClass >= 0 && predClass < numClasses) {
      matrix[trueClass][predClass]++;
    }
  }
  
  return matrix;
}

/**
 * Log confusion matrix in readable format
 */
function logConfusionMatrix(matrix, prefix) {
  const categories = ['Uncat', 'Ignore', 'Useful', 'Import'];
  const totalSamples = matrix.flat().reduce((a, b) => a + b, 0);
  
  mlLogger.mlConfusion(`${prefix} samples: ${totalSamples}`);
  mlLogger.mlConfusion(`${prefix}     Pred→ Uncat  Ignore Useful Import`);
  
  let correctPredictions = 0;
  for (let i = 0; i < matrix.length; i++) {
    const rowTotal = matrix[i].reduce((a, b) => a + b, 0);
    const row = matrix[i].map(count => count.toString().padStart(6)).join('');
    mlLogger.mlConfusion(`${prefix} ${categories[i]}${row} (${rowTotal})`);
    correctPredictions += matrix[i][i]; // Diagonal elements are correct predictions
  }
  
  const accuracy = totalSamples > 0 ? (correctPredictions / totalSamples * 100).toFixed(1) : 0;
  mlLogger.mlConfusion(`${prefix} accuracy from matrix: ${accuracy}%`);
}

/**
 * Comprehensive evaluation showing every validation record with URL, title, and colored predictions
 */
async function logDetailedEvaluationSimple(trainingData, model, valPredArray, valTrueArray, validationData, options, originalValProbs) {
  try {
    mlLogger.mlDiagnostic('\n=== DETAILED EVALUATION: EVERY VALIDATION RECORD ===\n');
    
    // Use separate validation data passed to worker (independent evaluation)
    mlLogger.mlDiagnostic(`🔍 Using separate validation data for independent evaluation`);
    
    if (!validationData || validationData.length === 0) {
      mlLogger.mlDiagnostic('No validation data available');
      return;
    }
    
    // Use the validation data that was passed separately
    const valData = validationData.filter(item => 
      item.features && 
      item.features.urlTokens && 
      item.features.titleTokens && 
      item.features.engineeredFeatures
    );
    
    mlLogger.mlDiagnostic(`📊 Found ${valData.length} validation records with features (out of ${validationData.length} total validation records)`);
    
    if (valData.length === 0) {
      mlLogger.mlDiagnostic('No validation data available');
      return;
    }
    
    const categories = ['Uncat', 'Ignore', 'Useful', 'Import'];
    
    // Create validation tensors only for getting probabilities (not for predictions)
    const urlTokensData = valData.map(item => item.features.urlTokens);
    const titleTokensData = valData.map(item => item.features.titleTokens);
    const engineeredData = valData.map(item => item.features.engineeredFeatures);
    
    if (!urlTokensData[0] || !titleTokensData[0] || !engineeredData[0]) {
      mlLogger.mlDiagnostic('Missing feature data for detailed evaluation');
      return;
    }
    
    // Make fresh predictions on real validation data
    let probabilities = null;
    let realPredArray = null;
    
    try {
      const valXs = [
        tf.tensor2d(urlTokensData, [valData.length, urlTokensData[0].length]),
        tf.tensor2d(titleTokensData, [valData.length, titleTokensData[0].length]),
        tf.tensor2d(engineeredData, [valData.length, engineeredData[0].length])
      ];
      
      const predictions = model.predict(valXs);
      probabilities = await predictions.data();
      
      // Get predictions (argmax)
      const predClasses = tf.argMax(predictions, 1);
      realPredArray = await predClasses.data();
      
      // Clean up tensors
      predictions.dispose();
      predClasses.dispose();
      valXs.forEach(x => x.dispose());
      
      mlLogger.mlDiagnostic(`📊 Made fresh predictions on ${valData.length} validation records`);
    } catch (error) {
      console.error('Failed to make predictions on validation data:', error.message);
      return;
    }
    
    // Display every validation record
    for (let i = 0; i < valData.length; i++) {
      const url = valData[i].url;
      const title = valData[i].title;
      
      // Use the record's actual category from database
      const trueCategory = valData[i].category;
      
      // Use fresh prediction made on this exact record
      const predCategory = realPredArray[i];
      
      
      // Get fresh probabilities for this exact record
      let probs = [0, 0, 0, 0]; // Default if probabilities unavailable
      let rawConfidence = 'N/A';
      
      if (probabilities && probabilities.length > i*4+3) {
        probs = [
          probabilities[i*4],     // Uncategorized
          probabilities[i*4+1],   // Ignore  
          probabilities[i*4+2],   // Useful
          probabilities[i*4+3]    // Important
        ];
        
        const maxProb = Math.max(...probs);
        rawConfidence = (maxProb * 100).toFixed(1);
        
        // Verify probabilities match predictions (should always match now)
        const probArgMax = probs.indexOf(maxProb);
        if (probArgMax !== predCategory) {
          console.warn(`⚠️ Prediction mismatch Record ${i+1}: probArgMax=${probArgMax}, predCategory=${predCategory}`);
        }
      }
      
      // Get sample weight (confidence in the label)
      let sampleWeight = valData[i].trainingConfidence;
      if (typeof sampleWeight !== 'number') {
        // Fallback to combinedConfidence if trainingConfidence is not available
        sampleWeight = valData[i].combinedConfidence;
        assert(typeof sampleWeight === 'number', `Missing confidence values for validation item ${i}: ${valData[i].url}`);
      }
      assert(sampleWeight >= 0 && sampleWeight <= 1, `Confidence out of range: ${sampleWeight} for validation item ${i}`);
      
      // Create colored probability array string
      const coloredProbs = probs.map((prob, idx) => {
        const probStr = (prob * 100).toFixed(1);
        if (idx === trueCategory) {
          return `\x1b[32m${probStr}\x1b[0m`; // GREEN - always color the true/correct label
        } else if (idx === predCategory && idx !== trueCategory) {
          return `\x1b[31m${probStr}\x1b[0m`; // RED - wrong prediction only
        } else {
          return probStr; // Normal - no extra coloring needed
        }
      }).join(', ');
      
      // Check if prediction matches true category
      const isCorrect = trueCategory === predCategory;
      const status = isCorrect ? '✅' : '❌';
      
      // Print each record on separate lines
      mlLogger.mlDiagnostic(`${status} Record ${i + 1}:`);
      mlLogger.mlDiagnostic(`   URL: ${url}`);
      mlLogger.mlDiagnostic(`   Title: "${title}"`);
      mlLogger.mlDiagnostic(`   True: ${categories[trueCategory]} | Pred: ${categories[predCategory]} (${rawConfidence}% conf)`);
      mlLogger.mlDiagnostic(`   Probabilities: [${coloredProbs}] (label weight: ${sampleWeight.toFixed(3)})`);
      mlLogger.mlDiagnostic(''); // Empty line between records
    }
    
    // Summary - calculate accuracy on real validation data
    const correct = realPredArray.filter((pred, i) => pred === valData[i].category).length;
    const accuracy = (correct / valData.length * 100).toFixed(1);
    mlLogger.mlDiagnostic(`\n📊 REAL VALIDATION SUMMARY: ${correct}/${valData.length} correct (${accuracy}%)`);
    mlLogger.mlDiagnostic(`📊 This is independent evaluation on actual validation records from database`);
    
  } catch (error) {
    console.error('Error in comprehensive detailed evaluation:', error);
  }
}

/**
 * Helper to prepare balanced training data (simplified version)
 */
function prepareBalancedTrainingData(trainingData) {
  // Return valid training data with features
  return trainingData.filter(item => 
    item.features && 
    item.features.urlTokens && 
    item.features.titleTokens && 
    item.features.engineeredFeatures &&
    item.category >= 1 && item.category <= 3 // Valid categories
  );
}

/**
 * Monitor memory usage
 */
setInterval(() => {
  if (tf && isTraining) {
    const memory = tf.memory();
    
    // Warn if memory usage is high
    if (memory.numBytes > 100 * 1024 * 1024) { // 100MB
      self.postMessage({
        type: 'MEMORY_WARNING',
        data: memory
      });
    }
  }
}, 5000);