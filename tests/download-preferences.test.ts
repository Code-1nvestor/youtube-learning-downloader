import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_DOWNLOAD_PREFERENCES,
  loadDownloadUiState,
  saveDownloadUiState,
} from '../client/src/utils/download-preferences.ts';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

test('download preferences and per-video actual format IDs survive restart', () => {
  const storage = memoryStorage();
  saveDownloadUiState({
    preferences: {
      ...DEFAULT_DOWNLOAD_PREFERENCES,
      container: 'webm',
      quality: '2160p',
      subtitleMode: 'separate',
      autoSubtitle: true,
    },
    actualFormatIds: { videoA: '401', videoB: '137' },
  }, storage);

  const restored = loadDownloadUiState(storage);
  assert.equal(restored.preferences.container, 'webm');
  assert.equal(restored.preferences.quality, '2160p');
  assert.equal(restored.preferences.subtitleMode, 'separate');
  assert.equal(restored.preferences.autoSubtitle, true);
  assert.deepEqual(restored.actualFormatIds, { videoA: '401', videoB: '137' });
});

test('invalid persisted values are isolated and safely reset', () => {
  const storage = memoryStorage();
  storage.setItem('yld.download-ui.v1', JSON.stringify({
    preferences: { container: 'exe', quality: 'anything', formatMode: 'unknown' },
    actualFormatIds: { '../bad': '22', goodVideo: '', videoA: '401' },
  }));

  const restored = loadDownloadUiState(storage);
  assert.equal(restored.preferences.container, 'mp4');
  assert.equal(restored.preferences.quality, 'highest');
  assert.equal(restored.preferences.formatMode, 'preset');
  assert.deepEqual(restored.actualFormatIds, { videoA: '401' });
});
