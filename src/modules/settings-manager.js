/*
 * AI Tab Manager - Copyright (c) 2025 AI Tech Knowledge LLC
 * Settings Manager - handles all settings UI and persistence
 */

import { DOM_IDS, LIMITS } from '../utils/constants.js';
import { $id } from '../utils/dom-helpers.js';
import { smartConfirm } from '../utils/helpers.js';
import { showStatus, hideApiKeyPrompt } from './ui-manager.js';
import { state, updateState } from './state-manager.js';
import StorageService from '../services/StorageService.js';
import MessageService from '../services/MessageService.js';
import { pricingService } from '../services/pricing-service.js';

// Debounce utility
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Initialize settings UI
 */
export async function initializeSettingsUI() {
  
  // Set current provider
  const providerSelect = $id(DOM_IDS.PROVIDER_SELECT);
  if (providerSelect) {
    providerSelect.value = state.settings.provider;
  } else {
    console.error('Provider select not found');
  }
  
  // Populate models for current provider and wait for it to complete
  try {
    await updateModelDropdown();
  } catch (error) {
    console.error('❌ SETTINGS UI: Error updating model dropdown:', error);
  }
  
  // Now set current model after dropdown is populated
  const modelSelect = $id(DOM_IDS.MODEL_SELECT);
  if (modelSelect && state.settings.model) {
    modelSelect.value = state.settings.model;
  }
  
  // Set API key if exists
  const apiKeyInput = $id(DOM_IDS.API_KEY_INPUT);
  if (apiKeyInput) {
    const apiKey = state.settings.apiKeys[state.settings.provider] || '';
    apiKeyInput.value = apiKey;
    if (CONFIG && CONFIG.PROVIDERS && CONFIG.PROVIDERS[state.settings.provider]) {
      apiKeyInput.placeholder = CONFIG.PROVIDERS[state.settings.provider].apiKeyPlaceholder;
    }
  } else {
    console.error('API key input not found');
  }
  
  // Set API key link
  const apiKeyLink = $id('apiKeyLink');
  if (apiKeyLink && CONFIG?.PROVIDERS?.[state.settings.provider]?.apiKeyUrl) {
    apiKeyLink.href = CONFIG.PROVIDERS[state.settings.provider].apiKeyUrl;
    apiKeyLink.title = `Get ${state.settings.provider} API key`;
  }
  
  // Set custom prompt
  const promptTextarea = $id(DOM_IDS.PROMPT_TEXTAREA);
  if (promptTextarea) {
    const promptValue = state.settings.customPrompt || (CONFIG ? CONFIG.DEFAULT_PROMPT : '');
    promptTextarea.value = promptValue;
  } else {
    console.error('Prompt textarea not found');
  }
  
  // Set max tabs to open
  const maxTabsInput = $id(DOM_IDS.MAX_TABS_INPUT);
  if (maxTabsInput) {
    maxTabsInput.value = state.settings.maxTabsToOpen || LIMITS.MAX_TABS_DEFAULT;
  }
  
  // Set LLM checkbox
  const useLLMCheckbox = $id('useLLMCheckbox');
  if (useLLMCheckbox) {
    useLLMCheckbox.checked = state.settings.useLLM !== false; // Default to true
    
    // Show/hide LLM settings container based on checkbox state
    const llmSettingsContainer = $id('llmSettingsContainer');
    if (llmSettingsContainer) {
      llmSettingsContainer.style.display = useLLMCheckbox.checked ? 'block' : 'none';
    }
  }
  
  // Set ML training settings
  const mlPatienceSelect = $id('mlPatienceSelect');
  if (mlPatienceSelect) {
    mlPatienceSelect.value = state.settings.mlEarlyStoppingPatience;
  }
  
  const mlBatchSizeSelect = $id('mlBatchSizeSelect');
  if (mlBatchSizeSelect) {
    mlBatchSizeSelect.value = state.settings.mlBatchSize;
  }
  
  const mlLearningRateSelect = $id('mlLearningRateSelect');
  if (mlLearningRateSelect) {
    mlLearningRateSelect.value = state.settings.mlLearningRate;
  }
  
  
  // Update prompt status
  updatePromptStatus();
  
  // Initialize ML dashboard
  try {
    const { initializeMLDashboard } = await import('./ml-dashboard.js');
    await initializeMLDashboard();
  } catch (error) {
    // ML dashboard not available
    // Clear all ML loading messages even if ML module fails
    const statusContent = $id('mlStatusContent');
    if (statusContent) {
      statusContent.innerHTML = '<div style="color: var(--md-sys-color-on-surface-variant);">ML features not available</div>';
    }
    
    const trustContent = $id('mlTrustContent');
    if (trustContent) {
      trustContent.innerHTML = '<div style="color: var(--md-sys-color-on-surface-variant);">ML features not available</div>';
    }
    
    const performanceContent = $id('mlPerformanceContent');
    if (performanceContent) {
      performanceContent.innerHTML = '<div style="color: var(--md-sys-color-on-surface-variant);">ML features not available</div>';
    }
  }
  
  // Initialize sync settings
  try {
    await initializeSyncSettings();
  } catch (error) {
    console.error('Error initializing sync settings:', error);
  }
  
  // Initialize rules UI - with small delay to ensure state is loaded
  setTimeout(() => {
    initializeRulesUI();
  }, 100);
}

