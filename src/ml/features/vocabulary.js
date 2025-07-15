/*
 * AI Tab Manager - Vocabulary Management
 * Manages token-to-ID mappings for neural network input
 */

import { ML_CONFIG } from '../model-config.js';
import { saveVocabulary, loadVocabulary } from '../storage/ml-database.js';
import { tokenizeURL, tokenizeTitle, isValidToken } from './tokenizer.js';
import logger from '../../utils/logger.js';

/**
 * Vocabulary class for managing token mappings
 */
export class Vocabulary {
  constructor(maxSize = ML_CONFIG.model.inputFeatures.vocabSize) {
    this.maxSize = maxSize;
    this.tokenToId = { 
      '<PAD>': 0,    // Padding token
      '<UNK>': 1,    // Unknown token
      '<URL>': 2,    // URL separator
      '<TITLE>': 3   // Title separator
    };
    this.idToToken = ['<PAD>', '<UNK>', '<URL>', '<TITLE>'];
    this.tokenCounts = {};
    this.finalized = false;
    // For dynamic refinement
    this.pendingTokenCounts = {}; // Tokens seen after finalization
    this.documentsProcessed = 0;
    this.lastRefinementCheck = 0;
    this.refinementThreshold = 0.5; // 50% higher frequency needed
    this.minDocumentsForRefinement = 100; // Process at least 100 docs before refinement
    this.hardFinalizedThreshold = 10; // When min vocab frequency is this high, stop tracking low-freq tokens
  }
  
  /**
   * Create a Vocabulary instance from serialized data
   */
  static fromData(data) {
    const vocab = new Vocabulary(data.size || ML_CONFIG.model.inputFeatures.vocabSize);
    vocab.tokenToId = data.tokenToId;
    vocab.idToToken = data.idToToken;
    vocab.finalized = true; // Loaded vocabularies are always finalized
    return vocab;
  }
  
  /**
   * Add tokens from a URL and title
   */
  addDocument(url, title) {
    const urlTokens = tokenizeURL(url);
    const titleTokens = tokenizeTitle(title);
    
    // Count all tokens
    [...urlTokens, ...titleTokens].forEach(token => {
      if (isValidToken(token)) {
        if (this.finalized) {
          // Check if we should still track this token
          if (this.shouldTrackToken(token)) {
            this.pendingTokenCounts[token] = (this.pendingTokenCounts[token] || 0) + 1;
          }
        } else {
          this.tokenCounts[token] = (this.tokenCounts[token] || 0) + 1;
        }
      }
    });
    
    this.documentsProcessed++;
  }
  
  /**
   * Check if a token should be tracked after finalization
   */
  shouldTrackToken(token) {
    // Always track tokens already in vocabulary
    if (this.tokenToId[token]) return true;
    
    // Get minimum frequency in current vocabulary
    const vocabTokens = Object.keys(this.tokenToId).filter(t => !['<PAD>', '<UNK>', '<URL>', '<TITLE>'].includes(t));
    const vocabFrequencies = vocabTokens.map(t => this.tokenCounts[t] || 0);
    const minVocabFrequency = Math.min(...vocabFrequencies);
    
    // If vocabulary is "hard finalized", only track tokens with reasonable chance
    if (minVocabFrequency >= this.hardFinalizedThreshold) {
      const currentCount = (this.pendingTokenCounts[token] || 0) + 1;
      // Only track if token has at least 1/10th of min vocabulary frequency
      return currentCount >= Math.floor(minVocabFrequency / 10);
    }
    
    // Otherwise, track all tokens
    return true;
  }
  
