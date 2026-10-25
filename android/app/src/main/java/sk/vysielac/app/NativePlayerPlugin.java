package sk.vysielac.app;

import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.TextureView;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.FrameLayout;

import androidx.annotation.NonNull;
import androidx.annotation.OptIn;
import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.TrackSelectionParameters;
import androidx.media3.common.Tracks;
import androidx.media3.common.VideoSize;
import androidx.media3.common.text.CueGroup;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.DecoderCounters;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.extractor.DefaultExtractorsFactory;
import androidx.media3.extractor.ts.DefaultTsPayloadReaderFactory;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.SubtitleView;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.HashMap;
import java.util.Map;

/**
 * Native playback with ExoPlayer (Media3) for the Android app. The picture is drawn by the device's hardware
 * decoders under the (transparent) web view, so the app's own controls, banner and panels stay on top.
 * Sound the device cannot decode (AC-3/E-AC-3 on many phones, MP2…) falls back to the FFmpeg audio decoder.
 * Two players (id 1 and 2) for the two-picture mode. The web side positions them: layout({id, x, y, w, h, dpr, front}).
 * Events: "state" {id, state, error?}, "tracks" {id, …}, "time" {id, pos, dur, buf, live, playing, …}, "tap" {id}.
 */
@OptIn(markerClass = UnstableApi.class)
@CapacitorPlugin(name = "NativePlayer")
public class NativePlayerPlugin extends Plugin {
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Map<Integer, Slot> slots = new HashMap<>();
    private FrameLayout back, front;
    private boolean ticking = false;

    private class Slot {
        final int id;
        ExoPlayer player;
        FrameLayout box;
        AspectRatioFrameLayout frame;
        SubtitleView subs;
        String state = "idle";
        boolean wasPlaying;
        float volume = 1f;

        Slot(int id) { this.id = id; }
    }

