/**
 * Centralized logging system for all extension subsystems
 * Controls debug output, diagnostics, and production logging
 */

class Logger {
    constructor() {
        // Default configuration for all subsystems
        this.defaultConfig = {
            // Production logging (always enabled)
            errors: true,
            warnings: true,
            info: true,

            // General debug logging
            debug: false,
            verbose: false,
            
            // ML subsystem logging
            ml: {
                diagnostics: false,
                training: false,
                features: false,
                architecture: false,
                confusion: false,
                categorization: false
            },
            
            // UI subsystem logging
            ui: {
                rendering: false,
                events: false,
                morphdom: false,
                state: false
            },
            
            // Services subsystem logging
            services: {
                database: false,
                background: false,
                storage: false,
                search: false
            },
            
            // Data flow logging
            data: {
                pipeline: false,
                grouping: false,
                sorting: false,
                filtering: false
            },
            
            // Performance logging
            performance: {
                timings: false,
                memory: false,
                caching: false
            },
            
            // Development utilities
            dev: false
        };

        this.config = this.deepCopy(this.defaultConfig);

        // Load configuration from localStorage if available
        this.loadConfig();
        
        // Initialize ML config integration
        this.initializeMLConfig();
    }

    /**
     * Deep copy utility for nested configuration
     */
    deepCopy(obj) {
        if (obj === null || typeof obj !== 'object') return obj;
        if (obj instanceof Date) return new Date(obj.getTime());
        if (obj instanceof Array) return obj.map(item => this.deepCopy(item));
        if (typeof obj === 'object') {
            const copy = {};
            Object.keys(obj).forEach(key => {
                copy[key] = this.deepCopy(obj[key]);
            });
            return copy;
        }
    }

    /**
     * Initialize ML config integration
     */
    initializeMLConfig() {
        try {
            // Try to load ML_CONFIG if available
            if (typeof window !== 'undefined' && window.ML_CONFIG && window.ML_CONFIG.logging) {
                // Map old ML config format to new nested format
                const mlConfig = window.ML_CONFIG.logging;
                if (mlConfig.diagnostics !== undefined) this.config.ml.diagnostics = mlConfig.diagnostics;
                if (mlConfig.training !== undefined) this.config.ml.training = mlConfig.training;
                if (mlConfig.features !== undefined) this.config.ml.features = mlConfig.features;
                if (mlConfig.architecture !== undefined) this.config.ml.architecture = mlConfig.architecture;
                if (mlConfig.confusion !== undefined) this.config.ml.confusion = mlConfig.confusion;
            }
        } catch (e) {
            // Ignore errors, use defaults
        }
    }

    /**
     * Load logging configuration from localStorage
     */
    loadConfig() {
        try {
            const saved = localStorage.getItem('ml-logger-config');
            if (saved) {
                const config = JSON.parse(saved);
                this.config = { ...this.config, ...config };
            }
        } catch (e) {
            // Ignore errors, use defaults
        }
    }

    /**
     * Save logging configuration to localStorage
     */
    saveConfig() {
        try {
            localStorage.setItem('ml-logger-config', JSON.stringify(this.config));
            
            // Notify workers of configuration change
            this.notifyWorkers();
        } catch (e) {
            // Ignore errors
        }
    }

    /**
     * Notify workers of logging configuration changes
     */
    notifyWorkers() {
        try {
            // Try to find any available worker managers
            if (typeof window !== 'undefined') {
                // Check common worker manager patterns
                const managers = [
                    window.workerManager,
                    window.mlWorkerManager,
                    window.trainingWorkerManager
                ];
                
                for (const manager of managers) {
                    if (manager && manager.isInitialized && manager.worker) {
                        manager.worker.postMessage({
                            type: 'CONFIGURE_LOGGING',
                            data: this.config
                        });
                    }
                }
            }
        } catch (e) {
            // Ignore errors - workers may not be available
        }
    }

    /**
     * Configure logging levels
     * @param {Object} options - Configuration options
     */
    configure(options = {}) {
        this.config = this.deepMerge(this.config, options);
        this.saveConfig();
    }

