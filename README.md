# 随身听书（安卓和ios版）

一个聚合听书工具。程序本身只是播放器，不带任何内容：听书源来自用户导入的**插件**，也可以听自己网盘和手机里的音频。

## 下载

- **安卓版 5.0**：[ssts-v5.apk](https://github.com/whykang/ssts--Android/releases/download/v5.0/ssts-v5.apk)
- **插件包 5.0**（33 个源，安卓和 iOS 通用）：[Sources-v5.zip](https://github.com/whykang/ssts--Android/releases/download/v5.0/Sources-v5.zip)
- **在线导入插件**：不用下载文件，在“插件”页选择从网址导入，填入下面的地址即可（国内网络可直接访问）

  ```
  https://gitee.com/whykan/ssxz/raw/master/Sources-v5.zip
  ```

- **iOS 版 5.0**（未签名 ipa，需要 iOS 17 及以上）：[ssts-ios-5.0-unsigned.ipa](https://github.com/whykang/ssts--Android/releases/download/v5.0/ssts-ios-5.0-unsigned.ipa)
- 历史版本：[Releases](https://github.com/whykang/ssts--Android/releases)

## 最近更新

**书源（插件包 5.0，共 33 个源）**

- 新增抖音：搜索视频和用户，听作品的声音，能听关注的人的直播（需要登录）
- 哔哩哔哩支持登录：发现页的“我的”里能看到自己的收藏夹和订阅的合集
- 哔哩哔哩、抖音：打开属于合集的视频时，自动列出整个合集，可以一集一集接着听（源的设置里可以关）
- 哔哩哔哩、抖音：默认只取声音那一路，更省流量（源的设置里可以关）
- 下载 [Sources-v5.zip](https://github.com/whykang/ssts--Android/releases/download/v5.0/Sources-v5.zip) 导入即可覆盖旧版本；旧版程序也能用，但哔哩哔哩的纯音频在 iOS 上需要 5.0 的程序

**程序（安卓、iOS 5.0）**

- 章节多的书可以分段查看：详情页按每 50 集分一段（全部、1-50、51-100……），点哪一段看哪一段
- 按区间下载：长按某一段下载这一段，或者在菜单里填“从第几集到第几集”
- 发现页可以只在当前这个源里搜索；需要人机验证的源可以直接去验证，没登录的源可以直接去登录
- 设置里可以调整底部标签的顺序，排第一个的是打开应用时先显示的
- 设置里新增“播放通道”：音乐（默认，导航播报等响起时压低音量接着播）或人声（这时暂停）
- 安卓：在最外层返回时要连着两次才退出，避免误触（设置里可以关）
- 安卓：修复有的手机上一开始播放就被自己的通知提示音打断
- 安卓：修复百家讲坛、新闻联播这类节目重新打开后从头播放
- iOS：修复有的下载文件播放时提示“无法打开”
- 修复发现页听书源名字太长时切换箭头不显示

## 界面预览

| 书架 | 发现 | 播放 | 插件 |
|:---:|:---:|:---:|:---:|
| ![书架](docs/images/library.jpg) | ![发现](docs/images/discover.jpg) | ![播放](docs/images/player.jpg) | ![插件](docs/images/plugins.jpg) |

## 功能

**听书源**

- **插件**：从文件或网址导入 zip 插件包，一个插件可以包含多个源；支持启用、禁用、排序、删除，源的登录和设置，一键测试和调试日志
- **网盘**：内置夸克网盘、百度网盘、阿里云盘、115 网盘和 WebDAV，在设置里开启并登录自己的账号后使用；每个文件夹是一本书，里面的音频是章节，可以指定只看某个目录
- **本地文件**：在设置里选择手机上的一个文件夹，子文件夹就是一本本书
- **广播电台**：内置“云听”的全国电台直播，也可以添加自定义电台

**找书**

- **发现**：按源浏览分类，一键切换听书源，滚动到底自动加载下一页，封面网格 / 列表两种显示
- **聚合搜索**：多个源同时搜索，结果按源筛选；需要人机验证的源可以在应用内完成验证
- **书架**：收藏的书和最近播放，记住每本书听到哪一集、哪个位置

**播放**

- 后台播放，通知栏 / 锁屏 / 耳机控制
- 断点续播、自动播放下一集
- 倍速 0.5x – 3x、音量调节，每本书记住自己的倍速和音量
- 下载到本机离线听
- 快进快退（步长可调）
- 定时关闭：本集结束后、预设时长或自定义分钟数
- 单书跳过片头片尾
- 章节倒序、按标题筛选、定位到上次听到的位置

**界面**

- 浅色、深色、跟随系统
- 7 种主题色

## 插件

这个仓库放的是插件相关的部分：开发文档、示例插件的源码和打好的插件包。

- 📦 [plugins/dist/ShunSources.zip](plugins/dist/ShunSources.zip)：打好的插件包（26 个听书源），下载后在 App 的“插件”页点 `+` →“从文件导入 zip”
> 插件包 3.0 里的部分新源（比如电台网的直播）需要配合最新版的 App 使用，旧版 App 导入后其它源不受影响。

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
