"""field_gps_map — 圏外用の衛星写真(Sentinel-2)のタイルを作る。

    python tools/s2_tiles.py <作業フォルダ> <出力フォルダ>
    例) python tools/s2_tiles.py %TEMP%\\s2work ..\\field_gps_imagery\\docs\\s2

しくみ:
  1. Earth Search(AWS の公開データ、登録不要)で、範囲にかかる Sentinel-2 L2A の画像のうち
     雲がほとんど無い新しいものを MGRS タイルごとに選ぶ。
  2. TCI(自然な色の 10 m 画像。最初から 8 ビット RGB)の必要な部分だけを読み、1枚につなぐ。
     先に置いた画像の隙間(画像の端・欠け)だけを次の画像で埋める。全部 UTM 37S なので、そのまま重ねられる。
  3. Web 地図の座標(EPSG:3857)へ変換し、ズーム 14(約 9.5 m/画素)の 256px タイルに切る。
     ズーム 13〜8 は 4 枚を縮めて作る。WebP(透明あり)で保存。
  4. index.json に範囲・撮影日・ズームを書く(アプリはこれを見て、範囲内なら取り込む)。

ライセンス:Copernicus Sentinel データは無料・商用利用可。表示に
  「Contains modified Copernicus Sentinel data 2026」を入れる(アプリの地図に描いている)。
Google・Esri・EOX の画像は使わない(規約上、保存や商用が許されないため)。
"""
import json
import math
import os
import sys
import time

import numpy as np
import rasterio
from PIL import Image
from pystac_client import Client
from rasterio.enums import Resampling
from rasterio.warp import reproject, transform_bounds
from rasterio.windows import Window, from_bounds

# 範囲:Malema と Ribáue の中間を中心に、一辺 200 km(半径 100 km)
CENTER = (-14.95, 37.84)
HALF_KM = 100
DATES = '2026-08-15/2026-10-21'      # 乾期(雲が少ない)
ZMAX, ZMIN = 14, 8
QUALITY = 72

WORK = sys.argv[1]
OUT = sys.argv[2]
os.makedirs(WORK, exist_ok=True)
os.makedirs(OUT, exist_ok=True)
os.environ.setdefault('GDAL_DISABLE_READDIR_ON_OPEN', 'EMPTY_DIR')
os.environ.setdefault('GDAL_HTTP_MULTIRANGE', 'YES')
os.environ.setdefault('GDAL_HTTP_MERGE_CONSECUTIVE_RANGES', 'YES')
os.environ.setdefault('VSI_CACHE', 'TRUE')
os.environ.setdefault('GDAL_HTTP_MAX_RETRY', '5')
os.environ.setdefault('GDAL_HTTP_RETRY_DELAY', '3')

dlat = HALF_KM / 111.32
dlng = HALF_KM / (111.32 * math.cos(math.radians(CENTER[0])))
BBOX = (CENTER[1] - dlng, CENTER[0] - dlat, CENTER[1] + dlng, CENTER[0] + dlat)   # W S E N
print('bbox', [round(x, 4) for x in BBOX])


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


# ------------------------------------------------------------------ 1. 画像を選ぶ
cat = Client.open('https://earth-search.aws.element84.com/v1')
items = list(cat.search(collections=['sentinel-2-c1-l2a'], bbox=BBOX, datetime=DATES,
                        query={'eo:cloud_cover': {'lt': 2}}, max_items=1000).items())
by = {}
for it in items:
    if it.properties.get('proj:code', it.properties.get('proj:epsg')) not in ('EPSG:32737', 32737):
        continue
    by.setdefault(it.properties['grid:code'], []).append(it)
plan = []
for code, lst in sorted(by.items()):
    # 欠けの少ない画像 → 雲の少ない画像 → 新しい画像 の順
    lst.sort(key=lambda it: (round(it.properties.get('s2:nodata_pixel_percentage', 0) / 10),
                             round(it.properties['eo:cloud_cover'] * 2), -it.datetime.timestamp()))
    plan.append((code, lst[:4]))
    log(code, [(i.datetime.date().isoformat(), round(i.properties['eo:cloud_cover'], 2),
                round(i.properties.get('s2:nodata_pixel_percentage', 0))) for i in lst[:4]])

