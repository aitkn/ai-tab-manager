/*
 * AI Tab Manager - Embedding Model
 * Creates embeddings for URLs and titles
 */

import { ML_CONFIG } from '../model-config.js';
import { getTensorFlow } from '../tensorflow-loader.js';
import { extractAllFeatures, extractPatternFeatures, extractTokenFeatures, extractNumericalFeatures } from '../features/url-parser.js';
import { extractSpecialTokens } from '../features/tokenizer.js';

/**
 * Create embedding layer for the model
 * @param {number} vocabSize - Size of vocabulary
 * @param {number} embeddingDim - Dimension of embeddings
 * @returns {Object} TensorFlow.js embedding layer
 */
export function createEmbeddingLayer(vocabSize, embeddingDim = ML_CONFIG.model.inputFeatures.embeddingDim) {
  const tf = getTensorFlow();
  if (!tf) throw new Error('TensorFlow.js not loaded');
  
  return tf.layers.embedding({
    inputDim: vocabSize,
    outputDim: embeddingDim,
    embeddingsInitializer: 'randomUniform',
    embeddingsRegularizer: tf.regularizers.l2({ l2: 0.01 }),
    name: 'token_embeddings'
  });
}

/**
 * Create feature embedding model
 * @param {Object} vocabulary - Vocabulary object
 * @returns {Object} Complete embedding model
 */
export function createFeatureEmbedder(vocabulary) {
  const tf = getTensorFlow();
  if (!tf) throw new Error('TensorFlow.js not loaded');
  
  const config = ML_CONFIG.model.inputFeatures;
  
  // Input layers
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
  
  // Embedding layers
  const embeddingLayer = createEmbeddingLayer(vocabulary.size(), config.embeddingDim);
  
  // Apply embeddings
  const urlEmbeddings = embeddingLayer.apply(urlInput);
  const titleEmbeddings = embeddingLayer.apply(titleInput);
  
  // Average pooling for variable-length sequences
  const urlPoolingLayer = tf.layers.globalAveragePooling1d({ 
    name: 'url_pooling' 
  });
  const urlPooled = urlPoolingLayer.apply(urlEmbeddings);
  
  const titlePoolingLayer = tf.layers.globalAveragePooling1d({ 
    name: 'title_pooling' 
  });
  const titlePooled = titlePoolingLayer.apply(titleEmbeddings);
  
  // Concatenate all features
  const concatenateLayer = tf.layers.concatenate({ 
    name: 'feature_concatenation' 
  });
  const concatenated = concatenateLayer.apply([urlPooled, titlePooled, featuresInput]);
  
  // Feature transformation layer
  const denseLayer = tf.layers.dense({
    units: ML_CONFIG.model.architecture.featureTransformUnits,
    activation: 'relu',
    kernelRegularizer: tf.regularizers.l2({ l2: 0.01 }),
    name: 'feature_transformation'
  });
  const transformed = denseLayer.apply(concatenated);
  
  // Dropout for regularization
  const dropoutLayer = tf.layers.dropout({
    rate: 0.2,
    name: 'feature_dropout'
  });
  const output = dropoutLayer.apply(transformed);
  
  return tf.model({
    inputs: [urlInput, titleInput, featuresInput],
    outputs: output,
    name: 'feature_embedder'
  });
}

/**
 * Prepare input data for the embedding model
 * @param {Object} tab - Tab object with url and title
 * @param {Object} vocabulary - Vocabulary object
 * @returns {Object} Prepared inputs
 */
export function prepareEmbeddingInputs(tab, vocabulary) {
  // Encode tokens
  const encoded = vocabulary.encode(tab.url, tab.title);
  
  // Extract engineered features - simplified to match expected shape
  const urlFeatures = extractAllFeatures(tab.url);
  const specialTokens = extractSpecialTokens(tab.url, tab.title);
  
  // Create exactly the right number of features to match the model
  const patterns = extractPatternFeatures(tab.url);  // Should be 7
  const tokens = extractTokenFeatures(tab.url);      // Should be 18  
  const numerical = extractNumericalFeatures(urlFeatures.parsed); // Should be 10
  
  const engineeredFeatures = [
    ...patterns,     // 7 URL pattern features
    ...tokens,       // 18 important token features  
    ...numerical     // 10 numerical features
  ];
  
  
  // Should total exactly 35 features
  
  return {
    urlTokens: encoded.url,
    titleTokens: encoded.title,
    features: engineeredFeatures
  };
}

/**
 * Create embeddings for multiple tabs
 * @param {Array} tabs - Array of tab objects
 * @param {Object} vocabulary - Vocabulary object
 * @param {Object} embedder - Feature embedder model
 * @returns {Promise<Array>} Embeddings
 */
export async function createTabEmbeddings(tabs, vocabulary, embedder) {
  const tf = getTensorFlow();
  if (!tf) throw new Error('TensorFlow.js not loaded');
  
  // Prepare batch inputs
  const urlTokensBatch = [];
  const titleTokensBatch = [];
  const featuresBatch = [];
  
  tabs.forEach(tab => {
    const inputs = prepareEmbeddingInputs(tab, vocabulary);
    urlTokensBatch.push(inputs.urlTokens);
    titleTokensBatch.push(inputs.titleTokens);
    featuresBatch.push(inputs.features);
  });
  
  // Convert to tensors
  const urlTensor = tf.tensor2d(urlTokensBatch, null, 'int32');
  const titleTensor = tf.tensor2d(titleTokensBatch, null, 'int32');
  const featuresTensor = tf.tensor2d(featuresBatch);
  
  // Get embeddings
  const embeddings = await embedder.predict([urlTensor, titleTensor, featuresTensor]);
  
  // Convert to array
  const embeddingsArray = await embeddings.array();
  
  // Clean up tensors
  urlTensor.dispose();
  titleTensor.dispose();
  featuresTensor.dispose();
  embeddings.dispose();
  
  return embeddingsArray;
}

/**
 * Calculate embedding similarity
 * @param {Array} embedding1 - First embedding
 * @param {Array} embedding2 - Second embedding
 * @returns {number} Cosine similarity
 */
export function calculateSimilarity(embedding1, embedding2) {
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;
  
  for (let i = 0; i < embedding1.length; i++) {
    dotProduct += embedding1[i] * embedding2[i];
    norm1 += embedding1[i] * embedding1[i];
    norm2 += embedding2[i] * embedding2[i];
  }
  
  norm1 = Math.sqrt(norm1);
  norm2 = Math.sqrt(norm2);
  
  if (norm1 === 0 || norm2 === 0) return 0;
  
  return dotProduct / (norm1 * norm2);
}

/**
 * Find similar tabs based on embeddings
 * @param {Array} targetEmbedding - Target embedding
 * @param {Array} allEmbeddings - All tab embeddings
 * @param {number} topK - Number of similar tabs to return
 * @returns {Array} Indices of similar tabs
 */
export function findSimilarTabs(targetEmbedding, allEmbeddings, topK = 5) {
  const similarities = allEmbeddings.map((embedding, index) => ({
    index,
    similarity: calculateSimilarity(targetEmbedding, embedding)
  }));
  
  // Sort by similarity descending
  similarities.sort((a, b) => b.similarity - a.similarity);
  
  // Return top K indices
  return similarities.slice(0, topK).map(item => ({
    index: item.index,
    similarity: item.similarity
  }));
}

export default {
  createEmbeddingLayer,
  createFeatureEmbedder,
  prepareEmbeddingInputs,
  createTabEmbeddings,
  calculateSimilarity,
  findSimilarTabs
};