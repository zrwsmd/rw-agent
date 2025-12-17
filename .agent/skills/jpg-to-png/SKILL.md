---
name: jpg-to-png
description: Convert .jpg/.jpeg images to .png (batch). Uses ImageMagick if available.
allowed-tools: [bash, write, read]
---

# JPG to PNG Converter

## What this skill does
- Converts all .jpg/.jpeg files in a given folder (optionally recursive) to .png.
- Keeps the same base filename (a.jpg -> a.png).
- Skips conversion if the output .png already exists unless user requests overwrite.

## Requirements
- ImageMagick installed (command: `magick`).
  - On macOS: `brew install imagemagick`
  - On Ubuntu/Debian: `sudo apt-get install imagemagick`

## How to run
Use the Node script:

`node {baseDir}/scripts/convert.js --in "<inputDir>" --out "<outputDir>" [--recursive] [--overwrite]`

## Notes
- If `--out` is omitted, write outputs into the same folder as inputs.
- If ImageMagick is missing, tell the user how to install it.
