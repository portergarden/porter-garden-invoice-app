# -*- coding: utf-8 -*-
"""index.html が読み込む js/ css/ のURLに、中身から作った版番号を付ける。

なぜ必要か:
  JSとCSSを別ファイルに分けたことで、index.html と中身の版がずれる事故が起きうる。
  配信側（GitHub Pages やプレビューサーバ）はJS/CSSをキャッシュするため、
  index.html だけ新しくなって古いJSが動く、という組み合わせが成立してしまう。
  実際、プレビューサーバは max-age=3600 を返しており、修正したはずのJSが
  1時間ぶん古いまま実行された。単一ファイルだった頃には無かった問題。

  URLに中身のハッシュを付けておけば、中身が変われば必ずURLも変わるので、
  ブラウザは新しい方を取りに行く。中身が変わらなければURLも変わらないので、
  キャッシュはそのまま効く。

使い方:
  js/ か css/ を変更したら、コミットする前にこれを実行する。
      python tools/stamp-assets.py
  何度実行しても結果は同じ（べき等）。
"""
import hashlib
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(ROOT, 'index.html')


def digest(rel):
    path = os.path.join(ROOT, rel.replace('/', os.sep))
    if not os.path.exists(path):
        return None
    with open(path, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()[:8]


def main():
    html = io.open(INDEX, encoding='utf-8').read()
    original = html
    changed, missing = [], []

    def fix(m):
        attr, rel, ver = m.group(1), m.group(2), m.group(3)
        d = digest(rel)
        if d is None:
            missing.append(rel)
            return m.group(0)
        if ver == d:
            return m.group(0)
        changed.append('%s  %s → %s' % (rel, ver or '(なし)', d))
        return '%s="%s?v=%s"' % (attr, rel, d)

    # src="js/xxx.js" / href="css/xxx.css"（既に ?v= が付いていても拾う）
    html = re.sub(r'(src|href)="((?:js|css)/[^"?]+)(?:\?v=([0-9a-f]+))?"', fix, html)

    if missing:
        print('参照先が見つかりません:', ', '.join(missing))
        return 1
    if html != original:
        io.open(INDEX, 'w', encoding='utf-8', newline='').write(html)
    print('版番号を更新: %d件' % len(changed))
    for c in changed:
        print('  ' + c)
    if not changed:
        print('  変更なし（すべて最新）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
