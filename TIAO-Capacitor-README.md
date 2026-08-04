# TIAO-Capacitor 技术路线与接手说明

> 更新于 2026-08-05。本文记录私人 Android/Capacitor 分支的实际架构、已经完成的功能、构建部署方式和后续接手边界。基线提交为 `a3c53f6`。

## 1. 一句话定位

`TIAO-Capacitor` 是条条自用的 SullyOS Android 封装分支：在 SullyOS 原有网页功能上增加 Capacitor、原生 FCM 和 AMSG2 的移动端闭环。

不要把这个分支整体合并进共同维护的 `master`。通用 bug 修复可以拆成干净分支提交给 `master`；Capacitor、Firebase、私人 Worker 地址、签名和发布脚本应继续只留在 `TIAO-Capacitor`。

## 2. 仓库、服务和产物

| 对象 | 当前值 | 说明 |
| --- | --- | --- |
| SullyOS 本机源码 | `D:\CHICK\SullyOS-ALWAYSMAIN` | 当前分支 `TIAO-Capacitor` |
| Capacitor 包装工程 | `D:\CHICK\CHICK2` | `dist` 由同步脚本替换，Android 工程和原生配置留在这里 |
| Worker fork | `qegj567-cloud/sullyos-workers` 的 `main` | 只承载私人 Worker 改动；可以自由更新 |
| Worker 临时克隆 | `C:\Users\tiaotiao\AppData\Local\Temp\sullyos-workers-tiao-20260803` | 临时目录可能被清理；丢失时重新克隆 fork 即可 |
| Cloudflare Worker | `damp-dust-153a` | 自己部署的 AMSG2 Worker |
| 自定义入口 | `https://amsg.noir2.cc.cd` | App 默认使用这个地址 |
| 已部署 Worker 版本 | `ae48510f-358f-4665-a188-315c20ee6504` | 2026-08-05 记录值，重新部署后会变化 |
| 最近 APK | `D:\CHICK\CHICK2\SullyOS-TIAO-a3c53f6-release.apk` | 非 debuggable 的个人直装 release 包 |
| APK SHA-256 | `E440555058580C77F54413B351762B0030BBC0A84B859D6A53356B79FD01DAD8` | 用于核对上述产物 |
| Android 包名 | `com.aetheros.simulator` | 应用名为“手抓糯米机” |

Firebase 服务账号、Cloudflare Token、AMSG 主密钥、API Key、D1 ID 等秘密不写入本文，也不应提交进 Git。

## 3. 核心技术路线

```text
用户发送消息
  -> 先写入本地聊天数据库（包括卡片/链接替换后的最终内容）
  -> 标记 AMSG 状态变更并立即刷新 fire_pack
  -> Worker 保存该角色的最新 client_state

定时任务到点
  -> Worker 此时读取最新 fire_pack，而不是使用创建任务时冻结的旧提示词
  -> 组合角色、最近聊天、用户资料和任务指令
  -> 调用模型
  -> 按真实换行拆成一个或多个气泡
  -> 通过 FCM 推送到 Android

Capacitor App 收到或恢复通知
  -> 原生 PushNotifications listener / delivered-notification 恢复
  -> 写入 ActiveMsg inbox
  -> 去重后写入对应角色的本地聊天数据库
```

这里最关键的修复不是“角色回复后才更新快照”，而是：用户消息真正存入数据库之后立刻同步。于是下面这种情况也能读到最新上下文：

1. 先约定一个未来时间并成功建立任务；
2. 用户随后只发送“密码是我也爱你”；
3. 不再触发一次普通 AI 回复；
4. 到点的主动消息仍应看到这句密码。

Worker 中的任务主要保存“何时触发”和“到点想做什么”。真正的角色上下文由到点时读取的最新 `fire_pack` 提供。

## 4. 已完成改动和提交索引

