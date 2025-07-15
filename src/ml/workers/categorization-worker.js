/*
 * AI Tab Manager - Categorization Worker
 * Web Worker for background categorization
 */

// Worker state
let isProcessing = false;
let mlCategorizer = null;
let currentJob = null;
let mlEnabled = true; // Default to true, will be updated from settings
let workerSettings = null; // Store settings for ML initialization

// Module references (will be loaded dynamically)
let getMLCategorizer = null;
let extractDomain = null;

// Initialize the worker
async function handleInit(settings) {
  try {
    // Store settings for later use
    workerSettings = settings || {};
    mlEnabled = workerSettings.useML !== false;
    
    // Import helpers module (always needed)
    const urlModule = await import('../../utils/helpers.js');
    extractDomain = urlModule.extractDomain;
    
    // Import ML categorizer module but don't initialize yet
    const mlModule = await import('../categorization/ml-categorizer.js');
    getMLCategorizer = mlModule.getMLCategorizer;
    
    self.postMessage({
      type: 'INITIALIZED',
      data: { success: true, mlEnabled }
    });
  } catch (error) {
    self.postMessage({
      type: 'ERROR',
      error: error.message
    });
  }
}

// Get or initialize ML categorizer lazily
async function getOrInitMLCategorizer() {
  if (!mlCategorizer && getMLCategorizer) {
    mlCategorizer = await getMLCategorizer(true, workerSettings);
  }
  return mlCategorizer;
}

// Handle categorization request
async function handleCategorize(data, jobId) {
  if (isProcessing) {
    self.postMessage({
      type: 'ERROR',
      jobId,
      error: 'Already processing a categorization job'
    });
    return;
  }
  
  isProcessing = true;
  currentJob = jobId;
  
  try {
    const { tabs, settings, batchSize = 100 } = data;
    const results = { 0: [], 1: [], 2: [], 3: [] };
    
    // Split tabs into batches
    const batches = [];
    for (let i = 0; i < tabs.length; i += batchSize) {
      batches.push(tabs.slice(i, i + batchSize));
    }
    
    let processedCount = 0;
    
    // Process each batch
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      if (currentJob !== jobId) {
        // Job was cancelled
        break;
      }
      
      const batch = batches[batchIndex];
      
      // Send progress update
      self.postMessage({
        type: 'PROGRESS',
        jobId,
        data: {
          processed: processedCount,
          total: tabs.length,
          currentBatch: batchIndex + 1,
          totalBatches: batches.length,
          progress: processedCount / tabs.length
        }
      });
      
      // Process batch
      const processedBatch = batch.map(tab => ({
        ...tab,
        domain: extractDomain(tab.url)
      }));
      
      // Check if LLM is enabled and we need to get LLM results
      let llmResults = null;
      if (settings.useLLM) {
        const apiKey = settings.apiKeys?.[settings.provider];
        const provider = settings.provider;
        const model = settings.model || settings.selectedModels?.[provider];
        const customPrompt = settings.customPrompt;
        const savedUrls = settings.savedUrls || [];
        
        if (apiKey && provider && model) {
          // Request LLM categorization from main thread
          self.postMessage({
            type: 'LLM_REQUEST',
            jobId,
            data: {
              tabs: processedBatch,
              apiKey,
              provider,
              model,
              customPrompt,
              savedUrls
            }
          });
          
          // Wait for LLM response
          llmResults = await new Promise((resolve) => {
            const handleMessage = (event) => {
              if (event.data.type === 'LLM_RESPONSE' && event.data.jobId === jobId) {
                self.removeEventListener('message', handleMessage);
                resolve(event.data.llmResults);
              }
            };
            self.addEventListener('message', handleMessage);
            
            // Set timeout for LLM response
            setTimeout(() => {
              self.removeEventListener('message', handleMessage);
              resolve(null); // Continue without LLM if timeout
            }, 60000); // 60 second timeout for LLM
          });
        }
      }
      
      // Always use ML categorizer for consistent confidence calculation
      // It will skip TensorFlow loading if ML is disabled in settings
      const categorizer = await getOrInitMLCategorizer();
      
      // Categorize using ML categorizer (handles ensemble voting for consistent confidence)
      const mlResults = await categorizer.categorizeTabs(processedBatch, {
        rules: settings.rules || [],
        llmResults,
        useML: settings.useML !== false,
        useRules: (settings.rules?.length || 0) > 0,
        useLLM: settings.useLLM && llmResults !== null
      });
      
      // Extract categorized tabs and metadata
      const { categorized, metadata } = mlResults;
      
      // Organize results by category
      Object.entries(categorized).forEach(([category, tabs]) => {
        if (Array.isArray(tabs)) {
          tabs.forEach(tab => {
            // Get prediction metadata for this tab
            const predictionData = metadata?.[tab.id] || {};
            
            results[category].push({
              ...tab,
              category: parseInt(category),
              mlPrediction: predictionData
            });
          });
        }
      });
      
      processedCount += batch.length;
    }
    
    // Send completion
    self.postMessage({
      type: 'COMPLETE',
      jobId,
      data: {
        success: true,
        results,
        processedCount
      }
    });
    
  } catch (error) {
    self.postMessage({
      type: 'ERROR',
      jobId,
      error: error.message
    });
  } finally {
    isProcessing = false;
    currentJob = null;
  }
}

// Handle cancel request
function handleCancel(jobId) {
  if (currentJob === jobId) {
    currentJob = null;
    self.postMessage({
      type: 'CANCELLED',
      jobId
    });
  }
}

// Message handler
self.addEventListener('message', async (event) => {
  console.log('Worker received message:', event.data);
  const { type, data, jobId } = event.data;
  
  try {
    switch (type) {
      case 'INIT':
        // For INIT, we're sending settings directly, not wrapped in data
        const initData = event.data.settings || data;
        await handleInit(initData);
        break;
        
      case 'CATEGORIZE':
        await handleCategorize(data, jobId);
        break;
        
      case 'CANCEL':
        handleCancel(jobId);
        break;
        
      case 'LLM_RESPONSE':
        // This is handled by the promise listener in handleCategorize
        // Just ignore it here to avoid "unknown message type" error
        break;
        
      default:
        self.postMessage({
          type: 'ERROR',
          jobId,
          error: `Unknown message type: ${type}`
        });
    }
  } catch (error) {
    self.postMessage({
      type: 'ERROR',
      jobId,
      error: error.message
    });
  }
});