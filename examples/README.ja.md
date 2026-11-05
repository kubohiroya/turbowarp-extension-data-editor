# 任意に利用する編集サンプル

`document-properties.ts` は同じ最小SchemaでJSONとYAMLを編集する例です。追加キーを保持し、必須項目や既定値は設けません。Templateの標準ブロックや、本番拡張が所有するSchemaではありません。

```js
import {createBlockEditorService} from '../dist/rjsf.js';
import {registerDocumentEditors} from './document-properties.ts';

const service = createBlockEditorService();
const dispose = registerDocumentEditors(service.api);
// Bind matching literal SOURCE inputs through the normal editor host.
dispose();
```

importだけでは登録されません。導入先の拡張がextensionId/opcodeとSchemaを所有してください。実際のブロックを作る処理や、Templateへの依存は含みません。

`test/generic-document.test.ts`で、実serviceを使った両形式の保存・再編集・Cancel・無変更原文保持・invalid拒否・追加キー保持・登録解除と失敗時の巻戻しを確認します。build後に次を実行します。

```sh
node --test test/generic-document.test.ts
```