/**
 * Update model dropdown based on provider
 */
export async function updateModelDropdown() {
  const modelSelect = $id(DOM_IDS.MODEL_SELECT);
  if (!modelSelect) {
    console.error('Model select element not found!');
    return;
  }
  
  // Show loading state
  modelSelect.innerHTML = '<option>Loading models...</option>';
  modelSelect.disabled = true;
  
  try {
    // Try to fetch models dynamically
    const apiKey = state.settings.apiKeys[state.settings.provider];
    // Add timeout to prevent hanging
    const fetchPromise = MessageService.fetchModels(state.settings.provider, apiKey);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Model fetch timeout')), 3000)
    );
    
    const response = await Promise.race([fetchPromise, timeoutPromise]);
    
    let models = [];
    let needsApiKey = false;
    
    if (response && response.success) {
      models = response.models || [];
      needsApiKey = response.needsApiKey || false;
    } else if (response && response.models) {
      // Handle case where success flag might be missing
      models = response.models;
    }
    
    // Clear and populate models
    modelSelect.innerHTML = '';
    
    if (needsApiKey || (!apiKey && models.length === 0)) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Please add API key to see available models';
      modelSelect.appendChild(option);
      modelSelect.disabled = true;
      return;
    }
    
    if (models.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No models available';
      modelSelect.appendChild(option);
      modelSelect.disabled = true;
      return;
    }
    
    // Pre-load pricing data
    const pricingPromises = models.map(async model => {
      // Try both model.name (display_name) and model.id for pricing lookup
      const pricing = await pricingService.getPricingDisplay(state.settings.provider, model.name, model.id);
      return { model, pricing };
    });
    
    const modelsWithPricing = await Promise.all(pricingPromises);
    
    modelsWithPricing.forEach(({ model, pricing }) => {
      const option = document.createElement('option');
      option.value = model.id;
      
      // Format display text with release date if available
      let displayText = model.name;
      if (model.created_at) {
        const date = new Date(model.created_at);
        const dateStr = date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
        displayText += ` (${dateStr})`;
      } else if (model.created) {
        // OpenAI uses unix timestamp
        const date = new Date(model.created * 1000);
        const dateStr = date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
        displayText += ` (${dateStr})`;
      }
      
      // Add pricing if available
      if (pricing) {
        displayText += pricing;
      }
      
      option.textContent = displayText;
      modelSelect.appendChild(option);
    });
    
    
    // Check if we have a previously selected model for this provider
    const previouslySelected = state.settings.selectedModels[state.settings.provider];
    
    if (previouslySelected && models.some(m => m.id === previouslySelected)) {
      // Use previously selected model
      modelSelect.value = previouslySelected;
      state.settings.model = previouslySelected;
    } else if (models.some(m => m.id === state.settings.model)) {
      // Use current model if available
      modelSelect.value = state.settings.model;
    } else if (models.length > 0) {
      // Default to first available model
      state.settings.model = models[0].id;
      modelSelect.value = state.settings.model;
    }
    
    // Save the selected model for this provider
    if (state.settings.model) {
      state.settings.selectedModels[state.settings.provider] = state.settings.model;
      await StorageService.saveSettings(state.settings);
    }
  } catch (error) {
    console.error('❌ SETTINGS UI: Error updating models:', error);
    modelSelect.innerHTML = '';
    
    // Try to use default models from config
    if (CONFIG?.PROVIDERS?.[state.settings.provider]?.models) {
      const defaultModels = CONFIG.PROVIDERS[state.settings.provider].models;
      
      // Pre-load pricing for default models
      const defaultPricingPromises = defaultModels.map(async model => {
        // Try both model.name and model.id for pricing lookup
        const pricing = await pricingService.getPricingDisplay(state.settings.provider, model.name, model.id);
        return { model, pricing };
      });
      
      const defaultModelsWithPricing = await Promise.all(defaultPricingPromises);
      
      defaultModelsWithPricing.forEach(({ model, pricing }) => {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = model.name + (pricing || '');
        modelSelect.appendChild(option);
      });
      
      // Set the first model as default
      if (defaultModels.length > 0) {
        state.settings.model = defaultModels[0].id;
        modelSelect.value = state.settings.model;
      }
    } else {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Error loading models';
      modelSelect.appendChild(option);
      modelSelect.disabled = true;
    }
  } finally {
    if (modelSelect.options.length > 0 && modelSelect.options[0].value) {
      modelSelect.disabled = false;
    }
    
    // Update pricing info description
    updatePricingInfo();
  }
}

