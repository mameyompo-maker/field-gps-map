# field_gps_map — 圏外で圃場の境界・地点を記録し、Google マップで共有するアプリ

スマホのブラウザで開く Web アプリ(PWA)。インストール不要。

**URL: https://mameyompo-maker.github.io/field-gps-map/** (練習用は末尾に `?demo`)

- **圏外で動く。** 一度開けば、電波がなくても起動・記録・一覧・書き出しができる。
  記録は端末に保存され、電波が戻ると自動で会社の Firebase に送られる。
- **Google マップの上で見る。** 電波があるときは Google マップ(航空写真)に重ねて表示する。
  圏外では Google の地図は出ない(利用規約で地図のキャッシュが禁止されている)ため、
  自動で「簡易地図」(写真なし・方眼・縮尺つき)に切り替わる。記録の線と自分の位置はどちらでも出る。
- **圏外用の地図を先に保存できる(v1.3.0〜)。** 電波のある所で、地図ボタン →
  「この辺りを保存」(10 km 四方・家まで)か「広い範囲を保存」(半径 100 km・道と川と集落名)。
  Malema〜Ribáue 周辺では **衛星写真(Sentinel-2、1画素 10 m)** も一緒に保存し、圏外の簡易地図に描く(v1.4.0)。
  しくみは下の「圏外用の地図」。
- **共有しやすい。** 記録ごとに「Google マップで開く」「文章で共有(WhatsApp 等)」「KML を送る」。
  全体は KML / GeoJSON / CSV / ZIP で書き出せる。KML は Google Earth・Google マイマップ・QGIS でそのまま開ける。
- **畑の写真を付けられる。** 1件に 10 枚まで。端末で縮小(長辺 1280px)してから保存するので軽い。
  圏外で撮った写真も、記録と同じく電波が戻ると自動で送られる。
- 画面はポルトガル語・英語・日本語(端末の言語で自動、メニューの「言語」から切替可)。
- **機能は絞ってある(v1.2.0〜)。** メニューは「書き出し・読み込み・言語・使い方・ログアウト」の5つだけ。
  設定の画面は無い(地図の種類は地図右上のボタン、言語はメニュー)。一覧は検索とグループの絞り込みだけ。
- **自動で更新される。** 新しい版を公開すると、開いている端末が自動で入れ替わる(記録中は記録が終わるまで待つ)。
  メニューに「圏外で使えるか」「未送信が何件あるか」「最後にサーバーとつながった時刻」を表示する。

## 記録のしかた

「新しく記録」→ 種類(区画・線・地点)を選ぶと、すぐ記録が始まる(方式を選ぶ画面は無い)。

| 方式(記録画面の切り替えボタン) | 使いどころ |
|---|---|
| 歩いて(GPS)— 最初はこちら | 境界を歩き、角に来たら大きな緑のボタン「ここを角に」を押す。押した瞬間の位置で1点(待ち時間なし)。歩くだけでは点は増えない。1つの畑で 10 点以内が目安 |
| 地図をタップ | 立ち入れない場所。電波のあるときに航空写真を見ながら。記録の途中で何度でも切り替えられる |

- 同じ場所で4秒以内に2度押した分は無視する(押し間違い対策)。
- 押したときの GPS の誤差が ±10 m を超えると、振動と表示で知らせる。「取り消し」で戻せる。
- 点が 12 を超えると「点が多すぎます」と知らせる。
- 歩いた点とタップした点が混ざったときだけ、保存の画面で「○点は地図のタップです」と出す。
- 位置情報が使えない端末では、自動で「地図をタップ」で始まる。

記録中は画面が消えないようにし(Wake Lock)、途中経過は端末に自動保存する。
アプリが落ちても、次に開いたとき続きから再開できる。

### できないこと

- **アプリを閉じたままの送信はできない。** 圏外で記録したものは、電波のある場所でアプリを一度開くと送られる
  (送信の待ち行列を Firestore の仕組みが持っていて、アプリが開いているときしか動かないため)。

## 圏外用の地図(v1.3.0〜v1.4.0)

**しくみ。** OsmAnd・Organic Maps などのオフライン地図アプリと同じ考え方を小さく真似ている。
地図の「絵」(タイル画像)を保存するのではなく、OpenStreetMap の「データ」(道や建物の線と形)を地域ごとに
端末へ入れておき、端末の中で絵を描く。

1. 「この辺りの地図を保存」を押すと、Overpass API(OpenStreetMap の検索窓口。本家 → 予備 → 本家の順に、各 90 秒まで待つ)に
   「この四角の中の道・川・池・建物・地名」を1回だけ尋ねる(`docs/lib/offline-map.js`)。
