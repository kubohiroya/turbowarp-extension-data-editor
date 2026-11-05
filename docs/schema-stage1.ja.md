# 段階1の実装・検証と段階2への引継ぎ

> 2026-10-18のレビュー4件を修正した。[修正・再検証記録](schema-stage1-review-fixes-20261018.ja.md)はcommit前の履歴、[Git artifactへの固定方針](schema-stage1-git-artifact-20261018.ja.md)は公開時の条件を示す。以下の旧commit/pinの記述も当時の履歴として保持する。

追跡の正本は https://github.com/kubohiroya/turbowarp-extension-data-editor/issues/18 。原因調査を除外し、段階1の残りを対象に実装した。既存API v1・7公開入口・CSS/webpack4/build-infoを維持し、pureな`./schema`を追加した。各repoの作業ブランチへcommit/pushし、merge・npm publishは別工程として残す。

## 完了した対象

| 工程・repo | 契約・受理条件 | Issue・配布入口 |
|---|---|---|
| S1-1/2/3・共通 | draft-07/2020-12、同梱ref、入力非変更、構造/同期owner/安全な診断、明示bundleフォーム | #19/#20、`./schema`と`./rjsf`追加API |
| S1-4a・aframe | aframe-template。空type/id、class重複、配列/object属性値、再帰を既存parserと一致させる互換Schema | aframe #19、`./editor-schema` |
| S1-4b・scene-graph → 3d-scene-runtime | scene-document。互換3 resource、bare/wrapper/empty、正規化後ID重複、AR 0.3.0の入力契約 | scene-graph #5 → runtime #1、各`./editor-schema` |
| S1-4c・camera-source → camera-calibration | camera-profile、calibration-profile。twcs/legacy/ROS、calibration固有camerasource、元形式保持とconsumer追加制約 | camera-source #47 → calibration #38、各`./editor-schema` |
| S1-4c/d・motion | import、fusion校正、Pose2D v1/v2、Pose3D、DSL、protocol/pose unionの8契約。元sourceサイズ、delegate、注入時計、fusion専用幾何を区別 | motion #32、`./editor-schema` |
| S1-4e・time-space-sync | placement-reference/observation。Spec正本と意味制約、公開5 JSONの全文同一性 | time-space-sync #20、`./editor-schema` |
| S1-4e・template | scene-example/note-example。既存Schema・登録を維持しJSON/YAMLをpure検証 | template #29、`./editor-schema` |

論理契約は16。Pose2D v2は既存unionの構成であり、独立入力を増やしていない。共通を含め9 packageを検証した。Schema単体とowner条件の差は互換Schemaか同期owner層に明示し、runtime状態を保存条件に含めない。

正本・生成物・参考用Schemaはbundle provenanceで分類した。A-Frameとsceneの厳しい既存公開Schemaは参考用に保持する。motionはTypeBoxと6生成JSON、配置はSpec→toJsonSchema→publishedContracts→生成scriptと5 JSONを区別する。lib-editorのJSON copyは配布物で、正本を移動したことにはしない。

## 検証の根拠

機械記録はschema-stage1-verification.json、schema-stage1-contracts.json、schema-stage1-dependencies.json、schema-stage1-browser.json。ownerごとの細かなsource/emit/依存hashは各repoのdocs/editor-schema-verification.jsonに置く。

- 共通の関連113テストとbundle取得値の回帰1件に加え、build-info 2・webpack4 4ケースを確認した。後の型互換修正では関連36ケース、provider/bundle snapshotの修正では関連32ケースとpure/互換型検査を再確認した。全件の同じ繰返しをDoDにしていない。
- ownerの対象は計302ケース。既存結果の前提が変わらないものを保持し、新しいsource診断・trim/BOM/サイズ境界等を増分で検証した。細かな実行群は機械記録で区別する。
- 16契約をsrcのない実packageから横断し、valid/invalid・入力不変・raw source保持を確認した。empty scene、delegate ON/OFF、protocolとfusion幾何の差、policy固定時計も対象にした。
- 9 packageをpackしてsrcを除き、Reactを持たないconsumerでimport/strict型を確認。document/window/navigator/Scratch/fetch/WebSocket/MediaDevicesへのアクセスをthrowing getterで監視し、0件だった。
- 共通52＋owner83の計135 TS emit（JS/型/JSON）が再生成と全SHA-256一致。共通CSSもsourceと一致。webpack4の20出力とmetafileの一覧を照合し、共通dist配布物は75ファイルを確認した。旧S1-1の86テスト・44生成物は過去基準のまま保持する。
- motionの6生成JSONはTypeBoxの全文JSON.stringify結果と一致。配置は全5 JSONを$schema/$id/titleまで全文比較し、既存--check実行前後のhashも一致した。
- browser用の代表bundleを作り、DOM/VM/通信globalとDate.nowを禁止したVMでPose2D v2を検証した。React/RJSF/ML/controllerのimportは0。実ブラウザの全対応環境試験は後段の範囲。

pure型検査と隔離consumer型はskipLibCheck:false。既存RJSFを含む互換型fixtureだけは既存宣言の制約によりskipLibCheck:trueを維持する。この結果を依存宣言すべての厳格検査が通ったこととは扱わない。

