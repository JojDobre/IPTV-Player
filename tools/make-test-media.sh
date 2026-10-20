#!/usr/bin/env bash
# Development only: builds the archive stream (VOD HLS, VP9 + two Opus audio tracks + Slovak subtitles)
# and a logo used by tools/fake-provider.js.   Usage: tools/make-test-media.sh <dir>
set -euo pipefail
D="${1:?folder}"; mkdir -p "$D/arch/subs"
ffmpeg -hide_banner -loglevel error -y -f lavfi -i testsrc2=size=426x240:rate=25 -f lavfi -i sine=f=330:r=48000 -f lavfi -i sine=f=880:r=48000 -t 90 \
  -map 0:v -map 1:a -map 2:a -c:v libvpx-vp9 -deadline realtime -cpu-used 8 -b:v 300k -g 50 -keyint_min 50 -c:a libopus -b:a 48k \
  -f hls -hls_time 2 -hls_playlist_type vod -hls_segment_type fmp4 -master_pl_name master.m3u8 \
  -var_stream_map "v:0,agroup:aud,name:video a:0,agroup:aud,language:slk,name:Slovencina,default:yes a:1,agroup:aud,language:eng,name:English" "$D/arch/%v/index.m3u8"
printf 'WEBVTT\n\n00:00:01.000 --> 00:00:40.000\nToto sú testovacie titulky.\n\n00:00:40.000 --> 00:01:30.000\nDruhý riadok titulkov.\n' > "$D/arch/subs/s.vtt"
printf '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:90\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:90.0,\ns.vtt\n#EXT-X-ENDLIST\n' > "$D/arch/subs/index.m3u8"
sed -i.bak -e '0,/#EXT-X-STREAM-INF:/s//#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="sub",NAME="Slovenské",LANGUAGE="slk",AUTOSELECT=YES,DEFAULT=NO,URI="subs\/index.m3u8"\n#EXT-X-STREAM-INF:/' \
  -e 's/AUDIO="group_aud"/AUDIO="group_aud",SUBTITLES="sub"/' "$D/arch/master.m3u8" && rm -f "$D/arch/master.m3u8.bak"
ffmpeg -hide_banner -loglevel error -y -f lavfi -i color=c=0xE5394B:s=256x128 -vf "drawbox=x=40:y=30:w=176:h=68:color=white@1:t=fill" -frames:v 1 "$D/logo1.png"
echo "Hotovo. Spusti: node tools/fake-provider.js $D  a v appke pridaj playlist http://127.0.0.1:9001/playlist.m3u"
