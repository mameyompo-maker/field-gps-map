"""field_gps_map — 試用モードでの通し動作テスト(Playwright + システムの Microsoft Edge)。

    set PYTHONIOENCODING=utf-8
    python tests/e2e_demo.py            # localhost:8765 で配信して試す
    python tests/e2e_demo.py --shots    # 画面写真も tests/shots/ に保存

本番(GitHub Pages)と同じ URL の形で配信する:
    /field-gps-map/      = docs/
    /field-gps-imagery/  = 隣のリポジトリ field_gps_imagery/docs/(地図データ。目録 catalog.json と束)
地図データは作り直し中のことがあるので、始めに目録・束・道と川・境界の JSON を一時フォルダへ写してから配る
(途中で書き換わっても試験が揺れないように)。1 枚ずつのタイルは、写した束の中から切り出して返す。

GPS は Playwright の set_geolocation で動かす(角まで歩いてボタンを押す、を再現する)。
写真は tests/fixtures/ の jpg を使う。
本番の Firestore には一切つながない(試用モードは localStorage と IndexedDB だけ)。
"""
import http.server
import json
import math
import os
import shutil
import struct
import sys
import tempfile
import threading
import time
import urllib.parse
import xml.dom.minidom
import zipfile

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, 'docs')
SHOTS = os.path.join(ROOT, 'tests', 'shots')
PORT = 8765
URL = f'http://localhost:{PORT}/field-gps-map/'
SAVE_SHOTS = '--shots' in sys.argv
PHOTO1 = os.path.join(ROOT, 'tests', 'fixtures', 'field_photo.jpg')
PHOTO2 = os.path.join(ROOT, 'tests', 'fixtures', 'field_photo2.jpg')
# Overpass の本物の答え(2026-10-22 取得、Malema の町を中心に 10 km 四方)。試験では本物の窓口に問い合わせない。
OVERPASS = os.path.join(ROOT, 'tests', 'fixtures', 'overpass_malema.json')
MALEMA = {'lat': -14.955, 'lng': 37.41}
MONAPO = {'lat': -14.92, 'lng': 40.31}
MONAPO2 = {'lat': -15.10, 'lng': 39.95}  # Monapo 郡の中で、町から離れた所(10/27 から地図データは Monapo 郡だけ)
# 取り込み試験用の画像(tests/make_imagery_fixtures.py で作る)。どれも真ん中がマゼンタ
FIX = os.path.join(ROOT, 'tests', 'fixtures')
IMG_UTM = os.path.join(FIX, 'img_utm37s_rgba.tif')
IMG_16 = os.path.join(FIX, 'img_4326_16bit.tif')
IMG_KMZ = os.path.join(FIX, 'img_overlay.kmz')
IMG_BAD = os.path.join(FIX, 'img_bad_crs.tif')
# 簡易地図の画面の真ん中から少しずらした点の色(真ん中は印などが重なることがあるので)
CENTER_RGB = """() => { const c = document.querySelector('#mapSimple canvas'); const g = c.getContext('2d'); const out = []; for (const dy of [-30, 0, 30]) for (const dx of [-30, 0, 30]) { const d = g.getImageData(Math.floor(c.width / 2) + dx, Math.floor(c.height / 2) + dy, 1, 1).data; out.push([d[0], d[1], d[2]]); } return out; }"""
IMG_CHUNKS = """() => new Promise((res) => { const r = indexedDB.open('fgm-user-imagery'); r.onsuccess = () => { const q = r.result.transaction('chunks').objectStore('chunks').count(); q.onsuccess = () => res(q.result); }; })"""
# 地図データの入れ物(Cache Storage fgm-s2-v1)の中身の数
CACHE_STATS = """() => caches.open('fgm-s2-v1').then((c) => c.keys()).then((k) => ({
  webp: k.filter((r) => r.url.endsWith('.webp')).length,
  done: k.filter((r) => r.url.endsWith('.bin.done')).length,
  json: k.filter((r) => /\\.json(\\?|$)/.test(r.url)).length }))"""
# 行政境界の線(#7b4fa8)と名前(#4b2c6b)の色の画素の数(衛星写真を消した地図で数える)
ADMIN_PX = """() => { const c = document.querySelector('#mapSimple canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0;
  const near = (i, r, g, b) => Math.abs(d[i] - r) < 25 && Math.abs(d[i + 1] - g) < 25 && Math.abs(d[i + 2] - b) < 25;
  for (let i = 0; i < d.length; i += 4) if (near(i, 0x7b, 0x4f, 0xa8) || near(i, 0x4b, 0x2c, 0x6b)) n++; return n; }"""
SETTINGS = "() => JSON.parse(localStorage.getItem('fgm.settings') || '{}')"
# 真ん中 200×200 画素のうち、地図の下地(#f4f1e8、方眼の線を含む)の色の画素の割合。
# 地図だけなら道・境界・文字を除いた大半、衛星写真ならほぼ 0
BG_SHARE = """() => { const c = document.querySelector('#mapSimple canvas'); const d = c.getContext('2d').getImageData(Math.floor(c.width / 2) - 100, Math.floor(c.height / 2) - 100, 200, 200).data;
  let n = 0; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 244) + Math.abs(d[i + 1] - 241) + Math.abs(d[i + 2] - 232) < 40) n++; return Math.round(n / (d.length / 4) * 100) / 100; }"""


def magenta(pts):
    # 9点のうち5点以上がマゼンタ(道などの線が重なっても落ちないように)
    return sum(1 for p in pts if p[0] > 190 and p[1] < 90 and p[2] > 190) >= 5


def not_plain(pts):
    # 9点のうち7点以上が地図の下地(#f4f1e8)でない = 衛星写真が描けている
    return sum(1 for p in pts if abs(p[0] - 244) + abs(p[1] - 241) + abs(p[2] - 232) > 30) >= 7


# 広い範囲(半径 100 km、道・川・集落名だけ)の本物の答え(2026-10-22 取得、小さく詰め直したもの)
OVERPASS_WIDE = os.path.join(ROOT, 'tests', 'fixtures', 'overpass_wide_malema.json')
# 地図データ(別リポジトリ field-gps-imagery。tools/hq_tiles.py・make_catalog.py などで作ったもの)
IMAGERY_LIVE = os.path.join(os.path.dirname(ROOT), 'field_gps_imagery', 'docs')
IMAGERY = os.path.join(tempfile.gettempdir(), 'fgm_e2e_imagery')   # 試験のあいだ配る写し

PLAIN_MIN = 0.5   # 地図だけ:下地の画素の割合はこれ以上
SAT_MAX = 0.2     # 衛星写真:下地の画素の割合はこれ以下

ok = 0
ng = 0


def check(name, cond, info=''):
    global ok, ng
    if cond:
        ok += 1
        print('  OK ', name, info)
    else:
        ng += 1
        print('  NG ', name, info)


