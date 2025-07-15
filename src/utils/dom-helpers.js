/*
 * AI Tab Manager - Copyright (c) 2025 AI Tech Knowledge LLC
 * DOM manipulation helpers - jQuery-like convenience without the overhead
 */

/**
 * jQuery-like selector function
 * @param {string} selector - CSS selector
 * @param {Element} context - Context element (default: document)
 * @returns {Element|NodeList|null}
 */
export function $(selector, context = document) {
  if (selector.startsWith('#') && !selector.includes(' ')) {
    // Optimize for ID selectors
    return context.getElementById(selector.slice(1));
  }
  const elements = context.querySelectorAll(selector);
  return elements.length === 1 ? elements[0] : elements;
}

/**
 * Get element by ID using DOM_IDS constant
 * @param {string} id - ID from DOM_IDS constant
 * @returns {Element|null}
 */
export function $id(id) {
  return document.getElementById(id);
}

/**
 * Show element(s)
 * @param {Element|NodeList|string} elements - Element(s) or selector
 * @param {string} displayType - Display type (default: 'block')
 */
export function show(elements, displayType = 'block') {
  const els = typeof elements === 'string' ? $(elements) : elements;
  if (els instanceof NodeList) {
    els.forEach(el => el.style.display = displayType);
  } else if (els) {
    els.style.display = displayType;
  }
}

/**
 * Hide element(s)
 * @param {Element|NodeList|string} elements - Element(s) or selector
 */
export function hide(elements) {
  const els = typeof elements === 'string' ? $(elements) : elements;
  if (els instanceof NodeList) {
    els.forEach(el => el.style.display = 'none');
  } else if (els) {
    els.style.display = 'none';
  }
}

/**
 * Toggle element visibility
 * @param {Element|string} element - Element or selector
 * @param {boolean} force - Force show/hide
 */
export function toggle(element, force) {
  const el = typeof element === 'string' ? $(element) : element;
  if (!el) return;
  
  if (force !== undefined) {
    el.style.display = force ? 'block' : 'none';
  } else {
    el.style.display = el.style.display === 'none' ? 'block' : 'none';
  }
}

/**
 * Add event listener with automatic cleanup
 * @param {Element|string} element - Element or selector
 * @param {string} event - Event type
 * @param {Function} handler - Event handler
 * @param {Object} options - Event options
 * @returns {Function} Cleanup function
 */
export function on(element, event, handler, options) {
  const el = typeof element === 'string' ? $(element) : element;
  if (!el) return () => {};
  
  if (el instanceof NodeList) {
    const cleanups = Array.from(el).map(e => {
      e.addEventListener(event, handler, options);
      return () => e.removeEventListener(event, handler, options);
    });
    return () => cleanups.forEach(fn => fn());
  } else {
    el.addEventListener(event, handler, options);
    return () => el.removeEventListener(event, handler, options);
  }
}

/**
 * Create element with properties
 * @param {string} tag - HTML tag
 * @param {Object} props - Properties and attributes
 * @param {Array|string} children - Child elements or text
 * @returns {Element}
 */
export function createElement(tag, props = {}, children = []) {
  const el = document.createElement(tag);
  
  // Set properties
  Object.entries(props).forEach(([key, value]) => {
    if (key === 'className') {
      el.className = value;
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'dataset') {
      Object.assign(el.dataset, value);
    } else {
      el[key] = value;
    }
  });
  
  // Add children
  const childArray = Array.isArray(children) ? children : [children];
  childArray.forEach(child => {
    if (typeof child === 'string') {
      el.appendChild(document.createTextNode(child));
    } else if (child instanceof Element) {
      el.appendChild(child);
    }
  });
  
  return el;
}

/**
 * Batch DOM updates for better performance
 * @param {Function} updates - Function containing DOM updates
 */
export function batchUpdate(updates) {
  requestAnimationFrame(updates);
}

/**
 * Add/remove/toggle classes
 */
export const classes = {
  add(element, ...classNames) {
    const el = typeof element === 'string' ? $(element) : element;
    if (el instanceof NodeList) {
      el.forEach(e => e.classList.add(...classNames));
    } else if (el) {
      el.classList.add(...classNames);
    }
  },
  
  remove(element, ...classNames) {
    const el = typeof element === 'string' ? $(element) : element;
    if (el instanceof NodeList) {
      el.forEach(e => e.classList.remove(...classNames));
    } else if (el) {
      el.classList.remove(...classNames);
    }
  },
  
  toggle(element, className, force) {
    const el = typeof element === 'string' ? $(element) : element;
    if (el instanceof NodeList) {
      el.forEach(e => e.classList.toggle(className, force));
    } else if (el) {
      el.classList.toggle(className, force);
    }
  },
  
  has(element, className) {
    const el = typeof element === 'string' ? $(element) : element;
    return el ? el.classList.contains(className) : false;
  }
};

/**
 * Simple animation helper
 * @param {Element} element - Element to animate
 * @param {Object} properties - CSS properties to animate
 * @param {number} duration - Duration in ms
 * @returns {Promise}
 */
export function animate(element, properties, duration = 300) {
  return new Promise(resolve => {
    const el = typeof element === 'string' ? $(element) : element;
    if (!el) {
      resolve();
      return;
    }
    
    el.style.transition = `all ${duration}ms ease`;
    Object.assign(el.style, properties);
    
    setTimeout(() => {
      el.style.transition = '';
      resolve();
    }, duration);
  });
}

/**
 * Wait for element to appear in DOM
 * @param {string} selector - CSS selector
 * @param {number} timeout - Timeout in ms
 * @returns {Promise<Element>}
 */
export function waitForElement(selector, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const el = $(selector);
    if (el) {
      resolve(el);
      return;
    }
    
    const observer = new MutationObserver(() => {
      const el = $(selector);
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
    
    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Element ${selector} not found within ${timeout}ms`));
    }, timeout);
  });
}

// Export a default object for convenience
export default {
  $,
  $id,
  show,
  hide,
  toggle,
  on,
  createElement,
  batchUpdate,
  classes,
  animate,
  waitForElement
};