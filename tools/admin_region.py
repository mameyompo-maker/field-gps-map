"""field_gps_map — 範囲にかかる行政境界(郡・行政ポスト・localidade)と名前を、アプリ用の軽い形にする。

    python tools/admin_region.py <出力 admin.json> <admin4.geojson> <W> <S> <E> <N>

元データ:OCHA/INE の COD-AB(HDX、v02、2025-01-01 有効)。Monapo の印刷用地図と同じもの。
  Community_nursery/monapo_gps/moz_admin4.geojson(adm2_name・adm3_name・adm4_name を持つ)。
出力:{"lines": [{"l": 2|3|4, "c": [lat, lng, ...]}], "labels": [{"n": 名前, "l": 段, "lat", "lng"}]}
  l = 2 郡・3 行政ポスト・4 localidade。境界は約 30 m に簡略化(画面で見分けがつかない程度)。
  同じ境界線を二重に描かないよう、localidade の境界を段の高いもの(郡 > ポスト > localidade)から順に引く。
"""
import json
import sys

from shapely.geometry import shape, box, mapping
from shapely.ops import unary_union

TOL = 0.0003      # 約 30 m


def lines_of(geom):
    g = geom.boundary
    parts = getattr(g, 'geoms', [g])
    for p in parts:
        if p.length > 0:
            yield p


def main():
    out, src = sys.argv[1], sys.argv[2]
    w, s, e, n = map(float, sys.argv[3:7])
    clip = box(w, s, e, n)
    feats = [f for f in json.load(open(src, encoding='utf-8'))['features']]
    rows = []
    for f in feats:
        g = shape(f['geometry'])
        if not g.intersects(clip):
            continue
        p = f['properties']
        rows.append((p['adm2_name'], p['adm3_name'], p['adm4_name'], g.buffer(0)))
    groups = {
        2: {}, 3: {}, 4: {},
    }
    for a2, a3, a4, g in rows:
        groups[2].setdefault(a2, []).append(g)
        groups[3].setdefault((a2, a3), []).append(g)
        groups[4][(a2, a3, a4)] = [g]
    polys = {lv: {k: unary_union(v) for k, v in d.items()} for lv, d in groups.items()}

    drawn = None
    lines, labels = [], []
    for lv in (2, 3, 4):
        bnd = unary_union([b for g in polys[lv].values() for b in lines_of(g)])
        if drawn is not None:
            bnd = bnd.difference(drawn.buffer(1e-6))
        drawn = bnd if drawn is None else unary_union([drawn, bnd])
        bnd = bnd.intersection(clip).simplify(TOL)
        for part in getattr(bnd, 'geoms', [bnd]):
            if part.is_empty or part.geom_type != 'LineString':
                continue
            c = []
            for x, y in part.coords:
                c += [round(y, 5), round(x, 5)]
            lines.append({'l': lv, 'c': c})
        for k, g in polys[lv].items():
            pt = g.representative_point()
            if not clip.contains(pt):
                continue
            name = k if isinstance(k, str) else k[-1]
            labels.append({'n': name, 'l': lv, 'lat': round(pt.y, 5), 'lng': round(pt.x, 5)})
    json.dump({'lines': lines, 'labels': labels, 'bbox': [s, w, n, e],
               'source': 'OCHA/INE COD-AB (HDX), v02 2025-01-01'},
              open(out, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(out, len(lines), 'lines', len(labels), 'labels', sorted({(l['l']) for l in labels}))


if __name__ == '__main__':
    main()
