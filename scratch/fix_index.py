
import sys

path = r'c:\Users\Samsung\Tracking-aTT\whatsapp-traking-oficial\index.html'
with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Line 2625 (0-indexed 2624)
if 'case \'lpv\':' in lines[2624]:
    lines[2624] = lines[2624].replace('lpv', 'totalVisits')

# Line 2626 (0-indexed 2625)
if 'case \'cplpv\':' in lines[2625]:
    lines[2625] = lines[2625].replace('lpv', 'totalVisits')

with open(path, 'w', encoding='utf-8') as f:
    f.writelines(lines)
print("Updated successfully")
