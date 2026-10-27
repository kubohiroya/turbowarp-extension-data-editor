const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {select, relevant} = require('./ci-scope.cjs');
const {sha, coreRevision} = require('./public-target.cjs');

test('PR checks include application, dependencies, workflow and deleted related paths', () => {
    for (const filename of ['src/lib/editor.js', 'package-lock.json', '.github/workflows/pages.yml',
        'test/e2e/block-editor/editor.spec.cjs', 'webpack.config.js', 'site/content.mjs']) {
        assert.equal(relevant(filename), true, filename);
    }
    assert.equal(relevant('docs/translation-notes.md'), false);
    const base = 'a'.repeat(40);
    assert.equal(select({pull_request: {base: {sha: base}}}, revision => {
        assert.equal(revision, base);
        return ['src/deleted-editor.js'];
    }), true);
    assert.equal(select({before: base}, () => ['README.md']), false);
});

test('new branches and missing history never skip regression checks', () => {
    assert.equal(select({before: '0'.repeat(40)}, () => []), true);
    assert.equal(select({}, () => []), true);
    assert.equal(select({before: 'a'.repeat(40)}, () => {
        throw new Error('missing history');
    }), true);
});

test('public checks require full immutable revisions and resolve the deployed core pin', () => {
    assert.equal(sha('a'.repeat(40)), true);
    for (const value of ['develop', 'abc123', `${'a'.repeat(40)}\n`, null]) assert.equal(sha(value), false);
    const workflow = 'repository: kubohiroya/turbowarp-extension-data-editor\n' +
        '          ref: ec338023ca8123b1db50787601ca8c78ab06917d\n';
    assert.equal(coreRevision(workflow),
        'ec338023ca8123b1db50787601ca8c78ab06917d');
    assert.throws(() => coreRevision('repository: another/package\nref: main'), /pin/);
    assert.throws(() => coreRevision('repository: kubohiroya/turbowarp-extension-data-editor\nref: main'), /pin/);
});


test('deployment selection failures preserve evidence before any browser starts', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'block-editor-target-test-'));
    try {
        const result = spawnSync(process.execPath, [path.join(__dirname, 'public-target.cjs')], {
            cwd: directory,
            env: {...process.env,
                GITHUB_REPOSITORY: 'invalid',
                GITHUB_STEP_SUMMARY: path.join(directory, 'summary.md')}
        });
        assert.equal(result.status, 1);
        const report = JSON.parse(fs.readFileSync(
            path.join(directory, 'test-results/block-editor-deployment/selection-error.json'), 'utf8'));
        assert.equal(report.stage, 'deployment-selection');
        assert.equal(report.browser, 'not-run');
        assert.equal(report.nativeOSPicker, 'not-run');
        assert.match(fs.readFileSync(path.join(directory, 'summary.md'), 'utf8'), /UI not run/);
    } finally {
        fs.rmSync(directory, {recursive: true, force: true});
    }
});


test('local host selection is explicit and independent of the caller working directory', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'block-editor-gui-root-'));
    const helper = path.join(__dirname, 'gui-root.cjs');
    try {
        fs.writeFileSync(path.join(directory, 'webpack.config.js'), 'module.exports = {};');
        const run = root => spawnSync(process.execPath, ['-e',
            `process.stdout.write(require(${JSON.stringify(helper)})())`], {
            cwd: os.tmpdir(), env: {...process.env, E2E_GUI_ROOT: root}, encoding: 'utf8'
        });
        assert.equal(run('').status, 1);
        assert.equal(run('relative').status, 1);
        assert.equal(run(path.join(directory, 'missing')).status, 1);
        const valid = run(directory);
        assert.equal(valid.status, 0);
        assert.equal(valid.stdout, directory);
    } finally {
        fs.rmSync(directory, {recursive: true, force: true});
    }
});

