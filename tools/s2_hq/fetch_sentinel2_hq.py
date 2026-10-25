"""最高画質の衛星画像:Sentinel-2 L2A の 10 m バンド(赤 B04・緑 B03・青 B02)を 16 ビットのまま雲なし合成する。
範囲を指定できる版(元は Community_nursery/04_monapo_gps/fetch_sentinel2_hq.py。Monapo 郡で使ったものと同じやり方)。

    python fetch_sentinel2_hq.py list                 範囲にかかる MGRS タイルと、使うシーンを表示する
    python fetch_sentinel2_hq.py fetch MGRS-37LCD     1 つの MGRS タイルを取得して中央値を出す(タイルごとに別々に同時に動かせる)
    python fetch_sentinel2_hq.py compose              タイルをつなぎ、緯度経度の格子に並べ替えて保存する

範囲・置き場所は環境変数で指定する(OneDrive の外に置くこと。大きい):
    S2_REGION   名前(出力ファイル名に使う)                  例: malema
    S2_BBOX     W,S,E,N(度。UTM 37S = EPSG:32737 の中)      例: 36.91022,-15.84831,38.76978,-14.05169
    S2_WORK     作業フォルダ(この下の cache\ に途中の画像)   例: C:\\Users\\kazdr\\AppData\\Local\\Temp\\malema_s2_hq
    S2_DATES    期間(省略すると fetch_sentinel2.py の DATES = 乾期 2026-07-15/2026-10-22)

Monapo 版と同じところ:期間・雲量の上限(MAX_CLOUD)・タイルごとの枚数(MAX_PER_TILE)・SCL での雲と影の除き方
  (SCL_OK、DILATE)・タイルごとの画素ごとの中央値。
Monapo 版と違うところ:
  - タイルのつなぎ方:Monapo 版は重なりで先のタイルを優先していたが、広い範囲(9 タイル)では
    タイルごとに使った日付が違うため明るさ・色の差が四角い境目として見えた。そこで重なりの分位点から
    タイルごと・バンドごとに a*x+b の補正を求めてそろえ(balance)、重なりは端からの距離で混ぜる。
  - シーンの選び方:1 つの MGRS タイルに、軌道の違う(写っている範囲の違う)シーンが混ざっていることがある
    (タイルの端だけ写った細い帯のシーンなど)。雲の少ない順に選ぶと帯のシーンばかりになり、タイルの大部分が
    空になる。そこで、写っている範囲(bbox)の同じシーンを 1 組とし、組ごとに雲の少ない順に MAX_PER_TILE 枚選ぶ
    (Monapo では MAX_PER_TILE_OVERRIDE で同じ問題に対処していた)。
  - 途中の画像の名前は日付ではなくシーンの ID(同じ日に 2 つの軌道で撮られたシーンがあるため)。
  - 読む範囲は「全体の範囲 ∩ そのタイルの写っている範囲」だけ(広い範囲でもメモリが足りるように)。
  - compose は全体のモザイクも出力も np.lib.format.open_memmap(ディスク上)で作り、少しずつ処理する。
    出力は無圧縮の .npy(uint16、H×W×3、0 行目 = 北、0 列目 = 西、緯度経度の格子 0.0001°)と .json。
    tools/hq_tiles.py が memmap で読む。

出力: <S2_WORK>/sentinel2_<S2_REGION>_10m_16bit.npy と .json
"""
import json
import os
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
from pyproj import Transformer
from pystac_client import Client

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch_sentinel2 as F  # noqa: E402  RangeFile・dilate・DATES・MAX_CLOUD・MAX_PER_TILE・SCL_OK・DILATE を使う

REGION = os.environ.get("S2_REGION", "malema")
if os.environ.get("S2_BBOX"):
    F.BBOX = tuple(float(v) for v in os.environ["S2_BBOX"].split(","))
if os.environ.get("S2_DATES"):
    F.DATES = os.environ["S2_DATES"]
