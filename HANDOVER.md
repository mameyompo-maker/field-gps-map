# HANDOVER — field_gps_map(2026-10-22)

## 目的

Kazさんの依頼(10/21):2つのレポート(offline_gps_report.pdf / company_field_data_report.pdf)を踏まえ、
「オフラインで動いて Google マップを使い、共有しやすいサービス」を作る。JatLog・field_visit_map の経験を流用してよい。

## 今の状態(2026-10-22 v1.7.0 公開)

- 公開URL: https://mameyompo-maker.github.io/field-gps-map/ (試用は末尾に `?demo`)
- リポジトリ: https://github.com/mameyompo-maker/field-gps-map (public、Pages = main / docs)
- v1.0.0(同日の初版)からの変更(Kazさんの追加依頼、同日):
  1. 記録方式を「歩いて角を追加」に。角でボタンを押すと即1点(平均の待ちなし)。歩くだけでは点が増えない。
     1つの畑で 10 点以内が目安(Kazさん)。旧「外周を歩く」「角ごとに5秒平均」は廃止。「地図をタップ」は残す(Kazさん)。
  2. 畑の写真(1件 10 枚まで、端末で縮小して Firestore のサブコレクション `photos` へ)。
  3. 言語を ポルトガル語・英語・日本語 の3つに。
  4. 見た目を my_clothes に寄せた(白基調・角丸 20px・丸いボタン・押した感触・ダークモード)。
  5. JatLog にならった自動更新と圏外対応の強化(定期的な更新確認、記録中は更新を待つ、
     メニューに圏外の準備・未送信件数・最終同期を表示、手動の「更新を確認」)。
- v1.2.0(同日、Kazさん「一番シンプルで速く、洗練された UI/UX に。使いたい機能をそのまま使えるように見直して」):
  - 方式を選ぶ画面を廃止。種類を選ぶと即記録。「地図をタップ」は記録画面の切り替えボタン(途中で行き来できる)。
  - メニュー 9→5 項目(一覧・今すぐ送信・設定・更新確認を外す。更新確認は版数の行を押す)。設定の画面は削除。
  - 一覧は検索+グループのチップだけ。詳細のボタンは4つ(Google マップ・共有・KML・編集)、表示も絞った。
  - 保存の分類は図形に合うものだけ(区画5・線4・地点4)。線の既定は「生垣」。
  - 書き出しは KML・Excel(CSV)・ZIP(GeoJSON と写真入り)の3つ。export.js は使うときだけ読み込む。
  - スマホでは地図の +/− を出さない(ピンチで操作)。
- v1.3.0(10/22、Kazさん「圏外だときつい。先にこの辺の地図を読み込めないか。他のオフライン地図の仕組みを取り入れて」):
  - 地図ボタン →「この辺りの地図を保存(10 km 四方)」。OpenStreetMap の道・川・池・建物・地名を Overpass API で取り込み、
    端末の IndexedDB に保存して簡易地図に描く(OsmAnd・Organic Maps と同じ「データを入れて端末で描く」方式)。
  - 新しいファイル `docs/lib/offline-map.js`。描画は `docs/lib/map-simple.js` の paintBasemap。メニューに保存数を表示。
  - 衛星写真は保存しない(Google は規約で禁止、Esri は ArcGIS の有料契約、EOX は商用有償)。理由は README に。
  - 試験用に Overpass の本物の答え(Malema)を `tests/fixtures/overpass_malema.json` に置いた。通し試験 106/106。
- v1.4.0(10/22、Kazさん「半径 100 km にできないか」「衛星写真をどうにか使いたい」→ 2段構え+Sentinel-2 で決定):
  - 地図ボタンに2つ:「この辺りを保存」(10 km 四方・建物まで)と「広い範囲を保存」(200 km 四方・道/川/池/集落名)。
    200 km 四方の建物は約 33 万件で重すぎるため入れない(実測)。
  - 衛星写真:Sentinel-2(1画素 10 m、無料・商用可、出典表示)。`tools/s2_tiles.py` で Malema〜Ribáue を中心に
    200 km 四方を作り、別リポジトリ field-gps-imagery(Pages)で配る。保存時に Cache Storage `fgm-s2-v1` へ。
    簡易地図の一番下に描く(衛星写真の上では方眼・池の塗り・建物の塗りを省く)。
  - sw.js の掃除は `field-gps-map-` で始まるキャッシュだけ消すように変えた(衛星写真を消さないため)。
  - 範囲を広げるときは s2_tiles.py の CENTER/HALF_KM を変えて作り直し、imagery リポジトリへ push(アプリは変更不要)。
- 衛星写真の方針(10/22、Kazさん決定):
  - Esri World Imagery は Malema で 0.5 m(2024-09-19 WorldView-2)、Ribáue で 0.46 m(2022-10-21 GeoEye-1)。畑の境界まで見える。
    比較ページ `tools/imagery_compare.html`(Esri と Sentinel-2 を並べる。Mapbox はトークンを入れると3つ目に出る)。
  - Esri を圏外で使えるのは ArcGIS Maps SDK で作ったネイティブアプリだけ(Web アプリには保存できない)。
    → 方針:**Android アプリ(ArcGIS Maps SDK)を作る**。最初の一歩は Kazさんが ArcGIS Location Platform の
      開発者アカウントを作り、書き出し(export tiles)が無料枠で使えるか確かめること。そのあと小さな試作。
  - それまでの間は Web アプリで:v1.6.0 で手持ちの画像ファイル(GeoTIFF・KMZ)を取り込めるようにした。
