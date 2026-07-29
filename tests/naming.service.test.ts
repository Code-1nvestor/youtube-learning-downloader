import assert from 'node:assert/strict';
import test from 'node:test';
import { NamingService } from '../server/services/naming.service.ts';

test('sanitizes Windows-invalid characters while preserving folders', () => {
  const result = new NamingService().apply('{course}/{title}.{ext}', {
    course: '课程/第一章',
    date: '2026-07-29',
    title: 'A:B?C*D',
    ext: 'mp4',
  });

  assert.equal(result, '课程_第一章/A_B_C_D.mp4');
});
