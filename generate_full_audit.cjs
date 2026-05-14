const fs = require('fs');

function fullAudit() {
    const content = fs.readFileSync('index.html', 'utf8');
    
    // Extract all style attributes
    const styleAttributes = content.match(/style="([^"]*)"/g) || [];
    const allStyles = styleAttributes.map(s => s.match(/style="([^"]*)"/)[1]);
    
    const colors = [];
    const paddings = [];
    const fontSizes = [];
    
    allStyles.forEach(style => {
        // Colors
        const colorMatches = style.match(/(#[A-Fa-f0-9]{6}|#[A-Fa-f0-9]{3}|rgba?\([^)]+\))/g) || [];
        colorMatches.forEach(c => colors.push(c.toLowerCase().replace(/\s/g, '')));
        
        // Paddings
        const paddingMatches = style.match(/padding:\s*([^;]+)/g) || [];
        paddingMatches.forEach(p => paddings.push(p.replace('padding:', '').replace(';', '').trim()));

        // Font sizes
        const fontSizeMatches = style.match(/font-size:\s*([^;]+)/g) || [];
        fontSizeMatches.forEach(f => fontSizes.push(f.replace('font-size:', '').replace(';', '').trim()));
    });
    
    const count = (arr) => {
        const obj = {};
        arr.forEach(item => obj[item] = (obj[item] || 0) + 1);
        return Object.entries(obj)
            .sort((a, b) => b[1] - a[1])
            .map(([value, count]) => ({ value, count }));
    };
    
    const topColors = count(colors);
    const topPaddings = count(paddings);
    const topFontSizes = count(fontSizes);
    
    const report = {
        scan_metadata: {
            total_files_scanned: 1,
            framework: "HTML/Vanilla"
        },
        patterns: {
            colors: topColors,
            spacing: {
                paddings: topPaddings
            },
            typography: {
                fontSizes: topFontSizes
            }
        }
    };
    
    fs.writeFileSync('pattern-inventory.json', JSON.stringify(report, null, 2));
    console.log('Full pattern-inventory.json generated.');
}

fullAudit();
