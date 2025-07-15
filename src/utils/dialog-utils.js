/*
 * AI Tab Manager - Copyright (c) 2025 AI Tech Knowledge LLC
 * Dialog Utilities - HTML dialog replacements for standard dialogs
 */

/**
 * Create and show an alert dialog
 * @param {string} message - The message to display
 * @param {Object} options - Optional configuration
 * @param {string} options.title - Dialog title (default: 'Alert')
 * @param {string} options.buttonText - Button text (default: 'OK')
 * @returns {Promise<void>}
 */
export async function showAlert(message, options = {}) {
  const { title = 'Alert', buttonText = 'OK' } = options;
  
  const dialog = createDialog({
    title,
    message,
    buttons: [
      { text: buttonText, type: 'primary', action: 'ok' }
    ]
  });
  
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve();
    });
    
    dialog.showModal();
  });
}

/**
 * Create and show a confirm dialog
 * @param {string} message - The message to display
 * @param {Object} options - Optional configuration
 * @param {string} options.title - Dialog title (default: 'Confirm')
 * @param {string} options.confirmText - Confirm button text (default: 'OK')
 * @param {string} options.cancelText - Cancel button text (default: 'Cancel')
 * @param {string} options.confirmType - Button type ('primary', 'warning', 'secondary')
 * @returns {Promise<boolean>} - True if confirmed, false if cancelled
 */
export async function showConfirm(message, options = {}) {
  const { 
    title = 'Confirm', 
    confirmText = 'OK', 
    cancelText = 'Cancel',
    confirmType = 'primary'
  } = options;
  
  const dialog = createDialog({
    title,
    message,
    buttons: [
      { text: confirmText, type: confirmType, action: 'confirm' },
      { text: cancelText, type: 'secondary', action: 'cancel' }
    ]
  });
  
  return new Promise((resolve) => {
    let result = false;
    
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });
    
    // Handle button clicks
    dialog.querySelectorAll('[data-action]').forEach(button => {
      button.addEventListener('click', (e) => {
        if (e.target.dataset.action === 'confirm') {
          result = true;
        }
        dialog.close();
      });
    });
    
    dialog.showModal();
  });
}

/**
 * Create and show a prompt dialog
 * @param {string} message - The message to display
 * @param {Object} options - Optional configuration
 * @param {string} options.title - Dialog title (default: 'Input')
 * @param {string} options.defaultValue - Default input value
 * @param {string} options.placeholder - Input placeholder
 * @param {string} options.confirmText - Confirm button text (default: 'OK')
 * @param {string} options.cancelText - Cancel button text (default: 'Cancel')
 * @returns {Promise<string|null>} - Input value if confirmed, null if cancelled
 */
export async function showPrompt(message, options = {}) {
  const { 
    title = 'Input', 
    defaultValue = '', 
    placeholder = '',
    confirmText = 'OK', 
    cancelText = 'Cancel'
  } = options;
  
  const dialog = createDialog({
    title,
    message,
    input: {
      defaultValue,
      placeholder
    },
    buttons: [
      { text: confirmText, type: 'primary', action: 'confirm' },
      { text: cancelText, type: 'secondary', action: 'cancel' }
    ]
  });
  
  return new Promise((resolve) => {
    let result = null;
    const input = dialog.querySelector('.dialog-input');
    
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });
    
    // Handle button clicks
    dialog.querySelectorAll('[data-action]').forEach(button => {
      button.addEventListener('click', (e) => {
        if (e.target.dataset.action === 'confirm') {
          result = input.value;
        }
        dialog.close();
      });
    });
    
    // Handle Enter key in input
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        result = input.value;
        dialog.close();
      }
    });
    
    dialog.showModal();
    
    // Focus the input after showing
    input.focus();
    input.select();
  });
}

/**
 * Create a dialog element
 * @private
 */
