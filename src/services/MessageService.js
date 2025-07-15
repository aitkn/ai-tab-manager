/*
 * AI Tab Manager - Copyright (c) 2025 AI Tech Knowledge LLC
 * Message service for background script communication
 */

import ChromeAPIService from './ChromeAPIService.js';

/**
 * MessageService - Handles all communication with background script
 */
export class MessageService {
  
  /**
   * Test background script connection
   * @returns {Promise<Object>} Status response
   */
  static async testConnection() {
    return ChromeAPIService.sendMessage({ action: 'test' });
  }
  
  /**
   * Categorize tabs using LLM
   * @param {Object} params - Categorization parameters
   * @param {Array} params.tabs - Tabs to categorize
   * @param {string} params.apiKey - API key
   * @param {string} params.provider - LLM provider
   * @param {string} params.model - Model name
   * @param {string} params.customPrompt - Custom prompt (optional)
   * @param {Array} params.savedUrls - Already saved URLs to exclude
   * @returns {Promise<Object>} Categorized tabs
   */
  static async categorizeTabs({ tabs, apiKey, provider, model, customPrompt, savedUrls = [] }) {
    const response = await ChromeAPIService.sendMessage({
      action: 'categorizeTabs',
      data: {
        tabs,
        apiKey,
        provider,
        model,
        customPrompt,
        savedUrls
      }
    });
    
    if (!response.success) {
      throw new Error(response.error || 'Categorization failed');
    }
    
    return response.data;
  }
  
  /**
   * Fetch available models for a provider
   * @param {string} provider - Provider name
   * @param {string} apiKey - API key
   * @returns {Promise<Array>} Available models
   */
  static async fetchModels(provider, apiKey) {
    const response = await ChromeAPIService.sendMessage({
      action: 'fetchModels',
      data: { provider, apiKey }
    });
    
    // Return the full response object so the caller can handle it
    return response;
  }
  
  /**
   * Open multiple tabs with rate limiting
   * @param {Array<string>} urls - URLs to open
   * @returns {Promise<Object>} Result with count
   */
  static async openMultipleTabs(urls) {
    const response = await ChromeAPIService.sendMessage({
      action: 'openMultipleTabs',
      data: { urls }
    });
    
    if (!response.success) {
      throw new Error(response.error || 'Failed to open tabs');
    }
    
    return response;
  }
  
  /**
   * Generic message sender with timeout
   * @param {string} action - Action name
   * @param {Object} data - Data to send
   * @param {number} timeout - Timeout in milliseconds
   * @returns {Promise<any>} Response
   */
  static async send(action, data = {}, timeout = 30000) {
    return Promise.race([
      ChromeAPIService.sendMessage({ action, data }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Request timeout')), timeout)
      )
    ]);
  }
}

// Export as default as well
export default MessageService;