| 提交 | 内容 |
| --- | --- |
| `c7f1c40` | 私人 Capacitor AMSG2 推送基础接入 |
| `fa79228` | Capacitor 环境改走原生 FCM，不再依赖浏览器 Push API |
| `c98eeeb` | 无原生工具调用能力的 API 也可用文本工具回退；增加任务运行记录 |
| `04ab686` | 强化显式文本排程，减少无工具 API 漏建任务 |
| `b03d84c` | 持久化并恢复原生通知消息，覆盖 App 被杀后从图标或通知进入的情况 |
| `f712633` | 恢复表情、转账、生活记录等畸形 action 指令，减少“两个框变一个普通文本框” |
| `1ad11f2` | 普通回复结束时刷新 AMSG 上下文 |
| `617be28` | 用户消息保存后立即刷新 AMSG 上下文；这是“密码没被看到”的最终关键修复 |
| `a3c53f6` | 将用户发送时同步修复合入 `TIAO-Capacitor` |

多气泡目前是强提示：模型被要求优先输出 2–3 条短消息并用真实换行分隔，Worker 会按换行拆分；这不是绝对强制，模型仍可能只返回一条。

## 5. 对未使用 AMSG2 用户的影响

AMSG2 没启用或当前没有有效任务时，发送路径只经过一个本地轻量状态门卫并立即跳过：

- 不上传聊天、角色卡、API Key 或向量记忆；
- 不请求 AMSG2 Worker；
- 不给模型注入 AMSG2 工具或排程提示；
- 普通请求的 `messages` 内容不变；
- 不改原来的收消息、发消息、记忆和存档管线。

因此对普通用户没有功能性变化。理论上只多一次很轻的本地条件判断；没有额外网络延迟。只有本地 ActiveMsg inbox 本来就有待入库消息时，正常的 inbox 消费逻辑才会写聊天记录。

## 6. 构建 Android 正式直装包

在 SullyOS 根目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\sync-tiao-capacitor.ps1 `
  -WrapperRoot D:\CHICK\CHICK2 `
  -AndroidBuildType Release
```

脚本会：

1. 用 `capacitor` mode 构建 Web 资源，隐藏开发角标；
2. 只替换 `D:\CHICK\CHICK2\dist`；
3. 执行 `npx cap sync android`；
4. 构建非 debuggable 的 release APK。

`.env.capacitor` 中的公开构建开关为：

```dotenv
VITE_AMSG_NATIVE_PUSH=true
VITE_AMSG_DEFAULT_WORKER_URL=https://amsg.noir2.cc.cd
```

当前个人直装 release 包为了能覆盖旧安装并保留本地聊天数据，仍使用同一份 Android debug certificate 签名；APK 本身是 release、`debuggable=false`，但这不是 Google Play 正式生产签名。现用证书 SHA-256 为：

```text
d644dddeeb6e00191f90cf621cca2649f372a653c2c37066def2f8f9c81ef1c8
```

不要随便换证书，否则 Android 会拒绝覆盖安装；卸载重装又会清掉 App 本地数据。

## 7. Worker 同步和部署

先在 SullyOS 中构建 Worker：

```powershell
node scripts/build-workers.mjs
```

然后只把下面这个 AMSG 产物同步到 `sullyos-workers` fork 的对应位置：

```text
worker/amsg/worker.bundle.js
```

不要顺手提交 `instant-worker`、`sw-keep-alive` 等与本次 AMSG 改动无关的生成噪音。当前工作区里这类文件可能已有用户自己的修改，必须保留并避开。

Worker fork 的 `.wrangler/deploy.local.toml` 是私人且不跟踪的部署配置，不能提交秘密。进入 fork 的 `amsg` 目录后部署：

```powershell
npx wrangler deploy --config .wrangler/deploy.local.toml
```

部署后至少检查：

- `https://amsg.noir2.cc.cd` 可访问；
- Wrangler 返回的新版本 ID；
- App 的任务列表、运行记录和 FCM 状态都能正常刷新；
- 一次真实定时任务能推送并写回聊天。

## 8. 与 master 同步的原则

同步上游的一般顺序：

```powershell
git fetch origin
git switch TIAO-Capacitor
git merge origin/master
```

处理冲突后运行测试和 Capacitor 构建，再推 `TIAO-Capacitor`。不要把 `master` 强制重置到私人分支，也不要把整个私人分支反向合入 `master`。

