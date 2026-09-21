package ru.legion.scoreboard;

import android.app.*;
import android.os.Bundle;
import android.content.*;
import android.net.Uri;
import android.view.*;
import android.webkit.*;
import android.widget.*;

/** Small admin client. Match synchronization is independent of this Activity. */
public class MainActivity extends Activity {
  private static final String HOST="scoreboard-eight-lime.vercel.app";
  private WebView web;
  private ValueCallback<Uri[]> files;
  @Override public void onCreate(Bundle saved) {
    super.onCreate(saved);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    LinearLayout root=new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL);
    root.setOnApplyWindowInsetsListener((v,insets)-> {v.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());return insets;});
    root.setBackgroundColor(android.graphics.Color.rgb(17,27,25));
    getWindow().setStatusBarColor(android.graphics.Color.rgb(17,27,25));
    getWindow().setNavigationBarColor(android.graphics.Color.rgb(17,27,25));
    web=new WebView(this);root.addView(web,new LinearLayout.LayoutParams(-1,0,1));setContentView(root);
    web.getSettings().setJavaScriptEnabled(true);
    web.setBackgroundColor(android.graphics.Color.rgb(17,27,25));
    web.getSettings().setUserAgentString(web.getSettings().getUserAgentString()+" LegionAdmin/1.2");
    web.getSettings().setDomStorageEnabled(true);
    web.getSettings().setAllowFileAccess(false);
    web.getSettings().setAllowContentAccess(false);
    web.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    CookieManager.getInstance().setAcceptCookie(true);
    web.setWebViewClient(new WebViewClient(){
      @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
        Uri uri=request.getUrl();
        if(request.isForMainFrame() && "https".equals(uri.getScheme()) && HOST.equals(uri.getHost()) && "/native-reconnect".equals(uri.getPath())) {view.loadUrl(BuildConfig.ADMIN_URL);return true;}
        return !"https".equals(uri.getScheme()) || !HOST.equals(uri.getHost());
      }
      @Override public void onPageFinished(WebView view,String url){CookieManager.getInstance().flush();}
    });
    web.setWebChromeClient(new WebChromeClient(){
      @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){
        if(files!=null) files.onReceiveValue(null);files=callback;
        Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);intent.setType("*/*");intent.addCategory(Intent.CATEGORY_OPENABLE);
        try{startActivityForResult(intent,11);}catch(ActivityNotFoundException e){files.onReceiveValue(null);files=null;}
        return true;
      }
    });
    if(saved==null) web.loadUrl(BuildConfig.ADMIN_URL);else if(web.restoreState(saved)==null) web.loadUrl(BuildConfig.ADMIN_URL);
  }
  @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==11&&files!=null){files.onReceiveValue(result==RESULT_OK&&data!=null&&data.getData()!=null?new Uri[]{data.getData()}:null);files=null;}}
  @Override public void onBackPressed(){new AlertDialog.Builder(this).setTitle("Закрыть админку?").setMessage("Оверлей продолжит работу. Ручные команды будут доступны после возвращения.").setNegativeButton("Остаться",null).setPositiveButton("Закрыть",(d,w)->finish()).show();}
  @Override protected void onSaveInstanceState(Bundle out){super.onSaveInstanceState(out);web.saveState(out);}
  @Override protected void onDestroy(){if(files!=null)files.onReceiveValue(null);web.destroy();super.onDestroy();}
}
