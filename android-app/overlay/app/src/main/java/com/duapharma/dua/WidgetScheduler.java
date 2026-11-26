package com.duapharma.dua;

import android.content.Context;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import java.util.concurrent.TimeUnit;

/** Background refresh of the widget. Android allows a periodic job at most every 15 minutes; Candela itself syncs hourly. */
final class WidgetScheduler {

    private static final String PERIODIC = "dua-widget-periodic";
    private static final String NOW = "dua-widget-now";

    private WidgetScheduler() {}

    private static Constraints online() {
        return new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
    }

    static void ensure(Context context) {
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(TodayWidgetWorker.class, 15, TimeUnit.MINUTES).setConstraints(online()).build();
        WorkManager.getInstance(context.getApplicationContext()).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, request);
    }

    static void refreshNow(Context context) {
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(TodayWidgetWorker.class).setConstraints(online()).build();
        WorkManager.getInstance(context.getApplicationContext()).enqueueUniqueWork(NOW, ExistingWorkPolicy.REPLACE, request);
    }

    static void cancel(Context context) {
        WorkManager manager = WorkManager.getInstance(context.getApplicationContext());
        manager.cancelUniqueWork(PERIODIC);
        manager.cancelUniqueWork(NOW);
    }
}
