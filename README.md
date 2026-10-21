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
- **畑の写真を付けられる。** 1件に 10 枚まで。端末で縮小(長辺 1280px)してから保存するので軽い。
  圏外で撮った写真も、記録と同じく電波が戻ると自動で送られる。
- 画面はポルトガル語・英語・日本語(端末の言語で自動、メニューの「言語」から切替可)。
- **自動で更新される。** 新しい版を公開すると、開いている端末が自動で入れ替わる(記録中は記録が終わるまで待つ)。
  メニューに「圏外で使えるか」「未送信が何件あるか」「最後にサーバーとつながった時刻」を表示する。

## 記録のしかた

| 方法 | 使いどころ |
|---|---|
| 歩いて角を追加 | 畑の境界を歩き、角に来たら大きな緑のボタン「ここを角に」を押す。押した瞬間の位置で1点(待ち時間なし)。歩くだけでは点は増えない。1つの畑で 10 点以内が目安 |
| 地図をタップ | 立ち入れない場所。電波のあるときに航空写真を見ながら |
| 地点 | 現在地(ボタン1回)またはタップで1点(井戸・苗畑・木など) |

- 同じ場所で4秒以内に2度押した分は無視する(押し間違い対策)。
- 押したときの GPS の精度が悪い(設定の許容値、既定 ±10 m を超える)と、振動と表示で知らせる。「取り消し」で戻せる。
- 点が 12 を超えると「点が多すぎます」と知らせる。

記録中は画面が消えないようにし(Wake Lock)、途中経過は端末に自動保存する。
アプリが落ちても、次に開いたとき続きから再開できる。

### できないこと

- **アプリを閉じたままの送信はできない。** 圏外で記録したものは、電波のある場所でアプリを一度開くと送られる
  (送信の待ち行列を Firestore の仕組みが持っていて、アプリが開いているときしか動かないため)。

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
  `python tests/e2e_demo.py --shots`(Edge で歩行・写真・3言語・圏外を模擬した通し試験。80項目)、
  `python tests/check_production.py --shots`(本番URLの確認)

## データの形(Firestore `gpsFeatures`)

`kind`(polygon/line/point)、`name`、`category`、`group`、`notes`、`vertices[{lat,lng,acc,t,src}]`、
`areaM2`、`lengthM`、`center`、`accMedian`、`accMax`、`method`、`createdBy/updatedBy{uid,email,name}`、
`createdAt/updatedAt`、`archived`(削除はアーカイブのみ)、`photoCount`、`cover`(一覧用の小さな写真)。

写真はサブコレクション `gpsFeatures/{id}/photos/{photoId}`:`data`(JPEG の data URL、1 MiB 未満)、
`thumb`、`w`、`h`、`takenAt`、`uploadedBy`、`archived`(外すのはフラグだけ)。
Cloud Storage を使わないのは、圏外での送信待ちを Firestore にまとめるため。
