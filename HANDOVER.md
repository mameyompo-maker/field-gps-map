# HANDOVER — field_gps_map(2026-10-21)

## 目的

Kazさんの依頼(10/21):2つのレポート(offline_gps_report.pdf / company_field_data_report.pdf)を踏まえ、
「オフラインで動いて Google マップを使い、共有しやすいサービス」を作る。JatLog・field_visit_map の経験を流用してよい。

## 今の状態(2026-10-21 公開済み)

- 公開URL: https://mameyompo-maker.github.io/field-gps-map/ (試用は末尾に `?demo`)
- リポジトリ: https://github.com/mameyompo-maker/field-gps-map (public、Pages = main / docs)
- Firestore ルールをデプロイ済み(gpsFeatures を追加)。field_visit_map/firestore.rules にも同じ内容を入れて push 済み。
  旧ルールの控え: セッションの scratchpad にのみ(本番の旧ルールは既存部分と同一なので復元は末尾ブロックを消すだけ)。
- 試験: 通し試験 51/51(`tests/e2e_demo.py`)、本番確認 13/13(`tests/check_production.py`:
  PC・スマホ幅で Google マップ表示、JS エラーなし、SW 登録、ログイン画面)。ルールの試験 13/13。
- Firebase Auth の承認済みドメインに mameyompo-maker.github.io があることを確認済み。

## Kazさんにお願いすること(台帳 #11)

1. 実機(Android)で:Google でログイン → 外周を歩いて記録 → 機内モードで記録 → 電波を戻して「送信済み」になるか。
2. 使う人のメールアドレスが allowedUsers に入っているか(field_visit_map と共通)。

## 次にやること(Claude 側)

- 実機テストの結果を受けて直す。docs/ を変えたら sw.js の CACHE 版数を上げて push(= 即本番)。

## 判明した制約・決定事項

- Google の地図タイルは端末に保存しない(利用規約)。圏外は簡易地図で補う。
- Firestore の書き込みは await しない(圏外で保存ボタンが戻らなくなる)。
- docs/ を変えたら sw.js の `CACHE` 版数を上げる。push = 即本番。
- `firestore.rules` は field_visit_map と共有。片方だけデプロイすると、もう片方のアプリのルールが消える。
