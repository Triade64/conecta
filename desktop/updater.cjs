'use strict';
function createUpdater({ app, autoUpdater, dialog, getWindow, prepareQuit }) {
  let busy = false, manual = false, downloaded = false, available = null, errorReported = false;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  const message = options => {
    const window = getWindow();
    return window && !window.isDestroyed() ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options);
  };
  const reportError = error => {
    console.warn('Conecta update failed:', error?.message || error);
    if (!manual || errorReported) return;
    errorReported = true;
    void message({ type: 'error', title: 'Atualização do Conecta', message: 'Não foi possível atualizar o Conecta.', detail: 'Confira a conexão e tente novamente em Conecta → Verificar atualizações. Sua versão atual continua disponível.' });
  };
  const install = async () => {
    const answer = await message({ type: 'question', title: 'Atualização do Conecta', message: 'A atualização está pronta para instalar.', detail: 'O Conecta será fechado e reaberto. Termine o que está digitando antes de continuar.', buttons: ['Reiniciar e instalar', 'Mais tarde'], defaultId: 1, cancelId: 1 });
    if (answer.response === 0) { prepareQuit(); autoUpdater.quitAndInstall(false, true); }
  };
  autoUpdater.on('error', reportError);
  autoUpdater.on('update-available', info => { available = info; });
  autoUpdater.on('update-downloaded', () => { downloaded = true; });
  const check = async (userInitiated = true) => {
    if (!app.isPackaged) {
      if (userInitiated) await message({ type: 'info', title: 'Conecta', message: 'As atualizações estão disponíveis no aplicativo instalado.' });
      return;
    }
    if (busy) {
      if (userInitiated) await message({ type: 'info', title: 'Conecta', message: 'Uma verificação ou download já está em andamento.' });
      return;
    }
    busy = true; manual = userInitiated; errorReported = false;
    try {
      if (downloaded) { if (userInitiated) await install(); return; }
      available = null;
      await autoUpdater.checkForUpdates();
      if (!available) {
        if (userInitiated) await message({ type: 'info', title: 'Conecta', message: `Você já está usando a versão mais recente (${app.getVersion()}).` });
        return;
      }
      const answer = await message({ type: 'question', title: 'Atualização do Conecta', message: `Conecta ${available.version} disponível.`, detail: 'Deseja baixar a atualização? Você pode continuar usando o Conecta durante o download.', buttons: ['Baixar atualização', 'Depois'], defaultId: 0, cancelId: 1 });
      if (answer.response !== 0) return;
      manual = true;
      await autoUpdater.downloadUpdate();
      if (downloaded) await install();
    } catch (error) { reportError(error); }
    finally { busy = false; }
  };
  const startup = setTimeout(() => { void check(false); }, 30000);
  const interval = setInterval(() => { void check(false); }, 4 * 60 * 60 * 1000);
  startup.unref?.(); interval.unref?.();
  const dispose = () => { clearTimeout(startup); clearInterval(interval); };
  app.on('before-quit', dispose);
  return { check, dispose };
}
module.exports = { createUpdater };
