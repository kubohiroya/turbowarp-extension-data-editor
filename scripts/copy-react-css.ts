import {copyFile} from 'node:fs/promises';

await copyFile(new URL('../src/react.css', import.meta.url), new URL('../dist/react.css', import.meta.url));
