package com.duapharma.dua;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.location.Location;
import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingEvent;
import java.util.List;

/**
 * Receives the geofence transitions from Google Play services, also while Dua is closed and the screen is locked.
 * It writes what it saw into the local journal and, when the owner has switched automatic recording on, hands the detection to
 * AttendanceEvents (a fresh location check, then the event goes to the server, which decides). It does no network work itself.
 * Not exported: only Google Play services, through the PendingIntent that Dua gave it, can reach it.
 */
public class GeofenceReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        GeofencingEvent event = GeofencingEvent.fromIntent(intent);
        if (event == null) return;
        AttendanceStore store = new AttendanceStore(context);
        if (!store.enrolled()) return;
        long now = System.currentTimeMillis();

        if (event.hasError()) {
            // 1000 = geofencing not available (location switched off, Play services reset): registering again is needed once it is back.
            store.addJournal("error:" + event.getErrorCode(), now, Double.NaN, Double.NaN, 0f, null);
            store.setRegistered(false, "geofence_error:" + event.getErrorCode());
            return;
        }
        String name = AttendanceLogic.transitionName(event.getGeofenceTransition());
        if (name == null) return;
        Location where = event.getTriggeringLocation();
        List<Geofence> fences = event.getTriggeringGeofences();
        if (fences == null || fences.isEmpty()) return;
        for (Geofence fence : fences) {
            String siteId = AttendanceLogic.siteIdOf(fence.getRequestId());
            if (siteId == null) continue;
            store.addJournal(
                name,
                now,
                where == null ? Double.NaN : where.getLatitude(),
                where == null ? Double.NaN : where.getLongitude(),
                where != null && where.hasAccuracy() ? where.getAccuracy() : 0f,
                siteId
            );
            AttendanceEvents.onTransition(context, name, siteId, now);
        }
    }
}
