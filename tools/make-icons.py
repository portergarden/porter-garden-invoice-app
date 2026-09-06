# -*- coding: utf-8 -*-
"""PWA用のアイコンPNGを作る。

なぜ必要か:
  ホーム画面に追加してもらわないと iPhone ではプッシュ通知が出せない。
  そのためには manifest.json と、そこから参照するPNGアイコンが要る。
  外部ライブラリを入れずに済むよう、PNGを直接書き出している
  （ロゴはログイン画面のSVGと同じ4つの四角形。塗りつぶしで描く）。

使い方:
  python tools/make-icons.py
  何度実行しても同じ結果になる（べき等）。
"""
import io
import os
import struct
import sys
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'icons')

BG = (0x25, 0x63, 0xEB)      # --blue
FG = (0xFF, 0xFF, 0xFF)

# ログイン画面のSVG（viewBox 0 0 24 24）と同じ配置。(x, y, w, h, 角丸半径)
MARK = [(4, 4, 6, 10, 1), (14, 4, 6, 6, 1), (14, 14, 6, 6, 1), (4, 18, 6, 2, 1)]

# ロゴが占める割合。マスク（丸や四角に切り抜かれる端末）でも欠けないよう内側に収める
LOGO_RATIO_ANY = 0.62
LOGO_RATIO_MASKABLE = 0.46


def write_png(path, size, ratio):
    px = [[BG] * size for _ in range(size)]
    span = size * ratio
    scale = span / 24.0
    off = (size - span) / 2.0
    for rx, ry, rw, rh, rr in MARK:
        x0, y0 = off + rx * scale, off + ry * scale
        x1, y1 = x0 + rw * scale, y0 + rh * scale
        r = rr * scale
        for y in range(max(0, int(y0)), min(size, int(y1) + 1)):
            for x in range(max(0, int(x0)), min(size, int(x1) + 1)):
                cx, cy = x + 0.5, y + 0.5
                if not (x0 <= cx <= x1 and y0 <= cy <= y1):
                    continue
                # 角丸: 角の円の外側は塗らない
                nx = min(max(cx, x0 + r), x1 - r)
                ny = min(max(cy, y0 + r), y1 - r)
                if (cx - nx) ** 2 + (cy - ny) ** 2 > r * r:
                    continue
                px[y][x] = FG

    raw = bytearray()
    for row in px:
        raw.append(0)  # フィルタ種別: なし
        for c in row:
            raw += bytes(c)

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF))

    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
           + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(png)
    return len(png)


def main():
    if not os.path.isdir(OUT):
        os.makedirs(OUT)
    jobs = [
        ('icon-192.png', 192, LOGO_RATIO_ANY),
        ('icon-512.png', 512, LOGO_RATIO_ANY),
        ('icon-maskable-512.png', 512, LOGO_RATIO_MASKABLE),
        ('icon-180.png', 180, LOGO_RATIO_ANY),  # iOSのホーム画面用（apple-touch-icon）
    ]
    for name, size, ratio in jobs:
        n = write_png(os.path.join(OUT, name), size, ratio)
        print('%-24s %4dx%-4d %6d bytes' % (name, size, size, n))
    return 0


if __name__ == '__main__':
    sys.exit(main())
