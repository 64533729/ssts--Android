// ---------- 抖音：搜索视频和用户，播放作品的声音 ----------
// 接口和签名算法参照 https://github.com/cv-cat/DouYin_Spider（网页版 www.douyin.com）：
//   a_bogus                 对应 utils/ab_pure.py + utils/sm3.py
//   x-secsdk-web-signature  对应 utils/secsdk_web_sign.py
//   各接口的参数和顺序        对应 dy_apis/douyin_api.py
// 一本“书”有四种：一个用户（作品就是章节）、一个视频（只有一集）、“我的喜欢”、一个直播间。
(function () {
  var SITE = 'https://www.douyin.com';
  var NOT_LOGGED_IN = '还没有登录抖音：到“插件”页点开这个源，点“登录”';
  var LIVE_SITE = 'https://live.douyin.com';

  // ==================== SM3 ====================
  function rotl(x, n) {
    n &= 31;
    return n === 0 ? x >>> 0 : ((x << n) | (x >>> (32 - n))) >>> 0;
  }

  function utf8(s) {
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xD800 && c < 0xDC00 && i + 1 < s.length) c = 0x10000 + ((c - 0xD800) << 10) + (s.charCodeAt(++i) - 0xDC00);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }

  /** 输入、输出都是字节数组 */
  function sm3(bytes) {
    var msg = bytes.slice(), bits = bytes.length * 8, i, j;
    msg.push(0x80);
    while (msg.length % 64 !== 56) msg.push(0);
    var high = Math.floor(bits / 4294967296), low = bits >>> 0;
    msg.push((high >>> 24) & 255, (high >>> 16) & 255, (high >>> 8) & 255, high & 255,
      (low >>> 24) & 255, (low >>> 16) & 255, (low >>> 8) & 255, low & 255);

    var v = [0x7380166f, 0x4914b2b9, 0x172442d7, 0xda8a0600, 0xa96f30bc, 0x163138aa, 0xe38dee4d, 0xb0fb0e4e];
    var w = new Array(68), w1 = new Array(64);
    for (var off = 0; off < msg.length; off += 64) {
      for (i = 0; i < 16; i++) {
        w[i] = ((msg[off + i * 4] << 24) | (msg[off + i * 4 + 1] << 16) | (msg[off + i * 4 + 2] << 8) | msg[off + i * 4 + 3]) >>> 0;
      }
      for (j = 16; j < 68; j++) {
        var x = (w[j - 16] ^ w[j - 9] ^ rotl(w[j - 3], 15)) >>> 0;
        w[j] = (x ^ rotl(x, 15) ^ rotl(x, 23) ^ rotl(w[j - 13], 7) ^ w[j - 6]) >>> 0;
      }
      for (j = 0; j < 64; j++) w1[j] = (w[j] ^ w[j + 4]) >>> 0;

      var a = v[0], b = v[1], c = v[2], d = v[3], e = v[4], f = v[5], g = v[6], h = v[7];
      for (j = 0; j < 64; j++) {
        var a12 = rotl(a, 12);
        var ss1 = rotl((a12 + e + rotl(j < 16 ? 0x79CC4519 : 0x7A879D8A, j)) >>> 0, 7);
        var ss2 = (ss1 ^ a12) >>> 0;
        var ff = j < 16 ? (a ^ b ^ c) : ((a & b) | (a & c) | (b & c));
        var gg = j < 16 ? (e ^ f ^ g) : ((e & f) | (~e & g));
        var tt1 = ((ff >>> 0) + d + ss2 + w1[j]) >>> 0;
        var tt2 = ((gg >>> 0) + h + ss1 + w[j]) >>> 0;
        d = c; c = rotl(b, 9); b = a; a = tt1;
        h = g; g = rotl(f, 19); f = e;
        e = (tt2 ^ rotl(tt2, 9) ^ rotl(tt2, 17)) >>> 0;
      }
      v = [(a ^ v[0]) >>> 0, (b ^ v[1]) >>> 0, (c ^ v[2]) >>> 0, (d ^ v[3]) >>> 0,
        (e ^ v[4]) >>> 0, (f ^ v[5]) >>> 0, (g ^ v[6]) >>> 0, (h ^ v[7]) >>> 0];
    }
    var out = [];
    for (i = 0; i < 8; i++) out.push((v[i] >>> 24) & 255, (v[i] >>> 16) & 255, (v[i] >>> 8) & 255, v[i] & 255);
    return out;
  }

  // ==================== a_bogus ====================
  var SALT = 'dhzx';
  var ALPHABET_S3 = 'ckdp1h4ZKsUB80/Mfvw36XIgR25+WQAlEi7NLboqYTOPuzmFjJnryx9HVGDaStCe';
  var ALPHABET_S4 = 'Dkdpgh2ZmsQB80/MfvV36XI1R45-WUAlEixNLwoqYTOPuzKFjJnry79HbGcaStCe';
  var FORTNIGHT_EPOCH = 1721836800000;
  var SDK_VERSION = 1, AID = 6383;
  // 签名里有几个常量每个子域不一样
  var SITE_KEYS = {
    'https://www.douyin.com': { minor: 8, l40: 132, l41: 1, l42: 1, pageId: 11881 },
    'https://live.douyin.com': { minor: 12, l40: 0, l41: 0, l42: 0, pageId: 7571 }
  };
  var A98_PERM = [34, 44, 56, 61, 73, 29, 70, 45, 35, 49, 38, 66, 51, 68, 28, 48, 64, 47,
    30, 71, 26, 55, 31, 69, 59, 40, 62, 63, 27, 72, 41, 74, 57, 52, 42, 39,
    33, 67, 53, 43, 65, 46, 36, 24, 60, 32, 79, 80, 84, 85];
  var CHECK_SLOTS = [24, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 38, 39, 40, 41, 42, 43,
    44, 45, 46, 47, 48, 49, 51, 52, 53, 55, 56, 57, 59, 60, 61, 62, 63, 64,
    65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 79, 80, 84, 85];
  var BROWSER_OFFSET = { Chrome: 0, Firefox: 40, Safari: 81, Edge: 125, Huawei: 170 };
  var signCounter = 2;

  function b64Custom(data, alphabet) {
    var out = '';
    for (var i = 0; i < data.length; i += 3) {
      var n = Math.min(3, data.length - i);
      var v = (data[i] << 16) | ((n > 1 ? data[i + 1] : 0) << 8) | (n > 2 ? data[i + 2] : 0);
      out += alphabet.charAt((v >> 18) & 63) + alphabet.charAt((v >> 12) & 63) +
        (n > 1 ? alphabet.charAt((v >> 6) & 63) : '=') + (n > 2 ? alphabet.charAt(v & 63) : '=');
    }
    return out;
  }

  function rc4Variant(key, data) {
    var sbox = [], i, j = 0, t;
    for (i = 0; i < 256; i++) sbox.push(255 - i);
    for (i = 0; i < 256; i++) {
      j = (j * sbox[i] + j + key[i % key.length]) % 256;
      t = sbox[i]; sbox[i] = sbox[j]; sbox[j] = t;
    }
    var out = [];
    i = 0; j = 0;
    for (var k = 0; k < data.length; k++) {
      i = (i + 1) % 256;
      j = (j + sbox[i]) % 256;
      t = sbox[i]; sbox[i] = sbox[j]; sbox[j] = t;
      out.push(data[k] ^ sbox[(sbox[i] + sbox[j]) % 256]);
    }
    return out;
  }

  function strToBytes(s) {
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c & 65280) out.push(c >> 8, c & 255);
      else out.push(c);
    }
    return out;
  }

  /** 小端字节。时间戳超过 32 位，不能用移位 */
  function leBytes(value, count) {
    var out = [];
    for (var i = 0; i < count; i++) {
      out.push(value % 256);
      value = Math.floor(value / 256);
    }
    return out;
  }

  function blend(c0, c1, r0, r1) {
    return [(r0 & 170) | (c0 & 85), (r0 & 85) | (c0 & 170), (r1 & 170) | (c1 & 85), (r1 & 85) | (c1 & 170)];
  }

  function expand(arr) {
    var out = [], n = arr.length;
    for (var i = 0; i < n; i += 3) {
      if (i + 2 < n) {
        var r = Math.floor(Math.random() * 1000) & 255;
        out.push((r & 145) | (arr[i] & 110), (r & 66) | (arr[i + 1] & 189), (r & 44) | (arr[i + 2] & 211),
          (arr[i] & 145) | (arr[i + 1] & 66) | (arr[i + 2] & 44));
      } else {
        out.push(arr[i]);
        if (i + 1 < n && arr[i + 1]) out.push(arr[i + 1]);
      }
    }
    return out;
  }

  function escapeDigest(digest, idx, reserved, fallback, force) {
    var v = idx < digest.length ? digest[idx] : fallback;
    while (v === reserved) {
      idx++;
      v = idx < digest.length ? digest[idx] : fallback;
    }
    return force ? reserved : v;
  }

  function browserName(ua) {
    if (/\bhuawei\b/i.test(ua)) return 'Huawei';
    if (/(chrome)\/([\w.]+)(?!.*chromium)/i.test(ua)) return 'Chrome';
    if (/(edg|edge)\/([\w.]+)/i.test(ua)) return 'Edge';
    if (/\bfocus\/([\w.]+)/i.test(ua) || /fxios\/([-\w.]+)/i.test(ua) || /(firefox)\/([\w.]+)/i.test(ua)) return 'Firefox';
    if (/(msie |trident.*rv:)([\w.]+)/i.test(ua)) return 'IE';
    if (/(opera|opr)\/([\w.]+)/i.test(ua)) return 'Opera';
    if (/(safari)\/([\w.]+)(?!.*chrome)/i.test(ua)) return 'Safari';
    return 'Other';
  }

  /** query、body 都是拼好的字符串；geo 是 "宽|高|...|平台" */
  function aBogus(query, body, ua, geo, keys) {
    var L = {}, i, r;
    signCounter++;
    var t = new Date().getTime();
    var name = browserName(ua);
    var h1 = sm3(sm3(utf8(query + SALT)));
    var h2 = sm3(sm3(utf8(body + SALT)));
    var uaChars = [], trimmed = ua.replace(/^\s+|\s+$/g, '');
    for (i = 0; i < trimmed.length; i++) uaChars.push(trimmed.charCodeAt(i));
    var uaKey = [Math.floor(SDK_VERSION / 256), SDK_VERSION % 256, keys.minor % 256];
    var hUa = sm3(utf8(b64Custom(rc4Variant(uaKey, uaChars), ALPHABET_S3)));
    var flags = 1 | (name === 'Firefox' ? 32 : 0);

    function put(start, bytes) { for (var k = 0; k < bytes.length; k++) L[start + k] = bytes[k]; }

    L[24] = 41;
    L[26] = Math.floor((t - FORTNIGHT_EPOCH) / 1000 / 60 / 60 / 24 / 14);
    L[27] = signCounter > 10745 ? 3 : signCounter > 1283 ? 4 : signCounter > 139 ? 5 : 6;
    L[28] = 3;
    put(29, leBytes(t, 6));
    put(35, leBytes(SDK_VERSION, 2));
    put(38, leBytes(flags, 2));
    L[40] = keys.l40; L[41] = keys.l41; L[42] = keys.l42; L[43] = 0;
    put(44, leBytes(keys.minor, 4));
    L[48] = h1[9]; L[49] = h1[18];
    L[51] = escapeDigest(h1, 3, 11, 12, !!(flags & 2));
    L[52] = h2[10]; L[53] = h2[19];
    L[55] = escapeDigest(h2, 4, 8, 9, !!(flags & 4));
    L[56] = hUa[11]; L[57] = hUa[21];
    L[59] = escapeDigest(hUa, 5, 12, 13, !!(flags & 8));
    put(60, leBytes(t - 1, 6));
    L[66] = 3;
    put(67, leBytes(keys.pageId, 4));
    put(71, leBytes(AID, 4));
    var geoBytes = strToBytes(geo);
    put(79, leBytes(geoBytes.length, 2));
    var tailBytes = strToBytes(String((t + 3) & 255) + ',');
    put(84, leBytes(tailBytes.length, 2));

    var v6 = Math.floor(Math.random() * 65535);
    var a8 = blend(1, 0, v6 & 255, (v6 >> 8) & 255);
    Math.random();
    var check;
    if (flags & 64) {
      r = Math.floor(Math.random() * 109);
      check = r + 110 + (r % 2);
    } else {
      r = Math.floor(Math.random() * 240);
      check = r > 109 ? r + (r % 2) + 1 : r;
    }
    var perms = (Math.floor(Math.random() * 255) & 77) | 2 | 16 | 32 | 128;
    a8 = a8.concat(blend(1, 0, check, perms));

    var chk = 0;
    for (i = 0; i < a8.length; i++) chk ^= a8[i];
    for (i = 0; i < CHECK_SLOTS.length; i++) chk ^= L[CHECK_SLOTS[i]];
    var a98 = [];
    for (i = 0; i < A98_PERM.length; i++) a98.push(L[A98_PERM[i]]);
    a98 = a98.concat(geoBytes, tailBytes, [chk]);

    var hr0 = Math.floor(Math.random() * 65535) & 255;
    var offset = Math.floor(Math.random() * 40) + (BROWSER_OFFSET.hasOwnProperty(name) ? BROWSER_OFFSET[name] : 210);
    var head = blend(3, 82, hr0, offset);
    var cipher = rc4Variant([211], a8.concat(expand(a98)));
    for (i = 0; i < cipher.length; i++) cipher[i] &= 255;
    return b64Custom(head.concat(cipher), ALPHABET_S4);
  }

  // ==================== 请求 ====================
  var WEBSIGN_CONST = 'A96D855A08C0A9707F8BEF0D9A527E4E';
  var fakeWebid = '';

  /** 等价于 Python 的 quote(safe='')：比 encodeURIComponent 多编码 !'()* */
  function enc(s) {
    return encodeURIComponent(String(s)).replace(/[!'()*]/g, function (c) { return '%' + c.charCodeAt(0).toString(16).toUpperCase(); });
  }

  function randomString(chars, length) {
    var out = '';
    for (var i = 0; i < length; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
    return out;
  }

  function cookieMap(host) {
    var map = {};
    String(host.cookies(SITE + '/') || '').split(';').forEach(function (p) {
      var i = p.indexOf('=');
      if (i > 0) map[p.substring(0, i).replace(/^\s+|\s+$/g, '')] = p.substring(i + 1).replace(/^\s+|\s+$/g, '');
    });
    return map;
  }

  function loggedIn(cookie) { return !!(cookie.sessionid || cookie.sessionid_ss); }

  /** 接口里要上报的浏览器信息，必须和实际发出去的 UA 对得上，所以从设置里的电脑版 UA 里取 */
  function browser(host) {
    var ua = String(host.userAgent(true) || '');
    var mac = ua.indexOf('Macintosh') >= 0;
    var firefox = /Firefox\/([\d.]+)/.exec(ua), chrome = /Chrome\/([\d.]+)/.exec(ua), edge = /Edg\/([\d.]+)/.exec(ua);
    var version = firefox ? firefox[1] : chrome ? chrome[1] : '151.0.0.0';
    return {
      ua: ua,
      name: firefox ? 'Firefox' : edge ? 'Edge' : 'Chrome',
      version: edge ? edge[1] : version,
      engine: firefox ? 'Gecko' : 'Blink',
      engineVersion: version,
      chromeMajor: chrome && !edge ? chrome[1].split('.')[0] : '',
      os: mac ? 'Mac OS' : 'Windows',
      osVersion: mac ? '10.15.7' : '10',
      platform: mac ? 'MacIntel' : 'Win32',
      divert: mac ? 'Mac' : 'Windows'
    };
  }

  /** 设备号：页面 HTML 里有真实的，取不到就随机一个（本次运行内保持不变） */
  function webid(host) {
    var saved = String(host.getPref('webid', '') || '');
    if (saved) return saved;
    if (fakeWebid) return fakeWebid;
    try {
      var m = /\\?"user_unique_id\\?"\s*:\s*\\?"(\d+)/.exec(host.getString(SITE + '/discover', { desktop: true }));
      if (m) {
        host.setPref('webid', m[1]);
        return m[1];
      }
    } catch (e) {
      if (e.cancelled) throw e;
    }
    fakeWebid = '7' + randomString('0123456789', 18);
    return fakeWebid;
  }

  /** 有顺序的参数表：抖音会核对参数的顺序，所以各接口都照抓包的顺序排 */
  function Params() { this.list = []; }
  Params.prototype.add = function (key, value) {
    for (var i = 0; i < this.list.length; i++) {
      if (this.list[i][0] === key) {
        this.list[i][1] = String(value);
        return this;
      }
    }
    this.list.push([key, String(value)]);
    return this;
  };
  Params.prototype.base = function () {
    return this.add('device_platform', 'webapp').add('aid', '6383').add('channel', 'channel_pc_web');
  };
  /** 大多数接口共用的一组浏览器参数 */
  Params.prototype.platform = function (b, roundTrip, versionCode, versionName) {
    return this.add('update_version_code', '170400').add('pc_client_type', '1').add('pc_libra_divert', b.divert)
      .add('support_h265', '1').add('support_dash', '1').add('cpu_core_num', '8')
      .add('version_code', versionCode || '170400').add('version_name', versionName || '17.4.0')
      .add('cookie_enabled', 'true').add('screen_width', '1920').add('screen_height', '1080')
      .add('browser_language', 'zh-CN').add('browser_platform', b.platform).add('browser_name', b.name)
      .add('browser_version', b.version).add('browser_online', 'true').add('engine_name', b.engine)
      .add('engine_version', b.engineVersion).add('os_name', b.os).add('os_version', b.osVersion)
      .add('device_memory', '8').add('platform', 'PC').add('downlink', '10').add('effective_type', '4g')
      .add('round_trip_time', roundTrip);
  };
  Params.prototype.query = function (encode) {
    return this.list.map(function (p) { return p[0] + '=' + encode(p[1]); }).join('&');
  };

  /**
   * 调用一个接口，返回 JSON。
   * tail 是末尾几个参数的顺序（各接口不一样），例如 'webid,uifid,msToken,a_bogus,verifyFp'；
   * signed 表示这个接口还要带 timestamp 和 x-secsdk-web-signature；site 是接口所在的子域，默认主站；
   * postBody 不为空时用 POST 发（表单格式的字符串）。
   */
  function call(host, path, params, tail, referer, signed, site, postBody) {
    site = site || SITE;
    var cookie = cookieMap(host), b = browser(host);
    tail.split(',').forEach(function (name) {
      if (name === 'webid') params.add('webid', webid(host));
      else if (name === 'uifid') { if (cookie.UIFID) params.add('uifid', cookie.UIFID); }
      else if (name === 'verifyFp') { if (cookie.s_v_web_id) params.add('verifyFp', cookie.s_v_web_id).add('fp', cookie.s_v_web_id); }
      else if (name === 'msToken') {
        params.add('msToken', cookie.msToken || randomString('ABCDEFGHIGKLMNOPQRSTUVWXYZabcdefghigklmnopqrstuvwxyz0123456789=', 107));
      } else if (name === 'a_bogus') {
        params.add('a_bogus', aBogus(params.query(enc), postBody || '', b.ua, '1920|855|1920|1032|1920|1032|1920|1080|' + b.platform, SITE_KEYS[site]));
      }
    });

    var url;
    if (signed) {
      // 签名是对规范化后的 query 算的，发出去的必须是同一个字符串
      var query = params.query(encodeURIComponent);
      var uifid = cookie.UIFID || '', inQuery = params.list.filter(function (p) { return p[0] === 'uifid'; });
      if (inQuery.length > 0) uifid = inQuery[0][1];
      else if (uifid) query += '&uifid=' + encodeURIComponent(uifid);
      var ts = Math.floor(new Date().getTime() / 1000);
      query += '&timestamp=' + ts;
      url = site + path + '?' + query + '&x-secsdk-web-signature=' +
        String(host.md5(uifid + '_' + ts + '_' + WEBSIGN_CONST + '_' + query)).toLowerCase();
    } else {
      url = site + path + '?' + params.query(enc);
    }

    var headers = {
      'User-Agent': b.ua, 'Accept': 'application/json, text/plain, */*', 'Accept-Language': 'zh-CN,zh;q=0.9',
      'Referer': referer || SITE + '/', 'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-origin'
    };
    if (cookie.UIFID) headers.uifid = cookie.UIFID;
    if (b.chromeMajor) {
      headers['sec-ch-ua'] = '"Not=A?Brand";v="99", "Google Chrome";v="' + b.chromeMajor + '", "Chromium";v="' + b.chromeMajor + '"';
      headers['sec-ch-ua-mobile'] = '?0';
      headers['sec-ch-ua-platform'] = '"' + (b.os === 'Windows' ? 'Windows' : 'macOS') + '"';
    }

    var options = { desktop: true, headers: headers };
    if (postBody) {
      options.method = 'POST';
      options.body = postBody;
      options.contentType = 'application/x-www-form-urlencoded; charset=UTF-8';
      headers.Origin = site;
    }
    var response = host.fetch(url, options);
    var body = String(response.body || '').replace(/^\s+|\s+$/g, '');
    // 抖音拒绝请求时一般是 HTTP 200 加空内容，或者一个验证页
    if (body.charAt(0) !== '{') {
      host.log(path + ' 返回了非 JSON 内容（HTTP ' + response.status + '）：' + body.substring(0, 120));
      if (!loggedIn(cookie)) throw new Error(NOT_LOGGED_IN);
      if (!body) throw new Error('抖音没有返回内容（被风控拦截），请稍后再试，或者重新登录');
      throw new Error('抖音要求人机验证，请在插件页重新打开登录页完成验证后再试');
    }
    var json = parseJson(body);
    var code = int(json, 'status_code', 0);
    // 20003 是“没有登录”；别的错误在没登录时多半也是因为没登录
    if (code !== 0 && (code === 20003 || !loggedIn(cookie))) throw new Error(NOT_LOGGED_IN);
    if (code !== 0) throw new Error('抖音接口返回错误：' + (str(json, 'status_msg') || code));
    return json;
  }

  function more(json) { return json.has_more === 1 || json.has_more === true; }

  // ==================== 各个接口 ====================
  function userUrl(secUid) { return SITE + '/user/' + secUid; }
  function videoUrl(awemeId) { return SITE + '/video/' + awemeId; }
  function lastSegment(url) { return url.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop(); }

  /** 用户的作品，一页 18 个，从新到旧 */
  function userPosts(host, secUid, cursor) {
    var p = new Params().base()
      .add('sec_user_id', secUid).add('max_cursor', cursor).add('locate_query', 'false')
      .add('show_live_replay_strategy', '1').add('need_time_list', cursor === '0' ? '1' : '0').add('time_list_query', '0')
      .add('whale_cut_token', '').add('cut_version', '1').add('count', '18').add('publish_video_strategy_type', '2')
      .add('from_user_page', '1').platform(browser(host), '0', '290100', '29.1.0');
    return call(host, '/aweme/v1/web/aweme/post/', p, 'webid,uifid,msToken,a_bogus,verifyFp', userUrl(secUid), true);
  }

  /** 用户喜欢的作品 */
  function userLikes(host, secUid, cursor) {
    var p = new Params().base()
      .add('sec_user_id', secUid).add('max_cursor', cursor).add('min_cursor', '0').add('whale_cut_token', '')
      .add('cut_version', '1').add('count', '18').add('publish_video_strategy_type', '2').platform(browser(host), '0');
    return call(host, '/aweme/v1/web/aweme/favorite/', p, 'webid,uifid,verifyFp,a_bogus', userUrl(secUid) + '?showTab=like', true);
  }

  function awemeDetail(host, awemeId) {
    var p = new Params().base()
      .add('aweme_id', awemeId).add('request_source', '600').add('origin_type', 'video_page')
      .platform(browser(host), '50', '190500', '19.5.0');
    var json = call(host, '/aweme/v1/web/aweme/detail/', p, 'webid,uifid,verifyFp,msToken,a_bogus', videoUrl(awemeId), true);
    if (!json.aweme_detail) throw new Error(str(json, 'filter_detail.detail_msg') || '作品不存在，或者已被删除、设为私密');
    return json.aweme_detail;
  }

  /** 合集里的作品，一页 20 个，按第 1 集、第 2 集……的顺序。awemeId 是从哪个作品点进来的（当来源页用） */
  function mixAwemes(host, mixId, cursor, awemeId) {
    var p = new Params().base()
      .add('mix_id', mixId).add('cursor', cursor).add('count', '20')
      .platform(browser(host), '50', '190500', '19.5.0');
    return call(host, '/aweme/v1/web/mix/aweme/', p, 'webid,uifid,verifyFp,msToken,a_bogus', videoUrl(awemeId), true);
  }

  /** 一个合集的全部作品（loadFullPages 为 false 时只取第一页）。翻页用的是返回里的 cursor，和作品列表的 max_cursor 不一样 */
  function loadMix(host, mixId, awemeId, loadFullPages) {
    var json = mixAwemes(host, mixId, '0', awemeId), list = validAwemes(items(json, 'aweme_list'));
    if (!loadFullPages) return list;
    try {
      for (var page = 2; more(json) && page <= MAX_PAGES; page++) {
        var cursor = str(json, 'cursor');
        if (!cursor || cursor === '0') break;
        host.progress('第 ' + page + ' 页');
        host.sleep(400 + Math.random() * 600);
        try {
          json = mixAwemes(host, mixId, cursor, awemeId);
        } catch (e) {
          if (e.cancelled) throw e;
          host.toast('合集加载到第 ' + (page - 1) + ' 页时被抖音拦截，先显示已加载的部分');
          break;
        }
        var fresh = validAwemes(items(json, 'aweme_list'));
        if (fresh.length === 0) break;
        list = list.concat(fresh);
      }
    } finally {
      host.progress(null);
    }
    return list;
  }

  function userProfile(host, secUid) {
    var p = new Params().base()
      .add('publish_video_strategy_type', '2').add('source', 'channel_pc_web').add('sec_user_id', secUid)
      .add('personal_center_strategy', '1').add('profile_other_record_enable', '1').add('land_to', '1')
      .platform(browser(host), '0');
    return call(host, '/aweme/v1/web/user/profile/other/', p, 'webid,uifid,msToken,a_bogus,verifyFp', userUrl(secUid), false).user || {};
  }

  function userSearch(host, keywords, offset) {
    var p = new Params().base()
      .add('search_channel', 'aweme_user_web').add('keyword', keywords).add('search_source', 'normal_search')
      .add('query_correct_type', '1').add('is_filter_search', '0').add('from_group_id', '').add('disable_rs', '0')
      .add('offset', offset).add('count', '10').add('need_filter_settings', offset === 0 ? '1' : '0').add('list_type', 'single')
      .add('pc_search_top_1_params', '{"enable_ai_search_top_1":1}').platform(browser(host), '50');
    return { path: '/aweme/v1/web/discover/search/', params: p, tail: 'webid,uifid,msToken,a_bogus,verifyFp',
      page: SITE + '/search/' + enc(keywords) + '?type=user' };
  }

  var DURATIONS = { '1 分钟以内': '0-1', '1 - 5 分钟': '1-5', '5 分钟以上': '5-10000' };

  function videoSearch(host, keywords, offset, searchId) {
    var p = new Params().base()
      .add('search_channel', 'aweme_video_web').add('enable_history', '1').add('sort_type', '0').add('publish_time', '0')
      .add('filter_duration', DURATIONS[host.getPref('duration', '不限')] || '').add('search_range', '0').add('keyword', keywords)
      .add('search_source', 'normal_search').add('query_correct_type', '1').add('is_filter_search', '1').add('from_group_id', '')
      .add('offset', offset).add('count', '16').add('need_filter_settings', offset === 0 ? '1' : '0');
    if (searchId) p.add('search_id', searchId);
    p.add('list_type', 'single').add('pc_search_top_1_params', '').platform(browser(host), '50');
    return { path: '/aweme/v1/web/search/item/', params: p, tail: 'webid,msToken,a_bogus,verifyFp',
      page: SITE + '/search/' + enc(keywords) + '?type=video' };
  }

  /** 综合搜索（网页版搜索页默认的“综合”标签）：视频、用户、合集混在一起排，比单搜视频更接近客户端里看到的 */
  function generalSearch(host, keywords, offset, searchId) {
    var duration = DURATIONS[host.getPref('duration', '不限')] || '';
    var p = new Params().base()
      .add('search_channel', 'aweme_general').add('enable_history', '1');
    // 选了时长才带筛选条件
    if (duration) p.add('sort_type', '0').add('publish_time', '0').add('filter_duration', duration).add('search_range', '0');
    p.add('keyword', keywords).add('search_source', 'normal_search').add('query_correct_type', '1')
      .add('is_filter_search', duration ? '1' : '0').add('from_group_id', '')
      .add('offset', offset).add('count', '10').add('need_filter_settings', offset === 0 ? '1' : '0');
    if (searchId) p.add('search_id', searchId);
    p.add('list_type', 'multi').add('pc_search_top_1_params', '{"enable_ai_search_top_1":1}').platform(browser(host), '50');
    return { path: '/aweme/v1/web/general/search/single/', params: p, tail: 'webid,msToken,a_bogus,verifyFp',
      page: SITE + '/search/' + enc(keywords) + '?type=general' };
  }

  /** 我收藏的视频，一页 10 个。这个接口是 POST，翻页游标在表单里 */
  function collection(host, cursor) {
    var p = new Params().base().add('publish_video_strategy_type', '2').platform(browser(host), '0');
    return call(host, '/aweme/v1/web/aweme/listcollection/', p, 'webid,uifid,msToken,a_bogus,verifyFp',
      SITE + '/user/self?showTab=favorite_collection', true, SITE, 'count=10&cursor=' + cursor);
  }

  function following(host, uid, secUid, maxTime) {
    var b = browser(host);
    var p = new Params().base()
      .add('user_id', uid).add('sec_user_id', secUid).add('offset', '0').add('min_time', '0').add('max_time', maxTime)
      .add('count', '20').add('source_type', maxTime === '0' ? '2' : '1').add('gps_access', '0').add('address_book_access', '0')
      .add('is_top', '1').add('pc_client_type', '1').add('pc_libra_divert', b.divert).add('support_h265', '1')
      .add('support_dash', '1').add('webcast_sdk_version', '170400').add('webcast_version_code', '170400')
      .add('version_code', '170400').add('version_name', '17.4.0').add('cookie_enabled', 'true')
      .add('screen_width', '1920').add('screen_height', '1080').add('browser_language', 'zh-CN')
      .add('browser_platform', b.platform).add('browser_name', b.name).add('browser_version', b.version)
      .add('browser_online', 'true').add('engine_name', b.engine).add('engine_version', b.engineVersion)
      .add('os_name', b.os).add('os_version', b.osVersion).add('cpu_core_num', '8').add('device_memory', '8')
      .add('platform', 'PC').add('downlink', '10').add('effective_type', '4g').add('round_trip_time', '0');
    return call(host, '/aweme/v1/web/user/following/list/', p, 'webid,verifyFp,msToken,a_bogus', userUrl(secUid), true);
  }

  /** 关注的人里正在直播的（网页版“关注”页顶上那一排） */
  function followLive(host) {
    var p = new Params().base().add('scene', 'aweme_pc_follow_top').platform(browser(host), '50');
    return call(host, '/webcast/web/feed/follow/', p, 'webid,uifid,msToken,a_bogus,verifyFp', SITE + '/follow', false);
  }

  /** 进入直播间：返回房间信息，里面有拉流地址 */
  function liveRoom(host, webRid) {
    var b = browser(host);
    var p = new Params()
      .add('aid', '6383').add('app_name', 'douyin_web').add('live_id', '1').add('device_platform', 'web').add('language', 'zh-CN')
      .add('enter_from', 'link_share').add('cookie_enabled', 'true').add('screen_width', '1920').add('screen_height', '1080')
      .add('browser_language', 'zh-CN').add('browser_platform', b.platform).add('browser_name', b.name)
      .add('browser_version', b.version).add('os_name', b.os).add('os_version', b.osVersion).add('web_rid', webRid);
    return call(host, '/webcast/room/web/enter/', p, 'msToken,a_bogus', LIVE_SITE + '/' + webRid, false, LIVE_SITE);
  }

  /** 登录者自己的 sec_uid 和昵称（主站页面里已经取不到了，走创作者中心的接口，Cookie 是同一份） */
  function myInfo(host) {
    var cookie = cookieMap(host);
    if (!loggedIn(cookie)) throw new Error('还没有登录抖音，请先在插件页登录');
    var key = String(host.md5(cookie.sessionid || cookie.sessionid_ss));
    var saved = String(host.getPref('self', '') || '').split('|');
    if (saved.length === 3 && saved[0] === key) return { secUid: saved[1], nickname: saved[2] };
    var json = host.getJson('https://creator.douyin.com/web/api/media/user/info/', {
      desktop: true, headers: { Accept: 'application/json, text/plain, */*', Referer: 'https://creator.douyin.com/creator-micro/home' }
    });
    var secUid = str(json, 'user.sec_uid');
    if (!secUid) throw new Error('没有取到自己的账号信息，请重新登录抖音');
    var nickname = str(json, 'user.nickname').replace(/\|/g, ' ');
    host.setPref('self', key + '|' + secUid + '|' + nickname);
    return { secUid: secUid, nickname: nickname };
  }

  function myUid(host) {
    var p = new Params().add('publish_video_strategy_type', '2').base().platform(browser(host), '0');
    var uid = str(call(host, '/aweme/v1/web/query/user/', p, 'uifid,webid,verifyFp,a_bogus', SITE + '/', false), 'user_uid');
    if (!uid) throw new Error('没有取到自己的账号信息，请重新登录抖音');
    return uid;
  }

  // ==================== 转换成书和章节 ====================
  function formatCount(n) { return n >= 10000 ? (Math.round(n / 1000) / 10) + '万' : String(n); }

  function formatDuration(ms) {
    var s = Math.round(ms / 1000), m = Math.floor(s / 60);
    return m + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
  }

  function awemeTitle(a) {
    var title = str(a, 'desc').split('\n')[0].replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    if (!title) title = str(a, 'author.nickname') ? str(a, 'author.nickname') + '的作品' : '无标题';
    return title.length > 80 ? title.substring(0, 80) + '…' : title;
  }

  function awemeCover(a) {
    return str(a, 'video.cover.url_list.0') || str(a, 'video.origin_cover.url_list.0') || str(a, 'images.0.url_list.0');
  }

  function awemeBook(a) {
    var parts = [];
    if (int(a, 'video.duration', 0) > 0) parts.push(formatDuration(int(a, 'video.duration', 0)));
    parts.push('赞 ' + formatCount(int(a, 'statistics.digg_count', 0)));
    return {
      coverUrl: awemeCover(a), bookUrl: videoUrl(str(a, 'aweme_id')), title: awemeTitle(a),
      artist: str(a, 'author.nickname'), status: parts.join(' · '), intro: str(a, 'desc')
    };
  }

  function awemeEpisode(a) { return { title: awemeTitle(a), url: videoUrl(str(a, 'aweme_id')) }; }

  function userBook(u) {
    var parts = ['粉丝 ' + formatCount(int(u, 'follower_count', 0))];
    if (int(u, 'aweme_count', 0) > 0) parts.push('作品 ' + int(u, 'aweme_count', 0));
    return {
      coverUrl: str(u, 'avatar_larger.url_list.0') || str(u, 'avatar_medium.url_list.0') || str(u, 'avatar_thumb.url_list.0'),
      bookUrl: userUrl(str(u, 'sec_uid')), title: str(u, 'nickname'), artist: str(u, 'nickname'),
      status: parts.join(' · '), intro: str(u, 'signature')
    };
  }

  function validAwemes(list) { return list.filter(function (a) { return a && str(a, 'aweme_id'); }); }

  // ==================== 搜索 ====================
  // 每个关键词翻到哪了：{ 关键词: { userMore, videoMore, searchId, userOffset, videoOffset, page } }
  // 下一页从第几个开始，用的是抖音上一页返回的位置（cursor），不是“页码 × 每页个数”：每页实际给的个数不固定，按页码算会和上一页重叠或者跳过
  var searchState = {};

  /** 上一页返回里说的下一页起点；没说就按这一页实际拿到的个数往后挪 */
  function nextOffset(json, offset, got) {
    var cursor = int(json, 'cursor', 0);
    return cursor > offset ? cursor : offset + got;
  }

  function needVerify(json) { return str(json, 'search_nil_info.search_nil_type') === 'verify_check'; }

  /**
   * 在抖音自己的搜索页（WebView）里发请求：页面里的脚本会给请求补上真正的签名和设备指纹，
   * 比我们自己算的更不容易被判成机器人。慢，只在直接请求被要求人机验证时用。
   */
  function pageCall(host, request) {
    var cookie = cookieMap(host), p = request.params;
    p.add('webid', webid(host));
    if (cookie.s_v_web_id) p.add('verifyFp', cookie.s_v_web_id).add('fp', cookie.s_v_web_id);
    // 结果用 encodeURIComponent 包一层再传回来，免得引号和换行在传递时被转义
    var script = "(function(){var w=window;if(document.readyState!=='complete')return '';" +
      "if(!w.__dySent){w.__dySent=1;w.__dyText='';var x=new XMLHttpRequest();" +
      "x.open('GET'," + JSON.stringify(request.path + '?' + p.query(enc)) + ",true);x.withCredentials=true;" +
      "x.onload=function(){w.__dyText=encodeURIComponent(x.responseText||'{}');};" +
      "x.onerror=function(){w.__dyText=encodeURIComponent('{}');};x.send();}" +
      "return w.__dyText;})();";
    var text = host.render(request.page, {
      desktop: true, script: script, timeout: 30000,
      parse: function (result) {
        var value = String(result || '').replace(/^"|"$/g, '');
        return value.indexOf('%7B') === 0 ? decodeURIComponent(value) : '';
      }
    });
    return parseJson(text);
  }

  /** build() 每次返回一份新的请求（参数表会被改动，不能复用） */
  function searchCall(host, build) {
    var request = build();
    var json = call(host, request.path, request.params, request.tail, request.page, false);
    if (!needVerify(json)) return json;
    host.log('直接搜索被要求人机验证，改为在抖音的搜索页里搜索');
    try {
      json = pageCall(host, build());
    } catch (e) {
      if (e.cancelled) throw e;
      host.log('在搜索页里搜索失败：' + e.message);
    }
    if (needVerify(json)) throw new Error('抖音要求人机验证：请到“搜索”页随便搜一个词，点“验证”完成后再试');
    return json;
  }

  /** 综合搜索的一页。结果是混排的卡片：单个视频、一组用户、一个合集（里面带着几个视频），都挑出来按原来的先后排 */
  function searchGeneral(host, keywords, page, state) {
    var offset = state.videoOffset;
    var json = searchCall(host, function () { return generalSearch(host, keywords, offset, state.searchId); });
    var cards = items(json, 'data'), books = [], seen = {};
    function add(book) {
      if (!book.bookUrl || seen[book.bookUrl]) return;
      seen[book.bookUrl] = true;
      books.push(book);
    }
    cards.forEach(function (card) {
      if (card.aweme_info && str(card, 'aweme_info.aweme_id')) add(awemeBook(card.aweme_info));
      items(card, 'user_list').forEach(function (u) { if (str(u, 'user_info.sec_uid')) add(userBook(u.user_info)); });
      // 合集卡片：里面的视频各算一本，点进去会自动列出整个合集
      validAwemes(items(card, 'aweme_mix_info.mix_items')).forEach(function (a) { add(awemeBook(a)); });
    });
    state.videoMore = more(json) && cards.length > 0;
    state.videoOffset = nextOffset(json, offset, cards.length);
    state.searchId = str(json, 'log_pb.impr_id') || str(json, 'extra.logid') || state.searchId;
    host.log('综合搜索第 ' + page + ' 页：从 ' + offset + ' 开始拿到 ' + cards.length + ' 张卡片、' + books.length + ' 本，还有更多=' + state.videoMore + '，下一页从 ' + state.videoOffset + ' 开始');
    return books;
  }

  /** mode：general 综合，all 视频和用户（分开搜再拼起来），video 只搜视频，user 只搜用户 */
  function search(host, keywords, page, mode) {
    if (mode === 'general') {
      var gKey = 'general:' + keywords;
      if (page === 1 || !searchState[gKey]) searchState[gKey] = { videoMore: true, searchId: '', videoOffset: 0, page: 0, fallback: false };
      var g = searchState[gKey];
      if (!g.fallback) {
        if (page !== g.page + 1) g.videoOffset = (page - 1) * 10;
        try {
          var found = searchGeneral(host, keywords, page, g);
          if (found.length > 0 || page > 1) {
            g.page = page;
            return { books: found, totalPage: g.videoMore ? page + 1 : page };
          }
          host.log('综合搜索第一页没有内容，改用分开搜视频和用户的办法');
        } catch (e) {
          // 要求人机验证的照常报出去（界面上会给“验证”的入口）；翻页时出错也直接报
          if (e.cancelled || page > 1 || String(e.message).indexOf('人机验证') >= 0 || String(e.message).indexOf('登录') >= 0) throw e;
          host.log('综合搜索失败，改用分开搜视频和用户的办法：' + e.message);
        }
        g.fallback = true;
      }
      mode = 'all';
    }
    var key = mode + ':' + keywords;
    if (page === 1 || !searchState[key]) searchState[key] = { userMore: true, videoMore: true, searchId: '', userOffset: 0, videoOffset: 0, page: 0 };
    var state = searchState[key], books = [], tried = 0, error = null;
    // 不是接着上一页往下翻的（比如直接要第 3 页）：没有上一页给的位置，只能按页码估一个
    if (page !== state.page + 1) { state.userOffset = (page - 1) * 10; state.videoOffset = (page - 1) * 16; }

    if (mode !== 'video' && state.userMore) {
      tried++;
      try {
        var userOffset = state.userOffset;
        var users = searchCall(host, function () { return userSearch(host, keywords, userOffset); });
        var userList = items(users, 'user_list');
        state.userMore = more(users) && userList.length > 0;
        state.userOffset = nextOffset(users, userOffset, userList.length);
        userList.forEach(function (i) { if (str(i, 'user_info.sec_uid')) books.push(userBook(i.user_info)); });
        host.log('搜索用户第 ' + page + ' 页：从 ' + userOffset + ' 开始拿到 ' + userList.length + ' 个，还有更多=' + state.userMore + '，下一页从 ' + state.userOffset + ' 开始');
      } catch (e) {
        if (e.cancelled) throw e;
        error = e;
        host.log('搜索用户失败：' + e.message);
      }
    }
    if (mode !== 'user' && state.videoMore) {
      tried++;
      try {
        var videoOffset = state.videoOffset;
        var videos = searchCall(host, function () { return videoSearch(host, keywords, videoOffset, state.searchId); });
        var videoList = items(videos, 'data');
        state.videoMore = more(videos) && videoList.length > 0;
        state.videoOffset = nextOffset(videos, videoOffset, videoList.length);
        state.searchId = str(videos, 'log_pb.impr_id') || str(videos, 'extra.logid') || state.searchId;
        validAwemes(videoList.map(function (i) { return i.aweme_info; })).forEach(function (a) { books.push(awemeBook(a)); });
        host.log('搜索视频第 ' + page + ' 页：从 ' + videoOffset + ' 开始拿到 ' + videoList.length + ' 个，还有更多=' + state.videoMore + '，下一页从 ' + state.videoOffset + ' 开始');
      } catch (e) {
        if (e.cancelled) throw e;
        if (!error) error = e;
        host.log('搜索视频失败：' + e.message);
      }
    }
    if (books.length === 0 && error) throw error;
    state.page = page;
    var hasNext = (mode !== 'video' && state.userMore) || (mode !== 'user' && state.videoMore);
    return { books: books, totalPage: tried > 0 && hasNext ? page + 1 : page };
  }

  // ==================== 章节 ====================
  var MAX_PAGES = 300;

  /** 逐页加载作品列表。loadPage(cursor) 返回接口的一页 */
  function loadAwemes(host, loadPage, loadFullPages) {
    var json = loadPage('0'), list = validAwemes(items(json, 'aweme_list'));
    if (!loadFullPages) return list;
    try {
      for (var page = 2; more(json) && page <= MAX_PAGES; page++) {
        host.progress('第 ' + page + ' 页');
        host.sleep(400 + Math.random() * 600);
        try {
          json = loadPage(String(json.max_cursor));
        } catch (e) {
          if (e.cancelled) throw e;
          host.toast('加载到第 ' + (page - 1) + ' 页时被抖音拦截，先显示已加载的部分');
          break;
        }
        list = list.concat(validAwemes(items(json, 'aweme_list')));
      }
    } finally {
      host.progress(null);
    }
    return list;
  }

  /** 播放地址：优先选码率最低的带声音的 mp4（只听声音，省流量） */
  function pickAudio(host, a) {
    var url = '';
    if (Shun.audioOnly(host)) {
      items(a, 'video.bit_rate_audio').forEach(function (i) { if (!url) url = str(i, 'audio_meta.url_list.main_url'); });
    }
    if (!url) {
      var lowest = -1;
      items(a, 'video.bit_rate').forEach(function (i) {
        var u = str(i, 'play_addr.url_list.0'), format = str(i, 'format'), rate = int(i, 'bit_rate', 0);
        // dash 的条目只有画面没有声音；h265 有的手机放不了
        if (!u || (format && format !== 'mp4') || int(i, 'is_h265', 0) === 1 || int(i, 'is_bytevc1', 0) === 1) return;
        if (lowest < 0 || rate < lowest) {
          lowest = rate;
          url = u;
        }
      });
    }
    if (!url) url = str(a, 'video.play_addr_h264.url_list.0') || str(a, 'video.play_addr.url_list.0');
    // 图文作品没有视频，只有配乐
    if (!url) url = str(a, 'music.play_url.url_list.0') || str(a, 'music.play_url.uri');
    return url.indexOf('//') === 0 ? 'https:' + url : url;
  }

  // ==================== 直播 ====================
  // 直播间的书地址：dy-live:<直播间号>；只知道主播是谁、不知道直播间号时是 dy-live-user:<sec_uid>
  var LIVE = 'dy-live:', LIVE_USER = 'dy-live-user:';

  function liveBook(bookUrl, user, title, cover, viewers) {
    var nickname = str(user, 'nickname');
    return {
      coverUrl: cover || str(user, 'avatar_larger.url_list.0') || str(user, 'avatar_medium.url_list.0') || str(user, 'avatar_thumb.url_list.0'),
      bookUrl: bookUrl, title: nickname + '的直播间', artist: nickname,
      status: '直播中' + (viewers ? ' · ' + viewers + ' 人' : ''), intro: title || str(user, 'signature')
    };
  }

  /** 关注的人里正在直播的。两个办法都用：专门的接口，加上从关注列表里挑出正在直播的人 */
  function liveBooks(host) {
    var books = [], seen = {}, errors = [];
    function push(key, book) {
      if (!key || seen[key]) return;
      seen[key] = true;
      books.push(book);
    }
    try {
      items(followLive(host), 'data.data').forEach(function (i) {
        var room = i.room || {}, rid = str(i, 'web_rid') || str(room, 'owner.web_rid');
        if (!rid) return;
        push(str(room, 'owner.sec_uid') || rid, liveBook(LIVE + rid, room.owner || {}, str(room, 'title'), str(room, 'cover.url_list.0'),
          str(room, 'stats.user_count_str') || str(room, 'user_count_str')));
      });
    } catch (e) {
      if (e.cancelled) throw e;
      errors.push(e);
      host.log('关注的直播接口失败：' + e.message);
    }
    try {
      var me = myInfo(host), uid = myUid(host), maxTime = '0';
      for (var page = 1; page <= 5; page++) {
        var json = following(host, uid, me.secUid, maxTime);
        items(json, 'followings').forEach(function (u) {
          if (int(u, 'live_status', 0) === 1 && str(u, 'sec_uid')) push(str(u, 'sec_uid'), liveBook(LIVE_USER + str(u, 'sec_uid'), u, '', '', ''));
        });
        if (!more(json) || int(json, 'min_time', 0) <= 0) break;
        maxTime = String(int(json, 'min_time', 0));
        host.sleep(300 + Math.random() * 400);
      }
    } catch (e) {
      if (e.cancelled) throw e;
      errors.push(e);
      host.log('从关注列表里找直播失败：' + e.message);
    }
    if (books.length === 0 && errors.length === 2) throw errors[0];
    return books;
  }

  var LIVE_FORMATS = { '只拉声音（flv，安卓）': 'flv', '带画面的流（hls，苹果）': 'hls' };

  /** 是不是苹果设备：苹果的播放器放不了 flv */
  function isApple(host) {
    var ua = typeof host.webViewUA === 'function' ? String(host.webViewUA() || '') : '';
    if (ua) return !/Android/i.test(ua) && /iPhone|iPad|iPod|Macintosh/.test(ua);
    // 旧版宿主拿不到 UA：安卓版的脚本引擎（Rhino）不认识 class，苹果版的认识
    try {
      new Function('class A {}');
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * 从拉流信息里挑地址。纯音频流最省流量，但只有 flv 格式，苹果放不了；
   * 所以苹果用 hls，从最低清的开始找（只听声音，画质无所谓）。
   */
  function pickLive(host, stream) {
    var format = LIVE_FORMATS[host.getPref('liveFormat', '自动')] || (isApple(host) ? 'hls' : 'flv');
    var url = '', data = {};
    try {
      data = parseJson(str(stream, 'live_core_sdk_data.pull_data.stream_data')).data || {};
    } catch (e) {
      if (e.cancelled) throw e;
    }
    if (format === 'flv') url = str(data, 'ao.main.flv');
    ['ld', 'md', 'sd', 'hd', 'uhd', 'origin'].forEach(function (level) { if (!url) url = str(data, level + '.main.' + format); });
    ['SD2', 'SD1', 'HD1', 'FULL_HD1'].forEach(function (level) {
      if (!url) url = str(stream, (format === 'hls' ? 'hls_pull_url_map.' : 'flv_pull_url.') + level);
    });
    return url || str(stream, 'hls_pull_url');
  }

  function liveAudio(host, bookUrl) {
    var rid = bookUrl.indexOf(LIVE) === 0 ? bookUrl.substring(LIVE.length) : '';
    if (!rid) {
      // 只知道主播：他的资料里有当前直播间的信息
      var roomData = str(userProfile(host, bookUrl.substring(LIVE_USER.length)), 'room_data');
      try { rid = str(parseJson(roomData), 'owner.web_rid'); } catch (e) { if (e.cancelled) throw e; }
      if (!rid) throw new Error('主播现在没有在直播');
    }
    var room = at(liveRoom(host, rid), 'data.data.0');
    if (!room || int(room, 'status', 0) !== 2) throw new Error('主播现在没有在直播');
    var url = pickLive(host, room.stream_url || {});
    if (!url) throw new Error('没有获取到直播地址');
    return { url: url.replace(/^http:/, 'https:'), headers: { Referer: LIVE_SITE + '/' } };
  }

  function isLive(url) { return url.indexOf(LIVE) === 0 || url.indexOf(LIVE_USER) === 0; }

  var LIKES = 'dy-likes';
  var MODES = { '综合': 'general', '视频和用户': 'all', '只搜视频': 'video', '只搜用户': 'user' };
  var WORDS = ['有声小说', '有声书', '评书', '相声', '广播剧', '睡前故事', '读书', '脱口秀', '电影解说', '纪录片', '音乐现场', '英语听力'];

  registerSource({
    id: '6c3a9e5f1d2b47a8b0c4e7f9a1d3b5c7', name: '抖音', url: SITE, group: '视频',
    description: '搜索抖音的视频和用户，播放的是视频的声音。搜到的用户是一本书，他的作品就是章节。“发现”里能听关注的人的直播。\n需要先登录；搜索提示人机验证时，点搜索页的“验证”。',
    multipleEpisodePages: true,

    loginUrl: SITE + '/', loginDesktop: true,
    checkLogin: function () {
      var info = myInfo(this.host);
      return info.nickname || true;
    },

    searchVerificationUrl: function (keywords) { return SITE + '/search/' + enc(keywords) + '?type=video'; },
    searchVerificationDesktop: true,

    config: [
      { type: 'select', key: 'searchMode', label: '搜索内容', default: '综合', options: ['综合', '视频和用户', '只搜视频', '只搜用户'] },
      { type: 'select', key: 'duration', label: '搜索视频的时长', default: '不限', options: ['不限', '1 分钟以内', '1 - 5 分钟', '5 分钟以上'] },
      { type: 'select', key: 'liveFormat', label: '直播用哪种流', default: '自动', options: ['自动', '只拉声音（flv，安卓）', '带画面的流（hls，苹果）'] },
      // 默认值写成字符串：旧版的 iOS / Mac 程序会把布尔的 true 读成 "1"，开关显示成关着的，实际却是开的
      { type: 'switch', key: 'autoMix', label: '作品属于合集时，自动显示整个合集', default: 'true' },
      { type: 'switch', key: 'audioOnly', label: '优先用纯音频流（更省流量，放不了就关掉）', default: 'true' }
    ],

    search: function (keywords, page) {
      return search(this.host, keywords, page, MODES[this.host.getPref('searchMode', '综合')] || 'general');
    },

    categoryMenus: function () {
      return [
        { title: '我的', tabs: [{ title: '关注的直播', url: 'dy-live' }, { title: '关注和喜欢', url: 'dy-mine#0#1' }, { title: '收藏', url: 'dy-collect#0#1' }] },
        { title: '推荐', tabs: WORDS.map(function (w) { return { title: w, url: 'dy-search:' + w + '#1' }; }) }
      ];
    },

    categoryPage: function (url) {
      var host = this.host, m, page, books;
      // 这里的内容都要登录才有：没登录就直接说，不去请求
      if (!loggedIn(cookieMap(host))) throw new Error(NOT_LOGGED_IN);
      if (url === 'dy-live') return { books: liveBooks(host), currentPage: 1, totalPage: 1, nextUrl: null };
      if ((m = /^dy-mine#(\d+)#(\d+)$/.exec(url))) {
        page = parseInt(m[2], 10);
        var me = myInfo(host);
        books = page === 1 ? [{ coverUrl: '', bookUrl: LIKES, title: '我的喜欢', artist: me.nickname, intro: '我点过赞的作品' }] : [];
        var next = null;
        try {
          var json = following(host, myUid(host), me.secUid, m[1]);
          items(json, 'followings').forEach(function (u) { if (str(u, 'sec_uid')) books.push(userBook(u)); });
          if (more(json) && int(json, 'min_time', 0) > 0) next = 'dy-mine#' + int(json, 'min_time', 0) + '#' + (page + 1);
        } catch (e) {
          if (e.cancelled || page > 1) throw e;
          host.log('加载关注列表失败：' + e.message);
          host.toast('关注列表加载失败：' + e.message);
        }
        return { books: books, currentPage: page, totalPage: next ? page + 1 : page, nextUrl: next };
      }
      if ((m = /^dy-collect#(\d+)#(\d+)$/.exec(url))) {
        page = parseInt(m[2], 10);
        var collected = collection(host, m[1]);
        books = validAwemes(items(collected, 'aweme_list')).map(awemeBook);
        var cursor = str(collected, 'cursor');
        var nextPage = more(collected) && cursor && cursor !== m[1] ? 'dy-collect#' + cursor + '#' + (page + 1) : null;
        return { books: books, currentPage: page, totalPage: nextPage ? page + 1 : page, nextUrl: nextPage };
      }
      if ((m = /^dy-search:(.+)#(\d+)$/.exec(url))) {
        page = parseInt(m[2], 10);
        var r = search(host, m[1], page, 'video');
        return { books: r.books, currentPage: page, totalPage: r.totalPage, nextUrl: r.totalPage > page ? 'dy-search:' + m[1] + '#' + (page + 1) : null };
      }
      throw new Error('不认识的分类地址：' + url);
    },

    bookDetail: function (bookUrl, loadEpisodes, loadFullPages) {
      var host = this.host;
      if (isLive(bookUrl)) return { episodes: [{ title: '直播', url: bookUrl, live: true }] };
      if (bookUrl === LIKES) {
        if (!loadEpisodes) return { episodes: [] };
        var mine = myInfo(host).secUid;
        return { episodes: loadAwemes(host, function (cursor) { return userLikes(host, mine, cursor); }, loadFullPages).map(awemeEpisode) };
      }
      if (bookUrl.indexOf('/user/') >= 0) {
        var secUid = lastSegment(bookUrl), detail = { episodes: [] };
        // 用户资料只在第一次（不加载全部页时）取，取不到不影响听
        if (!loadFullPages) {
          try {
            var u = userProfile(host, secUid);
            detail.title = str(u, 'nickname');
            detail.artist = str(u, 'nickname');
            detail.intro = str(u, 'signature');
            detail.coverUrl = str(u, 'avatar_larger.url_list.0') || str(u, 'avatar_medium.url_list.0');
            detail.status = '作品 ' + int(u, 'aweme_count', 0) + ' · 粉丝 ' + formatCount(int(u, 'follower_count', 0));
          } catch (e) {
            if (e.cancelled) throw e;
            host.log('获取用户资料失败：' + e.message);
          }
        }
        if (loadEpisodes) detail.episodes = loadAwemes(host, function (cursor) { return userPosts(host, secUid, cursor); }, loadFullPages).map(awemeEpisode);
        return detail;
      }
      var a = awemeDetail(host, lastSegment(bookUrl));
      // 这个作品属于某个合集：直接把整个合集列出来，一集一集接着听。合集没取到就还是只有它自己这一集
      var mixId = str(a, 'mix_info.mix_id');
      var autoMix = String(host.getPref('autoMix', 'true'));
      if (mixId && loadEpisodes && autoMix !== 'false' && autoMix !== '1' && autoMix !== '0') {
        try {
          var seen = {}, mix = loadMix(host, mixId, str(a, 'aweme_id'), loadFullPages).filter(function (v) {
            var id = str(v, 'aweme_id');
            if (seen[id]) return false;
            seen[id] = true;
            return true;
          });
          if (mix.length > 0) {
            var total = int(a, 'mix_info.statis.updated_to_episode', 0) || mix.length;
            return {
              episodes: mix.map(awemeEpisode), title: str(a, 'mix_info.mix_name') || awemeTitle(a), artist: str(a, 'author.nickname'),
              intro: str(a, 'mix_info.desc') || str(a, 'desc'), coverUrl: str(a, 'mix_info.cover_url.url_list.0') || awemeCover(a),
              status: '合集 · 共 ' + total + ' 集'
            };
          }
        } catch (e) {
          if (e.cancelled) throw e;
          host.log('合集没取到，只显示这一个作品：' + e.message);
        }
      }
      return {
        episodes: [awemeEpisode(a)], title: awemeTitle(a), artist: str(a, 'author.nickname'),
        intro: str(a, 'desc'), coverUrl: awemeCover(a)
      };
    },

    // 作品从新到旧排，新作品在最前面：只取前几页，把没见过的补到前面
    updateEpisodes: function (bookUrl, known) {
      if (bookUrl.indexOf('/user/') < 0 || !known || known.length === 0) return null;
      var host = this.host, secUid = lastSegment(bookUrl), seen = {}, fresh = [], cursor = '0';
      known.forEach(function (e) { seen[e.url] = true; });
      for (var page = 1; page <= 5; page++) {
        var json = userPosts(host, secUid, cursor), reached = false;
        validAwemes(items(json, 'aweme_list')).forEach(function (a) {
          var episode = awemeEpisode(a);
          if (!seen[episode.url]) {
            seen[episode.url] = true;
            fresh.push(episode);
          } else if (int(a, 'is_top', 0) !== 1) {
            reached = true; // 置顶的作品总在最前面，不能说明已经接上了
          }
        });
        if (reached || !more(json)) return { episodes: fresh.concat(known) };
        cursor = String(json.max_cursor);
        host.sleep(400 + Math.random() * 600);
      }
      return null; // 新作品太多，接不上，让宿主整本重新加载
    },

    // 播放地址带时效签名，每次播放时现取
    audio: function (episodeUrl) {
      if (isLive(episodeUrl)) return liveAudio(this.host, episodeUrl);
      var url = pickAudio(this.host, awemeDetail(this.host, lastSegment(episodeUrl)));
      if (!url) throw new Error('没有获取到播放地址');
      return { url: url, headers: { Referer: SITE + '/' } };
    },

    audioHeaders: function (audioUrl) {
      return /douyin|zjcdn|ixigua|bytecdn|byteimg|pull-/.test(audioUrl) ? { Referer: SITE + '/' } : null;
    }
  });
})();
