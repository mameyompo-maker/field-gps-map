"""field_gps_map — 試用モードでの通し動作テスト(Playwright + システムの Microsoft Edge)。

    set PYTHONIOENCODING=utf-8
    python tests/e2e_demo.py            # docs/ を localhost:8765 で配信して試す
    python tests/e2e_demo.py --shots    # 画面写真も tests/shots/ に保存

GPS は Playwright の set_geolocation で動かす(角まで歩いてボタンを押す、を再現する)。
写真は tests/fixtures/ の jpg を使う。
本番の Firestore には一切つながない(試用モードは localStorage と IndexedDB だけ)。
"""
import functools
import http.server
import json
import math
import os
import sys
import threading
import xml.dom.minidom
import zipfile

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, 'docs')
SHOTS = os.path.join(ROOT, 'tests', 'shots')
PORT = 8765
URL = f'http://localhost:{PORT}/'
SAVE_SHOTS = '--shots' in sys.argv
PHOTO1 = os.path.join(ROOT, 'tests', 'fixtures', 'field_photo.jpg')
PHOTO2 = os.path.join(ROOT, 'tests', 'fixtures', 'field_photo2.jpg')
# 保存画面のカテゴリのチップの並び(lib/categories.js と同じ順)
CAT = {k: i for i, k in enumerate(['field', 'block', 'nursery', 'hedge', 'water', 'road', 'building', 'tree', 'other'])}

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


def serve():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=DOCS)
    handler.log_message = lambda *a: None
    httpd = http.server.ThreadingHTTPServer(('localhost', PORT), handler)
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