2. 答えを描画用の軽い形に詰め直し(座標は小数5桁 ≒ 1 m)、IndexedDB `fgm-offline-map` に保存する。
   **この端末の中だけ。** 会社の Firebase には送らない。何か所でも保存でき、地図ボタンの一覧から移動・削除できる。
3. 簡易地図(`docs/lib/map-simple.js`)が、方眼の上に描く。建物は寄ったときだけ、小道は寄ったときだけ描く。
   出典「© OpenStreetMap contributors」を縮尺の下に出す(ODbL の条件)。

Malema の町を中心にした 10 km 四方で、約 1.2 万件(建物 11,906・道 195・川 14・地名 1)。
取り込みは Wi-Fi で 30 秒〜1 分ほど、答えは約 7.6 MB(保存すると小さくなる)。2026-10-22 に実測。

**2段構え(v1.4.0、Kazさん「半径 100 km にできないか」)。**
半径 100 km(200 km 四方)には建物が約 33 万件あり(10/22 実測)、窓口にも端末にも重すぎる。そこで
「この辺り」(10 km 四方・建物まで)と「広い範囲」(200 km 四方・道 6,093・川 516・集落名 90、答え約 15 MB、約 40 秒)に分けた。

**衛星写真(v1.4.0)。** Google・Mapbox・Esri の衛星写真は保存できないので、EU の Copernicus 計画の
Sentinel-2(無料・商用可、出典「Contains modified Copernicus Sentinel data 2026」)を使う。
`tools/s2_tiles.py` が雲のない画像(2026年8〜10月)をつないでタイル(WebP、ズーム 8〜14)に切り、
別リポジトリ [field-gps-imagery](https://github.com/mameyompo-maker/field-gps-imagery) の GitHub Pages で配る。
**v1.7.0 から最初から入る(Kazさん「デフォルトから入れておいてほしい」)。** 電波のあるときに、起動の5秒後と電波が戻ったときに、
範囲全体(Malema〜Ribáue 200 km 四方、9,910 枚・約 60 MB)を裏で Cache Storage `fgm-s2-v1` に入れる(`syncAll`、`docs/lib/imagery.js`)。
粗いズーム(8〜12)を先に、細かいズーム(13・14)は今いる場所に近い順。途中で電波が切れたら次に続きから。
全部入ると index.json の撮影日・枚数を `localStorage fgm.s2.done` に覚え、画像を作り直したときだけ取り直す。
メニューの状態に「衛星写真:○枚 入っています/取り込み中」を出す。地図を消しても衛星写真は消さない。
1画素 10 m なので、1 ha の畑は 10×10 画素ほど。道・川・畑のかたまりは見えるが、細かい境界は見えない。

**Google などの衛星写真を保存しない理由。**
- Google:地図・衛星写真の先読み・キャッシュ・オフライン利用は利用規約で禁止。
- Esri World Imagery:オフラインの書き出しは ArcGIS の有料契約と ArcGIS 製アプリが前提。
- EOX Sentinel-2 cloudless:商用は有償ライセンス。
- OpenStreetMap のデータは ODbL で、出典を示せば商用でも保存・利用できる。だからこれを使う。

## 手持ちの空撮・衛星写真ファイルの取り込み(v1.6.0)

Kazさん(10/22)「Web アプリでできるだけ衛星画像を読み込めるように。ファイルを作って読み込ませるなど」。
地図ボタン →「ファイルを取り込む(GeoTIFF・KMZ)」。取り込んだ画像は端末の IndexedDB(`fgm-user-imagery`)に残り、
圏外でも簡易地図に表示される(Sentinel-2 の上、道や記録の下)。

- 対応する形式
  - GeoTIFF:座標系は 緯度経度(EPSG:4326 など)・Web メルカトル(3857)・UTM(WGS84 の 326xx/327xx、Moznet UTM 36S/37S = 3036/3037)。
    8 ビット RGB(透明の帯・nodata 可)、16 ビット(2〜98% で明るさを自動調整)。圧縮は deflate・LZW・JPEG など geotiff.js が読めるもの。
  - KMZ/KML の GroundOverlay(画像は KMZ の中に入っていること。回転・LatLonQuad も可。複数の画像も可)
- 大きな画像は長辺 10,240 px までに縮めて取り込む(例:5 cm の空撮 600 m 四方 → 約 6 cm)。
  512 px の小片に切り、粗さの違う段を作って保存する。PC で 320 MB・12,000×10,000 px の GeoTIFF が約 40 秒、保存は約 24 MB。
- 使ってよい画像:自分たちのドローンの空撮、購入した衛星写真、Sentinel-2 などの公開データ。
  **Google・Esri の画像を保存したものは規約で使えない**(画面にも注意書きを出している)。
- 座標系が分からない GeoTIFF は、QGIS で EPSG:4326 か UTM(WGS 84)にして書き出してもらう(エラー文で案内する)。
- 試験用の画像は `python tests/make_imagery_fixtures.py` で作る(rasterio を使わず TIFF を自前で書く。この PC では
  rasterio の DLL がアプリ制御で止められるようになった ― 10/22 確認。tools/s2_tiles.py もこのままでは動かない)。
- geotiff.js 2.1.3(MIT)を `docs/vendor/geotiff.js` に置いた(取り込むときだけ読み込む。Service Worker で圏外でも使える)。

## 誰が使えるか

- Google アカウントでログイン。**field_visit_map と同じ許可リスト**(Firestore の `allowedUsers/{メールアドレス小文字}`、`active: true`)を使う。
  リストへの追加は Firebase Console から(field_visit_map の SETUP.md と同じ手順)。
- **試用モード**:URL の末尾に `?demo` を付けると、ログインなしで動く。記録はその端末の中だけに残り、送信されない。研修・練習用。

## 管理者:チームの集計(v1.5.0)

- 許可リストの行に **`admin: true`(boolean)** を足した人だけ、メニューに「チームの集計(管理者)」が出る
  (Firebase Console → Firestore → `allowedUsers` → その人のメールアドレスの行 → フィールドを追加)。次にアプリを開いたときから出る。
  試用モードでは誰でも出る(練習用)。
- 中身:期間(今日・昨日・7日間・30日間・全部・日付指定)ごとの合計(件数・面積 ha・線の長さ・写真・人数)、
  人ごと(件数・面積・最初と最後の時刻)、日ごと(タップでその日へ)、その期間の記録の一覧(タップで詳細)。
- 書き出し:その期間の記録の Excel(CSV。1行1件、`recorded_date`・`recorded_time`・`recorded_by` 付き)、
  集計の Excel(人ごと+合計+日ごと)、KML。
- 別の記録帳は作っていない。記録そのものに「誰が(createdBy)・いつ(端末の時刻 clientCreatedAt、サーバーの時刻 createdAt)」が入っている。
  日付は端末の時刻帯で分ける。圏外で記録して後で送ったものも、記録した時刻で数える。
- `admin` は画面に出すかどうかだけの印。記録はもともと許可された全員が読めるので、ルールは変えていない。

## 構成

- `docs/` … アプリ本体(GitHub Pages で公開する。ビルド不要の ES modules)
  - `app.js` 画面全体 / `lib/` 計算・GPS・記録・地図・保存・書き出し・翻訳
  - `config.js` Firebase と Google Maps のキー(field_visit_map と同じプロジェクト `kazdr-field-visit-map`)
  - `sw.js` オフライン用のキャッシュ。**docs/ を変えたら必ず `CACHE` の版数を上げる**
- `firestore.rules` … field_visit_map のルールに `gpsFeatures` の項を足したもの。
  **Firebase プロジェクトを共有しているため、`../field_visit_map/firestore.rules` と常に同じ内容にする。**
- `tests/fixtures/overpass_malema.json`・`overpass_wide_malema.json` … Overpass の本物の答え(Malema の 10 km 四方と半径 100 km、試験用。小さく詰め直してある)
- `tools/s2_tiles.py` … 衛星写真のタイルを作る(出力は `../field_gps_imagery/docs/s2/`)
- `tests/` … `node tests/test_geo.mjs`(面積・距離)、`node tests/test_i18n.mjs`(翻訳の抜け)、
  `python tests/e2e_demo.py --shots`(Edge で歩行・写真・3言語・圏外・圏外用の地図・衛星写真・画像ファイルの取り込み・管理者の集計を模擬した通し試験。152項目)、
  `python tests/check_production.py --shots`(本番URLの確認)

## データの形(Firestore `gpsFeatures`)

`kind`(polygon/line/point)、`name`、`category`、`group`、`notes`、`vertices[{lat,lng,acc,t,src}]`、
`areaM2`、`lengthM`、`center`、`accMedian`、`accMax`、`method`、`createdBy/updatedBy{uid,email,name}`、
`createdAt/updatedAt`、`archived`(削除はアーカイブのみ)、`photoCount`、`cover`(一覧用の小さな写真)。

写真はサブコレクション `gpsFeatures/{id}/photos/{photoId}`:`data`(JPEG の data URL、1 MiB 未満)、
`thumb`、`w`、`h`、`takenAt`、`uploadedBy`、`archived`(外すのはフラグだけ)。
Cloud Storage を使わないのは、圏外での送信待ちを Firestore にまとめるため。
