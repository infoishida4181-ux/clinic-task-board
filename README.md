# 院内タスクボード

歯科医院内で使う、チェアサイド入力に特化したシンプルなタスク管理Webアプリです。診療中に「後でやること」を10秒以内に登録し、発注・準備・患者関連タスクの見落としを防ぐためのツールです。

## 固定方針

- 患者名は保存しない
- 患者マスターは作らない
- 保存する患者識別情報はカルテ番号のみ
- カルテ番号は院内では患者識別につながるため慎重に扱う
- タスク種別は編集可能なマスターとして扱う
- 使用済みタスク種別は履歴保護のため原則 `active=false` の非表示扱いにする
- Supabase化する場合はAuthとRLSを必ず有効にする
- 共有端末ではログイン状態と画面ロックに注意する

## 使い方

`index.html` をブラウザで開くと利用できます。スマホやiPadでは、ブラウザの「ホーム画面に追加」からアプリ風に起動できます。

右下の大きな `＋` ボタンからタスクを登録します。

1. タスク種別を選ぶ
2. 必要な場合だけカルテ番号を入力する
3. 期限を選ぶ
4. 必要なら短いメモを書く
5. 保存する

スマホで `＋` を押した直後は、タスク名入力欄へ自動フォーカスしません。キーボードを勝手に開かず、まずタスク種別ボタンが見える位置へ移動します。カルテ番号必須の種別を選んだ場合だけ、次の入力導線としてカルテ番号欄へ進みます。

## 画面

- 今日やる: 今日が期限、または期限切れの未完了タスク
- 期限が近い: 期限切れ、今日、明日、7日以内のタスク
- 患者関連: カルテ番号があるタスク
- 発注・準備: `is_supply_related=true` のタスク種別
- 後で整理: 期限なし、その他、種別未選択のタスク
- 完了済み: 完了したタスク
- タスク種別: 種別マスターの追加・編集・並び替え・非表示・削除
- 設定: Supabaseログイン、移行、再読み込み、JSONエクスポート・インポート

## 保存モード

ヘッダーと設定画面に現在の保存モードを表示します。

- `保存：この端末のみ`: Supabase未設定。localStorageのみで動作
- `未ログイン`: Supabase設定はあるが未ログイン
- `保存：Supabase同期中`: ログイン済み。変更をlocalStorageへ保存し、Supabaseへも保存
- `保存：オフライン一時保存`: Supabase保存に失敗。localStorage版として継続

localStorageキーは以下です。

```text
clinicTaskBoard.v1
```

既存のlocalStorageデータを壊さないため、このキーは維持しています。

## Supabase設定

`assets/js/config.example.js` を `assets/js/config.js` にコピーし、実際の値を入れてください。

```js
window.SUPABASE_CONFIG = {
  url: "YOUR_SUPABASE_URL",
  anonKey: "YOUR_SUPABASE_ANON_KEY"
};
```

`assets/js/config.js` は `.gitignore` 対象です。anon keyは公開前提のキーですが、プロジェクトURLとセットで扱うため、不要な共有は避けてください。

Supabase設定がない場合、アプリはこれまで通りlocalStorage版として動きます。

## Supabase schema

`supabase/schema.sql` に以下を含めています。

- `task_types` テーブル
- `tasks` テーブル
- `updated_at` 自動更新関数とトリガー
- RLS有効化
- authenticated user が自分の `user_id` のデータだけ select / insert / update / delete できるポリシー
- `chart_number_mode` のCHECK制約
- `status` のCHECK制約
- `user_id`、期限、種別、カルテ番号向けindex

既存localStorageのIDを移行しやすくするため、`id` と `task_type_id` は `text` にしています。`user_id` は `auth.uid()` と紐づける前提です。

## localStorageからSupabaseへの移行

設定画面の `localStorageデータをSupabaseへ移行` を使います。

移行時は、カルテ番号がSupabaseに保存されることを確認するダイアログを出します。現在の実装は `id` が同じものを更新し、ないものを追加するupsert方式です。最初は空のSupabase、または移行先として上書き・統合して問題ない環境で実行してください。

`Supabaseから再読み込み` は、Supabaseの `tasks` / `task_types` を読み込み、localStorageキャッシュも更新します。

リアルタイム同期はまだ実装していません。将来追加する場合は `assets/js/sync.js` にRealtime購読を足す想定です。

## データ構造

### task_types

- `id`
- `user_id`
- `name`
- `sort_order`
- `active`
- `chart_number_mode`
- `default_due_type`
- `is_supply_related`
- `created_at`
- `updated_at`

### tasks

- `id`
- `user_id`
- `task_type_id`
- `title`
- `chart_number`
- `memo`
- `due_date`
- `priority`
- `status`
- `archived`
- `created_at`
- `updated_at`
- `completed_at`

## JSONバックアップ

JSONエクスポート・インポートを用意しています。

エクスポート時には次の注意を確認してください。

> このデータにはカルテ番号が含まれます。外部共有や送信に注意してください。

インポート時は既存データを上書きします。復元前には現在のJSONを書き出してください。

## PWA

`manifest.json` と `service-worker.js` を用意しています。ローカルHTTPサーバー、またはHTTPS環境で開くとService Workerが登録され、最低限のオフライン表示に対応します。

## 主なファイル

- `assets/js/storage.js`: 初期データ、localStorage保存、既存データ正規化
- `assets/js/supabase-client.js`: Supabase Auth / RESTの最小クライアント
- `assets/js/sync.js`: localStorageとSupabaseの保存モード切り替え
- `assets/js/app.js`: UI、タスク操作、種別管理
- `supabase/schema.sql`: Supabaseテーブル、RLS、index
