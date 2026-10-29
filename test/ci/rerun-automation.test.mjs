import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import YAML from 'yaml';
import {configuration, exerciseReruns, githubAPI, weeklyCron} from '../../scripts/ci/test-latest-attempt.mjs';
import {fixtureFile, marker, probeFile, repository, scenarios, verifyDecision} from '../../scripts/ci/assert-rerun-probe.mjs';

const env = {GITHUB_REPOSITORY: repository, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_SHA: 'a'.repeat(40),
    GITHUB_REF: 'refs/heads/main', GITHUB_RUN_ID: '99', GITHUB_RUN_ATTEMPT: '1', GH_TOKEN: 'secret-token'};
const config = configuration(env);
const iso = milliseconds => new Date(milliseconds).toISOString();
const decision = (attempt = 1) => ({repository, workflowFile: fixtureFile, expectedRevision: config.sha,
    branch: config.branch, event: 'workflow_dispatch', runId: 100, attempt, status: 'completed',
    conclusion: attempt === 2 ? 'failure' : 'success', decision: attempt === 2 ? 'rejected' : 'accepted',
    reason: attempt === 2 ? 'Normal CI concluded failure' : 'Latest matching normal CI workflow succeeded', observedAt: iso(100)});

function server(options = {}, driverConfig = config) {
    let clock = 0, id = 100, fixture, history = {}, lag = false;
    const runs = [], mutations = [], records = [];
    const base = (workflow, title) => ({id: id++, workflow_id: workflow, run_number: id, run_attempt: 1,
        repository: {full_name: repository}, head_repository: {full_name: repository},
        head_sha: config.sha, head_branch: config.branch, event: 'workflow_dispatch', display_title: title,
        status: 'in_progress', conclusion: null});
    const finishFixture = () => {
        fixture.status = 'completed'; fixture.conclusion = fixture.run_attempt === 2 ? 'failure' : 'success';
        fixture.completed_at = iso(clock); history[fixture.run_attempt] = structuredClone(fixture);
    };
    const finishObserver = run => {
        if (run.status === 'completed' || fixture.status !== 'completed') return;
        run.status = 'completed'; run.conclusion = fixture.conclusion;
        const success = run.conclusion === 'success';
        run.proof = {...decision(fixture.run_attempt), scenario: run.scenario, runId: fixture.id,
            observedAt: iso(clock + 100), gate: run.conclusion, sentinel: success ? 'success' : 'skipped'};
        if (options.wrongProof && run.scenario === 'pending-failure') run.proof.attempt = 1;
    };
    const jobs = run => {
        if (fixture.status === 'in_progress') {
            return [{id: run.id * 10, name: 'gate / gate', status: 'in_progress', conclusion: null,
                steps: [{name: 'Require the latest matching normal CI to succeed', status: 'in_progress'}]},
                ...(options.premature ? [{name: 'publish-sentinel', status: 'completed', conclusion: 'success', started_at: iso(clock)}] : [])];
        }
        finishObserver(run);
        return [{id: run.id * 10, name: 'gate / gate', status: 'completed', conclusion: run.conclusion, completed_at: iso(clock + 200)},
            {id: run.id * 10 + 1, name: 'publish-sentinel', status: 'completed',
                conclusion: run.conclusion === 'success' ? 'success' : 'skipped', started_at: iso(clock + (options.badOrder ? 0 : 300))},
            {id: run.id * 10 + 2, name: 'assert-probe', status: 'completed', conclusion: 'success'}];
    };
    const api = async (path, method = 'GET', body) => {
        if (options.apiError) throw new Error('GitHub test API returned HTTP 403');
        if (method === 'POST') {
            mutations.push({path, body});
            if (path.endsWith('/dispatches')) {
                const workflow = Number(path.split('/')[2]);
                assert.ok([42, 43].includes(workflow));
                assert.equal(body.ref, 'main'); assert.equal(body.inputs.expected_revision, config.sha);
                if (workflow === 42) {
                    fixture = base(42, `CI rerun fixture ${config.suite}`); runs.push(fixture); finishFixture();
                } else {
                    const scenario = body.inputs.scenario;
                    assert.equal(body.inputs.fixture_run_id, String(fixture.id));
                    const run = {...base(43, `CI rerun observer ${config.suite} ${scenario}`), scenario};
                    runs.push(run); finishObserver(run);
                }
                return;
            }
            assert.equal(path, `actions/runs/${fixture.id}/rerun`);
            fixture.run_attempt++; fixture.status = 'in_progress'; fixture.conclusion = null; lag = !!options.registrationLag;
            if (options.missedWindow) finishFixture();
            return;
        }
        if (path.startsWith('branches/')) return {commit: {sha: options.branchMoved && runs.length > 1 ? 'b'.repeat(40) : config.sha}};
        if (path === `actions/workflows/${fixtureFile}`) return {id: 42, path: `.github/workflows/${fixtureFile}`, state: 'active'};
        if (path === `actions/workflows/${probeFile}`) return {id: 43, path: `.github/workflows/${probeFile}`, state: 'active'};
        const listing = path.match(/^actions\/workflows\/(\d+)\/runs\?/);
        if (listing) {
            if (options.noRegistration) return {total_count: 0, workflow_runs: []};
            let list = runs.filter(run => run.workflow_id === Number(listing[1]));
            if (options.foreignRun && mutations.some(m => m.path.endsWith('/rerun')) && Number(listing[1]) === 42) {
                list = [...list, {...fixture, id: 999, run_number: 999}];
            }
            if (options.ambiguous && Number(listing[1]) === 43) list = [...list, ...list];
            return {total_count: list.length, workflow_runs: structuredClone(list)};
        }
        const historical = path.match(/^actions\/runs\/(\d+)\/attempts\/(\d+)(\/jobs)?$/);
        if (historical) {
            const run = history[Number(historical[2])]; assert.ok(run);
            return historical[3] ? {total_count: 1, jobs: [{name: 'fixture', completed_at: run.completed_at}]} : structuredClone(run);
        }
        const detail = path.match(/^actions\/runs\/(\d+)(\/jobs\?per_page=100)?$/);
        if (detail) {
            const run = runs.find(run => run.id === Number(detail[1])); assert.ok(run, path);
            if (detail[2]) { const list = jobs(run); return {total_count: list.length, jobs: structuredClone(list)}; }
            if (run !== fixture) finishObserver(run);
            const result = structuredClone(run);
            if (lag && run === fixture) { lag = false; result.run_attempt--; result.status = 'queued'; }
            if (options.wrongHead && run === fixture) result.head_sha = 'b'.repeat(40);
            return result;
        }
        throw new Error(`Unexpected test API path ${path}`);
    };
    api.logs = async jobId => {
        const run = runs.find(run => run.id * 10 + 2 === jobId); assert.ok(run);
        return options.missingProof ? 'No proof\n' : `timestamp ${marker}${JSON.stringify(run.proof)}\n`;
    };
    return {mutations, records, execute: () => exerciseReruns(driverConfig, {api, now: () => clock, intervalMs: 10,
        timeoutMs: 200, pause: async ms => {
            clock += ms;
            if (!options.neverComplete && fixture?.status === 'in_progress' && runs.some(run => run !== fixture && run.status === 'in_progress')) finishFixture();
        }, record: value => records.push(value)})};
}

