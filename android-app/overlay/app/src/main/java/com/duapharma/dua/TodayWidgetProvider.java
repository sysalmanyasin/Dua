package com.duapharma.dua;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;
import java.text.NumberFormat;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import org.json.JSONObject;

/**
 * The Today's Sale home-screen widget. It only DRAWS what the worker stored; all rules (who may see it, owner vs staff detail) are
 * decided by the server. Tap the figure to refresh, tap the title to open Dua.
 */
public class TodayWidgetProvider extends AppWidgetProvider {

    static final String ACTION_REFRESH = "com.duapharma.dua.WIDGET_REFRESH";
    private static final TimeZone PAKISTAN = TimeZone.getTimeZone("Asia/Karachi");

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) manager.updateAppWidget(id, build(context));
        WidgetScheduler.ensure(context);
        WidgetScheduler.refreshNow(context);
    }

    @Override
    public void onEnabled(Context context) {
        WidgetScheduler.ensure(context);
    }

    @Override
    public void onDisabled(Context context) {
        WidgetScheduler.cancel(context);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (intent != null && ACTION_REFRESH.equals(intent.getAction())) WidgetScheduler.refreshNow(context);
    }

    static void updateAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, TodayWidgetProvider.class));
        RemoteViews views = build(context);
        for (int id : ids) manager.updateAppWidget(id, views);
    }

    static RemoteViews build(Context context) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_today);
        WidgetStore store = new WidgetStore(context);
        String value;
        String line1;
        String line2 = "";

        if (!store.isConfigured()) {
            value = "—";
            line1 = context.getString(R.string.widget_sign_in);
        } else if (store.total() == null || !today().equals(store.saleDay())) {
            value = "—";
            line1 = context.getString(R.string.widget_no_figure);
        } else {
            value = "₨ " + NumberFormat.getIntegerInstance(Locale.US).format(Math.round(Double.parseDouble(store.total())));
            String time = clock(store.asOf());
            line1 = WidgetStore.OFFLINE.equals(store.status())
                ? context.getString(R.string.widget_offline, time)
                : context.getString(R.string.widget_updated, time);
            line2 = split(store.breakdown());
        }

        views.setTextViewText(R.id.widget_value, value);
        views.setTextViewText(R.id.widget_line1, line1);
        views.setTextViewText(R.id.widget_line2, line2);

        Intent refresh = new Intent(context, TodayWidgetProvider.class).setAction(ACTION_REFRESH);
        views.setOnClickPendingIntent(R.id.widget_value, PendingIntent.getBroadcast(context, 0, refresh, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        Intent open = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (open != null) {
            views.setOnClickPendingIntent(R.id.widget_title, PendingIntent.getActivity(context, 1, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        }
        return views;
    }

    private static String today() {
        SimpleDateFormat day = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
        day.setTimeZone(PAKISTAN);
        return day.format(new Date());
    }

    /** "2026-11-25T04:07:12.345+00:00" -> "09:07" (Pakistan time). Works on API 24 without java.time. */
    private static String clock(String iso) {
        if (iso == null || iso.length() < 19) return "";
        try {
            SimpleDateFormat in = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.US);
            Date at = in.parse(iso.replaceAll("\\.\\d+", "").replace("Z", "+00:00"));
            SimpleDateFormat out = new SimpleDateFormat("HH:mm", Locale.US);
            out.setTimeZone(PAKISTAN);
            return out.format(at);
        } catch (ParseException e) {
            return "";
        }
    }

    /** Owner only (the server sends the split to nobody else): "Cash 1,000 · Card 500 · Credit 250". */
    private static String split(String json) {
        if (json == null) return "";
        try {
            JSONObject o = new JSONObject(json);
            NumberFormat n = NumberFormat.getIntegerInstance(Locale.US);
            return "Cash " + n.format(Math.round(o.optDouble("cash"))) + " · Card " + n.format(Math.round(o.optDouble("card"))) + " · Credit " + n.format(Math.round(o.optDouble("credit")));
        } catch (Exception e) {
            return "";
        }
    }
}
