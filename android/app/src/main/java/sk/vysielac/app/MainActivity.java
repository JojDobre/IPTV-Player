package sk.vysielac.app;

import android.app.PictureInPictureParams;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.util.Rational;
import android.view.KeyEvent;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private boolean autoPip = false;

    private boolean pipSupported() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE);
    }

    private PictureInPictureParams pipParams() {
        PictureInPictureParams.Builder b = new PictureInPictureParams.Builder().setAspectRatio(new Rational(16, 9));
        // Android 12+: the window shrinks smoothly by itself when the user goes Home.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) b.setAutoEnterEnabled(autoPip).setSeamlessResizeEnabled(true);
        return b.build();
    }

    void setAutoPip(boolean on) {
        autoPip = on;
        if (pipSupported()) setPictureInPictureParams(pipParams());
    }

    boolean enterPip() {
        if (!pipSupported()) return false;
        try { return enterPictureInPictureMode(pipParams()); } catch (Exception e) { return false; }
    }

    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (autoPip && Build.VERSION.SDK_INT < Build.VERSION_CODES.S) enterPip();
    }

    @Override
    public void onPictureInPictureModeChanged(boolean inPip, Configuration cfg) {
        super.onPictureInPictureModeChanged(inPip, cfg);
        if (getBridge() != null) getBridge().getWebView().evaluateJavascript(
            "dispatchEvent(new CustomEvent('vysielac-pip',{detail:" + inPip + "}))", null);
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LocalRelayPlugin.class);
        registerPlugin(NativePlayerPlugin.class);
        super.onCreate(savedInstanceState);
        // Back belongs to the app (close the player, go home…); it decides itself when to leave.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() { sendKey("GoBack", 461); }
        });
    }

    /** Remote buttons that the web view does not pass on as keyboard events. */
    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        String key = null;
        int code = 0;
        switch (e.getKeyCode()) {
            case KeyEvent.KEYCODE_CHANNEL_UP: key = "ChannelUp"; code = 427; break;
            case KeyEvent.KEYCODE_CHANNEL_DOWN: key = "ChannelDown"; code = 428; break;
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE: case KeyEvent.KEYCODE_MEDIA_PLAY: case KeyEvent.KEYCODE_MEDIA_PAUSE: key = "MediaPlayPause"; code = 415; break;
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD: key = "MediaFastForward"; code = 417; break;
            case KeyEvent.KEYCODE_MEDIA_REWIND: key = "MediaRewind"; code = 412; break;
            case KeyEvent.KEYCODE_MEDIA_STOP: key = "MediaStop"; code = 413; break;
            case KeyEvent.KEYCODE_PROG_RED: key = "ColorF0Red"; code = 403; break;
            case KeyEvent.KEYCODE_PROG_BLUE: key = "ColorF3Blue"; code = 406; break;
            case KeyEvent.KEYCODE_INFO: key = "i"; code = 73; break;
            case KeyEvent.KEYCODE_GUIDE: key = "Guide"; code = 458; break;
            case KeyEvent.KEYCODE_MENU: key = "ContextMenu"; code = 93; break;
            default: break;
        }
        if (key == null) return super.dispatchKeyEvent(e);
        if (e.getAction() == KeyEvent.ACTION_DOWN) sendKey(key, code);
        return true;
    }

    private void sendKey(String key, int code) {
        if (getBridge() == null) return;
        getBridge().getWebView().evaluateJavascript(
            "document.dispatchEvent(new KeyboardEvent('keydown',{key:'" + key + "',keyCode:" + code + ",bubbles:true}))", null);
    }
}
