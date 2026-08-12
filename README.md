# 转发器配置方案库

## 本地调试

`public/app.js` 是浏览器端脚本，不能用 `node public/app.js` 直接运行。它需要在浏览器环境中使用 `localStorage` 和 `document`。

推荐在 VS Code 中调试：

1. 打开当前项目文件夹。
2. 进入“运行和调试”。
3. 选择 `调试网页端`。
4. 按 F5。

也可以手动启动：

```powershell
python -m http.server 8788 --directory public
```

然后打开：

```text
http://localhost:8788
```

如果要用 Cloudflare Pages Functions 调试，后续安装依赖后使用：

```powershell
npm.cmd run dev
```
