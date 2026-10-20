import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseM3U, xtreamUrls } from '../src/data/m3u.js';
import { catchupUrl, fillTemplate, hasArchive } from '../src/data/catchup.js';
import { XmltvParser, parseXmltvTime, nameKey, decodeXml } from '../src/data/xmltv.js';

const M3U = `#EXTM3U url-tvg="http://epg.example/a.xml.gz,http://epg.example/b.xml" catchup="shift" catchup-days="2"
#EXTINF:-1 tvg-id="jednotka.sk" tvg-name="Jednotka" tvg-logo="http://l/1.png" group-title="Slovensko, HD" tvg-chno="5",Jednotka HD
http://s.example/live/u/p/101.ts
#EXTINF:-1 tvg-id="ct1.cz" group-title="Česko" catchup="default" catchup-days="7" catchup-source="http://s.example/arch/ct1?start={utc}&end={utcend}",ČT1
#EXTVLCOPT:http-user-agent=MyBox/1.0
#EXTVLCOPT:http-referrer=http://ref.example/
http://s.example/ct1/index.m3u8
#EXTINF:-1,Bez skupiny
#EXTGRP:Rôzne
#KODIPROP:inputstream.adaptive.stream_headers=User-Agent=Kodi%2F20&Referer=http://k.example
http://s.example/x.m3u8
#EXTINF:-1 group-title="Filmy",Film na želanie
http://s.example/movie/u/p/555.mkv
#EXTINF:-1 group-title="Slovensko, HD" catchup="disabled",Bez archívu
http://s.example/live/u/p/102.ts
`;

test('M3U: header, attributes, groups, headers, VOD skip', () => {
  const { header, channels, vodCount } = parseM3U(M3U);
  assert.deepEqual(header.tvgUrls, ['http://epg.example/a.xml.gz', 'http://epg.example/b.xml']);
  assert.equal(channels.length, 4);
  assert.equal(vodCount, 1);
  const [a, b, c, d] = channels;
  assert.equal(a.name, 'Jednotka HD');
  assert.equal(a.group, 'Slovensko, HD');
  assert.equal(a.tvgId, 'jednotka.sk');
  assert.equal(a.logoUrl, 'http://l/1.png');
  assert.equal(a.chno, 5);
  assert.deepEqual(a.catchup, { type: 'shift', days: 2, source: '' });
  assert.equal(b.ua, 'MyBox/1.0');
  assert.equal(b.ref, 'http://ref.example/');
  assert.equal(b.catchup.type, 'default');
  assert.equal(b.catchup.days, 7);
  assert.equal(c.group, 'Rôzne');
  assert.equal(c.ua, 'Kodi/20');
  assert.equal(c.ref, 'http://k.example');
  assert.equal(d.catchup, null);
  assert.equal(new Set(channels.map(x => x.id)).size, 4);
});

test('M3U: ids are stable between loads and unique for duplicates', () => {
  const one = parseM3U(M3U).channels.map(c => c.id);
  const two = parseM3U(M3U).channels.map(c => c.id);
  assert.deepEqual(one, two);
  const dup = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttp://a/1\n#EXTINF:-1,A\nhttp://a/2\n').channels;
  assert.notEqual(dup[0].id, dup[1].id);
});

test('M3U: tvg-rec on Xtream links becomes xc catch-up', () => {
  const { channels } = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-rec="3",X\nhttp://h.example:8080/u/p/77\n');
  assert.deepEqual(channels[0].catchup, { type: 'xc', days: 3, source: '' });
});

test('Xtream credentials map to M3U and EPG links', () => {
  const x = xtreamUrls('http://h.example:8080/', 'jano', 'tajne heslo');
  assert.equal(x.m3u, 'http://h.example:8080/get.php?username=jano&password=tajne%20heslo&type=m3u_plus&output=ts');
  assert.equal(x.epg, 'http://h.example:8080/xmltv.php?username=jano&password=tajne%20heslo');
});

