import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {bundle} from '@remotion/bundler';
import {renderMedia, renderStill, selectComposition} from '@remotion/renderer';
import {master} from './master.mjs';

// Use Remotion's tested Chromium version from Google's official CDN.
// This is the fallback for a timeout on the default patched-browser mirror.
const root = fileURLToPath(new URL('../', import.meta.url));
const propsPath = process.argv.find(arg => arg.startsWith('--props='))?.slice('--props='.length);
const inputProps = propsPath ? JSON.parse(readFileSync(propsPath, 'utf8')) : {};
const serveUrl = await bundle({entryPoint: join(root, 'src', 'index.ts')});
const onBrowserDownload = () => ({version: '158.0.8127.2', onProgress: () => {}});
const settings = {serveUrl, onBrowserDownload, logLevel: 'warn'};
if (!propsPath) {
  const thumbnail = await selectComposition({...settings, id: 'ContextLedgerThumbnail'});
  await renderStill({...settings, composition: thumbnail, output: join(root, 'ContextLedger_Thumbnail.png')});
  console.log('Thumbnail rendered');
}
const demo = await selectComposition({...settings, id: 'ContextLedgerDemo', inputProps});
const output = propsPath ? 'ContextLedger_Demo_Voiced.mp4' : 'ContextLedger_Demo_90s.mp4';
let checkpoint = -1;
await renderMedia({...settings, composition: demo, inputProps, codec: 'h264', crf: 18, concurrency: 4, pixelFormat: 'yuv420p',
  outputLocation: join(root, output),
  onProgress: ({progress}) => {
    const percent = Math.floor(progress * 10) * 10;
    if (percent !== checkpoint) {
      checkpoint = percent;
      console.log('Render ' + percent + '%');
    }
  }
});
master(output);
