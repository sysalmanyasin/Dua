package com.duapharma.dua;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.ActivityManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.os.Build;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.core.location.LocationManagerCompat;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingClient;
import com.google.android.gms.location.GeofencingRequest;
import com.google.android.gms.location.LocationServices;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Registers the pharmacy's geofence with Google Play services (GeofencingClient) and reports what stops it from working.
 *
 * We ask for DWELL (the phone stayed inside for the stability period, 120 s by default) and EXIT. The system keeps watching while the app
 * is closed and the screen is locked; it forgets geofences when the phone restarts, when the app is updated, and when location is
 * switched off, so BootReceiver and the 15-minute check (AttendanceWatchdogWorker) register them again. Registering the same
 * request id twice just replaces the first.
 *
 * Phase 3 only RECORDS what is detected, in the local journal (AttendanceStore). Nothing is sent to the server yet.
 */
final class AttendanceGeofence {

    static final String ACTION = "com.duapharma.dua.GEOFENCE_EVENT";
    static final String CHANNEL = "dua_attendance";
    static final int NOTIFICATION_ID = 4101;
    private static final String WATCHDOG = "dua-attendance-watchdog";

    /** Called once when a registration finishes; ok is false with a short reason when it did not work. */
    interface Done {
        void finished(boolean ok, String error);
    }

    private AttendanceGeofence() {}

    // ───── what the phone allows ─────

    static boolean hasPrecise(Context c) {
        return ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    static boolean hasBackground(Context c) {
        return Build.VERSION.SDK_INT < 29 || ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    static boolean locationOn(Context c) {
        LocationManager lm = (LocationManager) c.getSystemService(Context.LOCATION_SERVICE);
        return lm != null && LocationManagerCompat.isLocationEnabled(lm);
    }

    /** The person (or a battery saver) set Dua to "Restricted" background use: Android then stops its background work. */
    static boolean backgroundRestricted(Context c) {
        if (Build.VERSION.SDK_INT < 28) return false;
        ActivityManager am = (ActivityManager) c.getSystemService(Context.ACTIVITY_SERVICE);
        return am != null && am.isBackgroundRestricted();
    }

    static boolean ignoringBatteryOptimisations(Context c) {
        PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(c.getPackageName());
    }

    static String problem(Context c) {
        return AttendanceLogic.problem(hasPrecise(c), hasBackground(c), locationOn(c), backgroundRestricted(c));
    }

    // ───── the geofence ─────

    private static PendingIntent pending(Context c) {
        Intent intent = new Intent(c, GeofenceReceiver.class).setAction(ACTION);
        // Geofencing fills in the event, so from Android 12 the PendingIntent has to be mutable.
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
        return PendingIntent.getBroadcast(c, 0, intent, flags);
    }

    /** Registers (or re-registers) every stored place. Safe to call at any time and from any thread; done may be null. */
    @SuppressLint("MissingPermission")
    static void register(Context context, Done done) {
        Context app = context.getApplicationContext();
        AttendanceStore store = new AttendanceStore(app);
        if (!store.enrolled()) {
            finish(done, false, "not_enrolled");
            return;
        }
        GeofencingClient client = LocationServices.getGeofencingClient(app);
        PendingIntent pi = pending(app);
        JSONArray sites = store.sites();
        if (sites.length() == 0) {
            client.removeGeofences(pi);
            store.setRegistered(false, "no_place");
            finish(done, false, "no_place");
            return;
        }
        String problem = problem(app);
        if (problem != null) {
            store.setRegistered(false, problem);
            finish(done, false, problem);
            return;
        }
        List<Geofence> fences = new ArrayList<>();
        int loiter = store.stableSeconds() * 1000;
        for (int i = 0; i < sites.length() && fences.size() < AttendanceLogic.MAX_SITES; i++) {
            JSONObject s = sites.optJSONObject(i);
            if (s == null) continue;
            fences.add(
                new Geofence.Builder()
                    .setRequestId(AttendanceLogic.requestId(s.optString("id")))
                    .setCircularRegion(s.optDouble("latitude"), s.optDouble("longitude"), (float) s.optInt("radius"))
                    .setExpirationDuration(Geofence.NEVER_EXPIRE)
                    .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_DWELL | Geofence.GEOFENCE_TRANSITION_EXIT)
                    .setLoiteringDelay(loiter)
                    .build()
            );
        }
        GeofencingRequest request = new GeofencingRequest.Builder().setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_DWELL).addGeofences(fences).build();
        // Remove first so a changed place or period replaces the old one, then add. Whatever the removal says, we still add.
        client
            .removeGeofences(pi)
            .addOnCompleteListener(removed ->
                client
                    .addGeofences(request, pi)
                    .addOnSuccessListener(v -> {
                        store.setRegistered(true, null);
                        finish(done, true, null);
                    })
                    .addOnFailureListener(e -> {
                        String why = "register_failed:" + (e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
                        store.setRegistered(false, why.length() > 120 ? why.substring(0, 120) : why);
                        finish(done, false, why);
                    })
            );
    }

    @SuppressLint("MissingPermission")
    static void unregister(Context context) {
        Context app = context.getApplicationContext();
        LocationServices.getGeofencingClient(app).removeGeofences(pending(app));
    }

    private static void finish(Done done, boolean ok, String error) {
        if (done != null) done.finished(ok, error);
    }

    // ───── the 15-minute check ─────

    static void ensureWatchdog(Context context) {
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(AttendanceWatchdogWorker.class, 15, TimeUnit.MINUTES).build();
        WorkManager.getInstance(context.getApplicationContext()).enqueueUniquePeriodicWork(WATCHDOG, ExistingPeriodicWorkPolicy.KEEP, request);
    }

    static void cancelWatchdog(Context context) {
        WorkManager.getInstance(context.getApplicationContext()).cancelUniqueWork(WATCHDOG);
    }

    // ───── telling the person ─────

    /** One quiet notification when automatic attendance stops working. Tapping it opens Dua. */
    static void notifyProblem(Context context) {
        Context app = context.getApplicationContext();
        try {
            NotificationManagerCompat manager = NotificationManagerCompat.from(app);
            if (!manager.areNotificationsEnabled()) return;
            if (Build.VERSION.SDK_INT >= 26) {
                NotificationChannel channel = new NotificationChannel(CHANNEL, app.getString(R.string.attendance_channel_name), NotificationManager.IMPORTANCE_DEFAULT);
                channel.setDescription(app.getString(R.string.attendance_channel_description));
                manager.createNotificationChannel(channel);
            }
            Intent open = app.getPackageManager().getLaunchIntentForPackage(app.getPackageName());
            PendingIntent tap = open == null ? null : PendingIntent.getActivity(app, 1, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            NotificationCompat.Builder builder = new NotificationCompat.Builder(app, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_dua)
                .setContentTitle(app.getString(R.string.attendance_off_title))
                .setContentText(app.getString(R.string.attendance_off_text))
                .setStyle(new NotificationCompat.BigTextStyle().bigText(app.getString(R.string.attendance_off_text)))
                .setAutoCancel(true)
                .setContentIntent(tap);
            manager.notify(NOTIFICATION_ID, builder.build());
        } catch (SecurityException ignored) {
            // notifications are not allowed; the Attendance page still shows the problem
        }
    }

    static void clearProblemNotification(Context context) {
        try {
            NotificationManagerCompat.from(context.getApplicationContext()).cancel(NOTIFICATION_ID);
        } catch (SecurityException ignored) {
            // nothing to clear
        }
    }
}
