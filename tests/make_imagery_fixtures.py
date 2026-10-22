"""取り込み試験用の画像ファイルを作る(GeoTIFF 3種と KMZ 1つ)。

    python tests/make_imagery_fixtures.py

rasterio が使えない PC(アプリ制御で DLL が止められる)でも動くよう、TIFF は自前で書く。
どれも Malema(-14.955, 37.41)のそばに置き、真ん中を目立つ色(マゼンタ)で塗る。e2e で画面の色を確かめるため。
"""
import io
import math
import os
import struct
import zipfile
import zlib

import numpy as np
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures')
LAT0, LNG0 = -14.955, 37.41
MAGENTA = (255, 0, 255)


def utm_forward(lat, lng, zone):
    """WGS84 の緯度経度 → UTM(南半球は北に 10,000 km 足す)。"""
    a, f = 6378137.0, 1 / 298.257223563
    e2 = f * (2 - f)
    ep2 = e2 / (1 - e2)
    k0 = 0.9996
    phi, lam = math.radians(lat), math.radians(lng)
    lam0 = math.radians((zone - 1) * 6 - 180 + 3)
    N = a / math.sqrt(1 - e2 * math.sin(phi) ** 2)
    T = math.tan(phi) ** 2
    C = ep2 * math.cos(phi) ** 2
    A = math.cos(phi) * (lam - lam0)
    M = a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * phi
             - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * math.sin(2 * phi)
             + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * math.sin(4 * phi)
             - (35 * e2 ** 3 / 3072) * math.sin(6 * phi))
    x = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000
    y = k0 * (M + N * math.tan(phi) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24
                                       + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720))
    if lat < 0:
        y += 10000000
    return x, y


def write_geotiff(path, arr, scale, tie, geokeys, extra_alpha=False, nodata=None, rows_per_strip=64):
    """arr: (H, W, S) の uint8/uint16。deflate で縞(strip)ごとに圧縮する。"""
    H, W, S = arr.shape
    bps = arr.dtype.itemsize * 8
    strips = []
    for r in range(0, H, rows_per_strip):
        strips.append(zlib.compress(arr[r:r + rows_per_strip].tobytes(), 6))
    entries = []   # (tag, type, values)
    SHORT, LONG, DOUBLE, ASCII = 3, 4, 12, 2
    entries.append((256, LONG, [W]))
    entries.append((257, LONG, [H]))
    entries.append((258, SHORT, [bps] * S))
    entries.append((259, SHORT, [8]))
    entries.append((262, SHORT, [2]))
    entries.append((273, LONG, [0] * len(strips)))       # あとで埋める
    entries.append((277, SHORT, [S]))
    entries.append((278, LONG, [rows_per_strip]))
    entries.append((279, LONG, [len(s) for s in strips]))
    entries.append((284, SHORT, [1]))
    if extra_alpha:
        entries.append((338, SHORT, [2]))
    entries.append((339, SHORT, [1] * S))
    entries.append((33550, DOUBLE, [scale, scale, 0.0]))
    entries.append((33922, DOUBLE, [0.0, 0.0, 0.0, tie[0], tie[1], 0.0]))
    entries.append((34735, SHORT, geokeys))
    if nodata is not None:
        entries.append((42113, ASCII, list(f'{nodata}\0'.encode())))
    entries.sort(key=lambda e: e[0])
    size = {SHORT: 2, LONG: 4, DOUBLE: 8, ASCII: 1}
    fmt = {SHORT: 'H', LONG: 'I', DOUBLE: 'd', ASCII: 'B'}

    ifd_off = 8
    ifd_len = 2 + len(entries) * 12 + 4
    extra_off = ifd_off + ifd_len
    extra = b''
    offsets = {}
    for tag, typ, vals in entries:
        n = len(vals) * size[typ]
        if n > 4:
            offsets[tag] = extra_off + len(extra)
            extra += b'\0' * n
            if len(extra) % 2:
                extra += b'\0'
    data_off = extra_off + len(extra)
    strip_offs = []
    o = data_off
    for s in strips:
        strip_offs.append(o)
        o += len(s)
    entries = [(t, ty, strip_offs if t == 273 else v) for t, ty, v in entries]
    # 書き出し
    extra = bytearray(extra)
    ifd = struct.pack('<H', len(entries))
    for tag, typ, vals in entries:
        payload = struct.pack('<' + fmt[typ] * len(vals), *vals)
        if len(payload) > 4:
            p = offsets[tag] - extra_off
            extra[p:p + len(payload)] = payload
            ifd += struct.pack('<HHII', tag, typ, len(vals), offsets[tag])
        else:
            ifd += struct.pack('<HHI', tag, typ, len(vals)) + payload.ljust(4, b'\0')
    ifd += struct.pack('<I', 0)
    with open(path, 'wb') as fh:
        fh.write(b'II*\0' + struct.pack('<I', ifd_off))
        fh.write(ifd)
        fh.write(bytes(extra))
        for s in strips:
            fh.write(s)
    print(path, os.path.getsize(path))


