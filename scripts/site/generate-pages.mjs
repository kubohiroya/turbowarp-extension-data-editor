import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import content from '../../site/content.mjs';

const repository = 'https://github.com/kubohiroya/scratch-gui';
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const escape = value => String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));

export async function generatePages(output, revision, coreRevision, {siteRevision = coreRevision, licensePath} = {}) {
    if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('A full source revision is required.');
    if (!/^[a-f0-9]{40}$/.test(coreRevision)) throw new Error('A full core source revision is required.');
    if (!/^[a-f0-9]{40}$/.test(siteRevision)) throw new Error('A full site source revision is required.');
    const source = `${repository}/tree/${revision}`;
    const core = `https://github.com/kubohiroya/turbowarp-extension-data-editor/tree/${coreRevision}`;
    const site = `https://github.com/kubohiroya/turbowarp-extension-data-editor/tree/${siteRevision}`;
    await fs.mkdir(path.join(output, 'assets'), {recursive: true});
    for (const file of ['style.css', 'language.js', 'redirect.js', 'site.js', 'github.svg', 'octicons-LICENSE.txt']) {
        await fs.copyFile(path.join(sourceRoot, 'site', file === 'language.js' ? 'language.cjs' : file), path.join(output, 'assets', file));
    }
    for (const [language, text] of Object.entries(content)) {
        const editor = `../editor.html?lang=${language}`;
        const credits = text.credits.map(paragraph => `<p>${paragraph.replace('SOURCE', source).replace('CORE', core)}</p>`).join('\n');
        const html = `<!doctype html>
<html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(text.title)}</title><meta name="description" content="${escape(text.description)}">
<link rel="icon" href="../favicon.ico"><link rel="alternate" hreflang="ja" href="../ja/"><link rel="alternate" hreflang="en" href="../en/">
<link rel="stylesheet" href="../assets/style.css"><script src="../assets/site.js" defer></script></head>
<body><a class="skip" href="#main">${escape(text.skip)}</a><div class="wrap">
<header class="header"><a class="brand" href="../"><span class="mark" aria-hidden="true">↗</span>TurboWarp Extension Data Editor</a>
<nav aria-label="Language and source"><a class="source" href="${site}" aria-label="${escape(text.source)}" title="${escape(text.source)}"><img src="../assets/github.svg" width="24" height="24" alt="" aria-hidden="true"></a><a href="../ja/" lang="ja" hreflang="ja" data-language="ja"${language === 'ja' ? ' aria-current="page"' : ''}>日本語</a><a href="../en/" lang="en" hreflang="en" data-language="en"${language === 'en' ? ' aria-current="page"' : ''}>English</a></nav></header>
<main id="main"><section class="hero"><div><p class="eyebrow">${escape(text.eyebrow)}</p><h1>${text.heading}</h1>
<p class="intro">${escape(text.intro)}</p><span class="badge">${escape(text.badge)}</span>
<div class="actions"><a class="button" href="${editor}">${escape(text.open)}</a><a class="button secondary" href="#try">${escape(text.try)}</a></div>
<p class="small">${escape(text.note)}</p></div>
<div class="preview" role="img" aria-label="${escape(text.caption)}"><div class="preview-top"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div><div class="block"><span class="block-icon">▤</span>scene properties <span class="json">{&quot;duration&quot;: 2}</span></div>
<div class="mock-dialog"><p class="mock-title">${escape(text.mockTitle)}</p><p class="mock-label">${escape(text.mockLabel)}</p><div class="mock-input">${escape(text.mockValue)}</div><p class="mock-label">${escape(text.mockDuration)}</p><div class="mock-input">2</div><div class="mock-footer"><span>${escape(text.cancel)}</span><span class="save">${escape(text.save)}</span></div></div><p class="caption">${escape(text.caption)}</p></div></section>
<section class="section"><h2>${escape(text.featuresHeading)}</h2><div class="features">${text.features.map(([title, description], index) => `<article><span class="number">0${index + 1}</span><h3>${escape(title)}</h3><p>${escape(description)}</p></article>`).join('')}</div></section>
<section class="section try" id="try"><div><h2>${escape(text.tryHeading)}</h2><p class="intro">${escape(text.tryIntro)}</p><a class="button" href="${editor}">${escape(text.open)}</a></div><div><ol class="steps">${text.steps.map(step => `<li>${escape(step)}</li>`).join('')}</ol><label class="small" for="extension-url">${escape(text.urlLabel)}</label><div class="extension-url"><input id="extension-url" data-extension-url readonly value="../static/extensions/block-editor.js"><button type="button" data-copy-extension>${escape(text.copy)}</button></div><textarea data-extension-source hidden readonly aria-label="Sample extension source"></textarea><p class="notice">${escape(text.limits)}</p></div></section>
<section class="section"><div class="credits"><h2>${escape(text.creditsHeading)}</h2>${credits}</div></section></main>
<footer class="footer"><div>${escape(text.footer)}<br>${escape(text.languageNote)}</div><div>${escape(text.build)} <a href="${source}"><code>${revision.slice(0, 7)}</code></a><a href="https://github.com/kubohiroya/turbowarp-extension-data-editor/issues">${escape(text.issues)}</a></div></footer></div>
<!-- The shared TurboWarp Plus header. It inserts itself at the top of the page in a shadow root. -->
<script type="module" src="https://kubohiroya.github.io/turbowarp-plus-site-header/dist/auto.js"></script>
</body></html>`;
        await fs.mkdir(path.join(output, language), {recursive: true});
        await fs.writeFile(path.join(output, language, 'index.html'), html);
    }
    await fs.writeFile(path.join(output, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TurboWarp Extension Data Editor — Choose language / 言語を選択</title><meta name="description" content="An independent TurboWarp fork by kubohiroya. 日本語とEnglishで独自拡張を紹介します。"><link rel="icon" href="favicon.ico"><script src="assets/language.js" defer></script><script src="assets/redirect.js" defer></script><link rel="alternate" hreflang="ja" href="ja/"><link rel="alternate" hreflang="en" href="en/"></head><body><main><h1>TurboWarp Extension Data Editor</h1><p><a href="ja/" lang="ja">日本語</a> · <a href="en/" lang="en">English</a></p><p>An independent TurboWarp fork by kubohiroya.</p></main></body></html>`);
    if (licensePath) await fs.copyFile(licensePath, path.join(output, 'LICENSE'));
    await fs.access(path.join(output, 'LICENSE'));
    await fs.writeFile(path.join(output, '.nojekyll'), '');
    await fs.writeFile(path.join(output, 'build-info.json'), JSON.stringify({
        repository, revision, coreRepository: 'https://github.com/kubohiroya/turbowarp-extension-data-editor', coreRevision,
        siteRepository: 'https://github.com/kubohiroya/turbowarp-extension-data-editor', siteRevision
    }, null, 2) + '\n');
}
