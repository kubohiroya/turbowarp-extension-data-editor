import {createSchemaEditor} from '../dist/rjsf.js';

// Both block types reuse an API v1 body; the aggregate owns all save/close actions.
export function registerDescendantExample(registry) {
  return registry.register(createSchemaEditor({
    apiVersion: 1, extensionId: 'treeexample', editorId: 'properties',
    opcodes: ['treeexample_group', 'treeexample_item'], argument: 'PROPERTIES',
    schema: {
      type: 'object',
      properties: {
        label: {type: 'string', title: '名前', minLength: 1},
        amount: {type: 'integer', title: '数量', minimum: 1}
      },
      required: ['label', 'amount'], additionalProperties: false
    }
  }));
}

export function createDescendantExampleSnapshot() {
  const node = (blockId, opcode, branches = []) => ({
    block: {
      targetId: 'example-target', blockId, opcode, revision: '1',
      arguments: {PROPERTIES: {kind: 'literal', value: JSON.stringify({label: blockId, amount: 1})}}
    }, branches
  });
  return {
    targetId: 'example-target', blockId: 'group', generation: 'example-project/session-1',
    nodes: [
      node('group', 'treeexample_group', [
        {input: 'BODY', blockIds: ['first', 'intermediate']},
        {input: 'ALTERNATIVE', blockIds: ['second']}
      ]),
      node('first', 'treeexample_item'),
      node('intermediate', 'control_repeat', [{input: 'SUBSTACK', blockIds: ['grandchild']}]),
      node('grandchild', 'treeexample_item'),
      node('second', 'treeexample_item')
    ]
  };
}