/**
 * Update the pricing info description
 */
async function updatePricingInfo() {
  const pricingInfoDiv = $id('modelPricingInfo');
  if (!pricingInfoDiv) return;
  
  try {
    const scrapedDate = await pricingService.getScrapedDate(state.settings.provider);
    
    if (scrapedDate) {
      const date = new Date(scrapedDate);
      const formattedDate = date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      });
      
      pricingInfoDiv.textContent = `Prices shown are estimates for categorizing a batch of 100 tabs. Pricing data from ${formattedDate}.`;
    } else {
      pricingInfoDiv.textContent = 'Prices shown are estimates for categorizing a batch of 100 tabs.';
    }
  } catch (error) {
    console.error('Error updating pricing info:', error);
    pricingInfoDiv.textContent = 'Prices shown are estimates for categorizing a batch of 100 tabs.';
  }
}

/**
 * Handle provider change
 */
export async function onProviderChange(e) {
  state.settings.provider = e.target.value;
  updateState('settings', state.settings);
  
  await updateModelDropdown();
  
  // Update API key placeholder
  const apiKeyInput = $id(DOM_IDS.API_KEY_INPUT);
  if (apiKeyInput) {
    apiKeyInput.value = state.settings.apiKeys[state.settings.provider] || '';
    apiKeyInput.placeholder = CONFIG.PROVIDERS[state.settings.provider].apiKeyPlaceholder;
  }
  
  // Update API key link
  const apiKeyLink = $id('apiKeyLink');
  if (apiKeyLink && CONFIG?.PROVIDERS?.[state.settings.provider]?.apiKeyUrl) {
    apiKeyLink.href = CONFIG.PROVIDERS[state.settings.provider].apiKeyUrl;
    apiKeyLink.title = `Get ${state.settings.provider} API key`;
  }
  
  await StorageService.saveSettings(state.settings);
}

/**
 * Handle model change
 */
export async function onModelChange(e) {
  state.settings.model = e.target.value;
  // Save the selected model for the current provider
  state.settings.selectedModels[state.settings.provider] = state.settings.model;
  updateState('settings', state.settings);
  
  await StorageService.saveSettings(state.settings);
}

/**
 * Save API key
 */
export async function saveApiKey() {
  const input = $id(DOM_IDS.API_KEY_INPUT);
  const key = input.value.trim();
  
  if (!key) {
    showStatus('Please enter an API key', 'error');
    return;
  }
  
  await StorageService.saveApiKey(state.settings.provider, key);
  state.settings.apiKeys[state.settings.provider] = key;
  
  // Mark that user has configured settings
  state.settings.hasConfiguredSettings = true;
  updateState('settings', state.settings);
  
  // Save settings including the hasConfiguredSettings flag
  await StorageService.saveSettings(state.settings);
  
  // Button state and UI update show this - no message needed
  
  // Hide API prompt if it was showing
  hideApiKeyPrompt();
  
  // Refresh models with the new API key
  await updateModelDropdown();
}

