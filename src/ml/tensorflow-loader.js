/*
 * AI Tab Manager - Copyright (c) 2025 AI Tech Knowledge LLC
 * TensorFlow.js loader for WebGL and CPU backends
 */

// TensorFlow.js instance
let tf = null;
let availableBackends = [];
let currentBackend = null;
let loadingPromise = null;

// Import logger for conditional debug output
import logger from '../utils/logger.js';

/**
 * Dynamically load a script
 */
async function loadScript(src) {
  // Check if we're in a Worker context
  if (typeof importScripts !== 'undefined') {
    // In Worker - use importScripts
    try {
      const workerUrl = self.location.href;
      const baseUrl = workerUrl.substring(0, workerUrl.lastIndexOf('/src/'));
      importScripts(baseUrl + '/' + src);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }
  
  // In main thread - use script tag
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const fullUrl = browser.runtime.getURL(src);
    script.src = fullUrl;
    script.onload = resolve;
    script.onerror = () => {
      console.debug(`Failed to load TensorFlow.js resource: ${src} (${fullUrl})`);
      reject(new Error(`Failed to load: ${src}`));
    };
    document.head.appendChild(script);
  });
}

/**
 * Check if CPU-only mode is preferred
 */
function isCPUOnly() {
  // Check if we're in a Worker context
  if (typeof localStorage === 'undefined') {
    // In Worker context, default to auto-selection
    return false;
  }
  const settings = JSON.parse(localStorage.getItem('settings') || '{}');
  return settings.mlBackend === 'cpu';
}

/**
 * Load TensorFlow.js with appropriate backends
 */
export function loadTensorFlow() {
  if (tf) return Promise.resolve(tf);
  if (loadingPromise) return loadingPromise;
  
  loadingPromise = new Promise((resolve) => {
    (async () => {
      try {
        logger.mlArchitecture('Loading TensorFlow.js...');
        const preferGPU = !isCPUOnly();
        
        // Load core first
        await loadScript('lib/tf-core.min.js');
        
        // Load CPU backend (always available as fallback)
        await loadScript('lib/tf-backend-cpu.min.js');
        availableBackends.push('cpu');
        
        // Try to load WebGL backend for GPU acceleration
        if (preferGPU) {
          try {
            await loadScript('lib/tf-backend-webgl.min.js');
            availableBackends.push('webgl');
            logger.mlArchitecture('WebGL backend loaded successfully');
          } catch (webglError) {
            console.warn('WebGL backend failed to load, GPU acceleration not available:', webglError);
          }
        }
        
        // Load layers API
        await loadScript('lib/tf-layers.min.js');
        
        logger.mlArchitecture('TensorFlow.js loaded with backends:', availableBackends);
        
        // Store globally for other modules
        // In worker context, tf is global; in main thread, it's on window
        tf = typeof window !== 'undefined' ? window.tf : self.tf;
        
        // Initialize the best backend
        currentBackend = await initializeBestBackend(preferGPU);
        logger.mlArchitecture('TensorFlow.js initialized with backend:', currentBackend);
        
        resolve(tf);
      } catch (error) {
        console.error('Failed to load TensorFlow.js:', error);
        resolve(null);
      }
    })();
  });
  
  return loadingPromise;
}

/**
 * Initialize the best available backend
 * @param {boolean} preferGPU - Whether to prefer GPU
 * @returns {Promise<string>} The backend that was initialized
 */
async function initializeBestBackend(preferGPU) {
  if (!tf) {
    throw new Error('TensorFlow.js not loaded');
  }
  
  try {
    logger.mlArchitecture('Available backends:', availableBackends);
    logger.mlArchitecture('Current backend before initialization:', tf.getBackend());
    
    // Try WebGL first if GPU is preferred
    if (preferGPU && availableBackends.includes('webgl')) {
      try {
        logger.mlArchitecture('Setting backend to WebGL...');
        await tf.setBackend('webgl');
        await tf.ready();
        
        // Test WebGL functionality
        const testTensor = tf.ones([2, 2]);
        const testTensor2 = tf.ones([2, 2]);
        const result = tf.add(testTensor, testTensor2);
        await result.data();
        testTensor.dispose();
        testTensor2.dispose();
        result.dispose();
        
        logger.mlArchitecture('WebGL backend initialized successfully');
        return 'webgl';
      } catch (webglError) {
        console.warn('WebGL backend failed:', webglError);
      }
    }
    
    // Fall back to CPU
    logger.mlArchitecture('Using CPU backend');
    await tf.setBackend('cpu');
    await tf.ready();
    
    // Test CPU functionality
    const testTensor = tf.ones([2, 2]);
    await testTensor.data();
    testTensor.dispose();
    
    logger.mlArchitecture('CPU backend initialized successfully');
    return 'cpu';
    
  } catch (error) {
    console.error('Failed to initialize TensorFlow backend:', error);
    throw error;
  }
}

/**
 * Get TensorFlow.js instance
 */
export function getTensorFlow() {
  return tf;
}

/**
 * Get current backend
 */
export function getCurrentBackend() {
  return currentBackend;
}

/**
 * Check if TensorFlow.js is loaded
 */
export function isLoaded() {
  return tf !== null;
}

/**
 * Get available backends
 */
export function getAvailableBackends() {
  return [...availableBackends];
}

/**
 * Get backend information
 */
export function getBackendInfo() {
  if (!tf) {
    return {
      backend: null,
      actualBackend: null,
      available: [],
      isWebGL: false,
      isCPU: false
    };
  }
  
  const actualBackend = tf.getBackend();
  const isWebGL = actualBackend === 'webgl';
  let isGPU = false;
  
  // Check if WebGL is actually using GPU acceleration
  if (isWebGL && tf.env().getNumber('WEBGL_VERSION') > 0) {
    // WebGL is active, but we need to check if it's hardware accelerated
    const gl = tf.backend().gpgpu?.gl;
    if (gl) {
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
        logger.mlArchitecture('WebGL Renderer:', renderer);
        // Check if renderer indicates software rendering
        isGPU = !renderer.toLowerCase().includes('swiftshader') && 
                !renderer.toLowerCase().includes('llvmpipe') &&
                !renderer.toLowerCase().includes('software');
      } else {
        // If we can't get debug info, assume GPU if WebGL is active
        isGPU = true;
      }
    }
  }
  
  return {
    backend: currentBackend,
    actualBackend: actualBackend,
    available: availableBackends,
    isWebGL: isWebGL,
    isCPU: actualBackend === 'cpu',
    isGPU: isGPU
  };
}

/**
 * Switch to a different backend
 * @param {string} backend - Backend to switch to ('webgl' or 'cpu')
 */
export async function switchBackend(backend) {
  if (!tf) {
    throw new Error('TensorFlow.js not loaded');
  }
  
  if (!availableBackends.includes(backend)) {
    throw new Error(`Backend ${backend} is not available. Available: ${availableBackends.join(', ')}`);
  }
  
  try {
    logger.mlArchitecture(`Switching backend from ${tf.getBackend()} to ${backend}...`);
    await tf.setBackend(backend);
    await tf.ready();
    currentBackend = backend;
    logger.mlArchitecture(`Successfully switched to ${backend} backend`);
    return true;
  } catch (error) {
    console.error(`Failed to switch to ${backend} backend:`, error);
    return false;
  }
}

// Export the initialization function as default
export default loadTensorFlow;