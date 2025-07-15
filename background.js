/*
 * AI Tab Manager - Copyright (c) 2025 AI Tech Knowledge LLC
 * Proprietary License - See LICENSE file
 * support@aitkn.com
 */

// Background service worker for handling API calls

// For Firefox: database.js and config.js are loaded via manifest
// For Chrome: they're loaded via importScripts in background-wrapper.js

// Remove state storage - popup will fetch data directly
// Background only handles API calls and message passing


// TabTracker class for managing tab state in background
class TabTracker {
  constructor() {
    this.ports = new Set(); // Connected popup ports
    this.isInitialized = false;
    this.initPromise = null;
  }

  async init() {
    if (this.initPromise) return this.initPromise;
    
    this.initPromise = (async () => {
      try {
        // Wait for database to be ready
        await globalThis.tabDatabase.init();
        
        // Setup event listeners
        this.setupListeners();
        
        // Initial sync with current tabs
        await this.syncCurrentTabs();
        
        this.isInitialized = true;
        // TabTracker initialized successfully - silent for clean console
      } catch (error) {
        console.error('Failed to initialize TabTracker:', error);
        throw error;
      }
    })();
    
    return this.initPromise;
  }

  setupListeners() {
    // Tab lifecycle events
    browser.tabs.onCreated.addListener(this.handleTabCreated.bind(this));
    browser.tabs.onRemoved.addListener(this.handleTabRemoved.bind(this));
    browser.tabs.onUpdated.addListener(this.handleTabUpdated.bind(this));
    browser.tabs.onActivated.addListener(this.handleTabActivated.bind(this));
    
    // Window events
    browser.windows.onRemoved.addListener(this.handleWindowRemoved.bind(this));
    
    // Popup connection
    browser.runtime.onConnect.addListener(this.handlePopupConnect.bind(this));
  }

  async handleTabCreated(tab) {
    if (!tab.url || tab.url === 'chrome://newtab/') return;
    
    try {
      const tabData = {
        url: tab.url,
        title: tab.title || '',
        favicon: tab.favIconUrl || '',
        tabId: tab.id,
        windowId: tab.windowId
      };
      
      await globalThis.tabDatabase.getOrCreateCurrentTab(tabData);
      
      // Broadcast to connected popups
      this.broadcastToPopups('tabCreated', { tab });
    } catch (error) {
      console.error('Error handling tab created:', error);
    }
  }

  async handleTabRemoved(tabId, removeInfo) {
    try {
      // Find the tab in currentTabs by ID
      const currentTab = await globalThis.tabDatabase.findCurrentTabByTabId(tabId);
      
      if (currentTab) {
        await globalThis.tabDatabase.removeTabFromCurrentTab(currentTab.url, tabId);
      }
      
      // Broadcast to connected popups
      this.broadcastToPopups('tabRemoved', { tabId, windowId: removeInfo.windowId });
    } catch (error) {
      console.error('Error handling tab removed:', error);
    }
  }

  async handleTabUpdated(tabId, changeInfo, tab) {
    // Check if this is an audio state change
    const isAudioChange = changeInfo.hasOwnProperty('audible') || changeInfo.hasOwnProperty('mutedInfo');
    
    // Only care about URL changes, initial load, or audio state changes
    if (!changeInfo.url && changeInfo.status !== 'complete' && !isAudioChange) return;
    
    try {
      if (changeInfo.url) {
        // URL changed - need to handle old and new URL
        const oldTab = await globalThis.tabDatabase.findCurrentTabByTabId(tabId);
        
        if (oldTab) {
          // Remove from old URL
          await globalThis.tabDatabase.removeTabFromCurrentTab(oldTab.url, tabId);
        }
        
        // Add to new URL
        const tabData = {
          url: tab.url,
          title: tab.title || '',
          favicon: tab.favIconUrl || '',
          tabId: tab.id,
          windowId: tab.windowId
        };
        
        await globalThis.tabDatabase.getOrCreateCurrentTab(tabData);
      } else if (changeInfo.status === 'complete') {
        // Just update title/favicon if needed
        const tabData = {
          url: tab.url,
          title: tab.title || '',
          favicon: tab.favIconUrl || '',
          tabId: tab.id,
          windowId: tab.windowId
        };
        
        await globalThis.tabDatabase.getOrCreateCurrentTab(tabData);
      }
      
      
      // Broadcast to connected popups
      this.broadcastToPopups('tabUpdated', { tabId, changeInfo, tab });
    } catch (error) {
      console.error('Error handling tab updated:', error);
    }
  }

