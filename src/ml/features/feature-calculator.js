/*
 * AI Tab Manager - Feature Calculator
 * Calculates features for training data
 */

import { prepareEmbeddingInputs } from '../embeddings/embedding-model.js';
import { getOrCreateVocabulary } from '../features/vocabulary.js';
import { FEATURE_VERSION } from '../storage/ml-database.js';

/**
 * Calculate features for training data
 * Pre-calculates features to speed up training
 * @param {Object} data - Training data
 * @returns {Promise<Object>} Training data with features
 */
export async function calculateFeaturesForTrainingData(data) {
  try {
    // Get the vocabulary (should already be loaded)
    const vocabulary = await getOrCreateVocabulary();
    
    // Calculate features using the same function used during training
    const inputs = prepareEmbeddingInputs(
      { url: data.url, title: data.title },
      vocabulary
    );
    
    // Add features to the training data
    return {
      ...data,
      features: {
        urlTokens: inputs.urlTokens,
        titleTokens: inputs.titleTokens,
        engineeredFeatures: inputs.features
      },
      featureVersion: FEATURE_VERSION // Version to track feature format changes
    };
  } catch (error) {
    console.error('Error calculating features for training data:', error);
    // Return data without features on error
    return data;
  }
}