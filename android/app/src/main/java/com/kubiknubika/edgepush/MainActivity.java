package com.kubiknubika.edgepush;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.annotation.RequiresApi;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;

/**
 * Минимальная нативная обёртка вокруг одного index.html.
 *
 * Ассеты лежат в app/src/main/assets/www/ и отдаются через WebViewAssetLoader
 * по адресу https://appassets.androidplatform.net/assets/www/... — это даёт
 * настоящий secure origin (localStorage, Same-Origin) без file:// и без INTERNET.
 * ?native=1 отключает регистрацию service worker: офлайн уже обеспечивает APK.
 */
public class MainActivity extends Activity {

    private static final String TAG = "EdgePush";
    private static final String HOST = WebViewAssetLoader.DEFAULT_DOMAIN;
    private static final String PREFIX = "/assets/";
    private static final String START_URL =
            "https://" + HOST + "/assets/www/index.html?native=1";

    private WebView web;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);

        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler(PREFIX, new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web = new WebView(this);
        setContentView(web);
        web.setBackgroundColor(0xFF070910);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setHorizontalScrollBarEnabled(false);
        web.setVerticalScrollBarEnabled(false);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        web.requestFocus();

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);              // автосохранение партии
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        s.setGeolocationEnabled(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        s.setSaveFormData(false);

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        web.setWebViewClient(new LocalClient(loader));
        web.loadUrl(START_URL);
    }

    private static final class LocalClient extends WebViewClientCompat {
        private final WebViewAssetLoader loader;

        LocalClient(WebViewAssetLoader loader) {
            this.loader = loader;
        }

        @Override
        @RequiresApi(21)
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            return loader.shouldInterceptRequest(request.getUrl());
        }

        @Override
        @SuppressWarnings("deprecation")
        public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
            return loader.shouldInterceptRequest(Uri.parse(url));
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return !isLocal(request.getUrl());
        }

        @Override
        @SuppressWarnings("deprecation")
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return !isLocal(Uri.parse(url));
        }

        private static boolean isLocal(Uri u) {
            boolean ok = "https".equals(u.getScheme())
                    && HOST.equals(u.getHost())
                    && u.getPath() != null
                    && u.getPath().startsWith(PREFIX);
            if (!ok) Log.w(TAG, "Заблокирован внешний переход: " + u);
            return ok;
        }

        @Override
        @SuppressWarnings("deprecation")
        public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
            Log.e(TAG, "WebView error " + errorCode + ": " + description + " @ " + failingUrl);
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && web != null && web.canGoBack()) {
            web.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onPause() {
        if (web != null) web.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }
}
