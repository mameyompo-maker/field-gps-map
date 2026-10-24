"""field_gps_map — 高画質の衛星写真(Sentinel-2 の 16 ビット雲なし合成)を、アプリ用のタイルと「束」に切る。

    python tools/hq_tiles.py <画像.tif|.npy> <画像.json> <出力フォルダ> --id monapo --name "Monapo"

入力:緯度経度の格子に並んだ 16 ビット RGB(fetch_sentinel2_hq.py の compose が作る形)。
  .json には bbox_wsen・step_deg・scenes・attribution が入っている。
  大きい範囲(200 km 四方で 2 GB を超える)は .npy(np.save、uint16、H×W×3)で渡すと、
  読み込まずに memmap で少しずつ処理する。

処理:
  1. 色の調整(Monapo の印刷用地図 make_community_maps.py の load_sat と同じ式):
     明るさの幅を広げる → 彩度 1.3 倍 → 周り(約 600 m)との明暗差と細かい輪郭を強める →
     ゆるい S 字の明るさ曲線。地形の陰影は掛けない(範囲ごとに標高データが要るため)。
  2. Web 地図(EPSG:3857)のズーム 14(約 9.2 m/画素)の 256px タイルへ、なめらかに(双一次)写す。
     ズーム 13〜8 は 4 枚を縮めて作る。画像の無い所は透明。WebP で保存。
  3. タイルを約 8 MB ごとの「束」(packs/*.bin)にまとめる。アプリはこの束を取り込む
     (Android の Chrome は Background Fetch で、アプリを閉じても続く)。束の形は
     'FGMP' + 見出しの長さ(4 バイト、リトルエンディアン)+ 見出し JSON {"tiles": [[z/x/y, 開始, 長さ], ...]} + 中身。
  4. index.json に範囲・撮影日・ズーム・束の一覧を書く。

rasterio はこの PC のアプリ制御で止められるので使わない(numpy・scipy・tifffile・Pillow だけ)。
"""
import argparse
import hashlib
import io
import json
import math
import os
import struct
import time
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as nd

SATURATION = 1.30
CLARITY = 0.45
SHARPEN = 0.7
GAMMA = 0.85
ZMAX, ZMIN = 14, 8
QUALITY = 80
PACK_BYTES = 8 * 1024 * 1024
BAND_ROWS = 6            # ズーム 14 のタイルを何行ずつまとめて処理するか(メモリの節約)


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


def lng2x(lng, z):
    return (lng + 180) / 360 * 2 ** z