def main():
    httpd = serve()
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='msedge', headless=True)
        ctx = browser.new_context(
            viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
            permissions=['geolocation'], geolocation={'latitude': REF[0], 'longitude': REF[1], 'accuracy': 4},
            locale='pt-PT', accept_downloads=True)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'favicon' not in m.text else None)

        # 設定: 地図は簡易地図(タップの座標を計算しやすい)
        page.goto(URL + '?demo')
        page.evaluate("""() => { localStorage.setItem('fgm.settings', JSON.stringify({mapMode: 'simple', lang: 'pt'})); }""")
        page.goto(URL + '?demo')
        page.wait_for_selector('#mainScreen:not([hidden])', timeout=15000)
        print('[1] 起動')
        check('main screen shown', page.is_visible('#fabNew'))
        check('help dialog shown first time', page.locator('#helpDialog[open]').count() == 1)
        page.wait_for_timeout(200)
        check('help starts at the top', page.evaluate("document.querySelector('#helpDialog').scrollTop") == 0)
        check('version 1.1.1', page.evaluate('window.__fgm.version') == '1.1.1')
        shot(page, '01_help')
        close_help(page)
        page.wait_for_function("() => document.querySelector('#gpsText').textContent.includes('±')", timeout=10000)
        check('gps chip shows accuracy', '±4' in page.inner_text('#gpsText'), page.inner_text('#gpsText'))
        check('simple map active', page.evaluate('window.__fgm.mapType') == 'simple')
        shot(page, '02_main')

        # ---------------------------------------------------- 歩いて角を追加(100m × 100m = 1 ha)
        print('[2] 歩いて角を追加')
        page.click('#fabNew')
        page.click('#newKinds [data-kind="polygon"]')
        check('2 methods (corners, tap)', page.locator('#newMethods button').count() == 2)
        shot(page, '03_methods')
        page.locator('#newMethods button').nth(0).click()
        page.wait_for_selector('#recPanel:not([hidden])')
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
        page.locator('#newMethods button').nth(0).click()
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
        page.locator('#fCatChips button').nth(CAT['nursery']).click()
        check('category chip selected', 'on' in page.locator('#fCatChips button').nth(CAT['nursery']).get_attribute('class'))
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
        page.locator('#newMethods button').nth(0).click()
        page.click('#btnRecMark')
        check('point measured instantly', page.evaluate('window.__fgm.stats().n') == 1)
        page.click('#btnRecFinish')
        page.fill('#fName', 'Poço 1')
        page.locator('#fCatChips button').nth(CAT['water']).click()
        page.click('#saveOk')
        page.wait_for_selector('#detailSheet:not([hidden])')
        check('point detail shows coords', '-14.8' in page.inner_text('#dStats'), page.inner_text('#dStats'))
        page.locator('#detailSheet [data-close]').click()

        # ---------------------------------------------------- 地図をタップ(簡易地図)
        print('[5] 地図をタップ')
        page.click('#fabNew')
        page.click('#newKinds [data-kind="line"]')
        page.locator('#newMethods button').nth(1).click()
        box = page.locator('#simpleCanvas').bounding_box()
        for (dx, dy) in [(-80, -150), (0, -100), (80, -160)]:
            page.mouse.click(box['x'] + box['width'] / 2 + dx, box['y'] + box['height'] / 2 + dy)
            page.wait_for_timeout(150)
        st = page.evaluate('window.__fgm.stats()')
        check('3 tapped vertices', st['n'] == 3 and st['tapCount'] == 3, json.dumps(st))
        check('line length > 0', (st['lengthM'] or 0) > 1)
        page.click('#btnRecUndo')
        check('undo removes vertex', page.evaluate('window.__fgm.stats().n') == 2)
        page.click('#btnRecFinish')
        check('no tap warning when tap method was chosen', page.locator('#saveWarn').is_hidden())
        page.fill('#fName', 'Rio teste')
        page.click('#saveOk')
        page.wait_for_selector('#detailSheet:not([hidden])')
        page.locator('#detailSheet [data-close]').click()

        # ---------------------------------------------------- 途中で閉じても続きから
        print('[6] 下書きの復元')
        page.click('#fabNew')
        page.click('#newKinds [data-kind="polygon"]')
        page.locator('#newMethods button').nth(1).click()
        for (dx, dy) in [(-50, -200), (50, -200), (50, -120)]:
            page.mouse.click(box['x'] + box['width'] / 2 + dx, box['y'] + box['height'] / 2 + dy)
            page.wait_for_timeout(120)
        page.reload()
        page.wait_for_selector('#confirmDialog[open]', timeout=10000)
        check('resume prompt', 'pontos: 3' in page.inner_text('#confirmText'), page.inner_text('#confirmText'))
        page.click('#confirmYes')
        page.wait_for_selector('#recPanel:not([hidden])')
        check('draft restored', page.evaluate('window.__fgm.stats().n') == 3)
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
        page.select_option('#listGroup', 'Malema 2')
        n_m2 = len([f for f in page.evaluate('window.__fgm.features') if f.get('group') == 'Malema 2'])
        check('group filter', page.locator('#listItems li').count() == n_m2 and n_m2 >= 1, str(n_m2))
        page.select_option('#listGroup', '')
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
        with page.expect_download() as dl:
            page.click('#exportDialog [data-fmt="geojson"]')
        gj = json.load(open(dl.value.path(), encoding='utf-8'))
        check('GeoJSON 4 features', len(gj['features']) == 4)
        with page.expect_download(timeout=20000) as dl:
            page.click('#exportDialog [data-fmt="zip"]')
        zp = dl.value.path()
        check('ZIP downloaded', os.path.getsize(zp) > 500)
        with zipfile.ZipFile(zp) as z:
            jpgs = [n for n in z.namelist() if n.startswith('photos/') and n.endswith('.jpg')]
        check('ZIP has 2 photos', len(jpgs) == 2, str(jpgs))
        page.locator('#exportDialog [data-close]').click()

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
            return [w for w in ['rec.', 'list.', 'menu.', 'save.', 'set.', 'exp.', 'photo.', 'off.', 'upd.'] if (' ' + w) in body]

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
        shot(page, '10_menu_en')
        close_dialog(page, '#menuDialog')

        # ---------------------------------------------------- 横スクロールが出ないか
        sw = page.evaluate('document.documentElement.scrollWidth')
        check('no horizontal scroll at 390px', sw <= 390, str(sw))

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
        move(ctx, 300, 300, acc=5)
        page.wait_for_timeout(400)
        page.click('#fabNew')
        page.click('#newKinds [data-kind="point"]')
        page.locator('#newMethods button').nth(0).click()
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
        shot(page, '11_offline_menu')
        close_dialog(page, '#menuDialog')
        ctx.set_offline(False)

        real_errors = [e for e in errors if 'maps.googleapis' not in e and 'ERR_INTERNET_DISCONNECTED' not in e and 'Failed to load resource' not in e]
        check('no JS errors', not real_errors, '\n'.join(real_errors[:5]))

        # ---------------------------------------------------- PC 幅・Google マップ(電波あり)
        print('[12] PC 幅 + Google マップ')
        pc = browser.new_context(viewport={'width': 1366, 'height': 800}, permissions=['geolocation'],
                                 geolocation={'latitude': REF[0], 'longitude': REF[1], 'accuracy': 6}, locale='ja-JP')
        pg = pc.new_page()
        perr = []
        pg.on('pageerror', lambda e: perr.append(str(e)))
        pg.goto(URL + '?demo')
        pg.evaluate("""(data) => { localStorage.setItem('fgm.demo.features', data); localStorage.setItem('fgm.helpSeen','1'); }""",
                    json.dumps(page.evaluate("JSON.parse(localStorage.getItem('fgm.demo.features'))")))
        pg.goto(URL + '?demo')
        pg.wait_for_selector('#mainScreen:not([hidden])', timeout=15000)
        pg.wait_for_timeout(4000)
        # localhost では Maps キーの制限で Google が地図を拒否することがある。その場合は
        # エラー画面のまま残らず簡易地図に切り替わっていればよい(本番URLでの確認は tests/check_production.py)。
        mt = pg.evaluate('window.__fgm.mapType')
        check('map ready on PC (google, or simple after auth failure)', mt in ('google', 'simple'), str(mt))
        check('Japanese by locale', pg.inner_text('#fabNew').strip() == '新しく記録', pg.inner_text('#fabNew'))
        pg.click('#btnList')
        pg.locator('#listItems li').first.click()
        pg.wait_for_timeout(2500)
        shot(pg, '12_pc_google')
        check('no JS errors on PC', not perr, '\n'.join(perr[:3]))

        browser.close()
    httpd.shutdown()
    print(f'\ne2e: {ok} passed, {ng} failed')
    sys.exit(1 if ng else 0)


if __name__ == '__main__':
    main()