# ---------------------------------------------------------------- 地図データの写し
def snapshot_imagery():
    """目録に載っている束・JSON が全部そろっている時を待って写す。返り値は (目録, タイルの索引)。"""
    for attempt in range(60):
        raw = open(os.path.join(IMAGERY_LIVE, 'catalog.json'), 'rb').read()
        cat = json.loads(raw.decode('utf-8'))
        files = []
        for r in cat['regions']:
            files += [(r['tiles'] + p['file'], p['bytes'], True) for p in r['packs']]
            files += [(r[k]['url'].split('?')[0], r[k]['bytes'], False) for k in ('osm', 'admin')]

        def ready(base, recent_ok):
            for rel, size, _ in files:
                f = os.path.join(base, *rel.split('/'))
                if not os.path.exists(f) or os.path.getsize(f) != size:
                    return False
                if not recent_ok and time.time() - os.path.getmtime(f) < 10:   # 書いている最中かもしれない
                    return False
            return True
        if ready(IMAGERY_LIVE, False):
            for rel, size, is_pack in files:
                dst = os.path.join(IMAGERY, *rel.split('/'))
                if is_pack and os.path.exists(dst) and os.path.getsize(dst) == size:
                    continue   # 束は名前に中身の印が入っているので、同じ名前・大きさなら同じもの
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.copyfile(os.path.join(IMAGERY_LIVE, *rel.split('/')), dst)
            if ready(IMAGERY, True) and open(os.path.join(IMAGERY_LIVE, 'catalog.json'), 'rb').read() == raw:
                with open(os.path.join(IMAGERY, 'catalog.json'), 'wb') as fh:
                    fh.write(raw)
                break
        print('  (地図データを作り直し中。そろうのを待つ)', flush=True)
        time.sleep(20)
    else:
        raise SystemExit('地図データがそろわない: ' + IMAGERY_LIVE)
    # 1 枚ずつのタイル(表示のときに取りに来る)は、束の中から切り出して返す
    tiles = {}
    for r in cat['regions']:
        for p in r['packs']:
            f = os.path.join(IMAGERY, *(r['tiles'] + p['file']).split('/'))
            with open(f, 'rb') as fh:
                head = fh.read(8)
                hl = struct.unpack('<I', head[4:8])[0]
                h = json.loads(fh.read(hl).decode('utf-8'))
            for key, off, ln in h['tiles']:
                tiles[f"/field-gps-imagery/{r['tiles']}{key}.webp"] = (f, 8 + hl + off, ln)
    return cat, tiles


REQUESTS = []          # 配った URL の道筋(取り込みの続きの確認用)
TILES = {}
MOUNTS = {'/field-gps-map/': DOCS, '/field-gps-imagery/': IMAGERY}


class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        path = urllib.parse.unquote(path.split('?')[0].split('#')[0])
        for pre, d in MOUNTS.items():
            if path.startswith(pre):
                return os.path.join(d, *path[len(pre):].split('/'))
        return os.path.join(DOCS, '__none__')

    def do_GET(self):
        p = urllib.parse.unquote(self.path.split('?')[0])
        REQUESTS.append(p)
        if p.endswith('.webp') and p.startswith('/field-gps-imagery/'):
            hit = TILES.get(p)
            if not hit:
                self.send_error(404)
                return
            f, off, ln = hit
            with open(f, 'rb') as fh:
                fh.seek(off)
                body = fh.read(ln)
            self.send_response(200)
            self.send_header('Content-Type', 'image/webp')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def log_message(self, *a):
        pass


