import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createWindowVisibilityController } = require('../desktop/window-lifecycle.cjs') as {
  createWindowVisibilityController: (options: {
    getWindow: () => {
      isDestroyed: () => boolean;
      isMinimized: () => boolean;
      restore: () => void;
      show: () => void;
      hide: () => void;
      focus: () => void;
    } | null;
    onFirstHide?: () => void;
  }) => {
    handleClose: (event: { preventDefault: () => void }, shuttingDown: boolean) => boolean;
    showWindow: () => boolean;
    hasShownHideNotice: () => boolean;
  };
};

test('window close hides to tray and only explains it once', () => {
  let prevented = 0;
  let hidden = 0;
  let notices = 0;
  const window = {
    isDestroyed: () => false,
    isMinimized: () => false,
    restore: () => {},
    show: () => {},
    hide: () => { hidden += 1; },
    focus: () => {},
  };
  const controller = createWindowVisibilityController({ getWindow: () => window, onFirstHide: () => { notices += 1; } });
  const event = { preventDefault: () => { prevented += 1; } };

  assert.equal(controller.handleClose(event, false), true);
  assert.equal(controller.handleClose(event, false), true);
  assert.equal(prevented, 2);
  assert.equal(hidden, 2);
  assert.equal(notices, 1);
  assert.equal(controller.hasShownHideNotice(), true);
});

test('real application exit is allowed and tray activation restores the window', () => {
  let restored = 0;
  let shown = 0;
  let focused = 0;
  const window = {
    isDestroyed: () => false,
    isMinimized: () => true,
    restore: () => { restored += 1; },
    show: () => { shown += 1; },
    hide: () => {},
    focus: () => { focused += 1; },
  };
  const controller = createWindowVisibilityController({ getWindow: () => window });
  let prevented = 0;
  assert.equal(controller.handleClose({ preventDefault: () => { prevented += 1; } }, true), false);
  assert.equal(prevented, 0);
  assert.equal(controller.showWindow(), true);
  assert.deepEqual({ restored, shown, focused }, { restored: 1, shown: 1, focused: 1 });
});
