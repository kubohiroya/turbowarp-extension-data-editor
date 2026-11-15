# 複合エディター：固定入力とJSON入力を1つの画面で編集する（設計）

状態: 設計。未実装。

## 背景

登録簿は1つのopcodeに編集画面を1つしか登録できない（`registry.ts`の重複検査）。このため、固定入力（選択肢など）とJSON入力を両方持つブロックでは、片方しか編集画面を持てない。例は`turbowarp-named-functions`の`define function`で、`EXPORT`（`none`/`tool`）は固定入力の編集画面を持つが、`SCHEMA`と`RETURNS`（JSON Schema、またはスキーマ名）は編集できない。

検討した2案のうち、「1つのopcodeに複数の編集画面を登録し、タブで選ぶ」案は採らない。タブごとの保存になり、入力をまたぐ検査（例：`tool`として公開するなら説明が必須）ができないためである。代わりに、1つのブロックの入力を1つの下書きとして編集し、1回で保存する複合エディターを追加する。

## 既存の部品との関係

- `registerSourceEditor`は、すでに複数のbindingを1つの編集画面に束ね、1回のSaveで全候補を検証して単一transactionとして保存する（[source-forms.ja.md](source-forms.ja.md)）。SourceとFormの2つの表示も持つ。
- `registerFixedInputEditor`は、固定入力（text/number/enum/color）を有限のpolicyで扱う（[fixed-input-contracts.md](fixed-input-contracts.md)）。

複合エディターは、この2種類のbindingを1つの定義に並べるものとする。新しい保存経路は作らず、両者のprepared saveを1つのtransactionにまとめる。

## 登録API（案）

```ts
registerCompositeEditor?<C = null>(definition: CompositeEditorOptions<C>): () => void;

interface CompositeEditorOptions<C = null> {
  apiVersion: 1;
  extensionId: string;
  editorId: string;
  opcodes: readonly string[];
  /** 画面に並べる順。 */
  sections: readonly CompositeSection<C>[];
  /**
   * 入力をまたぐ検査。全sectionが個別に通ったあとで1回だけ呼ぶ。
   * snapshotで、段にしていない入力（例：DESCRIPTION）の値も読める。
   */
  validateAll?(
    values: Readonly<Record<string, CompositeValue>>,
    snapshot: FixedBlockSnapshot,
    context: SchemaValidationContext<C>
  ): readonly ValidationIssue[];
  validationContext: () => SchemaValidationContext<C>;
}

type CompositeSection<C> =
  | {kind: 'fixed'; binding: FixedInputBinding<C>}
  | {kind: 'source'; binding: SourceBinding<C>; modes?: SourceModes<C>};

/** 段の最終的な値。名前のモードの値はソースとして解釈しない。 */
type CompositeValue =
  | {mode: 'fixed'; value: JsonValue}
  | {mode: 'name'; name: string}
  | {mode: 'source'; value: JsonValue};

interface SourceModes<C = null> {
  /** 「名前で指定」。ダイアログを開くたびに呼ぶ（プロジェクトの編集で一覧が変わるため）。 */
  names?: {
    list(snapshot: FixedBlockSnapshot): readonly {name: string; label?: string}[];
    /** 保存時の検査。名前が解決できなければ問題を返す。 */
    validate(name: string, context: SchemaValidationContext<C>): readonly ValidationIssue[];
    /** 保存済みの文字列が名前か（JSONでないか）を判定する。 */
    isName(literal: string): boolean;
  };
  /** 「ベーシック」。無ければベーシックのタブを出さない。 */
  basic?: {
    schemaBundle: SchemaBundle;
    /** 値をベーシックのフォームで欠けなく表せるか。 */
    fits(value: JsonValue): boolean;
  };
}
```

- 既存の`register*`は変えない。`registerCompositeEditor`はホスト提供APIでは任意のcapabilityとする。
- 1つのopcodeに登録できる編集画面は、今と同じく1つだけとする。複合エディターがその1つになる。

## 画面

- 各sectionをアコーディオンの段として縦に並べる。
- 固定入力の段は常に開いて表示する（1行で済むため）。
- JSONの段は開閉できる。値があれば最初から開き、空なら閉じておく。保存時に検査エラーがあれば自動で開く。
- 各段の見出しに状態を表示する。保存できる状態なら☑️、問題があれば警告の印を付ける。任意の入力が空なのは「保存できる状態」とみなす。
- Saveは、全sectionが保存できる状態で、かつ`validateAll`が問題を返さないときだけ押せる。押せないときは、Saveの横に「n件の段を直すと保存できます」と残りの件数を表示する。
- Saveを押せなくするのは、この画面の指針（押せないボタンを避け、操作に応じて理由を示す）の例外とする。根拠は、理由（直すべき段の件数）を常にSaveの横に表示すること、問題のある段を自動で開いてエラー文をその場に出すことで、押せない理由が画面上で分かるためである。
- 入力にレポーターが差し込まれている段は、既存の固定入力と同じく読み取り専用で表示し、「レポーターが入っているため編集できません」と示す。段の印は保存できる状態とみなし、Saveの判定を妨げない（保存はその入力を書き換えない）。
- 判定は入力中に随時行い、状態を即座に更新する。

