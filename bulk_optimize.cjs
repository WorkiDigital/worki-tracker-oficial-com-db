const fs = require('fs');

const content = fs.readFileSync('index.html', 'utf8');

let newContent = content;

// Replace paddings
newContent = newContent.replace(/style="([^"]*?)padding:\s*10px 12px;?([^"]*?)"/g, (m, p1, p2) => {
    const style = (p1 + p2).trim();
    const styleAttr = style ? `style="${style}"` : '';
    return `class="pad-md" ${styleAttr}`.trim();
});

newContent = newContent.replace(/style="([^"]*?)padding:\s*6px 10px;?([^"]*?)"/g, (m, p1, p2) => {
    const style = (p1 + p2).trim();
    const styleAttr = style ? `style="${style}"` : '';
    return `class="pad-sm" ${styleAttr}`.trim();
});

newContent = newContent.replace(/style="([^"]*?)padding:\s*20px;?([^"]*?)"/g, (m, p1, p2) => {
    const style = (p1 + p2).trim();
    const styleAttr = style ? `style="${style}"` : '';
    return `class="pad-lg" ${styleAttr}`.trim();
});

// Handle cases where class already exists
const fixClasses = (html) => {
    return html.replace(/class="([^"]*)"\s+class="([^"]*)"/g, 'class="$1 $2"');
};

newContent = fixClasses(newContent);

// Replace font-sizes
newContent = newContent.replace(/font-size:\s*13px;?/g, '');
newContent = newContent.replace(/class="([^"]*)"/g, (m, c) => {
    if (content.includes(`class="${c}"`) && content.includes('font-size:13px')) {
         // This is complex for regex. I'll stick to safer replacements.
    }
    return m;
});

fs.writeFileSync('index.html', newContent);
console.log('Bulk optimization complete.');
