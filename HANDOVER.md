# HANDOVER — field_gps_map(2026-10-21)

## 目的

Kazさんの依頼(10/21):2つのレポート(offline_gps_report.pdf / company_field_data_report.pdf)を踏まえ、
「オフラインで動いて Google マップを使い、共有しやすいサービス」を作る。JatLog・field_visit_map の経験を流用してよい。

## 今の状態

- アプリ本体は完成(`docs/`)。試用モード(`?demo`)で通し試験 51/51 合格、単体試験も合格。
  - 歩いて 1ha の正方形 → 1.00 ha、角ごとの 0.4ha → 4001 m²、Malema 2 Block 3 → 3.90 ha。
  - 圏外(Service Worker 導入後)での起動・保存・一覧、KML の書き出し→読み込みの往復(分類・グループ・メモも保持)。
- `firestore.rules` を作成し、Firebase の Rules テスト API で 13 ケースすべて期待どおり(本番には未反映)。
- 手元の git に記録済み。**GitHub への push と Pages 公開はまだ**(自動承認で「本番デプロイ」として止められたため)。

## Kazさんにお願いすること(台帳にも記載)

1. **ルールのデプロイ**(field_visit_map と同じプロジェクトなので、本番ルールの差し替えになる)
   - 先に `projects/field_visit_map/firestore.rules` を `projects/field_gps_map/firestore.rules` と同じ内容にする
     (追加したのは末尾の `match /gpsFeatures/...` のブロックだけ。既存部分は一字も変えていない。
     デプロイ済みのルールと手元の field_visit_map/firestore.rules が一致することは 10/21 に確認済み)。
   - `cd projects/field_gps_map` → `firebase deploy --only firestore:rules --project kazdr-field-visit-map`
2. **公開**:`gh repo create mameyompo-maker/field-gps-map --public --source . --push` →
   Settings → Pages で `main` / `/docs` を選ぶ(または `gh api` で設定)。
3. 公開後、`https://mameyompo-maker.github.io/field-gps-map/?demo` を PC で開き、Google マップ(航空写真)が出るか確認。
   - localhost では Google マップが認証エラーになり簡易地図に切り替わった。API キーの HTTP リファラー制限に
     `mameyompo-maker.github.io/*` が入っていれば本番では出るはず。出なければ Google Cloud Console で
     キー(config.js の mapsApiKey)のリファラーに `https://mameyompo-maker.github.io/field-gps-map/*` を足す。
4. Firebase Console → Authentication → 承認済みドメインに `mameyompo-maker.github.io` があるか確認(field_visit_map で入っているはず)。
5. 実機で:ログイン → 記録 → 機内モードで記録 → 電波を戻して同期、を一度通す。

## 次にやること(Claude 側)

- 公開後、`?demo` で本番の表示を Playwright で確認する(Google マップが出るか)。
- 実機テストの結果を受けて直す。

## 判明した制約・決定事項

- Google の地図タイルは端末に保存しない(利用規約)。圏外は簡易地図で補う。
- Firestore の書き込みは await しない(圏外で保存ボタンが戻らなくなる)。
- docs/ を変えたら sw.js の `CACHE` 版数を上げる。push = 即本番。
- `firestore.rules` は field_visit_map と共有。片方だけデプロイすると、もう片方のアプリのルールが消える。