  /**
   * Build vocabulary from token counts
   */
  buildVocabulary() {
    if (this.finalized) {
      console.warn('Vocabulary already finalized');
      return;
    }
    
    // Sort tokens by frequency
    const sortedTokens = Object.entries(this.tokenCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, this.maxSize - this.idToToken.length);
    
    // Add tokens to vocabulary
    sortedTokens.forEach(([token, count]) => {
      if (!this.tokenToId[token]) {
        const id = this.idToToken.length;
        this.tokenToId[token] = id;
        this.idToToken.push(token);
      }
    });
    
    this.finalized = true;
    
    // Calculate and log vocabulary statistics
    const tokenTypes = {
      domain: 0,
      path: 0,
      title: 0,
      char: 0,
      param: 0,
      regular: 0
    };
    
    // Count token types
    this.idToToken.slice(4).forEach(token => { // Skip special tokens
      if (token.startsWith('dom_')) tokenTypes.domain++;
      else if (token.startsWith('path_')) tokenTypes.path++;
      else if (token.startsWith('title_')) tokenTypes.title++;
      else if (token.startsWith('char_')) tokenTypes.char++;
      else if (token.startsWith('param_')) tokenTypes.param++;
      else tokenTypes.regular++;
    });
    
    // Calculate frequency statistics
    const frequencies = sortedTokens.map(([_, count]) => count);
    const avgFreq = frequencies.reduce((sum, f) => sum + f, 0) / frequencies.length;
    const maxFreq = Math.max(...frequencies);
    const minFreq = Math.min(...frequencies);
    
    logger.mlArchitecture(`📚 Vocabulary built with ${this.idToToken.length} tokens`);
    logger.mlArchitecture(`   Token types: ${tokenTypes.regular} regular, ${tokenTypes.char} char n-grams, ${tokenTypes.domain} domain, ${tokenTypes.path} path, ${tokenTypes.title} title, ${tokenTypes.param} param`);
    logger.mlArchitecture(`   Frequency stats: min=${minFreq}, max=${maxFreq}, avg=${avgFreq.toFixed(1)}`);
    logger.mlArchitecture(`   Top 5 tokens: ${sortedTokens.slice(0, 5).map(([t, c]) => `${t}(${c})`).join(', ')}`);
  }
  
  /**
   * Check if vocabulary should be refined based on pending tokens
   */
  shouldRefine() {
    if (!this.finalized) return false;
    
    // Need minimum documents processed since last check
    const docsSinceLastCheck = this.documentsProcessed - this.lastRefinementCheck;
    if (docsSinceLastCheck < this.minDocumentsForRefinement) {
      return false;
    }
    
    // Merge pending counts with original counts for comparison
    const mergedCounts = { ...this.tokenCounts };
    Object.entries(this.pendingTokenCounts).forEach(([token, count]) => {
      mergedCounts[token] = (mergedCounts[token] || 0) + count;
    });
    
    // Get current vocabulary's minimum frequency
    const vocabTokens = Object.keys(this.tokenToId).filter(t => !['<PAD>', '<UNK>', '<URL>', '<TITLE>'].includes(t));
    const vocabFrequencies = vocabTokens.map(t => mergedCounts[t] || 0);
    const minVocabFrequency = Math.min(...vocabFrequencies);
    
    // Check if any pending tokens have significantly higher frequency
    const pendingTokens = Object.keys(this.pendingTokenCounts).filter(t => !this.tokenToId[t]);
    const highFrequencyPending = pendingTokens.filter(token => {
      const frequency = mergedCounts[token];
      return frequency > minVocabFrequency * (1 + this.refinementThreshold);
    });
    
    if (highFrequencyPending.length > 0) {
      // Found high-frequency tokens for refinement
      return true;
    }
    
    return false;
  }
  
