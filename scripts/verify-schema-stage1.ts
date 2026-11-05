import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Every binding resolves through an isolated packed package; no source checkout is imported.
const index = JSON.parse(await readFile(process.argv[2], 'utf8'));
async function binding(repo) {
  const directory = index[repo];
  if (typeof directory !== 'string') throw Error('Missing isolated package ' + repo);
  const name = '@kubohiroya/turbowarp-' + (repo === 'editor' ? 'extension-data-editor' : repo);
  const entry = repo === 'editor' ? '/schema' : '/editor-schema';
  const file = join(directory, 'bindings.mjs');
  await writeFile(file, `export * from '${name}${entry}';\n`);
  return import(pathToFileURL(file));
}
const [core, aframe, scene, runtime, camera, calibration, motion, placement] =
  await Promise.all([
    binding('editor'),
    binding('aframe'),
    binding('scene-graph'),
    binding('3d-scene-runtime'),
    binding('camera-source'),
    binding('camera-calibration'),
    binding('realtime-motion-capture'),
    binding('time-space-sync'),
  ]);
const context = {
  consumerId: 'stage1-isolated',
  nowMs: Date.parse('2026-09-13T13:00:00Z'),
  settings: null,
};
const motionContext = { ...context, settings: { delegate: false } };
const text = (filename) =>
  readFile(new URL('../test/fixtures/schema-stage1/' + filename, import.meta.url), 'utf8');
const rows = [];
function check(contract, bundle, data, ownerValidate, ctx = context, bad = {}) {
  const before = JSON.stringify(data);
  const frozen = Object.isFrozen(data);
  const compiled = core.compileSchemaBundle(bundle);
  assert.equal(compiled.kind, 'compiled', contract + ' compile');
  assert.equal(
    core.validateSchemaInput(compiled.validator, data, {
      context: ctx,
      ...(ownerValidate ? { ownerValidate } : {}),
    }).kind,
    'valid',
    contract + ' valid',
  );
  assert.equal(
    core.validateSchemaInput(compiled.validator, bad, {
      context: ctx,
      ...(ownerValidate ? { ownerValidate } : {}),
    }).kind,
    'invalid',
    contract + ' invalid',
  );
  assert.equal(JSON.stringify(data), before);
  assert.equal(Object.isFrozen(data), frozen);
  rows.push({
    contract,
    identity: bundle.identity,
    dialect: bundle.dialect,
    resourceCount: 1 + bundle.resources.length,
    valid: true,
    invalidRejected: true,
    inputUnchanged: true,
  });
}
check(
  'aframe-template',
  aframe.templateSchemaBundle,
  { type: '', class: ['x', 'x'], attributes: { component: [1, { nested: true }] }, children: [{}] },
  aframe.validateTemplateInput,
  context,
  { children: {} },
);
const sceneData = {
  formatVersion: 1,
  root: { id: '', classes: ['x', 'x'], children: [{ type: 'box', id: 'box' }] },
};
check('scene-document', scene.sceneSchemaBundles.bare, sceneData, scene.validateSceneDocumentInput);
for (const source of [
  JSON.stringify(sceneData),
  'scene3d:\n  formatVersion: 1\n  root: {}\nar: {}\n',
  '  \n',
])
  assert.equal(runtime.validateSceneSource(source, context).result.kind, 'valid');
assert.equal(runtime.validateSceneSource('{}', context).result.kind, 'invalid');
const cameraSource = await text('camera-source-minimal.json'),
  cameraData = camera.decodeCameraProfileSource(cameraSource);
assert.equal(cameraData.source, cameraSource);
check(
  'camera-profile',
  camera.cameraProfileSchemaBundles[cameraData.variantId],
  cameraData.data,
  camera.validateCameraProfileInput,
);
const calibrationSource = await text('calibration-intrinsics.json'),
  calibrationData = calibration.decodeCalibrationSource(calibrationSource);
