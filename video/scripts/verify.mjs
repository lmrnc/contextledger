import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import ffprobe from '@ffprobe-installer/ffprobe';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const file = 'ContextLedger_Demo_90s.mp4';
const run = (tool, args) => execFileSync(tool.path, args, {cwd, encoding: 'utf8', windowsHide: true});
const {streams, format} = JSON.parse(run(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]));
const video = streams.find(item => item.codec_type === 'video');
const audio = streams.find(item => item.codec_type === 'audio');
assert.equal(video.codec_name, 'h264');
assert.deepEqual([video.width, video.height], [1920, 1080]);
assert.equal(video.avg_frame_rate, '30/1');
assert.equal(Number(video.nb_frames), 2700);
assert.equal(Number(format.duration), 90);
assert.ok(audio && Math.abs(Number(audio.duration) - 90) < 0.05);
run(ffmpeg, ['-v', 'error', '-xerror', '-i', file, '-f', 'null', '-']);
const sampleRate = 8000;
const pcm = input => execFileSync(ffmpeg.path, ['-v', 'error', '-i', input, '-vn', '-ac', '1', '-ar', String(sampleRate),
  '-f', 's16le', '-'], {cwd, windowsHide: true, maxBuffer: 2_000_000});
const decoded = pcm(file);
const narration = pcm('public/demo-narration.wav');
assert.equal(narration.length, 90 * sampleRate * 2);
assert.ok(decoded.length >= narration.length);
let dot = 0;
let decodedEnergy = 0;
let narrationEnergy = 0;
for (let i = 0; i < narration.length; i += 2) {
  const exportSample = decoded.readInt16LE(i);
  const sourceSample = narration.readInt16LE(i);
  dot += exportSample * sourceSample;
  decodedEnergy += exportSample ** 2;
  narrationEnergy += sourceSample ** 2;
}
const audioCorrelation = dot / Math.sqrt(decodedEnergy * narrationEnergy);
assert.ok(audioCorrelation > 0.98, 'Exported audio must match the editable narration track');
const audioLevels = spawnSync(ffmpeg.path, ['-hide_banner', '-nostats', '-i', file, '-vn',
  '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'], {cwd, windowsHide: true, encoding: 'utf8'});
assert.equal(audioLevels.status, 0, audioLevels.stderr);
const levels = JSON.parse(audioLevels.stderr.slice(audioLevels.stderr.lastIndexOf('{')));
const quietAtBoundary = ms => {
  const start = Math.max(0, Math.round(ms * sampleRate / 1000) - 200);
  const end = Math.min(narration.length / 2, start + 400);
  for (let i = start; i < end; i++) if (Math.abs(decoded.readInt16LE(i * 2)) > 320) return false;
  return true;
};
const hasSpeech = (startMs, endMs) => {
  let audibleSamples = 0;
  for (let i = Math.round(startMs * sampleRate / 1000); i < Math.round(endMs * sampleRate / 1000); i++) {
    if (Math.abs(decoded.readInt16LE(i * 2)) > 320) audibleSamples++;
  }
  return audibleSamples > sampleRate / 2;
};
const bitstream = execFileSync(ffmpeg.path, ['-v', 'error', '-i', file, '-map', '0:v:0', '-c:v', 'copy', '-f', 'h264', '-'],
  {cwd, windowsHide: true, maxBuffer: 100_000_000});
const cues = JSON.parse(readFileSync(new URL('../src/captions.json', import.meta.url), 'utf8'));
const srt = readFileSync(new URL('../ContextLedger_Demo_90s.srt', import.meta.url), 'utf8').trim().split('\n\n');
const time = ms => new Date(ms).toISOString().slice(11, 23).replace('.', ',');
let offset = 0;
let index = 0;
for (const [shot, entries] of Object.entries(cues)) {
  const {streams: sources} = JSON.parse(run(ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', 'public/footage/' + shot + '.mp4']));
  assert.equal(Number(sources[0].duration) * 1000, entries.at(-1).endMs);
  for (const cue of entries) {
    const expected = [String(index + 1), time(offset + cue.startMs) + ' --> ' + time(offset + cue.endMs), cue.text].join('\n');
    assert.equal(srt[index++], expected);
    assert.ok(hasSpeech(offset + cue.startMs, offset + cue.endMs), `Speech missing from caption ${index}`);
    assert.ok(quietAtBoundary(offset + cue.startMs), `Speech crosses the start of caption ${index}`);
  }
  offset += entries.at(-1).endMs;
}
assert.equal(index, srt.length);
assert.equal(offset, 90000);
const take = JSON.parse(readFileSync(new URL('../CAPTURE-EVIDENCE.json', import.meta.url), 'utf8'));
assert.equal(take.escalation.authoritative_version, 2);
assert.deepEqual(take.before, take.restricted);
assert.equal(take.before.status, 'abstained');
assert.equal(take.approval.reviewer, 'knowledge-admin');
assert.equal(take.after.authoritative_version, 1);
assert.equal(take.after.citations[0].provenance.review_id, take.submission.review_id);
const checks = {
  durationSeconds: Number(format.duration), frames: Number(video.nb_frames), resolution: [video.width, video.height],
  videoCodec: video.codec_name, pixelFormat: video.pix_fmt, fps: video.avg_frame_rate,
  videoStreamSha256: createHash('sha256').update(bitstream).digest('hex'),
  decodedWithoutErrors: true, audioCodec: audio.codec_name, audioDurationSeconds: Number(audio.duration),
  narration: {cuesWithSpeech: index, cueStartsQuiet: true, sourceWaveformCorrelation: Number(audioCorrelation.toFixed(6)),
    integratedLufs: Number(levels.input_i), truePeakDbtp: Number(levels.input_tp)},
  captions: {count: index, firstMs: 0, lastMs: offset, sourceMatchesSrt: true},
  captureChecksPassed: true
};
writeFileSync(new URL('../VERIFICATION.json', import.meta.url), JSON.stringify(checks, null, 2) + '\n');
console.log(JSON.stringify(checks, null, 2));
