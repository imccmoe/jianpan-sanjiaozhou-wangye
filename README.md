# GXM 三键音乐键盘网页端

这是 `jianpan-sanjiaozhou-pyqt` 1.05 的网页端。公开界面与 Qt 版保持一致，只包含音乐星球、键位设置、设备维护和关于四个页面，不提供自定义乐谱编辑功能。

## 本地调试

```powershell
python -m http.server 8788 --directory public
```

然后打开：

```text
http://localhost:8788
```

Cloudflare Pages 本地调试：

```powershell
npm.cmd run dev
```

## 说明

音乐库曲谱仅作为内置数据在后台编译，用户可以试听、拖放到 K1～K3，并在真实设备连接后写入。设备通信使用与 Qt 版一致的 `1A86:FE01` WebHID Feature Report 协议，不提供模拟连接或虚假保存结果。

WebHID 需要安全上下文和 Chromium 浏览器。请使用 `http://localhost`、Cloudflare Pages 或 HTTPS 部署地址，并在 Chrome/Edge 中授权 GXM 键盘。
