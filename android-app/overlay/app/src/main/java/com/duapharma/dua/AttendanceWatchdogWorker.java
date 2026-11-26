package com.duapharma.dua;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.util.Objects;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * Every 15 minutes (Android's shortest period) on a phone set up for automatic attendance:
 *  - notices when location, precise or "all the time" permission, or background use was taken away, and tells the person once;
 *  - registers the geofence again when the problem is gone (switching location off and on drops geofences), and once a day regardless.
 * It does NOT re-register on every run: that would restart the stability timer each time.
 */
public class AttendanceWatchdogWorker extends Worker {

    private static final long DAY = TimeUnit.HOURS.toMillis(24);

    public AttendanceWatchdogWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        AttendanceStore store = new AttendanceStore(context);
        if (!store.enrolled()) return Result.success();

        String before = store.lastProblem();
        String now = AttendanceGeofence.problem(context);
        boolean changed = !Objects.equals(before, now);
        store.setLastProblem(now);

        if (now != null) {
            if (changed) AttendanceGeofence.notifyProblem(context);
            return Result.success();
        }
        if (before != null) AttendanceGeofence.clearProblemNotification(context);
        boolean stale = System.currentTimeMillis() - store.registeredAt() > DAY;
        if (before != null || stale || !store.registered()) {
            CountDownLatch done = new CountDownLatch(1);
            AttendanceGeofence.register(context, (ok, error) -> done.countDown());
            try {
                done.await(20, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
        return Result.success();
    }
}
