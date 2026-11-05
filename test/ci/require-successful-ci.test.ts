import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {configuration, requireSuccessfulCI} from '../../scripts/ci/require-successful-ci.ts';

const env = {GITHUB_REPOSITORY: 'owner/gui', GH_TOKEN: 'secret-token',
    EXPECTED_REVISION: 'a'.repeat(40), CI_WORKFLOW_FILE: 'node.js.yml', CI_BRANCH: 'develop', CI_EVENT: 'push'};
const config = configuration(env);
const workflow = {id: 42, path: '.github/workflows/node.js.yml', state: 'active'};
const run = (patch = {}) => ({id: 101, run_number: 2, run_attempt: 1, workflow_id: 42,
    repository: {full_name: 'owner/gui'}, head_repository: {full_name: 'owner/gui'},
    head_sha: env.EXPECTED_REVISION, head_branch: 'develop', event: 'push',
    html_url: 'https://github.com/owner/gui/actions/runs/101', status: 'completed', conclusion: 'success', ...patch});
const listing = runs => ({total_count: runs.length, workflow_runs: runs});
function harness(responses, options = {}) {
    const reports = [];
    const urls = [];
    let clock = 0;
    let index = 0;
    return {reports, urls, execute: () => requireSuccessfulCI(config, {
        now: () => clock, sleep: async ms => { clock += ms; }, timeoutMs: 100, intervalMs: 10,
        report: value => reports.push(value),
        fetchImpl: async (url, request) => {
            urls.push(url);
            assert.equal(request.headers.Authorization, 'Bearer secret-token');
            assert.equal(request.redirect, 'error');
            assert.ok(index < responses.length, `Unexpected API request ${url}`);
            const response = responses[index++];
            if (response instanceof Error) throw response;
            return response?.httpError ? {ok: false, status: response.httpError} :
                {ok: true, json: async () => { if (response?.badJSON) throw new Error('secret-token'); return response; }};
        }, ...options
    })};
}
const success = item => [workflow, listing([item]), item, listing([item]), item];

test('only a fully verified successful workflow passes, with evidence and exact API filters', async () => {
    const h = harness(success(run()));
    const result = await h.execute();
    assert.equal(result.decision, 'accepted');
    assert.equal(result.runId, 101);
    assert.equal(result.attempt, 1);
    assert.equal(result.workflowId, 42);
    assert.equal(result.expectedRevision, env.EXPECTED_REVISION);
    assert.match(h.urls[1], /workflows\/42\/runs\?head_sha=a{40}&branch=develop&event=push&per_page=100$/);
    assert.ok(h.reports.every(value => !JSON.stringify(value).includes('secret-token')));
});

test('registration and pending CI wait, then accept latest attempt without restarting CI', async () => {
    const queued = run({run_attempt: 2, status: 'queued', conclusion: null});
    const completed = run({run_attempt: 2});
    const h = harness([workflow, listing([]), listing([queued]), queued, listing([completed]), completed,
        listing([completed]), completed]);
    assert.equal((await h.execute()).attempt, 2);
    assert.ok(h.reports.some(value => value.reason.includes('register')));
});

test('a newer failed run wins over an older successful run regardless of list order', async () => {
    const old = run({id: 100, run_number: 1, html_url: 'https://github.com/owner/gui/actions/runs/100'});
    const failed = run({conclusion: 'failure'});
    const h = harness([workflow, listing([old, failed]), failed]);
    await assert.rejects(h.execute(), /concluded failure/);
    assert.equal(h.reports.at(-1).decision, 'rejected');
});

test('a newer in-progress run never falls back to an older success', async () => {
    const old = run({id: 100, run_number: 1, html_url: 'https://github.com/owner/gui/actions/runs/100'});
    const busy = run({status: 'in_progress', conclusion: null});
    const h = harness([workflow, ...Array.from({length: 10}, () => [listing([old, busy]), busy]).flat()]);
    await assert.rejects(h.execute(), /Timed out/);
});

for (const conclusion of ['failure', 'cancelled', 'timed_out', 'skipped', 'neutral', 'action_required', null]) {
    test(`completed ${conclusion} rejects publication`, async () => {
        const item = run({conclusion});
        await assert.rejects(harness([workflow, listing([item]), item]).execute(), /Normal CI concluded/);
    });
}

test('a rerun discovered between list/detail or the final acceptance cannot pass from stale success', async () => {
    const old = run();
    const busy = run({run_attempt: 2, status: 'in_progress', conclusion: null});
    const failed = run({run_attempt: 2, conclusion: 'failure'});
    for (const responses of [
        [workflow, listing([old]), busy, listing([failed]), failed],
        [workflow, listing([old]), old, listing([busy]), listing([failed]), failed],
        [workflow, listing([old]), old, listing([old]), busy, listing([failed]), failed]
    ]) await assert.rejects(harness(responses).execute(), /concluded failure/);
});

