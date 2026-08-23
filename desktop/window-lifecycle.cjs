'use strict';

function createWindowVisibilityController({ getWindow, onFirstHide = () => {} }) {
  if (typeof getWindow !== 'function') throw new TypeError('getWindow 必须是函数');
  let hideNoticeShown = false;

  const showWindow = () => {
    const window = getWindow();
    if (!window || window.isDestroyed()) return false;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    return true;
  };

  const handleClose = (event, shuttingDown) => {
    if (shuttingDown) return false;
    event.preventDefault();
    const window = getWindow();
    if (!window || window.isDestroyed()) return true;
    window.hide();
    if (!hideNoticeShown) {
      hideNoticeShown = true;
      onFirstHide();
    }
    return true;
  };

  return { handleClose, showWindow, hasShownHideNotice: () => hideNoticeShown };
}

module.exports = { createWindowVisibilityController };
