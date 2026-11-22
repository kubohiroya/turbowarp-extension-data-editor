import {copyFile} from 'node:fs/promises';

for (const name of ['react.css', 'plus.css']) {
    await copyFile(new URL(`../src/${name}`, import.meta.url), new URL(`../dist/${name}`, import.meta.url));
}