test('a new run arriving during the final check must be checked', async () => {
    const old = run();
    const latest = run({id: 102, run_number: 3, html_url: 'https://github.com/owner/gui/actions/runs/102', conclusion: 'failure'});
    await assert.rejects(harness([workflow, listing([old]), old, listing([old, latest]),
        listing([latest]), latest]).execute(), /concluded failure/);
});

for (const patch of [
    {head_sha: 'b'.repeat(40)}, {head_branch: 'feature'}, {event: 'pull_request'}, {workflow_id: 99},
    {repository: {full_name: 'other/gui'}}, {head_repository: {full_name: 'fork/gui'}},
    {id: 0}, {run_number: 0}, {run_attempt: 0}, {html_url: 'https://example.com'}
]) test(`reject unverified run identity ${JSON.stringify(patch)}`, async () => {
    await assert.rejects(harness([workflow, listing([run(patch)])]).execute(), /identity/);
});

test('identity must still match in detail/final responses; old attempts and unknown states reject', async () => {
    const item = run();
    for (const detail of [run({head_sha: 'b'.repeat(40)}), run({id: 102,
        html_url: 'https://github.com/owner/gui/actions/runs/102'}), run({run_attempt: 0}),
        run({status: 'mystery', conclusion: null}), run({status: 'queued', conclusion: 'success'})]) {
        await assert.rejects(harness([workflow, listing([item]), detail]).execute());
    }
    await assert.rejects(harness([workflow, listing([item]), item, listing([item]),
        run({head_branch: 'other'})]).execute(), /identity/);
});

test('missing runs time out; malformed or truncated results never pass', async () => {
    await assert.rejects(harness([workflow, ...Array(10).fill(listing([]))]).execute(), /Timed out/);
    for (const result of [{}, {workflow_runs: [], total_count: 1}, {workflow_runs: [], total_count: 101}]) {
        await assert.rejects(harness([workflow, result]).execute(), /Incomplete/);
        const item = run();
        await assert.rejects(harness([workflow, listing([item]), item, result]).execute(), /Incomplete/);
    }
});

test('workflow identity and API errors fail closed without echoing secrets', async () => {
    for (const response of [{...workflow, id: 0}, {...workflow, path: '.github/workflows/pages.yml'},
        {...workflow, state: 'disabled_manually'}, {httpError: 403}, {httpError: 500},
        {badJSON: true}, new Error('secret-token')]) {
        const h = harness([response]);
        await assert.rejects(h.execute(), error => !error.message.includes('secret-token'));
        assert.equal(h.reports.at(-1).decision, 'rejected');
    }
});

test('configuration rejects missing credentials, mutable SHA and unsafe API input', () => {
    for (const [key, value] of [['GITHUB_REPOSITORY', 'bad'], ['EXPECTED_REVISION', 'develop'],
        ['EXPECTED_REVISION', `${'a'.repeat(40)}\n`], ['CI_WORKFLOW_FILE', '../pages.yml'],
        ['CI_BRANCH', 'develop?x'], ['CI_EVENT', 'push x'], ['GH_TOKEN', ''],
        ['GITHUB_API_URL', 'http://example.com'], ['GITHUB_API_URL', 'https://user:pass@example.com']]) {
        assert.throws(() => configuration({...env, [key]: value}), undefined, key);
    }
});

test('CLI configuration rejection exits nonzero and preserves safe evidence and summary', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ci-gate-'));
    try {
        const summary = join(dir, 'summary.md');
        const result = spawnSync(process.execPath, [new URL('../../scripts/ci/require-successful-ci.ts', import.meta.url).pathname],
            {cwd: dir, env: {...env, EXPECTED_REVISION: 'develop', GITHUB_STEP_SUMMARY: summary}, encoding: 'utf8'});
        assert.equal(result.status, 1);
        const evidence = readFileSync(join(dir, 'test-results/ci-gate/decision.json'), 'utf8');
        assert.equal(JSON.parse(evidence).decision, 'rejected');
        assert.match(readFileSync(summary, 'utf8'), /publication gate: rejected/);
        assert.ok(!`${result.stderr}${evidence}`.includes('secret-token'));
    } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('shared workflows keep token privileges read-only and preserve skip propagation', () => {
    const gate = readFileSync(new URL('../../.github/workflows/require-successful-ci.yml', import.meta.url), 'utf8');
    const probe = readFileSync(new URL('../../.github/workflows/ci-gate-probe.yml', import.meta.url), 'utf8');
    assert.doesNotMatch(gate + probe, /(?:pages|id-token|contents|actions): write/);
    assert.match(gate, /repository: kubohiroya\/turbowarp-extension-data-editor/);
    assert.match(gate, /ref: \$\{\{ inputs.runner_revision \}\}/);
    assert.match(gate, /timeout-minutes: 35/);
    assert.match(probe, /publish-sentinel:\n    needs: gate/);
    assert.doesNotMatch(probe, /deploy-pages|environment:/);
});
