"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { buildSync } = require("esbuild");
const root = path.resolve(__dirname, "..");
const target = path.join(root, "src/vendor/pixi");
fs.mkdirSync(target, { recursive: true });
// Keep the worker's public Pixi API and its CSP adapter in one tree-shaken
// bundle. No second renderer, runtime module loader or hand-picked internals.
buildSync({
  stdin: {
    contents: `export {
      DOMAdapter, extensions, DOMPipe, AccessibilitySystem, EventSystem,
      WebGLRenderer, Container, Graphics, ImageSource, Texture, Rectangle,
      Sprite, RenderTexture
    } from "pixi.js";
    import "pixi.js/unsafe-eval";`,
    resolveDir: root,
    sourcefile: "gpu-renderer-entry.js",
  },
  outfile: path.join(target, "pixi.min.js"),
  bundle: true,
  minify: true,
  format: "iife",
  globalName: "PIXI",
  platform: "browser",
  target: "es2022",
});
fs.copyFileSync(path.join(root, "node_modules/pixi.js/LICENSE"), path.join(target, "LICENSE"));
fs.rmSync(path.join(target, "csp.min.js"), { force: true });