    @Override
    public void load() {
        main.post(() -> {
            WebView web = getBridge().getWebView();
            // The page paints its own background; where it is transparent the video shows through.
            web.setBackgroundColor(Color.TRANSPARENT);
            ViewGroup parent = (ViewGroup) web.getParent();
            back = new FrameLayout(getContext());
            back.setBackgroundColor(Color.BLACK);
            back.setVisibility(View.GONE);
            front = new FrameLayout(getContext());
            front.setClickable(false);
            int at = parent.indexOfChild(web);
            parent.addView(back, at, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            parent.addView(front, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        });
    }

    private Slot slot(int id) {
        Slot s = slots.get(id);
        if (s != null) return s;
        s = new Slot(id);
        final Slot me = s;
        DefaultRenderersFactory renderers = new DefaultRenderersFactory(getContext())
            .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON)
            .setEnableDecoderFallback(true);
        // Start with ~2.5 s in reserve, after a stall wait for 5 s: smooth rather than instant.
        DefaultLoadControl load = new DefaultLoadControl.Builder()
            .setBufferDurationsMs(20000, 60000, 2500, 5000)
            .build();
        s.player = new ExoPlayer.Builder(getContext(), renderers).setLoadControl(load).build();
        s.player.setVideoChangeFrameRateStrategy(C.VIDEO_CHANGE_FRAME_RATE_STRATEGY_ONLY_IF_SEAMLESS);

        s.box = new FrameLayout(getContext());
        s.box.setBackgroundColor(Color.BLACK);
        s.box.setVisibility(View.GONE);
        s.frame = new AspectRatioFrameLayout(getContext());
        s.frame.setResizeMode(AspectRatioFrameLayout.RESIZE_MODE_FIT);
        TextureView tv = new TextureView(getContext());
        s.frame.addView(tv, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        s.box.addView(s.frame, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT, Gravity.CENTER));
        s.subs = new SubtitleView(getContext());
        s.subs.setUserDefaultStyle();
        s.subs.setUserDefaultTextSize();
        s.box.addView(s.subs, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        s.box.setOnClickListener(v -> { JSObject e = new JSObject(); e.put("id", me.id); notifyListeners("tap", e); });
        s.box.setClickable(false);
        back.addView(s.box, new FrameLayout.LayoutParams(0, 0));
        s.player.setVideoTextureView(tv);

        s.player.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int st) { emitState(me); }

            @Override
            public void onIsPlayingChanged(boolean playing) { emitState(me); }

            @Override
            public void onPlayerError(@NonNull PlaybackException e) {
                // Fell behind a live window (long pause): just go back to live.
                if (e.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) {
                    me.player.seekToDefaultPosition();
                    me.player.prepare();
                    return;
                }
                me.state = "error";
                JSObject ev = new JSObject();
                ev.put("id", me.id);
                ev.put("state", "error");
                ev.put("code", e.getErrorCodeName());
                ev.put("type", errorType(e.errorCode));
                Throwable c = e.getCause();
                ev.put("detail", c != null && c.getMessage() != null ? c.getMessage() : e.getMessage());
                notifyListeners("state", ev);
            }

            @Override
            public void onTracksChanged(@NonNull Tracks tracks) { emitTracks(me); }

            @Override
            public void onVideoSizeChanged(@NonNull VideoSize v) {
                if (v.width > 0 && v.height > 0) me.frame.setAspectRatio(v.width * v.pixelWidthHeightRatio / v.height);
                emitTracks(me);
            }

            @Override
            public void onCues(@NonNull CueGroup cues) { me.subs.setCues(cues.cues); }
        });
        slots.put(id, s);
        startTicking();
        return s;
    }

    private static String errorType(int code) {
        switch (code) {
            case PlaybackException.ERROR_CODE_DECODER_INIT_FAILED:
            case PlaybackException.ERROR_CODE_DECODER_QUERY_FAILED:
            case PlaybackException.ERROR_CODE_DECODING_FAILED:
            case PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES:
            case PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED:
            case PlaybackException.ERROR_CODE_AUDIO_TRACK_INIT_FAILED:
                return "codec";
            case PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED:
            case PlaybackException.ERROR_CODE_PARSING_MANIFEST_MALFORMED:
            case PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED:
            case PlaybackException.ERROR_CODE_PARSING_MANIFEST_UNSUPPORTED:
                return "media";
            default:
                return "network";
        }
    }

    private void emitState(Slot s) {
        if ("error".equals(s.state) && s.player.getPlaybackState() == Player.STATE_IDLE) return;
        int st = s.player.getPlaybackState();
        String state = st == Player.STATE_BUFFERING ? "buffering" : st == Player.STATE_READY ? (s.player.isPlaying() ? "playing" : "ready")
            : st == Player.STATE_ENDED ? "ended" : "idle";
        s.state = state;
        JSObject e = new JSObject();
        e.put("id", s.id);
        e.put("state", state);
        notifyListeners("state", e);
    }

    private void emitTracks(Slot s) {
        JSObject e = new JSObject();
        e.put("id", s.id);
        JSArray audio = new JSArray(), text = new JSArray(), video = new JSArray();
        boolean textOn = false;
        int gi = 0;
        for (Tracks.Group g : s.player.getCurrentTracks().getGroups()) {
            int type = g.getType();
            for (int i = 0; i < g.length; i++) {
                Format f = g.getTrackFormat(i);
                JSObject t = new JSObject();
                t.put("group", gi);
                t.put("index", i);
                t.put("lang", f.language == null ? "" : f.language);
                t.put("label", f.label == null ? "" : f.label);
                t.put("mime", f.sampleMimeType == null ? "" : f.sampleMimeType);
                t.put("on", g.isTrackSelected(i));
                t.put("ok", g.isTrackSupported(i));
                if (type == C.TRACK_TYPE_AUDIO) { t.put("channels", f.channelCount); audio.put(t); }
                else if (type == C.TRACK_TYPE_TEXT) { text.put(t); if (g.isTrackSelected(i)) textOn = true; }
                else if (type == C.TRACK_TYPE_VIDEO) { t.put("h", f.height); t.put("w", f.width); t.put("bitrate", f.bitrate); t.put("codecs", f.codecs == null ? "" : f.codecs); video.put(t); }
            }
            gi++;
        }
        e.put("audio", audio);
        e.put("text", text);
        e.put("video", video);
        e.put("textOn", textOn);
        e.put("autoQuality", !s.player.getTrackSelectionParameters().overrides.keySet().stream().anyMatch(k -> k.type == C.TRACK_TYPE_VIDEO));
        VideoSize vs = s.player.getVideoSize();
        e.put("w", vs.width);
        e.put("h", vs.height);
        notifyListeners("tracks", e);
    }

    private void startTicking() {
        if (ticking) return;
        ticking = true;
        main.postDelayed(new Runnable() {
            @Override
            public void run() {
                for (Slot s : slots.values()) {
                    if (s.player.getPlaybackState() == Player.STATE_IDLE && !"error".equals(s.state)) continue;
                    JSObject e = new JSObject();
                    e.put("id", s.id);
                    e.put("pos", s.player.getCurrentPosition() / 1000.0);
                    long d = s.player.getDuration();
                    e.put("dur", d == C.TIME_UNSET ? -1 : d / 1000.0);
                    e.put("buf", s.player.getBufferedPosition() / 1000.0);
                    e.put("live", s.player.isCurrentMediaItemLive());
                    e.put("seekable", s.player.isCurrentMediaItemSeekable());
                    e.put("playing", s.player.isPlaying());
                    e.put("want", s.player.getPlayWhenReady());
                    DecoderCounters dc = s.player.getVideoDecoderCounters();
                    if (dc != null) {
                        dc.ensureUpdated();
                        e.put("dropped", dc.droppedBufferCount);
                        e.put("frames", dc.renderedOutputBufferCount + dc.droppedBufferCount);
                    }
                    notifyListeners("time", e);
                }
                main.postDelayed(this, 250);
            }
        }, 250);
    }

    private void ui(PluginCall call, Runnable r) {
        main.post(() -> {
            try { r.run(); call.resolve(); } catch (Exception e) { call.reject(e.getMessage()); }
        });
    }

    // ---- calls from the web app ----

    @PluginMethod
    public void open(PluginCall call) {
        int id = call.getInt("id", 1);
        String url = call.getString("url");
        String ua = call.getString("ua", "");
        String ref = call.getString("ref", "");
        String kind = call.getString("kind", "");
        double startAt = call.getDouble("startAt", 0.0);
        ui(call, () -> {
            Slot s = slot(id);
            Map<String, String> headers = new HashMap<>();
            if (ref != null && !ref.isEmpty()) headers.put("Referer", ref);
            DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
                .setUserAgent(ua != null && !ua.isEmpty() ? ua : Relay.DEFAULT_UA)
                .setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(12000)
                .setReadTimeoutMs(20000)
                .setDefaultRequestProperties(headers);
            // IPTV MPEG-TS often starts mid-GOP and without access-unit markers: be lenient so the picture comes fast.
            DefaultExtractorsFactory ex = new DefaultExtractorsFactory()
                .setTsExtractorFlags(DefaultTsPayloadReaderFactory.FLAG_ALLOW_NON_IDR_KEYFRAMES | DefaultTsPayloadReaderFactory.FLAG_DETECT_ACCESS_UNITS)
                .setConstantBitrateSeekingEnabled(true);
            s.player.setMediaSource(new DefaultMediaSourceFactory(http, ex).createMediaSource(item(url, kind)));
            s.state = "loading";
            s.player.prepare();
            if (startAt > 0) s.player.seekTo((long) (startAt * 1000));
            s.player.setVolume(s.volume);
            s.player.setPlayWhenReady(true);
        });
    }

    private static MediaItem item(String url, String kind) {
        MediaItem.Builder b = new MediaItem.Builder().setUri(url);
        if ("hls".equals(kind)) b.setMimeType(MimeTypes.APPLICATION_M3U8);
        else if ("dash".equals(kind)) b.setMimeType(MimeTypes.APPLICATION_MPD);
        else if ("ts".equals(kind)) b.setMimeType(MimeTypes.VIDEO_MP2T);
        return b.build();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        int id = call.getInt("id", 1);
        ui(call, () -> {
            Slot s = slots.get(id);
            if (s == null) return;
            s.player.stop();
            s.player.clearMediaItems();
            s.state = "idle";
            s.subs.setCues(java.util.Collections.emptyList());
            s.box.setVisibility(View.GONE);
        });
    }

    @PluginMethod
    public void play(PluginCall call) { int id = call.getInt("id", 1); ui(call, () -> { Slot s = slots.get(id); if (s != null) s.player.play(); }); }

    @PluginMethod
    public void pause(PluginCall call) { int id = call.getInt("id", 1); ui(call, () -> { Slot s = slots.get(id); if (s != null) s.player.pause(); }); }

    @PluginMethod
    public void seek(PluginCall call) {
        int id = call.getInt("id", 1);
        double sec = call.getDouble("pos", 0.0);
        ui(call, () -> { Slot s = slots.get(id); if (s != null) s.player.seekTo(Math.max(0, (long) (sec * 1000))); });
    }

    @PluginMethod
    public void live(PluginCall call) { int id = call.getInt("id", 1); ui(call, () -> { Slot s = slots.get(id); if (s != null) s.player.seekToDefaultPosition(); }); }

    @PluginMethod
    public void volume(PluginCall call) {
        int id = call.getInt("id", 1);
        float v = call.getFloat("volume", 1f);
        ui(call, () -> { Slot s = slot(id); s.volume = v; s.player.setVolume(v); });
    }

    /** Select a track: type "audio" | "text" | "video", group/index from the tracks event; group -1 = off (text) or automatic (video). */
    @PluginMethod
    public void track(PluginCall call) {
        int id = call.getInt("id", 1);
        String type = call.getString("type", "audio");
        int group = call.getInt("group", -1);
        int index = call.getInt("index", 0);
        ui(call, () -> {
            Slot s = slots.get(id);
            if (s == null) return;
            int t = "text".equals(type) ? C.TRACK_TYPE_TEXT : "video".equals(type) ? C.TRACK_TYPE_VIDEO : C.TRACK_TYPE_AUDIO;
            TrackSelectionParameters.Builder p = s.player.getTrackSelectionParameters().buildUpon();
            if (group < 0) {
                p.clearOverridesOfType(t);
                if (t == C.TRACK_TYPE_TEXT) p.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true);
            } else {
                Tracks.Group g = s.player.getCurrentTracks().getGroups().get(group);
                p.setOverrideForType(new TrackSelectionOverride(g.getMediaTrackGroup(), index));
                if (t == C.TRACK_TYPE_TEXT) p.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false);
            }
            s.player.setTrackSelectionParameters(p.build());
        });
    }

    /** Where the picture goes, in CSS pixels of the web view. front = above the page (mini player). */
    @PluginMethod
    public void layout(PluginCall call) {
        int id = call.getInt("id", 1);
        boolean show = Boolean.TRUE.equals(call.getBoolean("show", true));
        double dpr = call.getDouble("dpr", 1.0);
        int x = (int) Math.round(call.getDouble("x", 0.0) * dpr), y = (int) Math.round(call.getDouble("y", 0.0) * dpr);
        int w = (int) Math.round(call.getDouble("w", 0.0) * dpr), h = (int) Math.round(call.getDouble("h", 0.0) * dpr);
        boolean onTop = Boolean.TRUE.equals(call.getBoolean("front", false));
        String fit = call.getString("fit", "fit");
        ui(call, () -> {
            Slot s = slot(id);
            WebView web = getBridge().getWebView();
            FrameLayout layer = onTop ? front : back;
            if (s.box.getParent() != layer) { ((ViewGroup) s.box.getParent()).removeView(s.box); layer.addView(s.box); }
            FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(Math.max(1, w), Math.max(1, h));
            lp.leftMargin = web.getLeft() + x;
            lp.topMargin = web.getTop() + y;
            s.box.setLayoutParams(lp);
            s.box.setVisibility(show && w > 0 && h > 0 ? View.VISIBLE : View.GONE);
            s.box.setClickable(onTop);
            s.frame.setResizeMode("fill".equals(fit) ? AspectRatioFrameLayout.RESIZE_MODE_FILL
                : "zoom".equals(fit) ? AspectRatioFrameLayout.RESIZE_MODE_ZOOM : AspectRatioFrameLayout.RESIZE_MODE_FIT);
            if ("43".equals(fit)) s.frame.setAspectRatio(4f / 3f);
            back.setVisibility(anyVisible(back) ? View.VISIBLE : View.GONE);
        });
    }

    private static boolean anyVisible(FrameLayout layer) {
        for (int i = 0; i < layer.getChildCount(); i++) if (layer.getChildAt(i).getVisibility() == View.VISIBLE) return true;
        return false;
    }

    // Going to the background pauses; the picture-in-picture window keeps playing (the activity is paused there too).
    @Override
    protected void handleOnPause() {
        if (android.os.Build.VERSION.SDK_INT >= 24 && getActivity().isInPictureInPictureMode()) return;
        for (Slot s : slots.values()) { s.wasPlaying = s.player.getPlayWhenReady(); s.player.pause(); }
    }

    @Override
    protected void handleOnStop() {
        for (Slot s : slots.values()) { if (s.player.getPlayWhenReady()) s.wasPlaying = true; s.player.pause(); }
    }

    @Override
    protected void handleOnResume() {
        for (Slot s : slots.values()) if (s.wasPlaying) {
            // Live: back to the live edge rather than continuing minutes late.
            if (s.player.isCurrentMediaItemLive()) s.player.seekToDefaultPosition();
            s.player.play();
            s.wasPlaying = false;
        }
    }

    @Override
    protected void handleOnDestroy() {
        for (Slot s : slots.values()) s.player.release();
        slots.clear();
    }
}
