import assert from 'node:assert/strict';
import {appendFileSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const repository = 'kubohiroya/turbowarp-extension-data-editor';
export const fixtureFile = 'ci-gate-rerun-fixture.yml';
export const probeFile = 'ci-gate-rerun-observer.yml';
export const marker = 'CI_RERUN_PROOF=';
export const scenarios = {
    baseline: {attempt: 1, conclusion: 'success'},
    'pending-failure': {attempt: 2, conclusion: 'failure'},
    'failed-fresh': {attempt: 2, conclusion: 'failure'},
    'success-after-wait': {attempt: 3, conclusion: 'success'}
};

export function verifyDecision(decision, {sha, branch, runId, scenario, gate, sentinel}) {
    const expected = scenarios[scenario];
    assert.ok(expected, 'Unknown rerun scenario');
    assert.match(sha, /^[0-9a-f]{40}$/);
    assert.ok(Number.isSafeInteger(runId) && runId > 0, 'Invalid fixture run ID');
    const success = expected.conclusion === 'success';
    assert.equal(gate, success ? 'success' : 'failure', 'Unexpected gate result');
    assert.equal(sentinel, success ? 'success' : 'skipped', 'Unexpected downstream result');
    const fields = {repository, workflowFile: fixtureFile, expectedRevision: sha, branch,
        event: 'workflow_dispatch', runId, attempt: expected.attempt, status: 'completed',
        conclusion: expected.conclusion, decision: success ? 'accepted' : 'rejected'};
    for (const [key, value] of Object.entries(fields)) assert.equal(decision[key], value, `Wrong gate ${key}`);
    assert.ok(Number.isFinite(Date.parse(decision.observedAt)), 'Missing observation timestamp');
    if (!success) assert.equal(decision.reason, 'Normal CI concluded failure');
    return {scenario, ...fields, observedAt: decision.observedAt, reason: decision.reason, gate, sentinel};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const env = process.env;
    try {
        assert.equal(env.GITHUB_SHA, env.EXPECTED_REVISION, 'Probe source changed');
        const proof = verifyDecision(JSON.parse(readFileSync('gate-evidence/decision.json', 'utf8')), {
            sha: env.EXPECTED_REVISION, branch: env.GITHUB_REF_NAME, runId: Number(env.FIXTURE_RUN_ID),
            scenario: env.SCENARIO, gate: env.GATE_RESULT, sentinel: env.SENTINEL_RESULT
        });
        mkdirSync('test-results/ci-rerun-probe', {recursive: true});
        writeFileSync('test-results/ci-rerun-probe/proof.json', `${JSON.stringify(proof, null, 2)}\n`);
        console.log(marker + JSON.stringify(proof));
        if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY,
            `## Rerun probe: ${proof.scenario}\n\n\`\`\`json\n${JSON.stringify(proof, null, 2)}\n\`\`\`\n`);
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
