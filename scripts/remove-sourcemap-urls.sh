#!/bin/bash
# Remove sourceMappingURL references from minified libraries for Safari compatibility
# This script creates processed versions of library files without modifying originals

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Processing library files to remove sourceMappingURL references...${NC}"

# Source and destination directories
SOURCE_DIR="src-lib"
DEST_DIR="lib"

# Check if source directory exists
if [ ! -d "$SOURCE_DIR" ]; then
    echo -e "${RED}ERROR: Source directory $SOURCE_DIR not found${NC}"
    exit 1
fi

# Create destination directory if it doesn't exist
mkdir -p "$DEST_DIR"

# List of files to process
FILES=(
    "browser-polyfill.min.js"
    "tf-backend-cpu.min.js"
    "tf-backend-webgl.min.js"
    "tf-core.min.js"
    "tf-layers.min.js"
)

# Process each file
for file in "${FILES[@]}"; do
    if [ -f "$SOURCE_DIR/$file" ]; then
        echo -e "Processing ${GREEN}$file${NC}..."
        
        # Copy file and remove only the sourceMappingURL line
        sed '/^\/\/# sourceMappingURL=/d' "$SOURCE_DIR/$file" > "$DEST_DIR/$file"
        
        # Verify the file was processed
        if grep -q "sourceMappingURL=" "$DEST_DIR/$file"; then
            echo -e "${RED}ERROR: Failed to remove sourceMappingURL from $file${NC}"
            exit 1
        fi
        
        echo -e "  ✓ Processed successfully"
    else
        echo -e "${YELLOW}Warning: $SOURCE_DIR/$file not found, skipping...${NC}"
    fi
done

# Also copy other lib files that don't need processing
echo -e "\nCopying other library files..."
for file in "$SOURCE_DIR"/*; do
    filename=$(basename "$file")
    # Skip if already processed or if it's CLAUDE.md
    if [[ ! " ${FILES[@]} " =~ " ${filename} " ]] && [ -f "$file" ] && [ "$filename" != "CLAUDE.md" ]; then
        echo -e "Copying ${GREEN}$filename${NC}..."
        cp "$file" "$DEST_DIR/"
    fi
done

echo -e "\n${GREEN}✓ All library files processed successfully!${NC}"
echo -e "Processed files are in: ${YELLOW}$DEST_DIR/${NC}"

# Show summary
echo -e "\nSummary:"
echo -e "- Original files remain unchanged in $SOURCE_DIR/"
echo -e "- Processed files (without sourceMappingURL) are in $DEST_DIR/"
echo -e "- This ensures transparency for security reviews"