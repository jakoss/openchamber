import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createReferenceConfigManager } from './reference-config.js';
import { readConfigFile, writeConfig } from './shared.js';

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-reference-test-'));
  roots.push(root);
  const global = path.join(root, 'global');
  const project = path.join(root, 'project');
  fs.mkdirSync(global);
  fs.mkdirSync(project);
  const manager = createReferenceConfigManager({ configDirectory: global, readConfigFile, writeConfig });
  return { root, global, project, manager };
}

describe('reference config', () => {
  it('preserves an invalid sibling while editing a valid reference', () => {
    const { project, manager } = fixture();
    const file = path.join(project, 'opencode.json');
    fs.writeFileSync(file, JSON.stringify({ references: { bad: 123, docs: './docs' } }));
    const result = manager.execute({ method: 'GET', directory: project });
    expect(result.entries.map((entry) => entry.name)).toContain('docs');
    expect(result.errors).toContainEqual({ path: file });
    manager.execute({ method: 'PATCH', directory: project, scope: 'project', name: 'docs', config: { path: '.' } });
    expect(readConfigFile(file).references.bad).toBe(123);
  });
  it('pins edit and delete to a discovered source in the requested scope', () => {
    const { root, project, manager } = fixture();
    const parentFile = path.join(root, 'opencode.json');
    const projectFile = path.join(project, 'opencode.json');
    for (const file of [parentFile, projectFile]) fs.writeFileSync(file, JSON.stringify({ references: { docs: './docs' } }));
    manager.execute({ method: 'PATCH', directory: project, scope: 'project', name: 'docs', sourcePath: parentFile, config: { path: './guide' } });
    expect(readConfigFile(parentFile).references.docs.path).toBe('./guide');
    expect(readConfigFile(projectFile).references.docs).toBe('./docs');
    expect(() => manager.execute({ method: 'DELETE', directory: project, scope: 'user', name: 'docs', sourcePath: parentFile })).toThrow('not found');
    manager.execute({ method: 'DELETE', directory: project, scope: 'project', name: 'docs', sourcePath: parentFile });
    expect(readConfigFile(parentFile).references.docs).toBeUndefined();
    expect(readConfigFile(projectFile).references.docs).toBe('./docs');
  });
  it('creates in explicit scopes and preserves JSONC comments and unrelated settings', () => {
    const { global, project, manager } = fixture();
    const file = path.join(project, 'opencode.jsonc');
    fs.writeFileSync(file, '{\n// keep this\n"model": "x/y",\n"references": {"docs": "../docs"}\n}\n');
    manager.execute({ method: 'PATCH', directory: project, scope: 'project', name: 'docs', config: { path: '../docs', description: 'Guidance' } });
    expect(fs.readFileSync(file, 'utf8')).toContain('// keep this');
    expect(readConfigFile(file).model).toBe('x/y');
    manager.execute({ method: 'POST', directory: project, scope: 'user', name: 'sdk', config: { repository: 'org/sdk' } });
    expect(readConfigFile(path.join(global, 'opencode.json')).references.sdk.repository).toBe('org/sdk');
  });
  it('discovers ancestor and .opencode entries without baking resolved paths into config', () => {
    const { root, project, manager } = fixture();
    fs.mkdirSync(path.join(root, 'docs'));
    fs.writeFileSync(path.join(root, 'opencode.json'), JSON.stringify({ references: { docs: './docs' } }));
    fs.mkdirSync(path.join(project, '.opencode'));
    fs.writeFileSync(path.join(project, '.opencode', 'opencode.json'), JSON.stringify({ references: { docs: { path: '../../missing', hidden: true } } }));
    const result = manager.execute({ method: 'GET', directory: project });
    const docs = result.entries.filter((entry) => entry.name === 'docs');
    expect(docs.map((entry) => entry.overridden)).toEqual([true, false]);
    expect(docs[0].availability).toBe('available');
    expect(docs[1].availability).toBe('missing');
    expect(docs[1].config.path).toBe('../../missing');
  });
  it('renames atomically within the original file and refuses collisions', () => {
    const { project, manager } = fixture();
    const create = (name) => manager.execute({ method: 'POST', directory: project, scope: 'project', name, config: { path: '.' } });
    create('docs'); create('sdk');
    expect(() => manager.execute({ method: 'PATCH', directory: project, scope: 'project', previousName: 'docs', name: 'sdk', config: { path: '.' } })).toThrow('already exists');
    manager.execute({ method: 'PATCH', directory: project, scope: 'project', previousName: 'docs', name: 'guide', config: { path: '.' } });
    expect(readConfigFile(path.join(project, 'opencode.json')).references).toEqual({ guide: { path: '.' }, sdk: { path: '.' } });
    manager.execute({ method: 'DELETE', directory: project, scope: 'project', name: 'guide' });
    expect(readConfigFile(path.join(project, 'opencode.json')).references).toEqual({ sdk: { path: '.' } });
  });
  it('isolates malformed layers on read and never overwrites a malformed target', () => {
    const { global, project, manager } = fixture();
    fs.writeFileSync(path.join(global, 'opencode.json'), '{"references": {"docs": "../docs"}}');
    const file = path.join(project, 'opencode.json');
    fs.writeFileSync(file, '{"model":');
    const result = manager.execute({ method: 'GET', directory: project });
    expect(result.entries.some((entry) => entry.name === 'docs')).toBe(true);
    expect(result.errors).toContainEqual({ path: file });
    expect(() => manager.execute({ method: 'POST', directory: project, scope: 'project', name: 'sdk', config: { path: '.' } })).toThrow();
    expect(fs.readFileSync(file, 'utf8')).toBe('{"model":');
  });
  it('rejects invalid aliases, local repositories, credentials and unsafe branches', () => {
    const { project, manager } = fixture();
    const create = (name, config) => manager.execute({ method: 'POST', directory: project, scope: 'project', name, config });
    for (const name of ['', 'a/b', 'a\\b', 'a b', 'a`b', 'a,b']) expect(() => create(name, { path: '.' })).toThrow();
    for (const repository of ['file:///tmp/repo', 'https://user:secret@example.com/repo', '../repo', 'repo']) {
      expect(() => create('docs', { repository })).toThrow();
    }
    for (const branch of ['-main', 'a..b', 'a b', '']) expect(() => create('docs', { repository: 'org/repo', branch })).toThrow();
    create('docs', { repository: 'git@example.com:org/repo.git', branch: 'release/v2' });
  });
});
