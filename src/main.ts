import './ui/styles.css';
import { App } from './app/app';

function fatal(msg: string) {
  const el = document.getElementById('boot-fallback');
  if (el) {
    el.style.display = 'flex';
    el.textContent = msg;
  }
}

try {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const test = document.createElement('canvas').getContext('webgl2');
  if (!test) {
    fatal('Crown & Tide requires a browser with WebGL 2 support (a recent Chrome, Edge, Firefox or Safari).');
  } else {
    const app = new App(canvas, document.getElementById('ui')!);
    (window as unknown as { __realm: App }).__realm = app;
    app.start().catch((e) => {
      console.error(e);
      fatal('The game failed to start. Please reload the page.');
    });
  }
} catch (e) {
  console.error(e);
  fatal('The game failed to start. Please reload the page.');
}
