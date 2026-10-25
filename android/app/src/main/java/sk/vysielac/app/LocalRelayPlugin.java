package sk.vysielac.app;

import android.app.UiModeManager;
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
            r.put("sdk", android.os.Build.VERSION.SDK_INT);
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

    /** Back on the home screen with nothing left to close: leave the app like any other. */
    @PluginMethod
    public void exit(PluginCall call) {
        getActivity().runOnUiThread(() -> getActivity().moveTaskToBack(true));
        call.resolve();
    }
}
