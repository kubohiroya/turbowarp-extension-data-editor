# 専用エディターとSB3の統合E2E

GUIを起動する統合E2Eと配信前後の確認は、下流の [TurboWarp-Plus-Editor](https://github.com/kubohiroya/turbowarp-plus-editor) へ移管します。現在の実行コマンド・固定ソース・対応ブラウザー・証跡の保存先は同リポジトリの手順を参照してください。

本ライブラリでは `pnpm typecheck` と `pnpm test` でAPI・標準フォーム・互換配布物を検証します。GUI checkoutや公開Editorの稼働を必要としません。
単体のレイアウト用ブラウザfixtureはライブラリ検証として維持します。

本リポジトリの旧Pagesは廃止します。提供元の責務と移行DoDは [Pages廃止と移管](github-pages.md) を参照してください。

以下は移行前の実行結果です。当時のSHA・コマンド・URL・所有者は検証時点の記録であり、現在の起動/配信手順として使用しません。証跡ファイルと元バイト列は保持しています。

## 公開配信後の検証結果（Issue #12、2026-10-18）

[Pages実行 39092358787](https://github.com/kubohiroya/scratch-gui/actions/runs/39092358787)でdevelopから配信し、build・deploy・[配信後の公開E2E](https://github.com/kubohiroya/scratch-gui/actions/runs/39092358787/job/117572072428)がすべて成功した。以下はこの配信時点の結果であり、現在の公開版をこのSHAへ固定する指定ではない。

| 対象 | 検証した版・環境 |
| --- | --- |
| GUI | `4222d70005a59540dc454cf689668b1a9daa351e` |
| 製品core | `9e041e5278a1ea70146a76c10732d1401955a12a` |
| E2E runner | `e1b88b11ac1d21e06d7b7de0b00966d632ef73c9` |
| ブラウザ・OS | Chromium `156.0.8078.4` / Linux `6.17.0-1022-azure` |

予定6件・記録6件で**6/6成功、53.6秒、skip・retry・flaky各0**。全6件の開始・終了時に、公開`build-info.json`のGUI／製品core SHAが期待値と一致した。製品coreとテストrunnerのSHAは区別し、runner更新のために製品versionや`coreRevision`は変更していない。

| ケース | 構成・テーマ | 結果 |
| --- | --- | --- |
| 検証・保存・キャンセル・実sb3保存／再読込 | `chromium-file-input` | passed |
| 通常起動の既定OFF | `chromium-file-input` | passed |
| 検証・保存・キャンセル・実sb3保存／再読込 | `chromium-project-url` | passed |
| 通常起動の既定OFF | `chromium-project-url` | passed |
| invalid表示・修正後の解除・ブロック外観保持 | `chromium-project-url` / 明色 | passed |
| invalid表示・修正後の解除・ブロック外観保持 | `chromium-project-url` / 暗色 | passed |

明色・暗色は各1件成功、失敗・skip各0。各テーマの5項目で赤枠・薄いエラー背景・説明文・`aria-invalid`を確認し、修正後は通常枠線へ戻り、エラー背景・説明文・invalid状態が解除された。invalid枠線は明色`rgb(198, 40, 40)`／暗色`rgb(255, 138, 138)`、修正後は明色`rgba(0, 0, 0, 0.15)`／暗色`rgba(255, 255, 255, 0.15)`、背景のエラーgradientは`none`になった。

元ブロックの名前・アイコン・背景／枠線と正常な兄弟項目を維持し、修正前後の実測値の一致を確認した。単一／階層フォーム、折りたたみ・エラーからの移動、グループエラー、フォーカス、下書きとキャンセルのアサーションも成功。未捕捉`pageerror`は全6件で0、VMのconsoleメッセージ／sandbox制約の診断は保存している。Firefox／Safari、実Android、OSネイティブpickerはこの配信後実行の対象外。

### mainに統合した画像・実測JSON

[PR #15](https://github.com/kubohiroya/turbowarp-extension-data-editor/pull/15)で証跡をmainへ統合した。[統合コミット`8a0906a42abe60b0e83f8635a209bbcf0fbd077b`に固定した保存先](https://github.com/kubohiroya/turbowarp-extension-data-editor/tree/8a0906a42abe60b0e83f8635a209bbcf0fbd077b/docs/editor/issue-12-public-validation)は、artifactの保存期限や削除済みの作業ブランチに依存せず参照できる。

- 画像4枚: 明色の[invalid時](editor/issue-12-public-validation/light-invalid.png)／[修正後](editor/issue-12-public-validation/light-valid.png)、暗色の[invalid時](editor/issue-12-public-validation/dark-invalid.png)／[修正後](editor/issue-12-public-validation/dark-valid.png)。
- 実測JSON: [明色](editor/issue-12-public-validation/light-styles.json)／[暗色](editor/issue-12-public-validation/dark-styles.json)。項目別の修正前後のcomputed style・説明・ARIA、元ブロックと正常な兄弟の比較を保存。
- 実行記録: [summary.json](editor/issue-12-public-validation/summary.json)／[元のPlaywright results.json](editor/issue-12-public-validation/results.json)。6件の結果・テーマ別件数・前後の配信SHA、`execution.json`／`browser-errors.json`添付を保存。
- 配信照合と出所: [配信対象](editor/issue-12-public-validation/deployment-target.json)／[配信待機の実測](editor/issue-12-public-validation/deployment-wait.json)／[provenance.json](editor/issue-12-public-validation/provenance.json)。元run・artifact IDと保存ファイル10件のサイズ・SHA-256を記録。

画像と元の結果JSONはartifactから変更せずコピーし、テーマ別実測JSONは添付bodyをbase64復号した元のバイト列を保存した。画像4枚の目視確認と、mainのコミット固定URLから全10件を取得してSHA-256が一致することの確認も完了。HTMLレポート・sb3・その他のartifactファイルはこのリポジトリ保存の対象外。

[PR #13](https://github.com/kubohiroya/turbowarp-extension-data-editor/pull/13)のmain統合、GUIの公開workflowの`uses`／`runner_revision`更新、配信後6ケース・artifact確認、PR #15の証跡保存とmain統合を完了した。[Issue #12の統合記録](https://github.com/kubohiroya/turbowarp-extension-data-editor/issues/12#issuecomment-6245125438)に結果を追記し、Issueは完了・Closed。証跡統合後の[main CI](https://github.com/kubohiroya/turbowarp-extension-data-editor/actions/runs/39093162323)も成功した。

## 初期検証の記録（2026-10-18、上記配信後検証より前）

| 対象 | 結果 |
| --- | --- |
| Pages形式のローカルビルドとCI用metadata準備 | 成功。既存アプリのplayer HTMLを保持し、GUI/core SHAを照合。 |
| ローカルE2E | 4件成功、18.4秒。skip・flaky・再試行なし。 |
| 公開版E2E | 4件成功、19.8秒。`a10eb09e768a9d4dcd12162d5b42ccc842d7e70e` / core `ec338023ca8123b1db50787601ca8c78ab06917d` の開始・終了一致を確認。 |
| macOSネイティブの実sb3保存・再読込 | 1件成功、33.1秒。Google Chrome 155.0.8059.84 / Darwin 27.2.0。OS「開く」で実ファイルを選択し、拡張確認・保存値・フォーム復元・再validation・キャンセルまで成功。 |
| 期待GUI SHAの負の対照 | 期待値を40桁の0へ変え、UI起動前の `deployment-start` で想定どおり失敗。実SHA・失敗段階・環境分類を記録。 |
| 保存データの負の対照 | sb3比較時の期待durationのみ9→10へ一時変更し、`sb3-data-check` で実値9との差を検出して想定どおり失敗。変更は復元し、その後に上記ローカル/公開版を再確認。 |
| 補助テストと静的検査 | 補助テスト4件、限定ESLint、Swiftコンパイル、Actions actionlint、差分の空白検査が成功。 |

ネイティブ経路は開発中にダイアログの検出・入力で失敗した試行があり、PIDに直接結び付けた参照と、日本語パスを保持するネイティブ入力欄の操作へ修正した。成功は修正後の実ファイル復元の結果であり、filechooserやproject_urlの成功を代替として数えていない。OS操作ログは状態遷移だけを記録し、他のウィンドウのタイトルや画面を含めない。

この初期記録の時点では変更はローカルのみだった。後続のActions実行・公開導入の結果は上記「公開配信後の検証結果」を参照する。ローカル検証とActionsの配信後検証は別の実行記録として扱う。

## ロールバック

追加したE2Eステップ・`verify-public` 呼出し・公開チェックの定期/手動workflowを無効化するか、このテスト/CI差分をrevertする。アプリ実装・保存形式への変更はない。専用エディターは起動時固定の `blockEditorDialogs=1` によるopt-in、既定OFFを維持する。

## 共通側への移管後のローカル検証（2026-10-18）

- 共通: 型検査・ビルド、74テスト（既存71 + 配布物境界3）、E2E基盤5件成功。
- GUI: 結合55件・Pages3件、個別RJSF/YAML変換を除去したwebpack 4.47のPagesビルド成功。
- 共通側runner: 新ローカル配布物のE2E4件18.9秒、既存公開版E2E4件19.6秒。再試行0。メインspecは移管元とバイト単位で同一。
- ローカルはGUI `67cf2d0a439ae14122784c03469c28db19839c42` / 共通 `90d53b68b6f7def6246e74ada9aa3a6652901b10` **に今回の未コミット変更を加えたもの**を検証した。build-infoのSHAはbaseであり未コミット差分を識別しないため、差分のmanifestと結果を `/private/tmp/tw-distribution-evidence/` に保存した。
- 公開版はGUI `50c9e4786bb0fc2a2b1ae2169c9823c876f30651` / 共通 `90d53b68b6f7def6246e74ada9aa3a6652901b10` を検証した。新しい互換配布物の公開確認を意味しない。
- この移管直後のローカル検証時点では、Actionsの実行、commit/push、固定SHAの更新、Pages公開、macOSネイティブ選択は未実行だった。後続の公開導入は上記「公開配信後の検証結果」のとおり完了している。


## テーマ別invalid表示の実装・限定検証（Issue #12、2026-10-18）

- 作業ブランチ: `test/e2e/public-invalid-theme-states`。runnerはmain `9e041e5278a1ea70146a76c10732d1401955a12a` に本Issueの未コミットE2E・文書差分を加えたもの。別checkoutのSchema API作業は含めません。
- 公開対象: GUI `f2f1bcd0d5935eb0f213bd6ecf66fa138583e73d` / 製品core `9e041e5278a1ea70146a76c10732d1401955a12a`。期待値は成功したPages実行とその配信元workflowの固定参照から確認し、各テストの開始・終了時に配信metadataとの一致を確認しました。
- 公開ページを対象にローカルから実行したE2Eは6/6件成功、43.5秒。既存4件と明色／暗色各1件、skip・再試行なし。Chromium 156.0.8078.4 / macOS Darwin 27.2.0で確認しました。
- 明色／暗色それぞれで初期invalid、修正後の表示解除、入力でのrequired／範囲違反、元ブロック色と有効な兄弟の保持、折りたたみ・エラーからの展開とフォーカス、オブジェクト／配列全体のエラー、キャンセル、単一フォームを確認。成功時の4枚とテーマ別styles JSON、execution／browser errors、HTML／JSONレポートを保存しました。
- E2E基盤テスト6/6件成功。新しい検出テストで、既存の読込経路4件とテーマ2件が通常実行に含まれ、定義上のskipがないことを確認。変更したCJSのESLintと`git diff --check`も成功。
- 負の対照: 期待GUI SHAだけを40桁の0へ変更すると、暗色ケースがUI起動前の`deployment-start`で期待どおり失敗。テーマ・実配信SHA・`deployment-or-environment`分類を保存。テストコードと配信データは変更していません。
- 開発中に旧公開版から新公開版への配信切替を検出した試行は失敗として別保存し、最終成功に混在させていません。fixtureのURL長・拡張の二重登録・実DOMの指定に関するテスト側の修正を経て、上記の最終コードを検証しました。ローカルPagesビルドが未準備だった試行はブラウザ起動前に停止し、ローカルビルドの成功として数えていません。
- 成果物の正本は`test-results/block-editor/`と`playwright-report/block-editor/`。最終結果と未コミット差分のハッシュmanifest、負の対照の診断は`/private/tmp/issue12-evidence/`にも保存しています。
- この限定検証時点ではcommit/push・PR・GUI呼出しrunner参照更新・新テストのActions実行は未実施でした。その後の配信後6ケース成功と画像・実測JSONのmain統合により、公開導入DoDは完了しています。実行URL・対象版・保存先は上記「公開配信後の検証結果」を参照してください。
