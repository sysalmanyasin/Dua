package com.duapharma.dua;

import android.annotation.SuppressLint;
import android.content.Context;
import android.location.Location;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.work.Data;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import com.google.android.gms.location.CurrentLocationRequest;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import com.google.android.gms.tasks.Tasks;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Two jobs, both in the background:
 *  confirm: take a FRESH location (the geofence's own location is often only about 100 m accurate), decide with AttendanceLogic.decide,
 *           and queue the event with an id of its own; then try to send it.
 *  flush:   send what is waiting.
 * The phone never decides whether the person was at work: it reports what it saw and the server measures and decides.
 */
public class AttendanceEventWorker extends Worker {

    public AttendanceEventWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        Data input = getInputData();
        if ("flush".equals(input.getString(AttendanceEvents.KEY_TASK))) {
            return AttendanceSender.flush(context) ? Result.success() : Result.retry();
        }
        return confirm(context, input);
    }

    @SuppressLint("MissingPermission")
    private Result confirm(Context context, Data input) {
        AttendanceStore store = new AttendanceStore(context);
        String kind = input.getString(AttendanceEvents.KEY_KIND);
        String siteId = input.getString(AttendanceEvents.KEY_SITE);
        long at = input.getLong(AttendanceEvents.KEY_AT, System.currentTimeMillis());
        if (!store.enrolled() || !store.autoOn() || !AttendanceLogic.validKind(kind)) return Result.success();
        JSONObject site = store.siteById(siteId);
        if (site == null) return Result.success(); // the place was removed or switched off meanwhile
        boolean last = getRunAttemptCount() + 1 >= AttendanceLogic.MAX_ATTEMPTS;

        Location fix = null;
        if (AttendanceGeofence.hasPrecise(context)) {
            try {
                CurrentLocationRequest request = new CurrentLocationRequest.Builder()
                    .setPriority(Priority.PRIORITY_HIGH_ACCURACY)
                    .setDurationMillis(25000)
                    .setMaxUpdateAgeMillis(0)
                    .build();
                fix = Tasks.await(LocationServices.getFusedLocationProviderClient(context).getCurrentLocation(request, null), 40, TimeUnit.SECONDS);
            } catch (Exception e) {
                if (e instanceof InterruptedException) Thread.currentThread().interrupt();
                fix = null;
            }
        }
        if (fix == null) {
            if (last) {
                store.addJournalResult("no_fix", kind, null, at);
                return Result.success();
            }
            return Result.retry();
        }

        double distance = AttendanceLogic.distanceMetres(fix.getLatitude(), fix.getLongitude(), site.optDouble("latitude"), site.optDouble("longitude"));
        double accuracy = fix.hasAccuracy() ? fix.getAccuracy() : 100000;
        int decision = AttendanceLogic.decide(kind, distance, accuracy, site.optInt("radius"), store.maxAccuracy(), last);
        if (decision == AttendanceLogic.RETRY) return Result.retry();
        if (decision == AttendanceLogic.CANCEL) {
            store.addJournalResult("cancelled", kind, "back_inside", at);
            return Result.success();
        }
        try {
            JSONObject event = new JSONObject()
                .put("event_id", UUID.randomUUID().toString())
                .put("kind", kind)
                .put("at", at)
                .put("latitude", fix.getLatitude())
                .put("longitude", fix.getLongitude())
                .put("accuracy", accuracy)
                .put("mock", isMock(fix));
            store.queueAdd(event);
        } catch (JSONException e) {
            return Result.success();
        }
        if (!AttendanceSender.flush(context)) AttendanceEvents.flushLater(context);
        return Result.success();
    }

    @SuppressWarnings("deprecation")
    private static boolean isMock(Location location) {
        return Build.VERSION.SDK_INT >= 31 ? location.isMock() : location.isFromMockProvider();
    }
}