def test_pattern(W, H, label):
    """畑のような区画+中央のマゼンタ+向きが分かる文字(上=N)。"""
    img = Image.new('RGB', (W, H), (150, 120, 80))
    d = ImageDraw.Draw(img)
    rng = np.random.default_rng(1)
    step = max(40, W // 12)
    for y in range(0, H, step):
        for x in range(0, W, step):
            c = tuple(int(v) for v in rng.integers(60, 200, 3))
            d.rectangle([x + 2, y + 2, x + step - 3, y + step - 3], fill=(c[0], c[1] // 1 + 30, c[2] // 2))
    cx, cy = W // 2, H // 2
    d.rectangle([cx - W // 8, cy - H // 8, cx + W // 8, cy + H // 8], fill=MAGENTA)
    d.rectangle([0, 0, W - 1, 30], fill=(0, 0, 0))
    d.text((8, 8), f'N  {label}', fill=(255, 255, 255))
    return img


def main():
    os.makedirs(OUT, exist_ok=True)

    # 1) UTM 37S・8 ビット RGB+透明の帯(縁を透明に)・3000×2400、1画素 0.3 m(900 m × 720 m)
    W, H, res = 3000, 2400, 0.3
    rgb = np.array(test_pattern(W, H, 'UTM 37S RGBA'))
    alpha = np.full((H, W, 1), 255, np.uint8)
    alpha[:60, :] = 0
    alpha[-60:, :] = 0
    arr = np.concatenate([rgb, alpha], axis=2)
    x, y = utm_forward(LAT0, LNG0, 37)
    gk = [1, 1, 0, 3, 1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, 32737]
    write_geotiff(os.path.join(OUT, 'img_utm37s_rgba.tif'), arr, res, (x - W * res / 2, y + H * res / 2), gk, extra_alpha=True)

    # 2) 緯度経度(EPSG:4326)・16 ビット RGB(値 800〜3200)・1200×1000、東へ 1.5 km ずらす
    W, H = 1200, 1000
    base = np.array(test_pattern(W, H, 'EPSG4326 16bit')).astype(np.float64)
    arr16 = (800 + base / 255 * 2400).astype(np.uint16)
    deg = 0.5 / 111320 * 1.0        # 1画素 約 0.5 m(緯度方向)
    lng_c = LNG0 + 1500 / (111320 * math.cos(math.radians(LAT0)))
    gk = [1, 1, 0, 3, 1024, 0, 1, 2, 1025, 0, 1, 1, 2048, 0, 1, 4326]
    # 経度と緯度の1画素の角度を同じにする(画像はやや横長に見える。試験には十分)
    write_geotiff(os.path.join(OUT, 'img_4326_16bit.tif'), arr16, deg, (lng_c - W * deg / 2, LAT0 + H * deg / 2), gk)

    # 3) 座標系が分からない GeoTIFF(エラーの試験)
    gk = [1, 1, 0, 3, 1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, 2193]
    write_geotiff(os.path.join(OUT, 'img_bad_crs.tif'), np.array(test_pattern(200, 200, 'bad')), 1.0, (0, 0), gk)

    # 4) KMZ の GroundOverlay(回転 15°)・1000×800 JPEG、西へ 1.5 km
    img = test_pattern(1000, 800, 'KMZ rot15')
    buf = io.BytesIO()
    img.save(buf, 'JPEG', quality=85)
    lng_w = LNG0 - 1500 / (111320 * math.cos(math.radians(LAT0)))
    half_lat = 200 / 111320
    half_lng = 250 / (111320 * math.cos(math.radians(LAT0)))
    kml = f'''<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>test overlay</name>
<GroundOverlay><name>drone</name><Icon><href>files/overlay.jpg</href></Icon>
<LatLonBox><north>{LAT0 + half_lat}</north><south>{LAT0 - half_lat}</south><east>{lng_w + half_lng}</east><west>{lng_w - half_lng}</west><rotation>15</rotation></LatLonBox>
</GroundOverlay></Document></kml>'''
    p = os.path.join(OUT, 'img_overlay.kmz')
    with zipfile.ZipFile(p, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('doc.kml', kml)
        z.writestr('files/overlay.jpg', buf.getvalue())
    print(p, os.path.getsize(p))


if __name__ == '__main__':
    main()
