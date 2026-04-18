import re
import json

with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Colors
hex_colors = re.findall(r'#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})\b', content)
rgba_colors = re.findall(r'(rgba?\(.*?\))', content)
all_colors = ['#' + c.lower() for c in hex_colors] + [c.replace(' ', '') for c in rgba_colors]
unique_colors = set(all_colors)

# 2. Spacing
paddings = re.findall(r'padding:\s*([^;]+);', content)
margins = re.findall(r'margin:\s*([^;]+);', content)
unique_paddings = set([p.strip() for p in paddings])
unique_margins = set([m.strip() for m in margins])

# 3. Typography
font_sizes = re.findall(r'font-size:\s*([^;]+);', content)
font_weights = re.findall(r'font-weight:\s*([^;]+);', content)
unique_fontsizes = set([fs.strip() for fs in font_sizes])
unique_fontweights = set([fw.strip() for fw in font_weights])

# 4. Buttons
btn_classes_raw = re.findall(r'class=\"([^\"]*btn[^\"]*)\"', content)
unique_btns = set([b.strip() for b in btn_classes_raw])

report = {
    'scan_metadata': {
        'total_files_scanned': 1,
        'framework': 'HTML/Vanilla'
    },
    'patterns': {
        'colors': {
            'total_instances': len(all_colors),
            'unique_patterns': len(unique_colors),
            'redundancy_factor': round(len(all_colors) / len(unique_colors) if len(unique_colors) > 0 else 0, 2)
        },
        'spacing': {
            'total_padding_instances': len(paddings),
            'unique_paddings': len(unique_paddings),
            'total_margin_instances': len(margins),
            'unique_margins': len(unique_margins)
        },
        'typography': {
            'total_fontsize_instances': len(font_sizes),
            'unique_fontsizes': len(unique_fontsizes),
            'unique_fontweights': len(unique_fontweights)
        },
        'buttons': {
            'total_btn_classes': len(btn_classes_raw),
            'unique_btn_variations': len(unique_btns)
        }
    }
}

with open('pattern-inventory.json', 'w') as f:
    json.dump(report, f, indent=2)

print('Scan complete.')
