# 院内タスクボード

歯科医院内で使う、チェアサイド入力に特化したシンプルなタスク管理Webアプリです。診療中に「後でやること」を10秒以内に登録し、発注・準備・患者関連タスクの見落としを防ぐためのツールです。

## 固定方針

- 院内シングルユーザー運用を想定する
- スマホ・院内iPad・PCでは、基本的に1つのSupabaseユーザーを共有して同期する
- Supabase AuthとRLSはデータ保護のため維持する
- 日常利用では初回ログイン後、自動同期し、ログインを意識させない
- 完全ログインなし公開テーブルにはしない
- 患者名は保存しない
- 患者マスターは作らない
- 保存する患者識別情報はカルテ番号のみ
- カルテ番号は院内では患者識別につながるため慎重に扱う
- 削除済みタスクはSupabase再読み込みでも復活させない
- ログイン期限切れでも未同期タスク・削除待ちタスクは消さない
- ログイン期限切れでデータを消さない。Supabaseから空データで上書きしない
- JWT expired時は自動更新を試み、失敗時は再ログインを促す
- 新規タスク追加時は日付指定をデフォルトにする
- 期限なしで登録する場合は明示的に `期限なし` を選ぶ
- 分類フラグはカルテ番号入力要否とは独立して管理する
- タスク種別は編集可能なマスターとして扱う
- 使用済みタスク種別は履歴保護のため原則 `active=false` の非表示扱いにする
- Supabase化する場合はAuthとRLSを必ず有効にする
- 共有端末ではログイン状態と画面ロックに注意する

## 使い方

`index.html` をブラウザで開くと利用できます。スマホやiPadでは、ブラウザの「ホーム画面に追加」からアプリ風に起動できます。

右下の大きな `＋` ボタンからタスクを登録します。

1. タスク種別を選ぶ
2. 必要な場合だけカルテ番号を入力する
3. 期限日を選ぶ
4. 必要なら短いメモを書く
5. 保存する

新規タスク追加時は `日付指定` が選択された状態で開きます。期限日を未入力のまま保存しようとすると注意を表示します。期限なしで登録したい場合は、期限エリアで `期限なし` を明示的に選んでください。

タスク種別に `今日`、`明日`、`今週中`、`来週` の既定期限が設定されている場合は、種別選択時にその既定期限を優先します。既定期限が未設定、または期限なしに寄りやすい状態では `日付指定` を維持します。

スマホで `＋` を押した直後は、タスク名入力欄や日付入力欄へ自動フォーカスしません。キーボードや日付ピッカーを勝手に開かず、まずタスク種別ボタンが見える位置へ移動します。カルテ番号必須の種別を選んだ場合だけ、次の入力導線としてカルテ番号欄へ進みます。

## 画面

- 今日やる: 今日が期限、または期限切れの未完了タスク
- 全未完了: 完了・削除・アーカイブ済みを除く全タスクを重複なしで表示
- 期限が近い: 期限切れ、今日、明日、7日以内のタスク
- 患者関連: `is_patient_view=true` のタスク種別
- 発注・準備: `is_supply_related=true` のタスク種別
- 事務系: `is_admin_related=true` のタスク種別
- 後で整理: 期限なし、その他、種別未選択のタスク
- 完了済み: 完了したタスク
- タスク種別: 種別マスターの追加・編集・並び替え・非表示・削除
- 設定: 保存状態、詳細設定、JSONエクスポート・インポート

## 保存モード

ヘッダーと設定画面に現在の保存モードを表示します。

- `保存：この端末のみ`: Supabase未設定。localStorageのみで動作
- `保存：この端末のみ`: Supabase設定はあるが未ログイン。詳細設定から初回ログインが必要
- `保存：ログイン期限切れ・端末内一時保存`: 保存済みJWTを更新できないため、詳細設定から再ログインが必要
- `保存：Supabase同期中`: ログイン済み。変更をlocalStorageへ保存し、Supabaseへも保存
- `保存：Supabase保存失敗・端末内一時保存`: Supabase保存に失敗。localStorage版として継続

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

## 院内シングルユーザー同期モード

このアプリは、複数ユーザーの権限管理ツールではなく、院内で自分が使うタスクをスマホ・院内iPad・PCで共有するためのシングルユーザー同期モードを想定しています。

Supabase Authはログイン管理を前面に出すためではなく、RLSで `auth.uid()` ごとに `tasks` / `task_types` を保護するために維持します。完全ログインなし公開テーブル、RLS無効化、anon keyだけで誰でも読める設計、service_role keyやDB passwordやJWT secretをフロントに置く設計にはしません。

初回だけ詳細設定からSupabaseにログインします。一度sessionが保存されると、次回起動時は自動でsessionを確認し、JWT期限切れが近い場合は `refresh_token` で更新し、Supabaseから読み込み、未同期タスク送信と削除待ちタスクの削除再試行を行います。

再ログインが必要なのは、`refresh_token` が無効になった場合やsession更新に失敗した場合だけです。その場合も、localStorage内のタスク、未同期タスク、削除待ちタスク、削除済み墓標は消しません。

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

## 詳細設定

設定画面では、通常は保存状態と未同期件数だけを表示します。メールアドレス、パスワード、ログイン、ログアウト、Supabase接続テスト、localStorageデータ移行、Supabaseから再読み込みは `詳細設定を開く` の中にあります。

日常利用では詳細設定を開かなくても、ログイン済みsessionがあれば自動同期します。

## localStorageからSupabaseへの移行