  /**
   * Refine vocabulary by replacing low-frequency tokens with high-frequency ones
   */
  refineVocabulary() {
    if (!this.finalized) {
      console.warn('Cannot refine vocabulary that is not finalized');
      return false;
    }
    
    console.log('🔧 ML Vocabulary: Starting vocabulary refinement...');
    
    // Merge all counts
    const mergedCounts = { ...this.tokenCounts };
    Object.entries(this.pendingTokenCounts).forEach(([token, count]) => {
      mergedCounts[token] = (mergedCounts[token] || 0) + count;
    });
    
    // Sort all tokens by frequency
    const sortedTokens = Object.entries(mergedCounts)
      .filter(([token]) => !['<PAD>', '<UNK>', '<URL>', '<TITLE>'].includes(token))
      .sort((a, b) => b[1] - a[1])
      .slice(0, this.maxSize - 4); // Reserve 4 spots for special tokens
    
    // Store old vocabulary for comparison
    const oldTokens = new Set(Object.keys(this.tokenToId));
    
    // Rebuild vocabulary with top tokens
    this.tokenToId = {
      '<PAD>': 0,
      '<UNK>': 1,
      '<URL>': 2,
      '<TITLE>': 3
    };
    this.idToToken = ['<PAD>', '<UNK>', '<URL>', '<TITLE>'];
    
    sortedTokens.forEach(([token, _]) => {
      const id = this.idToToken.length;
      this.tokenToId[token] = id;
      this.idToToken.push(token);
    });
    
    // Calculate minimum frequency in new vocabulary
    const vocabFrequencies = sortedTokens.map(([_, count]) => count);
    const minVocabFrequency = Math.min(...vocabFrequencies);
    
    // Hard finalization check - clean up very low frequency tokens
    if (minVocabFrequency >= this.hardFinalizedThreshold) {
      console.log(`🧹 ML Vocabulary: Hard finalization triggered (min freq: ${minVocabFrequency})`);
      
      // Remove tokens from mergedCounts that have no chance of entering vocabulary
      const cleanThreshold = Math.floor(minVocabFrequency / 2); // Be conservative
      const beforeSize = Object.keys(mergedCounts).length;
      
      Object.keys(mergedCounts).forEach(token => {
        if (mergedCounts[token] < cleanThreshold && !this.tokenToId[token]) {
          delete mergedCounts[token];
        }
      });
      
      const afterSize = Object.keys(mergedCounts).length;
      console.log(`   Cleaned ${beforeSize - afterSize} low-frequency tokens (threshold: ${cleanThreshold})`);
    }
    
    // Update token counts with cleaned merged data
    this.tokenCounts = mergedCounts;
    this.pendingTokenCounts = {}; // Reset pending counts
    this.lastRefinementCheck = this.documentsProcessed;
    
    // Calculate changes
    const newTokens = new Set(Object.keys(this.tokenToId));
    const addedTokens = [...newTokens].filter(t => !oldTokens.has(t));
    const removedTokens = [...oldTokens].filter(t => !newTokens.has(t));
    
    // Vocabulary refinement complete
    
    return true;
  }
  
  /**
   * Encode a URL and title to token IDs
   */
  encode(url, title, maxUrlLength = null, maxTitleLength = null) {
    maxUrlLength = maxUrlLength || ML_CONFIG.model.inputFeatures.maxUrlLength;
    maxTitleLength = maxTitleLength || ML_CONFIG.model.inputFeatures.maxTitleLength;
    
    const urlTokens = tokenizeURL(url);
    const titleTokens = tokenizeTitle(title);
    
    // Convert tokens to IDs
    const urlIds = urlTokens
      .slice(0, maxUrlLength)
      .map(token => this.tokenToId[token] || 1); // 1 is <UNK>
    
    const titleIds = titleTokens
      .slice(0, maxTitleLength)
      .map(token => this.tokenToId[token] || 1);
    
    // Pad sequences
    while (urlIds.length < maxUrlLength) {
      urlIds.push(0); // 0 is <PAD>
    }
    
    while (titleIds.length < maxTitleLength) {
      titleIds.push(0);
    }
    
    return {
      url: urlIds,
      title: titleIds,
      combined: [...urlIds, ...titleIds]
    };
  }
  
  /**
   * Decode token IDs back to tokens
   */
  decode(ids) {
    return ids
      .filter(id => id !== 0) // Remove padding
      .map(id => this.idToToken[id] || '<UNK>');
  }
  
  /**
   * Get vocabulary size
   */
  size() {
    return this.idToToken.length;
  }
  
  /**
   * Save vocabulary to storage
   */
  async save() {
    await saveVocabulary({
      tokenToId: this.tokenToId,
      idToToken: this.idToToken,
      tokenCounts: this.tokenCounts,
      finalized: this.finalized,
      maxSize: this.maxSize,
      pendingTokenCounts: this.pendingTokenCounts,
      documentsProcessed: this.documentsProcessed,
      lastRefinementCheck: this.lastRefinementCheck
    });
  }
  
