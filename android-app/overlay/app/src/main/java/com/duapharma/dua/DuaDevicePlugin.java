package com.duapharma.dua;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
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
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The only custom native code the web app talks to. Three small jobs a web page cannot do:
 *  - an install id (identifies this phone to the server; not a secret),
 *  - the location WITH Android's mock-location flag, for geo-fenced attendance (the server measures the distance and decides),
 *  - keeping the home-screen widget's secret in encrypted storage,
 *  - automatic attendance: the pharmacy's geofence, the permissions it needs, and what it detected (see AttendanceGeofence).
 * Only the live Dua site can call it (capacitor.config.json: server.url + allowNavigation).
 */
@CapacitorPlugin(
    name = "DuaDevice",
    permissions = {
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }),
        // "Allow all the time". Android 10 shows a dialog; Android 11 and later send the person to the app's location settings instead.
        @Permission(alias = "background", strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION })
    }
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

    // ───── automatic attendance (geofence) ─────

    /** Everything the Attendance page needs to show whether automatic attendance can work on this phone, and what it has detected. */
    private JSObject autoStatus() {
        Context context = getContext();
        AttendanceStore store = new AttendanceStore(context);
        JSObject result = new JSObject();
        result.put("sdk", Build.VERSION.SDK_INT);
        result.put("available", store.available());
        result.put("enrolled", store.enrolled());
        result.put("precise", AttendanceGeofence.hasPrecise(context));
        result.put("background", AttendanceGeofence.hasBackground(context));
        result.put("locationOn", AttendanceGeofence.locationOn(context));
        result.put("backgroundRestricted", AttendanceGeofence.backgroundRestricted(context));
        result.put("batteryUnrestricted", AttendanceGeofence.ignoringBatteryOptimisations(context));
        result.put("problem", store.enrolled() ? AttendanceGeofence.problem(context) : null);
        result.put("registered", store.registered());
        result.put("registeredAt", store.registeredAt());
        result.put("lastCheckAt", store.lastCheckAt());
        result.put("lastError", store.lastError());
        result.put("stableSeconds", store.stableSeconds());
        result.put("auto", store.autoOn());
        result.put("hasKey", store.hasKey());
        result.put("pending", store.queueSize());
        result.put("maxAccuracy", store.maxAccuracy());
        result.put("sites", store.sites());
        result.put("journal", store.journal());
        return result;
    }

    @PluginMethod
    public void getAutoAttendanceStatus(PluginCall call) {
        call.resolve(autoStatus());
    }

    /**
     * Saves the places to watch and registers the geofence. Called by the web app after sign-in with what the server sent
     * (mgmt_attendance_my_site). An empty list stops watching but keeps this phone set up.
     * "auto" is the owner's switch: when it is off the phone only lists what it detects (test mode). When it is on the phone also needs
     * deviceId, endpoint (pinned to our attendance-event function) and, the first time, the secret the server issued for this phone.
     */
    @PluginMethod
    public void startAutoAttendance(PluginCall call) {
        String userId = call.getString("userId");
        Integer stable = call.getInt("stableSeconds");
        JSArray list = call.getArray("sites");
        if (userId == null || userId.length() < 8 || stable == null || AttendanceLogic.validateStable(stable) != null || list == null || list.length() > AttendanceLogic.MAX_SITES) {
            call.reject("Invalid automatic attendance settings");
            return;
        }
        boolean auto = Boolean.TRUE.equals(call.getBoolean("auto", false));
        Integer maxAccuracy = call.getInt("maxAccuracy", 100);
        String deviceId = call.getString("deviceId");
        String endpoint = call.getString("endpoint");
        String secret = call.getString("secret");
        if (maxAccuracy == null || maxAccuracy < 10 || maxAccuracy > 1000) {
            call.reject("Invalid accuracy limit");
            return;
        }
        if (auto && (!AttendanceLogic.validDeviceId(deviceId) || !AttendanceLogic.validEndpoint(endpoint))) {
            call.reject("Invalid automatic recording settings");
            return;
        }
        if (secret != null && !AttendanceLogic.validSecret(secret)) {
            call.reject("Invalid automatic recording settings");
            return;
        }
        JSONArray clean = new JSONArray();
        try {
            for (int i = 0; i < list.length(); i++) {
                JSONObject site = list.getJSONObject(i);
                String id = site.getString("id");
                double lat = site.getDouble("latitude");
                double lng = site.getDouble("longitude");
                int radius = site.getInt("radius");
                String bad = AttendanceLogic.validateSite(id, lat, lng, radius);
                if (bad != null) {
                    call.reject("Invalid place: " + bad);
                    return;
                }
                String name = site.optString("name", "");
                clean.put(new JSONObject().put("id", id).put("name", name.length() > 60 ? name.substring(0, 60) : name).put("latitude", lat).put("longitude", lng).put("radius", radius));
            }
        } catch (Exception e) {
            call.reject("Invalid automatic attendance settings");
            return;
        }
        AttendanceStore store = new AttendanceStore(getContext());
        if (!store.save(userId, clean, stable, auto, maxAccuracy, auto ? deviceId : null, auto ? endpoint : null, auto ? secret : null)) {
            call.reject("This phone cannot store the settings safely");
            return;
        }
        if (!auto) AttendanceEvents.cancelAll(getContext());
        else if (store.hasKey() && store.queueSize() > 0) AttendanceEvents.flushLater(getContext());
        AttendanceGeofence.ensureWatchdog(getContext());
        AttendanceGeofence.register(getContext(), (ok, error) -> call.resolve(autoStatus()));
    }

    /** Sign-out, or the person lost the right: stop watching and forget everything. */
    @PluginMethod
    public void stopAutoAttendance(PluginCall call) {
        AttendanceGeofence.unregister(getContext());
        AttendanceGeofence.cancelWatchdog(getContext());
        AttendanceGeofence.clearProblemNotification(getContext());
        AttendanceEvents.cancelAll(getContext());
        new AttendanceStore(getContext()).clear();
        call.resolve();
    }

    /** Precise location first, then "all the time". The page shows the explanation before calling this. */
    @PluginMethod
    public void requestBackgroundLocation(PluginCall call) {
        if (!AttendanceGeofence.hasPrecise(getContext())) {
            requestPermissionForAlias("location", call, "backgroundStepOne");
            return;
        }
        askBackground(call);
    }

    @PermissionCallback
    private void backgroundStepOne(PluginCall call) {
        if (!AttendanceGeofence.hasPrecise(getContext())) {
            call.reject("Precise location was not allowed", "1");
            return;
        }
        askBackground(call);
    }

    private void askBackground(PluginCall call) {
        if (Build.VERSION.SDK_INT < 29 || AttendanceGeofence.hasBackground(getContext())) {
            call.resolve(autoStatus());
            return;
        }
        requestPermissionForAlias("background", call, "backgroundStepTwo");
    }

    @PermissionCallback
    private void backgroundStepTwo(PluginCall call) {
        // On Android 11 and later the system opens the app's location settings instead of a dialog and this returns at once. The person
        // finishes there; the page asks for the status again when Dua is shown again.
        call.resolve(autoStatus());
    }

    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
        if (intent.resolveActivity(getContext().getPackageManager()) == null) {
            openAppSettings(call);
            return;
        }
        getActivity().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", getContext().getPackageName(), null));
        getActivity().startActivity(intent);
        call.resolve();
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
