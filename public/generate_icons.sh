#!/bin/bash

# Source SVG file
SOURCE_ICON="Thanatology.svg"

# Output folders
PNG_DIR="../src-tauri/icons/"
ICONSET_DIR="icon.iconset"

# Make sure output dirs exist
mkdir -p "$ICONSET_DIR"

# Sizes required by .icns
declare -a sizes=(16 32 48 64 128 256 512 1024)

echo "Exporting PNGs with black background..."
for size in "${sizes[@]}"; do
  /Applications/Inkscape.app/Contents/MacOS/inkscape "$SOURCE_ICON" \
    --export-type=png \
    --export-width=$size \
    --export-height=$size \
    --export-filename="$PNG_DIR/${size}x${size}.png"
done

echo "Preparing .iconset folder..."
cp "$PNG_DIR/16x16.png" "$ICONSET_DIR/icon_16x16.png"
cp "$PNG_DIR/32x32.png" "$PNG_DIR/16x16@2x.png"
cp "$PNG_DIR/32x32.png" "$ICONSET_DIR/icon_16x16@2x.png"
cp "$PNG_DIR/48x48.png" "$ICONSET_DIR/icon_48x48.png"
cp "$PNG_DIR/32x32.png" "$ICONSET_DIR/icon_32x32.png"
cp "$PNG_DIR/64x64.png" "$ICONSET_DIR/icon_32x32@2x.png"
cp "$PNG_DIR/64x64.png" "$PNG_DIR/32x32@2x.png"
cp "$PNG_DIR/128x128.png" "$ICONSET_DIR/icon_128x128.png"
cp "$PNG_DIR/256x256.png" "$ICONSET_DIR/icon_128x128@2x.png"
cp "$PNG_DIR/256x256.png" "$PNG_DIR/128x128@2x.png"
cp "$PNG_DIR/256x256.png" "$ICONSET_DIR/icon_256x256.png"
cp "$PNG_DIR/512x512.png" "$ICONSET_DIR/icon_256x256@2x.png"
cp "$PNG_DIR/512x512.png" "$PNG_DIR/256x256@2x.png"
cp "$PNG_DIR/512x512.png" "$ICONSET_DIR/icon_512x512.png"
cp "$PNG_DIR/1024x1024.png" "$ICONSET_DIR/icon_512x512@2x.png"
cp "$PNG_DIR/1024x1024.png" "$PNG_DIR/512x512@2x.png"

echo "Generating .icns file..."
iconutil -c icns "$ICONSET_DIR" -o "$PNG_DIR/icon.icns"

echo "Generating .ico file..."

magick \
  "$PNG_DIR/16x16.png" \
  "$PNG_DIR/32x32.png" \
  "$PNG_DIR/48x48.png" \
  "$PNG_DIR/256x256.png" \
  "$PNG_DIR/icon.ico"

echo "Cleaning up..."
rm -r "$ICONSET_DIR"

echo "✅ Done! Output: $PNG_DIR/icon.icns"
