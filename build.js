// Builds the simulator from src/ into two outputs:
//   index.html          standalone page with three.js inlined from vendor/, runs offline in any browser
//   dist/artifact.html  page fragment for the Claude artifact, loads three.js from cdnjs and jsdelivr
// Usage: node build.js
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), 'utf8');
const CDN_THREE = '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>';
const CDN_ORBIT = '<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"></script>';

const html = read('src', 'template.html')
  .replace('/*STYLES*/', () => read('src', 'styles.css'))
  .replace('/*GEOSPEC*/', () => read('src', 'geo-anr-spec.js'))
  .replace('/*SIM*/', () => read('src', 'sim.js'))
  .replace('/*GEO*/', () => read('src', 'geo-data.js'))
  .replace('/*GEOANR*/', () => read('src', 'geo-anr-data.js'))
  .replace('/*APP*/', () => read('src', 'app.js'));
if (!html.includes(CDN_THREE) || !html.includes(CDN_ORBIT)) throw new Error('three.js script tags not found in template');

// artifact: CDN scripts
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'artifact.html'), html);

// standalone: three.js r128 (MIT, see vendor/LICENSE-three.txt) inlined; fonts fall back to system fonts when offline
const offline = html
  .replace(CDN_THREE, () => `<script>\n${read('vendor', 'three.min.js')}\n</script>`)
  .replace(CDN_ORBIT, () => `<script>\n/* three.js r128 OrbitControls, MIT License, Copyright 2010-2021 three.js authors */\n${read('vendor', 'OrbitControls.js')}\n</script>`);
const cut = offline.indexOf('</style>') + '</style>'.length;
fs.writeFileSync(path.join(__dirname, 'index.html'),
  `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${offline.slice(0, cut)}\n</head>\n<body>\n${offline.slice(cut).trim()}\n</body>\n</html>\n`);

console.log(`index.html ${(fs.statSync(path.join(__dirname, 'index.html')).size / 1024).toFixed(0)} KB, dist/artifact.html ${(html.length / 1024).toFixed(0)} KB`);