  async handleTabActivated(activeInfo) {
    try {
      // Get the tab details
      let tab;
      try {
        tab = await browser.tabs.get(activeInfo.tabId);
      } catch (error) {
        // Tab doesn't exist anymore (was closed)
        // This can happen if tab is closed immediately after being activated
        // Tab no longer exists - silent for clean console
        return;
      }
      
      if (tab.url) {
        // Update lastAccessed for this tab
        const tabData = {
          url: tab.url,
          title: tab.title || '',
          favicon: tab.favIconUrl || '',
          tabId: tab.id,
          windowId: tab.windowId
        };
        
        await globalThis.tabDatabase.getOrCreateCurrentTab(tabData);
      }
      
      // Broadcast to connected popups
      this.broadcastToPopups('tabActivated', activeInfo);
    } catch (error) {
      console.error('Error handling tab activated:', error);
    }
  }

  async handleWindowRemoved(windowId) {
    try {
      // Remove all tabs from this window
      await globalThis.tabDatabase.removeWindowFromCurrentTabs(windowId);
      
      // Broadcast to connected popups
      this.broadcastToPopups('windowRemoved', { windowId });
    } catch (error) {
      console.error('Error handling window removed:', error);
    }
  }

  async handlePopupConnect(port) {
    if (port.name !== 'popup-background') return;
    
    // Popup connected - silent for clean console
    this.ports.add(port);
    
    // Send current state when popup connects
    try {
      const currentTabs = await globalThis.tabDatabase.getAllCurrentTabs();
      port.postMessage({ 
        type: 'fullState', 
        data: { currentTabs },
        timestamp: Date.now() 
      });
    } catch (error) {
      console.error('Error sending initial state:', error);
    }
    
    port.onDisconnect.addListener(() => {
      // Popup disconnected - silent for clean console
      this.ports.delete(port);
    });
  }

  broadcastToPopups(eventType, data) {
    const message = { 
      type: eventType, 
      data, 
      timestamp: Date.now() 
    };
    
    // Send to all connected popups
    for (const port of this.ports) {
      try {
        port.postMessage(message);
      } catch (error) {
        // Port disconnected, remove it
        this.ports.delete(port);
      }
    }
  }

  async syncCurrentTabs() {
    try {
      // Get all current tabs from browser
      const tabs = await browser.tabs.query({});
      
      // Don't clear existing data - just sync what's currently open
      // This preserves temporal data across browser restarts
      
      // Process all current tabs
      for (const tab of tabs) {
        if (!tab.url || tab.url === 'chrome://newtab/') continue;
        
        const tabData = {
          url: tab.url,
          title: tab.title || '',
          favicon: tab.favIconUrl || '',
          tabId: tab.id,
          windowId: tab.windowId
        };
        
        // This will preserve firstOpened if record exists
        await globalThis.tabDatabase.getOrCreateCurrentTab(tabData);
      }
      
      console.log('🔍 DEBUG_TEMPORAL: Synced', tabs.length, 'tabs - preserved existing temporal data');
    } catch (error) {
      console.error('Error syncing current tabs:', error);
    }
  }
}

// Create global tab tracker instance
const tabTracker = new TabTracker();

