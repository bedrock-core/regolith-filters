import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { discoverI18nLibs } from '../lib/libs.js';

let root;

function writePkg(dir, pkg) {
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
}

afterEach(() => {
	if (root) fs.rmSync(root, { recursive: true, force: true });
	root = undefined;
});

describe('discoverI18nLibs', () => {
	it('finds a declarer behind a non-declaring umbrella package', () => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-libs-'));
		writePkg(root, { name: 'addon', devDependencies: { umbrella: '*' } });
		writePkg(path.join(root, 'node_modules', 'umbrella'), {
			name: 'umbrella',
			dependencies: { declarer: '*' },
		});
		writePkg(path.join(root, 'node_modules', 'declarer'), {
			name: 'declarer',
			bedrockCore: { i18n: { dir: './src/i18n', namespace: 'core' } },
		});

		const libs = discoverI18nLibs(root);
		expect(libs.map((l) => l.name)).toEqual(['declarer']);
		expect(libs[0].namespace).toBe('core');
	});

	it('ignores devDependencies of transitive packages', () => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-libs-'));
		writePkg(root, { name: 'addon', dependencies: { umbrella: '*' } });
		writePkg(path.join(root, 'node_modules', 'umbrella'), {
			name: 'umbrella',
			devDependencies: { declarer: '*' },
		});
		writePkg(path.join(root, 'node_modules', 'declarer'), {
			name: 'declarer',
			bedrockCore: { i18n: { dir: './src/i18n', namespace: 'core' } },
		});

		expect(discoverI18nLibs(root)).toEqual([]);
	});
});
