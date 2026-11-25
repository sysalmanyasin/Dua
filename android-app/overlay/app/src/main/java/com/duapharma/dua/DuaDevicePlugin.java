package com.duapharma.dua;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.os.Build;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.android.gms.location.CurrentLocationRequest;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import java.util.UUID;

/**
 * The only custom native code the web app talks to. Three small jobs a web page cannot do:
 *  - an install id (identifies this phone to the server; not a secret),
 *  - the location WITH Android's mock-location flag, for geo-fenced attendance (the server measures the distance and decides),
 *  - keeping the home-screen widget's secret in encrypted storage.
 * Only the live Dua site can call it (capacitor.config.json: server.url + allowNavigation).
 */
@CapacitorPlugin(
    name = "DuaDevice",
    permissions = { @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }) }
)
public class DuaDevicePlugin extends Plugin {

    @PluginMethod
    public void getDeviceInfo(PluginCall call) {
        Context context = getContext();
        SharedPreferences prefs = context.getSharedPreferences("dua_device", Context.MODE_PRIVATE);
        String id = prefs.getString("device_id", null);
        if (id == null) {
            id = UUID.randomUUID().toString();
            prefs.edit().putString("device_id", id).apply();
        }
        String version = "unknown";
        try {
            version = context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionName;
        } catch (PackageManager.NameNotFoundException ignored) {
            // keep "unknown"
        }
        JSObject result = new JSObject();
        result.put("deviceId", id);
        result.put("version", version);
        call.resolve(result);
    }

    // ───── attendance location ─────

    @PluginMethod
    public void getAttendanceLocation(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "locationPermissionCallback");
            return;
        }
        readLocation(call);
    }

    @PermissionCallback
    private void locationPermissionCallback(PluginCall call) {
        if (getPermissionState("location") == PermissionState.GRANTED) readLocation(call);
        else call.reject("Location permission denied", "1");
    }

    @SuppressLint("MissingPermission")
    private void readLocation(PluginCall call) {
        // "Approximate" location is not enough to prove someone is at the pharmacy.
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            call.reject("Location permission denied: allow precise location for Dua", "1");
            return;
        }
        CurrentLocationRequest request = new CurrentLocationRequest.Builder().setPriority(Priority.PRIORITY_HIGH_ACCURACY).setDurationMillis(20000).setMaxUpdateAgeMillis(0).build();
        LocationServices.getFusedLocationProviderClient(getContext())
            .getCurrentLocation(request, null)
            .addOnSuccessListener(location -> {
                if (location == null) {
                    call.reject("Could not read the location (timed out)", "3");
                    return;
                }
                JSObject result = new JSObject();
                result.put("latitude", location.getLatitude());
                result.put("longitude", location.getLongitude());
                result.put("accuracy", location.hasAccuracy() ? location.getAccuracy() : 100000);
                result.put("mock", isMock(location));
                call.resolve(result);
            })
            .addOnFailureListener(e -> call.reject("Could not read the location (timed out)", "3"));
    }

    @SuppressWarnings("deprecation")
    private static boolean isMock(Location location) {
        return Build.VERSION.SDK_INT >= 31 ? location.isMock() : location.isFromMockProvider();
    }

    // ───── Today's Sale widget ─────

    @PluginMethod
    public void getWidgetState(PluginCall call) {
        WidgetStore store = new WidgetStore(getContext());
        JSObject result = new JSObject();
        result.put("configured", store.isConfigured());
        result.put("userId", (String) store.userId());
        call.resolve(result);
    }

    @PluginMethod
    public void saveWidgetConfig(PluginCall call) {
        String userId = call.getString("userId");
        String deviceId = call.getString("deviceId");
        String secret = call.getString("secret");
        String endpoint = call.getString("endpoint");
        boolean valid =
            userId != null &&
            deviceId != null &&
            secret != null &&
            secret.matches("[0-9a-f]{64}") &&
            endpoint != null &&
            endpoint.matches("https://[a-z0-9-]+\\.supabase\\.co/functions/v1/widget-today");
        if (!valid) {
            call.reject("Invalid widget settings");
            return;
        }
        if (!new WidgetStore(getContext()).save(userId, deviceId, secret, endpoint)) {
            call.reject("This phone cannot store the widget secret safely");
            return;
        }
        WidgetScheduler.ensure(getContext());
        WidgetScheduler.refreshNow(getContext());
        TodayWidgetProvider.updateAll(getContext());
        call.resolve();
    }

    @PluginMethod
    public void clearWidgetConfig(PluginCall call) {
        new WidgetStore(getContext()).clear();
        TodayWidgetProvider.updateAll(getContext());
        call.resolve();
    }
}
