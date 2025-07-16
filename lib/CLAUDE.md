# lib/ Directory Guide

Third-party libraries used by the extension. All files are minified production versions.

## Current Libraries

### DOM Manipulation

#### morphdom.min.js (12K)
- **Purpose**: Efficient DOM diffing and patching library that updates DOM trees with minimal changes
- **Version**: Minified UMD build
- **Main Functions**: 
  - `morphdom(fromNode, toNode, options)` - Morphs one DOM tree to match another
  - Handles attribute updates, node additions/removals, and special element handling
- **Usage Pattern**:
  ```javascript
  window.morphdom(currentElement, targetElement, {
    onBeforeElUpdated: (fromEl, toEl) => { /* custom logic */ },
    childrenOnly: true  // Only update children, not the element itself
  });
  ```
- **Gotchas**:
  - Always check `window.morphdom` exists before using
  - Be careful with event listeners - they may need re-attachment after morphing
  - Special handling for form elements (INPUT, TEXTAREA, SELECT)
- **Used In**: 
  - `modules/event-handlers.js` - For smooth group collapse/expand transitions
  - `modules/tab-display.js` - For updating tab lists without flickering
  - `modules/saved-tabs-manager.js` - For updating saved tabs display

### Machine Learning

#### tf-core.min.js (290K)
- **Purpose**: TensorFlow.js core runtime - provides low-level tensor operations and platform abstraction
- **Version**: @tensorflow/tfjs-core minified build
- **Key Features**:
  - Tensor creation and manipulation
  - Math operations and linear algebra
  - Memory management and garbage collection
  - Backend registration system
- **Gotchas**:
  - Must be loaded before any other TensorFlow modules
  - Global variable: Adds to `window.tf` namespace
  - Memory intensive - dispose tensors after use

#### tf-layers.min.js (420K)
- **Purpose**: High-level neural network API for TensorFlow.js
- **Version**: @tensorflow/tfjs-layers minified build
- **Key Features**:
  - Sequential and functional model APIs
  - Pre-built layers (Dense, LSTM, Conv2D, etc.)
  - Model training, evaluation, and prediction
  - Model serialization/deserialization
- **Dependencies**: Requires tf-core.min.js
- **Gotchas**:
  - Large file size - load only when ML features are enabled
  - Models can consume significant memory

#### tf-backend-cpu.min.js (130K)
- **Purpose**: Pure JavaScript CPU backend for TensorFlow.js operations
- **Version**: @tensorflow/tfjs-backend-cpu minified build
- **Key Features**:
  - Runs on CPU using JavaScript
  - Compatible with all browsers and web workers
  - Slower but more reliable than WebGL
- **Usage**: Fallback when WebGL is unavailable or for small models
- **Gotchas**:
  - Significantly slower than WebGL for large operations
  - Good for small models or when GPU is unavailable

#### tf-backend-webgl.min.js (392K)
- **Purpose**: WebGL-accelerated backend for TensorFlow.js operations
- **Version**: @tensorflow/tfjs-backend-webgl minified build
- **Key Features**:
  - GPU acceleration via WebGL
  - Much faster than CPU backend for large operations
  - Automatic kernel fusion optimizations
- **Dependencies**: Requires WebGL support in browser
- **Gotchas**:
  - Largest library file (392K)
  - May fail in some environments (workers, old browsers)
  - Memory is limited by GPU VRAM
  - Some operations may fall back to CPU

## Loading Strategy

### Morphdom
- Loaded synchronously in popup.html via script tag
- Required for core UI functionality
- Small size (12K) makes synchronous loading acceptable

### TensorFlow Libraries
- Loaded dynamically by `ml/tensorflow-loader.js`
- Loading order: tf-core → tf-layers → backend (WebGL or CPU)
- Backend selection:
  1. Check user preference (settings.mlBackend)
  2. Try WebGL first (if not CPU-only mode)
  3. Fall back to CPU if WebGL fails
- Loaded only when ML features are enabled to save bandwidth
- Can be loaded in both main thread and web workers

## Important Notes

1. **File Sizes**: Total ML libraries ~1.2MB - significant impact on extension size
2. **Browser Compatibility**: WebGL backend requires modern browser with GPU support
3. **Memory Usage**: TensorFlow can consume significant memory - monitor usage
4. **Worker Support**: CPU backend works in workers, WebGL does not
5. **Error Handling**: Always wrap TF operations in try-catch - backends can fail
6. **Performance**: WebGL is 10-100x faster than CPU for neural networks