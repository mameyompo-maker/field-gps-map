"""field_gps_map — 範囲ごとの道・川・池・集落名(OpenStreetMap)を、アプリがそのまま使う形で1ファイルにする。

    python tools/osm_region.py <出力 osm.json> <W> <S> <E> <N>
    例) python tools/osm_region.py ../field_gps_imagery/docs/monapo/osm.json 39.76 -15.27 40.54 -14.40

アプリの「広い範囲を保存」(docs/lib/offline-map.js の query(wide) と compact)と同じ問い合わせ・同じ形。
これを衛星写真と一緒に配ると、使う人は何も押さなくても、範囲全体の道・川・集落名が端末に入る。
建物は入れない(範囲全体だと数十万件で重すぎる。必要な所は「この辺りを保存」で建物まで入る)。
出典:© OpenStreetMap contributors(ODbL)。
"""
import json
import sys
import time
import urllib.parse
import urllib.request

ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass-api.de/api/interpreter',
]
ROAD_CLASS = {
    'motorway': 1, 'trunk': 1, 'primary': 1, 'secondary': 2, 'tertiary': 2,
    'unclassified': 3, 'residential': 3, 'living_street': 3, 'service': 3, 'road': 3,
    'track': 4, 'path': 5, 'footway': 5, 'bridleway': 5,
}


def query(s, w, n, e):
    bb = f'{s:.5f},{w:.5f},{n:.5f},{e:.5f}'
    return f'''[out:json][timeout:300];(
way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|road|track)$"]({bb});
way["waterway"~"^(river|stream|canal)$"]({bb});
way["natural"="water"]({bb});
node["place"~"^(city|town|village|hamlet|suburb|locality)$"]({bb});
);out geom qt;'''


def compact(js):
    r5 = lambda x: round(x * 1e5) / 1e5
    out = {'roads': [], 'rivers': [], 'water': [], 'buildings': [], 'places': []}
    for el in js.get('elements', []):
        tg = el.get('tags', {})
        if el['type'] == 'node' and tg.get('place') and tg.get('name'):
            out['places'].append({'n': tg['name'], 't': tg['place'], 'lat': r5(el['lat']), 'lng': r5(el['lon'])})
            continue
        g = el.get('geometry')
        if el['type'] != 'way' or not g or len(g) < 2:
            continue
        c = []
        for p in g:
            c += [r5(p['lat']), r5(p['lon'])]
        lats, lons = [p['lat'] for p in g], [p['lon'] for p in g]
        item = {'c': c, 'b': [r5(min(lats)), r5(min(lons)), r5(max(lats)), r5(max(lons))]}
        if tg.get('natural') == 'water':
            out['water'].append(item)
        elif tg.get('waterway'):
            item['k'] = 1 if tg['waterway'] in ('river', 'canal') else 2
            out['rivers'].append(item)
        elif tg.get('highway'):
            item['k'] = ROAD_CLASS.get(tg['highway'], 3)
            if tg.get('name'):
                item['n'] = tg['name']
            out['roads'].append(item)
    out['roads'].sort(key=lambda it: -it['k'])
    return out


def main():
    path = sys.argv[1]
    w, s, e, n = map(float, sys.argv[2:6])
    body = urllib.parse.urlencode({'data': query(s, w, n, e)}).encode()
    js = None
    for url in ENDPOINTS:
        try:
            req = urllib.request.Request(url, data=body, headers={'User-Agent': 'field-gps-map/2 (offline basemap build)'})
            with urllib.request.urlopen(req, timeout=400) as r:
                js = json.load(r)
            break
        except Exception as err:          # 混んでいると 502 や無応答。次の窓口へ
            print('retry', url, err, flush=True)
            time.sleep(10)
    if js is None:
        sys.exit('Overpass failed')
    d = compact(js)
    d['bbox'] = [s, w, n, e]
    d['generated'] = time.strftime('%Y-%m-%d')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, separators=(',', ':'))
    print(path, {k: len(v) for k, v in d.items() if isinstance(v, list)})


if __name__ == '__main__':
    main()
