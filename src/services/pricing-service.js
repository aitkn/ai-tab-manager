/**
 * Pricing Service - Provides LLM model pricing information
 */

class PricingService {
  constructor() {
    this.pricingData = null;
    this.loadPromise = null;
  }

  /**
   * Load pricing data from JSON file
   */
  async loadPricingData() {
    if (this.pricingData) {
      return this.pricingData;
    }

    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = fetch(chrome.runtime.getURL('src/data/llm-pricing.json'))
      .then(response => response.json())
      .then(data => {
        this.pricingData = data;
        return data;
      })
      .catch(error => {
        console.error('Failed to load pricing data:', error);
        this.pricingData = {};
        return {};
      });

    return this.loadPromise;
  }

  /**
   * Get pricing for a specific model
   * @param {string} provider - Provider key (e.g., 'openai', 'anthropic')
   * @param {string} modelId - Model ID
   * @returns {Object|null} Pricing object with input/output prices or null
   */
  async getModelPricing(provider, modelId) {
    const data = await this.loadPricingData();
    
    // Map provider names to pricing data keys
    const providerMap = {
      'claude': 'anthropic',
      'openai': 'openai',
      'gemini': 'google',
      'deepseek': 'deepseek',
      'grok': 'xai'
    };
    
    // Get the pricing key for this provider
    const pricingKey = providerMap[provider.toLowerCase()] || provider.toLowerCase();
    
    if (!data[pricingKey] || !data[pricingKey].models) {
      return null;
    }

    // Try exact match first
    if (data[pricingKey].models[modelId]) {
      return data[pricingKey].models[modelId];
    }

    // Try case-insensitive match
    const modelIdLower = modelId.toLowerCase();
    for (const [key, value] of Object.entries(data[pricingKey].models)) {
      if (key.toLowerCase() === modelIdLower) {
        return value;
      }
    }
    
    // For OpenAI, try converting display name back to ID format
    // e.g., "Gpt 4o Mini 2024 07 18" -> "gpt-4o-mini-2024-07-18"
    if (pricingKey === 'openai' && modelId.includes(' ')) {
      const convertedId = modelId.toLowerCase().replace(/\s+/g, '-');
      if (data[pricingKey].models[convertedId]) {
        return data[pricingKey].models[convertedId];
      }
    }

    // Try partial match (for models with version suffixes)
    // Sort by length descending to match the most specific model first
    const sortedModels = Object.entries(data[pricingKey].models)
      .sort(([a], [b]) => b.length - a.length);
    
    for (const [key, value] of sortedModels) {
      const keyLower = key.toLowerCase();
      
      // For Gemini models, be more careful about version matching
      if (pricingKey === 'google') {
        // Extract base model name and version from both strings
        // e.g., "gemini-2.5-flash" from "gemini-2.5-flash-preview-04-17"
        const modelParts = modelIdLower.split('-');
        const keyParts = keyLower.split('-');
        
        // Check if model name and version match (first 3 parts typically)
        if (modelParts.length >= 3 && keyParts.length >= 3) {
          const modelBase = modelParts.slice(0, 3).join('-');
          const keyBase = keyParts.slice(0, 3).join('-');
          if (modelBase === keyBase) {
            return value;
          }
        }
      }
      
      // For OpenAI, handle short names like "gpt-4.1" that should match "gpt-4.1-2025-04-14"
      if (pricingKey === 'openai') {
        // Check if the key starts with the model ID followed by a date pattern
        if (keyLower.startsWith(modelIdLower + '-20')) {
          return value;
        }
        
        // Also try removing common suffixes from the input model ID
        const modelWithoutSuffix = modelIdLower
          .replace(/-preview$/, '')
          .replace(/-latest$/, '');
        if (keyLower.startsWith(modelWithoutSuffix + '-20')) {
          return value;
        }
      }
      
      // General matching for other providers
      if (modelIdLower.startsWith(keyLower)) {
        return value;
      }
    }

    return null;
  }

  /**
   * Calculate cost for given token counts
   * @param {Object} pricing - Pricing object with input/output prices
   * @param {number} inputTokens - Number of input tokens (default 10K)
   * @param {number} outputTokens - Number of output tokens (default 500)
   * @returns {number} Total cost in dollars
   */
  calculateCost(pricing, inputTokens = 10000, outputTokens = 500) {
    if (!pricing || !pricing.input || !pricing.output) {
      return 0;
    }

    return (inputTokens / 1_000_000) * pricing.input + 
           (outputTokens / 1_000_000) * pricing.output;
  }

  /**
   * Format price for display
   * @param {number} price - Price in dollars
   * @returns {string} Formatted price string
   */
  formatPrice(price) {
    if (price === 0) return 'Free';
    if (price < 0.001) {
      // For very small prices, show more decimal places
      return `${(price * 100).toFixed(2)}¢`;
    }
    if (price < 1) return `${(price * 100).toFixed(1)}¢`;
    return `$${price.toFixed(2)}`;
  }

  /**
   * Get formatted pricing string for dropdown display
   * @param {string} provider - Provider key
   * @param {string} modelNameOrId - Model name or ID to try matching
   * @param {string} alternateId - Optional alternate ID to try (e.g., model.id when name is primary)
   * @returns {string} Formatted pricing string or empty string
   */
  async getPricingDisplay(provider, modelNameOrId, alternateId = null) {
    // Try primary identifier first
    let pricing = await this.getModelPricing(provider, modelNameOrId);
    
    // If not found and we have an alternate ID, try that
    if (!pricing && alternateId) {
      pricing = await this.getModelPricing(provider, alternateId);
    }
    
    if (!pricing) return ' - ?';

    const cost = this.calculateCost(pricing);
    return ` - ${this.formatPrice(cost)}`;
  }

  /**
   * Get all pricing data
   * @returns {Object} All pricing data
   */
  async getAllPricingData() {
    return await this.loadPricingData();
  }

  /**
   * Get the scraped date for a provider
   * @param {string} provider - Provider key
   * @returns {string|null} Scraped date or null
   */
  async getScrapedDate(provider) {
    const data = await this.loadPricingData();
    
    // Map provider names to pricing data keys
    const providerMap = {
      'claude': 'anthropic',
      'openai': 'openai',
      'gemini': 'google',
      'deepseek': 'deepseek',
      'grok': 'xai'
    };
    
    const pricingKey = providerMap[provider.toLowerCase()] || provider.toLowerCase();
    
    if (data[pricingKey] && data[pricingKey].scraped_at) {
      return data[pricingKey].scraped_at;
    }
    
    return null;
  }
}

// Export singleton instance
export const pricingService = new PricingService();