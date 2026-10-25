package sk.vysielac.app;

import android.app.UiModeManager;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.content.Context;
import android.content.res.Configuration;
import android.view.WindowManager;
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

    @PluginMethod
    public void info(PluginCall call) {
        try {
            int port = RELAY.start();
            UiModeManager ui = (UiModeManager) getContext().getSystemService(Context.UI_MODE_SERVICE);
            boolean tv = ui != null && ui.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION;
            JSObject r = new JSObject();
            r.put("port", port);
            r.put("tv", tv);
            r.put("sdk", Build.VERSION.SDK_INT);
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

    /** Back on the home screen with nothing left to close: leave the app like any other. */
    @PluginMethod
    public void exit(PluginCall call) {
        getActivity().runOnUiThread(() -> getActivity().moveTaskToBack(true));
        call.resolve();
    }
}
