package com.duapharma.dua;

/**
 * Decisions for automatic attendance that need no Android, so they are unit-tested on any computer (AttendanceLogicTest).
 * The ranges are the database's own (migrations 0110 and 0112); the server checks them again.
 */
final class AttendanceLogic {

    static final int MAX_SITES = 5;
    static final int JOURNAL_MAX = 30;
    static final String REQUEST_PREFIX = "dua:";

    // The values of com.google.android.gms.location.Geofence.GEOFENCE_TRANSITION_*
    static final int TRANSITION_ENTER = 1;
    static final int TRANSITION_EXIT = 2;
    static final int TRANSITION_DWELL = 4;

    private AttendanceLogic() {}

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