# ------------------------------------------------------------------ 2. 1枚につなぐ(UTM 37S、10 m)
utm = transform_bounds('EPSG:4326', 'EPSG:32737', *BBOX, densify_pts=21)
x0, y0 = math.floor(utm[0] / 10) * 10, math.ceil(utm[3] / 10) * 10
W = int(math.ceil((utm[2] - x0) / 10))
H = int(math.ceil((y0 - utm[1]) / 10))
mos_path = os.path.join(WORK, 'mosaic_utm.tif')
mos_tf = rasterio.transform.from_origin(x0, y0, 10, 10)
used = []
if not os.path.exists(mos_path + '.done'):
    prof = dict(driver='GTiff', width=W, height=H, count=3, dtype='uint8', crs='EPSG:32737', transform=mos_tf,
                tiled=True, blockxsize=512, blockysize=512, compress='deflate', nodata=0, BIGTIFF='YES')
    # 途中で止まったときは、作りかけの続きから(埋まった所は読み直さない)
    resume = os.path.exists(mos_path)
    with (rasterio.open(mos_path, 'r+') if resume else rasterio.open(mos_path, 'w+', **prof)) as mos:
        CH = 4096
        read_mb = 0.0
        # 1巡目は各 MGRS の1位、2巡目は2位…(隙間だけ埋める)
        for rank in range(4):
            for code, lst in plan:
                if rank >= len(lst):
                    continue
                it = lst[rank]
                href = it.assets['visual'].href
                with rasterio.open(href) as src:
                    b = src.bounds
                    ix0, iy0 = max(b.left, x0), min(b.top, y0)
                    ix1, iy1 = min(b.right, x0 + W * 10), max(b.bottom, y0 - H * 10)
                    if ix1 <= ix0 or iy0 <= iy1:
                        continue
                    filled = 0
                    for cy in np.arange(iy0, iy1, -CH * 10):
                        for cx in np.arange(ix0, ix1, CH * 10):
                            cx1, cy1 = min(cx + CH * 10, ix1), max(cy - CH * 10, iy1)
                            mw = from_bounds(cx, cy1, cx1, cy, mos_tf).round_offsets().round_lengths()
                            cur = mos.read(window=mw)
                            gap = (cur.max(axis=0) == 0)
                            if gap.mean() < 0.001:
                                continue
                            sw = from_bounds(cx, cy1, cx1, cy, src.transform).round_offsets().round_lengths()
                            for attempt in range(4):
                                try:
                                    new = src.read(window=sw, boundless=True, fill_value=0,
                                                   out_shape=(3, mw.height, mw.width))
                                    break
                                except rasterio.errors.RasterioIOError as err:
                                    if attempt == 3:
                                        raise
                                    log('read failed, retry', attempt + 1, err)
                                    time.sleep(10)
                            read_mb += new.nbytes / 1e6 / 4   # 圧縮後のおおよそ
                            ok = gap & (new.max(axis=0) > 0)
                            if not ok.any():
                                continue
                            cur[:, ok] = new[:, ok]
                            mos.write(cur, window=mw)
                            filled += int(ok.sum())
                    if filled:
                        used.append({'scene': it.id, 'date': it.datetime.date().isoformat(), 'px': filled})
                    log(f'rank{rank} {code} {it.datetime.date()} filled {filled/1e6:.1f} Mpx (~{read_mb:.0f} MB read)')
    json.dump(used, open(mos_path + '.done', 'w'))
used = json.load(open(mos_path + '.done'))

# ------------------------------------------------------------------ 3. Web 地図の座標へ(ズーム 14 の格子に合わせる)
R = 6378137.0
ORIGIN = math.pi * R


def lnglat_to_tile(lng, lat, z):
    n = 2 ** z
    x = (lng + 180) / 360 * n
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    return x, y


