#!/usr/bin/env node
/**
 * JPG/JPEG -> PNG batch converter using ImageMagick (magick).
 * Usage:
 *  node convert.js --in "<inputDir>" --out "<outputDir>" [--recursive] [--overwrite]
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function parseArgs(argv) {
  const args = { recursive: false, overwrite: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--in") args.inDir = argv[++i];
    else if (a === "--out") args.outDir = argv[++i];
    else if (a === "--recursive") args.recursive = true;
    else if (a === "--overwrite") args.overwrite = true;
  }
  return args;
}

function isJpg(file) {
  const ext = path.extname(file).toLowerCase();
  return ext === ".jpg" || ext === ".jpeg";
}

function walk(dir, recursive) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (recursive) out.push(...walk(p, recursive));
    } else if (ent.isFile() && isJpg(ent.name)) {
      out.push(p);
    }
  }
  return out;
}

function ensureDir(d) {
  if (!d) return;
  fs.mkdirSync(d, { recursive: true });
}

function magickAvailable() {
  const r = spawnSync("magick", ["-version"], { stdio: "ignore" });
  return r.status === 0;
}

function convertOne(inputPath, outputPath, overwrite) {
  if (!overwrite && fs.existsSync(outputPath)) return { skipped: true };

  // ImageMagick:
  // magick input.jpg output.png
  const r = spawnSync("magick", [inputPath, outputPath], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`Conversion failed for: ${inputPath}`);
  return { skipped: false };
}

(function main() {
  const args = parseArgs(process.argv);
  if (!args.inDir) {
    console.error('Missing --in "<inputDir>"');
    process.exit(1);
  }

  const inDir = path.resolve(args.inDir);
  const outDir = args.outDir ? path.resolve(args.outDir) : inDir;

  if (!fs.existsSync(inDir) || !fs.statSync(inDir).isDirectory()) {
    console.error("Input directory does not exist:", inDir);
    process.exit(1);
  }

  if (!magickAvailable()) {
    console.error('ImageMagick not found. Please install it so "magick" is available.');
    process.exit(2);
  }

  ensureDir(outDir);

  const files = walk(inDir, args.recursive);
  let converted = 0, skipped = 0;

  for (const f of files) {
    const rel = path.relative(inDir, f);
    const base = rel.replace(/\.(jpg|jpeg)$/i, "");
    const outPath = path.join(outDir, base + ".png");

    ensureDir(path.dirname(outPath));

    const res = convertOne(f, outPath, args.overwrite);
    if (res.skipped) skipped++;
    else converted++;
  }

  console.log(`Done. converted=${converted}, skipped=${skipped}, total=${files.length}`);
})();
