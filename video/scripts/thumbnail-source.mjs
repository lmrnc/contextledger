import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import ffmpeg from '@ffmpeg-installer/ffmpeg';

execFileSync(ffmpeg.path, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '3',
  '-i', 'public/footage/problem.mp4', '-frames:v', '1', 'public/thumbnail-source.png'],
{cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'inherit'});
