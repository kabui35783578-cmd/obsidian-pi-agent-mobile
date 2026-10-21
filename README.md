# Pi Agent Mobile · 测试版

当前测试版本 **0.2.1**：修复状态栏遮挡，自动适配设备安全区。更新说明见 [UI-CHANGELOG.md](UI-CHANGELOG.md)。

Android / iPhone 上的 Obsidian 交互插件：手机聊天，电脑执行模型、Skills、MCP、笔记与命令任务。

**目前仅供测试，不是手机本地运行完整 Pi。** 配套电脑需要运行 Pi Agent 0.8.0 或更新的兼容版本，并启用“手机连接”。电脑完整版暂未在本仓库发布。

## 用 BRAT 安装

1. 手机 Obsidian 升级到 **1.11.4 或更新版本**，在第三方插件中安装并启用最新版 **BRAT**（至少 1.1.0）。
2. 打开 BRAT 设置，选择 **Add Beta plugin**，填入：

   ```text
   kabui35783578-cmd/obsidian-pi-agent-mobile
   ```

3. 选择测试版本 **0.2.1**，安装并启用 **Pi Agent Mobile**。已安装旧版的用户，也请在 BRAT 中选择此版本更新。
4. 电脑进入“设置 → Pi Agent → 连接 → 手机连接”，启用连接、选择手机能访问的电脑局域网/VPN 地址，生成一次性配对码。
5. 手机打开“Pi Agent Mobile → 电脑连接”，粘贴配对码连接。配对码是 `pi-agent:…` 开头的完整文本，可用扫码工具读取电脑二维码后复制。

只需安装 Release 中的 `main.js`、`manifest.json`、`styles.css`，由 BRAT 自动处理。不需要下载源码、Node、Pi SDK 或配置账号。默认头像已内嵌，独立 ID `pi-agent-mobile` 不覆盖电脑插件 `pi-agent`。

如果手机通过同步已经装有旧的 **Pi Agent**，请先在手机停用旧插件，再启用 **Pi Agent Mobile**，避免两个手机入口重复注册。电脑端继续使用原来的 Pi Agent。

## 可以测试什么

- 助手通讯录、手机发消息、流式回复、停止任务。
- 总管委派记录、进入子助手会话与共同历史。
- 电脑笔记只读预览、将会话归档为电脑所属文件夹中的 Markdown。
- 前后台恢复、断线重连、重复提交去重、电脑撤销设备。

手机和电脑需处于同一局域网，或通过已有 VPN 连通；必要时在 Windows 防火墙允许配置的监听端口。没有公网中继或自动穿透。电脑必须开机、唤醒并保持 Obsidian 和 Pi Agent 运行。手机锁屏后暂停接收，恢复前台后重新读取进度，电脑上的任务继续执行。

手机无需与电脑同步同一个库。历史与归档默认在电脑；手机发出的任务使用电脑助手现有权限，包含总管已获准的库外文件和终端权限。仅与自己的电脑配对。ChatGPT/API、微信、Bark 与 MCP 凭证留在电脑；手机连接密钥使用本机 Obsidian SecretStorage，不进入插件同步配置。

## 测试与反馈

已检查三文件入口只依赖 Obsidian API，默认头像无需额外资源目录。发布前会执行 TypeScript、构建和入口回归检查，并对下载的 Release 文件核对 SHA-256。现有电脑项目还有加密通信、去重、权限及受控 Pi SDK 测试。

**Android/iPhone 真机安装、配对、系统局域网权限和跨设备往返尚需你测试。** 如有问题，在 Issues 提供手机系统、Obsidian/插件版本、操作步骤及错误文字；不要提交配对码、密钥、账号信息或私人聊天。

## 开发与发布

```sh
npm ci
npm run verify
```

此仓库仅包含手机端源码和必要的浏览器共享模块；来自本地 Pi Agent 开发项目的手机入口，不包含电脑运行进程、账号或个人笔记。修改应先在主开发目录完成，再更新此手机发布目录。

GitHub Actions 在提交时验证构建；版本 tag 必须与 manifest/package/versions 一致（例如 `0.1.0`），随后发布标记为 **Pre-release** 的三文件测试版本。不会提交 Obsidian 社区插件市场。

遵循 [BRAT 开发者指南](https://github.com/TfTHacker/obsidian42-brat/blob/main/BRAT-DEVELOPER-GUIDE.md)。MIT 许可证；Obsidian API 由宿主提供，不包含 Pi、微信、Node 等桌面依赖。
