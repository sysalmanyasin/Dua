package com.duapharma.dua;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONException;
import org.json.JSONObject;

/** Fetches today's total from the widget-today Edge Function with this install's secret, stores it, and redraws the widget. */
public class TodayWidgetWorker extends Worker {

    public TodayWidgetWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        WidgetStore store = new WidgetStore(context);
        if (!store.isConfigured()) {
            TodayWidgetProvider.updateAll(context);
            return Result.success();
        }
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(store.endpoint()).openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(10000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            JSONObject request = new JSONObject();
            request.put("device_id", store.deviceId());
            request.put("secret", store.secret());
            try (OutputStream out = connection.getOutputStream()) {
                out.write(request.toString().getBytes(StandardCharsets.UTF_8));
            }
            int code = connection.getResponseCode();
            if (code == 200) {
                JSONObject body = new JSONObject(read(connection.getInputStream()));
                String day = body.optString("sale_day", "");
                if (body.isNull("total")) {
                    store.saveNoFigure(day);
                } else {
                    JSONObject split = body.optJSONObject("breakdown");
                    store.saveResult(body.getDouble("total"), day, body.optString("as_of", ""), split == null ? null : split.toString());
                }
            } else if (code == 401) {
                store.markSignedOut();
            } else {
                store.markOffline();
                TodayWidgetProvider.updateAll(context);
                return Result.retry();
            }
        } catch (IOException | JSONException e) {
            store.markOffline();
            TodayWidgetProvider.updateAll(context);
            return Result.retry();
        } finally {
            if (connection != null) connection.disconnect();
        }
        TodayWidgetProvider.updateAll(context);
        return Result.success();
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
