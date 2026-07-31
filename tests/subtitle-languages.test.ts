import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSubtitleLanguages } from '../client/src/utils/subtitles.ts';

test('subtitle language parsing is disabled when subtitles are not requested', () => {
  assert.deepEqual(parseSubtitleLanguages('none', 'zh-Hans,en'), []);
});

test('subtitle language parsing trims, removes blanks, and de-duplicates values', () => {
  assert.deepEqual(
    parseSubtitleLanguages('separate', ' zh-Hans, en,zh-Hans, ,ja '),
    ['zh-Hans', 'en', 'ja'],
  );
});
