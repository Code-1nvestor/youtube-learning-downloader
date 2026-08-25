import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import type { ChildProcess } from 'node:child_process';
import { PoTokenProviderService } from '../server/services/po-token-provider.service.ts';

test('starts a verified versioned provider on loopback and exposes its immutable profile', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-pot-provider-'));
  const providerRoot = path.join(root, 'resources', 'components', 'bgutil');
  const versionRoot = path.join(providerRoot, 'versions', '1.3.2');
  fs.mkdirSync(path.join(versionRoot, 'server', 'node_modules'), { recursive: true });
  fs.mkdirSync(path.join(versionRoot, 'server', 'src'), { recursive: true });
  fs.mkdirSync(path.join(versionRoot, 'server', 'build'), { recursive: true });
  fs.writeFileSync(path.join(versionRoot, 'server', 'build', 'main.js'), '');
  fs.mkdirSync(path.join(versionRoot, 'plugin'), { recursive: true });
  fs.writeFileSync(path.join(providerRoot, 'active.json'), JSON.stringify({
    version: '1.3.2',
    plugin: 'versions/1.3.2/plugin',
    server: 'versions/1.3.2/server',
  }));

  const observed: { command?: string; args?: string[]; cwd?: string } = {};
  const child = new EventEmitter() as ChildProcess;
  Object.assign(child, {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    kill: () => true,
  });
  const service = new PoTokenProviderService({
    runtimeBinary: 'C:\\Tools\\node.exe',
    appDataPath: path.join(root, 'app-data'),
    resourcePath: path.join(root, 'resources'),
    allocatePort: async () => 4455,
    ping: async () => ({ ok: true, version: '1.3.2' }),
    spawnProvider: (command, args, options) => {
      observed.command = command;
      observed.args = args;
      observed.cwd = options.cwd;
      return child;
    },
  });

  try {
    const status = await service.start();
    assert.equal(status.available, true);
    assert.equal(status.baseUrl, 'http://127.0.0.1:4455');
    assert.equal(observed.command, 'C:\\Tools\\node.exe');
    assert.match(observed.cwd ?? '', /server$/);
    assert.deepEqual(observed.args, [
      '--import',
      'data:text/javascript,process.defaultApp=true',
      path.join(versionRoot, 'server', 'build', 'main.js'),
      '--port',
      '4455',
    ]);
    assert.deepEqual(service.getRuntimeConfig(), {
      pluginPath: path.join(versionRoot, 'plugin'),
      baseUrl: 'http://127.0.0.1:4455',
      version: '1.3.2',
    });
  } finally {
    service.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects an active manifest that escapes the component directory', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-pot-provider-'));
  const providerRoot = path.join(root, 'resources', 'components', 'bgutil');
  fs.mkdirSync(providerRoot, { recursive: true });
  fs.writeFileSync(path.join(providerRoot, 'active.json'), JSON.stringify({
    version: 'bad',
    plugin: '../outside.zip',
    server: '../outside',
  }));
  const service = new PoTokenProviderService({
    runtimeBinary: 'node',
    appDataPath: path.join(root, 'app-data'),
    resourcePath: path.join(root, 'resources'),
  });
  try {
    assert.equal((await service.start()).available, false);
    assert.equal(service.getRuntimeConfig(), undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