// Initialize database and tab tracker
async function initializeBackground() {
  try {
    // Initialize tab tracker (which also initializes database)
    await tabTracker.init();
    // Background initialization complete - silent for clean console
  } catch (error) {
    console.error('Background: Error during initialization:', error);
  }
}

// Start initialization
initializeBackground();

// Shared function to extract JSON from LLM responses
function extractJSONFromResponse(content, providerName) {
  // Extract JSON from response
  let categorization;
  try {
    // Clean the content first - remove any potential whitespace or newlines
    const cleanedContent = content.trim();
    
    // Try to parse the entire response as JSON first
    categorization = JSON.parse(cleanedContent);
  } catch (e) {
    
    // Method 1: Try to find JSON object boundaries
    const firstBrace = content.indexOf('{');
    const lastBrace = content.lastIndexOf('}');
    
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const jsonString = content.substring(firstBrace, lastBrace + 1).trim();
      
      try {
        categorization = JSON.parse(jsonString);
      } catch (parseError) {
        console.error('Failed to parse extracted JSON:', parseError.message);
        
        // Method 2: Try line-by-line parsing for potential formatting issues
        try {
          // Remove any markdown code blocks if present
          const cleanJson = jsonString
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/\s*```$/i, '')
            .trim();
          
          categorization = JSON.parse(cleanJson);
        } catch (cleanError) {
          console.error('All parsing methods failed');
          console.error('First 500 chars of extracted string:', jsonString.substring(0, 500));
          console.error('Last 100 chars of extracted string:', jsonString.substring(jsonString.length - 100));
          throw new Error(`Invalid JSON in ${providerName} response`);
        }
      }
    } else {
      throw new Error(`No JSON object found in ${providerName} response`);
    }
  }
  
  // Validate the categorization object
  if (!categorization || typeof categorization !== 'object') {
    throw new Error('Invalid categorization result');
  }
  
  return categorization;
}

// Listen for messages from popup
browser.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  
  // Test message
  if (request.action === 'test') {
    sendResponse({ status: 'Background script is running' });
    return false;
  }
  
  
  // Handle opening multiple tabs
  if (request.action === 'openMultipleTabs') {
    const { urls } = request.data;
    
    try {
      // Open tabs with delay to prevent browser overload
      urls.forEach((url, index) => {
        setTimeout(() => {
          browser.tabs.create({ url }, () => {
            if (browser.runtime.lastError) {
              console.error('Error opening tab:', browser.runtime.lastError);
            }
          });
        }, index * 100); // 100ms delay between each tab
      });
      
      sendResponse({ success: true, count: urls.length });
    } catch (error) {
      console.error('Error in openMultipleTabs:', error);
      sendResponse({ success: false, error: error.message });
    }
    return false;
  }
  
  if (request.action === 'categorizeTabs') {
    handleCategorizeTabs(request.data)
      .then(result => {
        sendResponse(result);
      })
      .catch(error => {
        console.error('Background sending error response:', error);
        sendResponse({ error: error.message, stack: error.stack });
      });
    return true; // Will respond asynchronously
  }
  
  if (request.action === 'fetchModels') {
    handleFetchModels(request.data)
      .then(result => {
        sendResponse(result);
      })
      .catch(error => {
        console.error('Background error fetching models:', error);
        sendResponse({ error: error.message });
      });
    return true; // Will respond asynchronously
  }
  
  // Handle moveTabToCategory (now just acknowledges since popup handles its own state)
  if (request.action === 'moveTabToCategory') {
    // Simply acknowledge the request - the popup will update its own state
    sendResponse({ success: true });
    
    return false;
  }
  
  // Handle tabClosed action (Firefox compatibility)
  if (request.action === 'tabClosed') {
    // Simply acknowledge the request - used for Firefox compatibility
    sendResponse({ success: true });
    return false;
  }
  
  
  // Default response for unknown actions
  sendResponse({ error: 'Unknown action: ' + request.action });
  return false;
});

async function handleCategorizeTabs({ tabs, apiKey, provider, model, customPrompt, savedUrls = [] }) {
  
  try {
    // Convert saved URLs array to Set for faster lookup
    const savedUrlsSet = new Set(savedUrls);
    
    // Deduplicate tabs before sending to LLM
    const { deduplicatedTabs, urlToOriginalTabs, savedTabsMap } = deduplicateTabs(tabs, savedUrlsSet);
    
    // If no tabs to categorize after filtering, return empty result
    if (deduplicatedTabs.length === 0) {
      return { success: true, data: { 1: [], 2: [], 3: [] } };
    }
    
    let categorized;
    
    switch (provider) {
      case 'Claude':
        categorized = await callClaudeAPI(deduplicatedTabs, apiKey, model, customPrompt);
        break;
      case 'OpenAI':
        categorized = await callOpenAIAPI(deduplicatedTabs, apiKey, model, customPrompt);
        break;
      case 'Gemini':
        categorized = await callGeminiAPI(deduplicatedTabs, apiKey, model, customPrompt);
        break;
      case 'DeepSeek':
        categorized = await callDeepSeekAPI(deduplicatedTabs, apiKey, model, customPrompt);
        break;
      case 'Grok':
        categorized = await callGrokAPI(deduplicatedTabs, apiKey, model, customPrompt);
        break;
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
    
    // Map categorized results back to all original tabs
    const expandedCategorized = expandCategorizedResults(categorized, urlToOriginalTabs);
    
    // Add saved tabs to category 1 (can be closed) so they show up in the UI
    savedTabsMap.forEach((tabs) => {
      if (tabs.length > 0) {
        // Use the first tab as the representative, but include all duplicate IDs
        const representativeTab = { ...tabs[0] };
        delete representativeTab.originalIndex;
        
        // Add array of all tab IDs that have this URL (for closing duplicates)
        representativeTab.duplicateIds = tabs.map(tab => tab.id);
        
        // Add duplicate count to title if there are duplicates
        if (tabs.length > 1) {
          representativeTab.duplicateCount = tabs.length;
        }
        
        // Mark as already saved
        representativeTab.alreadySaved = true;
        
        expandedCategorized[1].push(representativeTab);
      }
    });
    
    
    // Save all categorized tabs to database (including category 1)
    try {
      await globalThis.tabDatabase.saveCategorizedTabs(expandedCategorized);
    } catch (error) {
      console.error('Background: Error saving to database:', error);
    }
    
    // Build urlToDuplicateIds for the response
    const urlToDuplicateIds = {};
    urlToOriginalTabs.forEach((tabs, url) => {
      if (tabs.length > 1) {
        urlToDuplicateIds[url] = tabs.map(t => t.id);
      }
    });
    
    return { success: true, data: expandedCategorized, urlToDuplicateIds };
  } catch (error) {
    console.error('Background: API error', error);
    return { success: false, error: error.message };
  }
}

// Deduplicate tabs by URL, keeping track of all tabs with the same URL
function deduplicateTabs(tabs, savedUrls = new Set()) {
  const urlToOriginalTabs = new Map();
  const savedTabsMap = new Map(); // Track tabs that match saved URLs
  const deduplicatedTabs = [];
  
  tabs.forEach((tab, index) => {
    const url = tab.url;
    
    // Check if URL is already saved
    if (savedUrls.has(url)) {
      // Track saved tabs separately so we can still display them
      if (!savedTabsMap.has(url)) {
        savedTabsMap.set(url, []);
      }
      savedTabsMap.get(url).push({ ...tab, originalIndex: index });
      return; // Don't send to LLM
    }
    
    if (!urlToOriginalTabs.has(url)) {
      // First time seeing this URL, add to deduplicated list
      urlToOriginalTabs.set(url, []);
      // Create a deduplicated tab with a unique ID for tracking
      const deduplicatedTab = {
        ...tab,
        deduplicatedId: String(deduplicatedTabs.length)
      };
      deduplicatedTabs.push(deduplicatedTab);
    }
    // Track all original tabs with this URL
    urlToOriginalTabs.get(url).push({ ...tab, originalIndex: index });
  });
  
  
  return { deduplicatedTabs, urlToOriginalTabs, savedTabsMap };
}

// Expand categorized results to show deduplicated tabs but track all duplicate IDs
function expandCategorizedResults(categorized, urlToOriginalTabs) {
  const expanded = { 0: [], 1: [], 2: [], 3: [] };
  
  [0, 1, 2, 3].forEach(category => {
    if (categorized[category]) {
      categorized[category].forEach(deduplicatedTab => {
        const originalTabs = urlToOriginalTabs.get(deduplicatedTab.url) || [];
        if (originalTabs.length > 0) {
          // Use the first tab as the representative, but include all duplicate IDs
          const representativeTab = { ...originalTabs[0] };
          delete representativeTab.deduplicatedId;
          delete representativeTab.originalIndex;
          
          // Add array of all tab IDs that have this URL (for closing duplicates)
          representativeTab.duplicateIds = originalTabs.map(tab => tab.id);
          
          // Add duplicate count to title if there are duplicates
          if (originalTabs.length > 1) {
            representativeTab.duplicateCount = originalTabs.length;
          }
          
          expanded[category].push(representativeTab);
        }
      });
    }
  });
  
  return expanded;
}

// Common prompt for all LLMs
function getCategorizationPrompt(tabs, customPrompt) {
  
  // Use custom prompt if provided and different from default
  const userEditablePart = (customPrompt && customPrompt !== CONFIG.DEFAULT_PROMPT) ? customPrompt : CONFIG.DEFAULT_PROMPT;
  
  // Prepare minimal tab data for LLM - only what's needed for categorization
  const minimalTabs = tabs.map(tab => {
    // Create minimal tab object with only necessary fields
    const minimalTab = {
      id: tab.deduplicatedId || tab.id || tab.tempId || tabs.indexOf(tab),
      title: tab.title,
      url: tab.url.length > 128 ? tab.url.substring(0, 128) + '...' : tab.url
    };
    
    return minimalTab;
  });
  
  
  // Combine user-editable part with system-enforced suffix
  // This ensures LLMs always return properly formatted JSON regardless of user edits
  const fullPrompt = userEditablePart + CONFIG.PROMPT_SYSTEM_SUFFIX;
  
  // Replace placeholders in the prompt
  return fullPrompt
    .replace('{FREQUENT_DOMAINS}', CONFIG.FREQUENT_DOMAINS.join(', '))
    .replace('{TABS_DATA}', JSON.stringify(minimalTabs, null, 2));
}

async function callClaudeAPI(tabs, apiKey, model, customPrompt) {
  
  // Safety check - don't call API if no tabs
  if (!tabs || tabs.length === 0) {
    return { 1: [], 2: [], 3: [] };
  }
  
  try {
    const prompt = getCategorizationPrompt(tabs, customPrompt);
    

  const requestHeaders = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true'
  };

  
  const requestBody = {
    model: model,
    max_tokens: 4096,
    temperature: 0.3,
    messages: [{
      role: 'user',
      content: prompt
    }]
  };


  let response;
  try {
    response = await fetch(CONFIG.PROVIDERS.Claude.apiUrl, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(requestBody)
    });
  } catch (fetchError) {
    console.error('Fetch failed:', fetchError);
    throw new Error(`Network error: ${fetchError.message}`);
  }

  if (!response.ok) {
    let errorText;
    try {
      errorText = await response.text();
    } catch (e) {
      errorText = 'Unable to read error response';
    }
    console.error('Claude API error response:', response.status, errorText);
    throw new Error(`API request failed: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  
  
  if (!data.content || !data.content[0] || !data.content[0].text) {
    throw new Error('Invalid response format from Claude');
  }
  
  const content = data.content[0].text;
  const categorization = extractJSONFromResponse(content, 'Claude');
  
  
  return organizeTabs(tabs, categorization);
  
  } catch (error) {
    console.error('Error in callClaudeAPI:', error);
    throw error;
  }
}

// OpenAI API implementation
async function callOpenAIAPI(tabs, apiKey, model, customPrompt) {
  
  // Safety check - don't call API if no tabs
  if (!tabs || tabs.length === 0) {
    return { 1: [], 2: [], 3: [] };
  }
  
  try {
    const prompt = getCategorizationPrompt(tabs, customPrompt);
    
    // Log the exact prompt being sent
    
    const requestBody = {
      model: model,
      messages: [{
        role: 'system',
        content: 'You are a helpful assistant that categorizes browser tabs.'
      }, {
        role: 'user',
        content: prompt
      }],
      temperature: 0.3,
      max_tokens: 4096
    };
    
    // Log the complete request body
    
    const response = await fetch(CONFIG.PROVIDERS.OpenAI.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json();
    
    // Log the complete response
    
    if (!data.choices || !data.choices[0] || !data.choices[0].message || !data.choices[0].message.content) {
      throw new Error('Invalid response format from OpenAI');
    }
    
    const content = data.choices[0].message.content;
    const categorization = extractJSONFromResponse(content, 'OpenAI');
    
    return organizeTabs(tabs, categorization);
  } catch (error) {
    console.error('Error in callOpenAIAPI:', error);
    throw error;
  }
}

// Helper function to organize tabs
function organizeTabs(tabs, categorization) {
  
  const organized = { 0: [], 1: [], 2: [], 3: [] };  // Include category 0 for uncategorized
  
  tabs.forEach((tab, index) => {
    // Check for categorization by tab ID (for regular tabs) or by index (for imported tabs)
    let category;
    
    try {
      if (tab && tab.deduplicatedId) {
        // For deduplicated tabs, use the deduplicatedId
        category = categorization[tab.deduplicatedId] || categorization[index.toString()];
      } else if (tab && tab.id !== undefined && tab.id !== null) {
        const idKey = tab.id.toString();
        category = categorization[idKey];
      } else if (tab && tab.tempId) {
        // For imported tabs with temporary IDs, check both tempId and index
        category = categorization[tab.tempId] || categorization[index.toString()];
      } else {
        // For imported tabs without IDs, use the index
        const indexKey = index.toString();
        category = categorization[indexKey];
      }
      
      // If no category found, mark as uncategorized (0) instead of defaulting to 1
      if (category === undefined || category === null) {
        console.warn(`No categorization found for tab at index ${index}, marking as uncategorized`);
        category = 0;
      }
      
      // Ensure category is valid
      if (![0, 1, 2, 3].includes(category)) {
        console.warn(`Invalid category ${category} for tab at index ${index}, marking as uncategorized`);
        category = 0;
      }
      
      organized[category].push(tab);
    } catch (err) {
      console.error(`Error processing tab at index ${index}:`, err);
      console.error('Tab data:', tab);
      // Default to category 1 on error
      organized[1].push(tab);
    }
  });
  
  // Sort tabs within each category by domain
  Object.keys(organized).forEach(cat => {
    try {
      organized[cat].sort((a, b) => {
        const domainA = (a && a.domain) || '';
        const domainB = (b && b.domain) || '';
        return domainA.localeCompare(domainB);
      });
    } catch (err) {
      console.error(`Error sorting category ${cat}:`, err);
    }
  });
  
  return organized;
}

// Gemini API implementation
async function callGeminiAPI(tabs, apiKey, model, customPrompt) {
  // Safety check - don't call API if no tabs
  if (!tabs || tabs.length === 0) {
    return { 1: [], 2: [], 3: [] };
  }
  
  try {
    const prompt = getCategorizationPrompt(tabs, customPrompt);
    
    // Gemini uses a different URL structure with the model in the path
    const url = CONFIG.PROVIDERS.Gemini.apiUrl.replace('{model}', model) + `?key=${apiKey}`;
    
    const requestBody = {
      contents: [{
        parts: [{
          text: prompt
        }]
      }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 4096
      }
    };
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json();
    
    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content || 
        !data.candidates[0].content.parts || !data.candidates[0].content.parts[0]) {
      throw new Error('Invalid response format from Gemini');
    }
    
    const content = data.candidates[0].content.parts[0].text;
    const categorization = extractJSONFromResponse(content, 'Gemini');
    
    return organizeTabs(tabs, categorization);
  } catch (error) {
    console.error('Error in callGeminiAPI:', error);
    throw error;
  }
}

// DeepSeek API implementation (OpenAI-compatible)
async function callDeepSeekAPI(tabs, apiKey, model, customPrompt) {
  // Safety check - don't call API if no tabs
  if (!tabs || tabs.length === 0) {
    return { 1: [], 2: [], 3: [] };
  }
  
  try {
    const prompt = getCategorizationPrompt(tabs, customPrompt);
    
    const requestBody = {
      model: model,
      messages: [{
        role: 'user',
        content: prompt
      }],
      temperature: 0.3,
      max_tokens: 4096
    };
    
    const response = await fetch(CONFIG.PROVIDERS.DeepSeek.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json();
    
    if (!data.choices || !data.choices[0] || !data.choices[0].message || !data.choices[0].message.content) {
      throw new Error('Invalid response format from DeepSeek');
    }
    
    const content = data.choices[0].message.content;
    const categorization = extractJSONFromResponse(content, 'DeepSeek');
    
    return organizeTabs(tabs, categorization);
  } catch (error) {
    console.error('Error in callDeepSeekAPI:', error);
    throw error;
  }
}

// Grok API implementation (OpenAI-compatible)
async function callGrokAPI(tabs, apiKey, model, customPrompt) {
  // Safety check - don't call API if no tabs
  if (!tabs || tabs.length === 0) {
    return { 1: [], 2: [], 3: [] };
  }
  
  try {
    const prompt = getCategorizationPrompt(tabs, customPrompt);
    
    const requestBody = {
      model: model,
      messages: [{
        role: 'user',
        content: prompt
      }],
      temperature: 0.3,
      max_tokens: 4096
    };
    
    const response = await fetch(CONFIG.PROVIDERS.Grok.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json();
    
    if (!data.choices || !data.choices[0] || !data.choices[0].message || !data.choices[0].message.content) {
      throw new Error('Invalid response format from Grok');
    }
    
    const content = data.choices[0].message.content;
    const categorization = extractJSONFromResponse(content, 'Grok');
    
    return organizeTabs(tabs, categorization);
  } catch (error) {
    console.error('Error in callGrokAPI:', error);
    throw error;
  }
}

// Handle fetching models for a provider
async function handleFetchModels({ provider, apiKey }) {
  
  const providerConfig = CONFIG.PROVIDERS[provider];
  
  // If no models URL, return empty array
  if (!providerConfig.modelsUrl) {
    return { success: true, models: [] };
  }
  
  // If no API key, return empty array (user needs to add API key first)
  if (!apiKey) {
    return { success: true, models: [], needsApiKey: true };
  }
  
  try {
    let models = [];
    
    switch (provider) {
      case 'Claude':
        models = await fetchClaudeModels(apiKey);
        break;
      case 'OpenAI':
        models = await fetchOpenAIModels(apiKey);
        break;
      case 'Gemini':
        models = await fetchGeminiModels(apiKey);
        break;
      case 'DeepSeek':
        models = await fetchDeepSeekModels(apiKey);
        break;
      case 'Grok':
        models = await fetchGrokModels(apiKey);
        break;
      default:
        models = providerConfig.models;
    }
    
    return { success: true, models };
  } catch (error) {
    console.error('Error fetching models:', error);
    // Return empty array on error
    return { success: true, models: [], error: error.message };
  }
}

// Fetch Claude models
async function fetchClaudeModels(apiKey) {
  
  try {
    const response = await fetch(CONFIG.PROVIDERS.Claude.modelsUrl, {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Process Claude models
    const models = data.data
      .map(model => ({
        id: model.id,
        name: model.display_name || model.id,
        created_at: model.created_at
      }))
      // Sort by creation date (newest first)
      .sort((a, b) => {
        if (a.created_at && b.created_at) {
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        }
        // Fallback to alphabetical if no creation date
        return a.id.localeCompare(b.id);
      });
    
    return models;
  } catch (error) {
    console.error('Error fetching Claude models:', error);
    throw error; // Let the parent handler deal with it
  }
}

// Fetch OpenAI models
async function fetchOpenAIModels(apiKey) {
  
  try {
    const response = await fetch(CONFIG.PROVIDERS.OpenAI.modelsUrl, {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Filter for chat models (or any model that supports chat completions)
    const chatModels = data.data
      .filter(model => {
        // Include models that support chat completions
        return model.id.includes('gpt') || 
               model.id.includes('chatgpt') || 
               model.id.includes('o1') ||
               (model.capabilities && model.capabilities.includes('chat'));
      })
      .map(model => ({
        id: model.id,
        name: model.name || model.id.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        created: model.created
      }))
      // Sort by creation time (newest first)
      .sort((a, b) => {
        if (a.created && b.created) {
          return b.created - a.created;
        }
        return b.id.localeCompare(a.id);
      });
    
    return chatModels;
  } catch (error) {
    console.error('Error fetching OpenAI models:', error);
    throw error;
  }
}

// Fetch Gemini models
async function fetchGeminiModels(apiKey) {
  
  try {
    const response = await fetch(`${CONFIG.PROVIDERS.Gemini.modelsUrl}?key=${apiKey}`);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.status}`);
    }
    
    const data = await response.json();
    
    const models = data.models
      .filter(model => model.supportedGenerationMethods.includes('generateContent'))
      .map(model => ({
        id: model.name.split('/').pop(),
        name: model.displayName || model.name.split('/').pop()
      }))
      // Reverse the order to show newest models first
      .reverse();
    
    return models;
  } catch (error) {
    console.error('Error fetching Gemini models:', error);
    throw error;
  }
}

// Placeholder functions for other providers
async function fetchDeepSeekModels(apiKey) {
  // DeepSeek uses OpenAI-compatible API
  try {
    const response = await fetch(CONFIG.PROVIDERS.DeepSeek.modelsUrl, {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.status}`);
    }
    
    const data = await response.json();
    
    const models = data.data
      .map(model => ({
        id: model.id,
        name: model.id
      }))
      // Sort alphabetically since DeepSeek doesn't provide creation dates
      .sort((a, b) => a.id.localeCompare(b.id));
    
    return models;
  } catch (error) {
    console.error('Error fetching DeepSeek models:', error);
    throw error;
  }
}

async function fetchGrokModels(apiKey) {
  // Similar to OpenAI format
  try {
    const response = await fetch(CONFIG.PROVIDERS.Grok.modelsUrl, {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.status}`);
    }
    
    const data = await response.json();
    
    const models = data.data
      .map(model => ({
        id: model.id,
        name: model.id,
        created: model.created
      }))
      // Sort by creation time (newest first)
      .sort((a, b) => {
        if (a.created && b.created) {
          return b.created - a.created;
        }
        // Fallback to alphabetical if no creation date
        return a.id.localeCompare(b.id);
      });
    
    return models;
  } catch (error) {
    console.error('Error fetching Grok models:', error);
    throw error;
  }
}

