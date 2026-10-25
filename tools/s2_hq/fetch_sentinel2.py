"""Monapo 郡の範囲の Sentinel-2 衛星画像(自然な色、雲なし合成)を 1 枚にして保存する。

    python fetch_sentinel2.py        (20 m/画素 → sentinel2_monapo.jpg)
    python fetch_sentinel2.py 10     (10 m/画素 → sentinel2_monapo_10m.jpg。衛星版の地図はこちらを優先して使う)

しくみ(field_gps_map の tools/s2_tiles.py と同じデータ。ただし rasterio は使わない):
  1. Earth Search(AWS の公開データ、登録不要)の Sentinel-2 L2A から、乾期(7〜10 月)で雲の少ない画像を
     MGRS タイルごとに最大 MAX_PER_TILE 枚選ぶ。
  2. 各画像の TCI(自然な色、8 ビット RGB の COG)の縮小版(20 m/画素)と SCL(雲・影の判定、20 m)のうち、
     範囲にかかるタイルだけを HTTP の Range 要求で読む(tifffile + imagecodecs)。
  3. SCL で雲・雲の影・欠けを除き(少し広げて)、画素ごとに中央値をとる → 雲も影も無い 1 枚になる。
  4. 緯度経度の格子(0.0002° ≒ 21 m)へ並べ替え(最近傍)、JPEG で保存する。

出力: source_data/sentinel2_monapo.jpg と sentinel2_monapo.json(範囲・使った画像)
ライセンス: Copernicus Sentinel データは無料・商用利用可。地図に
  「Contains modified Copernicus Sentinel data 2026」と表示する。
"""
import io
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import requests
import tifffile
from PIL import Image
from pyproj import Transformer
from pystac_client import Client

HERE = Path(__file__).resolve().parent
OUT = HERE / "source_data"
BBOX = (39.76, -15.27, 40.54, -14.40)          # W S E N(Monapo 郡+少しの余白)
DATES = "2026-07-15/2026-10-22"                # 乾期
MAX_CLOUD = 5
MAX_PER_TILE = 5
# 中央の帯(東経 40.0〜40.4°)は 1 つの軌道しか通らず画像が少ないので、このタイルは全部使う
MAX_PER_TILE_OVERRIDE = {"MGRS-37LFD": 20, "MGRS-37LFE": 20}
RES = 20                                       # m(TCI の縮小版 1 段目 = SCL と同じ 20 m)
STEP = 0.0002                                  # 出力の格子(度)
if len(sys.argv) > 1 and sys.argv[1] == "10":  # TCI の元の解像度(10 m)。雲の判定(SCL)は 20 m のまま 2 倍に広げて使う
    RES, STEP = 10, 0.0001
SUFFIX = "" if RES == 20 else f"_{RES}m"
SCL_RES = 20
SCL_OK = {2, 4, 5, 6, 7}                       # 影っぽい暗部, 植生, 裸地, 水, 判定不能(低確率の雲)
DILATE = 3                                     # 雲・影の周りを何画素広げて除くか
THREADS = 16                                   # 同時に読む Range 要求の数(1 本ずつだと回線の待ち時間で遅い)


class RangeFile(io.RawIOBase):
    """HTTP の Range 要求で、必要な部分だけ読むファイル(1 MB 単位でキャッシュ)。"""
    BLOCK = 1 << 20

    def __init__(self, url):
        self.url, self.pos, self.cache, self.nbytes = url, 0, {}, 0
        self.size = int(requests.head(url, timeout=60).headers["Content-Length"])

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else (self.pos + off if whence == 1 else self.size + off)
        return self.pos

    def prefetch(self, blocks):
        """まだ読んでいない 1 MB の塊を、まとめて並列に読む。"""
        todo = sorted(set(blocks) - set(self.cache))
        with ThreadPoolExecutor(THREADS) as ex:
            list(ex.map(self._block, todo))

    def _block(self, i):
        if i not in self.cache:
            a = i * self.BLOCK
            b = min(a + self.BLOCK, self.size) - 1
            for k in range(6):
                try:
                    r = requests.get(self.url, headers={"Range": f"bytes={a}-{b}"}, timeout=120)
                    r.raise_for_status()
                    self.cache[i] = r.content
                    self.nbytes += len(r.content)
                    break
                except Exception:
                    if k == 5:
                        raise
                    time.sleep(5)
        return self.cache[i]

    def read(self, n=-1):
        if n < 0:
            n = self.size - self.pos
        n = max(0, min(n, self.size - self.pos))
        out = bytearray()
        while n > 0:
            i, o = divmod(self.pos, self.BLOCK)
            chunk = self._block(i)[o:o + n]
            out += chunk
            self.pos += len(chunk)
            n -= len(chunk)
        return bytes(out)

    def readinto(self, b):
        d = self.read(len(b))
        b[:len(d)] = d
        return len(d)


