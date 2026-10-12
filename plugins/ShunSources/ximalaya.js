// ---------- 喜马拉雅 ----------
// 搜索、分类、专辑和章节用公开接口，不登录也能浏览；播放地址是加密的，要用宿主的 AES 解密。
// 免费内容不登录就能听；会员和已购买的内容，在插件页点“登录”用自己的账号登录后才能听。
(function () {
  var WEB = 'https://www.ximalaya.com';
  var KEY = 'aaad3e4fd540b0f79dca95606e72bf93'; // 播放地址的解密密钥（网页播放器里公开的）
  var PAGE_SIZE = 200;
  // 发现页显示哪些频道（网站的频道很多，只挑和听书相关的）
  var CHANNELS = ['youshengshu', 'guangbojv', 'xiangsheng', 'ertong', 'lishi', 'renwen', 'xiqu', 'qinggan'];

  function web(host, url) {
    return host.getJson(url, { desktop: true, headers: { Referer: WEB + '/' } });
  }

  function cover(u) {
    if (!u) return '';
    if (u.indexOf('//') === 0) u = 'https:' + u;
    u = u.replace(/^http:/, 'https:');
    // 去掉地址后面的图片处理参数，换成固定的小尺寸
    return u.split('!')[0] + '!op_type=3&columns=290&rows=290';
  }

  // 登录后网页留下的 Cookie 里有 1&_token（旧版宿主没有读 Cookie 的接口，当作没登录）
  function loggedIn(host) {
    return typeof host.cookies === 'function' && /(^|;\s*)1&_token=/.test(String(host.cookies(WEB + '/') || ''));
  }

  function albumUrl(id) { return WEB + '/album/' + id; }
  function albumId(url) { return (/album\/(\d+)/.exec(url) || [])[1] || ''; }
  function finished(v) { return String(v) === '2' ? '完结' : '连载'; }

  registerSource({
    id: '6e2b9c4d8a1f4d37b5c0e73a9f1d2b64', name: '喜马拉雅', url: WEB + '/',
    description: '喜马拉雅的有声书、广播剧、相声评书等。免费内容可以直接听；会员或已购买的内容，先点“登录”用自己的账号登录。',
    multipleEpisodePages: true,
    loginUrl: 'https://m.ximalaya.com/login', loginDesktop: false,

    // 宿主在登录页关闭后调用：已登录就返回昵称（显示在插件页），没登录就抛出错误
    checkLogin: function () {
      var json = web(this.host, WEB + '/revision/main/getCurrentUser');
      if (int(json, 'ret') !== 200 || !json.data) throw new Error('还没有登录喜马拉雅');
      return str(json, 'data.nickname') || str(json, 'data.nickName') || true;
    },

    // 搜索有两条路：
    // 1. 登录了的先用网页版的搜索，结果和在网站上搜的一样（没登录时网页版的搜索会被风控拦住，所以只在登录后用）；
    // 2. 老接口（旧版客户端用的）：不用登录，但匹配很死板，名字差一个字就搜不到。第一页结果太少时，把关键字从后面去掉几个字再搜，补到后面。
    search: function (keywords, page) {
      var host = this.host, kw = String(keywords).replace(/^\s+|\s+$/g, '');
      if (loggedIn(host)) {
        try {
          var album = at(web(host, WEB + '/revision/search/main?core=album&kw=' + encodeURIComponent(kw) + '&page=' + page +
            '&spellchecker=true&rows=20&condition=relation&device=iPhone&fq=&paidFilter=false'), 'data.album');
          var found = items(album, 'docs').filter(function (d) { return str(d, 'albumId'); }).map(function (d) {
            return {
              bookUrl: albumUrl(str(d, 'albumId')), title: str(d, 'title'), coverUrl: cover(str(d, 'coverPath')), artist: str(d, 'nickname'),
              intro: str(d, 'customTitle') || str(d, 'intro'),
              status: finished(d.isFinished) + ' · ' + int(d, 'tracksCount') + ' 集' + (d.isPaid ? ' · 付费' : '')
            };
          });
          if (found.length > 0) return { books: found, totalPage: Math.max(page, int(album, 'totalPage', page)) };
          host.log('喜马拉雅网页版搜索没有给出结果，改用老接口');
        } catch (e) {
          if (e.cancelled) throw e;
          host.log('喜马拉雅网页版搜索失败，改用老接口：' + e.message);
        }
      }

      function old(word, p) {
        var r = host.getJson('https://search.ximalaya.com/front/v1?core=album&kw=' + encodeURIComponent(word) + '&page=' + p +
          '&rows=20&spellchecker=true&condition=relation&device=android&version=9.0.75').response;
        return {
          totalPage: int(r, 'totalPage', p),
          books: items(r, 'docs').map(function (d) {
            return {
              bookUrl: albumUrl(str(d, 'id')), title: str(d, 'title'), coverUrl: cover(str(d, 'cover_path')), artist: str(d, 'nickname'),
              intro: str(d, 'custom_title') || str(d, 'intro'),
              status: finished(d.is_finished) + ' · ' + int(d, 'tracks') + ' 集' + (d.is_paid ? ' · 付费' : '')
            };
          })
        };
      }
      var result = old(kw, page), books = result.books;
      if (page === 1 && books.length < 5 && kw.length >= 4 && kw.indexOf(' ') < 0) {
        var seen = {};
        books.forEach(function (b) { seen[b.bookUrl] = true; });
        // 一次去掉一个字，最多试三次，最短留到一半
        for (var cut = 1; cut <= 3 && kw.length - cut >= Math.max(2, Math.ceil(kw.length / 2)) && books.length < 5; cut++) {
          try {
            old(kw.substring(0, kw.length - cut), 1).books.forEach(function (b) {
              if (!seen[b.bookUrl]) { seen[b.bookUrl] = true; books.push(b); }
            });
          } catch (e) { if (e.cancelled) throw e; }
        }
      }
      return { books: books, totalPage: Math.max(page, result.totalPage) };
    },

    // 每个频道一组，组里是它的子分类
    categoryMenus: function () {
      var menus = [], groups = items(web(this.host, WEB + '/revision/category/allCategoryInfo'), 'data');
      var found = {};
      groups.forEach(function (g) {
        items(g, 'categories').forEach(function (c) { found[str(c, 'pinyin')] = c; });
      });
      CHANNELS.forEach(function (pinyin) {
        var c = found[pinyin];
        if (!c) return;
        var tabs = [{ title: '全部', url: 'xm-cat:' + pinyin + ':#1' }];
        items(c, 'subcategories').forEach(function (s) {
          if (str(s, 'code')) tabs.push({ title: str(s, 'displayValue'), url: 'xm-cat:' + pinyin + ':' + str(s, 'code') + '#1' });
        });
        menus.push({ title: str(c, 'displayName'), tabs: tabs });
      });
      return menus;
    },

    categoryPage: function (url) {
      var m = /^xm-cat:([^:]*):([^#]*)#(\d+)$/.exec(url);
      var page = parseInt(m[3], 10), perPage = 30;
      var data = web(this.host, WEB + '/revision/category/queryCategoryPageAlbums?category=' + m[1] + '&subcategory=' + m[2] +
        '&meta=&sort=0&page=' + page + '&perPage=' + perPage).data;
      var books = items(data, 'albums').map(function (a) {
        return {
          bookUrl: albumUrl(str(a, 'albumId')), title: str(a, 'title'), coverUrl: cover(str(a, 'coverPath')), artist: str(a, 'anchorName'),
          status: finished(a.isFinished) + ' · ' + int(a, 'trackCount') + ' 集' + (a.isPaid ? ' · 付费' : '')
        };
      });
      // 网站最多能翻到 50 页左右，再往后是空的
      var total = Math.min(50, Math.ceil(int(data, 'total') / perPage));
      return {
        books: books, currentPage: page, totalPage: Math.max(total, page),
        nextUrl: books.length > 0 && page < total ? 'xm-cat:' + m[1] + ':' + m[2] + '#' + (page + 1) : null
      };
    },

    bookDetail: function (bookUrl, loadEpisodes, loadFullPages) {
      var host = this.host, id = albumId(bookUrl);
      var detail = { episodes: [] };
      try {
        var info = at(web(host, WEB + '/revision/album/v1/simple?albumId=' + id), 'data.albumPageMainInfo') || {};
        detail.title = str(info, 'albumTitle');
        detail.coverUrl = cover(str(info, 'cover'));
        detail.artist = str(info, 'anchorName');
        detail.intro = str(info, 'richIntro') || str(info, 'shortIntro');
        detail.status = finished(info.isFinished);
      } catch (e) {
        if (e.cancelled) throw e;
        host.log('取专辑信息失败：' + e.message);
      }
      if (!loadEpisodes) return detail;

      // 章节列表有两个接口，返回的样子一样：
      // 平时用第一个（登录后它会标出哪些章节已经买过 / 会员能听）；有些专辑它会说“已下架”，其实在网站和 App 上都能正常听，
      // 这时换第二个再取。两个都不行才把原因告诉用户
      var useBackup = false;
      function trackPage(page) {
        if (!useBackup) {
          var json = host.getJson('https://mobile.ximalaya.com/mobile/v1/album/track?albumId=' + id + '&pageId=' + page +
            '&pageSize=' + PAGE_SIZE + '&isAsc=true&device=android');
          if (int(json, 'ret') === 0) return json.data;
          if (page > 1) return null;
          host.log('喜马拉雅的章节接口说：' + str(json, 'msg') + '（' + str(json, 'ret') + '），换另一个接口再取');
          useBackup = true;
          var reason = str(json, 'msg');
        }
        var backup = host.getJson('https://mobile.ximalaya.com/mobile/others/ca/album/track/' + id + '/true/' + page + '/' + PAGE_SIZE);
        if (int(backup, 'ret') !== 0 || !backup.tracks) {
          if (page > 1) return null;
          throw new Error('喜马拉雅：' + (reason || str(backup, 'msg') || '获取章节失败（' + str(backup, 'ret') + '）'));
        }
        return backup.tracks;
      }

      try {
        for (var page = 1; page <= 500; page++) {
          var data = trackPage(page);
          if (!data) break;
          items(data, 'list').forEach(function (t) {
            // 付费专辑里也有可以免费试听的章节；已经买过 / 是会员时 isAuthorized 为 true
            detail.episodes.push({ title: str(t, 'title'), url: 'xm:' + str(t, 'trackId'), isFree: !t.isPaid || !!t.isFree || !!t.isAuthorized });
          });
          var max = int(data, 'maxPageId', 1);
          if (!loadFullPages || page >= max) break;
          host.progress((page + 1) + ' / ' + max);
          host.sleep(150 + Math.random() * 250);
        }
      } finally {
        host.progress(null);
      }
      return detail;
    },

    // 播放地址带时效签名，每次播放时现取；登录后请求会自动带上账号的 Cookie
    audio: function (url) {
      var id = String(url).replace(/^xm:/, '');
      var json = web(this.host, WEB + '/mobile-playpage/track/v3/baseInfo/' + Date.now() + '?device=web&trackId=' + id + '&trackQualityLevel=1');
      var list = items(json, 'trackInfo.playUrlList');
      if (list.length === 0) {
        throw new Error('这一集需要会员或购买后才能听：到插件页点开“喜马拉雅”→“登录”，用自己的账号登录后再试' +
          (str(json, 'msg') ? '（' + str(json, 'msg') + '）' : ''));
      }
      // 优先 64k 的 m4a，其次 mp3
      var order = ['M4A_64', 'MP3_64', 'M4A_24', 'MP3_32'], pick = list[0];
      for (var i = order.length - 1; i >= 0; i--) {
        list.forEach(function (u) { if (str(u, 'type') === order[i]) pick = u; });
      }
      var audio = this.host.aesEcbDecrypt(str(pick, 'url'), KEY);
      if (audio.indexOf('http') !== 0) throw new Error('喜马拉雅的播放地址解密失败，可能是网站改了加密方式');
      return audio;
    }
  });
})();
