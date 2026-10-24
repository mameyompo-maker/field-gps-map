"""field_gps_map — 地図データの目録(field_gps_imagery/docs/catalog.json)を作る。

    python tools/make_catalog.py <field_gps_imagery/docs>

アプリは起動するとこの目録を読み、載っている範囲の衛星写真(束)・道と川(osm.json)・行政境界(admin.json)を
すべて端末に入れる。範囲を足す・作り直すときは、ファイルを置いてからこれを実行して push するだけ(アプリの変更は不要)。

REGIONS の tiles は衛星写真のフォルダ(index.json と packs/ がある所)。
Malema – Ribáue は、高画質版(malema/)ができるまでは前の画像(s2/)を使う。
"""
import hashlib
import json
import sys
from pathlib import Path

REGIONS = [
    {'id': 'monapo', 'name': 'Monapo', 'tiles': 'monapo/', 'osm': 'monapo/osm.json', 'admin': 'monapo/admin.json'},
    {'id': 'malema', 'name': 'Malema – Ribáue', 'tiles': 'malema/', 'fallback_tiles': 's2/',
     'osm': 'malema/osm.json', 'admin': 'malema/admin.json'},
]


def ref(root, rel):
    p = root / rel
    b = p.read_bytes()
    return {'url': f'{rel}?v={hashlib.sha1(b).hexdigest()[:8]}', 'bytes': len(b)}


def main():
    root = Path(sys.argv[1])
    out = []
    for r in REGIONS:
        tiles = r['tiles']
        if not (root / tiles / 'index.json').exists():
            tiles = r['fallback_tiles']
        idx = json.load(open(root / tiles / 'index.json', encoding='utf-8'))
        out.append({
            'id': r['id'], 'name': r['name'], 'tiles': tiles,
            'bbox': idx['bbox'], 'minzoom': idx['minzoom'], 'maxzoom': idx['maxzoom'],
            'dates': idx.get('dates', []), 'attribution': idx.get('attribution', ''),
            'packs': idx['packs'],
            'osm': ref(root, r['osm']), 'admin': ref(root, r['admin']),
        })
        print(r['id'], tiles, len(idx['packs']), 'packs', round(sum(p['bytes'] for p in idx['packs']) / 1e6, 1), 'MB')
    total = sum(sum(p['bytes'] for p in r['packs']) + r['osm']['bytes'] + r['admin']['bytes'] for r in out)
    cat = {'version': 2, 'regions': out, 'bytes': total}
    json.dump(cat, open(root / 'catalog.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('catalog.json', round(total / 1e6, 1), 'MB')


if __name__ == '__main__':
    main()