def lat2y(lat, z):
    r = math.radians(lat)
    return (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * 2 ** z


def x2lng(x, z):
    return x / 2 ** z * 360 - 180


def y2lat(y, z):
    return math.degrees(math.atan(math.sinh(math.pi - 2 * math.pi * y / 2 ** z)))


def load(src):
    if src.suffix == '.npy':
        return np.load(src, mmap_mode='r')
    import tifffile
    return tifffile.imread(src)


def stats(img):
    """明るさの幅(全体で 1 回だけ。少しずつ処理しても色がそろうように)。"""
    H = img.shape[0]
    rows = np.linspace(0, H - 1, min(H, 1500)).astype(int)
    sub = np.asarray(img[rows, ::7]).astype(np.float32)
    valid = sub.sum(axis=2) > 0
    lo, hi = np.percentile(sub[valid], (0.5, 99.7))
    return float(lo), float(hi)


def grade(win, lo, hi, px_m):
    """色の調整。win は 16 ビットの切り出し(周りに余白つき)。返り値は 0〜1 の float32 と、画像の有る所。"""
    img = win.astype(np.float32)
    valid = img.sum(axis=2) > 0
    img = np.clip((img - lo) / max(hi - lo, 1e-3), 0, 1)
    lum = img.mean(axis=2, keepdims=True)
    img = np.clip(lum + (img - lum) * SATURATION, 0, 1)
    lum = img.mean(axis=2)
    wide = nd.gaussian_filter(lum, 600 / px_m)
    fine = nd.gaussian_filter(lum, 1.0)
    new = lum + CLARITY * (lum - wide) + SHARPEN * (lum - fine)
    new = np.clip(new, 0, 1)
    new = new + 0.35 * new * (1 - new) * (2 * new - 1)
    new = np.clip(0.5 + (new - 0.5) * 1.15, 0, 1) ** GAMMA
    img = np.clip(img * (new / np.maximum(lum, 1e-3))[..., None], 0, 1)
    return img, valid


def halve(rgba):
    """256px → 128px(2×2 の平均)。Lanczos はタイルの端で明るさがずれ、地図に継ぎ目の線が出たのでやめた。"""
    return rgba.reshape(128, 2, 128, 2, 4).mean(axis=(1, 3)).round().astype(np.uint8)


def webp(rgba):
    im = Image.fromarray(rgba, 'RGBA')
    if rgba[..., 3].min() == 255:
        im = im.convert('RGB')
    b = io.BytesIO()
    im.save(b, 'WEBP', quality=QUALITY, method=6)
    return b.getvalue()


def write_packs(out, tiles):
    """タイル {z/x/y: WebP} を約 PACK_BYTES ごとの束にして out/packs/ に書く。返り値は束の一覧。
    粗いズームを先に(最初の束だけで範囲全体がぼんやり見える)、同じズームの中は北西から。
    前の束は残さない(名前に中身のハッシュが入るので、作り直すと名前が変わる)。"""
    (out / 'packs').mkdir(parents=True, exist_ok=True)
    order = sorted(tiles, key=lambda k: tuple(map(int, k.split('/'))))
    packs, cur, size = [], [], 0
    for k in order:
        cur.append(k)
        size += len(tiles[k])
        if size >= PACK_BYTES:
            packs.append(cur)
            cur, size = [], 0
    if cur:
        packs.append(cur)
    old = {p.name for p in (out / 'packs').glob('*.bin')}
    pack_meta = []
    for i, keys in enumerate(packs):
        head, body, off = [], io.BytesIO(), 0
        for k in keys:
            d = tiles[k]
            head.append([k, off, len(d)])
            body.write(d)
            off += len(d)
        hj = json.dumps({'tiles': head}, separators=(',', ':')).encode()
        blob = b'FGMP' + struct.pack('<I', len(hj)) + hj + body.getvalue()
        name = f'p{i:02d}-{hashlib.sha1(blob).hexdigest()[:8]}.bin'
        (out / 'packs' / name).write_bytes(blob)
        old.discard(name)
        pack_meta.append({'file': f'packs/{name}', 'bytes': len(blob), 'tiles': len(keys)})
    if old:
        log('old packs left in place (not referenced by index.json):', sorted(old))
    return pack_meta


def pack_existing(folder):
    """もう切ってあるタイル(folder/z/x/y.webp)を束にして、folder/index.json に packs を足す。"""
    out = Path(folder)
    tiles = {}
    for p in out.glob('*/*/*.webp'):
        z, x = p.parent.parent.name, p.parent.name
        tiles[f'{z}/{x}/{p.stem}'] = p.read_bytes()
    index = json.load(open(out / 'index.json', encoding='utf-8'))
    index['packs'] = write_packs(out, tiles)
    index['tiles'] = len(tiles)
    index['bytes'] = sum(p['bytes'] for p in index['packs'])
    json.dump(index, open(out / 'index.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    log('packed', len(tiles), 'tiles into', len(index['packs']), 'packs', f"{index['bytes'] / 1e6:.1f} MB")


def main():
    import sys
    if len(sys.argv) == 3 and sys.argv[1] == '--pack-existing':
        pack_existing(sys.argv[2])
        return
    ap = argparse.ArgumentParser()
    ap.add_argument('image')
    ap.add_argument('meta')
    ap.add_argument('out')
    ap.add_argument('--id', required=True)
    ap.add_argument('--name', required=True)
    a = ap.parse_args()

    src, out = Path(a.image), Path(a.out)
    (out / 'packs').mkdir(parents=True, exist_ok=True)
    m = json.load(open(a.meta, encoding='utf-8'))
    w, s, e, n = m['bbox_wsen']
    step = m['step_deg']
    img = load(src)
    H, W = img.shape[:2]
    px_m = step * 111320
    lo, hi = stats(img)
    log('image', img.shape, 'stretch', lo, hi)
    margin = int(4 * 600 / px_m) + 4

    tiles = {}                      # 'z/x/y' → WebP の中身
    half = {}                       # 1 つ上のズームを作るための、縮めたタイル(128px RGBA)
    z = ZMAX
    x0, x1 = int(lng2x(w, z)), int(lng2x(e, z))
    y0, y1 = int(lat2y(n, z)), int(lat2y(s, z))
    for by in range(y0, y1 + 1, BAND_ROWS):
        ty1 = min(by + BAND_ROWS - 1, y1)
        lat_top, lat_bot = y2lat(by, z), y2lat(ty1 + 1, z)
        r0 = max(0, int((n - lat_top) / step) - margin)
        r1 = min(H, int((n - lat_bot) / step) + margin + 2)
        if r1 <= r0:
            continue
        g, valid = grade(np.asarray(img[r0:r1]), lo, hi, px_m)
        validf = valid.astype(np.float32)
        for ty in range(by, ty1 + 1):
            # タイルの画素の中心の緯度(行ごと)と経度(列ごと)
            ys = ty + (np.arange(256) + 0.5) / 256
            lats = np.degrees(np.arctan(np.sinh(np.pi - 2 * np.pi * ys / 2 ** z)))
            rows = (n - lats) / step - 0.5 - r0
            for tx in range(x0, x1 + 1):
                xs = tx + (np.arange(256) + 0.5) / 256
                lngs = xs / 2 ** z * 360 - 180
                cols = (lngs - w) / step - 0.5
                if cols[-1] < 0 or cols[0] > W - 1 or rows[-1] < 0 or rows[0] > (r1 - r0) - 1:
                    continue
                R, C = np.meshgrid(rows, cols, indexing='ij')
                coords = np.array([R.ravel(), C.ravel()])
                alpha = nd.map_coordinates(validf, coords, order=1, mode='constant', cval=0).reshape(256, 256)
                if alpha.max() < 0.5:
                    continue
                rgb = np.stack([nd.map_coordinates(g[..., k], coords, order=1, mode='nearest').reshape(256, 256)
                                for k in range(3)], axis=2)
                rgba = np.empty((256, 256, 4), np.uint8)
                rgba[..., :3] = np.round(rgb * 255)
                rgba[..., 3] = np.where(alpha >= 0.5, 255, 0)
                key = f'{z}/{tx}/{ty}'
                tiles[key] = webp(rgba)
                half[key] = halve(rgba)
        log(f'z{z} rows {by}-{ty1} / {y1}  tiles {len(tiles)}')
        del g, valid, validf

    # 粗いズーム:子の 4 枚をつないで縮める
    for z in range(ZMAX - 1, ZMIN - 1, -1):
        parents = {}
        for key in [k for k in half if k.startswith(f'{z + 1}/')]:
            _, cx, cy = map(int, key.split('/'))
            parents.setdefault((cx // 2, cy // 2), []).append((cx % 2, cy % 2, half.pop(key)))
        for (px, py), kids in parents.items():
            canvas = np.zeros((256, 256, 4), np.uint8)
            for dx, dy, im in kids:
                canvas[dy * 128:dy * 128 + 128, dx * 128:dx * 128 + 128] = im
            canvas[..., 3] = np.where(canvas[..., 3] >= 128, 255, 0)
            key = f'{z}/{px}/{py}'
            tiles[key] = webp(canvas)
            half[key] = halve(canvas)
        log(f'z{z} tiles {len(parents)}')
    half.clear()

    # 1 枚ずつのファイル(電波のあるときに、まだ取り込んでいない所を直接読む用)
    for key, data in tiles.items():
        p = out / f'{key}.webp'
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)

    pack_meta = write_packs(out, tiles)
    dates = sorted({sc['date'] for sc in m.get('scenes', [])})
    index = {
        'id': a.id,
        'name': a.name,
        'bbox': [round(w, 5), round(s, 5), round(e, 5), round(n, 5)],
        'minzoom': ZMIN, 'maxzoom': ZMAX, 'format': 'webp',
        'dates': [dates[0], dates[-1]] if dates else [],
        'method': m.get('method', ''),
        'attribution': m.get('attribution', 'Contains modified Copernicus Sentinel data 2026'),
        'tiles': len(tiles),
        'bytes': sum(p['bytes'] for p in pack_meta),
        'packs': pack_meta,
    }
    json.dump(index, open(out / 'index.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    log('done', len(tiles), 'tiles', len(pack_meta), 'packs', f"{index['bytes'] / 1e6:.1f} MB")


if __name__ == '__main__':
    main()
