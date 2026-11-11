/**
 * Browser shell: static interface, loading card and the one visible failure
 * path. Boot pattern follows Jellyland's src/main.ts: the whole startup is a
 * single observed promise chain.
 */
import './style.css';
import { hudMarkup } from './app/hud.ts';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main id="viewport" aria-label="Block Cities"></main>
  ${hudMarkup()}
  <section id="loading" role="status" aria-live="polite"><div class="loading-card"><div class="brick-mark"></div><h2>Sorting bricks.</h2><p id="load-message">Loading the game</p><pre id="fatal" hidden></pre><button id="retry" hidden>Try again</button></div></section>
`;

let stage = 'Loading the game', failed = false, game: { stop: () => void } | undefined;
function fail(reason: unknown) {
  if (failed) return; failed = true; game?.stop();
  const error = reason instanceof Error ? reason : new Error(String(reason));
  document.querySelector('#loading')!.classList.remove('hidden');
  document.querySelector('#loading')!.classList.add('failed');
  document.querySelector('#loading h2')!.textContent = 'A brick is missing.';
  document.querySelector('#load-message')!.textContent = 'The game couldn’t start. Details below.';
  const fatal = document.querySelector<HTMLPreElement>('#fatal')!; fatal.hidden = false;
  fatal.textContent = `${stage}\n${error.message}\n\nViewport: ${innerWidth} × ${innerHeight} · DPR ${devicePixelRatio}\n${navigator.userAgent}`;
  document.querySelector<HTMLButtonElement>('#retry')!.hidden = false;
  console.error(`[Block Cities / ${stage}]`, error);
}
window.addEventListener('error', event => fail(event.error || event.message));
window.addEventListener('unhandledrejection', event => fail(event.reason));
document.querySelector('#retry')!.addEventListener('click', () => location.reload());

// One observed chain covers imports, initialization, compilation, warmup and first render.
void import('./app/runtime.ts').then(({ startGame }) => startGame(message => {
  if (failed) throw new Error('Startup aborted after a GPU failure');
  stage = message; document.querySelector('#load-message')!.textContent = message;
}, fail)).then(started => {
  game = started;
  if (failed) { game.stop(); return; }
  stage = 'Playing'; document.querySelector('#loading')!.classList.add('hidden');
}).catch(fail);
