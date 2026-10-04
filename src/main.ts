import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { App } from './ui/app';
import { renderPreview } from './audio/music';
import { loadSave, requestPersistentStorage } from './persistence/storage';

async function boot() {
  const save = await loadSave();
  requestPersistentStorage();
  // Wait for the display fonts so canvas text uses them from the first frame.
  try { await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1500))]); } catch { /* ignore */ }
  const app = new App(save);
  Object.assign(window as object, { __robo: app, __renderMusic: renderPreview }); // handy for debugging from the console

  const banner = document.getElementById('update')!;
  const updateSW = registerSW({
    onNeedRefresh() { banner.classList.remove('off'); },
  });
  document.getElementById('updateBtn')!.addEventListener('click', () => { void updateSW(true); });
}

void boot();
