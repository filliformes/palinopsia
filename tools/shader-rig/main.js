// Offscreen Electron page for the shader rig. SRCH_PORT picks the CDP port (default 9461);
// the profile lives in the OS temp dir, never beside the user's app settings.
const { app, BrowserWindow } = require('electron')
const path = require('path'), os = require('os')
const port = process.env.SRCH_PORT || '9461'
app.commandLine.appendSwitch('remote-debugging-port', port)
app.setPath('userData', path.join(os.tmpdir(), 'opsia-shader-rig-' + port))
app.whenReady().then(() => {
  const w = new BrowserWindow({ width: 1920, height: 1080, show: false, useContentSize: true, webPreferences: { offscreen: true, backgroundThrottling: false } })
  w.webContents.setFrameRate(30)
  w.loadFile(path.join(__dirname, 'index.html'))
})
app.on('window-all-closed', () => app.quit())