    /**
     * Deep merge utility for nested configuration
     */
    deepMerge(target, source) {
        const result = { ...target };
        Object.keys(source).forEach(key => {
            if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                result[key] = this.deepMerge(target[key] || {}, source[key]);
            } else {
                result[key] = source[key];
            }
        });
        return result;
    }

    /**
     * Enable specific logging categories
     * @param {string|Array} categories - Category names to enable (supports nested: 'ml.training', 'ui.rendering')
     */
    enable(categories) {
        const cats = Array.isArray(categories) ? categories : [categories];
        cats.forEach(cat => {
            this.setCategoryValue(cat, true);
        });
        this.saveConfig();
    }

    /**
     * Disable specific logging categories
     * @param {string|Array} categories - Category names to disable (supports nested: 'ml.training', 'ui.rendering')
     */
    disable(categories) {
        const cats = Array.isArray(categories) ? categories : [categories];
        cats.forEach(cat => {
            this.setCategoryValue(cat, false);
        });
        this.saveConfig();
    }

    /**
     * Set a category value (supports nested categories like 'ml.training')
     */
    setCategoryValue(category, value) {
        const parts = category.split('.');
        let current = this.config;
        
        for (let i = 0; i < parts.length - 1; i++) {
            if (!(parts[i] in current)) {
                current[parts[i]] = {};
            }
            current = current[parts[i]];
        }
        
        const lastPart = parts[parts.length - 1];
        if (lastPart in current || parts.length === 1) {
            current[lastPart] = value;
        }
    }

    /**
     * Check if a logging category is enabled
     * @param {string} category - Category name (supports nested: 'ml.training', 'ui.rendering')
     * @returns {boolean} Whether the category is enabled
     */
    isEnabled(category) {
        const parts = category.split('.');
        let current = this.config;
        
        for (const part of parts) {
            if (current === null || typeof current !== 'object' || !(part in current)) {
                return false;
            }
            current = current[part];
        }
        
        return current === true;
    }

    // Production logging methods (always enabled)
    error(...args) {
        if (this.config.errors) {
            console.error(...args);
        }
    }

    warn(...args) {
        if (this.config.warnings) {
            console.warn(...args);
        }
    }

    info(...args) {
        if (this.config.info) {
            console.info(...args);
        }
    }

    // Debug logging methods
    debug(...args) {
        if (this.config.debug) {
            console.log('[DEBUG]', ...args);
        }
    }

    verbose(...args) {
        if (this.config.verbose) {
            console.log('[VERBOSE]', ...args);
        }
    }

    // ML subsystem logging methods
    mlDiagnostic(...args) {
        if (this.isEnabled('ml.diagnostics')) {
            console.log('🔍 [ML-DIAGNOSTIC]', ...args);
        }
    }

    mlTraining(...args) {
        if (this.isEnabled('ml.training')) {
            console.log('🏋️ [ML-TRAINING]', ...args);
        }
    }

    mlFeatures(...args) {
        if (this.isEnabled('ml.features')) {
            console.log('📊 [ML-FEATURES]', ...args);
        }
    }

    mlArchitecture(...args) {
        if (this.isEnabled('ml.architecture')) {
            console.log('🏗️ [ML-ARCHITECTURE]', ...args);
        }
    }

    mlConfusion(...args) {
        if (this.isEnabled('ml.confusion')) {
            console.log('🔍 [ML-CONFUSION]', ...args);
        }
    }

    mlCategorization(...args) {
        if (this.isEnabled('ml.categorization')) {
            console.log('🎯 [ML-CATEGORIZATION]', ...args);
        }
    }

    // UI subsystem logging methods
    uiRendering(...args) {
        if (this.isEnabled('ui.rendering')) {
            console.log('🎨 [UI-RENDERING]', ...args);
        }
    }

    uiEvents(...args) {
        if (this.isEnabled('ui.events')) {
            console.log('🖱️ [UI-EVENTS]', ...args);
        }
    }

    uiMorphdom(...args) {
        if (this.isEnabled('ui.morphdom')) {
            console.log('🔄 [UI-MORPHDOM]', ...args);
        }
    }

    uiState(...args) {
        if (this.isEnabled('ui.state')) {
            console.log('📋 [UI-STATE]', ...args);
        }
    }

    // Services subsystem logging methods
    serviceDatabase(...args) {
        if (this.isEnabled('services.database')) {
            console.log('🗄️ [SERVICE-DATABASE]', ...args);
        }
    }

    serviceBackground(...args) {
        if (this.isEnabled('services.background')) {
            console.log('⚙️ [SERVICE-BACKGROUND]', ...args);
        }
    }

    serviceStorage(...args) {
        if (this.isEnabled('services.storage')) {
            console.log('💾 [SERVICE-STORAGE]', ...args);
        }
    }

    serviceSearch(...args) {
        if (this.isEnabled('services.search')) {
            console.log('🔍 [SERVICE-SEARCH]', ...args);
        }
    }

    // Data flow logging methods
    dataPipeline(...args) {
        if (this.isEnabled('data.pipeline')) {
            console.log('🔄 [DATA-PIPELINE]', ...args);
        }
    }

    dataGrouping(...args) {
        if (this.isEnabled('data.grouping')) {
            console.log('📦 [DATA-GROUPING]', ...args);
        }
    }

    dataSorting(...args) {
        if (this.isEnabled('data.sorting')) {
            console.log('🔀 [DATA-SORTING]', ...args);
        }
    }

    dataFiltering(...args) {
        if (this.isEnabled('data.filtering')) {
            console.log('🔍 [DATA-FILTERING]', ...args);
        }
    }

    // Performance logging methods
    performanceTimings(...args) {
        if (this.isEnabled('performance.timings')) {
            console.log('⏱️ [PERFORMANCE-TIMINGS]', ...args);
        }
    }

    performanceMemory(...args) {
        if (this.isEnabled('performance.memory')) {
            console.log('🧠 [PERFORMANCE-MEMORY]', ...args);
        }
    }

    performanceCaching(...args) {
        if (this.isEnabled('performance.caching')) {
            console.log('💽 [PERFORMANCE-CACHING]', ...args);
        }
    }

    // Development utilities
    dev(...args) {
        if (this.config.dev) {
            console.log('🔧 [DEV]', ...args);
        }
    }

    // Legacy ML methods for backward compatibility
    diagnostic(...args) {
        this.mlDiagnostic(...args);
    }

    training(...args) {
        this.mlTraining(...args);
    }

    features(...args) {
        this.mlFeatures(...args);
    }

    architecture(...args) {
        this.mlArchitecture(...args);
    }

    confusion(...args) {
        this.mlConfusion(...args);
    }

    // Utility methods
    group(name, enabled = true) {
        if (enabled) {
            console.group(name);
        }
        return enabled;
    }

    groupEnd(enabled = true) {
        if (enabled) {
            console.groupEnd();
        }
    }

    time(label, enabled = true) {
        if (enabled) {
            console.time(label);
        }
    }

    timeEnd(label, enabled = true) {
        if (enabled) {
            console.timeEnd(label);
        }
    }

    /**
     * Get current configuration
     * @returns {Object} Current logging configuration
     */
    getConfig() {
        return { ...this.config };
    }

    /**
     * Reset configuration to defaults
     */
    reset() {
        this.config = this.deepCopy(this.defaultConfig);
        this.initializeMLConfig();
        this.saveConfig();
    }

    /**
     * Enable all debug logging (for development)
     */
    enableAll() {
        this.setAllCategories(true);
        this.saveConfig();
    }

    /**
     * Disable all debug logging (for production)
     */
    disableAll() {
        this.setAllCategories(false);
        // Keep production logging enabled
        this.config.errors = true;
        this.config.warnings = true;
        this.config.info = true;
        this.saveConfig();
    }

    /**
     * Set all categories to a specific value
     */
    setAllCategories(value, obj = this.config, isRoot = true) {
        Object.keys(obj).forEach(key => {
            if (key === 'errors' || key === 'warnings' || key === 'info') {
                // Never change production logging
                return;
            }
            if (typeof obj[key] === 'object' && obj[key] !== null) {
                this.setAllCategories(value, obj[key], false);
            } else if (typeof obj[key] === 'boolean') {
                obj[key] = value;
            }
        });
    }
}

