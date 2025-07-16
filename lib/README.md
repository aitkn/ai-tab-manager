# Library Files

This directory contains third-party JavaScript libraries used by the AI Tab Manager extension. These files are processed versions of the original libraries with sourceMappingURL references removed to prevent Safari compatibility issues.

## Files Included

- **browser-polyfill.min.js** - Mozilla's WebExtension browser API polyfill
- **morphdom.min.js** - Lightweight DOM diffing/morphing library
- **tf-core.min.js** - TensorFlow.js core library
- **tf-backend-cpu.min.js** - TensorFlow.js CPU backend
- **tf-backend-webgl.min.js** - TensorFlow.js WebGL backend
- **tf-layers.min.js** - TensorFlow.js layers API

## Why These Files Are Processed

Safari's extension environment has stricter security policies and attempts to load source map files (`.map`) referenced in minified JavaScript files. Since these map files don't exist in the extension package, Safari reports "Failed to load resource" errors. To fix this, we remove the `//# sourceMappingURL=` comments from the minified files.

## How to Regenerate These Files

The original, unmodified library files are stored in the `src-lib/` directory. To regenerate the processed files in this directory:

```bash
./scripts/remove-sourcemap-urls.sh
```

This script:
1. Reads each JavaScript file from `src-lib/`
2. Removes only the `//# sourceMappingURL=` line
3. Preserves all other content including comments and license information
4. Writes the processed file to `lib/`

## Transparency and Security

- Original files: See `src-lib/` directory
- Processing script: See `scripts/remove-sourcemap-urls.sh`
- The only modification is removing sourcemap references
- All library functionality remains unchanged
- This process is also automated in GitHub Actions for releases

## Updating Libraries

When updating libraries:
1. Place new original files in `src-lib/`
2. Run `./scripts/remove-sourcemap-urls.sh`
3. Commit both directories