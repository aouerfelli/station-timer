const { remote } = require('electron');

document.querySelector('#resume').addEventListener('click', () => {
  const win = remote.getCurrentWindow();
  // Lose focus before closing setup modal to prevent screen flash
  win.blur();
  // Destroy it directly since this is a non-closeable window
  win.destroy();
});
