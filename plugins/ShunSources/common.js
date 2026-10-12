// 本插件包中各源共用的辅助方法
var Shun = (function () {
  var AUDIO_EXTS = ['.m4a', '.mp3', '.m4b', '.flac', '.aa3', '.ogg', '.wma', '.wav', '.aac', '.ac3', '.mp4'];

  // “不存在的元素”：数组越界时返回它，后面可以继续 .text() / .absUrl()
  var none = {
    exists: function () { return false; },
    text: function () { return ''; },
    ownText: function () { return ''; },
    attr: function () { return ''; },
    absUrl: function () { return ''; },
    first: function () { return none; },
    select: function () { return []; }
  };

  return {
    none: none,
    enc: function (s) { return encodeURIComponent(s); },

    /** 数组的第 n 个元素，越界返回“不存在的元素” */
    nth: function (list, n) { return list && n < list.length ? list[n] : none; },

    /** 在 selector 选中的元素中找文字包含 text 的第一个 */
    findByText: function (node, selector, text) {
      if (!node || !node.exists()) return none;
      var list = node.select(selector);
      for (var i = 0; i < list.length; i++) if (list[i].text().indexOf(text) >= 0) return list[i];
      return none;
    },

    /** 去掉“作者：”“播音：”这类标签前缀 */
    stripLabel: function (text) {
      return (text || '').replace(/^\s*[一-龥A-Za-z]{1,4}\s*[：:]\s*/, '').trim();
    },

    /** 还原脚本字符串里的转义（\/、\uXXXX） */
    unescape: function (s) {
      try { return JSON.parse('"' + s.replace(/"/g, '\\"') + '"'); }
      catch (e) { return s.replace(/\\\//g, '/'); }
    },

    /** 地址中包含常见音频扩展名 */
    containsAudioExt: function (url) {
      var u = url.toLowerCase();
      return AUDIO_EXTS.some(function (e) { return u.indexOf(e) >= 0; });
    },

    /**
     * 请求这类开了 Cloudflare“人机验证”的网站时用的选项。
     * 验证通过后留下的 Cookie 是和当时的 UA 绑在一起的，所以验证和之后的请求必须用同一个 UA；
     * 而且得是 WebView 自带的真实 UA——设置里那两个是冒充别的浏览器的，验证时会被识破。
     * 旧版宿主拿不到真实 UA，就退回用手机版 UA 碰运气。
     */
    cfOptions: function (host, headers) {
      var ua = typeof host.webViewUA === 'function' ? host.webViewUA() : '';
      var o = { desktop: false, headers: headers || {} };
      if (ua) o.headers['User-Agent'] = ua;
      return o;
    },

    /**
     * 取一个页面的 HTML，能应付 Cloudflare 的“人机验证”（普通请求会收到 403 和一个 “Just a moment...” 页面）。
     * 真正的浏览器会自动通过这个验证，所以收到 403 时用内置的 WebView 把页面打开一次：验证通过后它会留下一个 Cookie，
     * 普通请求带着这个 Cookie 和同一个 UA，之后就能正常访问了。
     */
    cfPage: function (host, url) {
      try {
        return host.getString(url, Shun.cfOptions(host));
      } catch (e) {
        if (e.status !== 403 && e.status !== 503) throw e;
      }
      var html = Shun.cfPass(host, url);
      // 验证通过后普通请求一般就能用了；万一还是不行，就用 WebView 里拿到的这份
      try { return host.getString(url, Shun.cfOptions(host)); } catch (e) { if (e.cancelled) throw e; return html; }
    },

    /** 用 WebView 打开页面，等人机验证自己通过，返回通过后的页面 HTML */
    cfPass: function (host, url) {
      try {
        return host.render(url, {
          desktop: false, nativeUA: true, timeout: 40000,
          // 验证页的标题是 “Just a moment...”；正常页面里也会带 Cloudflare 的脚本，所以不能拿脚本地址来判断
          parse: function (html) { return html.length > 3000 && html.indexOf('Just a moment') < 0 ? html : ''; }
        });
      } catch (e) {
        if (e.cancelled) throw e;
        host.log('人机验证没有自动通过：' + e.message);
        throw new Error('网站开启了人机验证，这次没能自动通过，请稍后重试');
      }
    },

    /** 播放前确认音频服务器放行；被人机验证拦住（403）时先去网站首页过一次验证。返回音频地址和要带的请求头 */
    cfAudio: function (host, audioUrl, site) {
      var o = Shun.cfOptions(host, { Referer: site, Range: 'bytes=0-1' });
      var status = 0;
      try { status = host.status(audioUrl, o); } catch (e) { if (e.cancelled) throw e; }
      if (status === 403 || status === 503) Shun.cfPass(host, site);
      return { url: audioUrl, headers: Shun.cfOptions(host, { Referer: site }).headers };
    },

    getDoc: function (host, url, desktop, referer, encoding) {
      var o = { desktop: !!desktop };
      if (referer) o.headers = { Referer: referer };
      if (encoding) o.encoding = encoding;
      return host.getHtml(url, o);
    },

    /** 封面地址包含 domain 时加上 Referer（防盗链） */
    coverReferer: function (domain, referer) {
      return function (coverUrl) { return coverUrl.indexOf(domain) >= 0 ? { Referer: referer } : null; };
    },

    hostOf: function (url) { return url.replace(/^https?:\/\//, '').split('/')[0]; },

    /** 这类站点的播放页里用 var now="音频地址" 保存当前音频；取不到时回退为 WebView 嗅探 */
    varNowAudio: function (host, url, desktop) {
      var html = host.getString(url, { desktop: desktop });
      var m = /var\s+now\s*=\s*["']([^"']+)["']/.exec(html);
      var audio = m ? Shun.unescape(m[1]) : '';
      if (audio.indexOf('http') === 0) return audio;
      return host.sniff(url, { desktop: desktop, validate: Shun.containsAudioExt });
    },

    /** APlayer 脚本里的音频列表：name: "..", artist: "..", url: ".." */
    aplayerItems: function (html) {
      var re = /name:\s*"((?:[^"\\]|\\.)*)"\s*,\s*artist:\s*"((?:[^"\\]|\\.)*)"\s*,\s*url:\s*"([^"]+)"/g;
      var list = [], m;
      while ((m = re.exec(html)) !== null) {
        var url = Shun.unescape(m[3]);
        if (url.indexOf('//') === 0) url = 'https:' + url;
        list.push({ title: Shun.unescape(m[1]), artist: Shun.unescape(m[2]), url: url });
      }
      return list;
    }
  };
})();

/**
 * “优先用纯音频流”这个默认打开的开关，现在算开还是关。
 * 用户自己设过的按设的来；没设过的默认开——只有旧版的 iOS / Mac 程序例外：纯音频流的地址里没有能认出格式的扩展名，
 * 旧版程序下载后打不开，所以在它们上面默认关（在线听不受影响，想开可以手动开）。
 * strict：这个源的纯音频流旧版 iOS / Mac 程序连在线都放不了（B 站的 .m4s），在它们上面不管怎么设都当成关。
 */
Shun.audioOnly = function (host, strict) {
  var value = String(host.getPref('audioOnly', '') || '');
  if (value === 'false' || value === '0') return false;
  if (host.playsAnyDownload) return true;
  // 旧版程序没有上面那个标记：安卓版的脚本引擎（Rhino）不认识 class，苹果版的认识
  var oldApple;
  try { new Function('class A {}'); oldApple = true; } catch (e) { oldApple = false; }
  if (!oldApple) return true;
  return !strict && value === 'true';
};
