# 固定Schemaを使うSource/Form編集

現行GUIの編集機能は標準ONです。有効化用URLスイッチは撤去しました。旧フラグの説明は段階導入時の履歴で、現在の起動・切戻し方法は[README](../README.ja.md#標準動作とロールバック)に従ってください。

既存の`register`・`registerSchema`・`registerSchemaBundle`は変更しない。追加の`registerSourceEditor`は、ホスト提供APIでは任意、`createBlockEditorService()`の返す`SourceBlockEditorRegistrationAPI`では必須となる。既存の`SchemaBundleBlockEditorRegistrationAPI`を実装するホストに新メソッドを要求しない。公開入口は従来の8つを維持する。

型と汎用有限JSON契約`jsonValueSchemaBundle`は`./schema`から取得する。この入口はDOM・Reactを必要としない。`PreparedEditorDefinition`と`PreparedSave`は`.`・`./rjsf`、UIを含む`createSourceEditor`は`./rjsf`から取得する。拡張側は型とpure owner adapterだけを参照し、React/RJSFを重複同梱しない。汎用JSON Schemaの正本は`src/json-value.ts`の`jsonValueSchema`であり、JSONファイルの生成物を正本と呼ばない。

`SourceEditorOptions`は固定した`bindings`と、保存のたびに新しい検証contextを返す`validationContext`を受け取る。各bindingは引数名、固定variant一覧、必要なら空scene等を明示するsourceOnlyVariants、`decode`と`validateSource`を持つ。`decode(source)`は`SourceDocument`を返し、その`source`に原文のraw文字列、`data`に編集表示用の値、`format`と`variantId`に形式と固定variantの識別子を保持する。`validateSource(source, context)`は`SourceValidation`を返し、その`source`に検証した候補文字列、`result`に検証結果を保持する。opcodeは`extensionId_opcode`の完全修飾名とする。複数のbindingを一つのeditorに束ねれば、一回のSaveで全候補を検証し、単一transactionとして保存する。

追加経路は`prepareSave`で候補を一回だけ生成し、同一文字列をowner検証とcommitへ渡す。診断やcallback出力はgetter・iteratorを実行せずJSON snapshotし、不正値や非同期結果を拒否する。contextは保存試行ごとに一回取得してfreezeする。単一sessionとDescendantSessionの両方がこの経路を使う。旧`validate/createPatch`経路にprepared定義を渡すと安全に拒否する。prepared単一sessionの登録解除・再登録は保存を失効させる。既存legacy sessionの登録解除後の挙動は変更しない。

追加UIにはSourceとForm、明示的な形式・固定variant選択による新規作成を用意する。Formは実在するJSON値を有限のReactツリーとして描画する。既存RJSFの描画・default初期化には変更を加えず、新経路ではroot scalar/array、任意キー、再帰、prefixItemsを扱うためRJSFのSchema変換制約を引き継がない。Schemaのkeywordを削除せず、正本の両方言・resource/ref/anchorを共通engineで検証する。表示用コピーだけを同じURI registryで解決する。閉じたenum/const unionは選択UI、互換なraw値を許すenum候補は`ui:enum`で提示する。外部候補一覧や新しいenum項目の登録は後続工程であり、この追加UIには含めない。

無変更・編集後の差戻し・Cancelは原文とUndo履歴を保持する。JSON range/YAML ASTで未編集箇所を保持し、既定値、const、minItemsによるデータ補完を行わない。ownerが受理したJSONのBOMや前後のtrim whitespaceを保持し、厳密なJSON codec自体の文法は拡張しない。YAMLの空配列等をJSONと誤認するownerには単一document markerを付けてYAMLを維持する。Formからの暗黙variant変更は拒否する。

安全に保持できないalias/anchor/tag自体の編集、コメントを消す部分置換などは保存を拒否し、`Discard form edits`で原文Sourceへ戻れる。非有限数に変換されるJSON数値は共通の有限JSON契約で扱えない。既存runtimeのparserは変更せず、旧GUIやflag OFFでは従来の実行を維持する。これらを無条件なForm対応済みとは数えない。

GUIの`blockEditorSourceForms`は起動時固定・既定OFFで、`blockEditorDialogs=1`も必要。OFFで新capabilityを公開せず、従来の登録APIを維持する。ロールバックはflag OFFで再読込し、必要ならconsumer→producer→共通の順で差分と依存を戻す。raw形式を自動移行しないため逆変換は不要。

開発時のローカルtarballはnpm公開を行わず検証できる。公開可能な配布の受け入れ条件はmanifest・lock・実解決・build-info/capabilityの一致である。作業コピーのHEADだけを実装済みのGit artifactと呼ばない。build-infoの`sourceState: working-tree`と`sourceSha256`で未commit実装を区別し、公開Git pinへの置換は別の承認・検証条件とする。