## JSONの段の3つのモード（`SourceModes`）

| モード | 内容 |
|---|---|
| 名前で指定 | `modes.names.list`が返す一覧から選ぶ（例：`define schema`の定義名）。`names`が無いsectionでは出さない |
| ベーシック | `modes.basic.schemaBundle`からRJSFでフォームを作る。`basic`が無いsectionでは出さない |
| エキスパート | JSONをテキストエリアで直接書く。既存のSource表示を使う |

- **ベーシック用スキーマ**：JSON SchemaのメタスキーマそのものはRJSFでは扱えない（再帰、`$dynamicRef`、真偽値スキーマ、配列の`type`）。そこで、ownerが表せる範囲を絞ったスキーマを渡す。JSON Schemaを書く入力では、プロパティの一覧（名前、型、必須、説明）、`enum`、最小・最大、配列の要素の型を範囲とする。`turbowarp-named-functions`の`define schema`ブロックが扱う範囲と揃える。
- **ベーシックで表せるかの判定**：`modes.basic.fits(value)`で行う。
- **名前の値はソースとして解釈しない**：既存の`SourceBinding`はソースをJSONかYAMLとして解釈する前提で、スキーマの名前（`Scored@1.0.0`）はどちらでもない。そこで、保存済みの文字列が`modes.names.isName`で名前と判定されたら、`decode`と`validateSource`を通さず、名前のモードの値（`{mode: 'name'}`）として扱う。保存時の検査は`modes.names.validate`で行い、書き込む文字列は名前そのものとする。
- **最初に開くモード**：名前が入っていれば「名前で指定」、ベーシックで表せればベーシック、それ以外はエキスパート。
- **ベーシック→エキスパート**：いつでも切り替えられる。
- **エキスパート→ベーシック**：JSONの文法が壊れているときは切り替えられない。ベーシックで表せない機能を含むときは、フォームを読み取り専用で表示し、「ベーシックモードでは表せない内容が含まれています」と知らせる。フォームから保存して機能が黙って消えることを防ぐ。
- 段の☑️とSaveの判定はモードに依存せず、最終的な値で行う。

## 保存

- 全sectionの候補を一度に作り、各bindingの検査、`validateAll`の順に通す。
- 通ったら、変更のあった入力だけを1つのtransactionとして書き込む（Undoは1回分）。
- 書き込み直前に、既存のリビジョン照合で衝突を検出する。

## 最初の利用者

`turbowarp-named-functions`の`define function`で使う。

- `EXPORT`：固定入力の段（既存のbindingをそのまま移す）
- `SCHEMA`：JSONの段。3つのモードすべてを使う
- `RETURNS`：JSONの段。空を許す
- `validateAll`：`EXPORT`が`tool`なら`DESCRIPTION`が必須、という既存の規則（`function-registry.ts`の`readDefinition`）。`DESCRIPTION`は段にしないので、`snapshot`から読む

## ベーシック用スキーマの所在

「JSON Schemaを書くためのスキーマ」（プロパティの一覧、型、必須、説明、`enum`、最小・最大、配列の要素の型）と、それに対応する`fits`は、data-editorの共通部品として`./schema`から提供する。JSON Schemaを入力に持つ拡張は他にもありうるため、拡張ごとに作ると二重になる。named-functionsは、`define schema`ブロックが扱う範囲がこの共通部品と一致することをテストで確かめる。共通部品は、最初の利用者の実装より前に用意する。

## 未決事項

- 開閉の状態を、同じブロックを次に開いたときに覚えておくか。
- 未変更のときにSaveを押せるようにするか。
- 既存の単独の編集画面にも、段の☑️表示と「全条件が整うまでSaveを押せない」規則を揃えるか。揃えなければ、同じEditorの中で保存の振る舞いが2通りになる。揃えれば、既存の編集画面のUIが変わる。

## 既存の編集画面への影響

- `registerCompositeEditor`は追加の登録APIで、既存の登録APIと「1つのopcodeに編集画面は1つ」の規則は変えない。複合エディターに移したブロック以外の画面は、見た目も動作も変わらない。
- 複合エディターの段は、固定入力の表示とSource表示の既存部品を包んで使う。既存部品そのものに手を入れる場合は、既存の単独の編集画面の表示が変わっていないことを既存のE2E（ローカル実行）で確かめる。
