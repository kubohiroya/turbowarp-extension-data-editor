# 固定入力・native host・フォーム（S3-1〜S3-3）

現行GUIの編集機能は標準ONです。有効化用URLスイッチは撤去しました。旧フラグの説明は段階導入時の履歴で、現在の起動・切戻し方法は[README](../README.ja.md#標準動作とロールバック)に従ってください。

この実装は固定入力の型・Schema検査・同期prepared境界と、明示的に有効化する標準field transactionを追加する。固定フォームとGUIの既定OFFフラグへ接続する。各拡張は正本Schema・codec・登録を所有し、共通基盤に特定用途のSchemaを内蔵しない。既存SOURCE編集、`apiVersion: 1`、既存8 exportsとCSS buildは維持する。

## 有効化と互換性

`createBlockEditorService()`は既存SOURCE APIを返し、`registerFixedInputEditor`を公開しない。固定入力の契約を使うサービスは`createBlockEditorService({fixedInputs: true})`と明示する。旧host向けの`BlockEditorRegistrationAPI`上では新メソッドはoptionalのままである。GUIでは起動時固定・既定OFFの`blockEditorFixedInputs`を`blockEditorDialogs`とのANDで使う。

登録には`registerFixedInputEditor<C = null>(options)`、DOM不要の定義構築にはrootの`createFixedInputEditor<C = null>(options)`を使う。registryへ直接登録する場合は`registerFixed()`を使い、legacy `register()`やSOURCE専用`registerPrepared()`に渡さない。旧hostには`fixedInputs`を要求せず、新契約の定義だけを開けない状態にする。

`BlockEditorHost.fixedInputs`はoptionalで、対応ポートは`capability: 'fixed-inputs-v1'`、`readBlock(reference, declaration)`、`commit(request)`を持つ。サービスのopt-inだけでは対応hostにならない。descendantsへ固定入力を流す経路も、この工程では拒否する。

## 読取と保存

`FixedBlockSnapshot`は通常のraw引数と、契約ID/revision・generation・入力のfield/接続identity・読取専用集合・selector/dependentの宣言を持つ。rawの非有限値や負のzeroも専用captureで保持する。新しい書込み候補は有限の保存primitiveに限定し、既存rawと同じ制約で取り直さない。

`editableArguments`と`readOnlyArguments`は重複できない。固定metadataはこの宣言集合に対応させ、段階4などの非対象引数はrawのまま保持・比較する。読取専用引数の変更や接続identityの変化も競合となる。`captureFixedSnapshot`/`sameFixedSnapshot`を使い、旧snapshot captureによるmetadata消失を避ける。

各bindingはSchema bundleと同期の`read`、`encode`、`validateCandidate`を持つ。`read`は表示用のJSON投影を作り、投影できない既存rawではthrowしてreadonlyにする。rawの意味を推測して代替値へ変更しない。変更済み入力だけに対して、保存候補を一度`encode`し、その候補の再投影へSchema検査を行い、同じ候補をowner検査とcommitへ渡す。`validateCandidate(candidate, context, snapshot)`の第3引数から関連literalやreadonly値を純粋に確認できる。ownerの例外・診断本文をUIへそのまま表示しない。

selector/dependentはownerが有限の`branchPolicies`を静的宣言する。未宣言のgroupやreporter/不明なselectorには既定branchを推測せず、依存入力をreadonlyにして独立入力だけを保存できる。対応する正本policyがあるgroupだけをprepared/session/hostで再検査して変更でき、未対応のgroup書込みは従来どおり拒否する。

draftは`inputs[argument]`ごとに`value`・`changed`と、必要に応じ数値`buffer`・明示修復`repair`を保持する。原文の正本はsnapshotに置く。数値bufferがある場合、投影値が同じでも字句を検査する。無効な`1e`を直前の投影値で保存しない。bufferは有限JSON number字句で投影値と一致する必要があり、codecは受け取った検証済みtokenをそのまま返す。同じdialogでは非表示でもbufferを保持し、再表示で正確に復元・再検査する。非表示bufferは検証とpatchから除外し、今回保存しない旨を表示する。

`parseFixedNumberInput`はrootと`./schema`から使える純粋な**新入力用**の関数である。有限JSON数値字句とtyped finite numberを扱い、`-0`・指数表記をtokenとして保持する。空文字・hex・`+1`・`.5`・非有限値・overflow・未完成bufferを拒否し、ownerの整数・sentinel・clamp・単位変換後の境界は追加しない。既存rawを開閉だけでこのparserへ通して書き換えない。`./schema`は引き続きReact/DOMを必要としない。

非投影rawの修復は、対応するliteral fieldに`repair: true`を明示して有効候補へ変更する場合だけに限る。reporter・未対応fieldを修復名目で置換しない。未変更入力や編集後に元の投影へ戻した入力は、原文のalias・空白等を保持する。

## 同期境界と後続の責務

owner設定型は既存`SchemaValidationContext<C>`のJSON設定制約に従い、既定は`C = null`。ポートの型消去にはJSON設定を保持する`FixedHostCommitRequest`を使う。同期callbackからのPromise/thenable、getter、独自iterator等を保存データとして実行せず拒否する。設定・候補・metadataは切り離して凍結し、登録解除後の保存も拒否する。

新しいfactory/固定入力登録のoptions・definition・bindingも通常の宣言objectのown data propertyから一度だけ採取する。accessorや独自iteratorを実行して宣言を得ることはせず、検査済みのcallback・opcode配列をそのまま登録する。旧legacy登録の宣言仕様は変更しない。

hostはcommitの実書込み直前にも全identity・読取依存・登録寿命を再確認し、readonly変更を全件拒否する責務を持つ。registry経由のsessionは、commit待機中に登録が解除されたらrequestの`signal`をabortする。hostは実書込み直前にもsignalを確認し、失効時には無変更で拒否する。購読はcommit完了/拒否時に解除する。S3-2の標準field hostは全field適用・同期VMイベント・undo/redo・dirty・event groupをまとめてcommit/rollbackする。mockに加えて、固定した実ScratchBlocksとVM adapterのfixtureで保存と途中例外を確認する。headless native fixtureは実GUIやnative pickerのE2Eと区別する。S3-3では実GUIと23展開fixtureのモデル・UIを検証し、各owner製品の全境界・旧runtime比較はS3-4、新artifactの依存閉包はS3-5で検証する。

切戻しはサービスのopt-inを外すことで新契約を公開しない状態に戻せる。旧host/旧登録の型・実行経路は維持する。0.2.1配布物の`gitHead`と`x-turbowarp-source`は元Git SHAを示し、版更新等を含むworking-tree release overlayをcleanなrelease commitと区別する。


## S3-2の標準field host

`/turbowarp`の`createTurboWarpBlockEditorHost({...options, enableFixedInputs: true})`でだけ`fixedInputs` portを作る。省略・falseでは旧TEXT hostを維持する。`attachTurboWarpBlockEditors`には`fixedInputs: true`を渡す。GUI起動時フラグ、サービスopt-in、host有効化を一致させ、旧artifactに存在しないAPIを偽造しない。

hostはregistryの`resolveFixed(opcode)`が返すcallbackを含まないimmutable宣言を正本とする。同じ内容で再登録しても宣言identityは変わり、以前のsnapshotで保存できない。呼出し側のdeclarationによるreadonly集合の省略・偽造は認めない。旧`resolve()`のdescriptorは変えない。

標準allowlistは`text.TEXT`の`FieldTextInput`、`math_number.NUM`の`FieldNumber`、拡張namespace配下の静的menu shadowと親の直接`FieldDropdown`、`colour_picker.COLOUR`の`FieldColourSlider`である。実保存primitiveがstringで、VMとfield値が厳密に一致する場合だけ書込み候補にする。custom subclass・独自validator/field method・動的menu callback・reporterは実行せず書込み対象外とする。BOOLEAN socketを作ったりreporterをliteralへ置換したりしない。

新候補はfieldごとに純粋に全件検査してから適用する。数値は有限JSON数値token、menuは保存valueの既存静的候補、色は受理する色字句に制限し、field setterの結果と候補が厳密に一致しなければrollbackする。ownerの範囲・sentinel・単位・clampはここへ追加しない。既存未知menu値、数値の空白/alias、色の表記等は変更しない限りrawを保持する。

commit直前にproject/target、親・shadow・field・VM、読取依存、登録寿命、signalを再確認する。readonlyへのpatchや不正候補を一つ含む要求も全件拒否する。同期適用中のsetter・VM adapter・listener例外や中断では、この保存が変更したfield/VMと自己イベントのundo/redoを復旧し、この保存に由来するdirtyを増やさない。再入した外部操作の値・履歴・dirty通知と、外部のtarget/project切替後の履歴は保持し、古い状態へ巻き戻さない。成功時だけこの保存の一つのundo groupとdirty通知を作り、no-opではどちらも作らない。色fieldはrawだけでなくHSVとblockの表示色も復旧する。

固定入力のChangeは同期配送中に`recordUndo: false`でVMとlistenerへ渡し、全検査成功後に同じeventを`recordUndo: true`としてundo履歴へ追加する。redoのclearも成功時まで保留する。これにより失敗・project切替時に旧履歴を復元するための書戻しを避け、外部操作が持つ現在の履歴を保持する。旧SOURCEのevent配送は変更しない。保存対象と同じfieldへの外部Changeが再入した場合は外部値を残し、最初の外部eventのundo起点をこの保存開始前のrawに対応させる。未commit値をundoで復活させない。外部の色変更ではそのrawと表示状態も保持する。

正本branch policyのないgroupとfixed descendantsの集合保存は拒否する。Descendants ONでもfixed rootはsingle sessionで開き、旧SOURCE aggregateへfixed childが混在する場合はfail closedを維持する。ownerの正本Schema・境界検査・依存固定は拡張側の責務であり、共通側の試験を製品の実測の代用にしない。


## S3-3の有限policyとUI

`FixedInputEditorOptions.branchPolicies`はselector・normalize（trim/lowercase）・有限case（保存value/alias、activeDependents、selector変更時のreadonly literal/nonempty要件）をownerが宣言する。caseのbinding overrideで固定Schema/read/encode/owner検査とcontrolを選ぶ。各Schemaは登録時にcompileし、実行時のreporter値やSchema生成providerは追加しない。common本体に特定拡張のproperty名・triggerを内蔵しない。

callbackを含まない`branchRules`をregistryの正本に保持する。sessionとhostはこの正本でgroupの全patchを検査する。selectorの保存rawが変わる場合は未編集のactive依存も最終branchで検査し、reporterを黙って置換しない。selector未変更なら変更active入力だけを検査するので、現在のbranchで必須でないreadonly reporterは評価せず保持できる。変更候補のencodeは各入力一度だけ、構築済み候補を再投影したSchemaとowner検査へ同じ値を渡す。

`describeFixed`とoptional `EditorViewContext.getFixedInputView()`はeditable/readonly/hidden・control/choices・表示上の問題を返す。表示時にcontext provider・encode・owner validatorを呼ばない。フォームは`/rjsf`登録時のmountで接続し、rootのpure factoryと`./schema`はReact非依存を維持する。enumは保存valueとlabelを分離し、未知raw・aliasを表示して、既知候補を明示選択するまで保持する。数値はtext bufferで未完成の`1e`も保持し、色は原文の入力と表示用pickerを分離する。Schema defaultを補わない。

`fixedInputMessages`には表示文のobjectまたはmount時同期providerを渡せる。GUIは実際のIntl localeに基づく日英文言を供給する。readonly・reporter未評価・非表示draft・validation・resetもlocaleへ従い、診断code/contract IDはAPIに残してdialog本文では一般的な説明を示す。各fieldにはlabel、固有error ID、aria-invalid/aria-describedbyを付ける。

失敗して同scopeのsessionが開いている間はdraftを保持する。保存成功・取消・dispose・project/target/登録失効では破棄し、再openは現在のrawから読む。optional host `subscribeInvalidation(reference,declaration,listener)`はproject generation/target/実block/VM/登録scopeの失効を通知する。pending保存はsignalをabortし、他scopeへbufferを復活させない。通常の同target値変更は保存時に競合として拒否し、そのdialogのdraftを保持する。

GUI・commonの試験では16フラグ分類、日英・focus/keyboard、23展開fixtureをcommonのモデル・UIで確認する。両Asset各6/Bubble10/common1の適用先を区別し、common fixtureを各owner製品の実測に代用しない。実ownerのSchema正本・全境界・旧runtime比較はS3-4、pin/lock/実解決を一致させる閉包はS3-5の別証拠で確認する。ローカルGUI検証でartifact overlayを使う場合は元実体を保全し、declared pin/lockと実際のtest解決先の差を明記する。

## E2Eの対象と明示profile

以下のGUI統合E2Eは下流のTurboWarp-Plus-Editorへ移管しました。コマンドは同リポジトリで実行します。

`pnpm test:e2e:block-editor`は既存SOURCE経路・reload・light/darkの6件を実行する。Pagesと公開後検証もこの既定profileを使う。TurboWarp-Plus-Editorの固定ソース設定では選定した最新GUI/coreの元Git SHAを固定し、使用するnpm版・配布物hash・working-treeの区分も別に照合する。Pages公開は別の明示承認を要する。

S3-3のfixed対応GUIとcommon artifactを明示した検証先には、`pnpm test:e2e:fixed-inputs`で固定入力21件を実行する。既存6件も合わせる場合は`E2E_FIXED_INPUTS=1 pnpm test:e2e:block-editor`で27件を選択する。ローカル検証先は`E2E_GUI_ROOT`、外部検証先は`E2E_BASE_URL`と完全SHAの`E2E_EXPECT_GUI_REVISION` / `E2E_EXPECT_CORE_REVISION`で指定する。fixed profileは対応を期待する対象にだけ明示し、対象が未対応なら検査失敗とする。機能不足を実行時skipに置き換えない。

`pnpm test:e2e:native`はmacOSの既存OS picker用editor 2件を維持し、fixed profileを併記しても対象を増やさない。固定入力の実Blockly dropdown操作は21件側の検証で、OS pickerとは別に数える。公開siteの変更はnpm公開から独立した承認を要し、実施時はdeployment SHA・元Git SHA・npm版・配布物の一致を確認してから公開後fixed検証を行う。
