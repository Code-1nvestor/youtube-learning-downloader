import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildWindowsAclArgs,
  currentWindowsIdentity,
  writeSensitiveTextFileSync,
} from '../server/core/sensitive-file.ts';

test('builds a shell-free Windows ACL command for only the current identity', () => {
  assert.equal(currentWindowsIdentity({ USERDOMAIN: 'WORKSTATION', USERNAME: 'student' }), 'WORKSTATION\\student');
  assert.equal(currentWindowsIdentity({ USERNAME: 'student\nother' }), null);
  assert.deepEqual(
    buildWindowsAclArgs('C:\\Data\\cookies.txt', 'WORKSTATION\\student'),
    ['C:\\Data\\cookies.txt', '/inheritance:r', '/grant:r', 'WORKSTATION\\student:(F)'],
  );
});

test('writes the secret locally and applies the injected Windows ACL without exposing content', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-sensitive-'));
  const filePath = path.join(root, 'cookies.txt');
  const secret = '.youtube.com\tTRUE\t/\tTRUE\t9999999999\tSID\tsecret-value';
  const calls: Array<{ filePath: string; identity: string }> = [];

  try {
    const result = writeSensitiveTextFileSync(filePath, secret, {
      platform: 'win32',
      windowsIdentity: 'WORKSTATION\\student',
      applyWindowsAcl: (target, identity) => calls.push({ filePath: target, identity }),
    });

    assert.equal(fs.readFileSync(filePath, 'utf8'), secret);
    assert.equal(result.protected, true);
    assert.deepEqual(calls, [{ filePath, identity: 'WORKSTATION\\student' }]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('reports ACL failure without placing Cookie content in the warning', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yld-sensitive-failure-'));
  const filePath = path.join(root, 'cookies.txt');
  const secret = 'private-cookie-value';
  const warnings: string[] = [];

  try {
    const result = writeSensitiveTextFileSync(filePath, secret, {
      platform: 'win32',
      windowsIdentity: 'WORKSTATION\\student',
      applyWindowsAcl: () => {
        throw new Error('permission tool failed');
      },
      onWarning: (message) => warnings.push(message),
    });

    assert.equal(result.protected, false);
    assert.equal(fs.readFileSync(filePath, 'utf8'), secret);
    assert.equal(warnings.some((warning) => warning.includes(secret)), false);
    assert.match(warnings.join('\n'), /ACL 加固失败/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
