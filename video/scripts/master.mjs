import {execFileSync} from 'node:child_process';
import {renameSync} from 'node:fs';
import {fileURLToPath, pathToFileURL} from 'node:url';
import ffmpeg from '@ffmpeg-installer/ffmpeg';

const root = fileURLToPath(new URL('../', import.meta.url));

// AAC can add a few milliseconds of encoder padding. Copy the video frames and
// bound the audio track to the exact composition duration.
export function master(file) {
  const temporary = file + '.master.mp4';
  execFileSync(ffmpeg.path, ['-hide_banner', '-loglevel', 'error', '-y', '-i', file,
    '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy', '-af', 'apad,atrim=duration=90',
    '-c:a', 'aac', '-t', '90', '-movflags', '+faststart', temporary],
  {cwd: root, windowsHide: true, stdio: 'inherit'});
  renameSync(new URL('../' + temporary, import.meta.url), new URL('../' + file, import.meta.url));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  master('ContextLedger_Demo_90s.mp4');
}