def serve():
    httpd = http.server.ThreadingHTTPServer(('localhost', PORT), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


# モザンビーク北部(Malema 付近)の基準点。ここから東西・南北に m 単位で動く。
REF = (-14.81, 38.32)
R = 6378137.0


def ll(x, y):
    lat = REF[0] + math.degrees(y / R)
    lng = REF[1] + math.degrees(x / (R * math.cos(math.radians(REF[0]))))
    return lat, lng


def move(ctx, x, y, acc=4):
    lat, lng = ll(x, y)
    ctx.set_geolocation({'latitude': lat, 'longitude': lng, 'accuracy': acc})


def shot(page, name):
    if SAVE_SHOTS:
        os.makedirs(SHOTS, exist_ok=True)
        page.screenshot(path=os.path.join(SHOTS, name + '.png'))


def close_help(page):
    if page.locator('#helpDialog[open]').count():
        page.locator('#helpDialog [data-close]').click()


def close_dialog(page, sel):
    if page.locator(f'{sel}[open]').count():
        page.keyboard.press('Escape')
        page.wait_for_timeout(150)


def feature(page, name):
    return [f for f in page.evaluate('window.__fgm.features') if f['name'] == name][0]


def watch_errors(page):
    """ページのエラーとコンソールのエラーを集める。(文, URL) の組。"""
    errs = []
    page.on('pageerror', lambda e: errs.append((str(e), '')))
    page.on('console', lambda m: errs.append((m.text, (m.location or {}).get('url', ''))) if m.type == 'error' and 'favicon' not in m.text else None)
    return errs


def real_errors(errs, allow=()):
    """仕組みの上で出て当然のものを除く:
       - 範囲の中でもタイルの無い所(海・範囲の縁)を電波ありで取りに行ったときの 404
       - 圏外にしたあとの通信の失敗
       - allow に入れた URL の一部(わざと失敗させたもの)"""
    out = []
    for text, url in errs:
        if 'Failed to load resource' in text and '404' in text and '/field-gps-imagery/' in url and url.endswith('.webp'):
            continue
        if 'ERR_INTERNET_DISCONNECTED' in text:
            continue
        if any(a in url or a in text for a in allow):
            continue
        out.append(f'{text} [{url}]' if url else text)
    return out


def wait_imagery(page, c, zoom, want=not_plain, ms=10000):
    """地図をそこへ動かし、衛星写真が描けるまで待つ(タイルは読み込みが非同期)。真ん中の色を返す。"""
    page.evaluate('([c, z]) => window.__fgm.map.centerOn(c, z)', [c, zoom])
    t0 = time.time()
    while True:
        page.wait_for_timeout(400)
        pts = page.evaluate(CENTER_RGB)
        if want(pts) or (time.time() - t0) * 1000 > ms:
            return pts


def wait_map_done(page, timeout_s=900):
    t0 = time.time()
    page.wait_for_function('window.__fgm && window.__fgm.mapData.done', timeout=timeout_s * 1000, polling=1000)
    return time.time() - t0


def layers_choose(page, idx):
    """地図ボタン → 地図の種類(0 = 衛星写真、1 = 地図だけ)を選ぶ。"""
    page.click('#btnLayers')
    page.wait_for_selector('dialog[open] .lang-list button')
    page.locator('dialog[open] .lang-list button').nth(idx).click()
    page.wait_for_timeout(300)


def main():
    global TILES
    print('[0] 地図データの写し')
    cat, TILES = snapshot_imagery()
    n_packs = sum(len(r['packs']) for r in cat['regions'])
    n_tiles = sum(p['tiles'] for r in cat['regions'] for p in r['packs'])
    n_bytes = sum(p['bytes'] for r in cat['regions'] for p in r['packs']) + sum(r[k]['bytes'] for r in cat['regions'] for k in ('osm', 'admin'))
    n_json = 2 * len(cat['regions']) + 1   # 範囲ごとの osm・admin と目録
    print(f'  regions={len(cat["regions"])} packs={n_packs} tiles={n_tiles} bytes={n_bytes}')
    check('tile index matches catalog', len(TILES) == n_tiles, f'{len(TILES)} / {n_tiles}')
    httpd = serve()
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='msedge', headless=True)
        ctx = browser.new_context(
            viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
            permissions=['geolocation'], geolocation={'latitude': REF[0], 'longitude': REF[1], 'accuracy': 4},
            locale='pt-PT', accept_downloads=True)
        # この端末は「ページの中で取り込む」道(iPhone などと同じ)。Background Fetch は [12] で別に試す
        ctx.add_init_script('delete window.BackgroundFetchManager;')
        page = ctx.new_page()
        errors = watch_errors(page)

        page.goto(URL + '?demo')
        page.wait_for_selector('#mainScreen:not([hidden])', timeout=15000)
        page.wait_for_timeout(500)
        # 1回目の表示で使い方の画面が「見た」になることがあるので、ここで消しておく(初回の表示を確かめるため)
        page.evaluate("""() => { localStorage.setItem('fgm.settings', JSON.stringify({lang: 'pt'})); localStorage.removeItem('fgm.helpSeen'); }""")
        page.goto(URL + '?demo')
        page.wait_for_selector('#mainScreen:not([hidden])', timeout=15000)
        print('[1] 起動')
        check('main screen shown', page.is_visible('#fabNew'))
        try:   # 使い方の画面は、メイン画面が出たあと(下書きの確認などのあと)に開く
            page.wait_for_selector('#helpDialog[open]', timeout=5000)
        except Exception:
            pass
        check('help dialog shown first time', page.locator('#helpDialog[open]').count() == 1)
        page.wait_for_timeout(200)
        check('help starts at the top', page.evaluate("document.querySelector('#helpDialog').scrollTop") == 0)
        check('version 2.0.1', page.evaluate('window.__fgm.version') == '2.0.1')
        shot(page, '01_help')
        close_help(page)
        page.wait_for_function("() => document.querySelector('#gpsText').textContent.includes('±')", timeout=10000)
        check('gps chip shows accuracy', '±4' in page.inner_text('#gpsText'), page.inner_text('#gpsText'))
        check('canvas map shown', page.is_visible('#mapSimple canvas'))
        check('no Google map left', page.locator('#mapGoogle').count() == 0 and 'mapType' not in page.evaluate('Object.keys(window.__fgm)'))
        check('zoom buttons hidden on phone (pinch instead)', not page.is_visible('#btnZoomIn'))
        shot(page, '02_main')

        # ---------------------------------------------------- 地図データの自動取り込み(ページの中)
        print('[1b] 地図データの自動取り込み(ページの中)')
        page.wait_for_function('window.__fgm.mapData.running || window.__fgm.mapData.done', timeout=20000)
        md = page.evaluate('window.__fgm.mapData')
        check('download starts by itself (in page)', md['mode'] == 'page' and md['total'] == n_bytes, json.dumps(md))
        page.wait_for_timeout(1500)
        shot(page, '02b_mapdata_busy')
        sec = wait_map_done(page)
        md = page.evaluate('window.__fgm.mapData')
        check('map data done', md['done'] and md['have'] == md['total'] and not md['error'], f'{json.dumps(md)} {sec:.0f}s')
        cs = page.evaluate(CACHE_STATS)
        check('all tiles in Cache Storage', cs['webp'] == n_tiles, f"{cs['webp']} / {n_tiles}")
        check('every pack marked done', cs['done'] == n_packs, f"{cs['done']} / {n_packs}")
        check('roads/rivers + admin + catalog cached', cs['json'] == n_json, f"{cs['json']} / {n_json}")
        page.wait_for_function(f"window.__fgm.vectors.admin === {len(cat['regions'])}", timeout=15000)
        vec = page.evaluate('window.__fgm.vectors')
        check('region roads/rivers loaded', vec['osm'] == len(cat['regions']), json.dumps(vec))
        check('admin boundaries + labels loaded', vec['adminLines'] > 50 and vec['adminLabels'] > 20, json.dumps(vec))
        rgb = wait_imagery(page, MONAPO, 13)
        nv = page.evaluate(BG_SHARE)
        check('satellite drawn at Monapo', not_plain(rgb) and nv <= SAT_MAX, f'background {nv} {rgb}')
        shot(page, '02c_monapo_sat')
        rgb = wait_imagery(page, MONAPO2, 13)
        check('satellite drawn in Monapo district away from town', not_plain(rgb), str(rgb))
        shot(page, '02d_monapo2_sat')
        page.click('#btnMenu')
        page.wait_for_selector('#menuDialog[open]')
        page.wait_for_timeout(300)
        check('menu shows map data ready', 'ok' in (page.get_attribute('#stSat', 'class') or ''), page.inner_text('#stSat'))
        close_dialog(page, '#menuDialog')

        # ---------------------------------------------------- 衛星写真 / 地図だけ の切り替え
        print('[1c] 衛星写真 / 地図だけ')
        page.click('#btnLayers')
        page.wait_for_selector('dialog[open] .lang-list button')
        btns = page.locator('dialog[open] .lang-list button')
        check('layers dialog has 2 map types', btns.count() == 2, str(btns.count()))
        check('satellite is the default', 'on' in (btns.nth(0).get_attribute('class') or ''))
        check('layers dialog shows map data ready', page.inner_text('dialog[open] .mapdata-state') != '' and page.is_hidden('dialog[open] .mapdata-go'),
              page.inner_text('dialog[open] .mapdata-state'))
        shot(page, '02e_layers')
        btns.nth(1).click()
        page.wait_for_timeout(300)
        check('plain saved in settings', page.evaluate(SETTINGS).get('sat') is False, json.dumps(page.evaluate(SETTINGS)))
        page.evaluate('([c, z]) => window.__fgm.map.centerOn(c, z)', [MONAPO, 11])
        page.wait_for_timeout(800)
        nv = page.evaluate(BG_SHARE)
        check('plain map: no satellite in the middle', nv >= PLAIN_MIN, f'background {nv}')
        npx = page.evaluate(ADMIN_PX)
        check('admin lines/labels drawn (purple)', npx > 300, str(npx))
        shot(page, '02f_monapo_plain_admin')
        page.reload()
        page.wait_for_selector('#mainScreen:not([hidden])', timeout=15000)
        close_help(page)
        page.wait_for_timeout(1500)
        nv = page.evaluate(BG_SHARE)
        check('plain kept after reload', page.evaluate(SETTINGS).get('sat') is False and nv >= PLAIN_MIN, f'background {nv}')
        page.click('#btnLayers')
        page.wait_for_selector('dialog[open] .lang-list button')
        check('dialog marks plain after reload', 'on' in (page.locator('dialog[open] .lang-list button').nth(1).get_attribute('class') or ''))
        page.locator('dialog[open] .lang-list button').nth(0).click()
        page.wait_for_timeout(300)
        check('satellite saved in settings', page.evaluate(SETTINGS).get('sat') is True)
        page.reload()
        page.wait_for_selector('#mainScreen:not([hidden])', timeout=15000)
        close_help(page)
        rgb = wait_imagery(page, MONAPO, 11)
        nv = page.evaluate(BG_SHARE)
        check('satellite kept after reload', page.evaluate(SETTINGS).get('sat') is True and not_plain(rgb) and nv <= SAT_MAX, f'background {nv} {rgb}')
        shot(page, '02g_monapo_sat_admin')
        # 記録の試験は基準点のそば(以前の版と同じ表示)で
        page.evaluate('([c, z]) => window.__fgm.map.centerOn(c, z)', [{'lat': REF[0], 'lng': REF[1]}, 15])
        page.wait_for_timeout(300)

        # ---------------------------------------------------- 歩いて角を追加(100m × 100m = 1 ha)
        print('[2] 歩いて角を追加')
        page.click('#fabNew')
        page.wait_for_timeout(500)
        shot(page, '03_kinds')
        page.click('#newKinds [data-kind="polygon"]')
        page.wait_for_selector('#recPanel:not([hidden])')
        check('recording starts right after choosing kind', page.evaluate('window.__fgm.recorder.method') == 'corners')
        check('walk mode selected', 'on' in page.get_attribute('#recMode [data-mode="gps"]', 'class'))
        check('big mark button shown', page.is_visible('#btnRecMark'))
        for i, (x, y) in enumerate([(0, 0), (100, 0), (100, 100), (0, 100)]):
            # 角まで歩く途中の測位(点は増えないはず)
            for k in range(3):
                move(ctx, x - 10 + k * 3, y, acc=4)
                page.wait_for_timeout(80)
            check(f'walking adds nothing (before corner {i + 1})', page.evaluate('window.__fgm.stats().n') == i)
            move(ctx, x, y, acc=4)
            page.wait_for_timeout(250)
            page.click('#btnRecMark')
            check(f'corner {i + 1} added instantly', page.evaluate('window.__fgm.stats().n') == i + 1)
            if i == 1:
                page.click('#btnRecMark')   # 2度押し → 無視される
                check('double tap ignored', page.evaluate('window.__fgm.stats().n') == 2)
        st = page.evaluate('window.__fgm.stats()')
        check('area ≈ 1 ha', abs(st['areaM2'] - 10000) < 300, f"{st['areaM2']:.0f} m²")
        check('goal counter shows 10', '10' in page.inner_text('#stGoal'), page.inner_text('#stGoal'))
        shot(page, '04_corners')
        page.click('#btnRecFinish')
        page.wait_for_selector('#saveDialog[open]')
        check('save summary has ha', 'ha' in page.inner_text('#saveSummary'), page.inner_text('#saveSummary'))
        page.fill('#fName', 'Bloco teste A')
        page.fill('#fGroup', 'Malema 2')
        # 保存の画面で写真を2枚
        page.locator('#savePhotos .ph-add').click()
        page.set_input_files('#photoInput', [PHOTO1, PHOTO2])
        page.wait_for_function("() => document.querySelectorAll('#savePhotos .ph').length === 2", timeout=10000)
        check('2 photos staged', True)
        shot(page, '05_save')
        page.click('#saveOk')
        page.wait_for_selector('#detailSheet:not([hidden])', timeout=5000)
        check('detail opened after save', page.inner_text('#dTitle') == 'Bloco teste A')
        dst = page.inner_text('#dStats')
        check('detail shows ~1 ha', any(s in dst for s in ('1,00 ha', '0,99 ha', '1,01 ha')), dst)
        check('draft cleared', page.evaluate('localStorage.getItem("fgm.draft")') is None)
        page.wait_for_function('() => window.__fgm.photos.length === 2', timeout=8000)
        page.wait_for_timeout(200)
        check('detail has 2 photos', page.locator('#dPhotos .ph').count() == 2)
        ph = page.evaluate('window.__fgm.photos[0]')
        check('photo resized (≤1280px)', max(ph['w'], ph['h']) <= 1280, f"{ph['w']}x{ph['h']}")
        check('photo data is jpeg', ph['data'].startswith('data:image/jpeg'))
        check('photo small enough for Firestore', len(ph['data']) < 900000, str(len(ph['data'])))
        f = feature(page, 'Bloco teste A')
        check('cover + photoCount on feature', bool(f.get('cover')) and f.get('photoCount') == 2, str(f.get('photoCount')))
        shot(page, '06_detail')
        # 写真を見る → 1枚外す
        page.locator('#dPhotos .ph').first.click()
        page.wait_for_selector('#viewerDialog[open]')
        check('viewer opens', page.is_visible('#viewerImg'))
        check('viewer caption 1 / 2', '1 / 2' in page.inner_text('#viewerCaption'), page.inner_text('#viewerCaption'))
        shot(page, '07_viewer')
        page.click('#viewerRemove')
        page.wait_for_selector('#confirmDialog[open]')
        page.click('#confirmYes')
        page.wait_for_function('() => window.__fgm.photos.length === 1', timeout=5000)
        page.wait_for_timeout(200)
        check('photo removed', page.locator('#dPhotos .ph').count() == 1)
        # 詳細の画面から1枚足す
        page.locator('#dPhotos .ph-add').click()
        page.set_input_files('#photoInput', PHOTO1)
        page.wait_for_function('() => window.__fgm.photos.length === 2', timeout=8000)
        check('photo added from detail', feature(page, 'Bloco teste A').get('photoCount') == 2)
        page.locator('#detailSheet [data-close]').click()

        # ---------------------------------------------------- 角(50m × 80m = 0.4 ha)、精度の悪い角
        print('[3] 角 + 精度の警告')
        page.click('#fabNew')
        page.click('#newKinds [data-kind="polygon"]')
        page.wait_for_selector('#btnRecMark:not([hidden])')
        for i, (x, y) in enumerate([(200, 0), (250, 0), (250, 80), (200, 80)]):
            move(ctx, x, y, acc=25 if i == 3 else 3)
            page.wait_for_timeout(300)
            page.click('#btnRecMark')
        st = page.evaluate('window.__fgm.stats()')
        check('4 corners recorded', st['n'] == 4, f"n={st['n']}")
        check('low-accuracy warning', not page.locator('#recWarn').is_hidden(), page.inner_text('#recWarn'))
        page.click('#btnRecUndo')
        check('undo removes corner', page.evaluate('window.__fgm.stats().n') == 3)
        move(ctx, 200, 80, acc=3)
        page.wait_for_timeout(300)
        page.click('#btnRecMark')
        st = page.evaluate('window.__fgm.stats()')
        check('corner area ≈ 0.4 ha', abs(st['areaM2'] - 4000) < 60, f"{st['areaM2']:.0f} m²")
        page.click('#btnRecFinish')
        page.wait_for_selector('#saveDialog[open]')
        page.fill('#fName', 'Viveiro Netia')
        chips = page.locator('#fCatChips button')
        check('only area categories shown', chips.count() == 5, str(chips.count()))
        chips.filter(has_text='Viveiro').click()
        check('category chip selected', 'on' in chips.filter(has_text='Viveiro').get_attribute('class'))
        page.click('#saveOk')
        page.wait_for_selector('#detailSheet:not([hidden])')
        check('category saved', feature(page, 'Viveiro Netia')['category'] == 'nursery')
        page.locator('#detailSheet [data-close]').click()

        # ---------------------------------------------------- 地点(現在地)
        print('[4] 地点')
        move(ctx, 120, 50, acc=3)
        page.wait_for_timeout(300)
        page.click('#fabNew')
        page.click('#newKinds [data-kind="point"]')
        page.click('#btnRecMark')
        check('point measured instantly', page.evaluate('window.__fgm.stats().n') == 1)
        page.click('#btnRecFinish')
        page.fill('#fName', 'Poço 1')
        page.locator('#fCatChips button').filter(has_text='Rio').click()
        page.click('#saveOk')
        page.wait_for_selector('#detailSheet:not([hidden])')
        check('point detail shows coords', '-14.8' in page.inner_text('#dStats'), page.inner_text('#dStats'))
        page.locator('#detailSheet [data-close]').click()

        # ---------------------------------------------------- 地図をタップ
        print('[5] 地図をタップ(途中で切り替え)')
        page.click('#fabNew')
        page.click('#newKinds [data-kind="line"]')
        page.click('#recMode [data-mode="tap"]')
        check('switched to tap mode', page.evaluate('window.__fgm.recorder.method') == 'tap')
        check('mark button hidden in tap mode', not page.is_visible('#btnRecMark'))
        box = page.locator('#simpleCanvas').bounding_box()
        for (dx, dy) in [(-80, -150), (0, -100), (80, -160)]:
            page.mouse.click(box['x'] + box['width'] / 2 + dx, box['y'] + box['height'] / 2 + dy)
            page.wait_for_timeout(150)
        st = page.evaluate('window.__fgm.stats()')
        check('3 tapped vertices', st['n'] == 3 and st['tapCount'] == 3, json.dumps(st))
        check('line length > 0', (st['lengthM'] or 0) > 1)
        page.wait_for_timeout(300)
        shot(page, '08_tap_mode')
        page.click('#btnRecUndo')
        check('undo removes vertex', page.evaluate('window.__fgm.stats().n') == 2)
        page.click('#recMode [data-mode="gps"]')
        move(ctx, 130, 60, acc=4)
        page.wait_for_timeout(300)
        page.click('#btnRecMark')
        check('gps point added after switching back', page.evaluate('window.__fgm.stats().n') == 3)
        page.click('#btnRecFinish')
        check('mixed tap warning in save dialog', not page.locator('#saveWarn').is_hidden(), page.inner_text('#saveWarn'))
        check('line category defaults to hedge', 'on' in page.locator('#fCatChips button').first.get_attribute('class'))
        page.fill('#fName', 'Rio teste')
        page.click('#saveOk')
        page.wait_for_selector('#detailSheet:not([hidden])')
        f = feature(page, 'Rio teste')
        check('mixed record saved as GPS method + tapCount', f['method'] == 'corners' and f['tapCount'] == 2, f"{f['method']} {f['tapCount']}")
        check('detail shows tapped count', '2' in page.inner_text('#dMeta'), page.inner_text('#dMeta'))
        page.locator('#detailSheet [data-close]').click()

        # ---------------------------------------------------- 途中で閉じても続きから
        print('[6] 下書きの復元')
        page.click('#fabNew')
        page.click('#newKinds [data-kind="polygon"]')
        page.click('#recMode [data-mode="tap"]')
        for (dx, dy) in [(-50, -200), (50, -200), (50, -120)]:
            page.mouse.click(box['x'] + box['width'] / 2 + dx, box['y'] + box['height'] / 2 + dy)
            page.wait_for_timeout(120)
        page.reload()
        page.wait_for_selector('#confirmDialog[open]', timeout=10000)
        check('resume prompt', 'pontos: 3' in page.inner_text('#confirmText'), page.inner_text('#confirmText'))
        page.click('#confirmYes')
        page.wait_for_selector('#recPanel:not([hidden])')
        check('draft restored', page.evaluate('window.__fgm.stats().n') == 3)
        check('tap mode restored', 'on' in page.get_attribute('#recMode [data-mode="tap"]', 'class'))
        page.click('#btnRecCancel')
        page.click('#confirmYes')
        check('cancel clears', page.is_hidden('#recPanel'))

        # ---------------------------------------------------- 一覧・検索
        print('[7] 一覧')
        page.click('#btnList')
        page.wait_for_selector('#listPanel:not([hidden])')
        check('list has 4 items', page.locator('#listItems li').count() == 4, str(page.locator('#listItems li').count()))
        check('summary total', 'Áreas: 2' in page.inner_text('#listSummary'), page.inner_text('#listSummary'))
        page.fill('#listSearch', 'viveiro')
        check('search filters', page.locator('#listItems li').count() == 1)
        page.fill('#listSearch', '')
        page.locator('#listGroups button', has_text='Malema 2').click()
        n_m2 = len([f for f in page.evaluate('window.__fgm.features') if f.get('group') == 'Malema 2'])
        check('group chip filter', page.locator('#listItems li').count() == n_m2 and n_m2 >= 1, str(n_m2))
        page.locator('#listGroups button').first.click()
        check('group chip "all" resets', page.locator('#listItems li').count() == 4)
        shot(page, '08_list')
        page.locator('#listItems li').first.click()
        page.wait_for_selector('#detailSheet:not([hidden])')
        check('hash link set', '#f=' in page.url)

        # 編集
        page.click('#dEdit')
        page.fill('#fNotes', 'nota de teste')
        page.click('#saveOk')
        page.wait_for_timeout(300)
        check('edit saved', 'nota de teste' in page.inner_text('#dMeta'))

        # ---------------------------------------------------- 書き出し
        print('[8] 書き出し')
        page.locator('#detailSheet [data-close]').click()
        page.locator('#listPanel [data-close]').click()
        page.click('#btnMenu')
        page.click('#menuDialog [data-act="export"]')
        with page.expect_download() as dl:
            page.click('#exportDialog [data-fmt="kml"]')
        kml_path = dl.value.path()
        kml = open(kml_path, encoding='utf-8').read()
        doc = xml.dom.minidom.parseString(kml.encode('utf-8'))
        check('KML parses', True)
        check('KML has 2 polygons', len(doc.getElementsByTagName('Polygon')) == 2)
        check('KML has line + point', len(doc.getElementsByTagName('LineString')) == 1 and len(doc.getElementsByTagName('Point')) == 1)
        with page.expect_download() as dl:
            page.click('#exportDialog [data-fmt="csv"]')
        csv = open(dl.value.path(), encoding='utf-8-sig').read()
        check('CSV has header + 4 rows', len(csv.strip().splitlines()) == 5, str(len(csv.strip().splitlines())))
        check('CSV has WKT polygon', 'POLYGON((' in csv)
        check('CSV has photos column', 'photos' in csv.splitlines()[0], csv.splitlines()[0])
        hdr = csv.splitlines()[0].split(',')
        check('CSV has local date/time and who', all(c in hdr for c in ('recorded_date', 'recorded_time', 'recorded_by', 'updated_by')), str(hdr))
        with page.expect_download(timeout=20000) as dl:
            page.click('#exportDialog [data-fmt="zip"]')
        zp = dl.value.path()
        check('ZIP downloaded', os.path.getsize(zp) > 500)
        with zipfile.ZipFile(zp) as z:
            jpgs = [n for n in z.namelist() if n.startswith('photos/') and n.endswith('.jpg')]
            gj = json.loads(z.read('field_gps_map.geojson').decode('utf-8'))
        check('ZIP GeoJSON 4 features', len(gj['features']) == 4)
        check('ZIP has 2 photos', len(jpgs) == 2, str(jpgs))
        page.locator('#exportDialog [data-close]').click()

        # ---------------------------------------------------- 管理者:チームの集計
        print('[8b] 管理者の集計')
        page.click('#btnMenu')
        check('admin item shown in demo', page.is_visible('#menuAdmin'))
        page.click('#menuAdmin')
        page.wait_for_selector('#adminDialog[open] .adm-card')
        cards = page.locator('#admTotals .adm-card b').all_inner_texts()
        check('today total = 4 records', cards[0] == '4', str(cards))
        check('today total has area', 'ha' in cards[1], str(cards))
        check('one person today', cards[4] == '1', str(cards))
        check('per-person row', page.locator('#admPeople tr').count() == 2, page.inner_text('#admPeople'))
        check('records listed', page.locator('#admList li').count() == 4)
        check('day table hidden for today', page.is_hidden('#admDaysBox'))
        shot(page, '08b_admin_today')
        page.click('#adminDialog [data-p="yesterday"]')
        page.wait_for_timeout(200)
        check('yesterday is empty', page.locator('#admTotals .adm-card b').first.inner_text() == '0')
        page.click('#adminDialog [data-p="d7"]')
        page.wait_for_timeout(200)
        check('7 days shows day table', page.is_visible('#admDaysBox') and page.locator('#admDays tr').count() == 2)
        page.locator('#admDays tr[data-day]').first.click()
        page.wait_for_timeout(200)
        check('tap day -> that day', page.input_value('#admDate') != '' and page.locator('#admTotals .adm-card b').first.inner_text() == '4')
        with page.expect_download() as dl:
            page.click('#adminDialog [data-adm="summary"]')
        sm = open(dl.value.path(), encoding='utf-8-sig').read()
        flat = sm.replace(chr(13), '')
        check('summary CSV has person + TOTAL + day', 'TOTAL,,4,' in flat and 'person,email,records' in flat and (chr(10) + 'date,records,people') in flat, flat[:300])
        with page.expect_download() as dl:
            page.click('#adminDialog [data-adm="csv"]')
        pc = open(dl.value.path(), encoding='utf-8-sig').read()
        check('period CSV has 4 rows', len(pc.strip().splitlines()) == 5)
        with page.expect_download() as dl:
            page.click('#adminDialog [data-adm="kml"]')
        check('period KML', dl.value.suggested_filename.endswith('.kml'))
        page.locator('#admList li').first.click()
        page.wait_for_selector('#detailSheet:not([hidden])')
        check('tap record opens detail', page.is_visible('#detailSheet'))
        page.locator('#detailSheet [data-close]').click()
        page.wait_for_timeout(300)

        # ---------------------------------------------------- 読み込み(書き出した KML を戻す)
        print('[9] 読み込み')
        page.click('#btnMenu')
        page.click('#menuDialog [data-act="import"]')
        page.set_input_files('#impFile', kml_path)
        page.wait_for_function('() => !document.querySelector("#impOk").disabled', timeout=5000)
        check('import preview', 'áreas: 2' in page.inner_text('#impPreview'), page.inner_text('#impPreview'))
        page.fill('#impGroup', 'Importados')
        page.click('#impOk')
        page.wait_for_timeout(400)
        check('8 features after import', len(page.evaluate('window.__fgm.features')) == 8)
        areas = sorted(round(f['areaM2']) for f in page.evaluate('window.__fgm.features') if f['kind'] == 'polygon')
        check('imported areas match', areas[0] == areas[1] and areas[2] == areas[3], str(areas))

        # ---------------------------------------------------- 言語の切り替え(3言語)
        print('[10] 言語')

        def raw_keys():
            body = page.inner_text('body')
            return [w for w in ['rec.', 'list.', 'menu.', 'save.', 'set.', 'exp.', 'photo.', 'off.', 'upd.', 'map.', 'mapdata.'] if (' ' + w) in body]

        for code, fab in [('ja', '新しく記録'), ('en', 'New record')]:
            page.click('#btnMenu')
            page.click('#menuDialog [data-act="lang"]')
            page.wait_for_selector('#langDialog[open]')
            page.click(f'#langDialog [data-lang="{code}"]')
            page.wait_for_timeout(250)
            close_dialog(page, '#langDialog')
            check(f'fab in {code}', page.inner_text('#fabNew').strip() == fab, page.inner_text('#fabNew'))
            check(f'no raw keys ({code})', not raw_keys(), str(raw_keys()))
            if code == 'ja':
                page.click('#btnList')
                page.wait_for_timeout(600)
                shot(page, '09_list_ja')
                page.locator('#listPanel [data-close]').click()
        page.click('#btnMenu')
        page.wait_for_selector('#menuDialog[open]')
        page.wait_for_timeout(800)
        check('no raw keys in menu (en)', not raw_keys(), str(raw_keys()))
        check('menu has 6 items (admin in demo)', page.locator('#menuDialog .menu-items button:not([hidden])').count() == 6)
        check('version line offers update check', 'v2.0.1' in page.inner_text('#menuUpdate'), page.inner_text('#menuUpdate'))
        shot(page, '10_menu_en')
        close_dialog(page, '#menuDialog')
        page.click('#btnLayers')
        page.wait_for_selector('dialog[open] .lang-list button')
        page.wait_for_timeout(300)
        check('no raw keys in layers dialog (en)', not raw_keys(), str(raw_keys()))
        page.keyboard.press('Escape')
        page.wait_for_timeout(200)

        # ---------------------------------------------------- 横スクロールが出ないか
        sw = page.evaluate('document.documentElement.scrollWidth')
        check('no horizontal scroll at 390px', sw <= 390, str(sw))

        # ---------------------------------------------------- 圏外用の地図を保存(OpenStreetMap、建物まで)
        print('[10b] 圏外用の地図を保存')
        overpass_body = open(OVERPASS, 'rb').read()
        overpass_wide = open(OVERPASS_WIDE, 'rb').read()
        asked = []

        def fake_overpass(route):
            q = route.request.post_data or ''
            asked.append(q)
            route.fulfill(status=200, content_type='application/json', body=overpass_body if 'building' in q else overpass_wide)
        ctx.route('**/api/interpreter', fake_overpass)
        page.evaluate("(c) => window.__fgm.map.centerOn(c, 15)", MALEMA)
        page.wait_for_timeout(300)
        page.click('#btnMenu')
        page.wait_for_selector('#menuDialog[open]')
        check('menu says no offline map yet', 'warn' in (page.get_attribute('#stMaps', 'class') or ''), page.inner_text('#stMaps'))
        close_dialog(page, '#menuDialog')
        page.click('#btnLayers')
        page.wait_for_selector('.offmap-save')
        check('layers dialog offers saving the map', page.is_visible('.offmap-save'), page.inner_text('.offmap-save'))
        shot(page, '10b_layers')
        page.click('.offmap-save')
        page.wait_for_function('window.__fgm.savedAreas.length === 1', timeout=30000)
        a = page.evaluate('window.__fgm.savedAreas[0]')
        check('asked Overpass once', len(asked) == 1, str(len(asked)))
        check('query asks for roads/rivers/buildings', all(k in asked[0] for k in ('highway', 'waterway', 'building')))
        check('area named after the town', a['name'] == 'Malema', a['name'])
        check('area has >10000 items', a['n'] > 10000, str(a['n']))
        check('area about 10 km square', abs((a['bbox'][2] - a['bbox'][0]) * 111.32 - 10) < 0.1)
        check('saved area has no satellite part (v2: automatic)', 'sat' not in a, str(a.get('sat')))
        page.wait_for_timeout(300)
        shot(page, '10c_osm_town')
        page.evaluate("(c) => window.__fgm.map.centerOn(c, 12)", MALEMA)
        page.wait_for_timeout(300)
        shot(page, '10d_osm_wide')
        page.click('#btnMenu')
        page.wait_for_selector('#menuDialog[open]')
        page.wait_for_timeout(500)
        check('menu counts saved maps', 'ok' in (page.get_attribute('#stMaps', 'class') or ''), page.get_attribute('#stMaps', 'class') + ' ' + page.inner_text('#stMaps'))
        close_dialog(page, '#menuDialog')

        # 広い範囲(半径 100 km)
        page.click('#btnLayers')
        page.wait_for_selector('.offmap-wide')
        check('layers dialog offers the wide area', page.is_visible('.offmap-wide'), page.inner_text('.offmap-wide'))
        page.click('.offmap-wide')
        page.wait_for_function('window.__fgm.savedAreas.length === 2', timeout=90000)
        w = [x for x in page.evaluate('window.__fgm.savedAreas') if x.get('kind') == 'wide'][0]
        check('wide query has no buildings', 'building' not in asked[-1])
        check('wide area about 200 km square', abs((w['bbox'][2] - w['bbox'][0]) * 111.32 - 200) < 1, str(w['bbox']))
        check('wide area has roads and rivers', len(w['data']['roads']) > 5000 and len(w['data']['rivers']) > 400,
              f"{len(w['data']['roads'])} roads {len(w['data']['rivers'])} rivers")
        check('wide area has no buildings', len(w['data']['buildings']) == 0)
        page.wait_for_timeout(400)
        page.evaluate("(c) => window.__fgm.map.centerOn(c, 10)", MALEMA)
        page.wait_for_timeout(1500)
        shot(page, '10e_wide_sat')
        page.evaluate("(c) => window.__fgm.map.centerOn(c, 15)", MALEMA)
        page.wait_for_timeout(1500)
        shot(page, '10f_near_sat')
        page.click('#btnLayers')
        page.wait_for_selector('.offmap-list li')
        check('list shows both maps', page.locator('.offmap-list li').count() == 2, page.inner_text('.offmap-list'))
        shot(page, '10g_list')
        page.keyboard.press('Escape')
        page.wait_for_timeout(200)
        ctx.unroute('**/api/interpreter')

        # ---------------------------------------------------- 手持ちの画像ファイルを取り込む
        print('[10c] 画像ファイルの取り込み')
        page.click('#btnLayers')
        page.wait_for_selector('.offimg-add')
        check('layers dialog offers image import', page.is_visible('.offimg-add'), page.inner_text('.offimg-add'))
        shot(page, '10h_layers_with_import')
        for n, (path, label, res) in enumerate([(IMG_UTM, 'UTM 37S RGBA', 0.3), (IMG_16, '4326 16bit', 0.5), (IMG_KMZ, 'KMZ rotated', None)], 1):
            if n > 1:
                page.click('#btnLayers')
                page.wait_for_selector('.offimg-add')
            page.set_input_files('.offimg-file', path)
            page.wait_for_function(f'window.__fgm.userImagery.length === {n}', timeout=60000)
            L = [x for x in page.evaluate('window.__fgm.userImagery') if x['file'] == os.path.basename(path)][0]
            page.wait_for_timeout(1800)
            near = abs(L['center']['lat'] - MALEMA['lat']) < 0.01 and abs(L['center']['lng'] - MALEMA['lng']) < 0.03
            check(f'{label}: placed near Malema', near, str(L['center']))
            if res:
                check(f'{label}: resolution {res} m', abs(L['res'] - res) < 0.05, str(L['res']))
            rgb = page.evaluate(CENTER_RGB)
            check(f'{label}: image drawn (magenta in the middle)', magenta(rgb), str(rgb))
            shot(page, f'10i_import_{n}')
        L = page.evaluate('window.__fgm.userImagery')[0]
        check('UTM image has several levels', max(p['k'] for p in L['sets'][0]['pieces']) >= 3, str(max(p['k'] for p in L['sets'][0]['pieces'])))
        # 拡大しても(細かい段)マゼンタのまま、縁は透明(下の地図が見える)
        page.evaluate("(c) => window.__fgm.map.centerOn(c, 19)", L['center'])
        page.wait_for_timeout(1500)
        check('fine level drawn at zoom 19', magenta(page.evaluate(CENTER_RGB)), str(page.evaluate(CENTER_RGB)))
        shot(page, '10j_zoom19')
        page.click('#btnLayers')
        page.wait_for_selector('.offimg-add')
        page.set_input_files('.offimg-file', IMG_BAD)
        page.wait_for_timeout(1500)
        msg = page.evaluate("() => document.getElementById('toast').textContent")
        check('unknown CRS refused with advice', 'QGIS' in msg and len(page.evaluate('window.__fgm.userImagery')) == 3, msg)
        page.click('#btnLayers')
        page.wait_for_selector('.offimg-list li')
        check('image list shows 3', page.locator('.offimg-list li').count() == 3, page.inner_text('.offimg-list'))
        shot(page, '10k_image_list')
        page.locator('.offimg-list .offmap-go').last.click()
        page.wait_for_timeout(1200)
        check('tap list item goes to image', magenta(page.evaluate(CENTER_RGB)), str(page.evaluate(CENTER_RGB)))

        # ---------------------------------------------------- 圏外で開き直す(Service Worker)
        print('[11] 圏外')
        page.wait_for_timeout(1500)   # SW のインストール待ち
        page.reload()
        page.wait_for_selector('#mainScreen:not([hidden])', timeout=10000)
        ctx.set_offline(True)
        page.reload()
        page.wait_for_selector('#mainScreen:not([hidden])', timeout=15000)
        check('app opens offline', page.is_visible('#fabNew'))
        check('features kept offline', len(page.evaluate('window.__fgm.features')) == 8)
        check('offline maps kept offline', len(page.evaluate('window.__fgm.savedAreas')) == 2)
        check('imported images kept offline', len(page.evaluate('window.__fgm.userImagery')) == 3)
        page.wait_for_function(f"window.__fgm.vectors.admin === {len(cat['regions'])}", timeout=15000)
        check('roads/rivers + admin loaded offline', page.evaluate('window.__fgm.vectors.osm') == len(cat['regions']))
        page.wait_for_function('window.__fgm.mapData.total > 0', timeout=15000)
        check('map data still complete offline', page.evaluate('window.__fgm.mapData.done'), json.dumps(page.evaluate('window.__fgm.mapData')))
        rgb = wait_imagery(page, MONAPO, 13)
        check('satellite drawn offline at Monapo', not_plain(rgb), str(rgb))
        shot(page, '11c_offline_monapo')
        rgb = wait_imagery(page, MONAPO2, 13)
        check('satellite drawn offline away from Monapo town', not_plain(rgb), str(rgb))
        shot(page, '11d_offline_monapo2')
        page.evaluate("(c) => window.__fgm.map.centerOn(c, 17)", page.evaluate('window.__fgm.userImagery')[0]['center'])
        page.wait_for_timeout(2000)
        check('imported image drawn offline', magenta(page.evaluate(CENTER_RGB)), str(page.evaluate(CENTER_RGB)))
        shot(page, '11b_offline_image')
        page.evaluate("(c) => window.__fgm.map.centerOn(c, 16)", MALEMA)
        page.wait_for_timeout(1500)
        shot(page, '11a_offline_osm')
        page.click('#btnLayers')
        page.click('.offmap-save')
        page.wait_for_timeout(300)
        # Playwright の is_visible は、閉じたばかりの <dialog> の影響か False を返すことがあるので、DOM で確かめる
        shown = page.evaluate("() => { const e = document.getElementById('toast'); return !e.hidden && e.getBoundingClientRect().height > 0 ? e.textContent : ''; }")
        check('saving offline is refused politely', len(page.evaluate('window.__fgm.savedAreas')) == 2 and bool(shown), shown)
        move(ctx, 300, 300, acc=5)
        page.wait_for_timeout(400)
        page.click('#fabNew')
        page.click('#newKinds [data-kind="point"]')
        page.click('#btnRecMark')
        page.click('#btnRecFinish')
        page.fill('#fName', 'offline point')
        page.click('#saveOk')
        page.wait_for_selector('#detailSheet:not([hidden])')
        check('saved offline', len(page.evaluate('window.__fgm.features')) == 9)
        page.locator('#detailSheet [data-close]').click()
        page.click('#btnMenu')
        page.wait_for_selector('#menuDialog[open]')
        page.wait_for_timeout(1000)
        check('menu says ready offline', 'ok' in (page.get_attribute('#stOffline', 'class') or ''), page.inner_text('#stOffline'))
        check('menu says map data ready offline', 'ok' in (page.get_attribute('#stSat', 'class') or ''), page.inner_text('#stSat'))
        shot(page, '11_offline_menu')
        close_dialog(page, '#menuDialog')
        ctx.set_offline(False)

        # 保存した地図の削除(衛星写真は消さない)
        for left in (1, 0):
            page.click('#btnLayers')
            page.wait_for_selector('.offmap-del')
            page.locator('.offmap-del').first.click()
            page.wait_for_selector('#confirmDialog[open]')
            page.click('#confirmYes')
            page.wait_for_function(f'window.__fgm.savedAreas.length === {left}', timeout=10000)
            page.wait_for_timeout(500)
        check('offline maps deleted', True)
        check('satellite kept after deleting the maps', page.evaluate(CACHE_STATS)['webp'] == n_tiles, str(page.evaluate(CACHE_STATS)))
        check('records untouched by map delete', len(page.evaluate('window.__fgm.features')) == 9)
        for left in (2, 1, 0):
            page.click('#btnLayers')
            page.wait_for_selector('.offimg-list .offmap-del')
            page.locator('.offimg-list .offmap-del').first.click()
            page.wait_for_selector('#confirmDialog[open]')
            page.click('#confirmYes')
            page.wait_for_function(f'window.__fgm.userImagery.length === {left}', timeout=10000)
        page.wait_for_timeout(300)
        check('image pieces removed with the images', page.evaluate(IMG_CHUNKS) == 0, str(page.evaluate(IMG_CHUNKS)))

        errs = real_errors(errors)
        check('no JS errors', not errs, '\n'.join(errs[:5]))
        demo_features = json.dumps(page.evaluate("JSON.parse(localStorage.getItem('fgm.demo.features'))"))
        ctx.close()

        # ---------------------------------------------------- Background Fetch の道(Android の Chrome と同じ)
        print('[12] Background Fetch で取り込み')
        bg = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
                                 permissions=['geolocation'], geolocation={'latitude': MONAPO['lat'], 'longitude': MONAPO['lng'], 'accuracy': 5},
                                 locale='ja-JP')
        bg.add_init_script("localStorage.setItem('fgm.helpSeen', '1');")
        pg = bg.new_page()
        berr = watch_errors(pg)
        REQUESTS.clear()
        pg.goto(URL + '?demo')
        pg.wait_for_selector('#mainScreen:not([hidden])', timeout=15000)
        check('browser has Background Fetch', pg.evaluate("'BackgroundFetchManager' in self"))
        pg.wait_for_function("window.__fgm.mapData.mode !== null || window.__fgm.mapData.done", timeout=30000)
        md = pg.evaluate('window.__fgm.mapData')
        check('download handed to Background Fetch', md['mode'] == 'background', json.dumps(md))
        pg.wait_for_timeout(500)
        shot(pg, '12a_bg_busy')
        sec = wait_map_done(pg)
        md = pg.evaluate('window.__fgm.mapData')
        check('background: map data done', md['done'] and md['have'] == md['total'] == n_bytes and not md['error'], f'{json.dumps(md)} {sec:.0f}s')
        cs = pg.evaluate(CACHE_STATS)
        check('background: all tiles unpacked by sw.js', cs['webp'] == n_tiles, f"{cs['webp']} / {n_tiles}")
        check('background: every pack marked done', cs['done'] == n_packs and cs['json'] == n_json, json.dumps(cs))
        packs_asked = [r for r in REQUESTS if r.endswith('.bin')]
        check('background: each pack downloaded once', len(packs_asked) == n_packs and len(set(packs_asked)) == n_packs, str(len(packs_asked)))
        pg.wait_for_function(f"window.__fgm.vectors.admin === {len(cat['regions'])}", timeout=15000)
        rgb = wait_imagery(pg, MONAPO, 13)
        check('background: satellite drawn at Monapo', not_plain(rgb), str(rgb))
        bg.set_offline(True)
        pg.reload()
        pg.wait_for_selector('#mainScreen:not([hidden])', timeout=15000)
        check('background: app opens offline', pg.is_visible('#fabNew'))
        rgb = wait_imagery(pg, MONAPO, 13)
        check('background: satellite offline at Monapo', not_plain(rgb), str(rgb))
        shot(pg, '12b_bg_offline_monapo')
        rgb = wait_imagery(pg, MONAPO2, 13)
        check('background: satellite offline away from Monapo town', not_plain(rgb), str(rgb))
        shot(pg, '12c_bg_offline_monapo2')
        pg.evaluate('([c, z]) => window.__fgm.map.centerOn(c, z)', [MONAPO, 11])
        pg.wait_for_timeout(1500)
        shot(pg, '12d_bg_offline_monapo_z11')
        errs = real_errors(berr)
        check('background: no JS errors', not errs, '\n'.join(errs[:5]))
        bg.close()

        # ---------------------------------------------------- 途中で切れたら続きから(足りない束だけ)
        print('[13] 取り込みの続き')
        rs = browser.new_context(viewport={'width': 390, 'height': 844}, locale='en-US',
                                 permissions=['geolocation'], geolocation={'latitude': MALEMA['lat'], 'longitude': MALEMA['lng'], 'accuracy': 5})
        rs.add_init_script('delete window.BackgroundFetchManager;')
        rs.add_init_script("localStorage.setItem('fgm.helpSeen', '1'); localStorage.setItem('fgm.view', JSON.stringify({lat: %s, lng: %s, zoom: 14}));" % (MALEMA['lat'], MALEMA['lng']))
        # 束を1つだけ落とす。地図は範囲の外(Malema)を表示しているので、表示のための 1 枚ずつの取り寄せとも重ならない
        mal = cat['regions'][0]
        victim = mal['packs'][len(mal['packs']) // 2]
        victim_name = victim['file'].split('/')[-1]
        rs.route('**/' + victim_name, lambda route: route.abort())
        pr = rs.new_page()
        rerr = watch_errors(pr)
        pr.goto(URL + '?demo')
        pr.wait_for_selector('#mainScreen:not([hidden])', timeout=15000)
        pr.wait_for_function("(() => { const d = window.__fgm.mapData; return d.total > 0 && !d.running && (d.done || !!d.error); })()", timeout=900000, polling=1000)
        md = pr.evaluate('window.__fgm.mapData')
        check('cut download: not done, error kept', not md['done'] and md['error'] and md['have'] == n_bytes - victim['bytes'], json.dumps(md))
        cs = pr.evaluate(CACHE_STATS)
        check('cut download: other packs kept', cs['done'] == n_packs - 1 and cs['webp'] == n_tiles - victim['tiles'], json.dumps(cs))
        pr.click('#btnLayers')
        pr.wait_for_selector('dialog[open] .mapdata-go')
        check('layers dialog offers retry', pr.is_visible('dialog[open] .mapdata-go'), pr.inner_text('dialog[open] .mapdata-state'))
        shot(pr, '13a_partial')
        pr.keyboard.press('Escape')
        rs.unroute('**/' + victim_name)
        REQUESTS.clear()
        pr.reload()   # 次にアプリを開いたとき、自動で続きから
        pr.wait_for_selector('#mainScreen:not([hidden])', timeout=15000)
        wait_map_done(pr)
        md = pr.evaluate('window.__fgm.mapData')
        packs_asked = [r for r in REQUESTS if r.endswith('.bin')]
        json_asked = [r for r in REQUESTS if r.endswith('.json') and not r.endswith('catalog.json')]
        check('resume: only the missing pack downloaded', packs_asked == ['/field-gps-imagery/' + mal['tiles'] + victim['file']], str(packs_asked))
        check('resume: roads/admin not downloaded again', not json_asked, str(json_asked))
        cs = pr.evaluate(CACHE_STATS)
        check('resume: complete', md['done'] and cs['done'] == n_packs and cs['webp'] == n_tiles, f'{json.dumps(md)} {json.dumps(cs)}')
        # 目録から外れた範囲(10/27 に外した Malema など)のデータは、次に開いたとき端末から消える
        pr.evaluate("""async () => { const c = await caches.open('fgm-s2-v1'); const r = location.origin + '/field-gps-imagery/';
            await c.put(r + 'malema/14/9999/9999.webp', new Response('x')); await c.put(r + 'malema/packs/p0-x.bin.done', new Response('1'));
            await c.put(r + 'malema/osm.json?v=old', new Response('{}')); await c.put(r + 'monapo/osm.json?v=old', new Response('{}')); }""")
        pr.reload()
        pr.wait_for_selector('#mainScreen:not([hidden])', timeout=15000)
        for _ in range(40):   # 掃除は起動の少しあと(取り込みの確認と一緒)に走る
            pr.wait_for_timeout(500)
            stale = pr.evaluate("""async () => (await (await caches.open('fgm-s2-v1')).keys()).map((q) => q.url).filter((u) => u.includes('/malema/') || u.includes('?v=old'))""")
            if not stale:
                break
        check('prune: data outside the catalog removed', not stale, str(stale))
        cs = pr.evaluate(CACHE_STATS)
        check('prune: Monapo data kept', cs['done'] == n_packs and cs['webp'] == n_tiles and cs['json'] == n_json, json.dumps(cs))
        errs = real_errors(rerr, allow=(victim_name, 'ERR_FAILED'))
        check('resume: no JS errors', not errs, '\n'.join(errs[:5]))
        rs.close()

        # ---------------------------------------------------- PC 幅
        print('[14] PC 幅')
        pc = browser.new_context(viewport={'width': 1366, 'height': 800}, permissions=['geolocation'],
                                 geolocation={'latitude': REF[0], 'longitude': REF[1], 'accuracy': 6}, locale='ja-JP')
        pc.add_init_script('delete window.BackgroundFetchManager;')
        pg = pc.new_page()
        perr = watch_errors(pg)
        pg.goto(URL + '?demo')
        pg.evaluate("""(data) => { localStorage.setItem('fgm.demo.features', data); localStorage.setItem('fgm.helpSeen','1'); }""",
                    demo_features)
        pg.goto(URL + '?demo')
        pg.wait_for_selector('#mainScreen:not([hidden])', timeout=15000)
        check('canvas map on PC', pg.is_visible('#mapSimple canvas'))
        check('Japanese by locale', pg.inner_text('#fabNew').strip() == '新しく記録', pg.inner_text('#fabNew'))
        pg.click('#btnList')
        pg.locator('#listItems li').first.click()
        pg.wait_for_timeout(2500)
        check('zoom buttons on PC', pg.is_visible('#btnZoomIn'))
        shot(pg, '14_pc')
        errs = real_errors(perr)
        check('no JS errors on PC', not errs, '\n'.join(errs[:3]))
        pc.close()

        browser.close()
    httpd.shutdown()
    print(f'\ne2e: {ok} passed, {ng} failed')
    sys.exit(1 if ng else 0)


if __name__ == '__main__':
    main()