  /**
   * Load vocabulary from storage
   */
  static async load() {
    const data = await loadVocabulary();
    if (!data) return null;
    
    const vocab = new Vocabulary(data.metadata?.maxSize);
    vocab.tokenToId = data.tokenToId || {};
    vocab.idToToken = data.idToToken || [];
    vocab.tokenCounts = data.tokenCounts || {};
    // Only mark as finalized if we have more than just special tokens
    vocab.finalized = data.finalized !== undefined ? data.finalized : (vocab.idToToken.length > 4);
    
    // Load dynamic refinement fields
    vocab.pendingTokenCounts = data.pendingTokenCounts || {};
    vocab.documentsProcessed = data.documentsProcessed || 0;
    vocab.lastRefinementCheck = data.lastRefinementCheck || 0;
    
    return vocab;
  }
  
  /**
   * Get vocabulary statistics
   */
  getStats() {
    const tokenFreqs = Object.values(this.tokenCounts);
    const totalTokens = tokenFreqs.reduce((sum, count) => sum + count, 0);
    
    return {
      vocabSize: this.size(),
      uniqueTokens: Object.keys(this.tokenCounts).length,
      totalTokens: totalTokens,
      avgFrequency: totalTokens / this.size() || 0,
      maxFrequency: Math.max(...tokenFreqs, 0),
      minFrequency: Math.min(...tokenFreqs, 0),
      coverage: this.calculateCoverage()
    };
  }
  
  /**
   * Calculate vocabulary coverage
   */
  calculateCoverage() {
    if (!this.finalized) return 0;
    
    const vocabTokens = new Set(Object.keys(this.tokenToId));
    const allTokens = Object.keys(this.tokenCounts);
    const coveredTokens = allTokens.filter(t => vocabTokens.has(t));
    
    return coveredTokens.length / allTokens.length || 0;
  }
  
  /**
   * Get most common tokens
   */
  getMostCommon(n = 20) {
    return Object.entries(this.tokenCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([token, count]) => ({ token, count, id: this.tokenToId[token] }));
  }
  
  /**
   * Export vocabulary for analysis
   */
  export() {
    return {
      tokenToId: this.tokenToId,
      idToToken: this.idToToken,
      stats: this.getStats(),
      mostCommon: this.getMostCommon(50)
    };
  }
  
  /**
   * Get refinement status for debugging
   */
  getRefinementStatus() {
    if (!this.finalized) {
      return {
        status: 'not_finalized',
        vocabSize: this.size(),
        uniqueTokens: Object.keys(this.tokenCounts).length
      };
    }
    
    const docsSinceLastCheck = this.documentsProcessed - this.lastRefinementCheck;
    const pendingTokenCount = Object.keys(this.pendingTokenCounts).length;
    
    // Get tail frequency of current vocabulary
    const vocabTokens = Object.keys(this.tokenToId).filter(t => !['<PAD>', '<UNK>', '<URL>', '<TITLE>'].includes(t));
    const mergedCounts = { ...this.tokenCounts };
    Object.entries(this.pendingTokenCounts).forEach(([token, count]) => {
      mergedCounts[token] = (mergedCounts[token] || 0) + count;
    });
    const vocabFrequencies = vocabTokens.map(t => mergedCounts[t] || 0);
    const minVocabFrequency = Math.min(...vocabFrequencies);
    
    return {
      status: 'finalized',
      vocabSize: this.size(),
      documentsProcessed: this.documentsProcessed,
      docsSinceLastCheck: docsSinceLastCheck,
      pendingTokenCount: pendingTokenCount,
      minDocumentsForRefinement: this.minDocumentsForRefinement,
      minVocabFrequency: minVocabFrequency,
      refinementThreshold: minVocabFrequency * (1 + this.refinementThreshold),
      canRefine: docsSinceLastCheck >= this.minDocumentsForRefinement
    };
  }
}

// Cache vocabulary instance to avoid recreating it repeatedly
let vocabularyInstance = null;
let vocabularyLoadPromise = null;

/**
 * Create or load vocabulary (singleton pattern)
 */