/**
 * Handle prompt change
 */
export function onPromptChange(e) {
  state.settings.customPrompt = e.target.value;
  // Mark as customized if different from default
  state.settings.isPromptCustomized = (e.target.value !== CONFIG.DEFAULT_PROMPT && e.target.value !== '');
  updateState('settings', state.settings);
  
  StorageService.saveSettings(state.settings);
  updatePromptStatus();
}

/**
 * Reset prompt to default
 */
export function resetPrompt() {
  state.settings.customPrompt = CONFIG.DEFAULT_PROMPT;
  state.settings.isPromptCustomized = false;
  state.settings.promptVersion = CONFIG.PROMPT_VERSION;
  updateState('settings', state.settings);
  
  const promptTextarea = $id(DOM_IDS.PROMPT_TEXTAREA);
  if (promptTextarea) {
    promptTextarea.value = CONFIG.DEFAULT_PROMPT;
  }
  
  StorageService.saveSettings(state.settings);
  updatePromptStatus();
  showStatus('Prompt reset to default', 'success');
}

/**
 * Update prompt status indicator
 */
export function updatePromptStatus() {
  const promptStatus = $id(DOM_IDS.PROMPT_STATUS);
  if (!promptStatus) return;
  
  const currentPrompt = state.settings.customPrompt || '';
  const isDefault = currentPrompt === CONFIG.DEFAULT_PROMPT || currentPrompt === '';
  
  if (isDefault && !state.settings.isPromptCustomized) {
    promptStatus.textContent = `(Using default prompt)`;
    promptStatus.style.color = 'var(--text-muted)';
  } else if (state.settings.isPromptCustomized) {
    promptStatus.textContent = '(Using custom prompt)';
    promptStatus.style.color = 'var(--warning-color)';
  } else {
    // Edge case: prompt matches default but was previously customized
    promptStatus.textContent = '(Using default prompt)';
    promptStatus.style.color = 'var(--text-muted)';
  }
}

/**
 * Handle max tabs change
 */
export function onMaxTabsChange(e) {
  const value = parseInt(e.target.value);
  if (!isNaN(value) && value >= LIMITS.MIN_TABS_LIMIT && value <= LIMITS.MAX_TABS_LIMIT) {
    state.settings.maxTabsToOpen = value;
    updateState('settings', state.settings);
    
    StorageService.saveSettings(state.settings);
    showStatus(`Max tabs to open set to ${value}`, 'success');
  } else {
    // Reset to previous value if invalid
    e.target.value = state.settings.maxTabsToOpen || LIMITS.MAX_TABS_DEFAULT;
    showStatus(`Please enter a value between ${LIMITS.MIN_TABS_LIMIT} and ${LIMITS.MAX_TABS_LIMIT}`, 'error');
  }
}

/**
 * Initialize rules UI
 */