const START = Date.UTC(2026, 9, 20, 18, 0, 0), END = START + 3600e3, NOW = START + 7200e3;
test('catch-up: default template placeholders', () => {
  const ch = { url: 'http://s/ct1/index.m3u8', catchup: { type: 'default', days: 7, source: 'http://s/arch?start={utc}&end={utcend}&d={duration}&o={offset}&now={lutc}&t={utc:Y-m-d H:M}&m=${duration:60}' } };
  const s = START / 1000;
  assert.equal(catchupUrl(ch, START, END, NOW), `http://s/arch?start=${s}&end=${s + 3600}&d=3600&o=7200&now=${s + 7200}&t=2026-10-20 18:00&m=60`);
});
test('catch-up: shift, append, flussonic, xc', () => {
  const s = START / 1000;
  assert.equal(catchupUrl({ url: 'http://s/1.m3u8?tok=1', catchup: { type: 'shift', days: 1 } }, START, END, NOW), `http://s/1.m3u8?tok=1&utc=${s}&lutc=${s + 7200}`);
  assert.equal(catchupUrl({ url: 'http://s/1.m3u8', catchup: { type: 'append', days: 1, source: '?from=${start}' } }, START, END, NOW), `http://s/1.m3u8?from=${s}`);
  assert.equal(catchupUrl({ url: 'http://f/ch1/index.m3u8', catchup: { type: 'flussonic', days: 1 } }, START, END, NOW), `http://f/ch1/index-${s}-3600.m3u8`);
  assert.equal(catchupUrl({ url: 'http://f/ch1/mpegts', catchup: { type: 'flussonic', days: 1 } }, START, END, NOW), `http://f/ch1/timeshift_abs-${s}.ts`);
  const xc = catchupUrl({ url: 'http://h:8080/live/u/p/77.ts', catchup: { type: 'xc', days: 3 } }, START, END, NOW);
  assert.match(xc, /^http:\/\/h:8080\/timeshift\/u\/p\/60\/2026-10-\d\d:\d\d-00\/77\.ts$/);
  assert.equal(catchupUrl({ url: 'http://s/1', catchup: null }, START, END, NOW), null);
});
test('catch-up: archive window', () => {
  const ch = { catchup: { type: 'shift', days: 2 } };
  assert.equal(hasArchive(ch, NOW - 86400e3, NOW), true);
  assert.equal(hasArchive(ch, NOW - 3 * 86400e3, NOW), false);
  assert.equal(hasArchive({ catchup: null }, NOW - 1000, NOW), false);
});
test('fillTemplate leaves unknown text alone', () => {
  assert.equal(fillTemplate('plain', { start: 1, end: 2, now: 3 }), 'plain');
});

test('XMLTV: time zones', () => {
  assert.equal(parseXmltvTime('20261020183000 +0200'), Date.UTC(2026, 9, 20, 16, 30));
  assert.equal(parseXmltvTime('20261020183000'), Date.UTC(2026, 9, 20, 18, 30));
  assert.equal(parseXmltvTime('202610201830 -0130'), Date.UTC(2026, 9, 20, 20, 0));
  assert.ok(Number.isNaN(parseXmltvTime('')));
});

test('XMLTV: streaming parse survives arbitrary chunk boundaries', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><tv generator-info-name="x">
<channel id="jednotka.sk"><display-name lang="sk">Jednotka</display-name><display-name>STV1</display-name><icon src="http://i/1.png"/></channel>
<programme start="20261020180000 +0200" stop="20261020190000 +0200" channel="jednotka.sk"><title lang="sk">Správy &amp; počasie</title><desc>Prehľad &lt;dňa&gt;</desc><category>News</category></programme>
<programme start="20261020190000 +0200" stop="20261020200000 +0200" channel="jednotka.sk"><title><![CDATA[Film: A & B]]></title></programme>
<programme start="20261020200000 +0200" stop="20261020210000 +0200" channel="jednotka.sk" />
</tv>`;
  for (const size of [1, 3, 7, 64, 100000]) {
    const ch = [], pr = [];
    const p = new XmltvParser({ onChannel: c => ch.push(c), onProgramme: x => pr.push(x) });
    for (let i = 0; i < xml.length; i += size) p.push(xml.slice(i, i + size));
    assert.equal(ch.length, 1, 'channels @' + size);
    assert.deepEqual(ch[0], { id: 'jednotka.sk', names: ['Jednotka', 'STV1'], icon: 'http://i/1.png' });
    assert.equal(pr.length, 3, 'programmes @' + size);
    assert.equal(pr[0].title, 'Správy & počasie');
    assert.equal(pr[0].desc, 'Prehľad <dňa>');
    assert.equal(pr[0].start, Date.UTC(2026, 9, 20, 16));
    assert.equal(pr[1].title, 'Film: A & B');
    assert.equal(pr[2].title, '');
  }
});

test('name keys match common naming differences', () => {
  assert.equal(nameKey('Šport 1 HD'), nameKey('sport1'));
  assert.equal(nameKey('ČT1 FHD'), nameKey('CT1'));
  assert.equal(decodeXml('&#269;&#x161;'), 'čš');
});