test('the full suite preserves one SHA/run across three attempts and four observers', async () => {
    const h = server({registrationLag: true}); const result = await h.execute();
    assert.equal(result.status, 'success');
    assert.equal(result.trigger, 'workflow_dispatch');
    assert.equal(result.schedule, undefined);
    assert.deepEqual(Object.keys(result.probes), Object.keys(scenarios));
    assert.equal(result.fixture.id, 100);
    assert.deepEqual(Object.values(result.probes).map(p => p.proof.attempt), [1, 2, 2, 3]);
    assert.equal(Object.keys(result.pending).length, 2);
    assert.equal(h.mutations.length, 7);
    assert.deepEqual(h.mutations.filter(m => m.path.endsWith('/rerun')).map(m => m.path), Array(2).fill('actions/runs/100/rerun'));
    assert.ok(h.mutations.every(m => /^actions\/(workflows\/(42|43)\/dispatches|runs\/100\/rerun)$/.test(m.path)));
    assert.ok(!JSON.stringify(result).includes('secret-token'));
});

for (const [option, pattern] of [['premature', /Downstream started/], ['wrongProof', /Wrong gate attempt/],
    ['wrongHead', /Unexpected run head_sha/], ['branchMoved', /Source branch advanced/],
    ['ambiguous', /Ambiguous/], ['foreignRun', /interfered/], ['missedWindow', /Pending window missed/],
    ['missingProof', /Missing or ambiguous/], ['badOrder', /before the latest CI success/],
    ['neverComplete', /Timed out/], ['noRegistration', /Timed out/], ['apiError', /HTTP 403/]]) {
    test(`suite rejects ${option} and preserves partial failure evidence`, async () => {
        const h = server({[option]: true});
        await assert.rejects(h.execute(), pattern);
        assert.equal(h.records.at(-1).status, 'failure');
        assert.match(h.records.at(-1).reason, pattern);
    });
}