export function initializeRulesUI() {
  const rulesContainer = $id(DOM_IDS.RULES_CONTAINER);
  if (!rulesContainer) {
    return;
  }
  // Clear existing rules
  rulesContainer.querySelectorAll('.rules-list').forEach(list => {
    list.innerHTML = '';
    updateEmptyState(list);
  });
  
  // Add existing rules
  if (state.settings.rules && state.settings.rules.length > 0) {
    state.settings.rules.forEach((rule, index) => {
      if (rule.enabled !== false) {
        try {
          addRuleToUI(rule.category, rule);
        } catch (error) {
          console.error(`Error adding rule ${index + 1}:`, error);
        }
      }
    });
  }
  
  // Update counters for each category
  updateRuleCategoryCounts();
  
  // Set up collapsible headers
  
  // Remove any existing click listeners to prevent duplicates
  const newContainer = rulesContainer.cloneNode(true);
  rulesContainer.parentNode.replaceChild(newContainer, rulesContainer);
  
  // Simple click handler for collapsible headers
  newContainer.addEventListener('click', (e) => {
    const header = e.target.closest('.rule-category-header');
    if (!header) {
      return;
    }
    
    // Don't trigger collapse when clicking buttons in the actions container
    if (e.target.closest('.rule-category-actions')) {
      return;
    }
    
    // Simple toggle: if it's "true", make it "false", and vice versa
    const currentState = header.dataset.collapsed;
    const newState = currentState === 'true' ? 'false' : 'true';
    
    header.dataset.collapsed = newState;
  });
  
  // Event delegation for delete buttons
  newContainer.addEventListener('click', (e) => {
    const deleteBtn = e.target.closest('.delete-rule-btn');
    if (!deleteBtn) {
      return;
    }
    
    e.stopPropagation();
    const tr = deleteBtn.closest('tr');
    const tbody = tr.closest('tbody');
    
    tr.remove();
    updateEmptyState(tbody);
    updateRuleCategoryCounts();
    saveRulesFromUI();
  });
  
  // Event delegation for delete category buttons
  newContainer.addEventListener('click', async (e) => {
    const deleteCategoryBtn = e.target.closest('.delete-category-btn');
    if (!deleteCategoryBtn) {
      return;
    }
    
    e.stopPropagation();
    const category = deleteCategoryBtn.dataset.category;
    const section = deleteCategoryBtn.closest('.rule-category-section');
    const tbody = section.querySelector('.rules-list');
    const ruleCount = tbody ? tbody.children.length : 0;
    
    if (ruleCount === 0) {
      showStatus('No rules to delete in this category', 'info', 2000);
      return;
    }
    
    // Get category name for confirmation
    const categoryNames = {
      '1': 'Ignore',
      '2': 'Useful', 
      '3': 'Important'
    };
    const categoryName = categoryNames[category] || 'this category';
    
    // Confirm deletion
    const confirmed = await smartConfirm(
      `Delete all ${ruleCount} rule${ruleCount > 1 ? 's' : ''} in the ${categoryName} category?`,
      { 
        defaultAnswer: false,
        confirmText: 'Delete',
        confirmType: 'warning'
      }
    );
    
    if (!confirmed) {
      return;
    }
    
    // Clear all rules in this category
    tbody.innerHTML = '';
    updateEmptyState(tbody);
    updateRuleCategoryCounts();
    saveRulesFromUI();
    
    showStatus(`Deleted all rules in ${categoryName} category`, 'success', 2000);
  });
  
  // Set up add rule buttons on the new container
  const addButtons = newContainer.querySelectorAll('.add-rule-btn');
  
  addButtons.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent triggering the header click
      const category = parseInt(e.currentTarget.dataset.category);
      
      // Expand the section if it's collapsed
      const header = e.currentTarget.closest('.rule-category-header');
      const wrapper = header?.nextElementSibling;
      if (header?.dataset.collapsed === 'true') {
        header.dataset.collapsed = 'false';
        // Remove inline style to let CSS take over
        if (wrapper) wrapper.style.display = '';
      }
      
      try {
        addRuleToUI(category);
      } catch (error) {
        console.error('Error adding new rule:', error);
      }
    });
  });
}

/**
 * Update empty state visibility
 */
function updateEmptyState(tbody) {
  const wrapper = tbody.closest('.rules-table-wrapper');
  const table = wrapper.querySelector('.rules-table');
  const emptyState = wrapper.querySelector('.rules-empty-state');
  
  if (tbody.children.length === 0) {
    table.style.display = 'none';
    emptyState.style.display = 'block';
  } else {
    table.style.display = 'table';
    emptyState.style.display = 'none';
  }
}

/**
 * Update rule category counts in headers
 */
function updateRuleCategoryCounts() {
  const categories = ['1', '2', '3']; // Ignore, Useful, Important
  
  categories.forEach(category => {
    const section = document.querySelector(`.rule-category-section[data-category="${category}"]`);
    if (!section) return;
    
    const rulesList = section.querySelector('.rules-list');
    const ruleCount = rulesList ? rulesList.children.length : 0;
    
    const titleSpan = section.querySelector('.rule-category-title > span:last-child');
    if (titleSpan) {
      // Remove existing count if present
      const text = titleSpan.textContent.replace(/ \(\d+\)$/, '');
      titleSpan.textContent = `${text} (${ruleCount})`;
    }
  });
}

/**
 * Add a rule to the UI
 */
