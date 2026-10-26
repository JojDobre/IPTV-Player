package sk.vysielac.app;

import android.app.UiModeManager;
import java.io.IOException;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.content.Context;
import android.content.res.Configuration;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Bridge for the web app: where the in-app relay listens, whether this is a TV, and a few window controls. */
@CapacitorPlugin(name = "LocalRelay")
public class LocalRelayPlugin extends Plugin {
    private static final Relay RELAY = new Relay();
    private float[] insets = new float[4];

    /**
     * Status bar, navigation bar and notch sizes for the page (CSS px), as --sa-t/--sa-r/--sa-b/--sa-l.
     * Android's web view does not fill env(safe-area-inset-*), so the header would sit under the status bar.
     */
    @Override
    public void load() {
        getActivity().runOnUiThread(() -> {
            View probe = new View(getContext());
            ((ViewGroup) getBridge().getWebView().getParent()).addView(probe, new ViewGroup.LayoutParams(0, 0));
            ViewCompat.setOnApplyWindowInsetsListener(probe, (v, wi) -> {
                Insets i = wi.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
                float d = getContext().getResources().getDisplayMetrics().density;
                insets = new float[] { i.top / d, i.right / d, i.bottom / d, i.left / d };
                getBridge().getWebView().evaluateJavascript(insetsJs(), null);
                return wi;
            });
            ViewCompat.requestApplyInsets(probe);
        });
    }

    private String insetsJs() {
        return "(function(s){s.setProperty('--sa-t','" + insets[0] + "px');s.setProperty('--sa-r','" + insets[1] + "px');"
            + "s.setProperty('--sa-b','" + insets[2] + "px');s.setProperty('--sa-l','" + insets[3] + "px')})(document.documentElement.style)";
    }

    @PluginMethod
    public void info(PluginCall call) {
        try {
            if (Relay.pairPage == null) Relay.pairPage = () -> {
                try (java.io.InputStream in = getContext().getAssets().open("public/pair.html")) {
                    java.io.ByteArrayOutputStream b = new java.io.ByteArrayOutputStream();
                    byte[] buf = new byte[8192];
                    for (int k; (k = in.read(buf)) > 0; ) b.write(buf, 0, k);
                    return b.toByteArray();
                } catch (IOException e) { return null; }
            };
            int port = RELAY.start();
            UiModeManager ui = (UiModeManager) getContext().getSystemService(Context.UI_MODE_SERVICE);
            boolean tv = ui != null && ui.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION;
            JSObject r = new JSObject();
            r.put("port", port);
            r.put("tv", tv);
            r.put("sdk", Build.VERSION.SDK_INT);
            JSObject sa = new JSObject();
            sa.put("t", insets[0]); sa.put("r", insets[1]); sa.put("b", insets[2]); sa.put("l", insets[3]);
            r.put("insets", sa);
            r.put("pip", !tv && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE));
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Relay sa nespustil: " + e.getMessage());
        }
    }

    /** Playing: screen stays on and, on phones, the system bars hide. */
    @PluginMethod
    public void playing(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getActivity().getWindow(), getActivity().getWindow().getDecorView());
            c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            if (on) c.hide(WindowInsetsCompat.Type.systemBars()); else c.show(WindowInsetsCompat.Type.systemBars());
        });
        call.resolve();
    }

    /** landscape | portrait | auto (follow the sensor and the system setting). */
    @PluginMethod
    public void orientation(PluginCall call) {
        String m = call.getString("mode", "auto");
        int o = "landscape".equals(m) ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            : "portrait".equals(m) ? ActivityInfo.SCREEN_ORIENTATION_PORTRAIT : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
        getActivity().runOnUiThread(() -> getActivity().setRequestedOrientation(o));
        call.resolve();
    }

    /** Whether leaving the app (Home) while watching continues in a picture-in-picture window. */
    @PluginMethod
    public void pip(PluginCall call) {
        boolean auto = Boolean.TRUE.equals(call.getBoolean("auto", false));
        getActivity().runOnUiThread(() -> ((MainActivity) getActivity()).setAutoPip(auto));
        call.resolve();
    }

    @PluginMethod
    public void pipNow(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (((MainActivity) getActivity()).enterPip()) call.resolve(); else call.reject("PiP nie je dostupné");
        });
    }

    /** Short haptic feedback: tap (double tap, channel change) or long (menu on hold). No permission needed. */
    @PluginMethod
    public void haptic(PluginCall call) {
        String k = call.getString("kind", "tap");
        getActivity().runOnUiThread(() -> getBridge().getWebView().performHapticFeedback(
            "long".equals(k) ? android.view.HapticFeedbackConstants.LONG_PRESS : android.view.HapticFeedbackConstants.KEYBOARD_TAP));
        call.resolve();
    }

    /**
     * Google Play's rating window. Google decides whether it actually appears (quota, installs not from Play);
     * the app gets no answer about what the user chose, by design.
     */
    @PluginMethod
    public void review(PluginCall call) {
        com.google.android.play.core.review.ReviewManager m = com.google.android.play.core.review.ReviewManagerFactory.create(getContext());
        m.requestReviewFlow().addOnCompleteListener(t -> {
            if (!t.isSuccessful()) { call.reject("review unavailable"); return; }
            m.launchReviewFlow(getActivity(), t.getResult()).addOnCompleteListener(x -> call.resolve());
        });
    }

    /** The app's page in Google Play (from Settings → Rate the app). */
    @PluginMethod
    public void openStore(PluginCall call) {
        String id = getContext().getPackageName();
        android.content.Intent i = new android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse("market://details?id=" + id));
        i.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
        try { getContext().startActivity(i); }
        catch (Exception e) {
            getContext().startActivity(new android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse("https://play.google.com/store/apps/details?id=" + id)).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK));
        }
        call.resolve();
    }

    /** Back on the home screen with nothing left to close: leave the app like any other. */
    @PluginMethod
    public void exit(PluginCall call) {
        getActivity().runOnUiThread(() -> getActivity().moveTaskToBack(true));
        call.resolve();
    }
}
