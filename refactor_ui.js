const fs = require('fs');

let content = fs.readFileSync('index.html', 'utf-8');

// Define utility classes mappings
const typographyMap = {
    'font-size:10px': 'text-xs',
    'font-size:11px': 'text-sm',
    'font-size: 11px': 'text-sm',
    'font-size:12px': 'text-sm',
    'font-size: 12px': 'text-sm',
    'font-size:13px': 'text-base',
    'font-size: 13px': 'text-base',
    'font-size:14px': 'text-base',
    'font-size: 14px': 'text-base',
    'font-size:15px': 'text-lg',
    'font-size: 15px': 'text-lg',
    'font-size:16px': 'text-lg',
    'font-size: 16px': 'text-lg',
    'font-size:20px': 'text-xl',
    'font-size: 20px': 'text-xl',
    'font-weight:400': 'font-normal',
    'font-weight: 400': 'font-normal',
    'font-weight:600': 'font-semibold',
    'font-weight: 600': 'font-semibold',
    'font-weight:700': 'font-bold',
    'font-weight: 700': 'font-bold',
    'font-weight:800': 'font-extrabold',
    'font-weight: 800': 'font-extrabold',
    'color:var(--muted)': 'text-muted',
    'color:var(--text)': 'text-primary',
    'color:var(--blue)': 'text-blue',
    'color:var(--green)': 'text-green',
    'color:var(--red)': 'text-red',
    'color:#fff': 'text-white',
    'color: #fff': 'text-white'
};

const spacingMap = {
    'margin-bottom:4px': 'mb-1',
    'margin-bottom: 4px': 'mb-1',
    'margin-bottom:6px': 'mb-1',
    'margin-bottom: 6px': 'mb-1',
    'margin-bottom:8px': 'mb-2',
    'margin-bottom: 8px': 'mb-2',
    'margin-bottom:10px': 'mb-2',
    'margin-bottom: 10px': 'mb-2',
    'margin-bottom:12px': 'mb-3',
    'margin-bottom: 12px': 'mb-3',
    'margin-bottom:14px': 'mb-4',
    'margin-bottom: 14px': 'mb-4',
    'margin-bottom:16px': 'mb-4',
    'margin-bottom: 16px': 'mb-4',
    'margin-bottom:20px': 'mb-5',
    'margin-bottom: 20px': 'mb-5',
    'margin-bottom:24px': 'mb-6',
    'margin-bottom: 24px': 'mb-6',
    'margin-top:4px': 'mt-1',
    'margin-top: 4px': 'mt-1',
    'margin-top:16px': 'mt-4',
    'margin-top: 16px': 'mt-4',
    'padding:16px': 'p-4',
    'padding: 16px': 'p-4',
    'padding:24px': 'p-6',
    'padding: 24px': 'p-6',
    'display:flex': 'flex',
    'display: flex': 'flex',
    'align-items:center': 'items-center',
    'align-items: center': 'items-center',
    'justify-content:center': 'justify-center',
    'justify-content: center': 'justify-center',
    'justify-content:space-between': 'justify-between',
    'justify-content: space-between': 'justify-between'
};

// 1. Inject utility CSS classes into <style>
const utilityCSS = `
        /* ── Utility Classes (Refactored) ────────── */
        .text-xs { font-size: 11px; }
        .text-sm { font-size: 13px; line-height: 1.4; }
        .text-base { font-size: 14px; line-height: 1.5; }
        .text-lg { font-size: 16px; font-weight: 600; }
        .text-xl { font-size: 20px; font-weight: 700; letter-spacing: -0.02em; }
        .font-normal { font-weight: 400; }
        .font-semibold { font-weight: 600; }
        .font-bold { font-weight: 700; }
        .font-extrabold { font-weight: 800; }
        .text-muted { color: var(--muted); }
        .text-primary { color: var(--text); }
        .text-blue { color: var(--blue); }
        .text-green { color: var(--green); }
        .text-red { color: var(--red); }
        .text-white { color: #ffffff; }
        .mb-1 { margin-bottom: 6px; }
        .mb-2 { margin-bottom: 10px; }
        .mb-3 { margin-bottom: 14px; }
        .mb-4 { margin-bottom: 18px; }
        .mb-5 { margin-bottom: 24px; }
        .mb-6 { margin-bottom: 32px; }
        .mt-1 { margin-top: 6px; }
        .mt-4 { margin-top: 18px; }
        .p-4 { padding: 18px; }
        .p-6 { padding: 26px; }
        .flex { display: flex; }
        .items-center { align-items: center; }
        .justify-center { justify-content: center; }
        .justify-between { justify-content: space-between; }
        
        /* ── Standardized Buttons ────────────────── */
        .btn-danger { background: linear-gradient(135deg,var(--red),#b91c1c); color:#fff; box-shadow:0 2px 8px rgba(239,68,68,0.15); }
        .btn-danger:hover { filter:brightness(1.1); transform:translateY(-1px); box-shadow:0 4px 16px rgba(239,68,68,0.2); }
`;

content = content.replace('/* ── Custom Scrollbar ────────────────────── */', utilityCSS + '\n        /* ── Custom Scrollbar ────────────────────── */');

// Helper to replace styles in HTML elements
const mappings = { ...typographyMap, ...spacingMap };

// We want to match all elements with style="...", then extract matching styles and move them to class="...".
content = content.replace(/<([a-zA-Z0-9]+)([^>]*)style="([^"]+)"([^>]*)>/g, (match, tag, before, styles, after) => {
    let newStyles = styles;
    const addedClasses = [];
    
    // Sort keys by length descending to match larger strings first
    const sortedKeys = Object.keys(mappings).sort((a,b)=> b.length - a.length);

    for(const key of sortedKeys) {
        if(newStyles.includes(key)) {
            newStyles = newStyles.replace(key + ';', '');
            newStyles = newStyles.replace(key, '');
            addedClasses.push(mappings[key]);
        }
    }
    
    newStyles = newStyles.trim();
    if(newStyles.endsWith(';')) newStyles = newStyles.slice(0, -1).trim();
    if(newStyles.startsWith(';')) newStyles = newStyles.slice(1).trim();
    
    // Clean double semicolons
    newStyles = newStyles.replace(/;+/g, ';').trim();

    let newTag = \`<\${tag}\${before}\`;
    
    // Handle existing class attribute
    if (addedClasses.length > 0) {
        const classMatch = newTag.match(/class="([^"]*)"/);
        if (classMatch) {
            const existingClasses = classMatch[1];
            newTag = newTag.replace(/class="[^"]*"/, \`class="\${existingClasses} \${addedClasses.join(' ')}"\`);
        } else {
            newTag += \` class="\${addedClasses.join(' ')}"\`;
        }
    }

    if (newStyles.length > 0) {
        newTag += \` style="\${newStyles}"\`;
    }
    
    newTag += \`\${after}>\`;
    
    return newTag;
});

// Clean up duplicate spaces in classes
content = content.replace(/class="([^"]+)"/g, (match, classes) => {
    const uniqueClasses = [...new Set(classes.split(/\s+/).filter(Boolean))].join(' ');
    return \`class="\${uniqueClasses}"\`;
});

// Replace odd button declarations (btn-ghost but color red, etc)
content = content.replace(/class=\"btn btn-ghost btn-sm\" style=\"color:var\(--red\);border-color:rgba\(239,68,68,0\.3\);\"/g, 'class="btn btn-danger btn-sm"');

fs.writeFileSync('index.html', content);
console.log('Refactor complete.');
