#!/usr/bin/env bash
# 소스에 등장하는 글자만 남겨 Pretendard 가변 폰트를 서브셋 (2MB → ~100KB)
# 필요: pip install fonttools brotli
set -euo pipefail
cd "$(dirname "$0")/.."
python3 - <<'PY'
import pathlib
chars=set()
for p in pathlib.Path('src').rglob('*'):
    if p.suffix in ('.ts','.tsx','.css'):
        chars.update(p.read_text(encoding='utf-8'))
chars.update(chr(c) for c in range(0x20,0x7f))
chars.update('×·—–→←−℃↑↓…%일월화수목금토년분초시간대건회')
pathlib.Path('/tmp/human-3dsim-glyphs.txt').write_text(''.join(sorted(c for c in chars if ord(c)>=0x20)), encoding='utf-8')
PY
python3 -m fontTools.subset node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2 \
  --text-file=/tmp/human-3dsim-glyphs.txt --flavor=woff2 --layout-features='*' \
  --output-file=src/assets/PretendardVariable.woff2
echo "subset → src/assets/PretendardVariable.woff2"
