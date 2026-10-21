# field_gps_map — 圏外で圃場の境界・地点を記録し、Google マップで共有するアプリ

スマホのブラウザで開く Web アプリ(PWA)。インストール不要。

**URL: https://mameyompo-maker.github.io/field-gps-map/** (練習用は末尾に `?demo`)

- **圏外で動く。** 一度開けば、電波がなくても起動・記録・一覧・書き出しができる。
  記録は端末に保存され、電波が戻ると自動で会社の Firebase に送られる。
- **Google マップの上で見る。** 電波があるときは Google マップ(航空写真)に重ねて表示する。
  圏外では Google の地図は出ない(利用規約で地図のキャッシュが禁止されている)ため、
  自動で「簡易地図」(写真なし・方眼・縮尺つき)に切り替わる。記録の線と自分の位置はどちらでも出る。
- **共有しやすい。** 記録ごとに「Google マップで開く」「文章で共有(WhatsApp 等)」「KML を送る」。
  全体は KML / GeoJSON / CSV / ZIP で書き出せる。KML は Google Earth・Google マイマップ・QGIS でそのまま開ける。
- 画面はポルトガル語と日本語(端末の言語で自動、メニューから切替可)。

## 記録のしかた(3通り+地点)

| 方法 | 使いどころ |
|---|---|
| 歩いて一周(自動) | 圃場の外周を歩く。3m ごと・精度 10m 以内の点だけ自動で打つ(設定で変更可) |
| 角ごとに記録 | 角に立って「この角を記録」。5秒間の GPS を精度で重み付けして平均する |
| 地図をタップ | 立ち入れない場所。電波のあるときに航空写真を見ながら |
| 地点 | GPS 平均またはタップで1点(井戸・苗畑・木など) |

記録中は画面が消えないようにし(Wake Lock)、途中経過は端末に自動保存する。
アプリが落ちても、次に開いたとき続きから再開できる。

## 誰が使えるか

- Google アカウントでログイン。**field_visit_map と同じ許可リスト**(Firestore の `allowedUsers/{メールアドレス小文字}`、`active: true`)を使う。
  リストへの追加は Firebase Console から(field_visit_map の SETUP.md と同じ手順)。
- **試用モード**:URL の末尾に `?demo` を付けると、ログインなしで動く。記録はその端末の中だけに残り、送信されない。研修・練習用。

## 構成

- `docs/` … アプリ本体(GitHub Pages で公開する。ビルド不要の ES modules)
  - `app.js` 画面全体 / `lib/` 計算・GPS・記録・地図・保存・書き出し・翻訳
  - `config.js` Firebase と Google Maps のキー(field_visit_map と同じプロジェクト `kazdr-field-visit-map`)
  - `sw.js` オフライン用のキャッシュ。**docs/ を変えたら必ず `CACHE` の版数を上げる**
- `firestore.rules` … field_visit_map のルールに `gpsFeatures` の項を足したもの。
  **Firebase プロジェクトを共有しているため、`../field_visit_map/firestore.rules` と常に同じ内容にする。**
- `tests/` … `node tests/test_geo.mjs`(面積・距離)、`node tests/test_i18n.mjs`(翻訳の抜け)、
  `python tests/e2e_demo.py --shots`(Edge で歩行を模擬した通し試験。51項目)

## データの形(Firestore `gpsFeatures`)

`kind`(polygon/line/point)、`name`、`category`、`group`、`notes`、`vertices[{lat,lng,acc,t,src}]`、
`areaM2`、`lengthM`、`center`、`accMedian`、`accMax`、`method`、`createdBy/updatedBy{uid,email,name}`、
`createdAt/updatedAt`、`archived`(削除はアーカイブのみ)。
