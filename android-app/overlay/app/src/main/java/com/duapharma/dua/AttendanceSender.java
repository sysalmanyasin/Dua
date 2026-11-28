package com.duapharma.dua;

import android.content.Context;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Sends the events waiting in the queue to the Edge Function attendance-event, oldest first, one at a time.
 * The server decides; the phone only reports. An event stays in the queue until the server has answered it, so a phone without network
 * (or a server that is briefly down) loses nothing, and the same event id sent twice is answered, not recorded twice.
 * Runs on a background thread only (a Worker).
 */
final class AttendanceSender {

    private AttendanceSender() {}

    /** @return true when nothing is left to retry later (queue empty, or something that retrying cannot fix); false to try again later. */
    static boolean flush(Context context) {
        AttendanceStore store = new AttendanceStore(context);
        if (!store.enrolled() || !store.autoOn() || !store.hasKey()) return true; // the app sets this up the next time it is opened
        if (!AttendanceLogic.validEndpoint(store.endpoint())) return true;
        for (int sent = 0; sent < AttendanceLogic.QUEUE_MAX; sent++) {
            JSONObject event = store.queueHead();
            if (event == null) return true;
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(store.endpoint()).openConnection();
                connection.setRequestMethod("POST");
                connection.setConnectTimeout(10000);
                connection.setReadTimeout(15000);
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json");
                JSONObject request = new JSONObject(event.toString());
                request.put("device_id", store.deviceId());
                request.put("secret", store.secret());
                try (OutputStream out = connection.getOutputStream()) {
                    out.write(request.toString().getBytes(StandardCharsets.UTF_8));
                }
                int code = connection.getResponseCode();
                String kind = event.optString("kind");
                long at = event.optLong("at");
                if (code == 200) {
                    JSONObject answer = new JSONObject(read(connection.getInputStream()));
                    String status = answer.optString("status");
                    String reason = answer.isNull("reason") ? null : answer.optString("reason", null);
                    store.addJournalResult(AttendanceLogic.journalType(status), kind, reason, at);
                    store.queueRemoveHead();
                } else if (code == 400) {
                    // the server will never accept this event: do not send it again
                    store.addJournalResult("dropped", kind, "bad_event", at);
                    store.queueRemoveHead();
                } else if (code == 401) {
                    // wrong device or secret, or this person may no longer check in: stop; the app asks for a new secret when it is opened
                    store.clearKey();
                    store.addJournalResult("key_rejected", kind, null, at);
                    return true;
                } else {
                    return false;
                }
            } catch (IOException | JSONException e) {
                return false;
            } finally {
                if (connection != null) connection.disconnect();
            }
        }
        return false; // more is waiting: come back soon
    }

    /**
     * Tells the server how this phone's tracking is doing: which problem it found (none when all is well) and how many events are still
     * waiting. No location is sent. Called every 15 minutes by the watchdog, so the owner hears about a switched-off location or a
     * restricted app within minutes, and a phone that stops reporting altogether is noticed by the server.
     * @return true when the server answered (or nothing can be sent); false when it should be tried again at the next run.
     */
    static boolean reportHealth(Context context) {
        AttendanceStore store = new AttendanceStore(context);
        if (!store.enrolled() || !store.autoOn() || !store.hasKey()) return true;
        String endpoint = AttendanceLogic.healthEndpoint(store.endpoint());
        if (endpoint == null) return true;
        HttpURLConnection connection = null;
        try {
            String state = AttendanceLogic.healthState(AttendanceGeofence.problem(context), store.sites().length() > 0, store.registered());
            JSONObject request = new JSONObject();
            request.put("device_id", store.deviceId());
            request.put("secret", store.secret());
            request.put("state", state == null ? JSONObject.NULL : state);
            request.put("pending", store.queueSize());
            connection = (HttpURLConnection) new URL(endpoint).openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(15000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            try (OutputStream out = connection.getOutputStream()) {
                out.write(request.toString().getBytes(StandardCharsets.UTF_8));
            }
            int code = connection.getResponseCode();
            if (code == 401) {
                // wrong device or secret, or this person may no longer check in: the app asks for a new secret when it is opened
                store.clearKey();
                return true;
            }
            return code == 200 || code == 400;
        } catch (IOException | JSONException e) {
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static String read(InputStream in) throws IOException {
        try (InputStream stream = in; ByteArrayOutputStream buffer = new ByteArrayOutputStream()) {
            byte[] chunk = new byte[2048];
            int n;
            while ((n = stream.read(chunk)) > 0 && buffer.size() < 16384) buffer.write(chunk, 0, n);
            return buffer.toString("UTF-8");
        }
    }
}