assert.equal(calibrationData.source, calibrationSource);
check(
  'calibration-profile',
  calibration.calibrationSchemaBundles[calibrationData.variantId],
  calibrationData.data,
  calibration.validateCalibrationInput,
);
const cal = JSON.parse(await text('motion-calibration.json'));
const legacyWithRosKeys = { ...cal, image_width: 800, camera_matrix: { raw: true } };
const legacySource = ' \n' + JSON.stringify(legacyWithRosKeys) + '\n';
const legacyResult = calibration.validateCalibrationSource(legacySource, context);
assert.equal(legacyResult.result.kind, 'valid');
assert.equal(legacyResult.variantId, 'legacy');
assert.equal(legacyResult.source, legacySource);
assert.deepEqual(legacyResult.data, legacyWithRosKeys);
const calibrationVariants = [];
for (const [variant, source] of [
  ['camerasource', '{"schema":"camerasource/camera-intrinsics"}'],
  ['legacy', '{"schema":"twrmc/camera-calibration"}'],
  ['twcs', '{"schema":"twcs/camera-intrinsics"}'],
  ['ros', 'image_width: 0\n'],
]) {
  const validated = calibration.validateCalibrationSource(source, context);
  assert.equal(validated.result.kind, 'invalid');
  for (const diagnostic of validated.result.diagnostics) {
    assert.deepEqual(diagnostic.scope, {
      identity: {ownerId: 'turbowarp-camera-calibration', contractId: 'calibration-profile',
        revision: 'parser-v0.14.0', variantId: variant},
      consumerId: context.consumerId,
    });
  }
  calibrationVariants.push(variant);
}
const pose2d = {
  schema: 'twrmc/pose-frame-2d',
  version: 1,
  cameraId: 'camera',
  peerId: 'peer',
  sequence: 1,
  captureTimestampUs: 123,
  frameWidth: 1280,
  frameHeight: 720,
  calibrationId: 'cal',
  persons: [],
};
const pose2dv2 = { ...pose2d, version: 2 };
const pose3d = {
  schema: 'twrmc/pose-frame-3d',
  version: 1,
  sequence: 1,
  timestampUs: 123,
  persons: [],
};
const dsl = JSON.parse(await text('performance-dsl.json'));
const policy = JSON.parse(await text('session-policy.json'));
const cases = [
  ['motion-calibration', 'calibration', cal, 'fusion-calibration'],
  ['pose2d', 'pose2d', pose2d, 'avatar-pose2d'],
  ['pose2d-v2', 'pose2dV2', pose2dv2, 'fusion-pose2d'],
  ['pose3d', 'pose3d', pose3d, 'avatar-pose3d'],
  ['performance-dsl', 'performanceDsl', dsl, 'performance-dsl'],
  ['protocol-union', 'protocolUnion', policy, 'protocol'],
  ['pose2d-union', 'pose2dUnion', pose2dv2, 'fusion-pose2d'],
  ['motion-calibration-import', 'importDelegateOff', cal, 'motion-import'],
];
for (const [contract, key, data, consumer] of cases) {
  check(
    contract,
    motion.motionSchemaBundles[key],
    data,
    motion.motionOwnerValidator(consumer),
    motionContext,
  );
  const source = JSON.stringify(data);
  const validated = motion.validateMotionSource(source, consumer, motionContext);
  assert.equal(validated.result.kind, 'valid', contract + ' source');
  assert.equal(validated.source, source);
}
const delegated = motion.validateMotionSource(cameraSource, 'motion-import', {
  ...motionContext,
  settings: { delegate: true },
});
assert.equal(delegated.result.kind, 'valid');
assert.equal(delegated.source, cameraSource);
const zero = structuredClone(cal);
zero.intrinsicMatrix[0] = 0;
const zeroSource = JSON.stringify(zero);
assert.equal(
  motion.validateMotionSource(zeroSource, 'protocol', motionContext).result.kind,
  'valid',
);
assert.equal(
  motion.validateMotionSource(zeroSource, 'fusion-calibration', motionContext).result.kind,
  'invalid',
);
for (const kind of ['reference', 'observation']) {
  const source = await text('placement-' + kind + '.json'),
    decoded = placement.decodePlacementSource(source, kind);
  assert.equal(decoded.source, source);
  check(
    'placement-' + kind,
    placement.placementSchemaBundles[kind],
    decoded.data,
    kind === 'reference'
      ? placement.validatePlacementReferenceInput
      : placement.validatePlacementObservationInput,
  );
}
assert.equal(rows.length, 14);
assert.equal(new Set(rows.map((row) => row.contract)).size, 14);

for (const [validate, source, args] of [
  [aframe.validateTemplateSource, '{private malformed', []],
  [camera.validateCameraProfileSource, '{private malformed', []],
  [calibration.validateCalibrationSource, '{private malformed', []],
  [placement.validatePlacementSource, '{private malformed', ['reference']],
  [runtime.validateSceneSource, '{private malformed', []],
]) {
  const result = validate(source, ...args, context);
  assert.equal(result.source, source);assert.equal(result.result.kind, 'invalid');
  assert.equal(JSON.stringify(result.result).includes('private'), false);
}

let contextReads = 0;
const unsafeContext = Object.defineProperty({...context}, 'consumerId', {enumerable: true,
  get() {contextReads++;throw Error('private-context');}});
for (const [validate, args] of [
  [runtime.validateSceneSource, []],
]) for (const invalidContext of [unsafeContext, null, undefined]) {
  const source = '{private malformed', result = validate(source, ...args, invalidContext);
  assert.equal(result.source, source);
  assert.equal(result.result.kind, 'invalid');
  assert.equal(result.result.diagnostics[0].code, 'input-format-invalid');
  assert.equal(Object.hasOwn(result.result.diagnostics[0].scope, 'consumerId'), false);
  assert.equal(JSON.stringify(result.result).includes('private'), false);
}
assert.equal(contextReads, 0);
assert.equal(runtime.validateSceneSource(' \n', unsafeContext).result.kind, 'valid');
assert.equal(contextReads, 0);

console.log(
  JSON.stringify(
    { contracts: rows.length, packageCount: 8, sourceImports: false, results: rows,
      reviewRegressions: {legacyRosKeyCompatibility: true, calibrationDiagnosticVariants: calibrationVariants,
        malformedSourceContextGetterReads: contextReads, emptySceneContextFree: true} },
    null,
    2,
  ),
);