WORK = Path(os.environ.get("S2_WORK", Path(tempfile.gettempdir()) / f"{REGION}_s2_hq"))
CACHE = WORK / "cache"
RES, STEP = 10, 0.0001
BANDS = ("red", "green", "blue")
F.RES = RES
ROWS = 400               # 中央値・つなぎ合わせを何行ずつ処理するか


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def grid():
    to_utm = Transformer.from_crs(4326, 32737, always_xy=True)
    b = F.BBOX
    xs, ys = to_utm.transform([b[0], b[2], b[0], b[2]], [b[1], b[1], b[3], b[3]])
    ux0, ux1, uy0, uy1 = min(xs) - 500, max(xs) + 500, min(ys) - 500, max(ys) + 500
    W, H = int((ux1 - ux0) / RES) + 1, int((uy1 - uy0) / RES) + 1
    return to_utm, ux0, uy1, W, H


def read_band(url, g, res):
    """read_window と同じだが 16 ビットのまま(1 バンド)。"""
    import tifffile
    ux0, uy1, W, H = g
    fh = F.RangeFile(url)
    tf = tifffile.TiffFile(fh)
    tx0, ty0 = tf.pages[0].tags["ModelTiepointTag"].value[3:5]
    res0 = tf.pages[0].tags["ModelPixelScaleTag"].value[0]
    page = tf.series[0].levels[int(round(np.log2(res / res0)))].keyframe
    th, tw = page.tilelength, page.tilewidth
    nty, ntx = -(-page.imagelength // th), -(-page.imagewidth // tw)
    out = np.zeros((H, W), page.dtype)
    c0 = max(0, int((ux0 - tx0) / res) // tw)
    c1 = min(ntx - 1, int((ux0 + W * res - tx0) / res) // tw)
    r0 = max(0, int((ty0 - uy1) / res) // th)
    r1 = min(nty - 1, int((ty0 - (uy1 - H * res)) / res) // th)
    idxs = [r * ntx + c for r in range(r0, r1 + 1) for c in range(c0, c1 + 1)]
    need = []
    for idx in idxs:
        off, cnt = page.dataoffsets[idx], page.databytecounts[idx]
        if cnt:
            need += range(off // fh.BLOCK, (off + cnt - 1) // fh.BLOCK + 1)
    fh.prefetch(need)
    for idx in idxs:
        off, cnt = page.dataoffsets[idx], page.databytecounts[idx]
        if cnt == 0:
            continue
        r, c = divmod(idx, ntx)
        fh.seek(off)
        tile = np.asarray(page.decode(fh.read(cnt), idx)[0]).reshape(th, tw, -1)[:, :, 0]
        mx = int(round((tx0 + c * tw * res - ux0) / res))
        my = int(round((uy1 - (ty0 - r * th * res)) / res))
        sx0, sy0, dx0, dy0 = max(0, -mx), max(0, -my), max(0, mx), max(0, my)
        w, h = min(tw - sx0, W - dx0), min(th - sy0, H - dy0)
        if w > 0 and h > 0:
            out[dy0:dy0 + h, dx0:dx0 + w] = tile[sy0:sy0 + h, sx0:sx0 + w]
    return out, fh.nbytes


def footprint_groups(lst):
    """写っている範囲(bbox)がほぼ同じシーンを 1 組にする(同じ軌道 = 同じ範囲)。"""
    groups = []
    for it in lst:
        for g in groups:
            if max(abs(a - b) for a, b in zip(g[0].bbox, it.bbox)) < 0.05:
                g.append(it)
                break
        else:
            groups.append([it])
    return groups


def search():
    cat = Client.open("https://earth-search.aws.element84.com/v1")
    items = [it for it in cat.search(collections=["sentinel-2-c1-l2a"], bbox=F.BBOX, datetime=F.DATES,
                                     query={"eo:cloud_cover": {"lt": F.MAX_CLOUD}}, max_items=500).items()
             if it.properties.get("proj:code", it.properties.get("proj:epsg")) in ("EPSG:32737", 32737)]
    by = {}
    for it in items:
        by.setdefault(it.properties["grid:code"], []).append(it)
    for code, lst in by.items():
        lst.sort(key=lambda it: (it.properties["eo:cloud_cover"], -it.datetime.timestamp()))
        pick = []
        for g in footprint_groups(lst):
            pick += g[:F.MAX_PER_TILE_OVERRIDE.get(code, F.MAX_PER_TILE)]
        lst[:] = sorted(pick, key=lambda it: (it.properties["eo:cloud_cover"], -it.datetime.timestamp()))
    return by


def window(lst, ux0, uy1, W, H, to_utm):
    """全体の格子のうち、このタイルのシーンが写っている範囲(行・列。少し余白つき)。"""
    xs, ys = [], []
    for it in lst:
        w, s, e, n = it.bbox
        lo = np.linspace(w, e, 9)
        la = np.linspace(s, n, 9)
        LO, LA = np.meshgrid(lo, la)
        X, Y = to_utm.transform(LO.ravel(), LA.ravel())
        xs += [X.min(), X.max()]
        ys += [Y.min(), Y.max()]
    cx0 = max(0, int((min(xs) - 300 - ux0) / RES))
    cx1 = min(W, int((max(xs) + 300 - ux0) / RES) + 1)
    cy0 = max(0, int((uy1 - max(ys) - 300) / RES))
    cy1 = min(H, int((uy1 - min(ys) + 300) / RES) + 1)
    return cy0, cy1, cx0, cx1


def fetch(code):
    """1 タイル分:シーンごとに雲を除いた 3 バンドを一時フォルダへ保存 → 中央値をとってタイルの合成を保存。"""
    to_utm, ux0, uy1, W, H = grid()
    lst = search()[code]
    cy0, cy1, cx0, cx1 = window(lst, ux0, uy1, W, H, to_utm)
    # このタイルの部分だけの格子(全体の格子と画素の位置はそろったまま)
    sw, sh = cx1 - cx0, cy1 - cy0
    g = (ux0 + cx0 * RES, uy1 - cy0 * RES, sw, sh)
    log(code, len(lst), "scenes; window", sw, "x", sh, "px")
    d = CACHE / code
    d.mkdir(parents=True, exist_ok=True)
    scenes = []
    for it in lst:
        name = it.id
        f = d / f"{name}.npy"
        meta = d / f"{name}.json"
        if not meta.exists():
            nb = 0
            bands = []
            for b in BANDS:
                a, n = read_band(it.assets[b].href, g, RES)
                bands.append(a)
                nb += n
            g20 = (g[0], g[1], -(-sw // 2), -(-sh // 2))
            scl, n = read_band(it.assets["scl"].href, g20, 20)
            nb += n
            scl = scl.repeat(2, axis=0).repeat(2, axis=1)[:sh, :sw]
            bad = ~np.isin(scl, list(F.SCL_OK))
            bad = F.dilate(bad & (scl > 0), F.DILATE * 2) | (scl == 0) | (bands[0] == 0)
            del scl
            ok = ~bad
            rows, cols = np.nonzero(ok.any(axis=1))[0], np.nonzero(ok.any(axis=0))[0]
            if len(rows):
                y0, y1, x0, x1 = int(rows[0]), int(rows[-1]) + 1, int(cols[0]), int(cols[-1]) + 1
                crop = np.stack([b[y0:y1, x0:x1] for b in bands], axis=2)
                crop[~ok[y0:y1, x0:x1]] = 0
                np.save(f, crop)
                del crop
                # 全体の格子での位置で記録する
                y0, y1, x0, x1 = y0 + cy0, y1 + cy0, x0 + cx0, x1 + cx0
            else:
                y0 = y1 = x0 = x1 = 0
            del bands, bad, ok
            json.dump({"date": it.datetime.date().isoformat(), "tile": code, "cloud": round(it.properties["eo:cloud_cover"], 2),
                       "id": it.id, "box": [y0, y1, x0, x1]}, open(meta, "w"))
            log(code, it.id, f"usable box {y1 - y0}x{x1 - x0}", f"{nb / 1e6:.0f} MB")
        m = json.load(open(meta))
        if m["box"][1] > m["box"][0]:
            scenes.append((m, f))
    # 中央値(使える画素だけ)。全シーンを合わせた範囲で、ROWS 行ずつ
    y0 = min(m["box"][0] for m, _ in scenes)
    y1 = max(m["box"][1] for m, _ in scenes)
    x0 = min(m["box"][2] for m, _ in scenes)
    x1 = max(m["box"][3] for m, _ in scenes)
    arrs = [(m, np.load(f, mmap_mode="r")) for m, f in scenes]
    comp = np.zeros((y1 - y0, x1 - x0, 3), np.uint16)
    for ys in range(y0, y1, ROWS):
        ye = min(ys + ROWS, y1)
        stack = np.zeros((len(arrs), ye - ys, x1 - x0, 3), np.uint16)
        for k, (m, a) in enumerate(arrs):
            by0, by1, bx0, bx1 = m["box"]
            a0, a1 = max(ys, by0), min(ye, by1)
            if a1 > a0:
                stack[k, a0 - ys:a1 - ys, bx0 - x0:bx1 - x0] = a[a0 - by0:a1 - by0]
        valid = stack[..., 0] > 0
        cand = valid.any(axis=0)
        if not cand.any():
            continue
        v = stack[:, cand].astype(np.float32)
        del stack
        ok = valid[:, cand]
        v[~ok] = np.inf
        v.sort(axis=0)
        k = ok.sum(axis=0)
        mi = np.arange(v.shape[1])
        med = (v[(k - 1) // 2, mi] + v[k // 2, mi]) / 2
        comp[ys - y0:ye - y0][cand] = np.round(med).astype(np.uint16)
    del arrs
    np.save(CACHE / f"{code}_composite.npy", comp)
    json.dump({"box": [y0, y1, x0, x1], "scenes": [m for m, _ in scenes]}, open(CACHE / f"{code}_composite.json", "w"))
    log(code, "composite saved", comp.shape)


def balance(comps):
    """タイルごとの合成は使った日付が違うので、明るさ・色が少しずつ違い、境目が見える(広い範囲だと目立つ)。
    重なり(約 10 km)で両方のタイルの明るさの分布(分位点)を比べ、タイルごと・バンドごとに a*x+b の補正を
    最小二乗で求める(全タイルの a の平均 = 1、b の平均 = 0 に固定)。"""
    n = len(comps)
    qs = np.arange(5, 96, 5)
    eqs = [[] for _ in range(3)]
    for i in range(n):
        for j in range(i + 1, n):
            (mi, ci), (mj, cj) = comps[i], comps[j]
            y0, y1 = max(mi["box"][0], mj["box"][0]), min(mi["box"][1], mj["box"][1])
            x0, x1 = max(mi["box"][2], mj["box"][2]), min(mi["box"][3], mj["box"][3])
            if y1 - y0 < 50 or x1 - x0 < 50:
                continue
            a = np.asarray(ci[y0 - mi["box"][0]:y1 - mi["box"][0]:3, x0 - mi["box"][2]:x1 - mi["box"][2]:3]).astype(np.float32)
            b = np.asarray(cj[y0 - mj["box"][0]:y1 - mj["box"][0]:3, x0 - mj["box"][2]:x1 - mj["box"][2]:3]).astype(np.float32)
            ok = (a[..., 0] > 0) & (b[..., 0] > 0)
            if ok.sum() < 10000:
                continue
            w = np.sqrt(ok.sum())
            for k in range(3):
                pa, pb = np.percentile(a[..., k][ok], qs), np.percentile(b[..., k][ok], qs)
                for va, vb in zip(pa, pb):
                    row = np.zeros(2 * n)
                    row[i], row[n + i], row[j], row[n + j] = va * w, w, -vb * w, -w
                    eqs[k].append(row)
            log("overlap", mi["tile"], mj["tile"], int(ok.sum()), "px")
    gains = np.ones((n, 3)), np.zeros((n, 3))
    for k in range(3):
        A = np.array(eqs[k])
        big = A.__abs__().max() * 10
        c1 = np.zeros(2 * n); c1[:n] = big / n           # 平均の a = 1
        c2 = np.zeros(2 * n); c2[n:] = big / n           # 平均の b = 0
        A = np.vstack([A, c1, c2])
        rhs = np.zeros(len(A)); rhs[-2] = big
        sol = np.linalg.lstsq(A, rhs, rcond=None)[0]
        gains[0][:, k], gains[1][:, k] = sol[:n], sol[n:]
    return gains


def compose():
    to_utm, ux0, uy1, W, H = grid()
    # 全体のモザイク(UTM、10 m)。大きいのでディスク上に作る
    mosaic = np.lib.format.open_memmap(CACHE / "_mosaic_utm.npy", mode="w+", dtype=np.uint16, shape=(H, W, 3))
    used, comps = [], []
    for code in sorted(search()):
        m = json.load(open(CACHE / f"{code}_composite.json"))
        m["tile"] = code
        comps.append((m, np.load(CACHE / f"{code}_composite.npy", mmap_mode="r")))
        used += m["scenes"]
    ga, gb = balance(comps)
    for (m, _), a, b in zip(comps, ga, gb):
        log(m["tile"], "gain", np.round(a, 3).tolist(), "offset", np.round(b, 1).tolist())
    # 重なりでは、タイルの端からの距離に比例した重みで混ぜる(急な境目を作らない)
    for ys in range(0, H, 1000):
        ye = min(ys + 1000, H)
        acc = np.zeros((ye - ys, W, 3), np.float32)
        wsum = np.zeros((ye - ys, W), np.float32)
        for (m, c), a, b in zip(comps, ga, gb):
            y0, y1, x0, x1 = m["box"]
            r0, r1 = max(ys, y0), min(ye, y1)
            if r1 <= r0:
                continue
            cc = np.asarray(c[r0 - y0:r1 - y0]).astype(np.float32)
            ok = cc[..., 0] > 0
            ry = np.arange(r0, r1)[:, None]
            rx = np.arange(x0, x1)[None, :]
            wt = (np.minimum(np.minimum(ry - y0, y1 - 1 - ry), np.minimum(rx - x0, x1 - 1 - rx)) + 1).astype(np.float32)
            wt *= ok
            acc[r0 - ys:r1 - ys, x0:x1] += (cc * a + b) * wt[..., None]
            wsum[r0 - ys:r1 - ys, x0:x1] += wt
        has = wsum > 0
        blk = np.zeros((ye - ys, W, 3), np.uint16)
        blk[has] = np.clip(np.round(acc[has] / wsum[has][:, None]), 1, 65535).astype(np.uint16)
        mosaic[ys:ye] = blk
        del acc, wsum
    log("mosaic done")
    mosaic.flush()
    b = F.BBOX
    lons = np.arange(b[0], b[2], STEP)
    lats = np.arange(b[3], b[1], -STEP)
    npy = WORK / f"sentinel2_{REGION}_10m_16bit.npy"
    out = np.lib.format.open_memmap(npy, mode="w+", dtype=np.uint16, shape=(len(lats), len(lons), 3))
    empty = 0
    for i0 in range(0, len(lats), 500):
        LON, LAT = np.meshgrid(lons, lats[i0:i0 + 500])
        X, Y = to_utm.transform(LON, LAT)
        col = np.clip(((X - ux0) / RES).astype(int), 0, W - 1)
        row = np.clip(((uy1 - Y) / RES).astype(int), 0, H - 1)
        rmin, rmax = int(row.min()), int(row.max())
        blk = np.asarray(mosaic[rmin:rmax + 1])                  # 必要な行だけ読む
        o = blk[row - rmin, col]
        out[i0:i0 + 500] = o
        empty += int((o[..., 0] == 0).sum())
    out.flush()
    del out, mosaic
    json.dump({"bbox_wsen": b, "step_deg": STEP, "resolution_m": RES, "bits": 16,
               "method": "median of cloud-free pixels (SCL), L2A B04/B03/B02",
               "scenes": [{k: s[k] for k in ("date", "tile", "cloud")} for s in used],
               "source": "Sentinel-2 L2A via Earth Search (AWS)",
               "attribution": "Contains modified Copernicus Sentinel data 2026"},
              open(WORK / f"sentinel2_{REGION}_10m_16bit.json", "w"), indent=1)
    log("saved", npy, (len(lats), len(lons), 3), f"empty {empty / (len(lats) * len(lons)) * 100:.2f}%")


def show():
    for code, lst in sorted(search().items()):
        print(code, len(lst), [(it.datetime.date().isoformat(), round(it.properties["eo:cloud_cover"], 2),
                                 round(it.properties.get("s2:nodata_pixel_percentage", -1))) for it in lst])


if __name__ == "__main__":
    CACHE.mkdir(parents=True, exist_ok=True)
    if sys.argv[1] == "fetch":
        fetch(sys.argv[2])
    elif sys.argv[1] == "list":
        show()
    else:
        compose()
