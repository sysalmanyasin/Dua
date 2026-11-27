package com.duapharma.dua;

import android.content.Context;
import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import java.util.concurrent.TimeUnit;

/**
 * Turns what the geofence detected into work for WorkManager (which survives the app being closed and the phone restarting):
 *  - stayed inside (dwell): confirm with a fresh location right away, then queue an "in";
 *  - left (exit): wait the stability period, confirm the person is still outside, then queue an "out";
 *    a dwell in between cancels the pending "out" (they came back).
 * Nothing happens unless the owner switched automatic recording on (test mode only lists detections).
 */
final class AttendanceEvents {

    static final String WORK_IN = "dua-attendance-in";
    static final String WORK_OUT = "dua-attendance-out";
    static final String WORK_FLUSH = "dua-attendance-flush";
    static final String KEY_TASK = "task";
    static final String KEY_KIND = "kind";
    static final String KEY_AT = "at";
    static final String KEY_SITE = "site";

    private AttendanceEvents() {}

    /** Called by the geofence receiver for every transition it journals. */
    static void onTransition(Context context, String transition, String siteId, long at) {
        AttendanceStore store = new AttendanceStore(context);
        if (!store.enrolled() || !store.autoOn() || siteId == null) return;
        if ("dwell".equals(transition)) {
            cancel(context, WORK_OUT);
            confirm(context, "in", siteId, at, 0);
        } else if ("exit".equals(transition)) {
            cancel(context, WORK_IN);
            confirm(context, "out", siteId, at, AttendanceLogic.confirmDelaySeconds("out", store.stableSeconds()));
        }
    }

    private static void confirm(Context context, String kind, String siteId, long at, long delaySeconds) {
        Data input = new Data.Builder().putString(KEY_TASK, "confirm").putString(KEY_KIND, kind).putString(KEY_SITE, siteId).putLong(KEY_AT, at).build();
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(AttendanceEventWorker.class)
            .setInputData(input)
            .setInitialDelay(delaySeconds, TimeUnit.SECONDS)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 60, TimeUnit.SECONDS)
            .build();
        WorkManager.getInstance(context.getApplicationContext()).enqueueUniqueWork("in".equals(kind) ? WORK_IN : WORK_OUT, ExistingWorkPolicy.REPLACE, request);
    }

    /** Send what is waiting as soon as there is a network (retries with a growing wait). */
    static void flushLater(Context context) {
        Data input = new Data.Builder().putString(KEY_TASK, "flush").build();
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(AttendanceEventWorker.class)
            .setInputData(input)
            .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build();
        WorkManager.getInstance(context.getApplicationContext()).enqueueUniqueWork(WORK_FLUSH, ExistingWorkPolicy.KEEP, request);
    }

    static void cancel(Context context, String name) {
        WorkManager.getInstance(context.getApplicationContext()).cancelUniqueWork(name);
    }

    /** Sign-out or no right any more: nothing may stay scheduled. */
    static void cancelAll(Context context) {
        cancel(context, WORK_IN);
        cancel(context, WORK_OUT);
        cancel(context, WORK_FLUSH);
    }
}
