# 専用エディターとsb3の継続E2E

現行GUIの編集機能は標準ONです。有効化用URLスイッチは撤去しました。旧フラグの説明は段階導入時の履歴で、現在の起動・切戻し方法は[README](../README.ja.md#標準動作とロールバック)に従ってください。

運用の正本: [共通Issue #26](https://github.com/kubohiroya/turbowarp-extension-data-editor/issues/26)。関連: [基盤・sb3のGUI Issue #12](https://github.com/kubohiroya/scratch-gui/issues/12)、[テーマ別invalid表示の共通Issue #12](https://github.com/kubohiroya/turbowarp-extension-data-editor/issues/12)。Playwright Testで同梱サンプルの読込、ブロック配置、アイコン起動、入力検証、保存、キャンセル、実際の `.sb3` の書出しと再読込を操作する。アプリやセキュリティ確認を差し替えず、内部VM APIでデータを投入しない。

## セットアップ

本体・開発依存・CI手順はturbowarp-extension-data-editorが所有する。Node.js 22以上とpnpm 11.18.0を使い、GUIと共通リポジトリを隣に配置する。以下は共通リポジトリで実行する。GUIにPlaywrightを追加しない。

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm exec playwright install --with-deps chromium
cd ../scratch-gui
npm ci --ignore-scripts --no-audit --no-fund
node scripts/prepublish.mjs
cd ../turbowarp-extension-data-editor
E2E_GUI_ROOT=/absolute/path/scratch-gui node scripts/site/build.mjs
E2E_GUI_ROOT=/absolute/path/scratch-gui E2E_PATH_PREFIX=/turbowarp-extension-data-editor/ pnpm test:e2e:block-editor
```

`E2E_GUI_ROOT` はローカルbuildを配信するGUI checkoutの絶対パス。未指定・無効なパスは起動失敗にする。外部URLの検証には不要。レポートは呼出し元のcwdによらず共通リポジトリ配下へ保存する（公開版選択/配信待機CLIは共通ルートで実行）。

対象ソース・固定依存と一致するビルドがあれば、E2Eだけを再実行できる。テスト専用HTTPサーバーは `127.0.0.1:8732/turbowarp-extension-data-editor/`（E2E_PATH_PREFIXで指定） で起動し、終了時に停止する。別ポートは `E2E_PORT=8733` で指定する。他のサーバーは流用しない。

```sh
E2E_GUI_ROOT=/absolute/path/scratch-gui pnpm test:e2e:block-editor --project=chromium-file-input
E2E_GUI_ROOT=/absolute/path/scratch-gui pnpm test:e2e:block-editor --project=chromium-project-url
pnpm test:e2e:infrastructure
```

## 検証経路

| 構成 | 再読込経路 | 合格が示す範囲 |
| --- | --- | --- |
| `chromium-file-input` | 標準メニュー → file input/filechooser | Android user agentでアプリが選ぶ既存fallback。実Android端末やOS pickerの検証ではない。 |
| `chromium-project-url` | 標準 `project_url` | ダウンロードした同じsb3バイト列をdata URLで新しいコンテキストへ渡す。 |
| `chrome-macos-native` | 標準メニュー → File System Access API → macOS「開く」 | テスト専用のローカルGoogle ChromeとOSダイアログを操作する。実ファイルを選択し、復元されたフォームまで検証する。 |

通常実行は既存2シナリオ×2構成の4件と、`chromium-project-url`のみの明色／暗色2件、計6件。opt-in起動、duration=0/61・label空欄の保存抑止、下書きの分離、日本語・引用符・`&`を含む値の保存、再起動、キャンセルを確認する。標準ファイルメニューからダウンロードしたsb3のZIP/CRC、`project.json`、text shadowの値、編集セッション情報の非混入を検査する。その同じファイルを新しいコンテキストへ読み込み、通常の拡張確認を経て値・アイコン・フォームを復元し、再検証とキャンセルを確認する。別シナリオで起動フラグの既定OFFを検証する。

すべての構成で普段のChromeプロファイルを使用せず、Playwrightが作るテスト用コンテキストを使う。`showOpenFilePicker`の差し替えや無効化は行わない。

## 明色・暗色のinvalid表示

`invalid-theme.spec.cjs`は通常の`project_url`でテスト専用sb3を開き、2つの拡張について通常のセキュリティ確認を操作します。fixtureは`theme-project.cjs`に置き、配布サンプルやVMへ直接投入しません。検証用sb3は圧縮してdata URLの長さを抑え、ステージ画像も同梱します。

実際のSettingsメニューでGUIテーマを切り替え、各ケースを独立したブラウザコンテキストで実行します。メディア設定だけのテーマ切替や、テストによるエラークラス・ARIA・CSSの付与は行いません。

- 初期invalidの空文字禁止・数値範囲・列挙値・textarea／入れ子のパターン違反を確認。赤枠、テーマ別の薄い赤背景、項目別説明、`aria-invalid`と説明IDの関連づけを実DOM／computed styleで判定します。
- validへ修正した後は、通常の入力枠・背景への復帰、説明とinvalid状態の解除、保存ボタンの有効化を確認します。
- 異なる拡張の親・孫、有効な兄弟について名前・アイコン・枠線・薄い背景を確認し、修正前後を比較します。有効な入力欄が祖先のエラーに巻き込まれないことも確認します。
- 入力での再invalid化、フォーカス、祖先の折りたたみとエラー案内からの再展開、下書きの保持を確認します。
- 配列の要素数・オブジェクトのプロパティ数によるグループ全体のエラーを確認し、有効な子の入力を赤くしないことを確認します。
- キャンセル後に元値が保持されることと、階層フラグなしの単一フォームでも同じ項目装飾・解除が動くことを確認します。

明色の赤枠は`rgb(198, 40, 40)`、暗色は`rgb(255, 138, 138)`を期待します。色仕様を変更するときは、期待値と変更理由を対で更新します。画面全体のピクセル一致は合否判定にしません。

```sh
E2E_GUI_ROOT=/absolute/path/scratch-gui pnpm test:e2e:block-editor invalid-theme.spec.cjs --project=chromium-project-url
```

公開版では、上記に代えて次節の公開URL・期待GUI/core SHAを指定します。既存のファイル読込2経路でのsb3往復を再度組み合わせず、表示テストはdesktop Chromiumへ限定します。`chrome-macos-native`は従来の2ケースのみです。Firefox・Safari・実Android端末はこのテストの対象外です。

成功時にも`light-invalid.png`、`light-valid.png`、`dark-invalid.png`、`dark-valid.png`を添付します。各テーマの`*-styles.json`には期待／実配信のSHA、ブラウザ・OS、対象URL、項目の修正前後の枠線・背景・説明・ARIA、ブロック外観を記録し、失敗途中でも到達段階まで保存します。`execution.json`の配信前後照合、browser errors、失敗画面・traceと合わせて確認してください。

`summary.json`には予定／記録件数とテーマ別の成功・失敗・skip件数を出力し、GitHub summaryにもテーマとテスト名を示します。通常実行が6件で明色・暗色を各1件含むことを確認し、意図しないskip・未検出を完了扱いにしません。

公開経路は共通側のpages/site-public workflowが所有し、GUI側に公開workflowを置きません。共通mainのworkflowとrunnerを同じ完全SHAで実行します。共通側の公開workflowとrunnerのSHAを一致させます。実際のPages配信後ジョブでこの2ケースの成功と4枚・JSONのartifactを確認し、Actions URLと両SHAを共通Issue #12へ記録して公開導入を完了とします。 npm版の製品ソースSHAとE2E runnerのSHAは区別します。このテストだけを追加するために製品versionや公開`coreRevision`を書き換えず、期待coreは配信された製品の実ソースに対応させます。

表示テストだけ切り戻す場合は新spec／fixtureと呼出し参照変更を対でrevertし、直前の確認済みrunnerへ戻します。既存の配信版照合・sb3往復・既定OFFテストを維持し、恒久skipや無条件retryで失敗を隠しません。製品のフラグ・スキーマ・保存形式は変更しません。

## macOSネイティブ経路

GUIログイン中のmacOS、ローカルGoogle Chrome、Xcode Command Line Tools（Swift）を必要とする。実行元のターミナルまたはCodexに、macOS設定でアクセシビリティ権限とSystem Eventsへのオートメーション権限を許可しておく。権限・フォーカスがない場合は環境エラーとして失敗し、別経路へ迂回しない。

```sh
E2E_GUI_ROOT=/absolute/path/scratch-gui pnpm test:e2e:native
```

このコマンドはheaded Chromeで2シナリオを実行する。CDPでテスト用ブラウザのPIDを取得し、SwiftのAccessibility APIがそのPIDのOS「開く」ダイアログを操作する。各キーボード操作の前に最前面のPIDを照合する。同名Chromeの検索、ユーザーのプロファイル、クリップボード、デスクトップ全体のスクリーンショットは使用しない。ネイティブ操作中は他のアプリへ切り替えない。

`native-picker-operation.log` はダイアログの状態遷移のみを記録する。ファイル選択だけでは成功とせず、拡張確認・フォーム復元まで完了したときだけ `execution.json` の `nativeOSPicker` を `passed` にする。

Linux CIには対話可能なmacOSデスクトップがないため、ネイティブ経路は実行対象外（`not-run`）。運用先はGUIログイン済みのローカルmacOS端末とし、**週1回（月曜の公開版チェック後）およびファイル読込・保存関連の変更をマージする前**にこのコマンドを手動起動する。公開版を使う場合は次節のURL・期待SHAも指定する。未実行の週は未実行として扱い、他の経路の成功で代替しない。実行日・OS/Chrome版・結果と証跡の保管先をレビュー時に確認する。self-hosted runnerの登録やOSの無人操作スケジュールは作成しない。

## 公開版の確認

外部URLの実行にはGUI/coreの完全SHAを必須とする。`build-info.json`から期待値をそのまま自己採用せず、配信元コミットとPages workflowの固定coreを使う。

```sh
E2E_BASE_URL=https://kubohiroya.github.io/turbowarp-extension-data-editor/ \
E2E_EXPECT_GUI_REVISION=<GUIの40桁SHA> \
E2E_EXPECT_CORE_REVISION=<coreの40桁SHA> \
pnpm test:e2e:block-editor
```

開始前と終了後にキャッシュを避けて `build-info.json` を確認する。期待値との不一致や途中の配信切替は失敗にし、異なる版の結果を混在させない。再試行は0回。UIの表示・値・ダウンロード完了を待ち、固定sleepを成功条件にしない。

## GitHub Actions

GUIの通常CI/Pagesは共通checkoutの `.github/actions/gui-checks` を呼び出す。インストール・ビルド・対象テスト・スコープ選択・ブラウザ・証跡保存はこのactionが所有する。公開版確認の実装は共通 `.github/workflows/turbowarp-public.yml`、GUI側はトリガーと固定SHAを持つ薄い呼出しだけにする。

公開と運用は共通Issue #26で追跡します。GUIフォークの通常CIは上流構成を維持し、公開・E2E起動を置きません。

- 共通pages.ymlはmainのpush/手動実行だけを許可。固定GUIソースを取得して共通のサイト処理で一度ビルドし、公開前E2E6件を実行します。
- 公開には同一site SHAの通常CI全体・最新attempt成功と、固定GUI SHAの通常CI成功を要求します。公開直前にmain鮮度とGUI CIを再確認します。
- 公開後はGUI/core/siteの3 SHAをソースのpinから照合し、反映を最大90秒待って同じE2E6件を実行します。配信build-infoを期待値の根拠にしません。
- site-public.ymlは手動実行と月曜11:17 JSTの週次検証を所有します。成功した共通Pages deploymentのsite SHAからGUI/core pinsを解決し、アプリを再ビルドしません。
- API障害・不一致・失敗は成功へ変換せず、既存公開を保持します。旧GUIサイトの検証記録は以下の履歴として残します。
- 必要なGitHub権限は `contents: read` / 公開チェックの `deployments: read` と、既存deploy jobのPages公開権限のみ。Issueへの自動投稿は行わない。
- summaryに結果・最後の検証段階・GUI/core SHA・経路・OS picker実行有無を出力する。HTML/JSONレポート、実sb3、失敗画面・trace、console/page/networkログ、配信待機ログを成功・失敗ともartifactへ保存し、7日間保持する。

ワークフローをリポジトリへ公開する前の段階では、ローカル検証や構文検査の成功をGitHub Actions上の実行成功として扱わない。公開後に対象PRのCI、Pages配信後ジョブ、手動チェックの実行URLをIssue #12へ記録する。

## 証跡と失敗の調査

- `playwright-report/block-editor/`: HTMLレポート。`pnpm exec playwright show-report playwright-report/block-editor`。
- `test-results/block-editor/results.json` / `summary.json`: テスト結果と経路別の最終段階。`execution.json` 添付にGUI/core SHA・ブラウザ/OS・OS picker実行有無を記録する。
- `test-results/block-editor-deployment/`: 期待する配信版の選択と、配信待機中の状態。Playwrightによる出力ディレクトリ初期化から分離する。
- roundtripテスト: 実際の `roundtrip.sb3`、サイズ/SHA-256/保存値、復元画面。失敗時のtraceは `pnpm exec playwright show-trace <trace.zip>`。
- `browser-errors.json`: console error・未捕捉例外・失敗リクエスト・HTTPエラー。未捕捉例外はテストを失敗させる。既存依存VMのconsole error（`Unexpected input recieved in replaceUnsafeChars`）は記録し、ログが空であることは合格条件にしない。
- Issue #12の配信後6ケースの画像・実測JSONは[リポジトリ内の保存先](editor/issue-12-public-validation/README.md)にも保存済み。artifactの保存期限後の参照は、次節のmain統合コミットに固定した保存先を使う。

失敗段階、版不一致、ブラウザ起動・OS権限などの環境要因を区別して調べる。UI assertionの失敗だけで製品不具合と断定しない。再実行は原因を確認した後に手動で行い、元の失敗記録も保持する。通常の実行生成物はGit管理対象外とし、Issue #12のように検証記録として選定した証跡は出所・ハッシュとともに文書配下へ保存する。テスト用データのみを使う。

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
