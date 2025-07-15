/*
 * AI Tab Manager - Copyright (c) 2025 AI Tech Knowledge LLC
 * Storage service for managing extension data persistence
 */

import ChromeAPIService from './ChromeAPIService.js';
import { STORAGE_KEYS } from '../utils/constants.js';

/**
 * StorageService - Manages all storage operations with type safety
 */
export class StorageService {
  
  // === Popup State ===
  
  /**
   * Save popup state
   * @param {Object} state - Popup state object
   * @returns {Promise<void>}
   */
  static async savePopupState(state) {
    return ChromeAPIService.setStorageData({
      [STORAGE_KEYS.POPUP_STATE]: state
    });
  }
  
  /**
   * Load popup state
   * @returns {Promise<Object|null>} Saved popup state or null
   */
  static async loadPopupState() {
    const data = await ChromeAPIService.getStorageData(STORAGE_KEYS.POPUP_STATE);
    return data[STORAGE_KEYS.POPUP_STATE] || null;
  }
  
  // === Settings ===
  
  /**
   * Save settings
   * @param {Object} settings - Settings object
   * @returns {Promise<void>}
   */
  static async saveSettings(settings) {
    return ChromeAPIService.setStorageData({
      [STORAGE_KEYS.SETTINGS]: settings
    });
  }
  
  /**
   * Load settings
   * @returns {Promise<Object|null>} Saved settings or null
   */
  static async loadSettings() {
    const data = await ChromeAPIService.getStorageData(STORAGE_KEYS.SETTINGS);
    return data[STORAGE_KEYS.SETTINGS] || null;
  }
  
  /**
   * Update specific setting
   * @param {string} key - Setting key
   * @param {any} value - Setting value
   * @returns {Promise<void>}
   */
  static async updateSetting(key, value) {
    const settings = await this.loadSettings() || {};
    settings[key] = value;
    return this.saveSettings(settings);
  }
  
  // === Theme ===
  
  /**
   * Save theme preference
   * @param {string} theme - Theme name
   * @returns {Promise<void>}
   */
  static async saveTheme(theme) {
    return ChromeAPIService.setStorageData({
      [STORAGE_KEYS.THEME]: theme
    });
  }
  
  /**
   * Load theme preference
   * @returns {Promise<string>} Theme name or 'system'
   */
  static async loadTheme() {
    const data = await ChromeAPIService.getStorageData(STORAGE_KEYS.THEME);
    return data[STORAGE_KEYS.THEME] || 'system';
  }
  
  // === API Keys ===
  
  /**
   * Save API key for a provider (with basic obfuscation)
   * @param {string} provider - Provider name
   * @param {string} apiKey - API key
   * @returns {Promise<void>}
   */
  static async saveApiKey(provider, apiKey) {
    // Basic obfuscation (not real encryption)
    const obfuscated = btoa(apiKey).split('').reverse().join('');
    const settings = await this.loadSettings() || {};
    
    if (!settings.apiKeys) settings.apiKeys = {};
    settings.apiKeys[provider] = obfuscated;
    
    return this.saveSettings(settings);
  }
  
  /**
   * Load API key for a provider
   * @param {string} provider - Provider name
   * @returns {Promise<string|null>} API key or null
   */
  static async loadApiKey(provider) {
    const settings = await this.loadSettings();
    if (!settings || !settings.apiKeys || !settings.apiKeys[provider]) {
      return null;
    }
    
    // Deobfuscate
    try {
      const obfuscated = settings.apiKeys[provider];
      return atob(obfuscated.split('').reverse().join(''));
    } catch (error) {
      console.error('Error deobfuscating API key:', error);
      return null;
    }
  }
  
  // === Custom Prompt ===
  
  /**
   * Save custom prompt
   * @param {string} prompt - Custom prompt
   * @param {boolean} isCustomized - Whether prompt is customized
   * @returns {Promise<void>}
   */
  static async saveCustomPrompt(prompt, isCustomized = true) {
    const settings = await this.loadSettings() || {};
    settings.customPrompt = prompt;
    settings.isPromptCustomized = isCustomized;
    return this.saveSettings(settings);
  }
  
  /**
   * Load custom prompt
   * @returns {Promise<Object>} { prompt, isCustomized }
   */
  static async loadCustomPrompt() {
    const settings = await this.loadSettings();
    return {
      prompt: settings?.customPrompt || null,
      isCustomized: settings?.isPromptCustomized || false
    };
  }
  
  // === Utility Methods ===
  
  /**
   * Clear all storage
   * @returns {Promise<void>}
   */
  static async clearAll() {
    return ChromeAPIService.clearStorage();
  }
  
  /**
   * Export all storage data
   * @returns {Promise<Object>} All storage data
   */
  static async exportAll() {
    return ChromeAPIService.getStorageData(null);
  }
  
  /**
   * Import storage data
   * @param {Object} data - Data to import
   * @returns {Promise<void>}
   */
  static async importAll(data) {
    return ChromeAPIService.setStorageData(data);
  }
  
  /**
   * Get storage size info
   * @returns {Promise<Object>} { bytesInUse, quota }
   */
  static async getStorageInfo() {
    return new Promise((resolve) => {
      browser.storage.local.getBytesInUse(null, (bytesInUse) => {
        // Chrome local storage quota is usually 10MB
        const quota = browser.storage.local.QUOTA_BYTES || 10485760;
        resolve({
          bytesInUse,
          quota,
          percentUsed: (bytesInUse / quota * 100).toFixed(2)
        });
      });
    });
  }
}

// Export as default as well
export default StorageService;