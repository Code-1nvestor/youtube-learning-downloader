import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSubtitleFileName,
  normalizeSubtitleModeForContainer,
  parseSubtitleLanguages,
} from '../client/src/utils/subtitles.ts';

test('subtitle language parsing is disabled when subtitles are not requested', () => {
  assert.deepEqual(parseSubtitleLanguages('none', 'zh-Hans,en'), []);
});

test('subtitle filenames are safe on Windows', () => {
  assert.equal(
    buildSubtitleFileName('课程：第一讲?/结尾. ', 'zh-Hans'),
    '课程：第一讲__结尾.zh-Hans.srt',
  );
});

test('subtitle language parsing trims, removes blanks, and de-duplicates values', () => {
  assert.deepEqual(
    parseSubtitleLanguages('separate', ' zh-Hans, en,zh-Hans, ,ja '),
    ['zh-Hans', 'en', 'ja'],
  );
});

test('downgrades embedded subtitles to a separate SRT for audio-only output', () => {
  assert.equal(normalizeSubtitleModeForContainer('mp3', 'embed'), 'separate');
  assert.equal(normalizeSubtitleModeForContainer('m4a', 'embed'), 'separate');
  assert.equal(normalizeSubtitleModeForContainer('mp4', 'embed'), 'embed');
  assert.equal(normalizeSubtitleModeForContainer('mp3', 'none'), 'none');
});