詳細設定内の `localStorageデータをSupabaseへ移行` を使います。

移行時は、カルテ番号がSupabaseに保存されることを確認するダイアログを出します。現在の実装は `id` が同じものを更新し、ないものを追加するupsert方式です。最初は空のSupabase、または移行先として上書き・統合して問題ない環境で実行してください。

`Supabaseから再読み込み` は、Supabaseの `tasks` / `task_types` を読み込み、localStorageキャッシュも更新します。

Supabaseログイン時に `task_types` が0件だった場合は、localStorage側の `taskTypes` を優先してSupabaseへ自動投入します。localStorage側にも種別がない場合は、初期タスク種別19件を投入します。

設定画面の `初期タスク種別を復元` は、同名の種別を重複作成せず、不足している初期種別だけを追加します。非表示になっている初期種別は表示に戻します。

タスク追加・編集時は、まずlocalStorageに保存します。Supabase保存に成功した場合は同期済み、失敗した場合は `pendingSync=true` として端末内に残し、保存モードに `Supabase保存失敗・端末内一時保存` と未同期件数を表示します。Supabaseから再読み込みしても、未同期タスクは消さずにlocalStorage側へ残します。

タスク削除時はlocalStorageに `deleted_at` を記録し、Supabaseログイン済みの場合は `pendingDelete=true` としてSupabaseの `tasks` deleteを実行します。削除済みタスクは通常画面・件数・Supabase再読み込み結果に表示しません。Supabase削除に失敗した場合も端末内では削除済みとして保持し、次回同期時に削除を再試行します。

詳細設定内の `Supabase接続テスト` では、ログインユーザーID、`task_types` select、`tasks` select、`tasks` test insert、`tasks` test delete を確認します。失敗時はHTTP status、message、details、hint、pathを詳細設定内に表示します。

Supabase REST APIで `JWT expired` が出た場合は、保存済みの `refresh_token` でセッション更新を試みます。更新に成功した場合は失敗したAPIを1回だけ再実行し、接続テストでは `セッション更新：OK` と表示します。更新できない場合は `ログイン期限切れ・端末内一時保存` と表示し、再ログインを促します。この場合もlocalStorageの未同期タスク、削除待ちタスク、削除済み墓標は消しません。

ログイン期限切れ状態でタスクを追加・編集・削除した場合も、保存済みセッションが残っている間は `pendingSync` / `pendingDelete` として端末内に保持します。再ログイン後にSupabase保存を再試行できるようにし、期限切れを理由にタスク本体・taskTypes・未同期データを初期化しません。

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
- `is_patient_view`
- `is_admin_related`
- `created_at`
- `updated_at`

`chart_number_mode` はカルテ番号入力の要否だけを表します。発注・準備ビューに表示するかどうかは `is_supply_related`、患者関連ビューに表示するかどうかは `is_patient_view`、事務系一覧に表示するかどうかは `is_admin_related` で別々に管理します。

既存Supabase環境には、次の追加SQLを適用してください。

```sql
alter table public.task_types
add column if not exists is_patient_view boolean not null default false;

alter table public.task_types
add column if not exists is_admin_related boolean not null default false;

-- アプリで重複整理が完了し、同一user_id内の同名重複がなくなった後に追加してください。
create unique index if not exists task_types_user_name_unique_idx
on public.task_types (user_id, lower(btrim(name)));
```

初期分類はアプリ起動時の正規化でも補正します。インプラント体発注、ガイド発注、2次オペ準備物確認、インプラント印象準備物確認、個人トレー作製、TEC作製、NG作製、プレオルソ発注、メンブレン発注、エムドゲイン発注、リグロス発注、AOSS発注、ボナーク発注、テルプラグ発注は `is_supply_related=true` です。紹介状作製、シェード写真送信は `is_patient_view=true` です。振り込み・支払い、事務仕事、その他は `is_admin_related=true` です。

同じ `user_id` 内で同名のタスク種別がある場合、アプリは前後空白を除去した名称で重複整理します。代表種別を1つ残し、既存タスクの `task_type_id` は代表IDへ付け替えます。Supabase同期時は付け替え後のtasksを保存したうえで、重複task_typeを削除します。

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

localStorageキャッシュ上では、削除復活防止のため次の同期用フィールドも保持します。

- `deleted_at`
- `pendingSync`
- `pendingDelete`
- `sync_error`

## JSONバックアップ

JSONエクスポート・インポートを用意しています。

エクスポート時には次の注意を確認してください。

> このデータにはカルテ番号が含まれます。外部共有や送信に注意してください。

インポート時は既存データを上書きします。復元前には現在のJSONを書き出してください。

## PWA / Service Worker

`manifest.json` と `service-worker.js` は残していますが、Supabase同期確認中はService Worker登録を無効化しています。アプリ起動時に既存のService Worker登録を解除し、Cache Storageの既存cacheも削除します。

`service-worker.js` もno-op化しており、install / activate時に既存cacheを削除し、fetchでは古い `index.html` やJSを返しません。スマホやGitHub Pagesで最新版が反映されない場合は、画面の設定に表示される `Version: 2026-06-17-single-user-sync` を確認してください。

## 主なファイル

- `assets/js/storage.js`: 初期データ、localStorage保存、既存データ正規化
- `assets/js/supabase-client.js`: Supabase Auth / RESTの最小クライアント
- `assets/js/sync.js`: localStorageとSupabaseの保存モード切り替え
- `assets/js/app.js`: UI、タスク操作、種別管理
- `supabase/schema.sql`: Supabaseテーブル、RLS、index
