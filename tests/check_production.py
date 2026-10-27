"""本番(GitHub Pages)の確認。試用モードで開き、地図(自前の衛星写真)が出るか・JS エラーが無いかを見る。
v2.0.0 から Google マップは使わない。地図データは field-gps-imagery/catalog.json から自動で取り込み始める。

  python tests/check_production.py [--shots]
"""
import sys
from playwright.sync_api import sync_playwright

URL = 'https://mameyompo-maker.github.io/field-gps-map/'
shots = '--shots' in sys.argv
ok = True


def check(name, cond, info=''):
    global ok
    print(('  OK  ' if cond else '  NG  ') + name, info)
    ok = ok and bool(cond)


with sync_playwright() as p:
    b = p.chromium.launch(channel='msedge')
    for label, vp, mobile in [('PC', {'width': 1366, 'height': 800}, False), ('phone', {'width': 390, 'height': 844}, True)]:
        print(f'[{label}]')
        ctx = b.new_context(viewport=vp, is_mobile=mobile, has_touch=mobile, locale='pt-PT',
                            geolocation={'latitude': -14.8073, 'longitude': 38.3228, 'accuracy': 5},
                            permissions=['geolocation'])
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(URL + '?demo', wait_until='load')
        page.wait_for_function('window.__fgm && window.__fgm.map', timeout=30000)
        page.wait_for_timeout(6000)
        check('canvas map shown', page.is_visible('#mapSimple canvas'))
        check('no Google map left', page.locator('#mapGoogle').count() == 0)
        md = page.evaluate('window.__fgm.mapData')
        check('map data catalog found (download started or done)', md['total'] > 0 and (md['running'] or md['done']), md)
        check('no JS errors', not errors, errors[:3])
        sw = page.evaluate('navigator.serviceWorker.getRegistration().then(r => !!r)')
        check('service worker registered', sw)
        check('version 2.0.1', page.evaluate('window.__fgm.version') == '2.0.1', page.evaluate('window.__fgm.version'))
        if shots:
            page.screenshot(path=f'tests/shots/prod_{label}.png')
        ctx.close()

    # ログイン画面(試用モードなし)が出るか
    print('[login]')
    ctx = b.new_context(locale='ja-JP')
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL, wait_until='load')
    page.wait_for_timeout(4000)
    check('login screen shown', page.locator('#loginScreen').is_visible())
    check('login has 3 languages', page.locator('#loginScreen [data-lang]').count() == 3)
    check('no JS errors', not errors, errors[:3])
    if shots:
        page.screenshot(path='tests/shots/prod_login.png')
    b.close()

print('\nproduction:', 'ALL OK' if ok else 'PROBLEMS')
sys.exit(0 if ok else 1)
