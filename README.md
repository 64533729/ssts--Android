# 随身听书（安卓和ios版）

一个聚合听书工具。程序本身只是播放器，不带任何内容：听书源来自用户导入的**插件**，也可以听自己网盘和手机里的音频。

## 下载

- **安卓版 5.3**：[ssts-v5.3.apk](https://github.com/whykang/ssts--Android/releases/download/v5.3/ssts-v5.3.apk)
- **iOS 版 5.3**（未签名 ipa，需要 iOS 16 及以上）：[ssts-ios-5.3-unsigned.ipa](https://github.com/whykang/ssts--Android/releases/download/v5.3/ssts-ios-5.3-unsigned.ipa)
- **插件包 5.3**（34 个源，安卓和 iOS 通用）：[Sources-v5.3.zip](https://github.com/whykang/ssts--Android/releases/download/v5.3/Sources-v5.3.zip)
- **在线导入插件**：不用下载文件，在“插件”页选择从网址导入，填入下面的地址即可（国内网络可直接访问）

  ```
  https://gitee.com/whykan/ssxz/raw/master/Sources-v5.3.zip
  ```

- 历史版本：[Releases](https://github.com/whykang/ssts--Android/releases)

## 最近更新

**程序（安卓、iOS 5.3）**

- iOS 版最低支持到 iOS 16，之前要 iOS 17（感谢 [#20](https://github.com/whykang/ssts--Android/issues/20) 的建议）。注意：没有在 iOS 16 的设备上实际测试过，不能保证所有功能都正常，遇到问题欢迎反馈
- 新增云同步：在设置里填上坚果云账号（WebDAV），书架、播放记录、每本书听到哪里、书签可以在安卓、iOS、Mac 之间同步；书架右上角可以手动同步。设置里写清楚了哪些内容同步、哪些不同步
- 新增书签：播放页右上角可以在当前位置加书签、写备注，点书签就跳回那里接着听；详情页菜单里也能看这本书的书签
- 新增预缓存：播放时提前把这一集和后面几集下到本机，网络不好也不卡，听过去的自动删掉（设置里选缓存几集，可以只在 Wi-Fi 下缓存）
- 音量最高可以调到 200%，适合声音本来就小的书（iOS 上分段的流媒体和直播最多 100%）
- 定时结束前渐弱：定时快到时最后 30 秒慢慢调低音量再暂停（设置里可以关）
- 云听的央广频道（中国之声、经济之声等）可以回听最近 7 天播过的节目
- 书籍详情页点来源名字，直接跳到发现页看这个源
- 安卓：通知栏增加快退和退出按钮

**书源（插件包 5.3，共 34 个源）**

- 新增 13听书网（和爱听书是同一个后台，书很多）
- 爱听书、13听书网、29听书网、起点有声网：在插件页登录后能显示“已登录”
- 网易云播客：上千集的有声书能把节目全部列出来，以前最多只有 200 集
- 喜马拉雅：搜索结果里付费、会员专辑也能搜到
- 爱听书：修复有的手机上播放时报“证书链校验失败”
- 下载 [Sources-v5.3.zip](https://github.com/whykang/ssts--Android/releases/download/v5.3/Sources-v5.3.zip) 导入即可覆盖旧版本；如果已经装过 Gitee 上 5.4–5.7 的测试版插件，请手动重新导入一次

## 界面预览

| 书架 | 发现 | 播放 | 插件 |
|:---:|:---:|:---:|:---:|
| ![书架](docs/images/library.jpg) | ![发现](docs/images/discover.jpg) | ![播放](docs/images/player.jpg) | ![插件](docs/images/plugins.jpg) |

## 功能

**听书源**

- **插件**：从文件或网址导入 zip 插件包，一个插件可以包含多个源；支持启用、禁用、排序、删除，源的登录和设置，一键测试和调试日志
- **网盘**：内置夸克网盘、百度网盘、阿里云盘、115 网盘和 WebDAV，在设置里开启并登录自己的账号后使用；每个文件夹是一本书，里面的音频是章节，可以指定只看某个目录
- **本地文件**：在设置里选择手机上的一个文件夹，子文件夹就是一本本书
- **广播电台**：内置“云听”的全国电台直播，央广频道还能回听最近 7 天的节目；也可以添加自定义电台

**找书**

- **发现**：按源浏览分类，一键切换听书源，滚动到底自动加载下一页，封面网格 / 列表两种显示
- **聚合搜索**：多个源同时搜索，结果按源筛选；需要人机验证的源可以在应用内完成验证
- **书架**：收藏的书和最近播放，记住每本书听到哪一集、哪个位置；可以分类
- **云同步**：通过坚果云（WebDAV）在安卓、iOS、Mac 之间同步书架、播放记录、听书进度和书签

**播放**

- 后台播放，通知栏 / 锁屏 / 耳机控制
- 断点续播、自动播放下一集
- 倍速 0.5x – 3x、音量 0 – 200%，每本书记住自己的倍速和音量
- 下载到本机离线听，可以按区间下载；播放时自动预缓存后面几集
- 书签：记下某一集的某个位置，可以写备注
- 快进快退（步长可调）
- 定时关闭：本集结束后、播完几集、预设时长或自定义分钟数，结束前音量渐弱
- 单书跳过片头片尾
- 章节倒序、按标题筛选、定位到上次听到的位置

**界面**

- 浅色、深色、跟随系统
- 7 种主题色

## 插件

这个仓库放的是插件相关的部分：开发文档、示例插件的源码和打好的插件包。

- 📦 [plugins/dist/ShunSources.zip](plugins/dist/ShunSources.zip)：打好的插件包（5.3，34 个听书源），下载后在 App 的“插件”页点 `+` →“从文件导入 zip”

- 📖 [插件开发指南](docs/plugin-development.md)：插件包结构、源的写法、宿主提供的能力、调试和打包
- 🧩 [plugins/ShunSources](plugins/ShunSources)：示例插件的源码，覆盖了文档里提到的大部分写法

插件是一个 zip，里面放一个 `manifest.json` 和若干 JavaScript 脚本，脚本里用 `registerSource({...})` 注册源：

```js
registerSource({
  id: '0f9c0b5c2d7e4c1b9a0e6f3a2b1c4d5e',
  name: '我的站点',
  url: 'https://example.com',

  search: function (keywords, page) {
    var doc = this.host.getHtml('https://example.com/search?q=' + encodeURIComponent(keywords) + '&p=' + page);
    var books = doc.select('.item').map(function (e) {
      return { coverUrl: e.first('img').absUrl('src'), bookUrl: e.first('a').absUrl('href'), title: e.first('h3').text() };
    });
    return { books: books, totalPage: page };
  },

  bookDetail: function (bookUrl) {
    var doc = this.host.getHtml(bookUrl);
    return { episodes: doc.select('#playlist a').map(function (a) { return { title: a.text(), url: a.absUrl('href') }; }) };
  },

  audio: function (episodeUrl) {
    return this.host.getHtml(episodeUrl).first('audio').absUrl('src');
  }
});
```

完整说明见[插件开发指南](docs/plugin-development.md)。

## 说明

本程序只是播放器，不提供任何内容，所有音频都来自插件访问的第三方网站或用户自己的网盘和文件，请支持正版。
插件脚本会在本机访问网络，请只导入你信任的来源提供的插件。