// Create singleton instance
const logger = new Logger();

// Export for both ES6 and CommonJS
if (typeof module !== 'undefined' && module.exports) {
    module.exports = logger;
} else if (typeof window !== 'undefined') {
    window.logger = logger;
    window.mlLogger = logger; // Backward compatibility
    
    // Add console interface for easy debugging
    window.loggerHelp = function() {
        console.log(`
🔧 Extension Logger Console Interface

Basic Commands:
  logger.getConfig()                    - Show current configuration
  logger.enable('debug')                - Enable debug logging  
  logger.disable('debug')               - Disable debug logging
  logger.enableAll()                    - Enable all logging
  logger.disableAll()                   - Disable all debug logging
  logger.reset()                        - Reset to defaults

Subsystem Categories (use nested format):
  ML: 'ml.diagnostics', 'ml.training', 'ml.features', 'ml.architecture', 'ml.confusion', 'ml.categorization'
  UI: 'ui.rendering', 'ui.events', 'ui.morphdom', 'ui.state'
  Services: 'services.database', 'services.background', 'services.storage', 'services.search'
  Data: 'data.pipeline', 'data.grouping', 'data.sorting', 'data.filtering'
  Performance: 'performance.timings', 'performance.memory', 'performance.caching'
  General: 'debug', 'verbose', 'dev'

Quick Presets:
  logger.enable(['ml.training', 'ml.diagnostics'])     - ML debugging
  logger.enable(['ui.rendering', 'ui.events'])         - UI debugging
  logger.enable(['services.database', 'data.pipeline']) - Data flow debugging
  logger.configure({ ml: { training: true }, ui: { rendering: true } })

Example Usage:
  logger.mlTraining('Model accuracy:', 0.85)
  logger.uiRendering('Updating DOM with:', data)
  logger.serviceDatabase('Query executed:', query)
  logger.performanceTimings('Operation took:', duration)
        `);
    };
    
    // Legacy help function
    window.mlLoggerHelp = window.loggerHelp;
    
    // Logger initialized - silent for clean console (use loggerHelp() to see usage)
}
logger.disableAll(); // Start with all debug logging disabled
export default logger;