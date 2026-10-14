"""将项目自己的考据 Markdown 生成为可在手机阅读的静态来源页。"""
from pathlib import Path
import html
import re

root = Path(__file__).resolve().parent.parent

def inline(text):
    text = html.escape(text)
    return re.sub(r'\[([^\]]+)\]\((https?://[^\s)]+)\)', r'<a href="\2" target="_blank" rel="noopener noreferrer">\1</a>', text)

parts = []
in_table = False
in_list = False
for line in (root / 'SOURCES.md').read_text().splitlines():
    if in_table and not line.startswith('|'):
        parts.append('</tbody></table></div>')
        in_table = False
    if in_list and not line.startswith('- '):
        parts.append('</ul>')
        in_list = False
    if not line:
        continue
    if line.startswith('|'):
        if re.match(r'^\|[\s:|\-]+\|$', line):
            continue
        cells = line.strip('|').split('|')
        if not in_table:
            parts.append('<div class="table"><table><thead><tr>' + ''.join('<th>' + inline(c.strip()) + '</th>' for c in cells) + '</tr></thead><tbody>')
            in_table = True
        else:
            parts.append('<tr>' + ''.join('<td>' + inline(c.strip()) + '</td>' for c in cells) + '</tr>')
    elif line.startswith('#'):
        level = len(line) - len(line.lstrip('#'))
        parts.append(f'<h{level}>{inline(line[level:].strip())}</h{level}>')
    elif line.startswith('- '):
        if not in_list:
            parts.append('<ul>')
            in_list = True
        parts.append('<li>' + inline(line[2:]) + '</li>')
    else:
        parts.append('<p>' + inline(line) + '</p>')
if in_table:
    parts.append('</tbody></table></div>')
if in_list:
    parts.append('</ul>')
page = '''<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>内容核查与来源 · 米斯卡托尼克讲义</title><style>
:root{color-scheme:dark;--bg:#06100f;--fg:#d8dfd8;--dim:#94a7a0;--accent:#68b5a3;--line:#27433b}
@media(prefers-color-scheme:light){:root{color-scheme:light;--bg:#f4f3ec;--fg:#222521;--dim:#555d57;--accent:#1d6b5b;--line:#ced7cf}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.85 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}
main{max-width:1000px;margin:auto;padding:calc(24px + env(safe-area-inset-top)) 20px calc(40px + env(safe-area-inset-bottom))}a{color:var(--accent);text-underline-offset:3px;overflow-wrap:anywhere}h1{font-size:clamp(1.5rem,5vw,2.1rem)}h2{font-size:1.25rem;margin-top:2.5rem}.table{overflow-x:auto;border:1px solid var(--line);border-radius:3px}table{border-collapse:collapse;width:100%;min-width:720px;font-size:.88rem}th,td{border-bottom:1px solid var(--line);padding:12px;vertical-align:top;text-align:left}th:first-child{width:18%}td:nth-child(2){width:42%}li{margin-block:12px}footer{color:var(--dim);border-top:1px solid var(--line);margin-top:32px;padding-top:20px}a:focus-visible{outline:2px solid var(--accent);outline-offset:4px}
</style></head><body><main><nav><a href="./">返回讲义</a></nav>
''' + '\n'.join(parts) + '\n<footer>由本项目 SOURCES.md 生成，保留来源与核查边界。</footer></main></body></html>\n'
(root / 'sources.html').write_text(page)
print('sources.html generated')