function addRuleToUI(category, rule = null) {
  const tbody = document.querySelector(`.rules-list[data-category="${category}"]`);
  if (!tbody) {
    return;
  }
  
  const ruleId = Date.now() + Math.random();
  const tr = document.createElement('tr');
  tr.dataset.ruleId = ruleId;
  
  // Determine if this is a URL or title rule based on type or field
  const isTitle = rule?.field === 'title' || rule?.type === 'titleContains';
  const isRegex = rule?.type === 'regex';
  
  const urlValue = !isTitle ? (rule?.value || '') : '';
  const titleValue = isTitle ? (rule?.value || '') : '';
  const urlIsRegex = !isTitle && isRegex;
  const titleIsRegex = isTitle && isRegex;
  
  // Escape HTML to prevent XSS
  const escapeHtml = (str) => {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  };
  
  tr.innerHTML = `
    <td>
      <input type="text" class="rule-input rule-url-input" 
             value="${escapeHtml(urlValue)}" 
             placeholder="e.g., youtube.com/watch">
    </td>
    <td>
      <input type="checkbox" class="rule-regex-checkbox rule-url-regex" 
             ${urlIsRegex ? 'checked' : ''} 
             title="Check to use regular expression matching">
    </td>
    <td>
      <input type="text" class="rule-input rule-title-input" 
             value="${escapeHtml(titleValue)}" 
             placeholder="e.g., YouTube">
    </td>
    <td>
      <input type="checkbox" class="rule-regex-checkbox rule-title-regex" 
             ${titleIsRegex ? 'checked' : ''} 
             title="Check to use regular expression matching">
    </td>
    <td>
      <button class="delete-rule-btn" title="Delete rule">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          <line x1="10" y1="11" x2="10" y2="17"></line>
          <line x1="14" y1="11" x2="14" y2="17"></line>
        </svg>
      </button>
    </td>
  `;
  
  tbody.appendChild(tr);
  updateEmptyState(tbody);
  updateRuleCategoryCounts();
  
  // Add event listeners
  const urlInput = tr.querySelector('.rule-url-input');
  const titleInput = tr.querySelector('.rule-title-input');
  const urlRegex = tr.querySelector('.rule-url-regex');
  const titleRegex = tr.querySelector('.rule-title-regex');
  
  urlInput.addEventListener('input', debounce(saveRulesFromUI, 500));
  titleInput.addEventListener('input', debounce(saveRulesFromUI, 500));
  urlRegex.addEventListener('change', saveRulesFromUI);
  titleRegex.addEventListener('change', saveRulesFromUI);
  // Delete button now handled by event delegation in initializeRulesUI
}

/**
 * Save rules from UI
 */
function saveRulesFromUI() {
  const rules = [];
  const rulesContainer = $id(DOM_IDS.RULES_CONTAINER);
  if (!rulesContainer) return;
  
  // Process each rule row
  rulesContainer.querySelectorAll('tbody tr').forEach(tr => {
    const category = parseInt(tr.closest('.rule-category-section').dataset.category);
    const urlInput = tr.querySelector('.rule-url-input');
    const titleInput = tr.querySelector('.rule-title-input');
    const urlIsRegex = tr.querySelector('.rule-url-regex').checked;
    const titleIsRegex = tr.querySelector('.rule-title-regex').checked;
    
    // Add URL rule if present
    if (urlInput.value.trim()) {
      rules.push({
        type: urlIsRegex ? 'regex' : 'urlContains',
        value: urlInput.value.trim(),
        field: 'url',
        category: category,
        enabled: true
      });
    }
    
    // Add title rule if present
    if (titleInput.value.trim()) {
      rules.push({
        type: titleIsRegex ? 'regex' : 'titleContains',
        value: titleInput.value.trim(),
        field: 'title',
        category: category,
        enabled: true
      });
    }
  });
  
  state.settings.rules = rules;
  updateState('settings', state.settings);
  StorageService.saveSettings(state.settings);
}


/**
 * Restore default rules
 */
async function onRestoreDefaultRules() {
  try {
    const confirmed = await smartConfirm('This will replace all your current rules with the default rules. Are you sure?', { defaultAnswer: false });
    if (!confirmed) {
      return;
    }
    
    // Import the getDefaultRules function from state-manager
    const { getDefaultRules } = await import('./state-manager.js');
    
    const defaultRules = getDefaultRules();
    
    // Replace current rules with default rules
    state.settings.rules = defaultRules;
    await StorageService.saveSettings(state.settings);
    
    // Refresh the UI
    initializeRulesUI();
    // Rules table updates show this - no message needed
  } catch (error) {
    console.error('❌ RESTORE: Error restoring default rules:', error);
    showStatus('Error restoring default rules', 'error', 3000);
  }
}

