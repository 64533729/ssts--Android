// ---------- 哔哩哔哩：搜索视频，按分 P 作为章节，播放 HTML5 版 mp4 的音轨 ----------
// 登录（在 App 内的网页里登录，留下 Cookie）后，发现页的“我的”里有自己的收藏夹和订阅的合集：
// 自己的每个收藏夹是一个标签，里面的视频各是一本书；订阅的合集、收藏的别人的收藏夹各是一本书，里面的视频是章节。
(function () {
  var API = 'https://api.bilibili.com/x/';
  var SITE = 'https://www.bilibili.com';
  var LOGIN_HINT = '还没有登录 B 站：到“插件”页点开这个源，点“登录”';
  var cookie = null; // B 站接口需要一个 buvid3 Cookie（随机生成即可）

  // 登录后网页留下的 Cookie（旧版宿主没有这个接口，当作没登录）
  function jar(host) { return typeof host.cookies === 'function' ? String(host.cookies('https://api.bilibili.com/') || '') : ''; }
  function cookieValue(text, name) { return (new RegExp('(?:^|;\\s*)' + name + '=([^;]*)').exec(text) || [])[1] || ''; }

  // 请求带上登录的 Cookie；里面没有 buvid3 时补一个随机的
  function options(host) {
    var saved = jar(host);
    if (!cookieValue(saved, 'buvid3')) {
      if (!cookie) cookie = 'buvid3=' + host.uuid().toUpperCase() + 'infoc';
      saved = saved ? saved + '; ' + cookie : cookie;
    }
    return { desktop: true, headers: { Cookie: saved, Referer: SITE + '/' } };
  }

  function get(host, url) {
    var json = host.getJson(url, options(host));
    if (int(json, 'code') === -101) throw new Error(LOGIN_HINT);
    if (int(json, 'code') !== 0) throw new Error('B 站接口返回错误：' + str(json, 'message') + '（' + str(json, 'code') + '）');
    return json.data;
  }

  // 登录的是哪个账号（用户编号）；没登录时是空的
  function myId(host) {
    var saved = jar(host);
    return cookieValue(saved, 'SESSDATA') ? cookieValue(saved, 'DedeUserID') : '';
  }

  function duration(seconds) {
    var m = Math.floor(seconds / 60), s = seconds % 60;
    return (m >= 60 ? Math.floor(m / 60) + ':' + (m % 60 < 10 ? '0' : '') + m % 60 : m) + ':' + (s < 10 ? '0' : '') + s;
  }

  function folderUrl(id) { return SITE + '/list/ml' + id; }
  function seasonUrl(mid, id) { return 'https://space.bilibili.com/' + mid + '/lists/' + id + '?type=season'; }
  // 收藏夹、合集里的一个视频。删掉或者失效的视频标题会变成“已失效视频”，没法播，不要
  function usable(v) { return str(v, 'bvid') && str(v, 'title') !== '已失效视频'; }

  // 收藏夹或合集当成一本书时的章节：一个视频一集（多 P 的视频只播第一 P）。两种列表都是分页的，一页 20 个
  function listEpisodes(host, url) {
    var episodes = [], seen = {};
    try {
      for (var p = 1; p <= 100; p++) {
        var data;
        try { data = get(host, url + '&pn=' + p + '&ps=20'); } catch (e) {
          // 后面某一页没取到（翻得快了 B 站会说“服务暂不可用”）：再试一次，还不行就先用已经取到的
          if (e.cancelled || p === 1) throw e;
          try { data = get(host, url + '&pn=' + p + '&ps=20'); } catch (again) {
            if (again.cancelled) throw again;
            host.log('B 站列表第 ' + p + ' 页没取到，只显示前面的 ' + episodes.length + ' 个：' + again.message);
            break;
          }
        }
        var list = items(data, 'medias'), total = int(data, 'info.media_count'), fresh = 0;
        list.forEach(function (v) {
          var bvid = str(v, 'bvid');
          if (!usable(v) || seen[bvid]) return;
          seen[bvid] = true; fresh++;
          episodes.push({ title: str(v, 'title'), url: 'bili-bv:' + bvid, parts: int(v, 'page', 1) });
        });
        // 合集的接口有时一次就把全部给了，再翻页只会重复：没有新的就停
        if (list.length === 0 || fresh === 0 || data.has_more === false || p * 20 >= total) break;
        host.progress((p + 1) + ' / ' + Math.ceil(total / 20));
      }
    } finally { host.progress(null); }
    return episodes;
  }

  // 一个视频的信息里带着它所在合集的全部内容：合集里每个视频、每个视频的每一 P。每一 P 是一集
  function seasonParts(video) {
    var episodes = [];
    items(video, 'ugc_season.sections').forEach(function (section) {
      items(section, 'episodes').forEach(function (e) {
        var parts = items(e, 'pages'), name = str(e, 'title') || str(e, 'arc.title');
        // 合集里的视频自己又分了 P 的，每一 P 一集
        if (parts.length > 1) {
          parts.forEach(function (p) {
            episodes.push({ title: name + ' · ' + (str(p, 'part') || 'P' + int(p, 'page')), url: 'bili:' + str(e, 'aid') + ':' + str(p, 'cid') });
          });
        } else if (str(e, 'aid') && str(e, 'cid')) {
          episodes.push({ title: name, url: 'bili:' + str(e, 'aid') + ':' + str(e, 'cid') });
        }
      });
    });
    return episodes;
  }

  // 收藏夹里分了好几 P 的视频：列表里只知道它有几 P，要再查一次才知道每一 P。一个收藏夹里这样的视频最多查这么多个，免得太慢
  var MAX_EXPAND = 40;

  function listBook(host, url) {
    var data = get(host, url + '&pn=1&ps=1'), info = at(data, 'info') || {};
    // firstVideo：列表里的第一个视频，取合集的分 P 时用
    return { title: str(info, 'title'), coverUrl: https(str(info, 'cover')), artist: str(info, 'upper.name'), intro: str(info, 'intro'),
      firstVideo: str(data, 'medias.0.bvid'), count: int(info, 'media_count') };
  }

  function https(u) { return u.indexOf('//') === 0 ? 'https:' + u : u; }
  function formatCount(n) { return n >= 10000 ? (Math.round(n / 1000) / 10) + '万' : String(n); }

  function search(host, keywords, page) {
    var data = get(host, API + 'web-interface/search/type?search_type=video&keyword=' + Shun.enc(keywords) + '&page=' + page);
    var books = items(data, 'result').map(function (v) {
      return {
        coverUrl: https(str(v, 'pic')), bookUrl: 'https://m.bilibili.com/video/' + str(v, 'bvid'),
        title: host.htmlDecode(str(v, 'title').replace(/<[^>]+>/g, '')), artist: str(v, 'author'),
        status: '播放 ' + formatCount(int(v, 'play')) + ' · ' + str(v, 'duration'), intro: str(v, 'description')
      };
    });
    return { books: books, totalPage: Math.max(1, int(data, 'numPages')) };
  }

  registerSource({
    id: 'c893546d95f84db194046bd8de5dbcbb', name: '哔哩哔哩', url: 'https://m.bilibili.com',
    description: '推荐指数:5星 ⭐⭐⭐⭐⭐\nB 站有很多意想不到的有声书。播放的是视频的声音，多 P 视频每一 P 为一集，属于合集的视频会列出整个合集。' +
      '在插件页“登录”自己的账号后，发现页的“我的”里能看到自己的收藏夹和订阅的合集。',
    config: [
      // 默认值写成字符串：旧版的 iOS / Mac 程序会把布尔的 true 读成 "1"，开关显示成关着的，实际却是开的
      { type: 'switch', key: 'autoSeason', label: '视频属于合集时，自动显示整个合集', default: 'true' },
      { type: 'switch', key: 'audioOnly', label: '优先用纯音频流（更省流量，放不了就关掉）', default: 'true' }
    ],
    // 手机上给手机版的登录页（短信 / 密码）；右上角可以换成电脑版网页（能扫码）
    loginUrl: 'https://passport.bilibili.com/login?gourl=' + encodeURIComponent('https://m.bilibili.com/'), loginDesktop: false,
    loginAltUrl: 'https://passport.bilibili.com/login',
    // 已登录时返回昵称
    checkLogin: function () {
      var name = str(get(this.host, API + 'web-interface/nav'), 'uname');
      if (!name) throw new Error('还没有登录 B 站');
      return name;
    },
    coverHeaders: Shun.coverReferer('hdslb.com', 'https://www.bilibili.com/'),

    search: function (keywords, page) { return search(this.host, keywords, page); },

    // 分类即按关键词搜索
    categoryMenus: function () {
      var words = [['有声小说', '有声小说'], ['广播剧', '广播剧'], ['评书', '评书'], ['相声', '相声'], ['有声漫画', '有声漫画'],
        ['英文有声书', 'audiobooks'], ['经典老歌', '经典老歌'], ['音乐推荐', '音乐推荐'], ['同人音声', '同人音声']];
      var menus = [{ title: '推荐', tabs: words.map(function (w) { return { title: w[0], url: 'bili-search:' + w[1] + '#1' }; }) }];
      // “我的”：登录后自己的每个收藏夹是一个标签，最后是订阅的合集；没登录时放两个提示登录的标签
      var host = this.host, mid = myId(host), mine = [];
      if (mid) {
        try {
          items(get(host, API + 'v3/fav/folder/created/list-all?up_mid=' + mid), 'list').forEach(function (f) {
            mine.push({ title: str(f, 'title') + '（' + int(f, 'media_count') + '）', url: 'bili-fav:' + str(f, 'id') + '#1' });
          });
        } catch (e) { if (e.cancelled) throw e; host.log('B 站收藏夹没取到：' + e.message); }
      }
      if (mine.length === 0) mine.push({ title: '收藏夹', url: 'bili-my:fav#1' });
      mine.push({ title: '订阅合集', url: 'bili-my:sub#1' });
      menus.push({ title: '我的', tabs: mine });
      return menus;
    },

    categoryPage: function (url) {
      var host = this.host, mine = /^bili-(fav|my):([^#]+)#(\d+)$/.exec(url);
      if (mine) {
        var n = parseInt(mine[3], 10), mid = myId(host);
        if (!mid) throw new Error(LOGIN_HINT);
        if (mine[1] === 'fav') {
          // 某个收藏夹里的视频，每个视频是一本书
          var fav = get(host, API + 'v3/fav/resource/list?media_id=' + mine[2] + '&platform=web&pn=' + n + '&ps=20');
          var videos = items(fav, 'medias').filter(usable).map(function (v) {
            return {
              coverUrl: https(str(v, 'cover')), bookUrl: 'https://m.bilibili.com/video/' + str(v, 'bvid'), title: str(v, 'title'), artist: str(v, 'upper.name'),
              status: (int(v, 'page') > 1 ? int(v, 'page') + ' P · ' : '') + duration(int(v, 'duration')), intro: str(v, 'intro')
            };
          });
          var more = fav.has_more === true;
          return { books: videos, currentPage: n, totalPage: more ? n + 1 : n, nextUrl: more ? 'bili-fav:' + mine[2] + '#' + (n + 1) : null };
        }
        if (mine[2] === 'fav') throw new Error('没有取到收藏夹，点右上角刷新再试一次');
        // 订阅的合集（type 21）和收藏的别人的收藏夹（type 11），各是一本书
        var sub = get(host, API + 'v3/fav/folder/collected/list?up_mid=' + mid + '&platform=web&pn=' + n + '&ps=20');
        var lists = items(sub, 'list').filter(function (f) { return int(f, 'state') !== 1; }).map(function (f) {
          var season = int(f, 'type') === 21;
          return {
            coverUrl: https(str(f, 'cover')), bookUrl: season ? seasonUrl(str(f, 'mid'), str(f, 'id')) : folderUrl(str(f, 'id')), title: str(f, 'title'),
            artist: str(f, 'upper.name'), status: (season ? '合集' : '收藏夹') + ' · ' + int(f, 'media_count') + ' 个视频', intro: str(f, 'intro')
          };
        });
        var moreLists = sub.has_more === true;
        return { books: lists, currentPage: n, totalPage: moreLists ? n + 1 : n, nextUrl: moreLists ? 'bili-my:sub#' + (n + 1) : null };
      }
      var m = /^bili-search:(.+)#(\d+)$/.exec(url);
      var page = parseInt(m[2], 10);
      var r = search(this.host, m[1], page);
      return { books: r.books, currentPage: page, totalPage: r.totalPage, nextUrl: page < r.totalPage ? 'bili-search:' + m[1] + '#' + (page + 1) : null };
    },

    bookDetail: function (bookUrl, loadEpisodes) {
      // 收藏夹、合集当成一本书：里面的视频是章节
      var folder = /\/list\/ml(\d+)/.exec(bookUrl), season = /\/lists\/(\d+)\?type=season/.exec(bookUrl);
      if (folder || season) {
        var listUrl = folder ? API + 'v3/fav/resource/list?media_id=' + folder[1] + '&platform=web' : API + 'space/fav/season/list?season_id=' + season[1];
        var book = listBook(this.host, listUrl);
        var host = this.host, listed = null, videos = book.count;
        if (loadEpisodes === false) listed = [];
        if (listed === null && season && book.firstVideo) {
          // 合集：合集里任意一个视频的信息都带着整个合集（每个视频、每一 P），一次就能拿全，不用一页页翻列表；
          // 翻列表的话，分了好几 P 的视频也只会剩第一 P
          try {
            var first = get(host, API + 'web-interface/view?bvid=' + book.firstVideo);
            var full = str(first, 'ugc_season.id') === season[1] ? seasonParts(first) : [];
            if (full.length > 0) {
              listed = full;
              videos = int(first, 'ugc_season.ep_count') || videos;
            }
          } catch (e) {
            if (e.cancelled) throw e;
            host.log('B 站合集的分 P 没取到，改为翻列表（每个视频只列第一 P）：' + e.message);
          }
        }
        if (listed === null) {
          listed = listEpisodes(host, listUrl);
          videos = listed.length;
        }
        if (folder) {
          // 收藏夹：分了好几 P 的视频逐个查出每一 P
          var expanded = [], budget = MAX_EXPAND;
          try {
            listed.forEach(function (v, i) {
              if (v.parts > 1 && budget > 0) {
                budget--;
                host.progress('分 P ' + (MAX_EXPAND - budget));
                try {
                  var video = get(host, API + 'web-interface/view?bvid=' + v.url.split(':')[1]), pages = items(video, 'pages');
                  if (pages.length > 1) {
                    pages.forEach(function (p) {
                      expanded.push({ title: v.title + ' · ' + (str(p, 'part') || 'P' + int(p, 'page')), url: 'bili:' + str(video, 'aid') + ':' + str(p, 'cid') });
                    });
                    return;
                  }
                } catch (e) {
                  if (e.cancelled) throw e;
                }
              }
              expanded.push(v);
            });
          } finally { host.progress(null); }
          listed = expanded;
        }
        return {
          title: book.title, coverUrl: book.coverUrl, artist: book.artist, intro: book.intro,
          episodes: listed.map(function (e) { return { title: e.title, url: e.url }; }),
          status: listed.length > 0 ? videos + ' 个视频' + (listed.length > videos ? ' · ' + listed.length + ' 集' : '') : ''
        };
      }
      var bvid = bookUrl.replace(/\/+$/, '').split('/').pop().split('?')[0];
      var data = get(this.host, API + 'web-interface/view?bvid=' + bvid);
      // 这个视频属于某个合集：直接把整个合集列出来，一集一集接着听（视频信息里已经带着合集的全部内容，不用再请求）
      // 存成 "1" / "0" 的是旧版程序在开关显示为“关”时存下的，也当成关
      var autoSeason = String(this.host.getPref('autoSeason', 'true'));
      var seasonEpisodes = at(data, 'ugc_season') && autoSeason !== 'false' && autoSeason !== '1' && autoSeason !== '0' ? seasonParts(data) : [];
      if (seasonEpisodes.length > 1) {
        return {
          episodes: seasonEpisodes, title: str(data, 'ugc_season.title') || str(data, 'title'), artist: str(data, 'owner.name'),
          intro: str(data, 'ugc_season.intro') || str(data, 'desc'), coverUrl: https(str(data, 'ugc_season.cover') || str(data, 'pic')),
          status: '合集 · 共 ' + seasonEpisodes.length + ' 集'
        };
      }
      var pages = items(data, 'pages');
      var episodes = pages.map(function (p) {
        var part = str(p, 'part');
        return { title: pages.length === 1 ? str(data, 'title') : (part.length > 0 ? part : 'P' + int(p, 'page')), url: 'bili:' + str(data, 'aid') + ':' + str(p, 'cid') };
      });
      return { episodes: episodes, intro: str(data, 'desc'), title: str(data, 'title'), artist: str(data, 'owner.name'), coverUrl: https(str(data, 'pic')) };
    },

    // 播放地址带时效签名，每次播放时现取
    audio: function (url) {
      var parts = url.split(':');
      if (parts.length === 2 && parts[0] === 'bili-bv') {
        // 收藏夹、合集里的视频只记了视频编号，播的时候再查它的第一 P
        var video = get(this.host, API + 'web-interface/view?bvid=' + parts[1]);
        parts = ['bili', str(video, 'aid'), str(video, 'pages.0.cid') || str(video, 'cid')];
      }
      if (parts.length !== 3 || parts[0] !== 'bili') throw new Error('章节地址已过期，请刷新章节列表');
      // 优先只取声音：B 站把画面和声音分开存，声音那一路很小。没取到（比如老视频没有分开存）就还是用带画面的
      if (Shun.audioOnly(this.host, true)) {
        try {
          var dash = get(this.host, API + 'player/playurl?avid=' + parts[1] + '&cid=' + parts[2] + '&fnval=16&fourk=0&otype=json');
          var track = null;
          items(dash, 'dash.audio').forEach(function (a) { if (!track || int(a, 'bandwidth') < int(track, 'bandwidth')) track = a; });
          if (track) {
            // 几个地址里优先用 B 站自己的服务器（bilivideo.com），别的是借用户设备转发的，不稳
            var urls = [str(track, 'baseUrl') || str(track, 'base_url')].concat(items(track, 'backupUrl')).concat(items(track, 'backup_url'))
              .filter(function (u) { return u; });
            var own = urls.filter(function (u) { return /^https?:\/\/[^\/]*\.bilivideo\.com[:\/]/.test(u) && !/mcdn/.test(u); });
            // 这一路地址不带来源页（Referer）会被拒绝，连播放前的探测也要带，所以直接跟着地址一起给；
            // 以及电脑浏览器的身份（UA）：这个地址是按电脑网页要的，换成安卓手机的 UA 去取会被拒绝
            var ua = typeof this.host.userAgent === 'function' ? String(this.host.userAgent(true) || '') : '';
            if (own[0] || urls[0]) {
              return { url: own[0] || urls[0], headers: { Referer: SITE + '/', 'User-Agent': ua || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' } };
            }
          }
        } catch (e) {
          if (e.cancelled) throw e;
          this.host.log('B 站纯音频流没取到，改用带画面的：' + e.message);
        }
      }
      var data = get(this.host, API + 'player/playurl?avid=' + parts[1] + '&cid=' + parts[2] + '&platform=html5&otype=json&qn=16&type=mp4&html5=1');
      var audio = str(data, 'durl.0.url');
      if (!audio) throw new Error('没有获取到播放地址（可能是大会员或付费内容）');
      return audio;
    },

    audioHeaders: function (audioUrl) {
      return audioUrl.indexOf('bilivideo') >= 0 || audioUrl.indexOf('akamaized') >= 0 ? { Referer: 'https://www.bilibili.com/' } : null;
    }
  });
})();

// ---------- 博看有声 ----------
(function () {
  var INSTANCE = '25304';

  function units(bookUrl, p) { return 'https://api.bookan.com.cn/voice/album/units?album_id=' + bookUrl + '&page=' + p + '&num=20&order=1'; }
  var lastPages = {}; // 搜索时每个关键词下图书 / 专辑各有多少页：{ 关键词: { book: 17, album: 0 } }

  function parseUnits(data) { return items(data, 'list').map(function (i) { return { title: str(i, 'title'), url: str(i, 'file') }; }); }

  registerSource({
    id: 'c98a21452583434da5cfef8be16b71d6', name: '博看有声', url: 'https://voicewk.bookan.com.cn/25303/index',
    description: '推荐指数:5星 ⭐⭐⭐⭐⭐\n图书馆数字资源，经典名著、人文社科类有声书。',
    multipleEpisodePages: true,

    // 图书和专辑是两个接口，各自分页：按传入的页码请求，总页数取两者中较大的；
    // 某一类已经翻完（页码超过它的最后一页）就不再请求它
    search: function (keywords, page) {
      var host = this.host, books = [], failed = 0;
      var known = lastPages[keywords] || (lastPages[keywords] = {});
      var types = ['book', 'album'];
      types.forEach(function (type) {
        if (known[type] !== undefined && page > known[type]) return;
        try {
          var json = host.getJson('https://es.bookan.com.cn/api/v3/voice/' + type + '?instanceId=' + INSTANCE + '&keyword=' + Shun.enc(keywords) +
            '&pageNum=' + page + '&limitNum=20');
          known[type] = int(json, 'data.last_page', 0);
          items(json, 'data.list').forEach(function (i) { books.push({ coverUrl: str(i, 'cover'), bookUrl: str(i, 'id'), title: str(i, 'name') }); });
        } catch (e) {
          if (e.cancelled) throw e;
          failed++;
          host.log('搜索 ' + type + ' 失败：' + e.message);
        }
      });
      if (failed === types.length) throw new Error('博看有声搜索失败，请稍后再试');
      return { books: books, totalPage: Math.max(page, known.book || 0, known.album || 0) };
    },

    categoryMenus: function () {
      function tabs(type, list) {
        return list.map(function (p) {
          return { title: p[0], url: 'https://api.bookan.com.cn/voice/' + type + '/list?instance_id=' + INSTANCE + '&page=1&category_id=' + p[1] + '&num=24' };
        });
      }
      return [
        { title: '图书', tabs: tabs('book', [['经典必读', 1314], ['国学经典', 1320], ['文学文艺', 1306], ['少年读物', 1305], ['儿童文学', 1304],
          ['心理哲学', 1310], ['育儿心经', 1309], ['家庭健康', 1311], ['青春励志', 1307], ['历史小说', 1312],
          ['商业财经', 1315], ['科技科普', 1313], ['故事会', 1303], ['红色岁月', 1316], ['社会观察', 1318], ['音乐戏曲', 1317], ['相声评书', 1319]]) },
        { title: '专辑', tabs: tabs('album', [['健康养生', 4], ['休闲娱乐', 5], ['财经科技', 6], ['广播节目', 7], ['人文社科', 8],
          ['少儿学堂', 9], ['文史军事', 10], ['投资理财', 11], ['亲子教育', 12], ['时尚生活', 13],
          ['汽车知识', 14], ['发展创业', 15], ['婚恋情感', 16], ['自我提升', 17], ['商业资讯', 18], ['新闻热点', 19]]) }
      ];
    },

    categoryPage: function (url) {
      var data = this.host.getJson(url).data;
      var current = int(data, 'current_page', 1), total = int(data, 'last_page', 1);
      var books = items(data, 'list').map(function (i) {
        return { coverUrl: str(i, 'cover'), bookUrl: str(i, 'id'), title: str(i, 'name'), status: '共 ' + int(i, 'total') + ' 章' };
      });
      return { books: books, currentPage: current, totalPage: total, nextUrl: current < total ? url.replace(/page=\d+/, 'page=' + (current + 1)) : null };
    },

    bookDetail: function (bookUrl, loadEpisodes, loadFullPages) {
      if (!loadEpisodes) return { episodes: [] };
      var host = this.host;
      var data = host.getJson(units(bookUrl, 1)).data;
      var total = int(data, 'last_page', 1);
      var list = parseUnits(data);
      if (loadFullPages) {
        try {
          for (var p = 2; p <= total; p++) {
            host.progress(p + ' / ' + total);
            list = list.concat(parseUnits(host.getJson(units(bookUrl, p)).data));
            host.sleep(100 + Math.random() * 300);
          }
        } finally {
          host.progress(null);
        }
      }
      return { episodes: list };
    }
  });
})();

// ---------- 云图有声 ----------
(function () {
  var API = 'http://open-service.yuntuys.com/api/w_ys/book/';
  var WECHAT = 'wechat:07955551-706c-4259-9aa0-db4627dfca57';

  function parseBook(i) {
    return {
      coverUrl: str(i, 'cover'), bookUrl: str(i, 'bookId'), title: str(i, 'bookName'), author: str(i, 'authorName'), artist: str(i, 'anchorName'),
      status: '共 ' + int(i, 'chapters') + ' 章', intro: str(i, 'summary')
    };
  }
  function chapters(bookUrl, p) { return API + 'getChapters/' + WECHAT + '/' + bookUrl + '/true/asc?pageSize=200&pageNum=' + p; }
  function parseChapters(q) { return items(q, 'list').map(function (i) { return { title: str(i, 'name'), url: str(i, 'audioUrl') }; }); }

  registerSource({
    id: 'ab0a5474cd6a40e3ba65045addad390a', name: '云图有声', url: 'http://yuntuwechat.yuntuys.com/home',
    description: '推荐指数:5星 ⭐⭐⭐⭐⭐\n正版有声书平台，经典文学、历史、少儿等。',
    multipleEpisodePages: true,

    search: function (keywords, page) {
      var data = this.host.getJson(API + 'search/' + WECHAT + '/' + Shun.enc(keywords) + '?pageSize=20&pageNum=' + page).data;
      return { books: items(data, 'list').map(parseBook), totalPage: Math.max(1, int(data, 'totalPage')) };
    },

    categoryMenus: function () {
      function menu(title, list) {
        return { title: title, tabs: list.map(function (p) { return { title: p[0], url: API + 'getBookListByType/' + WECHAT + '/' + p[1] + '?pageNum=1&pageSize=20' }; }) };
      }
      return [
        menu('特色', [['四史专栏', 585], ['远读重洋', 571], ['听见真知', 124], ['豆瓣高分', 125], ['广播剧', 126], ['影视同期', 127], ['云图学院', 421]]),
        menu('经典文学', [['世界名著', 131], ['中国文学', 132], ['国学经典', 134], ['外国文学', 133], ['诗词散文', 135], ['人物传记', 136]]),
        menu('畅销小说', [['国风古韵', 137], ['青春校园', 138], ['科学幻想', 139], ['官场商战', 140], ['军事谍战', 141], ['悬疑推理', 142], ['现代都市', 143], ['怪奇物语', 144], ['侠义江湖', 335]]),
        menu('职场财经', [['创业学院', 148], ['职场指南', 149], ['商界大咖', 150], ['金融理财', 151]]),
        menu('少儿教育', [['儿童文学', 152], ['童话名著', 153], ['国学启蒙', 154], ['儿歌故事', 155], ['百科知识', 156], ['亲子教育', 157]]),
        menu('文化历史', [['民俗文化', 161], ['世界之窗', 163], ['哲学思想', 164], ['古代历史', 165], ['近现代史', 166], ['世界历史', 167], ['传奇史话', 168]]),
        menu('军事', [['军事纪实', 173], ['战争烽火', 174], ['革命先驱', 176], ['政治领袖', 177]]),
        menu('生活', [['养生保健', 181], ['养颜减肥', 182], ['食疗课堂', 183], ['孕产育儿', 184], ['心理健康', 185], ['婚恋家庭', 186], ['心灵励志', 187], ['生活百科', 188], ['娱乐休闲', 189]])
      ];
    },

    categoryPage: function (url) {
      var data = this.host.getJson(url).data;
      var current = int(data, 'pageNumber', 1);
      var total = Math.max(current, int(data, 'totalPage', 1));
      return {
        books: items(data, 'list').map(parseBook), currentPage: current, totalPage: total,
        nextUrl: current < total ? url.replace(/pageNum=\d+/, 'pageNum=' + (current + 1)) : null
      };
    },

    bookDetail: function (bookUrl, loadEpisodes, loadFullPages) {
      if (!loadEpisodes) return { episodes: [] };
      var host = this.host;
      var query = at(host.getJson(chapters(bookUrl, 1)), 'data.pageQuery');
      var total = int(query, 'totalPage', 1);
      var list = parseChapters(query);
      if (loadFullPages) {
        try {
          for (var p = 2; p <= total; p++) {
            host.progress(p + ' / ' + total);
            list = list.concat(parseChapters(at(host.getJson(chapters(bookUrl, p)), 'data.pageQuery')));
            host.sleep(100 + Math.random() * 300);
          }
        } finally {
          host.progress(null);
        }
      }
      return { episodes: list };
    }
  });
})();

// ---------- 酷我畅听 ----------
(function () {
  var ALBUM_INFO = 'https://search.kuwo.cn/r.s?stype=albuminfo&loginUid=0&loginSid=null&prod=kwplayer_ar_9.1.7.0&bkprod=kwbook_ar_9.1.7.0' +
    '&source=kwplayer_ar_9.1.7.0_t18.apk&bksource=kwbook_ar_9.1.7.0_t18.apk&corp=kuwo&show_copyright_off=1' +
    '&vipver=MUSIC_8.2.0.0_BCS17&mobi=1&sortby=3&iskwbook=1';

  function bookUrl(albumId) { return ALBUM_INFO + '&albumid=' + albumId + '&pn=0&rn=200'; }
  function parseAlbum(item) {
    return {
      coverUrl: str(item, 'coverImg'), bookUrl: bookUrl(str(item, 'albumId')), title: str(item, 'albumName'), artist: str(item, 'artistName'),
      status: '共 ' + int(item, 'songTotal') + ' 章', intro: str(item, 'title')
    };
  }

  registerSource({
    id: '502efedf0613460a9967d9e86ce2b24c', name: '酷我畅听', url: 'https://kuwo.cn/downtingshu',
    description: '推荐指数:5星 ⭐⭐⭐⭐⭐\n酷我音乐的听书频道，部分付费内容只能试听或无法播放。',
    multipleEpisodePages: true,

    search: function (keywords, page) {
      var data = this.host.getJson('http://tingshu.kuwo.cn/tingshu/api/search/Search?rn=10&type=album&version=8.5.6.1&wd=' + Shun.enc(keywords) + '&pn=' + page + '&kweexVersion=1.0.2').data;
      return { books: items(data, 'data').map(parseAlbum), totalPage: Math.max(1, Math.ceil(int(data, 'total') / 10)) };
    },

    categoryMenus: function () {
      function tabs(category, list) {
        return list.map(function (p) {
          return { title: p[0], url: 'http://tingshu.kuwo.cn/tingshu/api/filter/albums?sortType=tsScore&classifyId=' + p[1] + '&rn=20&categoryId=' + category + '&pn=1&kweexVersion=1.0.2' };
        });
      }
      return [
        { title: '小说', tabs: [{ title: '免费排行', url: 'http://tingshu.kuwo.cn/tingshu/api/page/boutique/getBoutiqueData?pt=2&rn=100&version=8.5.6.1&pn=1&kweexVersion=1.0.2' }]
          .concat(tabs(2, [['都市传说', 42], ['玄幻奇幻', 44], ['悬疑推理', 45], ['现代言情', 41], ['武侠仙侠', 48], ['穿越架空', 52],
            ['经典小说', 64], ['青春校园', 55], ['历史军事', 56], ['科幻竞技', 57], ['古代言情', 207]])) },
        { title: '成长', tabs: tabs(4, [['能力提升', 82], ['人文艺术', 77], ['国学文化', 78], ['成功法则', 79], ['外语精通', 76], ['养生健康', 81], ['酷我读书', 211]]) },
        { title: '人文历史', tabs: tabs(9, [['国学经典', 117], ['历史小说', 181], ['纪实档案', 118], ['历史传奇', 119], ['人物传奇', 120], ['文化讲堂', 121], ['百家讲坛', 212]]) }
      ];
    },

    categoryPage: function (url) {
      var page = regexInt(url, /pn=(\d+)/);
      var data = this.host.getJson(url).data;
      var total, books;
      if (data && Array.isArray(data.topDatas)) {
        total = Math.ceil(int(data, 'pageInfo.total') / 100);
        books = items(data, 'topDatas').map(function (t) { return t.albums; }).filter(function (a) { return a; }).map(function (a) {
          return { coverUrl: str(a, 'img'), bookUrl: bookUrl(str(a, 'albumId')), title: str(a, 'name'), status: '共 ' + int(a, 'songTotal') + ' 章', intro: str(a, 'title') };
        });
      } else {
        total = Math.ceil(int(data, 'total') / 20);
        books = items(data, 'data').map(parseAlbum);
      }
      return { books: books, currentPage: page, totalPage: Math.max(total, page), nextUrl: page < total ? url.replace(/pn=\d+/, 'pn=' + (page + 1)) : null };
    },

    bookDetail: function (url, loadEpisodes, loadFullPages) {
      var list = [];
      if (!loadEpisodes) return { episodes: list };
      var host = this.host;
      var albumId = (/albumid=(\d+)/.exec(url) || [])[1] || '';
      try {
        for (var page = 0; page < 100; page++) {
          var tracks = items(host.getJson(ALBUM_INFO + '&albumid=' + albumId + '&pn=' + page + '&rn=200'), 'musiclist');
          if (tracks.length === 0) break;
          tracks.forEach(function (i) { list.push({ title: str(i, 'name'), url: 'kuwo:' + str(i, 'musicrid') }); });
          if (!loadFullPages || tracks.length < 200) break;
          host.progress('第 ' + (page + 2) + ' 页');
          host.sleep(200 + Math.random() * 400);
        }
      } finally {
        host.progress(null);
      }
      return { episodes: list };
    },

    audio: function (url) {
      var rid = url.replace('kuwo:', '').replace('MUSIC_', '');
      var json = this.host.getJson('https://mobi.kuwo.cn/mobi.s?f=web&source=kwplayercar_ar_6.0.0.9_B_jiakong_vh.apk&from=PC&type=convert_url_with_sign&br=128kmp3&rid=' + rid, { desktop: true });
      var audio = str(json, 'data.url');
      if (!audio) throw new Error('没有获取到播放地址（可能是付费内容）');
      return audio;
    }
  });
})();

// ---------- 懒人听书 m.lrts.me：JSON 接口、分页章节、免费章节走接口，付费章节走 WebView 嗅探（需要登录） ----------
(function () {
  var EPISODE_PAGE_SIZE = 50; // 接口目前最多支持 50
  var CATEGORY_PAGE_SIZE = 20;
  var categoryBookIds = {}; // 分类第一页会返回该分类下全部书籍 ID，后续页按 ID 列表请求

  function parseBook(node) {
    var cover = str(node, 'cover');
    if (cover.length > 0 && cover.indexOf('180') < 0) {
      var dot = cover.lastIndexOf('.');
      if (dot > 0) cover = cover.substring(0, dot) + '_180x254' + cover.substring(dot);
    }
    var title = str(node, 'name');
    var tags = str(node, 'tags');
    if (tags.indexOf('VIP') >= 0) title = '[VIP] ' + title;
    else if (tags.indexOf('精品') >= 0) title = '[精品] ' + title;
    var finished = int(node, 'state') === 2;
    var sections = int(node, 'sections');
    var intro = str(node, 'recReason');
    if (intro.length === 0 || intro === 'null') intro = str(node, 'desc');
    return {
      coverUrl: cover, bookUrl: 'https://m.lrts.me?' + str(node, 'id'), title: title, author: str(node, 'author'), artist: str(node, 'announcer'),
      intro: intro, status: (finished ? '完本' : '连载') + (sections > 0 ? ' · ' + sections + ' 集' : '')
    };
  }

  function parseQuery(url) {
    var q = {}, i = url.indexOf('?');
    if (i < 0) return q;
    url.substring(i + 1).split('&').forEach(function (p) {
      var k = p.split('=')[0];
      if (k && !(k in q)) q[k] = decodeURIComponent(p.substring(k.length + 1));
    });
    return q;
  }

  function getMenu(host, bookId, page) {
    var json = host.getJson('https://m.lrts.me/ajax/getBookMenu?bookId=' + bookId + '&pageNum=' + page + '&pageSize=' + EPISODE_PAGE_SIZE + '&sortType=0');
    // 出错时返回 {"status":"n1006","msg":"服务器繁忙"}
    if (!json.list && str(json, 'msg')) throw new Error(str(json, 'msg'));
    return json;
  }

  function parseEpisodes(json, bookId, offset) {
    return items(json, 'list').map(function (track, i) {
      var isFree = int(track, 'payType') === 0;
      return {
        title: str(track, 'name'), isFree: isFree,
        url: isFree
          ? 'https://m.lrts.me/ajax/getPlayPath?entityId=' + bookId + '&entityType=3&opType=1&sections=[' + int(track, 'section') + ']&type=0'
          : 'https://m.lrts.me/player?index=' + (offset + i) + '&entityType=3&sonId=' + str(track, 'id') + '&id=' + bookId
      };
    });
  }

  registerSource({
    id: '4a3ed84e5cf841609ed4d7f790fc7fbf', name: '懒人听书', url: 'https://m.lrts.me',
    description: '正版源，免费书籍较少。带 [VIP] / [精品] 的书需要登录对应账号后才能收听。',
    multipleEpisodePages: true,
    loginUrl: 'https://m.lrts.me/user',

    search: function (keywords, page) {
      var result = at(this.host.getJson('https://m.lrts.me/ajax/search?keyWord=' + Shun.enc(keywords) + '&pageSize=40&pageNum=' + page + '&searchOption=1'), 'data.bookResult');
      return { books: items(result, 'list').map(parseBook), totalPage: Math.max(Math.ceil(int(result, 'count') / 40), 1) };
    },

    categoryMenus: function () {
      function menu(title, list) {
        return { title: title, tabs: list.map(function (p) {
          return { title: p[0], url: 'https://m.lrts.me/ajax/getResourceList?dsize=' + CATEGORY_PAGE_SIZE + '&entityId=' + p[1] + '&entityType=1&pageNum=1&showFilters=1' };
        }) };
      }
      return [
        menu('有声小说', [['玄幻奇幻', 11], ['都市传说', 8], ['穿越架空', 3109], ['武侠仙侠', 14], ['青春校园', 3106],
          ['历史幻想', 12], ['科幻空间', 3021], ['网游竞技', 9042], ['热血军事', 9041], ['官场商战', 44]]),
        menu('人文', [['心理百科', 9045], ['科学科普', 9046], ['人物传记', 17], ['纪实传奇', 3063], ['哲学宗教', 1026], ['文艺文化', 9044], ['公开课', 109]]),
        menu('财经', [['投资理财', 3059], ['股市', 3058], ['商业智慧', 3057], ['管理营销', 16], ['创业', 9048]]),
        menu('儿童', [['益智故事', 63], ['儿童文学', 3027], ['国学启蒙', 9031], ['卡通动画', 9029], ['少儿名著', 9245], ['少儿科普', 64], ['少儿英语', 68]]),
        menu('曲艺戏曲', [['戏曲名家', 9060], ['豫剧', 95], ['京剧', 89], ['黄梅戏', 93], ['越剧', 90], ['鼓书琴书', 67]])
      ];
    },

    categoryPage: function (url) {
      var query = parseQuery(url);
      var entityId = query.entityId || '';
      var json = this.host.getJson(url);
      var useAlbums = int(json, 'albumCount') > 0;
      var books = items(json, useAlbums ? 'albums' : 'books').map(parseBook);
      var currentPage;
      if (!('bookIds' in query)) {
        currentPage = 1;
        categoryBookIds[entityId] = items(json, useAlbums ? 'albumIds' : 'bookIds');
      } else {
        currentPage = parseInt(query.page, 10) || 2;
      }
      var nextUrl = null, ids = categoryBookIds[entityId];
      if (ids) {
        var from = currentPage * CATEGORY_PAGE_SIZE;
        if (from < ids.length) {
          nextUrl = 'https://m.lrts.me/ajax/getResourceList?dsize=' + CATEGORY_PAGE_SIZE + '&entityId=' + entityId + '&entityType=0&pageNum=0&showFilters=0' +
            '&page=' + (currentPage + 1) + '&bookIds=[' + ids.slice(from, from + CATEGORY_PAGE_SIZE).join(',') + ']';
        }
      }
      return { books: books, currentPage: currentPage, totalPage: nextUrl ? currentPage + 1 : currentPage, nextUrl: nextUrl };
    },

    bookDetail: function (bookUrl, loadEpisodes, loadFullPages) {
      var host = this.host;
      var bookId = bookUrl.split('?').pop();
      var episodes = [];
      if (loadEpisodes) {
        var first = getMenu(host, bookId, 1);
        var pageCount = Math.ceil(int(first, 'sections') / EPISODE_PAGE_SIZE);
        episodes = parseEpisodes(first, bookId, 0);
        if (loadFullPages) {
          try {
            for (var page = 2; page <= pageCount; page++) {
              host.progress(page + ' / ' + pageCount);
              episodes = episodes.concat(parseEpisodes(getMenu(host, bookId, page), bookId, episodes.length));
              host.sleep(100 + Math.random() * 300);
            }
          } finally {
            host.progress(null);
          }
        }
      }
      var info = host.getJson('https://m.lrts.me/ajax/getBookInfo?id=' + bookId);
      return { episodes: episodes, intro: str(info, 'extraInfos.0.content'), artist: str(info, 'announcer'), author: str(info, 'author'), coverUrl: str(info, 'bestCover') };
    },

    audio: function (url) {
      if (url.indexOf('getPlayPath') >= 0) {
        var json = this.host.getJson(url);
        var path = str(json, 'list.0.path');
        if (!path) throw new Error(str(json, 'msg') || '无法获取音频地址');
        return path;
      }
      // 付费章节：打开播放页嗅探（需要先在插件页面登录）
      return this.host.sniff(url);
    }
  });
})();

// ---------- 听友听书（tingyou.fm）：网站自己的 JSON 接口 ----------
(function () {
  var SITE = 'https://tingyou.fm';
  // 接口的域名网站会换：先用上次能用的，再挨个试已知的，都不行就到网站首页里找现在用的是哪个
  var BASES = ['https://api-preview.toulaopao.cc/api', 'https://appp.fdhtbz.cn/api', 'https://laopaoaappi.oobyvy.vip/api'];
  var working = null;
  var session = null;   // 网站每次打开生成一个会话标识，这里照做
  var filters = null;   // 分类筛选项，取一次就够

  // 接口只认从网站页面发出的请求（看 Origin）
  function options(host, body) {
    if (!session) session = host.uuid();
    var o = { headers: { Origin: SITE, Referer: SITE + '/', Accept: 'application/json', 'x-listening-session': session, 'x-listening-timezone': 'Asia/Shanghai' } };
    if (body !== undefined) { o.method = 'POST'; o.body = JSON.stringify(body); o.contentType = 'application/json'; }
    return o;
  }

  function discover(host) {
    try {
      var m = /https:\/\/[a-z0-9.-]+\/api(?=["\\/])/i.exec(host.getString(SITE + '/listening'));
      return m ? m[0] : null;
    } catch (e) { return null; }
  }

  // 请求接口并解析成 JSON。allowEmpty：翻到最后一页以后接口返回空内容，不算出错
  function call(host, path, body, allowEmpty) {
    var tried = {}, last = null;
    var list = [working || host.getPref('base')].concat(BASES);
    for (var i = 0; i <= list.length; i++) {
      var base = i < list.length ? list[i] : discover(host);
      if (!base || tried[base]) continue;
      tried[base] = true;
      try {
        var text = host.getString(base + '/h5/listening/' + path, options(host, body));
        if (!text.trim() && allowEmpty) return {};
        var json = parseJson(text);
        if (json && json.error) throw new Error(str(json, 'message') || '接口返回错误');
        if (working !== base) { working = base; host.setPref('base', base); }
        return json;
      } catch (e) {
        if (e.cancelled) throw e;
        last = e;
      }
    }
    throw new Error('听友听书的接口现在访问不了：' + (last ? last.message : '没有可用的地址'));
  }

  function albumId(url) {
    var m = /album\/(\d+)/.exec(url);
    if (!m) throw new Error('不认识的地址：' + url);
    return m[1];
  }

  function toBook(a) {
    var count = int(a, 'count');
    return {
      coverUrl: str(a, 'cover_url'), bookUrl: SITE + '/listening/album/' + str(a, 'id'), title: str(a, 'title').trim(),
      author: str(a, 'author'), artist: str(a, 'teller'), intro: str(a, 'intro') || str(a, 'description') || str(a, 'synopsis'),
      status: (int(a, 'status') === 0 ? '已完结' : '连载中') + (count > 0 ? ' · ' + count + ' 集' : '')
    };
  }

  var SORTS = { '综合排序': 'comprehensive', '播放最多': 'popular', '最近更新': 'updated', '最新发布': 'new' };

  registerSource({
    id: 'a6d1c3f08b2e4759b8e0f4a27c915d36', name: '听友听书', url: SITE + '/listening',
    description: '有声小说和评书比较全，更新快。直接用网站的接口，不需要登录。',
    config: [{ type: 'select', key: 'sort', label: '分类里的排序', default: '播放最多', options: ['综合排序', '播放最多', '最近更新', '最新发布'] }],

    search: function (keywords, page) {
      var json = call(this.host, 'search', { keyword: keywords, page: page });
      var books = items(json, 'results').map(toBook);
      // 接口只说“后面还有没有”，没有总页数：有就再翻一页
      return { books: books, totalPage: json.has_more && books.length > 0 ? page + 1 : page };
    },

    categoryMenus: function () {
      var menus = [{ title: '推荐', tabs: [['最新', 'latest'], ['热门', 'hot'], ['推荐', 'recommend'], ['连载', 'serial']].map(function (t) {
        return { title: t[0], url: 'tingyou:rank:' + t[1] + '#1' };
      }) }];
      if (!filters) filters = call(this.host, 'filters');
      items(filters, 'categories').forEach(function (c) {
        var tabs = [{ title: '全部', url: 'tingyou:cat:category=' + str(c, 'id') + '#1' }].concat(items(c, 'types').map(function (t) {
          return { title: str(t, 'name'), url: 'tingyou:cat:type=' + str(t, 'id') + '#1' };
        }));
        menus.push({ title: str(c, 'name'), tabs: tabs });
      });
      return menus;
    },

    categoryPage: function (url) {
      var m = /^tingyou:(rank|cat):([^#]+)#(\d+)$/.exec(url);
      if (!m) throw new Error('不认识的分类地址：' + url);
      var page = parseInt(m[3], 10), next = 'tingyou:' + m[1] + ':' + m[2] + '#' + (page + 1), books, total;
      if (m[1] === 'rank') {
        var r = call(this.host, 'rank?section=' + m[2] + '&page=' + page, undefined, true);
        books = items(r, 'items').map(toBook);
        var size = int(r, 'page_size', 30) || 30;
        total = r.has_more ? Math.max(page + 1, Math.ceil(int(r, 'total') / size)) : page;
      } else {
        var sort = SORTS[this.host.getPref('sort', '播放最多')] || 'popular';
        var c = call(this.host, 'category?sort=' + sort + '&' + m[2] + '&page=' + page, undefined, true);
        books = items(c, 'data').map(toBook);
        total = Math.max(page, int(c, 'pages', page));
      }
      if (books.length === 0) total = page;
      return { books: books, currentPage: page, totalPage: total, nextUrl: page < total ? next : null };
    },

    bookDetail: function (bookUrl, loadEpisodes) {
      var id = albumId(bookUrl);
      var a = call(this.host, 'album/' + id);
      if (a.available === false) throw new Error('这本书已经下架了');
      var detail = toBook(a);
      detail.episodes = [];
      if (loadEpisodes) {
        var c = call(this.host, 'chapters/' + id);
        // 章节地址里记下“第几集”，取播放地址时要用
        detail.episodes = items(c, 'chapters').map(function (ch) {
          return { title: str(ch, 'title').trim() || ('第 ' + int(ch, 'index') + ' 集'), url: SITE + '/listening/album/' + id + '#' + int(ch, 'index') };
        });
      }
      return detail;
    },

    // 播放地址带时效和签名，每次现取
    audio: function (url) {
      var m = /album\/(\d+)#(\d+)$/.exec(url);
      if (!m) throw new Error('不认识的章节地址：' + url);
      var json = call(this.host, 'play', { album_id: m[1], chapter_idx: parseInt(m[2], 10) });
      var play = str(json, 'play_url');
      if (!play) throw new Error(str(json, 'detail') || str(json, 'message') || '没有拿到播放地址');
      return play;
    }
  });
})();

// ---------- 蜻蜓FM（qtfm.cn）：网站自己的接口，音频地址要带签名 ----------
(function () {
  var SITE = 'https://www.qtfm.cn';
  var CAPI = 'https://i.qtfm.cn/capi/';
  var PAGE = 100; // 节目列表一页最多给 100 条

  // --- HMAC-MD5（音频地址的签名用）。按字节算，不能用宿主的 md5（那个是按文本算的） ---
  function md5(bytes) {
    function add(x, y) { var l = (x & 0xFFFF) + (y & 0xFFFF); return (((x >> 16) + (y >> 16) + (l >> 16)) << 16) | (l & 0xFFFF); }
    function rol(n, c) { return (n << c) | (n >>> (32 - c)); }
    function cmn(q, a, b, x, s, t) { return add(rol(add(add(a, q), add(x, t)), s), b); }
    function ff(a, b, c, d, x, s, t) { return cmn((b & c) | (~b & d), a, b, x, s, t); }
    function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & ~d), a, b, x, s, t); }
    function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
    function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | ~d), a, b, x, s, t); }
    var n = bytes.length, words = [], i;
    for (i = 0; i < n; i++) words[i >> 2] |= bytes[i] << ((i % 4) * 8);
    words[n >> 2] |= 0x80 << ((n % 4) * 8);
    words[(((n + 8) >> 6) << 4) + 14] = n * 8;
    var a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
    for (i = 0; i < words.length; i += 16) {
      var x = [], k; for (k = 0; k < 16; k++) x[k] = words[i + k] | 0;
      var oa = a, ob = b, oc = c, od = d;
      a = ff(a, b, c, d, x[0], 7, -680876936); d = ff(d, a, b, c, x[1], 12, -389564586); c = ff(c, d, a, b, x[2], 17, 606105819); b = ff(b, c, d, a, x[3], 22, -1044525330);
      a = ff(a, b, c, d, x[4], 7, -176418897); d = ff(d, a, b, c, x[5], 12, 1200080426); c = ff(c, d, a, b, x[6], 17, -1473231341); b = ff(b, c, d, a, x[7], 22, -45705983);
      a = ff(a, b, c, d, x[8], 7, 1770035416); d = ff(d, a, b, c, x[9], 12, -1958414417); c = ff(c, d, a, b, x[10], 17, -42063); b = ff(b, c, d, a, x[11], 22, -1990404162);
      a = ff(a, b, c, d, x[12], 7, 1804603682); d = ff(d, a, b, c, x[13], 12, -40341101); c = ff(c, d, a, b, x[14], 17, -1502002290); b = ff(b, c, d, a, x[15], 22, 1236535329);
      a = gg(a, b, c, d, x[1], 5, -165796510); d = gg(d, a, b, c, x[6], 9, -1069501632); c = gg(c, d, a, b, x[11], 14, 643717713); b = gg(b, c, d, a, x[0], 20, -373897302);
      a = gg(a, b, c, d, x[5], 5, -701558691); d = gg(d, a, b, c, x[10], 9, 38016083); c = gg(c, d, a, b, x[15], 14, -660478335); b = gg(b, c, d, a, x[4], 20, -405537848);
      a = gg(a, b, c, d, x[9], 5, 568446438); d = gg(d, a, b, c, x[14], 9, -1019803690); c = gg(c, d, a, b, x[3], 14, -187363961); b = gg(b, c, d, a, x[8], 20, 1163531501);
      a = gg(a, b, c, d, x[13], 5, -1444681467); d = gg(d, a, b, c, x[2], 9, -51403784); c = gg(c, d, a, b, x[7], 14, 1735328473); b = gg(b, c, d, a, x[12], 20, -1926607734);
      a = hh(a, b, c, d, x[5], 4, -378558); d = hh(d, a, b, c, x[8], 11, -2022574463); c = hh(c, d, a, b, x[11], 16, 1839030562); b = hh(b, c, d, a, x[14], 23, -35309556);
      a = hh(a, b, c, d, x[1], 4, -1530992060); d = hh(d, a, b, c, x[4], 11, 1272893353); c = hh(c, d, a, b, x[7], 16, -155497632); b = hh(b, c, d, a, x[10], 23, -1094730640);
      a = hh(a, b, c, d, x[13], 4, 681279174); d = hh(d, a, b, c, x[0], 11, -358537222); c = hh(c, d, a, b, x[3], 16, -722521979); b = hh(b, c, d, a, x[6], 23, 76029189);
      a = hh(a, b, c, d, x[9], 4, -640364487); d = hh(d, a, b, c, x[12], 11, -421815835); c = hh(c, d, a, b, x[15], 16, 530742520); b = hh(b, c, d, a, x[2], 23, -995338651);
      a = ii(a, b, c, d, x[0], 6, -198630844); d = ii(d, a, b, c, x[7], 10, 1126891415); c = ii(c, d, a, b, x[14], 15, -1416354905); b = ii(b, c, d, a, x[5], 21, -57434055);
      a = ii(a, b, c, d, x[12], 6, 1700485571); d = ii(d, a, b, c, x[3], 10, -1894986606); c = ii(c, d, a, b, x[10], 15, -1051523); b = ii(b, c, d, a, x[1], 21, -2054922799);
      a = ii(a, b, c, d, x[8], 6, 1873313359); d = ii(d, a, b, c, x[15], 10, -30611744); c = ii(c, d, a, b, x[6], 15, -1560198380); b = ii(b, c, d, a, x[13], 21, 1309151649);
      a = ii(a, b, c, d, x[4], 6, -145523070); d = ii(d, a, b, c, x[11], 10, -1120210379); c = ii(c, d, a, b, x[2], 15, 718787259); b = ii(b, c, d, a, x[9], 21, -343485551);
      a = add(a, oa); b = add(b, ob); c = add(c, oc); d = add(d, od);
    }
    var out = [];
    [a, b, c, d].forEach(function (w) { for (var j = 0; j < 4; j++) out.push((w >> (j * 8)) & 0xFF); });
    return out;
  }
  function ascii(s) { var r = []; for (var i = 0; i < s.length; i++) r.push(s.charCodeAt(i) & 0xFF); return r; }
  function hmacMd5Hex(key, message) {
    var k = ascii(key), i;
    if (k.length > 64) k = md5(k);
    while (k.length < 64) k.push(0);
    var inner = [], outer = [];
    for (i = 0; i < 64; i++) { inner.push(k[i] ^ 0x36); outer.push(k[i] ^ 0x5C); }
    return md5(outer.concat(md5(inner.concat(ascii(message))))).map(function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('');
  }

  // --- 登录 ---
  // 用蜻蜓手机版的登录页。登录后网站把身份信息写在 Cookie 里（.qtfm.cn 整个域名下都能读到）：
  // qingting_id 是用户编号，access_token 是访问令牌，refresh_token 用来换新令牌。
  // Cookie 只留三天，所以读到以后记到源的设置里；令牌失效了用 refresh_token 换新的。
  var LOGIN = 'https://sss.qtfm.cn/account/mobile/login.html?wx=0&qq=0&wb=0&redirect_uri=' + encodeURIComponent('https://m.qtfm.cn/');

  function cookieValues(host) {
    var o = {};
    String(host.cookies('https://m.qtfm.cn/') || '').split(';').forEach(function (p) {
      var i = p.indexOf('=');
      if (i > 0) { try { o[p.substring(0, i).trim()] = decodeURIComponent(p.substring(i + 1).trim()); } catch (e) { o[p.substring(0, i).trim()] = p.substring(i + 1).trim(); } }
    });
    return o;
  }

  function saved(host) {
    return { uat: host.getPref('uat', ''), refresh: host.getPref('refresh', ''), access: host.getPref('access', ''), seen: host.getPref('seen', '') };
  }
  function save(host, s) {
    host.setPref('uat', s.uat || null); host.setPref('refresh', s.refresh || null);
    host.setPref('access', s.access || null); host.setPref('seen', s.seen || null);
  }

  // 现在的登录信息；没登录返回 null。Cookie 里的令牌和上次见到的不一样，说明刚（重新）登录过，以 Cookie 为准
  function login(host) {
    var s = saved(host), c = cookieValues(host);
    if (c.qingting_id && c.access_token && c.access_token !== s.seen) {
      s = { uat: c.qingting_id, access: c.access_token, refresh: c.refresh_token || '', seen: c.access_token };
      save(host, s);
    }
    return s.uat && (s.access || s.refresh) ? s : null;
  }

  // 用 refresh_token 换一个新的访问令牌；换不了返回 false
  function renew(host, s) {
    if (!s.refresh) return false;
    try {
      var r = host.fetch('https://user.qtfm.cn/u2/api/v4/auth', {
        desktop: true, method: 'POST', contentType: 'application/json',
        body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: s.refresh, qingting_id: s.uat, device_id: 'web' })
      });
      var json = parseJson(r.body), data = at(json, 'data');
      if (!data || !str(data, 'access_token')) {
        // 服务器明确说换不了（refresh_token 不存在或已作废）：登录已经失效，把记着的登录信息清掉，免得每次播放都白试一次
        if (int(json, 'errorno') !== 0) save(host, {});
        return false;
      }
      s.access = str(data, 'access_token');
      if (str(data, 'refresh_token')) s.refresh = str(data, 'refresh_token');
      save(host, s);
      return true;
    } catch (e) { if (e.cancelled) throw e; return false; }
  }

  function api(host, url) {
    var json = host.getJson(url, { desktop: true, headers: { Referer: SITE + '/' } });
    var code = str(json, 'errorno') || str(json, 'errcode');
    if (code && code !== '0') throw new Error('蜻蜓FM 接口返回错误：' + (str(json, 'errormsg') || str(json, 'errmsg')) + '（' + code + '）');
    return json;
  }

  function https(u) { return u.replace(/^http:\/\//, 'https://'); }
  function channelId(url) {
    var m = /channels\/(\d+)/.exec(url);
    if (!m) throw new Error('不认识的地址：' + url);
    return m[1];
  }

  function toBook(c) {
    var play = str(c, 'playcount');
    return {
      coverUrl: https(str(c, 'cover')), bookUrl: SITE + '/channels/' + str(c, 'id') + '/', title: str(c, 'title').trim(),
      artist: str(c, 'podcaster'), intro: str(c, 'description'), status: play ? '播放 ' + play : ''
    };
  }

  // paid：这张专辑是不是收费的。免费专辑的节目全都能听，接口里也不带 isfree 这个字段；
  // 收费专辑里只有试听的那几集带 isfree=true，其余的要购买或开会员
  function toEpisodes(cid, json, paid) {
    return items(json, 'data.programs').map(function (p) {
      return { title: str(p, 'title').trim(), url: SITE + '/channels/' + cid + '/programs/' + str(p, 'id') + '/', isFree: !paid || p.isfree === true };
    });
  }

  registerSource({
    id: 'b7e3a9c15d0f4b62a8c4e17f3d9b0a68', name: '蜻蜓FM', url: SITE + '/',
    description: '小说、评书、相声、广播剧、历史人文都有。免费专辑可以直接听；收费专辑只有前面试听的几集能听，其余带锁的要在蜻蜓购买或开会员——在插件页面点“登录”，用自己的蜻蜓账号（手机号）登录后就能听已购买的内容。章节很多的书加载要一点时间。',
    multipleEpisodePages: true,
    loginUrl: LOGIN,
    loginDesktop: false,

    // 登录页关掉后宿主会来问：登录了返回昵称，没登录抛出错误
    checkLogin: function () {
      var s = login(this.host);
      if (!s) throw new Error('还没有登录蜻蜓FM');
      try { return str(api(this.host, 'https://user.qtfm.cn/u2/api/v4/user/' + s.uat), 'data.nick_name'); } catch (e) { if (e.cancelled) throw e; return ''; }
    },

    search: function (keywords, page) {
      var json = api(this.host, 'https://search.qtfm.cn/v3/search?categoryid=0&k=' + Shun.enc(keywords) + '&page=' + page + '&pagesize=20&include=channel_ondemand');
      var found = int(json, 'data.data.numFound');
      return { books: items(json, 'data.data.docs').map(toBook), totalPage: Math.max(1, Math.min(50, Math.ceil(found / 20))) };
    },

    categoryMenus: function () {
      function tabs(list) { return list.map(function (c) { return { title: c[0], url: 'qtfm:' + c[1] + ':' + (c[2] || 0) + '#1' }; }); }
      return [
        { title: '听书', tabs: tabs([['小说', 521], ['男生爱听', 521, 3289], ['女生爱听', 521, 3290], ['多人有声剧', 521, 5544], ['评书', 3496], ['相声小品', 527],
          ['广播剧', 3442], ['出版精品', 3636], ['儿童', 1599], ['戏曲', 3276], ['二次元', 3427]]) },
        { title: '知识', tabs: tabs([['历史', 531], ['文化', 3613], ['情感', 529], ['脱口秀', 3251], ['播客', 3873], ['头条', 545], ['财经', 533], ['科技', 535],
          ['教育', 537], ['外语', 543], ['音乐', 523], ['娱乐', 547], ['生活', 3670], ['汽车', 3385], ['校园', 1737], ['母婴', 3675]]) }
      ];
    },

    // 分类地址：qtfm:分类:筛选项#页码，一页 12 本
    categoryPage: function (url) {
      var m = /^qtfm:(\d+):(\d+)#(\d+)$/.exec(url);
      if (!m) throw new Error('不认识的分类地址：' + url);
      var page = parseInt(m[3], 10);
      var json = api(this.host, CAPI + 'neo-channel-filter?category=' + m[1] + '&attrs=' + m[2] + '&curpage=' + page);
      var books = items(json, 'data.channels').map(toBook);
      var total = books.length === 0 ? page : Math.max(page, Math.ceil(int(json, 'total') / 12));
      return { books: books, currentPage: page, totalPage: total, nextUrl: page < total ? 'qtfm:' + m[1] + ':' + m[2] + '#' + (page + 1) : null };
    },

    bookDetail: function (bookUrl, loadEpisodes, loadFullPages) {
      var host = this.host, cid = channelId(bookUrl);
      var c = at(api(host, CAPI + 'v3/channel/' + cid), 'data') || {};
      var count = int(c, 'program_count');
      var detail = {
        title: str(c, 'title').trim(), coverUrl: https(str(c, 'cover')), intro: str(c, 'description'),
        artist: items(c, 'podcasters').map(function (p) { return str(p, 'nick_name'); }).filter(function (n) { return n; }).join('、'),
        status: (str(c, 'finished') === '1' ? '已完结' : '连载中') + (count > 0 ? ' · ' + count + ' 集' : ''), episodes: []
      };
      if (!loadEpisodes) return detail;
      // 节目列表的地址里要带专辑的“版本号”
      var base = CAPI + 'channel/' + cid + '/programs/' + str(c, 'v') + '?pagesize=' + PAGE + '&order=asc&curpage=';
      // 专辑信息里 purchase.item_type 不是 0 的才是收费专辑
      var paid = int(c, 'purchase.item_type') !== 0;
      var first = api(host, base + 1);
      detail.episodes = toEpisodes(cid, first, paid);
      var pages = Math.ceil(int(first, 'data.total') / PAGE);
      if (loadFullPages && pages > 1) {
        var urls = [];
        for (var p = 2; p <= pages; p++) urls.push(base + p);
        var done = 0;
        // 一批 6 页同时取，每取完一批报一次进度
        for (var i = 0; i < urls.length; i += 6) {
          var batch = urls.slice(i, i + 6);
          host.getStrings(batch, { desktop: true, headers: { Referer: SITE + '/' } }, 6).forEach(function (text, k) {
            if (text === null) throw new Error('第 ' + (i + k + 2) + ' 页章节加载失败，请重试');
            detail.episodes = detail.episodes.concat(toEpisodes(cid, parseJson(text), paid));
          });
          done += batch.length;
          host.progress((done + 1) + ' / ' + pages);
        }
        host.progress(null);
      }
      return detail;
    },

    // 音频地址：路径 + 登录信息 + 时间，用固定的密钥做 HMAC-MD5 签名（和电脑版网页一样）；访问后会跳转到真正的文件。
    // 没登录时登录信息留空，只能取到免费的和试听的
    audio: function (url) {
      var host = this.host, m = /channels\/(\d+)\/programs\/(\d+)/.exec(url);
      if (!m) throw new Error('不认识的章节地址：' + url);
      function signed(s) {
        var path = '/audiostream/redirect/' + m[1] + '/' + m[2] + '?access_token=' + (s ? encodeURIComponent(s.access) : '') +
          '&device_id=MOBILESITE&qingting_id=' + (s ? encodeURIComponent(s.uat) : '') + '&t=' + new Date().getTime();
        return 'https://audio.qtfm.cn' + path + '&sign=' + hmacMd5Hex('7l8CZ)SgZgM_bkrw', path);
      }
      var s = login(host);
      if (!s) return signed(null);
      // 带着登录信息时，令牌要是已经失效，连免费的节目服务器也会拒绝（401）。所以先问一下：
      // 被拒绝就换一个新令牌再试；还不行就把令牌作废，这一次按没登录的方式取
      function rejected(link) {
        try { return host.status(link, { desktop: true, headers: { Range: 'bytes=0-1' } }) === 401; } catch (e) { if (e.cancelled) throw e; return false; }
      }
      var link = s.access ? signed(s) : '';
      if (link && !rejected(link)) return link;
      if (renew(host, s)) {
        link = signed(s);
        if (!rejected(link)) return link;
      }
      host.setPref('access', null);
      return signed(null);
    }
  });
})();

// ---------- 书音FM（m.mekui.com）：网站自己的 JSON 接口 ----------
(function () {
  var SITE = 'https://m.mekui.com';
  var API = SITE + '/ecmsapi/index.php?';
  var KEY = '056a308c515e16b2fe5a5c631319339cbc60a8ee0e03d016'; // 取播放地址时签名用的固定密钥（网页脚本里写着）
  var CHAPTERS = 500; // 章节列表一页取多少
  var menus = null;

  function options() { return { headers: { Referer: SITE + '/', Accept: 'application/json, text/plain, */*' } }; }

  function call(host, query) {
    var json = host.getJson(API + query, options());
    if (int(json, 'code') !== 1) throw new Error('书音FM：' + (str(json, 'message') || str(json, 'msg') || '接口返回错误'));
    return json;
  }

  function toBook(b) {
    return {
      coverUrl: str(b, 'titlepic'), bookUrl: SITE + '/album-' + str(b, 'classid') + '-' + str(b, 'id') + '.html', title: str(b, 'title').trim(),
      artist: str(b, 'player'), intro: str(b, 'moviesay'), status: str(b, 'filetype')
    };
  }

  function ids(url) {
    var m = /(?:album|audio)[-\/](\d+)-(\d+)(?:-(\d+))?\.html/.exec(url);
    if (!m) throw new Error('不认识的地址：' + url);
    return { classId: m[1], id: m[2], no: m[3] };
  }

  function toEpisodes(k, json) {
    return items(json, 'data.moielist').map(function (e) {
      // control / level / ofen 不为 0 的是要登录、会员或积分才能听的
      var free = str(e, 'control') === '0' && str(e, 'level') === '0' && str(e, 'ofen') === '0';
      return { title: str(e, 'title').trim() || ('第 ' + str(e, 'id') + ' 集'), url: SITE + '/audio/' + k.classId + '-' + k.id + '-' + str(e, 'id') + '.html', isFree: free };
    });
  }

  var SORTS = { '热播': 'onclick+desc', '最新': 'newstime+desc', '热评': 'plnum+desc' };

  registerSource({
    id: 'e8c2a5d47f1b4936b0d7a3c9e6f41b05', name: '书音FM', url: SITE + '/',
    description: '有声小说、广播剧、评书、百家讲坛、相声小品、戏曲、儿童等，内容很全，分类细。直接用网站的接口，不需要登录。',
    multipleEpisodePages: true,
    config: [{ type: 'select', key: 'sort', label: '分类里的排序', default: '热播', options: ['热播', '最新', '热评'] }],

    search: function (keywords, page) {
      var json = call(this.host, 'act=search&mod=movie&keyword=' + Shun.enc(keywords) + '&page=' + page + '&pagesize=20');
      return { books: items(json, 'data.list').map(toBook), totalPage: Math.max(page, int(json, 'data.totalpage', page)) };
    },

    // 大类各是一组，里面是“全部”和它的小类。大类和小类都问接口要，一次把各大类的小类一起取回来
    categoryMenus: function () {
      if (menus) return menus;
      var host = this.host;
      var top = items(call(host, 'classid=0&act=navigation&mod=column'), 'list');
      var texts = host.getStrings(top.map(function (c) { return API + 'classid=' + str(c, 'classid') + '&act=navigation&mod=column'; }), options(), 6);
      var result = top.map(function (c, i) {
        var tabs = [{ title: '全部', url: 'mekui:' + str(c, 'classid') + '#1' }];
        try {
          if (texts[i]) items(parseJson(texts[i]), 'list').forEach(function (s) { tabs.push({ title: str(s, 'classname'), url: 'mekui:' + str(s, 'classid') + '#1' }); });
        } catch (e) { }
        return { title: str(c, 'classname'), tabs: tabs };
      });
      // 小类都取到了才记住；有没取到的下次再取一遍
      if (texts.every(function (t) { return t !== null; })) menus = result;
      return result;
    },

    categoryPage: function (url) {
      var m = /^mekui:(\d+)#(\d+)$/.exec(url);
      if (!m) throw new Error('不认识的分类地址：' + url);
      var page = parseInt(m[2], 10);
      var sort = SORTS[this.host.getPref('sort', '热播')] || SORTS['热播'];
      var json = call(this.host, 'act=list&mod=movie&classid=' + m[1] + '&page=' + page + '&pagesize=20&sort=' + sort);
      var books = items(json, 'data.list').map(toBook);
      var total = books.length === 0 ? page : Math.max(page, int(json, 'data.totalpage', page));
      return { books: books, currentPage: page, totalPage: total, nextUrl: page < total ? 'mekui:' + m[1] + '#' + (page + 1) : null };
    },

    bookDetail: function (bookUrl, loadEpisodes, loadFullPages) {
      var host = this.host, k = ids(bookUrl);
      var d = at(call(host, 'mod=movie&act=detail&id=' + k.id), 'data.detail') || {};
      var detail = {
        title: str(d, 'title').trim(), coverUrl: str(d, 'titlepic'), intro: str(d, 'moviesay'), artist: str(d, 'player') || str(d, 'playadmin'),
        status: [str(d, 'filetype'), str(d, 'firstclassname')].filter(function (x) { return x; }).join(' · '), episodes: []
      };
      if (!loadEpisodes) return detail;
      var base = API + 'mod=movie&act=movielist&id=' + k.id + '&pagesize=' + CHAPTERS + '&page=';
      var first = host.getJson(base + 1, options());
      detail.episodes = toEpisodes(k, first);
      var pages = int(first, 'data.totalpage', 1);
      if (loadFullPages && pages > 1) {
        var urls = [];
        for (var p = 2; p <= pages; p++) urls.push(base + p);
        host.getStrings(urls, options(), 4).forEach(function (text, i) {
          if (text === null) throw new Error('第 ' + (i + 2) + ' 页章节加载失败，请重试');
          detail.episodes = detail.episodes.concat(toEpisodes(k, parseJson(text)));
        });
      }
      return detail;
    },

    // 播放地址：参数按名字排好序拼起来，末尾加上密钥，取 MD5 当校验值（网页就是这么算的）
    audio: function (url) {
      var k = ids(url);
      if (!k.no) throw new Error('不认识的章节地址：' + url);
      var t = Math.floor(new Date().getTime() / 1000);
      var token = this.host.md5('act=wapseries&id=' + k.id + '&mod=movie&movieId=' + k.no + '&t=' + t + '&token=' + KEY);
      var json = this.host.getJson(API + 'act=wapseries&mod=movie&id=' + k.id + '&movieId=' + k.no + '&t=' + t + '&token=' + token, options());
      if (int(json, 'code') !== 1 || !json.data) throw new Error(str(json, 'message') || str(json, 'msg') || '没有拿到播放地址（可能需要在网站上登录或开通会员）');
      var audio = str(json, 'data.SeriesUrl');
      // 主地址没有时用备用线路里第一个不为空的
      if (!audio) items(json, 'data.signed_urls').forEach(function (u) { if (!audio && typeof u === 'string' && u) audio = u; });
      if (!audio) throw new Error('这一集网站没有给出播放地址（可能需要在网站上登录或开通会员）');
      return { url: audio, headers: { Referer: SITE + '/' } };
    }
  });
})();

// ---------- 央视听音（tv.cctv.com/ty）：央视网的“听节目”频道，用央视网自己的接口 ----------
// 每张专辑是一本书，里面的节目是章节。没有单独的音频文件，播的是节目视频的最低码率那一路（只出声音）。
(function () {
  var SITE = 'https://tv.cctv.com';
  var LIST = 'https://api.cntv.cn/newVideoset/getVideoAlbumListByPageIdTvty?serviceId=tvty&n=20';
  var menus = null;

  function options() { return { headers: { Referer: SITE + '/ty/m/index.shtml' } }; }

  function albumId(url) {
    var m = /(VIDA[0-9A-Za-z]+)/.exec(url);
    if (!m) throw new Error('不认识的地址：' + url);
    return m[1];
  }

  function toBook(a) {
    return {
      coverUrl: str(a, 'image') || str(a, 'image2'), bookUrl: str(a, 'url') || (SITE + '/' + str(a, 'id') + '.shtml'), title: str(a, 'title').trim(),
      intro: str(a, 'brief'), status: str(a, 'sc').split(',').filter(function (x) { return x; }).slice(0, 3).join(' · ')
    };
  }

  registerSource({
    id: 'f5b0d8e27a3c4169b4e2c70d9a61f8b3', name: '央视听音', url: SITE + '/ty/m/index.shtml',
    description: '央视网的“听音”频道：百家讲坛等名家讲座、评书、戏曲、历史人文、儿童、健康等，都是央视的节目。' +
      '播放的是节目视频的声音，比普通音频费流量；不能下载到本地。',

    // 搜出来的是一期期节目，按它所在的专辑归并成书
    search: function (keywords, page) {
      var json = this.host.getJson('https://search.cctv.com/m/if3g_search.php?page=' + page + '&qtext=' + Shun.enc(keywords) +
        '&type=audio&sort=SCORE&pageSize=20&channel=', { headers: { Referer: 'https://search.cctv.com/m/search.php?type=audio' } });
      var host = this.host, seen = {}, books = [];
      items(json, 'list').forEach(function (v) {
        var id = str(v, 'ALBUMID');
        if (!id || seen[id]) return;
        seen[id] = true;
        var plain = function (s) { return host.htmlDecode(String(s).replace(/<[^>]+>/g, '')).trim(); };
        books.push({
          coverUrl: str(v, 'IMAGELINK'), bookUrl: str(v, 'PAGELINK').split('?')[0].replace('//tv.cctv.cn/', '//tv.cctv.com/'),
          title: plain(str(v, 'DRETITLE')), intro: plain(str(v, 'DRECONTENT')), status: str(v, 'CHANNEL')
        });
      });
      return { books: books, totalPage: Math.max(page, Math.min(50, Math.ceil(int(json, 'total') / 20))) };
    },

    // 分类来自网站“全部”页的标签：一级分类各是一组，里面是“全部”和它的二级标签
    categoryMenus: function () {
      if (menus) return menus;
      var result = [{ title: '推荐', tabs: [{ title: '全部', url: 'cctv:#1' }] }];
      var groups = {}, order = [];
      items(this.host.getJson(SITE + '/ty/m/sxy/data.jsonp', options()), 'data.list').forEach(function (t) {
        var fc = str(t, 'fc'), sc = str(t, 'sc');
        if (!fc || !sc) return;
        if (!groups[fc]) { groups[fc] = [{ title: '全部', url: 'cctv:fc=' + Shun.enc(fc) + '#1' }]; order.push(fc); }
        groups[fc].push({ title: sc, url: 'cctv:fc=' + Shun.enc(fc) + '&sc=' + Shun.enc(sc) + '#1' });
      });
      order.forEach(function (fc) { result.push({ title: fc, tabs: groups[fc] }); });
      if (order.length > 0) menus = result;
      return result;
    },

    categoryPage: function (url) {
      var m = /^cctv:([^#]*)#(\d+)$/.exec(url);
      if (!m) throw new Error('不认识的分类地址：' + url);
      var page = parseInt(m[2], 10);
      var json = this.host.getJson(LIST + '&p=' + page + (m[1] ? '&' + m[1] : ''), options());
      var books = items(json, 'data.list').map(toBook);
      var total = books.length === 0 ? page : Math.max(page, Math.ceil(int(json, 'data.total') / 20));
      return { books: books, currentPage: page, totalPage: total, nextUrl: page < total ? 'cctv:' + m[1] + '#' + (page + 1) : null };
    },

    bookDetail: function (bookUrl, loadEpisodes) {
      var host = this.host, id = albumId(bookUrl), detail = { episodes: [] };
      try {
        var a = at(host.getJson('https://api.cntv.cn/NewVideoset/getVideoAlbumInfo?id=' + id + '&serviceId=tvcctv', options()), 'data') || {};
        detail.title = str(a, 'title').trim(); detail.intro = str(a, 'brief'); detail.coverUrl = str(a, 'image');
      } catch (e) { if (e.cancelled) throw e; }
      if (!loadEpisodes) return detail;
      // 专辑里的节目分两种存法（mode 0 和 1），事先不知道是哪种：先按 0 取，一期都没有再按 1 取。一页最多 100 期，按播出顺序
      for (var mode = 0; mode <= 1 && detail.episodes.length === 0; mode++) {
        var base = 'https://api.cntv.cn/NewVideo/getVideoListByAlbumIdNew?id=' + id + '&serviceId=tvcctv&mode=' + mode + '&pub=1&n=100&sort=asc&p=';
        for (var p = 1; p <= 50; p++) {
          var json = host.getJson(base + p, options());
          var list = items(json, 'data.list');
          list.forEach(function (v) {
            var guid = str(v, 'guid');
            if (guid) detail.episodes.push({ title: str(v, 'title').trim(), url: bookUrl.split('?')[0] + '?guid=' + guid });
          });
          if (list.length < 100 || detail.episodes.length >= int(json, 'data.total')) break;
        }
      }
      detail.status = detail.episodes.length > 0 ? detail.episodes.length + ' 期' : '';
      return detail;
    },

    // 用节目的编号问央视网要播放地址（HLS）。用手机的身份去问，给的是码率最低的那一路
    audio: function (url) {
      var m = /[?&]guid=([0-9a-fA-F]+)/.exec(url);
      if (!m) throw new Error('不认识的章节地址：' + url);
      var json = this.host.getJson('https://vdn.apps.cntv.cn/api/getHttpVideoInfo.do?pid=' + m[1], { headers: { Referer: SITE + '/' } });
      var hls = str(json, 'hls_url');
      if (!hls) throw new Error('央视网没有给出这期节目的播放地址' + (str(json, 'tip_msg') ? '：' + str(json, 'tip_msg') : '（可能有版权限制）'));
      return { url: hls, headers: { Referer: SITE + '/', 'X-Media-Type': 'hls' } };
    }
  });
})();

// ---------- 心理FM fm.xinli001.com（壹心理的情感电台）----------
// 网站上每期节目是单独的一条（几分钟到十几分钟）。这里把每期节目当成一本“书”：第一集是它自己，
// 后面跟着网站给它排的连播列表（和在网页上听完一期自动接下一期是同一个列表），这样能一直听下去。
// 列表类的接口返回的是一段 HTML，单期信息和连播列表是 JSON。
(function () {
  var SITE = 'https://fm.xinli001.com';
  var MOODS = [['烦躁', 'fret'], ['悲伤', 'sad'], ['孤独', 'alone'], ['已弃疗', 'hehe'], ['减压', 'relax'], ['无奈', 'helpless'], ['快乐', 'happy'], ['感动', 'moved'], ['迷茫', 'confused']];
  var PLACES = [['睡前', 'bed'], ['旅行', 'trip'], ['散步', 'walk'], ['坐车', 'bus'], ['独处', 'one'], ['失恋', 'miss'], ['失眠', 'sleepless'], ['无聊', 'boring'], ['随便', 'casual']];
  var CACHE = 'xinlifm-home.txt';
  var CACHE_LIFETIME = 3 * 3600 * 1000;
  var HOT_PAGE = 30;

  // 请求都用 WebView 自带的那个 UA（旧版宿主拿不到就用手机版的）：过防护验证时用的是 WebView，前后得是同一个 UA
  function options() { return Shun.cfOptions(host0, { Referer: SITE + '/', 'X-Requested-With': 'XMLHttpRequest' }); }
  var host0 = null;

  // 网站前面有阿里云的防护：有时不给内容，而是给一个要浏览器算一下才能通过的验证页
  function blocked(text) { return text.indexOf('renderData') >= 0 && text.indexOf('arg1') >= 0; }

  function get(host, path) {
    host0 = host;
    var text = host.getString(SITE + path, options());
    if (!blocked(text)) return text;
    // 用 WebView 把首页打开一次，它会算出通过验证的 Cookie；普通请求之后带着这个 Cookie 就行
    try {
      host.render(SITE + '/', { nativeUA: true, timeout: 30000, parse: function (html) { return html.indexOf('menuitem') >= 0 ? '1' : ''; } });
    } catch (e) {
      if (e.cancelled) throw e;
      host.log('心理FM 的防护验证没有自动通过：' + e.message);
    }
    text = host.getString(SITE + path, options());
    if (blocked(text)) throw new Error('网站的防护验证没有通过，请稍后重试');
    return text;
  }

  function bookUrl(pk) { return SITE + '/' + pk; }
  function episodeUrl(pk) { return SITE + '/broadcast?pk=' + pk; }
  function pkOf(url) { return (/(?:pk=|\/)(\d+)$/.exec(String(url)) || [])[1] || ''; }
  // 列表里给的是 80 像素的小图（地址后面带 !80），去掉后缀就是原图
  function fullCover(url) { return String(url || '').replace(/![0-9a-z]+$/i, ''); }
  function decode(s) { return String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim(); }

  // 一段列表 HTML 里的节目。每条的样子：
  // <a href="/123" data-pk="123" class="broadcast"><img src="封面!80"></a> … <a … class="broadcast broadcast_title">标题</a> <span>主播 某某</span>
  function parseList(html) {
    var re = /<a href="\/(\d+)" data-pk="\d+" class="broadcast"><img src="([^"]*)"[^>]*><\/a>[\s\S]*?class="broadcast broadcast_title">([^<]*)<\/a>\s*<span>主播\s*([^<]*)<\/span>/g;
    var list = [], seen = {}, m;
    while ((m = re.exec(html)) !== null) {
      if (seen[m[1]]) continue;
      seen[m[1]] = true;
      list.push({ bookUrl: bookUrl(m[1]), title: decode(m[3]), artist: decode(m[4]), coverUrl: fullCover(m[2]) });
    }
    return list;
  }

  // 首页那一大段（1 MB 多）：前 20 条是最新的，后面几千条是最热的。取一次存起来，几个小时内不再取
  function home(host) {
    var age = host.cacheAge(CACHE);
    if (age >= 0 && age < CACHE_LIFETIME) {
      var cached = (host.readCache(CACHE) || '').split('\n').map(function (l) { return l.split('\t'); })
        .filter(function (p) { return p.length === 4; })
        .map(function (p) { return { bookUrl: bookUrl(p[0]), title: p[1], artist: p[2], coverUrl: p[3] }; });
      if (cached.length > 20) return cached;
    }
    var list = parseList(get(host, '/fragment?t=' + Date.now() + '&n=lastest'));
    if (list.length > 20) {
      host.writeCache(CACHE, list.map(function (b) { return [pkOf(b.bookUrl), b.title.replace(/[\t\n]/g, ' '), b.artist.replace(/[\t\n]/g, ' '), b.coverUrl].join('\t'); }).join('\n'));
    }
    return list;
  }

  function info(host, pk) {
    var json = parseJson(get(host, '/broadcast?pk=' + pk));
    var data = json && json.data;
    if (!data || !str(data, 'id')) throw new Error('没有找到这期节目');
    return data;
  }

  function tagTabs(list) { return list.map(function (t) { return { title: t[0], url: 'xinlifm:tag:' + t[1] + ':' + t[0] }; }); }

  registerSource({
    id: '6e2f9a8c41b74d0e9c35a7d1f08b6e42', name: '心理FM', url: SITE + '/',
    description: '壹心理的情感电台：睡前、失眠、减压、失恋……每期几分钟到十几分钟。可以按心情和场景找，也可以搜节目名或主播名。',
    group: '电台',

    categoryMenus: function () {
      return [
        { title: '推荐', tabs: [{ title: '最新', url: 'xinlifm:new' }, { title: '最热', url: 'xinlifm:hot' }] },
        { title: '心情', tabs: tagTabs(MOODS) },
        { title: '场景', tabs: tagTabs(PLACES) }
      ];
    },

    categoryPage: function (url) {
      var host = this.host;
      var parts = String(url).split('#'), page = parseInt(parts[1] || '1', 10) || 1, key = parts[0];
      var m = /^xinlifm:tag:([a-z]+):(.+)$/.exec(key);
      if (m) {
        // 第一页网站自己用的是 page=标签名，后面的页才是数字
        var books = parseList(get(host, '/tagshow?p=' + m[1] + '&page=' + (page === 1 ? m[1] : page) + '&n=' + encodeURIComponent(m[2])));
        var more = books.length >= 20;
        return { books: books, currentPage: page, totalPage: more ? page + 1 : page, nextUrl: more ? key + '#' + (page + 1) : null };
      }
      var all = home(host);
      if (key === 'xinlifm:new') return { books: all.slice(0, 20), currentPage: 1, totalPage: 1 };
      var hot = all.slice(20), total = Math.max(1, Math.ceil(hot.length / HOT_PAGE));
      return { books: hot.slice((page - 1) * HOT_PAGE, page * HOT_PAGE), currentPage: page, totalPage: total, nextUrl: page < total ? key + '#' + (page + 1) : null };
    },

    // 网站的搜索只稳定地给第一页（20 条），可以搜节目名、主播名、心情和场景
    search: function (keywords, page) {
      if (page > 1) return { books: [], totalPage: page - 1 };
      return { books: parseList(get(this.host, '/search?q=' + encodeURIComponent(keywords))), totalPage: 1 };
    },

    bookDetail: function (url, loadEpisodes) {
      var host = this.host, pk = pkOf(url);
      var data = info(host, pk);
      var detail = {
        title: str(data, 'title').trim(), artist: str(data, 'speak'), intro: str(data, 'content').trim(),
        coverUrl: fullCover(str(data, 'cover')), episodes: [{ title: str(data, 'title').trim(), url: episodeUrl(pk) }]
      };
      if (!loadEpisodes) return detail;
      // 网站给这期节目排的连播列表（第一条是它自己），标题要一期期去问
      try {
        var queue = items(parseJson(get(host, '/broadcast-pk-list?pk=' + pk + '&id=' + encodeURIComponent(str(data, 'jingxuan_id')))), 'data')
          .map(String).filter(function (id) { return /^\d+$/.test(id) && id !== pk; });
        host0 = host;
        var texts = host.getStrings(queue.map(function (id) { return SITE + '/broadcast?pk=' + id; }), options(), 5);
        queue.forEach(function (id, i) {
          var title = '';
          try { title = str(parseJson(texts[i]), 'data.title').trim(); } catch (e) { title = ''; }
          if (title) detail.episodes.push({ title: title, url: episodeUrl(id) });
        });
      } catch (e) { if (e.cancelled) throw e; }
      detail.status = detail.episodes.length > 1 ? '连播 ' + detail.episodes.length + ' 期' : '';
      return detail;
    },

    audio: function (url) {
      var audio = str(info(this.host, pkOf(url)), 'url');
      if (!audio) throw new Error('这期节目没有给出音频地址');
      return { url: audio.replace(/^http:/, 'https:'), headers: { Referer: SITE + '/' } };
    }
  });
})();

// ---------- 网易云音乐 music.163.com：分成“网易云播客”和“网易云音乐”两个源 ----------
// 用的是网页版的接口。
// 播客：每个“播客 / 电台”是一本书，里面的节目是章节；节目的声音是一首“歌”，播放时用歌的编号去要地址。
// 音乐：歌单、专辑、排行榜各是一本书，里面的歌是章节；搜到的单曲是只有一集的书。登录后能看到自己的歌单。
// 登录状态就是在 App 内网页里登录后留下的 Cookie（和普通请求共用），两个源登录一次就都有了；会员或已购买的内容登录后才能听。
(function () {
  var SITE = 'https://music.163.com';
  var API = SITE + '/api';
  var PAGE = 30;
  // 播客的分类（网站“播客”页上的那些），有声书相关的排在前面
  var CATEGORIES = [['有声书', 10001], ['广播剧', 3088097], ['相声曲艺', 3088098], ['故事', 3080097], ['人文历史', 3080098], ['文学出版', 3148096],
    ['知识', 11], ['情感', 3], ['脱口秀', 8], ['亲子', 13], ['生活', 6], ['资讯', 3087096], ['娱乐', 3083097], ['二次元', 3001],
    ['音乐播客', 2], ['创作翻唱', 2001], ['明星专区', 14], ['其他', 3081098]];

  // body 不为空时用 POST 提交（表单格式）
  function api(host, path, body) {
    var o = { desktop: true, headers: { Referer: SITE + '/' } };
    if (body) { o.method = 'POST'; o.body = body; }
    var json = host.getJson(API + path, o);
    var code = int(json, 'code', 200);
    if (code === 301) throw new Error('需要登录网易云音乐：到插件页点这个源的“登录”');
    if (code !== 200) {
      var err = new Error('网易云音乐：' + (str(json, 'message') || str(json, 'msg') || '接口返回错误 ' + code));
      err.code = code;
      throw err;
    }
    return json;
  }

  // 请求太快时网站返回 406“操作频繁，请稍候再试”，十几秒后恢复：等一会儿再试，最多试几次
  function apiPatient(host, path) {
    for (var attempt = 0; ; attempt++) {
      try { return api(host, path); } catch (e) {
        if (e.code !== 406 || attempt >= 4) {
          if (e.code === 406) e.rateLimited = true;
          throw e;
        }
        for (var s = 20; s > 0; s--) {
          host.progress('（网易云限制了访问频率，' + s + ' 秒后继续）');
          host.sleep(1000);
        }
      }
    }
  }

  function bookUrl(id) { return SITE + '/djradio?id=' + id; }
  function radioId(url) { return (/[?&]id=(\d+)/.exec(String(url)) || [])[1] || ''; }
  // 封面地址后面加上尺寸，网站会给缩小过的图
  function cover(url) { return url ? String(url).replace(/^http:/, 'https:') + '?param=300y300' : ''; }
  function paid(radio) { return int(radio, 'radioFeeType') !== 0 || int(radio, 'price') > 0; }

  var LOGIN = {
    // 手机上先给手机版的登录页（手机号 / 扫码）；右上角可以换成电脑版网页
    loginUrl: SITE + '/m/login', loginDesktop: false, loginAltUrl: SITE + '/#/login',
    // 已登录时返回昵称
    checkLogin: function () {
      var name = str(api(this.host, '/nuser/account/get'), 'profile.nickname');
      if (!name) throw new Error('还没有登录网易云音乐');
      return name;
    }
  };

  // 用歌的编号去要播放地址。地址有时效，所以每次播放时现取
  function songAudio(host, song) {
    var data = at(api(host, '/song/enhance/player/url/v1?ids=' + encodeURIComponent('[' + song + ']') + '&level=standard&encodeType=mp3'), 'data.0') || {};
    var audio = str(data, 'url');
    if (!audio) {
      // 没给地址：一般是要会员、要购买，没有版权，或者没有登录
      throw new Error(int(data, 'fee') > 0 || int(data, 'code') === 404 ? '这一首需要会员或购买后才能听（登录自己的账号后再试）' : '网易云音乐没有给出播放地址（可能没有版权）');
    }
    // 会员歌曲没开会员时，网站只给一小段试听
    if (data.freeTrialInfo) host.toast('这首歌只能试听一小段（需要会员）');
    return { url: audio.replace(/^http:/, 'https:'), headers: { Referer: SITE + '/' } };
  }

  function toBook(radio) {
    var count = int(radio, 'programCount');
    return {
      bookUrl: bookUrl(str(radio, 'id')), title: str(radio, 'name').trim(), artist: str(radio, 'dj.nickname'),
      coverUrl: cover(str(radio, 'picUrl')), intro: str(radio, 'desc').trim(),
      status: [str(radio, 'category'), count > 0 ? count + ' 期' : '', paid(radio) ? '付费' : ''].filter(function (x) { return x.length > 0; }).join(' · ')
    };
  }

  registerSource({
    id: '9d3c7a15e8b24f60a1c5d79e3b04f862', name: '网易云播客', url: SITE + '/',
    description: '网易云音乐的播客：有声书、广播剧、相声曲艺、故事、人文历史等。免费的节目不用登录；会员或购买过的内容，在插件页“登录”自己的账号后可以听。',
    multipleEpisodePages: true,
    loginUrl: LOGIN.loginUrl, loginDesktop: LOGIN.loginDesktop, loginAltUrl: LOGIN.loginAltUrl, checkLogin: LOGIN.checkLogin,

    categoryMenus: function () {
      return [{ title: '播客', tabs: [{ title: '热门', url: 'netease:hot' }].concat(CATEGORIES.map(function (c) { return { title: c[0], url: 'netease:cate:' + c[1] }; })) }];
    },

    categoryPage: function (url) {
      var parts = String(url).split('#'), page = parseInt(parts[1] || '1', 10) || 1, key = parts[0];
      var offset = (page - 1) * PAGE;
      var m = /^netease:cate:(\d+)$/.exec(key);
      var json = m ? api(this.host, '/djradio/hot?cateId=' + m[1] + '&limit=' + PAGE + '&offset=' + offset)
        : api(this.host, '/djradio/hot/v1?limit=' + PAGE + '&offset=' + offset);
      var books = items(json, 'djRadios').map(toBook);
      var more = json.hasMore === true && books.length > 0;
      return { books: books, currentPage: page, totalPage: more ? page + 1 : page, nextUrl: more ? key + '#' + (page + 1) : null };
    },

    search: function (keywords, page) {
      var json = api(this.host, '/search/get?s=' + encodeURIComponent(keywords) + '&type=1009&limit=' + PAGE + '&offset=' + (page - 1) * PAGE);
      var books = items(json, 'result.djRadios').map(toBook);
      var total = Math.ceil(int(json, 'result.djRadiosCount') / PAGE);
      return { books: books, totalPage: books.length === 0 ? page : Math.max(page, total) };
    },

    bookDetail: function (url, loadEpisodes, loadFullPages) {
      var host = this.host, id = radioId(url);
      var radio = at(api(host, '/djradio/get?id=' + id), 'djRadio') || {};
      var detail = {
        title: str(radio, 'name').trim(), artist: str(radio, 'dj.nickname'), intro: str(radio, 'desc').trim(),
        coverUrl: cover(str(radio, 'picUrl')), episodes: []
      };
      if (!loadEpisodes) return detail;
      // 节目按期数从前往后排，一页最多 500 期。网站限制访问频率：连着取五六次后要等十几秒才能再取（歇得再久也差不多），每页之间歇一下，被限制了就等一会儿接着取
      var size = 500;
      try {
        for (var offset = 0; offset < 50000; offset += size) {
          if (offset > 0) {
            host.progress(Math.min(offset + size, int(radio, 'programCount')) + ' / ' + int(radio, 'programCount'));
            host.sleep(2000);
          }
          var json = apiPatient(host, '/dj/program/byradio?radioId=' + id + '&limit=' + size + '&offset=' + offset + '&asc=true');
          var list = items(json, 'programs');
          list.forEach(function (p) {
            var song = str(p, 'mainSong.id') || str(p, 'mainTrackId');
            if (!song) return;
            detail.episodes.push({
              title: str(p, 'name').trim(), url: SITE + '/program?id=' + str(p, 'id') + '&song=' + song,
              // 收费的节目没买过就标成付费（能不能听以登录后的账号为准）
              isFree: int(p, 'programFeeType') === 0 || p.buyed === true
            });
          });
          if (!loadFullPages || json.more !== true || list.length === 0) break;
        }
      } catch (e) {
        // 一直被限制：先用已经取到的部分，下次打开这本书时会重新加载
        if (!e.rateLimited || detail.episodes.length === 0) throw e;
        host.toast('网易云限制了访问频率，先加载了 ' + detail.episodes.length + ' 期，过一会儿重新打开这本书可以加载全部');
      } finally {
        host.progress(null);
      }
      var count = int(radio, 'programCount');
      detail.status = [radio.finished === true ? '完结' : '', count > 0 ? count + ' 期' : '', paid(radio) ? '付费' : ''].filter(function (x) { return x.length > 0; }).join(' · ');
      return detail;
    },

    // 节目的声音是一首“歌”，用它的编号去要播放地址
    audio: function (url) {
      var song = (/[?&]song=(\d+)/.exec(String(url)) || [])[1];
      if (!song) throw new Error('不认识的章节地址：' + url);
      return songAudio(this.host, song);
    }
  });

  // ================= 音乐 =================
  var STYLES = ['华语', '流行', '摇滚', '民谣', '电子', '说唱', '轻音乐', '古风', '怀旧', '影视原声', 'ACG', '粤语', '欧美', '日语', '韩语', '古典', '爵士', '儿童'];
  var BATCH = 300; // 一次问多少首歌的信息

  function idOf(url) { return (/[?&]id=(\d+)/.exec(String(url)) || [])[1] || ''; }
  function names(list) { return (list || []).map(function (a) { return str(a, 'name'); }).filter(function (n) { return n.length > 0; }).join(' / '); }
  // fee：0 免费，8 免费（高音质要会员），1 会员才能听，4 要买专辑
  function songFree(fee) { return fee !== 1 && fee !== 4; }

  // 歌曲的两种写法都认：新接口是 ar / al，搜索接口是 artists / album
  function songEpisode(song, fee) {
    var who = names(song.ar || song.artists);
    return {
      title: str(song, 'name').trim() + (who ? ' - ' + who : ''), url: SITE + '/song?id=' + str(song, 'id'),
      isFree: songFree(fee === undefined ? int(song, 'fee') : fee)
    };
  }

  function playlistBook(p) {
    var count = int(p, 'trackCount');
    return {
      bookUrl: SITE + '/playlist?id=' + str(p, 'id'), title: str(p, 'name').trim(), artist: str(p, 'creator.nickname'),
      coverUrl: cover(str(p, 'coverImgUrl') || str(p, 'picUrl')), intro: (str(p, 'description') || str(p, 'copywriter')).trim(),
      status: [count > 0 ? count + ' 首' : '', str(p, 'updateFrequency')].filter(function (x) { return x.length > 0; }).join(' · ') || '歌单'
    };
  }

  // 按编号问一批歌的信息（歌名、歌手、是否收费）
  function songsByIds(host, ids) {
    var json = api(host, '/v3/song/detail', 'c=' + encodeURIComponent(JSON.stringify(ids.map(function (id) { return { id: id }; }))));
    var fees = {};
    items(json, 'privileges').forEach(function (p) { fees[str(p, 'id')] = int(p, 'fee'); });
    var byId = {};
    items(json, 'songs').forEach(function (song) { byId[str(song, 'id')] = song; });
    // 按歌单里的顺序排
    return ids.map(function (id) { return byId[String(id)]; }).filter(function (song) { return !!song; })
      .map(function (song) { return { song: song, fee: fees[str(song, 'id')] }; });
  }

  registerSource({
    id: '2f8b6d4a0c9e43f7b15a8e6d3c7f0a94', name: '网易云音乐', url: SITE + '/',
    description: '网易云音乐的歌单、排行榜和单曲。歌单、专辑是一本“书”，里面的歌是章节。在插件页“登录”自己的账号后，发现页的“我的歌单”里能看到自己创建和收藏的歌单；会员歌曲没开会员时只能试听一小段。',
    group: '音乐',
    multipleEpisodePages: true,
    loginUrl: LOGIN.loginUrl, loginDesktop: LOGIN.loginDesktop, loginAltUrl: LOGIN.loginAltUrl, checkLogin: LOGIN.checkLogin,

    categoryMenus: function () {
      return [
        { title: '推荐', tabs: [{ title: '推荐歌单', url: 'ncm:recommend' }, { title: '我的歌单', url: 'ncm:mine' }, { title: '排行榜', url: 'ncm:top' }] },
        { title: '歌单', tabs: [{ title: '全部', url: 'ncm:cat:全部' }].concat(STYLES.map(function (n) { return { title: n, url: 'ncm:cat:' + n }; })) }
      ];
    },

    categoryPage: function (url) {
      var host = this.host;
      var parts = String(url).split('#'), page = parseInt(parts[1] || '1', 10) || 1, key = parts[0];
      function one(list) { return { books: list.map(playlistBook), currentPage: 1, totalPage: 1 }; }
      if (key === 'ncm:mine') {
        var uid = str(api(host, '/nuser/account/get'), 'account.id');
        if (!uid) throw new Error('还没有登录网易云音乐：到“插件”页点开这个源，点“登录”');
        // 自己创建的在前（第一个是“我喜欢的音乐”），后面是收藏的
        return one(items(api(host, '/user/playlist?uid=' + uid + '&limit=300&offset=0'), 'playlist'));
      }
      if (key === 'ncm:recommend') return one(items(api(host, '/personalized/playlist?limit=30'), 'result'));
      if (key === 'ncm:top') return one(items(api(host, '/toplist'), 'list'));
      var cat = key.replace(/^ncm:cat:/, '');
      var json = api(host, '/playlist/list?cat=' + encodeURIComponent(cat) + '&order=hot&limit=' + PAGE + '&offset=' + (page - 1) * PAGE);
      var books = items(json, 'playlists').map(playlistBook);
      var more = json.more === true && books.length > 0;
      return { books: books, currentPage: page, totalPage: more ? page + 1 : page, nextUrl: more ? key + '#' + (page + 1) : null };
    },

    // 搜出来的主要是单曲（每首是只有一集的“书”）；第一页后面再跟几张专辑和几个歌单
    search: function (keywords, page) {
      var host = this.host, q = encodeURIComponent(keywords);
      var json = api(host, '/search/get?s=' + q + '&type=1&limit=' + PAGE + '&offset=' + (page - 1) * PAGE);
      var books = items(json, 'result.songs').map(function (song) {
        return {
          bookUrl: SITE + '/song?id=' + str(song, 'id'), title: str(song, 'name').trim(), artist: names(song.artists),
          coverUrl: cover(str(song, 'album.picUrl')), status: ['单曲', str(song, 'album.name')].filter(function (x) { return x.length > 0; }).join(' · ')
        };
      });
      var total = Math.max(page, Math.ceil(int(json, 'result.songCount') / PAGE));
      if (page === 1) {
        try {
          items(api(host, '/search/get?s=' + q + '&type=10&limit=5&offset=0'), 'result.albums').forEach(function (al) {
            books.push({
              bookUrl: SITE + '/album?id=' + str(al, 'id'), title: str(al, 'name').trim(), artist: str(al, 'artist.name'),
              coverUrl: cover(str(al, 'picUrl') || str(al, 'blurPicUrl')), status: '专辑' + (int(al, 'size') > 0 ? ' · ' + int(al, 'size') + ' 首' : '')
            });
          });
          items(api(host, '/search/get?s=' + q + '&type=1000&limit=8&offset=0'), 'result.playlists').forEach(function (p) { books.push(playlistBook(p)); });
        } catch (e) { if (e.cancelled) throw e; }
      }
      return { books: books, totalPage: books.length === 0 ? page : total };
    },

    bookDetail: function (url, loadEpisodes, loadFullPages) {
      var host = this.host, id = idOf(url), detail = { episodes: [] };
      if (/\/song\?/.test(url)) {
        // 单曲：只有它自己这一集
        var one = songsByIds(host, [id])[0];
        if (!one) throw new Error('没有找到这首歌');
        detail.title = str(one.song, 'name').trim(); detail.artist = names(one.song.ar);
        detail.coverUrl = cover(str(one.song, 'al.picUrl')); detail.status = ['单曲', str(one.song, 'al.name')].filter(function (x) { return x.length > 0; }).join(' · ');
        detail.episodes.push(songEpisode(one.song, one.fee));
        return detail;
      }
      if (/\/album\?/.test(url)) {
        var album = api(host, '/v1/album/' + id);
        detail.title = str(album, 'album.name').trim(); detail.artist = str(album, 'album.artist.name');
        detail.coverUrl = cover(str(album, 'album.picUrl')); detail.intro = str(album, 'album.description').trim();
        items(album, 'songs').forEach(function (song) { detail.episodes.push(songEpisode(song)); });
        detail.status = '专辑 · ' + detail.episodes.length + ' 首';
        return detail;
      }
      // 歌单：详情里只带着前几首歌的信息，但有全部歌的编号，按编号一批批去问
      var list = at(api(host, '/v6/playlist/detail?id=' + id + '&n=1000'), 'playlist') || {};
      detail.title = str(list, 'name').trim(); detail.artist = str(list, 'creator.nickname');
      detail.coverUrl = cover(str(list, 'coverImgUrl')); detail.intro = str(list, 'description').trim();
      var ids = items(list, 'trackIds').map(function (t) { return str(t, 'id'); }).filter(function (x) { return x.length > 0; });
      detail.status = ids.length + ' 首';
      if (!loadEpisodes) return detail;
      try {
        for (var i = 0; i < ids.length; i += BATCH) {
          if (i > 0) host.progress(Math.min(i + BATCH, ids.length) + ' / ' + ids.length);
          songsByIds(host, ids.slice(i, i + BATCH)).forEach(function (x) { detail.episodes.push(songEpisode(x.song, x.fee)); });
          if (!loadFullPages) break;
        }
      } finally {
        host.progress(null);
      }
      return detail;
    },

    audio: function (url) {
      var song = idOf(url);
      if (!song) throw new Error('不认识的章节地址：' + url);
      return songAudio(this.host, song);
    }
  });
})();

// 央视网栏目类的源（百家讲坛、新闻联播）共用：章节地址里带着节目编号（guid），用它问央视网要播放地址（HLS），和央视听音是同一个接口
function cntvAudio(host, url) {
  var m = /[?&]guid=([0-9a-fA-F]+)/.exec(url);
  if (!m) throw new Error('不认识的章节地址：' + url);
  var json = host.getJson('https://vdn.apps.cntv.cn/api/getHttpVideoInfo.do?pid=' + m[1], { headers: { Referer: 'https://tv.cctv.com/' } });
  var hls = str(json, 'hls_url');
  if (!hls) throw new Error('央视网没有给出这期节目的播放地址' + (str(json, 'tip_msg') ? '：' + str(json, 'tip_msg') : '（可能有版权限制）'));
  return { url: hls, headers: { Referer: 'https://tv.cctv.com/', 'X-Media-Type': 'hls' } };
}

// ---------- 百家讲坛（tv.cctv.com/lm/bjjt）：CCTV-10 的讲座栏目，用央视网栏目页自己的接口 ----------
// 网站只有“某年播过的每一期节目”这一种列表，没有按系列分的。这里按节目标题把同一个系列的各期归到一起，
// 一个系列是一本书（例如“宋朝那些人和事儿（第二部）”），标题看不出系列的单期节目放进那一年的“其他节目”。
// 和央视听音一样没有单独的音频文件，播的是节目视频的声音。
(function () {
  var SITE = 'https://tv.cctv.com';
  var PAGE = SITE + '/lm/bjjt/index.shtml';
  var TOPIC = 'TOPC1451557052519584';
  var API = 'https://api.cntv.cn/';
  var FIRST_YEAR = 2009;
  var OTHER = '_';
  var years = {};   // 这次运行里已经取过的年份

  function options() { return { headers: { Referer: PAGE } }; }
  function thisYear() { return new Date().getFullYear(); }

  var DIGITS = { '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  // “二十六”“一百零三”“17”“③”这些写法的期数
  function number(s) {
    s = String(s);
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    if (s.length === 1 && s >= '①' && s <= '⑳') return s.charCodeAt(0) - 0x2460 + 1;
    var total = 0, current = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === '百') { total += (current || 1) * 100; current = 0; }
      else if (c === '十') { total += (current || 1) * 10; current = 0; }
      else if (DIGITS[c] !== undefined) current = DIGITS[c];
      else return 0;
    }
    return total + current;
  }

  // 标题里“第几期”的几种写法，谁先出现用谁：（二十六） / ③ / 第11集 / 后面跟空格的数字 / 紧贴着标题的数字
  var MARKS = [
    /[（(]\s*([一二两三四五六七八九十百零〇\d]+)\s*[）)]/,
    /([①-⑳])/,
    /\s*第\s*(\d+)\s*[集讲期]/,
    /\s*(\d+)(?=\s|$)/,
    /[）)》\s](\d+)(?=[^\d\s讲年月日期集部季])/
  ];

  // 把一期节目的标题拆成：系列名、第几期、这一期自己的标题。常见的样子：
  // 《百家讲坛》 20240331 宋朝那些人和事儿（第二部） 1 柴荣的心愿 / 百家讲坛经典 明亡清兴六十年（七）萨尔浒大败 / 《百家讲坛》 20130917 女皇武则天17 轻松摆平大叛乱
  function parseTitle(raw) {
    var text = String(raw || '').replace(/\s+/g, ' ').trim()
      .replace(/^《百家讲坛》\s*/, '').replace(/^百家讲坛(经典)?\s+/, '').replace(/^\d{8}\s*/, '').trim();
    var result = { text: text, series: '', number: 0, name: text };
    if (/^\d{4}年|^（|^\(/.test(text)) return result;
    var best = null;
    MARKS.forEach(function (re, k) {
      var m = re.exec(text);
      if (!m) return;
      // 最后一种写法里，数字前面那个字符还属于系列名
      var start = k === 4 ? m.index + 1 : m.index;
      if (start > 0 && (!best || start < best.start)) best = { start: start, end: m.index + m[0].length, number: number(m[1]) };
    });
    if (best && best.number > 0) {
      result.series = text.slice(0, best.start); result.number = best.number; result.name = text.slice(best.end).trim();
    } else {
      var space = text.indexOf(' ');
      if (space >= 2) { result.series = text.slice(0, space); result.name = text.slice(space + 1).trim(); }
    }
    result.series = result.series.replace(/[\s—\-–:：]+$/, '').trim();
    if (result.series.length < 2) { result.series = ''; result.number = 0; result.name = text; }
    return result;
  }

  function keyOf(series) { return series.replace(/[《》\s]/g, ''); }

  function minutes(length) {
    var m = /^(\d+):(\d+):(\d+)$/.exec(String(length || ''));
    return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : 0;
  }

  // 某一年播过的全部整期节目，按播出先后。每期只留用得上的几项：[标题, 节目编号, 月日, 配图, 简介]
  // 往年的不会再变，存一个月；今年的每三小时重新取一次
  function loadYear(host, year) {
    if (years[year]) return years[year];
    var cache = 'bjjt-' + year + '.json';
    var age = host.cacheAge(cache);
    if (age >= 0 && age < (year < thisYear() ? 30 * 24 : 3) * 3600 * 1000) {
      try { var cached = JSON.parse(host.readCache(cache)); if (cached.length > 0) return years[year] = cached; } catch (e) { }
    }
    var list = [], seen = {};
    var base = API + 'NewVideo/getVideoListByColumn?id=' + TOPIC + '&n=100&sort=asc&d=' + year + '&mode=0&serviceId=tvcctv&p=';
    // 接口最多给 1000 期
    for (var p = 1; p <= 10; p++) {
      var json = host.getJson(base + p, options());
      var page = items(json, 'data.list');
      page.forEach(function (v) {
        var guid = str(v, 'guid'), title = str(v, 'title').trim();
        // 不足五分钟的是混进来的片段
        if (!guid || seen[guid] || !title || title.charAt(0) === '[' || minutes(str(v, 'length')) < 5) return;
        seen[guid] = true;
        list.push([title, guid, str(v, 'time').slice(5, 10).replace('-', ''), str(v, 'image'), str(v, 'brief').replace(/（《百家讲坛》[^）]*）\s*$/, '').replace(/^本期节目主要内容：/, '').slice(0, 160)]);
      });
      if (page.length < 100 || p * 100 >= int(json, 'data.total')) break;
    }
    if (list.length > 0) host.writeCache(cache, JSON.stringify(list));
    return years[year] = list;
  }

  // 把一年的节目归并成系列，按最近播出的排在前面
  function seriesOf(host, year) {
    var map = {}, order = [];
    loadYear(host, year).forEach(function (v) {
      var t = parseTitle(v[0]), key = t.series ? keyOf(t.series) : OTHER;
      if (!map[key]) { map[key] = { key: key, title: t.series || (year + ' 年其他节目'), episodes: [] }; order.push(key); }
      map[key].episodes.push({ number: t.number, name: t.name, text: t.text, guid: v[1], day: v[2], image: v[3], brief: v[4] });
    });
    // 只凑出一期的“系列”多半是拆错了，归到其他节目里
    var result = [], other = map[OTHER] || { key: OTHER, title: year + ' 年其他节目', episodes: [] };
    order.forEach(function (key) {
      var s = map[key];
      if (key === OTHER) return;
      if (s.episodes.length < 2) { s.episodes.forEach(function (e) { e.number = 0; e.name = e.text; other.episodes.push(e); }); return; }
      var numbered = s.episodes.every(function (e) { return e.number > 0; });
      s.numbered = numbered;
      if (numbered) s.episodes.sort(function (a, b) { return a.number - b.number; });
      result.push(s);
    });
    result.reverse();
    if (other.episodes.length > 0) result.push(other);
    return result;
  }

  function findSeries(host, year, key) {
    var list = seriesOf(host, year);
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
    return null;
  }

  // 一月份从第 2 期往后才开始的，是上一年年底开播的系列，在上一年那本书里能听全，这一年就不重复列了
  function continued(s) { return s.numbered && s.episodes[0].number > 1 && s.episodes.every(function (e) { return e.day <= '0228'; }); }

  function toBook(year, s) {
    var first = s.episodes[0];
    return {
      coverUrl: first.image, bookUrl: PAGE + '?y=' + year + '&s=' + Shun.enc(s.key), title: s.title,
      intro: s.key === OTHER ? '这一年里不成系列的单期节目。' : first.brief, status: year + ' 年 · ' + s.episodes.length + ' 讲'
    };
  }

  function yearList(host) {
    var list = [];
    try {
      items(host.getJson(API + 'newLanmu/getVideoCalendarByTopicId?id=' + TOPIC + '&mode=2&tt=2&serviceId=tvcctv', options()), 'data.list')
        .forEach(function (y) { var n = int(y, 'date'); if (n >= FIRST_YEAR) list.push(n); });
    } catch (e) { if (e.cancelled) throw e; }
    if (list.length === 0) for (var y = thisYear(); y >= FIRST_YEAR; y--) list.push(y);
    return list.sort(function (a, b) { return b - a; });
  }

  registerSource({
    id: '7c4e1b9d5a2f48e3b6d0a9c3e5f17d28', name: '百家讲坛', url: PAGE,
    description: 'CCTV-10《百家讲坛》栏目 2009 年以来的全部节目，按系列归并成书，按年份浏览。' +
      '播放的是节目视频的声音，比普通音频费流量；不能下载到本地。第一次搜索要把各年的节目单取一遍，会慢一些。',

    // 网站没有只搜这个栏目的接口，这里在各年的节目单里找：系列名或者某一期的标题里有关键字的系列
    search: function (keywords) {
      var host = this.host, words = String(keywords).trim().toLowerCase().split(/\s+/).filter(function (w) { return w; });
      var list = yearList(host), books = [];
      function hit(text) { text = text.toLowerCase(); return words.every(function (w) { return text.indexOf(w) >= 0; }); }
      try {
        list.forEach(function (year, i) {
          if (!years[year]) host.progress((i + 1) + ' / ' + list.length);
          var found;
          try { found = seriesOf(host, year); } catch (e) { if (e.cancelled) throw e; host.log('百家讲坛 ' + year + ' 年的节目单没取到：' + e.message); return; }
          found.forEach(function (s) {
            if (s.key === OTHER || continued(s)) return;
            if (hit(s.title) || s.episodes.some(function (e) { return hit(e.name); })) books.push(toBook(year, s));
          });
        });
      } finally { host.progress(null); }
      return { books: books, totalPage: 1 };
    },

    categoryMenus: function () {
      return [{ title: '年份', tabs: yearList(this.host).map(function (y) { return { title: String(y), url: 'bjjt:' + y }; }) }];
    },

    categoryPage: function (url) {
      var m = /^bjjt:(\d{4})$/.exec(url);
      if (!m) throw new Error('不认识的分类地址：' + url);
      var year = parseInt(m[1], 10);
      var books = seriesOf(this.host, year).filter(function (s) { return !continued(s); }).map(function (s) { return toBook(year, s); });
      return { books: books, currentPage: 1, totalPage: 1, nextUrl: null };
    },

    bookDetail: function (bookUrl) {
      var host = this.host, m = /[?&]y=(\d{4})&s=([^&#]+)/.exec(bookUrl);
      if (!m) throw new Error('不认识的地址：' + bookUrl);
      var year = parseInt(m[1], 10), key = decodeURIComponent(m[2]);
      var s = findSeries(host, year, key);
      if (!s) throw new Error('没有找到这个系列，可能网站调整了节目单');
      var episodes = s.episodes.slice();
      // 年底开播、跨到下一年的系列，把下一年接着播的那几期接上
      if (s.numbered && year < thisYear() && episodes.some(function (e) { return e.day >= '1201'; })) {
        try {
          var next = findSeries(host, year + 1, key), last = episodes[episodes.length - 1].number;
          if (next && next.numbered) next.episodes.forEach(function (e) { if (e.number > last && e.day <= '0228') episodes.push(e); });
        } catch (e) { if (e.cancelled) throw e; }
      }
      var book = toBook(year, s);
      return {
        title: book.title, coverUrl: book.coverUrl, intro: book.intro, status: year + ' 年 · ' + episodes.length + ' 讲',
        episodes: episodes.map(function (e) {
          return { title: s.numbered ? (e.number + ' ' + e.name).trim() : e.name, url: PAGE + '?guid=' + e.guid };
        })
      };
    },

    audio: function (url) { return cntvAudio(this.host, url); }
  });
})();

// ---------- 新闻联播（tv.cctv.com/lm/xwlb）：和百家讲坛用的是同一套栏目接口 ----------
// 两种“书”：某一天的（完整版 + 当天的每一条新闻，各是一集），和某个月的（每天的完整版各是一集，可以连着听）。
(function () {
  var PAGE = 'https://tv.cctv.com/lm/xwlb/index.shtml';
  var TOPIC = 'TOPC1451528971114112';
  var LIST = 'https://api.cntv.cn/NewVideo/getVideoListByColumn?id=' + TOPIC + '&serviceId=tvcctv';
  var LOGO = 'https://p3.img.cctvpic.com/photoAlbum/page/performance/img/2019/5/29/1559095198581_853.jpg';
  var FIRST_YEAR = 2009;
  var RECENT = 40;   // “最近”一页取 40 期：每天 19 点和 21 点各一期，正好 20 天

  function options() { return { headers: { Referer: PAGE } }; }
  function two(n) { return (n < 10 ? '0' : '') + n; }
  function dayUrl(day) { return PAGE + '?d=' + day; }
  function dayTitle(day) { return '新闻联播 ' + day.slice(0, 4) + '-' + day.slice(4, 6) + '-' + day.slice(6, 8); }
  function isFull(title) { return title.charAt(0) !== '[' && title.indexOf('新闻联播') >= 0; }
  function playable(v) { return str(v, 'guid') && str(v, 'length') !== '00:00:00'; }

  // 完整版是哪一天的：标题里写着（“《新闻联播》 20261010 19:00”，早年是“新闻联播 2010-06-04 19：00”），没写就看播出时间
  function dayOf(v) {
    var m = /(20\d{2})-?(\d{2})-?(\d{2})/.exec(str(v, 'title')) || /(20\d{2})-(\d{2})-(\d{2})/.exec(str(v, 'time'));
    return m ? m[1] + m[2] + m[3] : '';
  }
  // 19 点的是首播，21 点的是重播。同一天两期都有时只留首播
  function isRerun(v) { return /21[:：]00/.test(str(v, 'title')) || / 21:/.test(str(v, 'time')); }

  // 一批完整版按天归并，每天留一期，保持原来的先后
  function byDay(list) {
    var map = {}, order = [];
    list.forEach(function (v) {
      var day = dayOf(v);
      if (!day || !isFull(str(v, 'title').trim()) || !playable(v)) return;
      if (!map[day]) { map[day] = v; order.push(day); }
      else if (isRerun(map[day]) && !isRerun(v)) map[day] = v;
    });
    return order.map(function (day) { return { day: day, video: map[day] }; });
  }

  function dayBook(d) {
    return { coverUrl: str(d.video, 'image') || LOGO, bookUrl: dayUrl(d.day), title: dayTitle(d.day), intro: str(d.video, 'brief'), status: '完整版 + 单条新闻' };
  }

  // 关键字是不是一个日期：20240315 / 2024-03-15 / 2024年3月15日 是某一天，202403 / 2024-03 / 2024年3月 是某个月
  function dateOf(keywords) {
    var k = String(keywords).trim();
    var m = /^(20\d{2})(\d{2})(\d{2})?$/.exec(k) || /^(20\d{2})\s*[-\/.年]\s*(\d{1,2})\s*(?:月\s*$|(?:[-\/.月]\s*(\d{1,2})\s*日?)?$)/.exec(k);
    if (!m) return null;
    var month = parseInt(m[2], 10), day = m[3] ? parseInt(m[3], 10) : 0;
    if (month < 1 || month > 12 || day > 31) return null;
    return { month: m[1] + two(month), day: day ? m[1] + two(month) + two(day) : '' };
  }

  function monthBook(month) {
    return {
      coverUrl: LOGO, bookUrl: PAGE + '?m=' + month, title: '新闻联播 ' + month.slice(0, 4) + ' 年 ' + parseInt(month.slice(4), 10) + ' 月',
      intro: '这个月每天的《新闻联播》完整版，一天一集。', status: '按月连播'
    };
  }

  registerSource({
    id: 'b3a8f6d1c27e4f95a0d4e8b6c19f3a57', name: '新闻联播', url: PAGE,
    description: '央视《新闻联播》：可以按天听（完整版和当天的每一条新闻），也可以按月连着听每天的完整版。' +
      '搜索可以直接输日期（如 20240315、2024年3月），也可以输关键字找提到它的那几天。' +
      '播放的是节目视频的声音，比普通音频费流量；不能下载到本地。2015 年以前的节目网站上存得不全。',

    search: function (keywords, page) {
      var date = dateOf(keywords);
      if (date) return { books: page > 1 ? [] : [date.day ? { coverUrl: LOGO, bookUrl: dayUrl(date.day), title: dayTitle(date.day), intro: '', status: '完整版 + 单条新闻' } : monthBook(date.month)], totalPage: 1 };
      // 央视网的搜索：搜出来的是一条条新闻，按它是哪一天的归并成那一天的书，简介里列出搜到的几条
      var host = this.host;
      var json = host.getJson('https://search.cctv.com/m/if3g_search.php?page=' + page + '&qtext=' + Shun.enc('新闻联播 ' + keywords) +
        '&type=video&sort=DATE&pageSize=20&channel=', { headers: { Referer: 'https://search.cctv.com/m/search.php?type=video' } });
      var map = {}, books = [];
      items(json, 'list').forEach(function (v) {
        var m = /\/(20\d{2})\/(\d{2})\/(\d{2})\/VIDE/.exec(str(v, 'PAGELINK'));
        var title = host.htmlDecode(str(v, 'DRETITLE').replace(/<[^>]+>/g, '')).replace(/^\[视频\]/, '').trim();
        if (!m || !title) return;
        var day = m[1] + m[2] + m[3];
        if (!map[day]) { map[day] = { coverUrl: str(v, 'IMAGELINK') || LOGO, bookUrl: dayUrl(day), title: dayTitle(day), intro: '', status: '完整版 + 单条新闻' }; books.push(map[day]); }
        if (title.indexOf('《新闻联播》') < 0) map[day].intro += (map[day].intro ? '\n' : '') + title;
      });
      return { books: books, totalPage: Math.max(page, Math.min(50, Math.ceil(int(json, 'total') / 20))) };
    },

    categoryMenus: function () {
      var tabs = [];
      for (var y = new Date().getFullYear(); y >= FIRST_YEAR; y--) tabs.push({ title: String(y), url: 'xwlb:year:' + y });
      return [{ title: '按天', tabs: [{ title: '最近', url: 'xwlb:recent:1' }] }, { title: '按月连播', tabs: tabs }];
    },

    categoryPage: function (url) {
      var m = /^xwlb:(recent|year):(\d+)$/.exec(url);
      if (!m) throw new Error('不认识的分类地址：' + url);
      var n = parseInt(m[2], 10);
      if (m[1] === 'year') {
        var now = new Date(), books = [];
        for (var month = n === now.getFullYear() ? now.getMonth() + 1 : 12; month >= 1; month--) books.push(monthBook(n + two(month)));
        return { books: books, currentPage: 1, totalPage: 1, nextUrl: null };
      }
      var json = this.host.getJson(LIST + '&n=' + RECENT + '&sort=desc&mode=0&p=' + n, options());
      var list = items(json, 'data.list');
      var total = list.length === 0 ? n : Math.max(n, Math.ceil(int(json, 'data.total') / RECENT));
      return { books: byDay(list).map(dayBook), currentPage: n, totalPage: total, nextUrl: n < total ? 'xwlb:recent:' + (n + 1) : null };
    },

    bookDetail: function (bookUrl) {
      var host = this.host, m = /[?&]([dm])=(\d{6,8})/.exec(bookUrl);
      if (!m) throw new Error('不认识的地址：' + bookUrl);
      var episodes = [], cover = LOGO, intro = '';
      function episode(title, v) { return { title: title, url: PAGE + '?guid=' + str(v, 'guid') }; }
      if (m[1] === 'm') {
        var days = byDay(items(host.getJson(LIST + '&n=100&sort=asc&mode=0&p=1&d=' + m[2], options()), 'data.list'));
        days.sort(function (a, b) { return a.day < b.day ? -1 : a.day > b.day ? 1 : 0; });
        days.forEach(function (d) {
          if (d.day.slice(0, 6) === m[2]) episodes.push(episode(parseInt(d.day.slice(4, 6), 10) + ' 月 ' + parseInt(d.day.slice(6), 10) + ' 日', d.video));
        });
        if (episodes.length === 0) throw new Error('网站上没有存这个月的节目');
        var book = monthBook(m[2]);
        return { title: book.title, coverUrl: cover, intro: book.intro, status: episodes.length + ' 天', episodes: episodes };
      }
      // 某一天的全部视频：完整版（19 点、21 点各一期）和拆开的每一条新闻，按播出顺序
      var list = items(host.getJson(LIST + '&n=100&sort=asc&mode=2&p=1&d=' + m[2], options()), 'data.list').filter(playable);
      var full = byDay(list.filter(function (v) { return dayOf(v) === m[2]; }))[0];
      if (full) { episodes.push(episode('完整版', full.video)); cover = str(full.video, 'image') || LOGO; intro = str(full.video, 'brief'); }
      var seen = {};
      list.forEach(function (v) {
        var title = str(v, 'title').trim();
        if (isFull(title) || seen[str(v, 'guid')]) return;
        seen[str(v, 'guid')] = true;
        episodes.push(episode(title.replace(/^\[视频\]/, '').trim(), v));
      });
      if (episodes.length === 0) throw new Error('网站上没有这一天的节目（当天的节目一般晚上八点以后才有）');
      return { title: dayTitle(m[2]), coverUrl: cover, intro: intro, status: (full ? '完整版 + ' : '') + (episodes.length - (full ? 1 : 0)) + ' 条新闻', episodes: episodes };
    },

    audio: function (url) { return cntvAudio(this.host, url); }
  });
})();
