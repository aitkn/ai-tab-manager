/*
 * AI Tab Manager - Copyright (c) 2025 AI Tech Knowledge LLC
 * Google Drive Sync Service - handles data synchronization across browsers
 */

import logger from '../utils/logger.js';

/**
 * GoogleDriveSyncService - Manages data synchronization via Google Drive
 * Uses Chrome Identity API for authentication and Google Drive API for storage
 */
// Add service sync logging method to logger
logger.serviceSync = logger.serviceSync || function(message, ...args) {
  if (logger.isEnabled('services.sync')) {
    console.log(`[Services:Sync] ${message}`, ...args);
  }
};

export class GoogleDriveSyncService {
  static SYNC_FILE_NAME = 'ai-tab-manager-sync.json';
  static SYNC_VERSION = '1.0';
  static SYNC_DELAY_MS = 5000; // 5 seconds after last change
  static RETRY_DELAYS = [1000, 2000, 4000, 8000]; // Exponential backoff
  
  constructor() {
    this.syncTimer = null;
    this.isSyncing = false;
    this.lastSyncTime = null;
    this.deviceId = this.generateDeviceId();
    this.retryCount = 0;
    this.syncEnabled = false;
    this.authToken = null;
    this.tokenExpiryTime = null;
  }
  
  /**
   * Initialize the sync service
   * @param {Object} options - Sync options
   * @param {boolean} options.enabled - Whether sync is enabled
   * @param {Function} options.onSyncStart - Callback when sync starts
   * @param {Function} options.onSyncComplete - Callback when sync completes
   * @param {Function} options.onSyncError - Callback on sync error
   */
  async initialize(options = {}) {
    this.syncEnabled = options.enabled || false;
    this.onSyncStart = options.onSyncStart || (() => {});
    this.onSyncComplete = options.onSyncComplete || (() => {});
    this.onSyncError = options.onSyncError || (() => {});
    
    if (this.syncEnabled) {
      logger.serviceSync('🔄 Sync service initialized', { deviceId: this.deviceId });
    }
  }
  
  /**
   * Enable or disable sync
   * @param {boolean} enabled - Whether to enable sync
   */
  setSyncEnabled(enabled) {
    this.syncEnabled = enabled;
    if (!enabled) {
      this.cancelPendingSync();
    }
    logger.serviceSync(`🔄 Sync ${enabled ? 'enabled' : 'disabled'}`);
  }
  
  /**
   * Schedule a sync operation after a delay
   * Resets the timer if called again before sync occurs
   */
  scheduleSyncAfterChange() {
    if (!this.syncEnabled || this.isSyncing) {
      return;
    }
    
    // Cancel any pending sync
    this.cancelPendingSync();
    
    // Schedule new sync
    this.syncTimer = setTimeout(() => {
      this.performSync().catch(error => {
        logger.serviceSync('❌ Sync error:', error);
        this.onSyncError(error);
      });
    }, GoogleDriveSyncService.SYNC_DELAY_MS);
    
    logger.serviceSync('⏱️ Sync scheduled in 5 seconds');
  }
  
