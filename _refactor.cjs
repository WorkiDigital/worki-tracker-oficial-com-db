/**
 * Refactor Script — Extracts CSS and JS from monolithic index.html
 * into separate files, leaving only HTML + imports.
 */
const fs = require('fs');
const path = require('path');

const HTML_PATH = path.join(__dirname, 'index.html');
const CSS_PATH = path.join(__dirname, 'css', 'main.css');
const APP_JS_PATH = path.join(__dirname, 'js', 'app.js');

let content = fs.readFileSync(HTML_PATH, 'utf-8');
const origLen = content.length;
console.log(`📂 Original: ${content.split('\n').length} lines, ${origLen} bytes`);

// ─── 1. Extract CSS ────────────────────────────────────────────
const styleStart = content.indexOf('<style>');
const styleEnd = content.indexOf('</style>');

if (styleStart === -1 || styleEnd === -1) {
    console.error('ERROR: Could not find <style> block');
    process.exit(1);
}

const cssContent = content.substring(styleStart + '<style>'.length, styleEnd).trim();
fs.writeFileSync(CSS_PATH, cssContent, 'utf-8');
console.log(`✅ CSS extracted: ${cssContent.split('\n').length} lines, ${cssContent.length} bytes`);

// Replace <style>...</style> with <link>
const beforeStyle = content.substring(0, styleStart);
const afterStyle = content.substring(styleEnd + '</style>'.length);
content = beforeStyle + '<link rel="stylesheet" href="/css/main.css">' + afterStyle;

// ─── 2. Extract JS ─────────────────────────────────────────────
// Find the LAST <script> that is NOT a src= script (CDN/module imports)
// We need to find the big inline script block
const scriptStart = content.lastIndexOf('<script>');
const scriptEnd = content.lastIndexOf('</script>');

if (scriptStart === -1 || scriptEnd === -1 || scriptStart >= scriptEnd) {
    console.error('ERROR: Could not find inline <script> block');
    console.log('scriptStart:', scriptStart, 'scriptEnd:', scriptEnd);
    process.exit(1);
}

const jsContent = content.substring(scriptStart + '<script>'.length, scriptEnd).trim();
fs.writeFileSync(APP_JS_PATH, jsContent, 'utf-8');
console.log(`✅ JS extracted: ${jsContent.split('\n').length} lines, ${jsContent.length} bytes`);

// Replace inline script with module import  
// Everything from <script> to </script> gets replaced
const beforeScript = content.substring(0, scriptStart);
const afterScript = content.substring(scriptEnd + '</script>'.length);
content = beforeScript + '<script type="module" src="/js/app.js"></script>' + afterScript;

// ─── 3. Write modified HTML ────────────────────────────────────
fs.writeFileSync(HTML_PATH, content, 'utf-8');
const htmlLines = content.split('\n').length;
console.log(`✅ index.html updated: ${htmlLines} lines, ${content.length} bytes`);

console.log(`\n📊 Summary:`);
console.log(`   Original: ${origLen} bytes → ${content.length} bytes HTML + ${cssContent.length} CSS + ${jsContent.length} JS`);
console.log(`✨ Extraction complete!`);
