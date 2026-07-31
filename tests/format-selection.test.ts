import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildActualFormatChoices,
  buildPresetFormatSelector,
  formatFileSize,
} from '../client/src/utils/formats.ts';

test('actual format choices pair video-only streams with audio and infer safe containers', () => {
  const choices = buildActualFormatChoices([
    {
      formatId: '137',
      container: 'mp4',
      qualityLabel: '1080p',
      resolution: '1920x1080',
      filesize: 50 * 1024 * 1024,
      hasVideo: true,
      hasAudio: false,
      codec: 'avc1',
    },
    {
      formatId: '22',
      container: 'mp4',
      qualityLabel: '720p',
      hasVideo: true,
      hasAudio: true,
    },
    {
      formatId: '251',
      container: 'webm',
      qualityLabel: 'audio only',
      hasVideo: false,
      hasAudio: true,
      codec: 'opus',
    },
  ]);

  assert.equal(choices[0]?.selector, '137+bestaudio[ext=m4a]/137+bestaudio');
  assert.equal(choices[0]?.outputContainer, 'mp4');
  assert.equal(choices[1]?.selector, '22');
  assert.equal(choices[2]?.outputContainer, 'mp3');
  assert.match(choices[0]?.label ?? '', /50\.0 MiB/);
});

test('actual format choices ignore storyboard-like entries and duplicate IDs', () => {
  const choices = buildActualFormatChoices([
    { formatId: 'sb0', container: 'mhtml', qualityLabel: 'storyboard', hasVideo: false, hasAudio: false },
    { formatId: '22', container: 'mp4', qualityLabel: '720p', hasVideo: true, hasAudio: true },
    { formatId: '22', container: 'mp4', qualityLabel: '720p', hasVideo: true, hasAudio: true },
  ]);
  assert.deepEqual(choices.map((choice) => choice.formatId), ['22']);
  assert.equal(formatFileSize(0), '未知大小');
});

test('preset selectors prefer streams compatible with the requested container', () => {
  assert.equal(
    buildPresetFormatSelector('720p', 'mp4'),
    'bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/best[ext=mp4][height<=720]/best',
  );
  assert.equal(
    buildPresetFormatSelector('highest', 'webm'),
    'bestvideo[ext=webm]+bestaudio[ext=webm]/best[ext=webm]/best',
  );
  assert.equal(buildPresetFormatSelector('1080p', 'mp3'), 'bestaudio/best');
});