## API互換性と表示境界

Schema単体の旧optionsにはprovenance/明示方言がないため、既存のRJSF validatorを継続する。明示bundle経路をpure engineへ接続し、各経路内でlive/save/未mount判定を共有する。

旧register/registerSchema/createSchemaEditor、defaultによる従来draft初期化、非同期validateDataの保存時専用契約を維持する。旧hostがBlockEditorRegistrationAPI/BlockEditorServiceを実装する型fixtureも追加した。registerSchemaBundleは旧hostでは任意capability、createBlockEditorServiceの戻り値では利用可能な型として保証する。

新しいowner検証はcontextを先に検査し、構造成功後だけ1回呼ぶ。Promise/thenable、例外、不正結果は実行診断へ分け、拒否Promiseも処理する。ownerへBlockSnapshotを渡さず、contextは呼出しごとのproviderから供給する。

RJSFは閉じたresource graphをprivate表示Schemaへ展開し、正本の意味・値を変更しない。canonical検証をlive/save/未mountで共用し、extraErrorsを既存field-errors/ARIAへ接続する。配列経由再帰は確認済み。prefixItems/dynamicRef/recursiveRefと無限展開になるobject直接再帰は表示入口で明示拒否し、headless engineの受理範囲は維持する。16 owner形式の実フォームは段階2で個別に確認する。

## 依存artifactと現在のGUI

ownerの共通pure依存はa1ab4f4f5b384eef08ef26e544186ee9d8ad4543、scene producerは7b8d67d47939b688895ed004bdbd035cd0fd6096、Camera Source producerは9a9a5c905271e603af9a08142527e8a4aace8decへ固定した。semverが同じという理由で作業HEADと同一視しない。実consumer内のproducer bundle fingerprintと、共通pureファイルのbyte hashが作業成果と一致することを別に照合した。後の追加source APIやRJSF型の差はこの判定に混ぜない。

pnpmの初回Git subdependency解決は固定取得先だけを確認してlockへ記録し、標準frozen installで再検証した。永続的な依存ポリシーを弱めていない。Git archive prepareではsource-revision stampでbuild-infoの40桁revisionを保持する。Camera Sourceの通常checkout/release prepackは従来checkを維持し、archive stampのあるGit配布だけ生成buildへ分けた。

既存helperへ/schemaのwebpack4事前build aliasも追加し、Reactなしの隔離packageから同じ3公開関数をimportできることを確認した。

参照GUIはHEAD 1848ab82cae48d0276185dc901a4f2740dee71cfでclean。依存は公開0.1.0で、./schemaや新bundle APIをまだ持たない。このGUIから今回のworktreeを消費しているとは扱わない。GUIの依存・flag・コードは変更せず、blockEditorDialogsは起動時固定・既定OFFを維持した。

## 段階2の開始条件

1. 利用するproducer/commonのcommitまたは正式公開版と、GUI/ownerのmanifest・lock・実解決が一致することを先に確認する。GUIでは新capabilityを検出し、公開0.1.0のままで新APIがあると仮定しない。
2. owner形式を保持するread/encodeと追加登録・複数引数bindingを実装する。ROSをtwcsへ、bareをwrapperへ、legacyを新profileへ自動移行しない。無変更保存では原文・コメント・Undo履歴を保持する。
3. pure read/検証ではdefaultを補わない。既存legacyフォームの初期default契約と区別し、数値/menu/候補UIは後段の計画に沿って適用する。
4. 保存直前にcontextを取り直して再検証する。policyの期限、起動時delegate設定、consumerごとの幾何/サイズ/型条件を維持し、controller状態・登録数・dropへ依存させない。
5. 16 owner形式のRJSF対応範囲を確認する。現行表示で扱えないkeywordや再帰を制約の削除で解決しない。

後段9固定契約、全ブロックへのbinding/Schema付与、60候補provider、broadcast登録、資源配列、②Schema自体の編集、③任意Schemaフォームは残作業。段階1の完成をブロックUI全体の完成とは扱わない。

## ロールバック

新pure入口または明示bundle登録の利用を外し、必要なら該当小粒commitをrevertする。GUIはblockEditorDialogsをOFFにして再読込できる。保存済みsourceを移行していないため逆変換は不要。Schema登録失敗を検証なし保存へfallbackしない。

## 再検証の入口

各owner checkoutをcwdとして、共通repoの`node scripts/verify-schema-package.ts <pure entryに必要なruntime依存名...>`を実行する。出力のisolated directoryをrepo名のkey（aframe、scene-graph、3d-scene-runtime、camera-source、camera-calibration、realtime-motion-capture、time-space-sync、extension-template、editor）へ対応付けたJSONを作り、共通repoで次を実行する。

```sh
node scripts/verify-schema-stage1.ts /path/to/isolation-index.json
node scripts/verify-schema-dependencies.ts /path/to/isolation-index.json
```

個別のfixtureはowner内のtests/editor-schema.test.ts等、共通の型fixtureはtest/types/tsconfig.schema-pure.jsonとschema-compat.jsonにある。Scopeを変えず文書だけを更新した後、同じfull build/testを繰り返すことは要求しない。
