package com.duapharma.dua;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Android forgets every geofence when the phone restarts and when Dua is updated. This puts the pharmacy's geofence back, so a staff
 * member does not have to open Dua after a restart. It only acts on a phone that is already set up for automatic attendance.
 */
public class BootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action) && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) return;
        if (!new AttendanceStore(context).enrolled()) return;
        final PendingResult pending = goAsync();
        AttendanceGeofence.ensureWatchdog(context);
        AttendanceGeofence.register(context, (ok, error) -> pending.finish());
    }
}