/**
 * Initialize settings event handlers
 */
export async function initializeSettings() {
  // Provider change
  const providerSelect = $id(DOM_IDS.PROVIDER_SELECT);
  if (providerSelect) {
    providerSelect.addEventListener('change', onProviderChange);
  }
  
  // Model change
  const modelSelect = $id(DOM_IDS.MODEL_SELECT);
  if (modelSelect) {
    modelSelect.addEventListener('change', onModelChange);
  }
  
  // API key save
  const saveApiKeyBtn = $id(DOM_IDS.SAVE_API_KEY_BTN);
  if (saveApiKeyBtn) {
    saveApiKeyBtn.addEventListener('click', saveApiKey);
  }
  
  // Prompt changes
  const promptTextarea = $id(DOM_IDS.PROMPT_TEXTAREA);
  if (promptTextarea) {
    promptTextarea.addEventListener('input', onPromptChange);
  }
  
  const resetPromptBtn = $id(DOM_IDS.RESET_PROMPT_BTN);
  if (resetPromptBtn) {
    resetPromptBtn.addEventListener('click', resetPrompt);
  }
  
  // Max tabs change
  const maxTabsInput = $id(DOM_IDS.MAX_TABS_INPUT);
  if (maxTabsInput) {
    maxTabsInput.addEventListener('change', onMaxTabsChange);
  }
  
  // ML training settings changes
  const mlPatienceSelect = $id('mlPatienceSelect');
  if (mlPatienceSelect) {
    mlPatienceSelect.addEventListener('change', async () => {
      state.settings.mlEarlyStoppingPatience = parseInt(mlPatienceSelect.value);
      await StorageService.saveSettings(state.settings);
      showStatus('Training patience updated', 'success', 2000);
      
      // Refresh charts to update x-axis labels and scale
      try {
        const { getTrainingCharts } = await import('./training-charts.js');
        const charts = getTrainingCharts();
        if (charts) {
          charts.refreshCharts();
        }
      } catch (error) {
        // Charts might not be initialized yet, that's okay
      }
    });
  }
  
  const mlBatchSizeSelect = $id('mlBatchSizeSelect');
  if (mlBatchSizeSelect) {
    mlBatchSizeSelect.addEventListener('change', async () => {
      state.settings.mlBatchSize = parseInt(mlBatchSizeSelect.value);
      await StorageService.saveSettings(state.settings);
      showStatus('Batch size updated', 'success', 2000);
    });
  }
  
  const mlLearningRateSelect = $id('mlLearningRateSelect');
  if (mlLearningRateSelect) {
    mlLearningRateSelect.addEventListener('change', async () => {
      state.settings.mlLearningRate = parseFloat(mlLearningRateSelect.value);
      await StorageService.saveSettings(state.settings);
      showStatus('Learning rate updated', 'success', 2000);
    });
  }
  
  // Rules are now handled by the grouped UI with textareas
  
  // Restore default rules button
  const restoreBtn = $id('restoreDefaultRulesBtn');
  if (restoreBtn) {
    restoreBtn.addEventListener('click', onRestoreDefaultRules);
  } else {
    console.error('❌ SETTINGS INIT: Restore default rules button not found!');
  }
  
  // Initialize UI with current settings - but don't wait for model dropdown
  
  // Start settings UI initialization but don't wait for it
  initializeSettingsUI().then(() => {
  }).catch(error => {
    console.error('❌ SETTINGS INIT: Error initializing settings UI:', error);
  });
  
  // Initialize rules UI immediately (this doesn't need to wait)
  initializeRulesUI();
}

/**
 * Initialize sync settings UI
 */
