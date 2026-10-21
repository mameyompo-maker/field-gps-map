# HANDOVER — field_gps_map(2026-10-21)

## 目的

Kazさんの依頼(10/21):2つのレポート(offline_gps_report.pdf / company_field_data_report.pdf)を踏まえ、
「オフラインで動いて Google マップを使い、共有しやすいサービス」を作る。JatLog・field_visit_map の経験を流用してよい。

## 今の状態(2026-10-21 v1.1.0 公開)

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
- Firestore ルール:`gpsFeatures/{id}/photos` を追加してデプロイ済み。field_visit_map/firestore.rules にも同じ内容を入れて push 済み。
- 試験:通し試験 79/79(`tests/e2e_demo.py`)、翻訳 247 キー×3言語の抜けなし、ルールの試験 25/25。
- 途中で見つけて直したバグ:角のボタンで「直近 2.5 秒で精度が同じ測位」が並ぶと最も古い測位を使い、
  前の角のそばの位置が入っていた。基本は最新の測位を使うように直した(`docs/lib/gps.js` の bestRecentFix)。

## Kazさんにお願いすること(台帳 #11)

1. 実機(Android)で:Google でログイン → 畑の角を歩いてボタンで記録 → 写真を付ける → 機内モードで記録 →
   電波を戻してアプリを開き、メニューで「すべて送信済み」になるか。
2. 使う人のメールアドレスが allowedUsers に入っているか(field_visit_map と共通)。

## 次にやること(Claude 側)

- 実機テストの結果を受けて直す。docs/ を変えたら sw.js の CACHE 版数と app.js の VERSION を上げて push(= 即本番)。

## 判明した制約・決定事項

- Google の地図タイルは端末に保存しない(利用規約)。圏外は簡易地図で補う。
- Firestore の書き込みは await しない(圏外で保存ボタンが戻らなくなる)。写真も同じ。
- アプリを閉じたままの送信(Background Sync)はできない。Firestore SDK の送信待ちはページの中にあるため。
  圏外で記録したら、電波のある所でアプリを一度開いてもらう。
- 写真は Cloud Storage ではなく Firestore に入れる(圏外の送信待ちを1か所にまとめるため。1枚 1 MiB 未満)。
- docs/ を変えたら sw.js の `CACHE` 版数を上げる。push = 即本番。
- `firestore.rules` は field_visit_map と共有。片方だけデプロイすると、もう片方のアプリのルールが消える。