tx0, ty0 = [int(math.floor(v)) for v in lnglat_to_tile(BBOX[0], BBOX[3], ZMAX)]
tx1, ty1 = [int(math.floor(v)) for v in lnglat_to_tile(BBOX[2], BBOX[1], ZMAX)]
res = 2 * ORIGIN / (256 * 2 ** ZMAX)
merc_tf = rasterio.transform.from_origin(-ORIGIN + tx0 * 256 * res, ORIGIN - ty0 * 256 * res, res, res)
MW, MH = (tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256
merc_path = os.path.join(WORK, 'mosaic_3857.tif')
if not os.path.exists(merc_path + '.done'):
    log('reproject', MW, MH)
    prof = dict(driver='GTiff', width=MW, height=MH, count=3, dtype='uint8', crs='EPSG:3857', transform=merc_tf,
                tiled=True, blockxsize=256, blockysize=256, compress='deflate', nodata=0, BIGTIFF='YES')
    with rasterio.open(mos_path) as src, rasterio.open(merc_path, 'w', **prof) as dst:
        for bi in (1, 2, 3):
            reproject(rasterio.band(src, bi), rasterio.band(dst, bi), resampling=Resampling.bilinear,
                      src_nodata=0, dst_nodata=0, warp_mem_limit=1024, num_threads=4)
    open(merc_path + '.done', 'w').write('ok')

# ------------------------------------------------------------------ 4. タイルに切る
def save(img, z, x, y):
    d = os.path.join(OUT, str(z), str(x))
    os.makedirs(d, exist_ok=True)
    img.save(os.path.join(d, f'{y}.webp'), 'WEBP', quality=QUALITY, method=5)


have = set()   # 作ったタイル(z, x, y)。画像はディスクから読み直す(全部メモリに置くと 2 GB になる)
log('cut z', ZMAX)
with rasterio.open(merc_path) as src:
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            win = Window((tx - tx0) * 256, (ty - ty0) * 256, 256, 256)
            a = src.read(window=win)
            valid = a.max(axis=0) > 0
            if valid.mean() < 0.02:
                continue
            rgba = np.dstack([a[0], a[1], a[2], (valid * 255).astype('uint8')])
            img = Image.fromarray(rgba, 'RGBA')
            if valid.all():
                img = img.convert('RGB')
            save(img, ZMAX, tx, ty)
            have.add((ZMAX, tx, ty))
log('z14 tiles', len(have))

for z in range(ZMAX - 1, ZMIN - 1, -1):
    parents = {}
    for (zz, x, y) in [k for k in have if k[0] == z + 1]:
        parents.setdefault((x // 2, y // 2), []).append((x, y))
    for (px, py), kids in parents.items():
        canvas = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
        for (x, y) in kids:
            child = Image.open(os.path.join(OUT, str(z + 1), str(x), f'{y}.webp')).convert('RGBA')
            canvas.paste(child, ((x - px * 2) * 256, (y - py * 2) * 256))
        img = canvas.resize((256, 256), Image.LANCZOS)
        if img.getextrema()[3][0] == 255:
            img = img.convert('RGB')
        save(img, z, px, py)
        have.add((z, px, py))
    log('z', z, len(parents))

total = 0
count = 0
for root, _, files in os.walk(OUT):
    for f in files:
        if f.endswith('.webp'):
            total += os.path.getsize(os.path.join(root, f))
            count += 1
dates = sorted({u['date'] for u in used})
index = {
    'name': 'Sentinel-2 (Malema – Ribáue)',
    'bbox': [round(v, 5) for v in BBOX],   # W S E N
    'minzoom': ZMIN, 'maxzoom': ZMAX, 'format': 'webp',
    'dates': [dates[0], dates[-1]] if dates else [],
    'attribution': 'Contains modified Copernicus Sentinel data 2026',
    'tiles': count, 'bytes': total,
    'scenes': used,
}
json.dump(index, open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
log('done', count, 'tiles', round(total / 1e6, 1), 'MB', dates)
