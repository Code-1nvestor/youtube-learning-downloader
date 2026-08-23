import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildActualFormatChoices,
  buildPresetFormatSelector,
  buildResolutionChoices,
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
    'bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/bestvideo[ext=mp4][height<=720]+bestaudio/best[ext=mp4][height<=720]',
  );
  assert.equal(
    buildPresetFormatSelector('highest', 'webm'),
    'bestvideo[ext=webm]+bestaudio[ext=webm]/bestvideo[ext=webm]+bestaudio/best[ext=webm]/bestvideo+bestaudio/best/best',
  );
  assert.match(buildPresetFormatSelector('4320p', 'webm'), /height<=4320/);
  assert.equal(buildPresetFormatSelector('1080p', 'mp3'), 'bestaudio/best');
});

test('WebM presets use real formats and fall back to transcoding when cookies expose only MP4', () => {
  const nativeFormats = [
    { formatId: '401', container: 'webm', qualityLabel: '2160p', resolution: '3840x2160', hasVideo: true, hasAudio: false },
    { formatId: '251', container: 'webm', qualityLabel: 'audio only', hasVideo: false, hasAudio: true },
  ];
  const cookieFormats = [
    { formatId: '95', container: 'mp4', qualityLabel: '720p', resolution: '1280x720', hasVideo: true, hasAudio: true },
    { formatId: '94', container: 'mp4', qualityLabel: '480p', resolution: '854x480', hasVideo: true, hasAudio: true },
  ];
  const cookie4kFormats = [
    { formatId: '401-mp4', container: 'mp4', qualityLabel: '2160p', resolution: '3840x2160', hasVideo: true, hasAudio: false },
    ...cookieFormats,
  ];

  assert.equal(
    buildPresetFormatSelector('highest', 'webm', nativeFormats),
    '401+bestaudio[ext=webm]/401+bestaudio',
  );
  assert.equal(buildPresetFormatSelector('highest', 'webm', cookieFormats), '95');
  assert.equal(buildPresetFormatSelector('480p', 'webm', cookieFormats), '94');
  assert.equal(
    buildPresetFormatSelector('highest', 'webm', cookie4kFormats),
    '401-mp4+bestaudio[ext=webm]/401-mp4+bestaudio',
  );
  assert.deepEqual(
    buildResolutionChoices(cookie4kFormats, 'webm')[0],
    { value: 'highest', height: 2160, label: '最高（4K（2160p），转码为 WebM）' },
  );
  assert.deepEqual(
    buildResolutionChoices(cookieFormats, 'webm').map((choice) => [choice.value, choice.label]),
    [
      ['highest', '最高（720p，转码为 WebM）'],
      ['720p', '720p，转码为 WebM'],
      ['480p', '480p，转码为 WebM'],
    ],
  );
});

test('resolution choices come only from real formats compatible with the container', () => {
  const formats = [
    { formatId: '401', container: 'webm', qualityLabel: '2160p', resolution: '3840x2160', hasVideo: true, hasAudio: false },
    { formatId: '399', container: 'mp4', qualityLabel: '1080p', resolution: '1920x1080', hasVideo: true, hasAudio: false },
    { formatId: '251', container: 'webm', qualityLabel: 'audio only', hasVideo: false, hasAudio: true },
  ];

  assert.deepEqual(
    buildResolutionChoices(formats, 'webm').map((choice) => [choice.value, choice.label]),
    [['highest', '最高（4K（2160p））'], ['2160p', '4K（2160p）']],
  );
  assert.deepEqual(
    buildResolutionChoices(formats, 'mp4').map((choice) => choice.value),
    ['highest', '1080p'],
  );
});
