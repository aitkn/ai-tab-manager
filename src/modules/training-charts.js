/*
 * AI Tab Manager - Training Progress Charts
 * Provides real-time training visualization with loss and accuracy charts
 */

import { ML_CONFIG } from '../ml/model-config.js';

/**
 * Training Charts Manager
 * Handles real-time charting of training progress
 */
export class TrainingCharts {
  constructor() {
    this.lossChartFull = null;
    this.lossChartRecent = null;
    this.accuracyChartFull = null;
    this.accuracyChartRecent = null;
    this.isVisible = false;
    this.dataBuffer = {
      epochs: [],
      trainLoss: [],
      valLoss: [],
      trainAccuracy: [],
      valAccuracy: []
    };
    this.lastEpoch = 0; // Track last epoch for training interruption recovery
  }

  /**
   * Initialize the charts
   */
  async initialize() {
    this.setupCharts();
    this.show();
    
    // Set up theme change listener
    this.setupThemeListener();
    
    // Load and display last training data if available
    await this.loadLastTrainingData();
  }

  /**
   * Setup theme change listener
   */
  setupThemeListener() {
    // Use MutationObserver to watch for data-theme changes on body
    this.themeObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
          this.updateCharts();
        }
      });
    });

    // Start observing data-theme attribute changes on body
    this.themeObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['data-theme']
    });
    
    // Listen for training progress events from background training
    this.setupTrainingProgressListener();
  }
  
  /**
   * Setup listener for training progress from background training
   */
  setupTrainingProgressListener() {
    // Listen for custom training progress events
    const progressHandler = (event) => {
      const progress = event.detail;
      
      if (progress.epoch !== undefined && progress.loss !== undefined) {
        const valAccuracy = progress.valAccuracy || progress.accuracy || 0;
        // Training progress logged via dedicated training progress events only
        this.addDataPoint(
          progress.epoch, // epoch already calculated as actualEpochs in worker
          progress.loss,
          progress.valLoss || progress.loss,
          progress.trainAccuracy || progress.accuracy || 0,
          progress.valAccuracy || progress.accuracy || 0
        );
        
        // Training history is automatically saved by the training system in model metadata
      }
    };
    
    const startHandler = (event) => {
      const { isIncremental } = event.detail || {};
      
      // Only clear if this is a fresh training (not incremental)
      if (!isIncremental) {
        this.clear();
        this.lastEpoch = 0; // Reset epoch tracker for fresh training
      }
      // For incremental training, lastEpoch is preserved to continue from where we left off
    };
    
    // Store references for potential cleanup
    this.progressHandler = progressHandler;
    this.startHandler = startHandler;
    
    window.addEventListener('trainingProgress', progressHandler);
    window.addEventListener('trainingStarted', startHandler);
  }

  /**
   * Setup all four charts (full and recent for both loss and accuracy)
   */
  setupCharts() {
    const lossCanvasFull = document.getElementById('lossChartFull');
    const lossCanvasRecent = document.getElementById('lossChartRecent');
    const accuracyCanvasFull = document.getElementById('accuracyChartFull');
    const accuracyCanvasRecent = document.getElementById('accuracyChartRecent');
    
    if (!lossCanvasFull || !lossCanvasRecent || !accuracyCanvasFull || !accuracyCanvasRecent) {
      console.error('Chart canvases not found:', { 
        lossCanvasFull: !!lossCanvasFull, 
        lossCanvasRecent: !!lossCanvasRecent,
        accuracyCanvasFull: !!accuracyCanvasFull,
        accuracyCanvasRecent: !!accuracyCanvasRecent 
      });
      return;
    }

    // Setup loss charts
    this.lossChartFull = this.createChart(lossCanvasFull, {
      title: 'Loss (Full)',
      yLabel: 'Loss',
      logScale: true,
      yAxisSide: 'left',
      showLegend: true,
      datasets: [
        {
          label: 'Training',
          color: '#2196F3',
          data: []
        },
        {
          label: 'Validation', 
          color: '#FF9800',
          data: []
        }
      ]
    });

    this.lossChartRecent = this.createChart(lossCanvasRecent, {
      title: 'Loss (Recent)',
      yLabel: 'Loss',
      logScale: true,
      yAxisSide: 'right',
      showLegend: false,
      reverseXAxis: true,
      datasets: [
        {
          label: 'Training',
          color: '#2196F3',
          data: []
        },
        {
          label: 'Validation', 
          color: '#FF9800',
          data: []
        }
      ]
    });

    // Setup accuracy charts
    this.accuracyChartFull = this.createChart(accuracyCanvasFull, {
      title: 'Accuracy (Full)',
      yLabel: 'Accuracy',
      logScale: false,
      yMin: 0,
      yMax: 1,
      yAxisSide: 'left',
      showLegend: true,
      datasets: [
        {
          label: 'Training',
          color: '#4CAF50',
          data: []
        },
        {
          label: 'Validation',
          color: '#9C27B0', 
          data: []
        }
      ]
    });

    this.accuracyChartRecent = this.createChart(accuracyCanvasRecent, {
      title: 'Accuracy (Recent)',
      yLabel: 'Accuracy',
      logScale: false,
      yMin: 0,
      yMax: 1,
      yAxisSide: 'right',
      showLegend: false,
      reverseXAxis: true,
      datasets: [
        {
          label: 'Training',
          color: '#4CAF50',
          data: []
        },
        {
          label: 'Validation',
          color: '#9C27B0', 
          data: []
        }
      ]
    });
  }

  /**
   * Create a chart on the given canvas
   */
  createChart(canvas, config) {
    const ctx = canvas.getContext('2d');
    const devicePixelRatio = window.devicePixelRatio || 1;
    
    // Force canvas size if not set by CSS
    if (canvas.offsetWidth === 0 || canvas.offsetHeight === 0) {
      canvas.style.width = '300px';
      canvas.style.height = '200px';
    }
    
    // Set canvas size for high DPI displays
    const rect = canvas.getBoundingClientRect();
    const displayWidth = rect.width || 300;
    const displayHeight = rect.height || 200;
    
    canvas.width = displayWidth * devicePixelRatio;
    canvas.height = displayHeight * devicePixelRatio;
    canvas.style.width = displayWidth + 'px';
    canvas.style.height = displayHeight + 'px';
    
    ctx.scale(devicePixelRatio, devicePixelRatio);
    
    return {
      canvas,
      ctx,
      config,
      data: config.datasets.map(ds => ({ ...ds }))
    };
  }

  /**
   * Add new training data point
   */
  addDataPoint(epoch, trainLoss, valLoss, trainAccuracy, valAccuracy) {
    // Check if we already have data for this epoch (indicates resuming training after truncation)
    const existingEpochIndex = this.dataBuffer.epochs.indexOf(epoch);
    if (existingEpochIndex !== -1) {
      // Chart data truncation handled silently
      // Truncate all data from this epoch onwards
      this.dataBuffer.epochs = this.dataBuffer.epochs.slice(0, existingEpochIndex);
      this.dataBuffer.trainLoss = this.dataBuffer.trainLoss.slice(0, existingEpochIndex);
      this.dataBuffer.valLoss = this.dataBuffer.valLoss.slice(0, existingEpochIndex);
      this.dataBuffer.trainAccuracy = this.dataBuffer.trainAccuracy.slice(0, existingEpochIndex);
      this.dataBuffer.valAccuracy = this.dataBuffer.valAccuracy.slice(0, existingEpochIndex);
      
      // Update last epoch to the last remaining epoch
      this.lastEpoch = this.dataBuffer.epochs.length > 0 ? Math.max(...this.dataBuffer.epochs) : 0;
    }
    
    // Add to buffer
    this.dataBuffer.epochs.push(epoch);
    this.dataBuffer.trainLoss.push(trainLoss);
    this.dataBuffer.valLoss.push((typeof valLoss === 'number') ? valLoss : trainLoss);
    this.dataBuffer.trainAccuracy.push(trainAccuracy);
    this.dataBuffer.valAccuracy.push((typeof valAccuracy === 'number') ? valAccuracy : trainAccuracy);

    // Update last epoch tracker
    this.lastEpoch = Math.max(this.lastEpoch, epoch);

    // Apply smoothing and update charts
    this.updateCharts();
  }

  /**
   * Apply smoothing and update all charts
   */
  updateCharts() {
    const smoothedData = this.applySmoothening();
    const recentData = this.getRecentData(smoothedData);
    
    // Update loss charts
    if (this.lossChartFull) {
      this.lossChartFull.data[0].data = smoothedData.trainLoss;
      this.lossChartFull.data[1].data = smoothedData.valLoss;
      this.renderChart(this.lossChartFull, smoothedData.epochs);
    }

    if (this.lossChartRecent) {
      this.lossChartRecent.data[0].data = recentData.trainLoss;
      this.lossChartRecent.data[1].data = recentData.valLoss;
      this.renderChart(this.lossChartRecent, recentData.epochs);
    }

    // Update accuracy charts
    if (this.accuracyChartFull) {
      this.accuracyChartFull.data[0].data = smoothedData.trainAccuracy;
      this.accuracyChartFull.data[1].data = smoothedData.valAccuracy;
      this.renderChart(this.accuracyChartFull, smoothedData.epochs);
    }

    if (this.accuracyChartRecent) {
      this.accuracyChartRecent.data[0].data = recentData.trainAccuracy;
      this.accuracyChartRecent.data[1].data = recentData.valAccuracy;
      this.renderChart(this.accuracyChartRecent, recentData.epochs);
    }
  }
  
  /**
   * Force a complete re-render of charts (e.g., when settings change)
   */
  refreshCharts() {
    if (this.isVisible) {
      this.updateCharts();
    }
  }

  /**
   * Force layout refresh when Settings tab becomes visible
   * This fixes the chart overlap issue when extension opens on different tab
   */
  reinitializeChartsIfNeeded() {
    // Simple approach: force a layout refresh of the entire charts container
    const chartsContainer = document.getElementById('trainingChartsContainer');
    if (!chartsContainer) {
      return;
    }
    
    // Force layout recalculation
    const originalDisplay = chartsContainer.style.display;
    chartsContainer.style.display = 'none';
    chartsContainer.offsetHeight; // Force reflow
    chartsContainer.style.display = originalDisplay || 'block';
  }

  /**
   * Calculate dynamic smoothing window size
   */
  getDynamicSmoothingWindow() {
    const config = ML_CONFIG.charts.smoothing;
    if (!config.enabled) return 1;
    
    const dataLength = this.dataBuffer.epochs.length;
    if (!config.adaptive) return config.windowSize;
    
    // Adaptive smoothing: 2-5% of data length, within min/max bounds
    const adaptiveWindow = Math.floor(dataLength * 0.03); // 3% of data
    return Math.max(config.minWindow, Math.min(config.maxWindow, adaptiveWindow));
  }

  /**
   * Apply smoothing to the data
   */
  applySmoothening() {
    const window = Math.min(this.getDynamicSmoothingWindow(), this.dataBuffer.epochs.length);
    
    const smooth = (data) => {
      if (window <= 1) return data.slice(); // No smoothing
      
      const smoothed = [];
      for (let i = 0; i < data.length; i++) {
        const start = Math.max(0, i - Math.floor(window / 2));
        const end = Math.min(data.length, start + window);
        const slice = data.slice(start, end);
        const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
        smoothed.push(avg);
      }
      return smoothed;
    };

    return {
      epochs: this.dataBuffer.epochs.slice(),
      trainLoss: smooth(this.dataBuffer.trainLoss),
      valLoss: smooth(this.dataBuffer.valLoss),
      trainAccuracy: smooth(this.dataBuffer.trainAccuracy),
      valAccuracy: smooth(this.dataBuffer.valAccuracy)
    };
  }

  /**
   * Get recent data for recent charts
   */
  getRecentData(smoothedData) {
    // Use the patience value for the recent chart window
    const patienceSelect = document.getElementById('mlPatienceSelect');
    const patience = patienceSelect ? parseInt(patienceSelect.value) : 120;
    const recentEpochsCount = patience;
    
    const dataLength = smoothedData.epochs.length;
    if (dataLength <= recentEpochsCount) {
      // If we have fewer epochs than the recent count, return all data
      return smoothedData;
    }
    
    // Get the last N epochs
    const startIndex = dataLength - recentEpochsCount;
    
    return {
      epochs: smoothedData.epochs.slice(startIndex),
      trainLoss: smoothedData.trainLoss.slice(startIndex),
      valLoss: smoothedData.valLoss.slice(startIndex),
      trainAccuracy: smoothedData.trainAccuracy.slice(startIndex),
      valAccuracy: smoothedData.valAccuracy.slice(startIndex)
    };
  }

  /**
   * Get theme-aware colors
   */
  getThemeColors() {
    // The extension sets data-theme on the BODY element, not documentElement
    const bodyTheme = document.body.getAttribute('data-theme');
    const htmlTheme = document.documentElement.getAttribute('data-theme');
    const htmlClasses = document.documentElement.className;
    const bodyClasses = document.body.className;
    
    // Check body data-theme first (this is where the extension sets it)
    let isDarkTheme = bodyTheme === 'dark' || 
                      htmlTheme === 'dark' ||
                      htmlClasses.includes('dark') || 
                      bodyClasses.includes('dark') ||
                      document.documentElement.classList.contains('dark') ||
                      document.body.classList.contains('dark');
    
    // If no explicit theme is set (system theme), check system preference
    if (!bodyTheme && !htmlTheme) {
      isDarkTheme = window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    
    if (isDarkTheme) {
      return {
        background: '#1a1a1a', // Dark canvas background
        text: '#e0e0e0',       // Light text for good contrast
        grid: '#404040',       // Medium gray grid lines
        axis: '#707070',       // Lighter gray for axes
        trainLoss: '#BA68C8',  // Light purple for dark theme
        valLoss: '#81C784',    // Light green for dark theme
        trainAcc: '#BA68C8',   // Light purple for dark theme
        valAcc: '#81C784'      // Light green for dark theme
      };
    } else {
      return {
        background: '#ffffff',  // White canvas background
        text: '#333333',        // Dark text
        grid: '#e0e0e0',        // Light gray grid lines
        axis: '#666666',        // Medium gray for axes
        trainLoss: '#7B1FA2',   // Purple for light theme
        valLoss: '#388E3C',    // Green for light theme
        trainAcc: '#7B1FA2',   // Purple for light theme
        valAcc: '#388E3C'       // Green for light theme
      };
    }
  }

  /**
   * Render a chart with the current data
   */
  renderChart(chart, epochs) {
    const { ctx, config, data } = chart;
    const canvas = chart.canvas;
    
    // Use the actual canvas dimensions (not getBoundingClientRect)
    const width = canvas.width / (window.devicePixelRatio || 1);
    const height = canvas.height / (window.devicePixelRatio || 1);
    
    // Get theme colors
    const colors = this.getThemeColors();
    
    // Clear entire canvas with theme background using actual canvas dimensions
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Force background color with multiple approaches
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Also try filling with display dimensions
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
    
    // If no data, show "No data" message
    if (epochs.length === 0) {
      ctx.fillStyle = colors.text;
      ctx.font = '14px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No training data', width / 2, height / 2);
      return;
    }

    // Chart margins - optimized for each chart position
    const isRightAxis = config.yAxisSide === 'right';
    const isLossChart = config.title.includes('Loss');
    
    let margin;
    if (isRightAxis && isLossChart) {
      // Loss Recent chart - slightly less right padding
      margin = { top: 10, right: 50, bottom: 30, left: 0 };
    } else if (isRightAxis && !isLossChart) {
      // Accuracy Recent chart - current right padding is good
      margin = { top: 10, right: 40, bottom: 30, left: 0 };
    } else if (!isRightAxis && isLossChart) {
      // Loss Full chart - current settings good
      margin = { top: 10, right: 20, bottom: 30, left: 45 };
    } else {
      // Accuracy Full chart - needs less left padding
      margin = { top: 10, right: 20, bottom: 30, left: 35 };
    }
    
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    // Get data ranges
    const xMin = Math.min(...epochs);
    const xMax = Math.max(...epochs);
    const allValues = data.flatMap(ds => ds.data).filter(v => v !== undefined && v !== null);
    
    let yMin, yMax;
    if (config.logScale) {
      const validValues = allValues.filter(v => v > 0);
      yMin = validValues.length > 0 ? Math.min(...validValues) : 0.001;
      yMax = validValues.length > 0 ? Math.max(...validValues) : 1;
      // 80% scaling: calculate range and use 80% of it for padding
      const logMin = Math.log(yMin);
      const logMax = Math.log(yMax);
      const logRange = logMax - logMin;
      const paddingFactor = 0.1; // 10% padding to achieve 80% use
      yMin = Math.exp(logMin - logRange * paddingFactor);
      yMax = Math.exp(logMax + logRange * paddingFactor);
    } else if (config.yLabel === 'Accuracy') {
      // Accuracy charts: different scaling for full vs recent
      if (config.reverseXAxis) {
        // Recent accuracy chart: dynamic scaling with 80% range usage
        if (allValues.length > 0) {
          const dataMin = Math.min(...allValues);
          const dataMax = Math.max(...allValues);
          const range = dataMax - dataMin;
          const paddingFactor = 0.125; // 12.5% padding to achieve 80% use
          yMin = Math.max(0, dataMin - range * paddingFactor);
          yMax = Math.min(1, dataMax + range * paddingFactor);
        } else {
          yMin = 0;
          yMax = 1;
        }
      } else {
        // Full accuracy chart: fixed 0-100% range
        yMin = 0;
        yMax = 1;
      }
    } else {
      // Loss charts: 80% scaling with dynamic range
      yMin = config.yMin !== undefined ? config.yMin : Math.min(...allValues, 0);
      yMax = config.yMax !== undefined ? config.yMax : Math.max(...allValues, 1);
      // 80% scaling: use 20% total padding (10% each side)
      const range = yMax - yMin;
      const paddingFactor = 0.125; // 12.5% padding to achieve 80% use
      yMin -= range * paddingFactor;
      yMax += range * paddingFactor;
    }

    // Transform functions
    const xScale = (x) => {
      if (config.reverseXAxis) {
        // For recent charts: position data on the right side
        const patienceSelect = document.getElementById('mlPatienceSelect');
        const patience = patienceSelect ? parseInt(patienceSelect.value) : 120;
        const recentEpochsCount = patience;
        const dataEpochs = epochs.length;
        const totalWidth = chartWidth;
        
        if (dataEpochs >= recentEpochsCount) {
          // Normal case: full data, use full width
          return margin.left + (x - xMin) / (xMax - xMin) * totalWidth;
        } else {
          // Limited data: position on right side of chart
          const dataRatio = dataEpochs / recentEpochsCount;
          const dataWidth = totalWidth * dataRatio;
          const startX = margin.left + (totalWidth - dataWidth);
          return startX + (x - xMin) / (xMax - xMin) * dataWidth;
        }
      } else {
        // Normal full chart scaling
        return margin.left + (x - xMin) / (xMax - xMin) * chartWidth;
      }
    };
    const yScale = (y) => {
      if (config.logScale) {
        const logY = Math.log(Math.max(y, yMin));
        const logMin = Math.log(yMin);
        const logMax = Math.log(yMax);
        return margin.top + chartHeight - (logY - logMin) / (logMax - logMin) * chartHeight;
      } else {
        // For accuracy charts, add visual padding by using a slightly larger range for positioning
        const displayYMax = config.yLabel === 'Accuracy' ? yMax * 1.05 : yMax;
        const displayYMin = yMin;
        return margin.top + chartHeight - (y - displayYMin) / (displayYMax - displayYMin) * chartHeight;
      }
    };

    // Set font and text properties
    ctx.font = '10px system-ui, -apple-system, sans-serif';

    // Draw grid lines
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = colors.grid;
    ctx.setLineDash([2, 2]);
    
    // Vertical grid lines (epochs)
    const xSteps = Math.min(5, epochs.length);
    
    // For recent charts (right side), only show 2 vertical grid lines to divide into 3 equal sections
    if (config.reverseXAxis) {
      // Draw vertical grid line at 1/3 position (corresponds to -2N/3 label)
      const x1 = margin.left + (1 / 3) * chartWidth;
      ctx.beginPath();
      ctx.moveTo(x1, margin.top);
      ctx.lineTo(x1, margin.top + chartHeight);
      ctx.stroke();
      
      // Draw vertical grid line at 2/3 position (corresponds to -N/3 label)
      const x2 = margin.left + (2 / 3) * chartWidth;
      ctx.beginPath();
      ctx.moveTo(x2, margin.top);
      ctx.lineTo(x2, margin.top + chartHeight);
      ctx.stroke();
    } else {
      // For full charts, show all grid lines
      for (let i = 0; i <= xSteps; i++) {
        const x = margin.left + (i / xSteps) * chartWidth;
        ctx.beginPath();
        ctx.moveTo(x, margin.top);
        ctx.lineTo(x, margin.top + chartHeight);
        ctx.stroke();
      }
    }
    
    // Horizontal grid lines
    const ySteps = 5;
    for (let i = 0; i <= ySteps; i++) {
      const y = margin.top + (i / ySteps) * chartHeight;
      ctx.beginPath();
      ctx.moveTo(margin.left, y);
      ctx.lineTo(margin.left + chartWidth, y);
      ctx.stroke();
    }
    
    ctx.setLineDash([]);

    // Draw axes
    ctx.lineWidth = 1;
    ctx.strokeStyle = colors.axis;
    ctx.beginPath();
    
    if (isRightAxis) {
      // Right axis: vertical line on right, horizontal on bottom
      ctx.moveTo(margin.left + chartWidth, margin.top);
      ctx.lineTo(margin.left + chartWidth, margin.top + chartHeight);
      ctx.lineTo(margin.left, margin.top + chartHeight);
    } else {
      // Left axis: vertical line on left, horizontal on bottom  
      ctx.moveTo(margin.left, margin.top);
      ctx.lineTo(margin.left, margin.top + chartHeight);
      ctx.lineTo(margin.left + chartWidth, margin.top + chartHeight);
    }
    ctx.stroke();

    // Draw axis labels (only on full charts, positioned to apply to both charts)
    if (!config.reverseXAxis) {
      ctx.fillStyle = colors.text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      // Position label to appear centered between both chart areas (60% + 40%)
      // Move it towards the right to visually center between both charts
      const labelX = margin.left + chartWidth * 0.85;
      ctx.fillText('Epoch', labelX, height - 10);
    }

    // Draw X-axis tick labels
    ctx.fillStyle = colors.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    
    for (let i = 0; i <= xSteps; i++) {
      let labelText;
      const x = margin.left + (i / xSteps) * chartWidth;
      
      if (config.reverseXAxis) {
        // For recent charts, we want labels at specific positions matching the grid lines
        // We'll manually draw labels at 0, 1/3, 2/3, and 1 positions
        // Skip the automatic labels from the loop
        labelText = '';
      } else {
        // Normal X-axis: show actual epoch numbers starting from 1
        if (epochs.length > 0) {
          if (i === 0) {
            labelText = '1'; // Always start from 1
          } else {
            const epochIndex = Math.floor((i / xSteps) * (epochs.length - 1));
            const epoch = epochs[epochIndex] || 1;
            labelText = epoch.toString();
          }
        } else {
          labelText = '1';
        }
      }
      
      ctx.fillText(labelText, x, margin.top + chartHeight + 5);
    }
    
    // For recent charts, manually draw labels at the correct positions
    if (config.reverseXAxis) {
      const patienceSelect = document.getElementById('mlPatienceSelect');
      const patience = patienceSelect ? parseInt(patienceSelect.value) : 120;
      
      ctx.fillStyle = colors.text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      
      // Label at 0 position (empty)
      ctx.fillText('', margin.left, margin.top + chartHeight + 5);
      
      // Label at 1/3 position (-2N/3)
      const x1 = margin.left + (1 / 3) * chartWidth;
      ctx.fillText(`-${Math.round(patience * 2 / 3)}`, x1, margin.top + chartHeight + 5);
      
      // Label at 2/3 position (-N/3)
      const x2 = margin.left + (2 / 3) * chartWidth;
      ctx.fillText(`-${Math.round(patience / 3)}`, x2, margin.top + chartHeight + 5);
      
      // Label at 1 position (0)
      ctx.fillText('0', margin.left + chartWidth, margin.top + chartHeight + 5);
    }

    // Draw Y-axis tick labels
    ctx.textBaseline = 'middle';
    const yLabelX = isRightAxis ? margin.left + chartWidth + 5 : margin.left - 5;
    ctx.textAlign = isRightAxis ? 'left' : 'right';
    
    // Track used labels to avoid duplicates
    const usedLabels = new Set();
    
    for (let i = 0; i <= ySteps; i++) {
      const ratio = 1 - (i / ySteps);
      let yValue;
      if (config.logScale) {
        const logMin = Math.log(yMin);
        const logMax = Math.log(yMax);
        yValue = Math.exp(logMin + ratio * (logMax - logMin));
        
        // Smart formatting for loss values to avoid duplicate labels
        let labelText;
        if (yValue >= 1) {
          labelText = yValue.toFixed(2); // 2 decimal places for values ≥ 1
        } else if (yValue >= 0.01) {
          labelText = yValue.toFixed(3); // 3 decimal places for values ≥ 0.01
        } else if (yValue >= 0.001) {
          labelText = yValue.toFixed(4); // 4 decimal places for values ≥ 0.001
        } else {
          labelText = yValue.toExponential(2); // Scientific notation with 2 decimal places for very small values
        }
        
        // Only draw label if it's unique
        if (!usedLabels.has(labelText)) {
          usedLabels.add(labelText);
          ctx.fillText(labelText, yLabelX, margin.top + (i / ySteps) * chartHeight);
        }
      } else {
        yValue = yMin + ratio * (yMax - yMin);
        // Format as percentage for accuracy charts, decimal for loss charts
        let labelText;
        if (config.yLabel === 'Accuracy') {
          labelText = (yValue * 100).toFixed(0) + '%';
        } else {
          labelText = yValue.toFixed(2);
        }
        
        // Only draw label if it's unique
        if (!usedLabels.has(labelText)) {
          usedLabels.add(labelText);
          ctx.fillText(labelText, yLabelX, margin.top + (i / ySteps) * chartHeight);
        }
      }
    }

    // Update dataset colors based on theme
    if (data.length >= 2) {
      data[0].color = config.title.includes('Loss') ? colors.trainLoss : colors.trainAcc;
      data[1].color = config.title.includes('Loss') ? colors.valLoss : colors.valAcc;
    }

    // Draw data lines
    data.forEach((dataset) => {
      if (dataset.data.length === 0) return;
      
      ctx.strokeStyle = dataset.color;
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      
      ctx.beginPath();
      let started = false;
      
      for (let i = 0; i < epochs.length && i < dataset.data.length; i++) {
        const x = xScale(epochs[i]);
        const y = yScale(dataset.data[i]);
        
        if (isNaN(y) || !isFinite(y)) continue;
        
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      
      ctx.stroke();
    });

    // Draw minimum validation loss line (only on Loss recent chart)
    if (config.reverseXAxis && config.title.includes('Loss') && data.length > 1) {
      const valLossData = data[1].data; // Validation loss is second dataset
      if (valLossData.length > 0) {
        // Use global minimum from all stored data, not just current chart data
        const allValLossValues = this.dataBuffer.valLoss.filter(v => v !== undefined && v !== null && !isNaN(v));
        const minValLoss = allValLossValues.length > 0 ? Math.min(...allValLossValues) : Math.min(...valLossData.filter(v => v !== undefined && v !== null && !isNaN(v)));
        
        if (!isNaN(minValLoss) && isFinite(minValLoss)) {
          const minY = yScale(minValLoss);
          
          // Check if a new global minimum was achieved in the last 3 epochs (current + 2 previous)
          let isNewMinimum = false;
          if (allValLossValues.length >= 3) {
            // Find when the current minimum was achieved
            const minIndex = allValLossValues.indexOf(minValLoss);
            const currentIndex = allValLossValues.length - 1;
            
            // Check if minimum was achieved in last 3 epochs (stay green for 2 epochs after new min)
            isNewMinimum = (currentIndex - minIndex) <= 2;
          } else {
            // For early training, show green if current value is the minimum
            isNewMinimum = allValLossValues[allValLossValues.length - 1] === minValLoss;
          }
          
          // Choose color based on new minimum status
          const lineColor = isNewMinimum ? '#22cc44' : '#ff4444'; // Green if new minimum recent, red otherwise
          
          // Draw thin horizontal line
          ctx.strokeStyle = lineColor;
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]); // Dashed line
          ctx.globalAlpha = 0.8; // Slightly transparent
          
          ctx.beginPath();
          ctx.moveTo(margin.left, minY);
          ctx.lineTo(margin.left + chartWidth, minY);
          ctx.stroke();
          
          // Reset styles
          ctx.setLineDash([]);
          ctx.globalAlpha = 1.0;
          
          // Add label for minimum value
          ctx.fillStyle = lineColor;
          ctx.font = '9px system-ui, -apple-system, sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'bottom';
          const minLabel = config.logScale ? minValLoss.toFixed(4) : minValLoss.toFixed(3);
          const statusIndicator = isNewMinimum ? ' ↓' : '';
          ctx.fillText(`min: ${minLabel}${statusIndicator}`, margin.left + 5, minY - 2);
        }
      }
    }

    // Draw legend (only for full charts) - positioned by chart type
    if (config.showLegend) {
      const isLossChart = config.title.includes('Loss');
      
      ctx.fillStyle = colors.text;
      ctx.textAlign = 'left';
      
      data.forEach((dataset, index) => {
        let x, y;
        
        if (isLossChart) {
          // Loss chart: right top corner, left-aligned with enough space
          x = margin.left + chartWidth - 80; // 80px from right edge
          y = margin.top + 10 + index * 15;
          ctx.textBaseline = 'top';
        } else {
          // Accuracy chart: right bottom corner, left-aligned with enough space
          x = margin.left + chartWidth - 80; // 80px from right edge
          y = margin.top + chartHeight - 10 - (data.length - 1 - index) * 15; // Moved even closer to bottom
          ctx.textBaseline = 'middle'; // Use middle alignment for better positioning
        }
        
        // Draw color indicator (on the left) - aligned with text baseline
        ctx.fillStyle = dataset.color;
        if (isLossChart) {
          ctx.fillRect(x, y + 3, 12, 3); // Adjusted offset for better alignment with top text
        } else {
          ctx.fillRect(x, y - 1, 12, 3); // Centered for middle alignment
        }
        
        // Draw label (to the right of color indicator)
        ctx.fillStyle = colors.text;
        ctx.fillText(dataset.label, x + 18, y);
      });
    }
  }

  /**
   * Show the charts container
   */
  show() {
    const container = document.getElementById('trainingChartsContainer');
    if (container) {
      container.style.display = 'block';
      this.isVisible = true;
    }
  }

  /**
   * Hide the charts container
   */
  hide() {
    const container = document.getElementById('trainingChartsContainer');
    if (container) {
      container.style.display = 'none';
      this.isVisible = false;
    }
  }

  /**
   * Clear all chart data
   */
  clear() {
    this.dataBuffer = {
      epochs: [],
      trainLoss: [],
      valLoss: [],
      trainAccuracy: [],
      valAccuracy: []
    };
    
    // Reset epoch tracker
    this.lastEpoch = 0;
    
    // Clear all four charts
    if (this.lossChartFull) {
      this.lossChartFull.data.forEach(ds => ds.data = []);
      this.renderChart(this.lossChartFull, []);
    }
    
    if (this.lossChartRecent) {
      this.lossChartRecent.data.forEach(ds => ds.data = []);
      this.renderChart(this.lossChartRecent, []);
    }
    
    if (this.accuracyChartFull) {
      this.accuracyChartFull.data.forEach(ds => ds.data = []);
      this.renderChart(this.accuracyChartFull, []);
    }
    
    if (this.accuracyChartRecent) {
      this.accuracyChartRecent.data.forEach(ds => ds.data = []);
      this.renderChart(this.accuracyChartRecent, []);
    }
  }

  /**
   * Load and display last training data
   */
  async loadLastTrainingData() {
    try {
      // Priority 1: Check for training model (if currently training)
      const { getTrainingCheckpoint, loadModel } = await import('../ml/storage/ml-database.js');
      
      let history = null;
      let source = null;
      
      // First try to get history from training checkpoint (if training is active)
      try {
        const trainingCheckpoint = await getTrainingCheckpoint('best') || await getTrainingCheckpoint('last');
        if (trainingCheckpoint && trainingCheckpoint.metadata?.trainingHistory) {
          history = trainingCheckpoint.metadata.trainingHistory;
          source = 'training checkpoint';
        }
      } catch (error) {
        // Training checkpoint doesn't exist, that's fine
      }
      
      // Priority 2: Fallback to current model
      if (!history) {
        const currentModel = await loadModel();
        if (currentModel && currentModel.metadata?.trainingHistory) {
          history = currentModel.metadata.trainingHistory;
          source = 'current model';
        }
      }
      
      if (history && history.loss && history.loss.length > 0) {
        // Clear existing data
        this.dataBuffer = {
          epochs: [],
          trainLoss: [],
          valLoss: [],
          trainAccuracy: [],
          valAccuracy: []
        };
        
        // Load historical data (history format: {loss: [], accuracy: [], val_loss: [], val_accuracy: []})
        for (let i = 0; i < history.loss.length; i++) {
          const epoch = i + 1; // Epochs are 1-indexed
          this.dataBuffer.epochs.push(epoch);
          this.dataBuffer.trainLoss.push(history.loss[i] || 0);
          this.dataBuffer.valLoss.push(history.val_loss[i] || 0);
          this.dataBuffer.trainAccuracy.push(history.accuracy[i] || 0);
          this.dataBuffer.valAccuracy.push(history.val_accuracy[i] || 0);
        }
        
        this.lastEpoch = Math.max(...this.dataBuffer.epochs);
        
        // Training history loaded successfully
        
        // Update charts with loaded data
        this.updateCharts();
      }
    } catch (error) {
      // Silently handle loading errors
    }
  }
  
  /**
   * Add test data to verify charts are working
   */
  addTestData() {
    // Add extended sample training data to test both full and recent charts
    for (let i = 1; i <= 1000; i++) {
      // Create realistic training curves with some noise
      const noise = () => (Math.random() - 0.5) * 0.1;
      const baseLoss = Math.max(0.01, 2.0 * Math.exp(-i * 0.01) + noise());
      const baseAcc = Math.min(0.95, 0.4 + (1 - Math.exp(-i * 0.005)) * 0.5 + noise() * 0.05);
      
      this.addDataPoint(
        i,                           // epoch
        baseLoss,                    // training loss (exponential decay with noise)
        baseLoss * 1.1 + noise() * 0.05,  // validation loss (slightly higher)
        baseAcc,                     // training accuracy (sigmoid growth with noise)
        baseAcc * 0.95 + noise() * 0.03   // validation accuracy (slightly lower)
      );
    }
  }
  


  /**
   * Get the current epoch number (for continuing interrupted training)
   */
  getCurrentEpoch() {
    return this.lastEpoch;
  }
  
  /**
   * Get the next epoch number for continuing training
   */
  getNextEpoch() {
    return this.lastEpoch + 1;
  }

  /**
   * Destroy charts and cleanup
   */
  destroy() {
    // Training history is automatically saved by the training system - no manual save needed
    
    // Clean up theme observer
    if (this.themeObserver) {
      this.themeObserver.disconnect();
      this.themeObserver = null;
    }
    
    this.clear();
    this.hide();
    this.lossChartFull = null;
    this.lossChartRecent = null;
    this.accuracyChartFull = null;
    this.accuracyChartRecent = null;
  }
}

// Singleton instance
let trainingChartsInstance = null;

export function getTrainingCharts() {
  if (!trainingChartsInstance) {
    trainingChartsInstance = new TrainingCharts();
  }
  return trainingChartsInstance;
}

export default {
  TrainingCharts,
  getTrainingCharts
};