test('weekly schedule uses the full unchanged suite and records the actual trigger', async () => {
    const scheduled = configuration({...env, GITHUB_EVENT_NAME: 'schedule', CI_SCHEDULE: weeklyCron});
    const result = await server({}, scheduled).execute();
    assert.equal(result.status, 'success');
    assert.equal(result.trigger, 'schedule');
    assert.equal(result.schedule, '37 2 * * 1');
    assert.deepEqual(Object.keys(result.probes), Object.keys(scenarios));
    assert.equal(result.mutations.length, 7);
    assert.ok(Object.values(result.probes).every(probe => probe.ci.event === 'workflow_dispatch'));
});

test('schedule refuses non-main refs and missing or unexpected cron', () => {
    for (const patch of [{GITHUB_REF: 'refs/heads/feature'}, {GITHUB_REF: 'refs/tags/v1'},
        {CI_SCHEDULE: ''}, {CI_SCHEDULE: '17 2 * * 1'}]) {
        assert.throws(() => configuration({...env, GITHUB_EVENT_NAME: 'schedule', CI_SCHEDULE: weeklyCron, ...patch}));
    }
});

test('observer verifies full decision identity, latest attempt and expected failure reason', () => {
    const expected = {sha: config.sha, branch: 'main', runId: 100, scenario: 'failed-fresh', gate: 'failure', sentinel: 'skipped'};
    assert.equal(verifyDecision(decision(2), expected).attempt, 2);
    for (const patch of [{runId: 101}, {attempt: 1}, {expectedRevision: 'b'.repeat(40)}, {event: 'push'},
        {branch: 'other'}, {workflowFile: 'ci.yml'}, {repository: 'other/repo'}, {conclusion: 'success'},
        {decision: 'accepted'}, {observedAt: 'bad'}, {reason: 'GitHub API unavailable'}]) {
        assert.throws(() => verifyDecision({...decision(2), ...patch}, expected));
    }
});

test('driver configuration cannot target unrelated repos, tags or unsupported events', () => {
    for (const [key, value] of [['GITHUB_REPOSITORY', 'example/unrelated-project'], ['GITHUB_REF', 'refs/tags/v1'],
        ['GITHUB_EVENT_NAME', 'push'], ['GITHUB_SHA', 'main'], ['GITHUB_RUN_ID', '0'],
        ['GITHUB_RUN_ATTEMPT', 'bad'], ['GH_TOKEN', ''], ['GITHUB_API_URL', 'https://other.example']]) {
        assert.throws(() => configuration({...env, [key]: value}));
    }
});

test('log redirect never receives the repository token; HTTP/network errors fail closed', async () => {
    const calls = [];
    const api = githubAPI(config, async (url, options) => {
        calls.push({url, options});
        return calls.length === 1 ? {status: 302, headers: new Headers({location: 'https://logs.example/signed'})} :
            {ok: true, text: async () => 'proof'};
    });
    assert.equal(await api.logs(12), 'proof');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer secret-token');
    assert.equal(calls[1].options.headers, undefined);
    assert.equal(calls[1].options.redirect, 'error');
    for (const location of ['http://logs.example', 'https://user:pass@logs.example']) {
        await assert.rejects(githubAPI(config, async () => ({status: 302, headers: new Headers({location})})).logs(12), /Unsafe/);
    }
    await assert.rejects(githubAPI(config, async () => {throw new Error('secret-token');})('branches/main'),
        error => !error.message.includes('secret-token'));
    await assert.rejects(githubAPI(config, async () => ({ok: false, status: 403}))('branches/main'), /HTTP 403/);
});