export async function getOrCreateVocabulary() {
  // If already loading, wait for that promise
  if (vocabularyLoadPromise) {
    return vocabularyLoadPromise;
  }
  
  // If already loaded, return cached instance
  if (vocabularyInstance) {
    return vocabularyInstance;
  }
  
  // Start loading process
  vocabularyLoadPromise = (async () => {
    // Try to load existing vocabulary
    let vocab = await Vocabulary.load();
    
    if (!vocab) {
      logger.mlArchitecture('Creating new vocabulary');
      vocab = new Vocabulary();
    }
    
    vocabularyInstance = vocab;
    vocabularyLoadPromise = null;
    return vocab;
  })();
  
  return vocabularyLoadPromise;
}

/**
 * Clear vocabulary cache (for testing or reset)
 */
export function clearVocabularyCache() {
  vocabularyInstance = null;
  vocabularyLoadPromise = null;
}

/**
 * Update vocabulary with new documents
 * @param {Array} documents - Documents to add to vocabulary
 * @param {Object} options - Options for vocabulary update
 * @param {boolean} options.allowRefinement - Whether to allow vocabulary refinement (default: true)
 */
export async function updateVocabulary(documents, options = {}) {
  const vocab = await getOrCreateVocabulary();
  const { allowRefinement = true } = options;
  
  // Always add documents to update token counts
  documents.forEach(doc => {
    vocab.addDocument(doc.url, doc.title);
  });
  
  if (!vocab.finalized) {
    // Check if we have enough data to build vocabulary
    const tokenCountSize = Object.keys(vocab.tokenCounts).length;
    
    // Lower threshold to 20 tokens (was 100) to ensure vocabulary gets built
    if (tokenCountSize >= 20) {
      logger.mlArchitecture(`🔨 Building vocabulary with ${tokenCountSize} unique tokens from ${documents.length} documents`);
      const startTime = Date.now();
      vocab.buildVocabulary();
      await vocab.save();
      const buildTime = Date.now() - startTime;
      logger.mlArchitecture(`   Build completed in ${buildTime}ms`);
      // Update cached instance
      vocabularyInstance = vocab;
    } else {
      console.log(`Vocabulary not built yet. Have ${tokenCountSize} unique tokens, need at least 20`);
      // Still save the token counts so they're not lost
      await vocab.save();
      vocabularyInstance = vocab;
    }
  } else {
    // Check if vocabulary needs refinement
    if (allowRefinement && vocab.shouldRefine()) {
      const refined = vocab.refineVocabulary();
      if (refined) {
        // Clear features from training data since vocabulary token mappings changed
        const { clearTrainingDataFeatures } = await import('../storage/ml-database.js');
        await clearTrainingDataFeatures();
        
        await vocab.save();
        vocabularyInstance = vocab;
        // Vocabulary refined - model will need rebuild
      }
    } else {
      // Save to persist pending counts
      await vocab.save();
      vocabularyInstance = vocab;
    }
  }
  
  return vocab;
}

// Test function for vocabulary refinement
export async function testVocabularyRefinement() {
  
  const vocab = await getOrCreateVocabulary();
  
  // Show current status
  const status = vocab.getRefinementStatus();
  console.log(status);
  
  // Add test documents
  const testDocs = [];
  const highFreqTerms = ['dashboard', 'analytics', 'documentation', 'api', 'tutorial'];
  
  for (let i = 0; i < 150; i++) {
    const term = highFreqTerms[i % highFreqTerms.length];
    testDocs.push({
      url: `https://example.com/${term}/page${i}`,
      title: `${term} - Important Resource ${i}`
    });
  }
  
  const updatedVocab = await updateVocabulary(testDocs);
  
  const newStatus = updatedVocab.getRefinementStatus();
  console.log(newStatus);
  
  const shouldRefine = updatedVocab.shouldRefine();
  
  return {
    beforeSize: vocab.size(),
    afterSize: updatedVocab.size(),
    finalized: updatedVocab.finalized,
    shouldRefine,
    pendingCount: Object.keys(updatedVocab.pendingTokenCounts).length,
    documentsProcessed: updatedVocab.documentsProcessed
  };
}

// Add to window for testing
if (typeof window !== 'undefined') {
  window.testVocabularyRefinement = testVocabularyRefinement;
}

export default {
  Vocabulary,
  getOrCreateVocabulary,
  updateVocabulary,
  clearVocabularyCache
};