async function initializeSyncSettings() {
  const { googleDriveSyncService } = await import('../services/GoogleDriveSyncService.js');
  const { initializeDatabaseSyncAdapter } = await import('../data/database-sync-adapter.js');
  
  // Initialize database sync adapter with the service
  initializeDatabaseSyncAdapter(googleDriveSyncService);
  
  // Get saved sync settings
  const syncEnabled = state.settings.syncEnabled || false;
  const syncCheckbox = $id(DOM_IDS.SYNC_ENABLED_CHECKBOX);
  const syncContainer = $id('syncSettingsContainer');
  const syncNowBtn = $id(DOM_IDS.SYNC_NOW_BTN);
  const syncStatus = $id(DOM_IDS.SYNC_STATUS);
  const syncLastTime = $id(DOM_IDS.SYNC_LAST_TIME);
  
  if (!syncCheckbox) {
    console.error('Sync checkbox not found');
    return;
  }
  
  // Set initial state
  syncCheckbox.checked = syncEnabled;
  syncContainer.style.display = syncEnabled ? 'block' : 'none';
  
  // Initialize sync service
  await googleDriveSyncService.initialize({
    enabled: syncEnabled,
    onSyncStart: () => {
      if (syncStatus) {
        syncStatus.textContent = 'Syncing...';
        syncStatus.style.color = 'var(--md-sys-color-primary)';
      }
      if (syncNowBtn) {
        syncNowBtn.disabled = true;
        syncNowBtn.textContent = 'Syncing...';
      }
    },
    onSyncComplete: (result) => {
      if (syncStatus) {
        syncStatus.textContent = 'Synced';
        syncStatus.style.color = 'var(--md-sys-color-primary)';
      }
      if (syncLastTime) {
        syncLastTime.textContent = new Date(result.lastSyncTime).toLocaleString();
      }
      if (syncNowBtn) {
        syncNowBtn.disabled = false;
        syncNowBtn.textContent = 'Sync Now';
      }
      showStatus(`Sync complete: ${result.itemsSynced} items synced`, 'success', 3000);
    },
    onSyncError: (error) => {
      if (syncStatus) {
        syncStatus.textContent = 'Sync failed';
        syncStatus.style.color = 'var(--md-sys-color-error)';
      }
      if (syncNowBtn) {
        syncNowBtn.disabled = false;
        syncNowBtn.textContent = 'Sync Now';
      }
      
      // Handle specific OAuth errors with helpful messages
      let errorMessage = error.message;
      if (errorMessage.includes('access_denied') || errorMessage.includes('403')) {
        errorMessage = 'Add your email as test user in Google Cloud Console (see console for details)';
        console.error('OAuth Setup Required:\n' +
          '1. Go to Google Cloud Console > APIs & Services > OAuth consent screen\n' +
          '2. Click "ADD USERS" under Test users section\n' +
          '3. Add ' + (state.settings.userEmail || 'your email') + '\n' +
          '4. Try sync again\n\n' +
          'Full error:', error.message);
      } else if (errorMessage.includes('bad client id')) {
        errorMessage = 'Extension needs Chrome Web Store key (see console)';
      }
      
      showStatus(`Sync error: ${errorMessage}`, 'error', 8000);
    }
  });
  
  // Update status display
  const status = googleDriveSyncService.getSyncStatus();
  if (status.lastSyncTime && syncLastTime) {
    syncLastTime.textContent = new Date(status.lastSyncTime).toLocaleString();
  }
  
  // Handle checkbox change
  syncCheckbox.addEventListener('change', async () => {
    const enabled = syncCheckbox.checked;
    syncContainer.style.display = enabled ? 'block' : 'none';
    
    // Update settings
    state.settings.syncEnabled = enabled;
    await StorageService.saveSettings(state.settings);
    
    // Update service
    googleDriveSyncService.setSyncEnabled(enabled);
    
    if (enabled) {
      showStatus('Sync enabled - data will sync automatically', 'success', 3000);
    } else {
      showStatus('Sync disabled', 'info', 2000);
    }
  });
  
  // Handle sync now button
  if (syncNowBtn) {
    syncNowBtn.addEventListener('click', async () => {
      try {
        await googleDriveSyncService.syncNow();
      } catch (error) {
        showStatus(`Sync failed: ${error.message}`, 'error');
      }
    });
  }
}

// Export default object
export default {
  initializeSettingsUI,
  updateModelDropdown,
  onProviderChange,
  onModelChange,
  saveApiKey,
  onPromptChange,
  resetPrompt,
  updatePromptStatus,
  onMaxTabsChange,
  initializeSettings,
  initializeRulesUI
};