const workflow = file => YAML.parse(readFileSync(new URL(`../../.github/workflows/${file}`, import.meta.url), 'utf8'));
test('rerun workflows stay manual and never gain deployment permissions', () => {
    for (const file of ['ci-gate-rerun-test.yml', fixtureFile, probeFile]) {
        const w = workflow(file);
        assert.deepEqual(Object.keys(w.on), ['workflow_dispatch']);
        assert.equal(w.permissions.contents, 'read');
        for (const job of Object.values(w.jobs)) {
            assert.equal(job.environment, undefined);
            const permissions = job.permissions || w.permissions;
            assert.equal(permissions.pages, undefined); assert.equal(permissions['id-token'], undefined);
            assert.equal(permissions.contents, 'read');
            assert.equal(permissions.actions, file === 'ci-gate-rerun-test.yml' ? 'write' : file === probeFile ? 'read' : undefined);
            assert.doesNotMatch(JSON.stringify(job), /deploy-pages|npm publish|secrets: inherit/);
        }
    }
    for (const file of ['ci-gate-rerun-report.yml']) {
        assert.deepEqual(Object.keys(workflow(file).on), ['workflow_dispatch']);
    }
    const observer = workflow(probeFile);
    assert.equal(observer.jobs.gate.uses, './.github/workflows/require-successful-ci.yml');
    assert.equal(observer.jobs.gate.with.workflow_file, fixtureFile);
    assert.equal(observer.jobs.gate.with.event, 'workflow_dispatch');
    assert.equal(observer.jobs['publish-sentinel'].needs, 'gate');
    assert.equal(observer.jobs['publish-sentinel'].if, undefined);
});

test('the fixture executes success/failure/success and refuses extra attempts or mixed source', () => {
    const code = workflow(fixtureFile).jobs.fixture.steps[0].run.split("node <<'JS'\n")[1].split('\nJS')[0];
    for (const attempt of [1, 2, 3]) {
        let status, delay;
        vm.runInNewContext(code, {process: {env: {...env, EXPECTED_REVISION: env.GITHUB_SHA, SUITE_ID: '99-1', GITHUB_RUN_ATTEMPT: String(attempt)},
            exit: value => {status = value;}}, console: {log() {}}, setTimeout: (fn, ms) => {delay = ms; fn();}});
        assert.equal(status, attempt === 2 ? 1 : 0); assert.equal(delay, attempt === 1 ? 0 : 180_000);
    }
    assert.throws(() => vm.runInNewContext(code, {process: {env: {...env, EXPECTED_REVISION: env.GITHUB_SHA,
        SUITE_ID: '99-1', GITHUB_RUN_ATTEMPT: '4'}}}), /Only three/);
    for (const patch of [{EXPECTED_REVISION: 'b'.repeat(40)}, {GITHUB_REPOSITORY: 'example/unrelated-project'}, {SUITE_ID: 'other'}]) {
        assert.throws(() => vm.runInNewContext(code, {process: {env: {...env, EXPECTED_REVISION: env.GITHUB_SHA,
            SUITE_ID: '99-1', ...patch}}}), /Invalid fixture/);
    }
});

test('CLI configuration errors fail before mutation and preserve a summary/artifact without secrets', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ci-rerun-driver-'));
    try {
        const result = spawnSync(process.execPath, [new URL('../../scripts/ci/test-latest-attempt.mjs', import.meta.url).pathname],
            {cwd: dir, env: {...env, GITHUB_REPOSITORY: 'other/repo', GITHUB_STEP_SUMMARY: join(dir, 'summary.md')}, encoding: 'utf8'});
        assert.equal(result.status, 1);
        const text = readFileSync(join(dir, 'test-results/ci-rerun-test/evidence.json'), 'utf8');
        assert.equal(JSON.parse(text).status, 'failure'); assert.ok(!text.includes('secret-token'));
        assert.match(readFileSync(join(dir, 'summary.md'), 'utf8'), /Latest CI attempt test: failure/);
    } finally { rmSync(dir, {recursive: true, force: true}); }
});