如果发现共同用户也会遇到的 bug：

1. 从最新 `master` 新建独立修复分支；
2. 只挑通用修复和测试；
3. 不带入 Capacitor、FCM、私人域名、签名或部署配置；
4. 合入 `master` 后，再把 `master` 合回 `TIAO-Capacitor`。

表情/转账格式恢复属于通用修复；原生 FCM、通知恢复、个人 release 打包属于私人分支能力。

## 9. 回归测试与验收清单

推荐至少执行：

```powershell
npm run test:run -- utils/amsgStateSync.test.ts utils/amsgStateSync.wiring.test.ts
npm run test:run -- utils/amsg2TextToolFallback.test.ts utils/nativeAmsgPush.test.ts
npm run test:run -- worker/amsg/src/index.test.ts worker/amsg/src/nativeFcm.test.ts
npm run build:workers
```

完整发布前再确认：

- Vite `capacitor` mode 构建成功；
- `aapt dump badging` 中没有 `application-debuggable`；
- `apksigner verify` 通过且证书没有意外改变；
- `dist` 中没有“开发中内容，不代表最终效果”的角标文案；
- 手机上 FCM 权限为 `granted`、Token 已注册；
- “先排程 → 用户只补一句密码 → 不触发普通回复 → 到点”的消息能读到密码；
- 通知从前台、后台、App 被杀、点通知和直接点图标进入时都不会丢；
- 同一条多气泡主动消息只入库一次。

## 10. 已知限制

- 当前原生推送只完成 Android FCM；iOS/APNs 尚未配置。
- 用户发送后的状态同步依赖网络。同步失败会按现有机制重试，但目前没有很醒目的“云端快照仍是旧的”状态提示。
- 多气泡是提示与后处理共同实现，不是对模型输出条数的硬性保证。
- 个人 release 沿用 debug certificate 只是为了本地覆盖升级，不适合商店发布。
- Worker fork 可以按上游更新，但要保留 FCM body、私人部署配置和 App 约定字段。

## 11. C 盘减负后的 Android 目录

大型开发缓存已经搬到 D 盘，C 盘原路径保留 NTFS 目录联接，所以 Android Studio、模拟器和 Gradle 仍按原路径工作：

```text
C:\Users\tiaotiao\.android\avd
  -> D:\CHICK\AndroidCache\avd

C:\Users\tiaotiao\.gradle
  -> D:\CHICK\AndroidCache\gradle
```

2026-08-05 验证结果：

- 模拟器仍能识别 `Medium_Phone_API_36.1`；
- Gradle 正式打包所需的 `8.2.1` 分发保存在 D 盘缓存；
- Capacitor wrapper 当前还声明 `9.0-milestone-1`，但发布脚本会优先选用经过验证的 `8.2.1`；
- C 盘可用空间从约 `0.74 GiB` 增加到约 `18.76 GiB`；
- Chrome 用户数据没有移动或清理。

不要删除 `D:\CHICK\AndroidCache\avd` 或 `D:\CHICK\AndroidCache\gradle`；C 盘上的目录只是兼容入口。若目录联接被误删，应重新创建联接，而不是让工具在 C 盘重新下载一整份。

## 12. 换窗口后的接手清单

1. 确认当前仓库和分支：`D:\CHICK\SullyOS-ALWAYSMAIN` / `TIAO-Capacitor`。
2. 先看 `git status`，避开用户已有的 bundle、附件、worktree 和 `android/` 改动。
3. `git fetch` 后比较 `master`，需要时把 `master` 合入私人分支。
4. 修改 AMSG 时同时考虑 Web Worker、原生 FCM、inbox 入库和 App 被杀恢复四段。
5. Worker 只部署到自己的 `sullyos-workers` fork 和 `amsg.noir2.cc.cd`。
6. 打包一律用 `scripts/sync-tiao-capacitor.ps1` 的 `Release` 模式。
7. 任何秘密只放本机未跟踪配置或 Cloudflare/Firebase secret，绝不写 README 或提交 Git。
