import assert from 'node:assert/strict';
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {commentBody, requestAPI, pages} from './report-weekly-ci.ts';
import {repository} from './assert-rerun-probe.ts';

export const issuePath = `/repos/${repository}/issues/26/comments`;
export async function postLocalReport(report, env, {fetchImpl = fetch} = {}) {
    assert.equal(env.GITHUB_REPOSITORY, repository);
    assert.equal(env.GITHUB_REF, 'refs/heads/main');
    assert.equal(env.CI_RERUN_REPORT_ENABLED, 'true');
    assert.equal(report.reporterSha, env.GITHUB_SHA);
    assert.ok(env.GH_TOKEN);
    const body = commentBody(report).replace('この文面は共通GitHub Actionsが生成した検証結果の草案です。',
        'このコメントは共通GitHub Actionsによる定型自動報告です。');
    const api = requestAPI(env.GH_TOKEN, fetchImpl);
    const fresh = await api(`/repos/${repository}/actions/runs/${report.source.id}`);
    for (const [key, value] of Object.entries({run_attempt: report.source.attempt, status: 'completed',
        conclusion: report.source.conclusion, head_sha: report.source.sha, event: 'schedule', head_branch: 'main'})) {
        assert.equal(fresh[key], value, 'Source attempt changed before reporting');
    }
    assert.equal(fresh.repository?.full_name, repository);
    const marker = body.split('\n')[0];
    const find = async () => (await pages(api, issuePath)).find(c => c.user?.login === 'github-actions[bot]' &&
        c.user.type === 'Bot' && c.body?.includes(marker));
    const existing = await find();
    if (existing) return {status: 'already-posted', id: existing.id};
    // The sole write endpoint is this repository's approved operations Issue.
    try {
        const response = await fetchImpl(`https://api.github.com${issuePath}`, {
            method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
            headers: {Accept: 'application/vnd.github+json', Authorization: `Bearer ${env.GH_TOKEN}`,
                'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28'}, body: JSON.stringify({body})
        });
        assert.ok(response.ok, 'Issue comment not accepted');
        const value = await response.json();
        assert.ok(Number.isSafeInteger(value.id) && value.id > 0);
        assert.equal(value.user?.login, 'github-actions[bot]');
        return {status: 'posted', id: value.id};
    } catch {
        const recovered = await find();
        if (recovered) return {status: 'already-posted', id: recovered.id};
        throw new Error('Posting failed or uncertain; no automatic second POST');
    }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const report = JSON.parse(readFileSync('verified-report/report.json', 'utf8'));
        const result = await postLocalReport(report, process.env);
        mkdirSync('test-results/ci-weekly-publication', {recursive: true});
        writeFileSync('test-results/ci-weekly-publication/result.json', JSON.stringify(result) + '\n');
        console.log(`Operations Issue report: ${result.status}`);
    } catch {console.error('Operations Issue reporting failed; no credentials or raw responses are logged.'); process.exitCode = 1;}
}
