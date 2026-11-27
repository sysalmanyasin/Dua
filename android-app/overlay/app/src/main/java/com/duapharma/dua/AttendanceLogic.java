package com.duapharma.dua;

/**
 * Decisions for automatic attendance that need no Android, so they are unit-tested on any computer (AttendanceLogicTest).
 * The ranges are the database's own (migrations 0110, 0112 and 1403); the server checks them again.
 */
final class AttendanceLogic {

    static final int MAX_SITES = 5;
    static final int JOURNAL_MAX = 30;
    static final String REQUEST_PREFIX = "dua:";

    // The values of com.google.android.gms.location.Geofence.GEOFENCE_TRANSITION_*
    static final int TRANSITION_ENTER = 1;
    static final int TRANSITION_EXIT = 2;
    static final int TRANSITION_DWELL = 4;

    /** A fresh location is tried this many times (a minute or more apart) before the phone reports what it has. */
    static final int MAX_ATTEMPTS = 5;
    /** Events waiting to be sent while there is no network; the oldest are dropped first (the server ignores anything over a day old). */
    static final int QUEUE_MAX = 50;

    static final int SEND = 0;
    static final int RETRY = 1;
    static final int CANCEL = 2;

    private AttendanceLogic() {}

    /** The phone may only send its secret to our own Edge Function. */
    static boolean validEndpoint(String endpoint) {
        return endpoint != null && endpoint.matches("https://[a-z0-9-]+\\.supabase\\.co/functions/v1/attendance-event");
    }

    static boolean validSecret(String secret) {
        return secret != null && secret.matches("[0-9a-f]{64}");
    }

    static boolean validDeviceId(String id) {
        return id != null && id.matches("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");
    }

    /** Straight-line distance in metres (haversine); the server measures it again with its own function. */
    static double distanceMetres(double lat1, double lng1, double lat2, double lng2) {
        final double r = 6371000.0;
        double p1 = Math.toRadians(lat1);
        double p2 = Math.toRadians(lat2);
        double dp = Math.toRadians(lat2 - lat1);
        double dl = Math.toRadians(lng2 - lng1);
        double a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
        return 2 * r * Math.asin(Math.min(1.0, Math.sqrt(a)));
    }

    /**
     * What to do with a fresh location fix once the stability period has passed.
     *  "in":  the geofence already waited for the stay. Send when the fix is inside and good enough.
     *  "out": the geofence fires the moment the person leaves; after the stability period the person must still be outside,
     *         otherwise it was a flicker at the edge (or they came back) and nothing is sent.
     * A fix that is too weak to decide is tried again; on the last attempt an "in" or "out" that still looks right is sent anyway so the
     * server records the refusal and the owner can see it (weak signal), and a doubtful "out" that looks inside is dropped.
     */
    static int decide(String kind, double distance, double accuracy, int radius, int maxAccuracy, boolean lastAttempt) {
        boolean good = accuracy <= maxAccuracy;
        boolean inside = distance <= radius;
        if ("in".equals(kind)) {
            if (inside && good) return SEND;
            return lastAttempt ? SEND : RETRY;
        }
        if (!inside) {
            if (good) return SEND;
            return lastAttempt ? SEND : RETRY;
        }
        if (good) return CANCEL;
        return lastAttempt ? CANCEL : RETRY;
    }

    /** What an answer from the server means for the journal and the queue. */
    static String journalType(String status) {
        if ("accepted".equals(status)) return "recorded";
        if ("rejected".equals(status)) return "refused";
        if ("ignored".equals(status)) return "ignored";
        if ("off".equals(status)) return "off";
        return "unknown";
    }

    /** How long to wait before looking at the place again, in seconds: the stability period for a departure, nothing for an arrival. */
    static long confirmDelaySeconds(String kind, int stableSeconds) {
        return "out".equals(kind) ? stableSeconds : 0;
    }

    static boolean validKind(String kind) {
        return "in".equals(kind) || "out".equals(kind);
    }

    /** null when the place is usable, otherwise why not. */
    static String validateSite(String id, double lat, double lng, int radius) {
        if (id == null || id.length() < 8 || id.length() > 64 || !id.matches("[0-9a-fA-F-]+")) return "bad place id";
        if (Double.isNaN(lat) || Double.isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return "bad coordinates";
        if (radius < 20 || radius > 2000) return "distance must be 20 to 2000 metres";
        return null;
    }

    static String validateStable(int seconds) {
        return seconds < 30 || seconds > 600 ? "stability period must be 30 to 600 seconds" : null;
    }

    /** What the receiver writes in the journal. We register DWELL (stayed inside for the stability period) and EXIT. */
    static String transitionName(int type) {
        switch (type) {
            case TRANSITION_ENTER:
                return "enter";
            case TRANSITION_EXIT:
                return "exit";
            case TRANSITION_DWELL:
                return "dwell";
            default:
                return null;
        }
    }

    static String requestId(String siteId) {
        return REQUEST_PREFIX + siteId;
    }

    /** The place id inside a geofence request id, or null when it is not one of ours. */
    static String siteIdOf(String requestId) {
        if (requestId == null || !requestId.startsWith(REQUEST_PREFIX) || requestId.length() == REQUEST_PREFIX.length()) return null;
        return requestId.substring(REQUEST_PREFIX.length());
    }

    /**
     * The first thing that stops automatic attendance from working, or null when nothing does.
     * The order is the order the person should fix them in.
     */
    static String problem(boolean preciseLocation, boolean backgroundLocation, boolean locationOn, boolean backgroundRestricted) {
        if (!preciseLocation) return "no_precise_location";
        if (!locationOn) return "location_off";
        if (!backgroundLocation) return "no_background_location";
        if (backgroundRestricted) return "background_restricted";
        return null;
    }
}