test('default E2E selection preserves both reload routes and includes both themes without static skips', () => {
    const result = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'), 'test',
        '--config', path.join(__dirname, 'playwright.config.cjs'), '--list', '--reporter=json'], {
        cwd: path.resolve(__dirname, '../../..'),
        env: {...process.env, E2E_NATIVE: '0', E2E_FIXED_INPUTS: '0'},
        encoding: 'utf8',
        timeout: 15_000
    });
    assert.equal(result.status, 0, result.stderr);
    const collect = suite => [...(suite.specs || []), ...(suite.suites || []).flatMap(collect)];
    const specs = JSON.parse(result.stdout).suites.flatMap(collect);
    const cases = specs.flatMap(spec => spec.tests.map(entry => ({...entry, file: spec.file, title: spec.title})));
    assert.equal(cases.length, 17);
    const security = cases.filter(entry => entry.file === 'extension-security.spec.cjs');
    assert.equal(security.length, 10);
    for (const language of ['ja', 'en']) {
        assert.equal(security.filter(entry =>
            entry.title === `mixed extensions from ${language} entry are not automatically selected`).length, 1);
    }
    for (const entry of security) assert.equal(entry.projectName, 'chromium-project-url');
    assert.equal(cases.filter(entry => entry.file === 'editor.spec.cjs').length, 4);
    const themes = cases.filter(entry => entry.file === 'invalid-theme.spec.cjs');
    assert.equal(themes.length, 2);
    for (const theme of ['light', 'dark']) {
        assert.equal(themes.filter(entry => entry.title.endsWith(`(${theme})`)).length, 1);
    }
    for (const entry of themes) assert.equal(entry.projectName, 'chromium-project-url');
    for (const entry of cases) assert.equal(entry.expectedStatus, 'passed', entry.title);
});

test('explicit fixed-input E2E profile selects all fixed cases without capability skips', () => {
    const run = args => {
        const result = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'), 'test',
            '--config', path.join(__dirname, 'playwright.config.cjs'), '--list', '--reporter=json', ...args], {
            cwd: path.resolve(__dirname, '../../..'),
            env: {...process.env, E2E_NATIVE: '0', E2E_FIXED_INPUTS: '1'},
            encoding: 'utf8', timeout: 15_000
        });
        assert.equal(result.status, 0, result.stderr);
        const collect = suite => [...(suite.specs || []), ...(suite.suites || []).flatMap(collect)];
        return JSON.parse(result.stdout).suites.flatMap(collect).flatMap(spec =>
            spec.tests.map(entry => ({...entry, file: spec.file, title: spec.title})));
    };
    const combined = run([]);
    assert.equal(combined.length, 22);
    assert.equal(combined.filter(entry => entry.file === 'fixed-inputs.spec.cjs').length, 5);
    const fixed = run(['--project=chromium-project-url', 'fixed-inputs.spec.cjs']);
    assert.equal(fixed.length, 5);
    for (const entry of fixed) {
        assert.equal(entry.file, 'fixed-inputs.spec.cjs');
        assert.equal(entry.projectName, 'chromium-project-url');
    }
    for (const entry of combined) assert.equal(entry.expectedStatus, 'passed', entry.title);
    const script = require('../../../package.json').scripts['test:e2e:fixed-inputs'];
    assert.equal(script, 'E2E_FIXED_INPUTS=1 playwright test --config test/e2e/turbowarp/playwright.config.cjs ' +
        '--project=chromium-project-url fixed-inputs.spec.cjs');
});

test('native picker profile remains editor-only even when fixed-input opt-in is present', () => {
    // Inspect the macOS-only profile without launching a browser on other CI hosts.
    const result = spawnSync(process.execPath, ['-e',
        `Object.defineProperty(process, 'platform', {value: 'darwin'});` +
        `process.stdout.write(JSON.stringify(require(${JSON.stringify(path.join(__dirname, 'playwright.config.cjs'))})));`], {
        cwd: path.resolve(__dirname, '../../..'),
        env: {...process.env, E2E_NATIVE: '1', E2E_FIXED_INPUTS: '1'}, encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
    const config = JSON.parse(result.stdout);
    assert.equal(config.projects.length, 1);
    assert.equal(config.projects[0].name, 'chrome-macos-native');
    assert.equal(config.projects[0].testMatch, 'editor.spec.cjs');
    assert.equal(config.projects[0].use.channel, 'chrome');
});
