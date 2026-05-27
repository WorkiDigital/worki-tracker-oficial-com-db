const fs = require('fs');

const content = fs.readFileSync('index.html', 'utf-8');

// 1. Colors
const hexColors = [...content.matchAll(/#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})\b/g)].map(m => m[0].toLowerCase());
const rgbaColors = [...content.matchAll(/(rgba?\([^)]+\))/g)].map(m => m[0].replace(/\s/g, ''));
const allColors = [...hexColors, ...rgbaColors];
const uniqueColors = new Set(allColors);

// 2. Spacing
const paddings = [...content.matchAll(/padding:\s*([^;]+);/g)].map(m => m[1].trim());
const margins = [...content.matchAll(/margin:\s*([^;]+);/g)].map(m => m[1].trim());
const uniquePaddings = new Set(paddings);
const uniqueMargins = new Set(margins);

// 3. Typography
const fontSizes = [...content.matchAll(/font-size:\s*([^;]+);/g)].map(m => m[1].trim());
const fontWeights = [...content.matchAll(/font-weight:\s*([^;]+);/g)].map(m => m[1].trim());
const uniqueFs = new Set(fontSizes);
const uniqueFw = new Set(fontWeights);

// 4. Buttons
const btnClassesRaw = [...content.matchAll(/class="([^"]*btn[^"]*)"/g)].map(m => m[1].trim());
const uniqueBtns = new Set(btnClassesRaw);

const report = {
    scan_metadata: {
        total_files_scanned: 1,
        framework: 'HTML/Vanilla'
    },
    patterns: {
        colors: {
            total_instances: allColors.length,
            unique_patterns: uniqueColors.size,
            redundancy_factor: uniqueColors.size > 0 ? (allColors.length / uniqueColors.size).toFixed(2) : 0
        },
        spacing: {
            total_padding_instances: paddings.length,
            unique_paddings: uniquePaddings.size,
            total_margin_instances: margins.length,
            unique_margins: uniqueMargins.size
        },
        typography: {
            total_fontsize_instances: fontSizes.length,
            unique_fontsizes: uniqueFs.size,
            unique_fontweights: uniqueFw.size
        },
        buttons: {
            total_btn_classes: btnClassesRaw.length,
            unique_btn_variations: uniqueBtns.size
        }
    }
};

fs.writeFileSync('pattern-inventory.json', JSON.stringify(report, null, 2));
console.log('Scan complete.');