def read_window(url, grid, nch, res=None):
    """COG のうち、20 m の段を探し、モザイクの範囲(grid)にかかるタイルだけ読んで並べる。"""
    ux0, uy1, W, H = grid
    RES = res or globals()["RES"]
    fh = RangeFile(url)
    tf = tifffile.TiffFile(fh)
    tx0, ty0 = tf.pages[0].tags["ModelTiepointTag"].value[3:5]
    res0 = tf.pages[0].tags["ModelPixelScaleTag"].value[0]
    level = int(round(np.log2(RES / res0)))
    page = tf.series[0].levels[level].keyframe
    th, tw = page.tilelength, page.tilewidth
    nty, ntx = -(-page.imagelength // th), -(-page.imagewidth // tw)
    out = np.zeros((H, W, nch), np.uint8)
    need = []
    c0 = max(0, int((ux0 - tx0) / RES) // tw)
    c1 = min(ntx - 1, int((ux0 + W * RES - tx0) / RES) // tw)
    r0 = max(0, int((ty0 - uy1) / RES) // th)
    r1 = min(nty - 1, int((ty0 - (uy1 - H * RES)) / RES) // th)
    for r in range(r0, r1 + 1):
        for c in range(c0, c1 + 1):
            idx = r * ntx + c
            off, cnt = page.dataoffsets[idx], page.databytecounts[idx]
            if cnt:
                need += range(off // fh.BLOCK, (off + cnt - 1) // fh.BLOCK + 1)
    fh.prefetch(need)
    for r in range(r0, r1 + 1):
        for c in range(c0, c1 + 1):
            idx = r * ntx + c
            off, cnt = page.dataoffsets[idx], page.databytecounts[idx]
            if cnt == 0:
                continue
            fh.seek(off)
            tile = np.asarray(page.decode(fh.read(cnt), idx)[0]).reshape(th, tw, -1)[:, :, :nch]
            mx = int(round((tx0 + c * tw * RES - ux0) / RES))
            my = int(round((uy1 - (ty0 - r * th * RES)) / RES))
            sx0, sy0, dx0, dy0 = max(0, -mx), max(0, -my), max(0, mx), max(0, my)
            w, h = min(tw - sx0, W - dx0), min(th - sy0, H - dy0)
            if w > 0 and h > 0:
                out[dy0:dy0 + h, dx0:dx0 + w] = tile[sy0:sy0 + h, sx0:sx0 + w]
    return out, fh.nbytes


def dilate(mask, n):
    m = mask.copy()
    for _ in range(n):
        m[1:] |= m[:-1]
        m[:-1] |= m[1:]
        m[:, 1:] |= m[:, :-1]
        m[:, :-1] |= m[:, 1:]
    return m


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def main():
    to_utm = Transformer.from_crs(4326, 32737, always_xy=True)
    xs, ys = to_utm.transform([BBOX[0], BBOX[2], BBOX[0], BBOX[2]], [BBOX[1], BBOX[1], BBOX[3], BBOX[3]])
    ux0, ux1, uy0, uy1 = min(xs) - 500, max(xs) + 500, min(ys) - 500, max(ys) + 500
    W, H = int((ux1 - ux0) / RES) + 1, int((uy1 - uy0) / RES) + 1
    grid = (ux0, uy1, W, H)
    mosaic = np.zeros((H, W, 3), np.uint8)
    log("mosaic", W, H, "px at", RES, "m")

    cat = Client.open("https://earth-search.aws.element84.com/v1")
    items = [it for it in cat.search(collections=["sentinel-2-c1-l2a"], bbox=BBOX, datetime=DATES,
                                     query={"eo:cloud_cover": {"lt": MAX_CLOUD}}, max_items=500).items()
             if it.properties.get("proj:code", it.properties.get("proj:epsg")) in ("EPSG:32737", 32737)]
    by = {}
    for it in items:
        by.setdefault(it.properties["grid:code"], []).append(it)
    used = []
    # 途中で止まっても、終わった MGRS タイルからやり直せるように、タイルごとに途中経過を保存する
    part_path = OUT / f"_partial{SUFFIX}.npz"
    done = set()
    if part_path.exists():
        with np.load(part_path, allow_pickle=True) as z:          # with で閉じる(開いたままだと最後に消せない)
            if z["mosaic"].shape == mosaic.shape:
                mosaic[:] = z["mosaic"]
                done, used = set(z["done"].tolist()), list(z["used"].tolist())
                log("resume; done", sorted(done))
    for code, lst in sorted(by.items()):
        if code in done:
            continue
        lst.sort(key=lambda it: (it.properties["eo:cloud_cover"], -it.datetime.timestamp()))
        stack = []
        for it in lst[:MAX_PER_TILE_OVERRIDE.get(code, MAX_PER_TILE)]:
            tci, nb1 = read_window(it.assets["visual"].href, grid, 3)
            if RES == SCL_RES:
                scl, nb2 = read_window(it.assets["scl"].href, grid, 1)
            else:                                     # 20 m の SCL を 10 m の格子へ(各画素を 2×2 に)
                g20 = (ux0, uy1, -(-W // 2), -(-H // 2))
                scl, nb2 = read_window(it.assets["scl"].href, g20, 1, res=SCL_RES)
                scl = scl.repeat(2, axis=0).repeat(2, axis=1)[:H, :W]
            bad = ~np.isin(scl[..., 0], list(SCL_OK))
            bad = dilate(bad & (scl[..., 0] > 0), DILATE * SCL_RES // RES) | (scl[..., 0] == 0) | (tci.sum(axis=2) == 0)
            tci[bad] = 0
            stack.append(tci)
            used.append({"date": it.datetime.date().isoformat(), "tile": code,
                         "cloud": round(it.properties["eo:cloud_cover"], 2)})
            log(code, it.datetime.date(), f"cloud {it.properties['eo:cloud_cover']:.2f}%",
                f"usable {(~bad).mean() * 100:.0f}%", f"{(nb1 + nb2) / 1e6:.1f} MB")
        # 画素ごとの中央値(使える画素だけ)。まだ埋まっていない画素だけを、並べ替えで求める(nanmedian は遅い)
        for y in range(0, H, 400):
            part = mosaic[y:y + 400]
            valid = np.stack([a[y:y + 400].sum(axis=2) > 0 for a in stack])            # (n, h, w)
            cand = valid.any(axis=0) & (part.sum(axis=2) == 0)
            if not cand.any():
                continue
            v = np.stack([a[y:y + 400][cand] for a in stack]).astype(np.float32)       # (n, m, 3)
            ok = valid[:, cand]                                                          # (n, m)
            v[~ok] = np.inf
            v.sort(axis=0)
            k = ok.sum(axis=0)
            m = np.arange(v.shape[1])
            med = (v[(k - 1) // 2, m] + v[k // 2, m]) / 2                                # 偶数個なら真ん中 2 つの平均
            part[cand] = np.round(med).astype(np.uint8)
        del stack
        log(code, "done; empty", f"{(mosaic.sum(axis=2) == 0).mean() * 100:.2f}%")
        done.add(code)
        np.savez(part_path, mosaic=mosaic, done=np.array(sorted(done)), used=np.array(used, dtype=object))

    # 緯度経度の格子へ(最近傍)
    lons = np.arange(BBOX[0], BBOX[2], STEP)
    lats = np.arange(BBOX[3], BBOX[1], -STEP)
    out = np.zeros((len(lats), len(lons), 3), np.uint8)
    for i0 in range(0, len(lats), 500):
        LON, LAT = np.meshgrid(lons, lats[i0:i0 + 500])
        X, Y = to_utm.transform(LON, LAT)
        col = np.clip(((X - ux0) / RES).astype(int), 0, W - 1)
        row = np.clip(((uy1 - Y) / RES).astype(int), 0, H - 1)
        out[i0:i0 + 500] = mosaic[row, col]
    OUT.mkdir(exist_ok=True)
    Image.fromarray(out).save(OUT / f"sentinel2_monapo{SUFFIX}.jpg", quality=92)
    meta = {"bbox_wsen": BBOX, "step_deg": STEP, "resolution_m": RES, "method": "median of cloud-free pixels (SCL)",
            "scenes": used, "source": "Sentinel-2 L2A TCI + SCL via Earth Search (AWS)",
            "attribution": "Contains modified Copernicus Sentinel data 2026"}
    json.dump(meta, open(OUT / f"sentinel2_monapo{SUFFIX}.json", "w"), indent=1)
    if part_path.exists():                                    # 次に取り直すときに混ざらないよう名前を変える
        part_path.replace(OUT / f"_partial{SUFFIX}_used.npz")
    log("saved", out.shape)


if __name__ == "__main__":
    main()
