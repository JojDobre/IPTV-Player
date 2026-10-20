// Development only: a fake IPTV provider for testing the player without a real subscription.
//   node tools/fake-provider.js <media-dir> [port]
// Serves /playlist.m3u, /epg.xml.gz, a live HLS channel produced by ffmpeg (VP9 + two Opus audio
// tracks), an archive (VOD HLS with subtitles) at /arch/master.m3u8, a dead channel and a live MPEG-TS.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { gzipSync } from 'node:zlib';

const dir = process.argv[2];
const PORT = +(process.argv[3] || 9001);
const B = `http://127.0.0.1:${PORT}`;
const live = join(dir, 'live');
rmSync(live, { recursive: true, force: true }); mkdirSync(live, { recursive: true });

const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-re', '-f', 'lavfi', '-i', 'testsrc2=size=426x240:rate=25', '-f', 'lavfi', '-i', 'sine=f=440:r=48000', '-f', 'lavfi', '-i', 'sine=f=660:r=48000',
  '-map', '0:v', '-map', '1:a', '-map', '2:a', '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '300k', '-g', '50', '-keyint_min', '50', '-c:a', 'libopus', '-b:a', '48k',
  '-f', 'hls', '-hls_time', '2', '-hls_list_size', '40', '-hls_flags', 'delete_segments+independent_segments', '-hls_segment_type', 'fmp4', '-master_pl_name', 'master.m3u8',
  '-var_stream_map', 'v:0,agroup:aud,name:video a:0,agroup:aud,language:slk,name:Slovencina,default:yes a:1,agroup:aud,language:eng,name:English', join(live, '%v/index.m3u8')], { stdio: 'inherit' });
process.on('exit', () => ff.kill());
process.on('SIGTERM', () => process.exit());

const groups = ['Slovensko', 'Česko', 'Šport', 'Filmy', 'Deti', 'Dokumenty', 'Správy', 'Hudba'];
function playlist() {
  let m = `#EXTM3U url-tvg="${B}/epg.xml.gz"\n`;
  m += `#EXTINF:-1 tvg-id="test.hls" tvg-logo="${B}/logo1.png" group-title="Slovensko" catchup="default" catchup-days="1" catchup-source="${B}/arch/master.m3u8?start={utc}",Test HLS 1\n${B}/live/master.m3u8\n`;
  m += `#EXTINF:-1 tvg-id="test.dead" tvg-logo="${B}/missing.png" group-title="Slovensko",Nedostupný kanál\n${B}/dead.m3u8\n`;
  m += `#EXTINF:-1 tvg-id="test.ts" group-title="Šport",Test TS\n${B}/live.ts\n`;
  for (let i = 1; i <= 400; i++) {
    const g = groups[i % groups.length];
    m += `#EXTINF:-1 tvg-id="ch${i}" group-title="${g}"${i % 3 ? ` tvg-logo="${B}/logo1.png"` : ''},${g} Kanál ${i} HD\n${B}/live/master.m3u8?ch=${i}\n`;
  }
  m += `#EXTINF:-1 group-title="Filmy VOD",Film\n${B}/movie/u/p/1.mkv\n`;
  return m;
}
const t = d => { const z = new Date(d); const p = n => String(n).padStart(2, '0'); return `${z.getUTCFullYear()}${p(z.getUTCMonth() + 1)}${p(z.getUTCDate())}${p(z.getUTCHours())}${p(z.getUTCMinutes())}00 +0000`; };
function epg() {
  const now = Date.now(), h0 = Math.floor(now / 1800e3) * 1800e3;
  let x = '<?xml version="1.0" encoding="UTF-8"?>\n<tv>\n<channel id="test.hls"><display-name>Test HLS 1</display-name></channel>\n';
  for (let k = -12; k < 24; k++) x += `<programme start="${t(h0 + k * 1800e3)}" stop="${t(h0 + (k + 1) * 1800e3)}" channel="test.hls"><title>Relácia ${k < 0 ? 'z archívu' : 'naživo'} ${k + 13}</title><desc>Popis relácie číslo ${k + 13} &amp; ďalšie.</desc><category>Test</category></programme>\n`;
  for (let i = 1; i <= 400; i += 2) for (let k = -4; k < 8; k++) x += `<programme start="${t(h0 + k * 3600e3)}" stop="${t(h0 + (k + 1) * 3600e3)}" channel="ch${i}"><title>Program ${i}/${k}</title></programme>\n`;
  return gzipSync(x + '</tv>\n');
}
const TYPES = { '.m3u8': 'application/vnd.apple.mpegurl', '.m4s': 'video/iso.segment', '.mp4': 'video/mp4', '.png': 'image/png', '.vtt': 'text/vtt' };
http.createServer((req, res) => {
  const u = new URL(req.url, B);
  if (u.pathname === '/playlist.m3u') { res.writeHead(200, { 'content-type': 'audio/x-mpegurl' }); return res.end(playlist()); }
  if (u.pathname === '/epg.xml.gz') { res.writeHead(200, { 'content-type': 'application/gzip' }); return res.end(epg()); }
  if (u.pathname === '/live.ts') {
    res.writeHead(200, { 'content-type': 'video/mp2t' });
    const ts = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-re', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25', '-f', 'lavfi', '-i', 'sine=f=500', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-c:a', 'aac', '-f', 'mpegts', 'pipe:1']);
    ts.stdout.pipe(res); res.on('close', () => ts.kill('SIGKILL'));
    return;
  }
  let f = join(dir, decodeURIComponent(u.pathname));
  if (!existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  createReadStream(f).pipe(res);
}).listen(PORT, () => console.log(`fake provider on ${B}`));