- v1.7.0(10/22、Kazさん「Sentinel-2 はデフォルトから入れておいてほしい」):電波のあるときに範囲全体(9,910 枚・約 60 MB)を
  裏で自動取り込み(起動5秒後・電波が戻ったとき。続きから再開、済みは localStorage `fgm.s2.done`)。メニューに状態の行。地図削除で衛星写真を消さない。
- v1.6.0(10/22、Kazさん「いったん Web アプリでできるだけ衛星画像を読み込めるように。ファイルを作って読み込ませるなど」):
  - 地図ボタン →「ファイルを取り込む(GeoTIFF・KMZ)」。`docs/lib/user-imagery.js`、geotiff.js を `docs/vendor/` に同梱。
    512px の小片+段(ピラミッド)にして IndexedDB `fgm-user-imagery` へ。簡易地図で Sentinel-2 の上に描く。詳細は README。
  - 試験用画像は `tests/make_imagery_fixtures.py`(この PC では rasterio がアプリ制御で動かなくなったため自前で TIFF を書く)。
    **tools/s2_tiles.py も rasterio を使うので、今は動かない**(Sentinel-2 の範囲を広げるときは別の方法が要る)。
- v1.5.0(10/22、Kazさん「今日の記録の合計や、まとめて書き出す管理者モードとデータが必要」):
  - メニュー「チームの集計(管理者)」:期間ごとの合計・人ごと・日ごと・記録一覧、期間の CSV/集計 CSV/KML。
    `docs/lib/admin-stats.js`。出すかどうかは `allowedUsers/{email}.admin === true`(auth.js が読んで端末に覚える)。試用モードでは常に出る。
  - 全体の CSV にも `recorded_date`・`recorded_time`(端末の時刻帯)・`updated_by`・`updated_at` を足した。
  - Kazさんの行への `admin: true` は Claude からは書けなかった(権限付与のため自動実行が止められた)→ Kazさんが Console で足す。
- Firestore ルール:`gpsFeatures/{id}/photos` を追加してデプロイ済み。field_visit_map/firestore.rules にも同じ内容を入れて push 済み。
- 試験:通し試験 94/94(`tests/e2e_demo.py`)、翻訳 205 キー×3言語の抜け・余りなし、ルールの試験 25/25。
- 途中で見つけて直したバグ:角のボタンで「直近 2.5 秒で精度が同じ測位」が並ぶと最も古い測位を使い、
  前の角のそばの位置が入っていた。基本は最新の測位を使うように直した(`docs/lib/gps.js` の bestRecentFix)。

## Kazさんにお願いすること(台帳 #11)

0. 現場に行く前に、電波のある所で「広い範囲を保存」を1回、作業場所ごとに「この辺りを保存」(Malema 2 の圃場・コミュニティ苗畑など)。
   圏外で道・川・家・衛星写真が見えるか、実機で確かめる(衛星写真は 10 m と粗い点も見てもらう)。
1. 実機(Android)で:Google でログイン → 「新しく記録」→「区画」→ 角を歩いてボタンで記録 → 写真を付ける → 機内モードで記録 →
   電波を戻してアプリを開き、メニューで「すべて送信済み」になるか。
2. 使う人のメールアドレスが allowedUsers に入っているか(field_visit_map と共通)。
3. 管理者にする人(まず Kazさん)の allowedUsers の行に `admin`(boolean)= true を足す(README「管理者」の節)。

## 次にやること(Claude 側)

- Esri アカウントの確認結果を受けて、Android 試作(ArcGIS Maps SDK for Kotlin)に入る。
- 実機テストの結果を受けて直す。docs/ を変えたら sw.js の CACHE 版数と app.js の VERSION を上げて push(= 即本番)。

## 判明した制約・決定事項

- Google の地図タイルは端末に保存しない(利用規約)。圏外は簡易地図+保存した OpenStreetMap で補う。
- Overpass は混むと 502 や無応答がある(10/22 の取得で本家 502・予備は3分無応答→再試行で成功)。アプリは本家→予備→本家、各90秒。
- Firestore の書き込みは await しない(圏外で保存ボタンが戻らなくなる)。写真も同じ。
- アプリを閉じたままの送信(Background Sync)はできない。Firestore SDK の送信待ちはページの中にあるため。
  圏外で記録したら、電波のある所でアプリを一度開いてもらう。
- 写真は Cloud Storage ではなく Firestore に入れる(圏外の送信待ちを1か所にまとめるため。1枚 1 MiB 未満)。
- docs/ を変えたら sw.js の `CACHE` 版数を上げる。push = 即本番。
- `firestore.rules` は field_visit_map と共有。片方だけデプロイすると、もう片方のアプリのルールが消える。