function createDialog(config) {
  const dialog = document.createElement('dialog');
  dialog.className = 'ai-dialog';
  
  const content = document.createElement('div');
  content.className = 'dialog-content';
  
  // Add title if provided
  if (config.title) {
    const title = document.createElement('h3');
    title.textContent = config.title;
    content.appendChild(title);
  }
  
  // Add message
  if (config.message) {
    const messageEl = document.createElement('p');
    messageEl.className = 'dialog-message';
    // Support multi-line messages
    if (config.message.includes('\n')) {
      messageEl.innerHTML = config.message.split('\n').map(line => {
        if (!line) return '<br>';
        // Escape HTML but preserve formatting
        const escaped = line.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<div style="margin: 4px 0">${escaped}</div>`;
      }).join('');
    } else {
      messageEl.textContent = config.message;
    }
    content.appendChild(messageEl);
  }
  
  // Add input if needed
  if (config.input) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'dialog-input';
    input.value = config.input.defaultValue || '';
    input.placeholder = config.input.placeholder || '';
    content.appendChild(input);
  }
  
  // Add checkboxes if needed
  if (config.checkboxes && config.checkboxes.length > 0) {
    const checkboxContainer = document.createElement('div');
    checkboxContainer.className = 'dialog-checkboxes';
    
    config.checkboxes.forEach((checkboxConfig, index) => {
      const label = document.createElement('label');
      label.className = 'dialog-checkbox-label';
      
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'dialog-checkbox';
      checkbox.id = `dialog-checkbox-${index}`;
      checkbox.checked = checkboxConfig.checked || false;
      checkbox.dataset.name = checkboxConfig.name || `checkbox-${index}`;
      
      const span = document.createElement('span');
      span.textContent = checkboxConfig.label;
      
      label.appendChild(checkbox);
      label.appendChild(span);
      checkboxContainer.appendChild(label);
    });
    
    content.appendChild(checkboxContainer);
  }
  
  // Add buttons
  const buttonContainer = document.createElement('div');
  buttonContainer.className = 'dialog-buttons';
  
  config.buttons.forEach(buttonConfig => {
    const button = document.createElement('button');
    button.className = `dialog-btn ${buttonConfig.type}`;
    button.textContent = buttonConfig.text;
    button.dataset.action = buttonConfig.action;
    buttonContainer.appendChild(button);
  });
  
  content.appendChild(buttonContainer);
  dialog.appendChild(content);
  
  // Add to document
  document.body.appendChild(dialog);
  
  // Handle Escape key
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      dialog.close();
    }
  });
  
  return dialog;
}

/**
 * Create and show a confirm dialog with checkboxes
 * @param {string} message - The message to display
 * @param {Object} options - Optional configuration
 * @param {string} options.title - Dialog title (default: 'Confirm')
 * @param {string} options.confirmText - Confirm button text (default: 'OK')
 * @param {string} options.cancelText - Cancel button text (default: 'Cancel')
 * @param {string} options.confirmType - Button type ('primary', 'warning', 'secondary')
 * @param {Array} options.checkboxes - Array of checkbox configs {name, label, checked}
 * @returns {Promise<{confirmed: boolean, checkboxes: Object}>} - Result with checkbox states
 */
export async function showConfirmWithCheckboxes(message, options = {}) {
  const { 
    title = 'Confirm', 
    confirmText = 'OK', 
    cancelText = 'Cancel',
    confirmType = 'primary',
    checkboxes = []
  } = options;
  
  const dialog = createDialog({
    title,
    message,
    checkboxes,
    buttons: [
      { text: confirmText, type: confirmType, action: 'confirm' },
      { text: cancelText, type: 'secondary', action: 'cancel' }
    ]
  });
  
  return new Promise((resolve) => {
    let result = { confirmed: false, checkboxes: {} };
    
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });
    
    // Handle button clicks
    dialog.querySelectorAll('[data-action]').forEach(button => {
      button.addEventListener('click', (e) => {
        if (e.target.dataset.action === 'confirm') {
          result.confirmed = true;
          // Collect checkbox states
          dialog.querySelectorAll('.dialog-checkbox').forEach(checkbox => {
            result.checkboxes[checkbox.dataset.name] = checkbox.checked;
          });
        }
        dialog.close();
      });
    });
    
    dialog.showModal();
  });
}

/**
 * Update smartConfirm to use HTML dialogs
 * This is a drop-in replacement for the existing smartConfirm
 */
export async function smartConfirm(message, options = {}) {
  // In test mode, use programmatic control
  if (window.testMode && window.testMode.confirm) {
    const testConfig = window.testMode.confirm;
    if (typeof testConfig.answer !== 'undefined') {
      console.log('Test mode confirm:', message, 'Answer:', testConfig.answer);
      return testConfig.answer;
    }
  }
  
  // Use HTML dialog for normal mode
  return showConfirm(message, {
    confirmType: 'primary',
    ...options
  });
}