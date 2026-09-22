# 笺藏 · 实体文档归档管家

面向单位部门间流转的纸质文件。Windows 桌面应用，业务、数据、安全和备份由 **Rust** 实现，Tauri 2 提供桌面容器，TypeScript + CSS 提供界面。不需要部署服务器。

## 功能

- 收文、发文、请示、其他文件四类登记：收文和发文使用发件人 / 收件人，请示使用拟稿部门 / 主送领导 / 经办人，其他文件使用发件人 / 收件人；收文增加实际接收日期，发文增加实际发出日期，请示和其他文件只保留签署日期。另支持文号、位置条目、备注。
- 文件状态为办件中、待归档、已归档；状态可直接筛选。
- 新建、编辑、查看、删除，收发类型切换时清除不适用的日期。
- 中文子串、拼音全拼、拼音首字母检索；空格分隔多个关键词，配合标签和文件状态筛选。拼音使用汉字默认读音，暂不做多音字语义消歧或错别字纠正。
- 标签分类、彩色色块标签、输入时自动匹配和上下键选择；正向关联会自动显示反向关联，删除记录时清除相关链接。
- 实体文件位置有独立的可增删改查目录，登记时可从下拉建议选择，也可直接输入新位置；文号支持常用六角括号模板。
- 设置按安全与隐私、外观与字体、档案资料、同步与备份分级；外观支持浅色 / 柔和 / 深色主题、四套主题色、MiSans 等中英文字体、90%–115% 字号、自定义图片背景和透明度。
- 本地 `.dag` 加密数据库导出、导入迁移；导入前自动保存当前数据库恢复副本。文件名使用 UTC 时间戳和随机后缀，拒绝覆盖已存在的备份。
- HTTPS WebDAV 手动备份，凭据加密存储，拒绝跨站重定向，上传使用 `If-None-Match: *`。目标文件夹需预先创建；远端恢复需先下载 `.dag` 再导入。
- 密码登录、修改密码、可配置的自动锁定（最长 8 小时或永不锁定）、连续失败尝试限流。
- 档案资料支持文号模板、物理位置、层级部门和多位领导；登记请示时可按部门自动填充领导。
- 可选 TOTP：SHA-1 / 6 位 / 30 秒，支持密钥复制、otpauth 链接复制及二维码，验证后才启用；修改安全设置需要重新验证身份。
- Windows NSIS `.exe` 安装程序，支持选择安装目录和覆盖升级。固定应用标识与独立的数据目录使升级保留档案。

## 使用

双击生成的 `笺藏_0.2.1_x64-setup.exe`，按向导选择安装路径。首次启动创建密码（至少 10 个字符），或从备份恢复。正式桌面版不会自动添加示例档案。

数据路径为 Tauri 的 `app_data_dir`，Windows 通常是：

```text
%APPDATA%\cn.jiancang.archive\archive.dag
```

以应用“安全设置”显示的实际路径为准。数据库独立于程序安装目录；覆盖安装前建议导出一次备份。安装包未进行商业代码签名。

`Ctrl+N` 登记文件，`Ctrl+K` 聚焦搜索，`Esc` 关闭弹窗。

## 加密与恢复边界

SQLite 数据库解锁后仅在内存中运行。序列化后使用 AES-256-GCM 加密，Argon2id 从密码派生密钥（64 MiB 内存、3 次迭代、1 条并行通道）。随机 16 字节盐和每次重新生成的 12 字节 nonce；文件头也经过认证。写入先同步同目录临时文件，再原子替换；临时文件里也是密文。每次修改先在候选数据库执行，落盘成功后才替换活动状态。

普通 SQLite 浏览器不能直接读取 `.dag`。该设计保护静态文件，不防御已经控制系统、读取进程内存的程序。TOTP 是应用登录的第二道验证，**不是数据库的第二个加密密钥**；获得密码和密文的攻击者仍可能自行解密。系统的分页文件和崩溃转储不在本应用的控制范围内。

密码不可找回。请在密码管理器中保管密码和 TOTP 密钥。修改密码或关闭 TOTP 不会更新已经导出的旧备份，恢复旧备份必须使用其原有密码及验证器；恢复会带回备份中的安全及 WebDAV 设置。

当前版本使用整库加密快照，数据库上限 64 MiB，适合个人文本档案。日期精度为“天”；不存放扫描件附件。大量数据每次写入需要重新加密整库，不适合多用户同时编辑。WebDAV 是手动备份，不是实时同步。

## 本地开发与打包

需要 Node.js 22.12+、Rust stable MSVC、Visual Studio C++ 构建工具、Windows SDK 和 WebView2。首次构建需要联网下载依赖及 NSIS 工具。桌面版缺少 WebView2 时，安装器会下载其引导程序。

```powershell
npm ci
npm run desktop
```

纯浏览器交互预览：

```powershell
npm run dev
```

浏览器预览使用内存中的示例档案，不持久化，真实加密、完整拼音检索、身份验证和备份必须使用桌面版。

验证与发行：

```powershell
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --lib
npm run test:ui
npm run package
```

UI 自动化默认使用已安装的 Microsoft Edge。安装包输出到 `src-tauri/target/release/bundle/nsis/`。运行时不依赖 Node.js 或 Rust 工具链。后续版本需同时更新 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 中的版本；保留 `identifier` 和数据格式迁移兼容性。

## 代码结构

```text
src/                     界面、表单与受限的预览适配器
src-tauri/src/model.rs    字段与输入校验
src-tauri/src/database.rs SQLite、拼音索引和关联完整性
src-tauri/src/vault.rs    密钥派生、认证加密和原子写入
src-tauri/src/service.rs  会话、CRUD、TOTP、备份和 WebDAV
src-tauri/src/tests.rs    Rust 数据与安全回归测试
tests/                   浏览器工作流测试
```

技术依据：[Tauri Windows 安装器](https://v2.tauri.app/distribute/windows-installer/)、[rusqlite](https://docs.rs/rusqlite/0.37.0/rusqlite/)、[totp-rs](https://docs.rs/totp-rs/5.7.2/totp_rs/)。