  /**
   * Cancel any pending sync operation
   */
  cancelPendingSync() {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
      logger.serviceSync('🚫 Pending sync cancelled');
    }
  }
  
  /**
   * Perform immediate sync
   */
  async syncNow() {
    if (!this.syncEnabled) {
      throw new Error('Sync is not enabled');
    }
    
    this.cancelPendingSync();
    return this.performSync();
  }
  
  /**
   * Main sync operation
   */
  async performSync() {
    if (this.isSyncing) {
      logger.serviceSync('⚠️ Sync already in progress');
      return;
    }
    
    this.isSyncing = true;
    this.onSyncStart();
    
    try {
      logger.serviceSync('🔄 Starting sync operation');
      
      // Get auth token
      const token = await this.getAuthToken();
      
      // Get local data
      const localData = await this.getLocalSyncData();
      
      // Download remote data
      const remoteData = await this.downloadSyncData(token);
      
      // Merge data
      const mergedData = await this.mergeData(localData, remoteData);
      
      // Upload merged data
      await this.uploadSyncData(token, mergedData);
      
      // Update local database with merged data
      await this.updateLocalData(mergedData, localData);
      
      this.lastSyncTime = Date.now();
      this.retryCount = 0;
      
      logger.serviceSync('✅ Sync completed successfully');
      this.onSyncComplete({
        lastSyncTime: this.lastSyncTime,
        itemsSynced: mergedData.tabs.length
      });
      
    } catch (error) {
      logger.serviceSync('❌ Sync failed:', error);
      
      // Handle retry logic
      if (this.retryCount < GoogleDriveSyncService.RETRY_DELAYS.length) {
        const retryDelay = GoogleDriveSyncService.RETRY_DELAYS[this.retryCount];
        this.retryCount++;
        logger.serviceSync(`🔄 Retrying sync in ${retryDelay}ms (attempt ${this.retryCount})`);
        
        setTimeout(() => {
          this.performSync().catch(err => {
            logger.serviceSync('❌ Retry failed:', err);
            this.onSyncError(err);
          });
        }, retryDelay);
      } else {
        this.retryCount = 0;
        this.onSyncError(error);
      }
      
      throw error;
    } finally {
      this.isSyncing = false;
    }
  }
  
  /**
   * Get authentication token
   */
  async getAuthToken() {
    // Check if we have a valid cached token
    if (this.authToken && this.tokenExpiryTime && Date.now() < this.tokenExpiryTime) {
      return this.authToken;
    }
    
    return new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: true }, async (token) => {
        if (chrome.runtime.lastError) {
          const errorMessage = chrome.runtime.lastError.message;
          
          // If bad client ID error, provide helpful guidance
          if (errorMessage.includes('bad client id')) {
            const helpMessage = `OAuth Error: ${errorMessage}\n\n` +
              `This error occurs because Chrome extensions require a stable extension ID for OAuth.\n\n` +
              `To fix this:\n` +
              `1. Upload your extension to Chrome Web Store as a draft\n` +
              `2. Copy the public key from the Package section\n` +
              `3. Add "key": "<public-key>" to manifest.json\n` +
              `4. Reload the extension\n\n` +
              `Alternative: Use manual Google API key authentication instead of Chrome Identity API`;
            
            logger.serviceSync('❌ ' + helpMessage);
            reject(new Error(helpMessage));
            return;
          }
          
          // If access denied error, guide user to add test users
          if (errorMessage.includes('access_denied') || errorMessage.includes('403')) {
            const helpMessage = `OAuth Error: ${errorMessage}\n\n` +
              `The OAuth app is in testing mode and needs your email added as a test user.\n\n` +
              `To fix this:\n` +
              `1. Go to Google Cloud Console (console.cloud.google.com)\n` +
              `2. Select your project\n` +
              `3. Go to APIs & Services > OAuth consent screen\n` +
              `4. Scroll to "Test users" section\n` +
              `5. Click "ADD USERS"\n` +
              `6. Add your Google account email\n` +
              `7. Save and try sync again`;
            
            logger.serviceSync('❌ ' + helpMessage);
            reject(new Error(errorMessage)); // Keep original for UI
            return;
          }
          
          reject(new Error(errorMessage));
          return;
        }
        
        this.authToken = token;
        // Tokens typically expire in 1 hour, cache for 50 minutes
        this.tokenExpiryTime = Date.now() + (50 * 60 * 1000);
        resolve(token);
      });
    });
  }
  
  /**
   * Clear cached auth token (useful for retry after 401)
   */
  async clearAuthToken(token) {
    return new Promise((resolve) => {
      chrome.identity.removeCachedAuthToken({ token }, () => {
        this.authToken = null;
        this.tokenExpiryTime = null;
        resolve();
      });
    });
  }
  
  /**
   * Get local data for sync
   */
  async getLocalSyncData() {
    // Get all saved tabs (categories 1-3)
    const allTabs = await window.tabDatabase.getAllSavedTabs();
    
    // Get settings (excluding sensitive data)
    const settings = await this.getSyncableSettings();
    
    return {
      version: GoogleDriveSyncService.SYNC_VERSION,
      deviceId: this.deviceId,
      lastModified: Date.now(),
      tabs: allTabs,
      settings: settings
    };
  }
  
  /**
   * Get settings that should be synced (excluding API keys)
   */
  async getSyncableSettings() {
    const settings = await chrome.storage.local.get(['settings']);
    const syncableSettings = { ...settings.settings };
    
    // Remove sensitive data
    delete syncableSettings.apiKeys;
    
    return syncableSettings;
  }
  
  /**
   * Download sync data from Google Drive
   */
  async downloadSyncData(token) {
    try {
      // First, find the sync file
      const fileId = await this.findSyncFile(token);
      
      if (!fileId) {
        logger.serviceSync('📄 No sync file found, this is the first sync');
        return null;
      }
      
      // Download the file content
      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );
      
      if (!response.ok) {
        if (response.status === 401) {
          // Token expired, clear it and retry
          await this.clearAuthToken(token);
          throw new Error('Authentication expired, please try again');
        }
        throw new Error(`Failed to download sync data: ${response.status}`);
      }
      
      const data = await response.json();
      logger.serviceSync('📥 Downloaded sync data', { 
        tabs: data.tabs?.length || 0,
        lastModified: new Date(data.lastModified).toISOString()
      });
      
      return data;
      
    } catch (error) {
      logger.serviceSync('⚠️ Error downloading sync data:', error);
      throw error;
    }
  }
  
  /**
   * Find the sync file in Google Drive app data folder
   */
  async findSyncFile(token) {
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files?` +
      `q=name='${GoogleDriveSyncService.SYNC_FILE_NAME}'&` +
      `spaces=appDataFolder&` +
      `fields=files(id,name,modifiedTime)`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    
    if (!response.ok) {
      throw new Error(`Failed to search for sync file: ${response.status}`);
    }
    
    const data = await response.json();
    return data.files && data.files.length > 0 ? data.files[0].id : null;
  }
  
  /**
   * Upload sync data to Google Drive
   */
  async uploadSyncData(token, data) {
    try {
      // Find existing file or create new
      let fileId = await this.findSyncFile(token);
      
      const metadata = {
        name: GoogleDriveSyncService.SYNC_FILE_NAME,
        mimeType: 'application/json'
      };
      
      if (!fileId) {
        // Create new file in app data folder
        metadata.parents = ['appDataFolder'];
      }
      
      // Prepare multipart upload
      const boundary = '-------314159265358979323846';
      const delimiter = "\r\n--" + boundary + "\r\n";
      const close_delim = "\r\n--" + boundary + "--";
      
      const multipartRequestBody =
        delimiter +
        'Content-Type: application/json\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        'Content-Type: application/json\r\n\r\n' +
        JSON.stringify(data) +
        close_delim;
      
      const url = fileId
        ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`
        : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
      
      const response = await fetch(url, {
        method: fileId ? 'PATCH' : 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'multipart/related; boundary="' + boundary + '"'
        },
        body: multipartRequestBody
      });
      
      if (!response.ok) {
        throw new Error(`Failed to upload sync data: ${response.status}`);
      }
      
      logger.serviceSync('📤 Uploaded sync data', { 
        tabs: data.tabs.length,
        fileId: fileId || 'new'
      });
      
    } catch (error) {
      logger.serviceSync('❌ Error uploading sync data:', error);
      throw error;
    }
  }
  
  /**
   * Merge local and remote data
   */
  async mergeData(localData, remoteData) {
    if (!remoteData) {
      // First sync, just return local data
      return localData;
    }
    
    logger.serviceSync('🔀 Merging data', {
      local: { tabs: localData.tabs.length },
      remote: { tabs: remoteData.tabs.length }
    });
    
    // Create maps for efficient lookup
    const localTabsMap = new Map(localData.tabs.map(tab => [tab.url, tab]));
    const remoteTabsMap = new Map(remoteData.tabs.map(tab => [tab.url, tab]));
    const mergedTabsMap = new Map();
    
    // Process all unique URLs
    const allUrls = new Set([...localTabsMap.keys(), ...remoteTabsMap.keys()]);
    
    for (const url of allUrls) {
      const localTab = localTabsMap.get(url);
      const remoteTab = remoteTabsMap.get(url);
      
      if (!localTab) {
        // Only in remote
        mergedTabsMap.set(url, remoteTab);
      } else if (!remoteTab) {
        // Only in local
        mergedTabsMap.set(url, localTab);
      } else {
        // In both - use last modified
        const localModified = new Date(localTab.lastCategorized || localTab.savedDate).getTime();
        const remoteModified = new Date(remoteTab.lastCategorized || remoteTab.savedDate).getTime();
        
        if (localModified >= remoteModified) {
          mergedTabsMap.set(url, localTab);
        } else {
          mergedTabsMap.set(url, remoteTab);
        }
      }
    }
    
    // Merge settings (local takes precedence for non-synced items)
    const mergedSettings = {
      ...remoteData.settings,
      ...localData.settings
    };
    
    const mergedData = {
      version: GoogleDriveSyncService.SYNC_VERSION,
      deviceId: this.deviceId,
      lastModified: Date.now(),
      tabs: Array.from(mergedTabsMap.values()),
      settings: mergedSettings
    };
    
    logger.serviceSync('✅ Merge complete', { 
      merged: mergedData.tabs.length,
      added: mergedData.tabs.length - localData.tabs.length
    });
    
    return mergedData;
  }
  
  /**
   * Update local database with merged data
   */
  async updateLocalData(mergedData, localData) {
    // Create set of local URLs for comparison
    const localUrls = new Set(localData.tabs.map(tab => tab.url));
    
    // Find new tabs from remote
    const newTabs = mergedData.tabs.filter(tab => !localUrls.has(tab.url));
    
    if (newTabs.length === 0) {
      logger.serviceSync('📊 No new tabs to add from sync');
      return;
    }
    
    logger.serviceSync('💾 Adding new tabs from sync', { count: newTabs.length });
    
    // Group tabs by category for batch saving
    const categorizedTabs = {
      0: [],
      1: [],
      2: [],
      3: []
    };
    
    for (const tab of newTabs) {
      const category = tab.category || 0;
      if (categorizedTabs[category]) {
        categorizedTabs[category].push(tab);
      }
    }
    
    // Save new tabs using the unified database service
    const { getUnifiedDatabase } = await import('../services/UnifiedDatabaseService.js');
    const unifiedDB = await getUnifiedDatabase();
    
    await unifiedDB.saveCategorizedTabs(categorizedTabs, {
      source: 'google_drive_sync',
      savedAt: Date.now()
    });
    
    // Update syncable settings
    if (mergedData.settings) {
      const currentSettings = await chrome.storage.local.get(['settings']);
      const updatedSettings = {
        ...currentSettings.settings,
        ...mergedData.settings,
        // Preserve local API keys
        apiKeys: currentSettings.settings?.apiKeys || {}
      };
      await chrome.storage.local.set({ settings: updatedSettings });
    }
  }
  
  /**
   * Generate a unique device ID
   */
  generateDeviceId() {
    // Check if we have a stored device ID
    const stored = localStorage.getItem('syncDeviceId');
    if (stored) {
      return stored;
    }
    
    // Generate new device ID
    const id = `device-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem('syncDeviceId', id);
    return id;
  }
  
  /**
   * Get sync status information
   */
  getSyncStatus() {
    return {
      enabled: this.syncEnabled,
      isSyncing: this.isSyncing,
      lastSyncTime: this.lastSyncTime,
      deviceId: this.deviceId,
      hasPendingSync: !!this.syncTimer
    };
  }
}

// Export singleton instance
export const googleDriveSyncService = new GoogleDriveSyncService();

// Also export class for testing
export default GoogleDriveSyncService;