# 墨间 · Ink Studio

## 启动

需要 Node.js 20 或以上版本。首次安装后运行：

```sh
npm install
npm start
```

打开 http://localhost:4000 。在「我的设备」复制电脑的局域网地址，填写到设备的自定义服务地址，例如 `http://192.168.1.20:4000/generate-image`。电脑与设备需要互通，防火墙允许 4000 端口，电脑不能休眠。可通过 `PORT=4001 npm start` 切换端口。

`npm start` 是前台运行，终端或运行会话结束时服务可能停止。需要关闭终端后继续运行时使用：

```sh
npm run start:background
```

后台启动会等待健康检查通过，重复执行不会启动第二个服务。日志按天保存在服务端的 `data/logs/`，默认保留 30 天。电脑重启后仍需重新执行启动命令，当前未安装系统自启动服务。

## 服务端文件存储

所有已保存业务数据都在运行 Node.js 服务的机器上，不在浏览器 localStorage / IndexedDB，也不需要数据库：

- `data/state.json`：配置、自定义主题（包括上传图片）、设备档案与最近请求记录。通过临时文件加重命名写入，重启服务时重新加载。
- `data/frames/`：每台设备仅保存最新一张 BMP，用于深夜保持画面；默认 30 天未使用后自动删除。
- `data/source-cache.json`：天气、微博热搜和新闻上次成功获取的数据与时间；服务重启后可继续使用。
- `data/logs/server-YYYY-MM-DD.log`：运行日志，按 UTC 日期分文件，前台、后台和容器启动均会保存；默认保留 30 天。

目前这台电脑就是服务端。以后部署到其他服务器时，迁移整个 `data/` 目录即可保留数据；不同浏览器通过同一服务访问同一份数据。尚未点击保存的编辑内容不属于已持久化数据。

## 自动清理与 BMP 保留

根目录 `config.json` 控制服务端文件清理，修改后重启服务生效。也可通过 `INK_CONFIG_FILE=/绝对路径/config.json` 指定配置文件；缺省字段使用以下默认值，非法值或拼错的字段会阻止启动并提示错误。

```json
{
  "logRetentionDays": 30,
  "frameRetentionDays": 30,
  "tempRetentionHours": 24,
  "cleanupIntervalMinutes": 60
}
```

- `logRetentionDays`：运行日志和请求记录的保留天数，默认一个月按 30 天计算；请求记录同时限制最多 200 条。日志文件按最后写入时间过期，旧版 `data/server.log` 也会按此规则清理。
- `frameRetentionDays`：BMP 最后一次生成或静默复用后，多少天未使用才删除。每台设备使用固定文件名覆盖上一张，没有历史图片队列。静默时段复用图片也会更新使用时间；缓存过期被清理后，下次请求会重新生成一张。
- `tempRetentionHours`：只清理异常退出遗留的 `state.json.tmp`、`source-cache.json.tmp` 和 `frames/<设备哈希>.bmp.tmp`，正常写入完成后它们会立即重命名，不会累积。
- `cleanupIntervalMinutes`：启动时先清理一次，运行期间默认每小时清理一次。因此到期文件可能延迟最多一个清理周期删除；服务停止期间，下次启动再清理。

以上均为正整数；天数范围 1–3650、临时文件小时数 1–8760、清理间隔分钟数 1–1440。清理不删除配置、自定义主题、上传图片或设备档案，也不遍历陌生目录或跟随符号链接。过期日志和缓存图片删除后不可恢复，需要历史留档时请另做备份。

400×300 的 BMP 每张约 352 KiB；10 台设备约 3.4 MiB，大小随输出分辨率变化。浏览器预览、主题缩略图、BMP 导出及 `istest=1` 只在内存中生成，不留服务端图片文件。下载到电脑的 BMP 由浏览器保管，不在服务清理范围内。

## 开发分支与自动构建

日常开发使用 `develop` 分支，本地仍通过 `npm start` 或 `npm run start:background` 运行 Node.js 服务，访问 `http://localhost:4000`。本地数据仍保存在 `data/`，无需 Docker，也不拉取 CI 发布的镜像。

`.github/workflows/ci.yml` 定义以下流程：

| 触发方式 | 执行内容 |
| --- | --- |
| 推送 `develop` | 安装依赖、运行 `npm test`，不构建或发布镜像 |
| 向 `main` 提交 Pull Request | 运行测试，不发布镜像 |
| 合并后推送 `main`（或直接推送 `main`） | 测试通过后构建镜像，验证容器启动和 BMP 渲染，再上传 GHCR |
| Actions 手动运行 | `main` 执行完整发布，其他分支只运行测试 |

镜像用于未来服务器部署，当前目标架构是常见 Linux x86_64 服务器的 `linux/amd64`：

- `ghcr.io/cuituesday/mojian:latest`：最近一次成功发布的 main 镜像。
- `ghcr.io/cuituesday/mojian:sha-<完整提交号>`：对应代码提交的镜像标签，供服务器固定版本或回滚使用。需要不可变引用时使用构建摘要中的 digest。

工作流使用 GitHub 自动提供的 `GITHUB_TOKEN` 和 `packages: write` 权限，无需额外配置 Docker Hub 或 GitHub PAT。仓库需要启用 GitHub Actions，并允许工作流中的 GitHub/Docker Actions。构建状态在仓库的 Actions 页面查看；失败时不会执行后续发布步骤。此流程不部署服务器，也不更新本地正在运行的服务。

GHCR 首次创建的镜像包通常默认为私有。未来服务器匿名拉取前，可由仓库所有者到 GitHub 的 Packages → mojian → Package settings 设置为 Public；保持私有则使用有 `read:packages` 权限的凭据登录 GHCR 后拉取。若包已存在且提示无推送权限，检查包的 Manage Actions access 是否授权本仓库。本配置不自动修改包可见性。

日常开发与发布命令（先保存当前编辑，确保工作区干净）：

```sh
git switch develop
git pull --ff-only origin develop
# 编辑代码、本地运行并验证
npm test
git add <本次修改的文件>
git commit -m "feat: 描述本次功能"
git push origin develop

# 功能完成后合并并发布；也可以在 GitHub 创建 develop → main 的 PR
git switch main
git pull --ff-only origin main
git merge --no-ff develop -m "Merge develop into main"
git push origin main

# 回到开发分支，同步发布后的 main
git switch develop
git merge --ff-only main
git push origin develop
```

以上流程是分支协作约定，未启用强制分支保护；如需强制 PR 审核或禁止直接推送 main，可另设 GitHub 分支规则。

## Docker 部署（未来服务器使用）

服务器可复用本仓库的 `compose.yaml` 和 `config.json`。使用 CI 镜像时，从 Compose 中移除 `build: .`，将 `image: ink-studio:local` 改为 `image: ghcr.io/cuituesday/mojian:latest`，保留端口、持久化数据卷和配置挂载。然后在服务器运行：

```sh
docker compose pull ink-studio
docker compose up -d --no-build ink-studio
```

需要固定版本时把 `latest` 改成相应的 `sha-<完整提交号>`。更新时继续使用同一 Compose 项目名和数据卷。下面保留从源码构建镜像的备用部署方式，当前本地开发仍使用上面的 Node.js 启动方式。

镜像使用 Node.js 24，包含 canvas 运行库和中文字体，以非 root 用户运行。推荐在项目目录使用 Compose：

```sh
docker compose up -d --build
docker compose ps
docker compose logs -f --tail=100
```

打开 `http://服务器IP:4000`；设备使用 `http://服务器IP:4000/generate-image`。容器内页面可能列出内部网卡地址，请使用宿主机局域网 IP 和已发布端口，不要填写容器内部 IP。本地 Node 服务已占用 4000 时，先停止它，或把 Compose 端口映射改为 `4001:4000` 并通过宿主机 4001 端口访问。

`compose.yaml` 将业务文件保存在命名卷 `ink-data` 中（实际名称带 Compose 项目前缀），重建/重启容器或 `docker compose down` 均保留。**不要使用 `docker compose down -v`，它会删除数据卷。** 根目录 `config.json` 只读挂载到容器，修改后执行 `docker compose restart`。备份时需保留数据卷内容和 `config.json`；默认新建卷不会自动导入已有的本地 `data/`。

如果需要继续使用现有本地 `data/`，将 Compose 中 `ink-data:/app/data` 改成 `./data:/app/data`。先停止原服务并备份，确保该目录对容器用户 UID/GID `1000:1000` 可读写（尤其是 Linux 宿主机）；同一目录只运行一个服务实例。

也可仅使用 Dockerfile：

```sh
docker build -t ink-studio:local .
docker run -d --name ink-studio --init --restart unless-stopped \
  --stop-timeout 15 -p 4000:4000 \
  -v ink-data:/app/data \
  --mount "type=bind,src=$(pwd)/config.json,dst=/app/config.json,readonly" \
  --log-opt max-size=10m --log-opt max-file=3 \
  ink-studio:local
```

容器以前台进程运行服务，支持健康检查和正常退出，不使用后台启动脚本。应用文件日志按 `logRetentionDays` 清理；Docker 标准输出日志单独按 10 MB × 3 个文件轮转，防止宿主机日志长期增长。天气和热榜功能需要容器能够访问对应公网接口。

## 功能

- 9多个只读内置主题：极简日历、日历气象台、农历月历、天气、时钟、微博热搜、每日新闻、山野背景天气、备忘录。
- 布局参考 400×300 墨水屏：大字日期、农历、周末标红、今明天气、日程和倒计时；电池电量仅使用设备实际上报值，无值显示 --，不模拟 Wi-Fi 信号。
- 复制模板或从空白创建主题。可添加文字、图片、色块、日历、农历月历、天气图标和动态列表，拖动、修改属性、调整层级，保存、预览及下载 BMP。文字支持对齐及单行自动缩小字号。已保存的旧主题副本不会被内置主题更新覆盖。
- 全局默认主题与单设备主题分配。首次携带 x-devid 的请求自动登记设备。
- 请求记录包含时间、来源 IP、路径、请求头和实际返回头；默认保留 30 天且最多 200 条，页面展示最近 100 条。常见认证字段会脱敏，但日志仍属于本地设备数据。
- 24 位 BMP，正确包含四字节行对齐，支持宽高调整、黑白红量化、Floyd–Steinberg 与 Atkinson 抖动、180° 旋转。
- 本地 JSON 保存主题、设备和设置；每设备 BMP 保存静默画面。数据位于 data/，可以整体备份。可用 INK_DATA_DIR 更改数据目录。
- 设置中可搜索城市/区县，选择结果自动填写地区、经纬度、时区并勾选真实天气，保存后应用。可手动设置坐标。Open-Meteo 提供当前天气和 7 日预报，缓存 10 分钟；关闭时使用带标注的示例天气。
- 热搜、新闻默认查询站点公开接口，也可选择手动输入。列表按画布宽高与字号分页；每台设备每个主题分别记住下一页，正常生成图片时翻页，静默保持期间不翻页。浏览器预览可以独立翻页，不改变设备页码。

## 信息接口（2026-09-29 实测）

| 用途 | 接口 | 当前实现 |
| --- | --- | --- |
| 微博热搜 | `https://weibo.com/ajax/side/hotSearch` | 读取 `data.realtime[].word`，过滤广告；实测成功 |
| 新闻头条 | `https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc` | 读取 `data[].Title`；实测成功。这是今日头条热榜，并非原创每日新闻摘要 |
| 城市检索 | `https://geocoding-api.open-meteo.com/v1/search` | `name` 查询中文或拼音地名；实测北京返回坐标 |
| 天气预报 | `https://api.open-meteo.com/v1/forecast` | 当前温度/湿度/天气码、7 日高低温；实测成功 |

微博、头条的字段与上游地址参考 [DailyHotApi](https://github.com/imsyy/DailyHotApi) 的 [微博适配器](https://github.com/imsyy/DailyHotApi/blob/master/src/routes/weibo.ts) 和 [头条适配器](https://github.com/imsyy/DailyHotApi/blob/master/src/routes/toutiao.ts)。实现自行编写，没有引入该项目依赖。其文档里的公共演示域名 `api-hot.imsyy.top` 本次无法解析，因此没有把演示服务设为依赖；有需要可另外自建 DailyHotApi。天气文档：[Open-Meteo](https://open-meteo.com/en/docs)、[Geocoding](https://open-meteo.com/en/docs/geocoding-api)。

热搜/新闻是网站当前使用的公开接口，可能受限或变更，并非有稳定性承诺的开放平台 API。服务端统一读取并缓存 10 分钟，同一数据源并发请求合并；失败后至少等待 60 秒再试。有旧数据时显示「旧缓存」及原获取时间，无缓存时明确显示获取失败。不同城市天气缓存隔离，不以另一个城市或手动示例冒充实时内容。在设置中点击「测试当前数据源」可检查实际错误，不必先保存表单。

## 当前协议边界

- 已知设备上报头：x-devid、x-model、x-bv、x-battery、x-logs。是否总会携带、单位和编码需真实设备确认。
- 已知刷新 wt 编码只有 1005=5 分钟、0=1 小时、1=2 小时；不猜测其他取值。
- 静默时段使用配置时区、开始包含/结束不包含，支持跨午夜。期间返回每台设备的上一张 BMP，仍返回所选 wt。不会阻止设备唤醒或物理重刷；首次无缓存生成一张。修改尺寸和主题在静默结束后应用。
- 提示音协议已接入：响应头 `sound: 0` 关闭、`sound: 1` 开启。每次正常设备请求均发送该值。
- 自定义服务器协议已接入：仅开启「下发自定义服务器地址」时发送 `burl: IP或域名` 和 `bport: 端口字符串`。关闭时两个字段都省略，不发送空串。主机不含 http://、路径或端口；保存设置后对所有设备的下一次请求生效。停止下发不会撤销已迁移设备的地址；迁移后旧服务可能再收不到设备请求。实际应用行为仍需硬件确认。
- 屏幕翻转和阈值在服务器处理图片。
- 保留 Demo 的 fver=1.0.0、fmd5 空值作为兼容默认。不查询厂商 OTA，不托管固件，也未验证设备固件升级行为。
- istest=1 用于浏览器预览，不登记设备，不返回设备控制头。管理页的预览接口也不会制造设备记录。
- 「近期有请求」根据最近 10 分钟记录判断，不能作为实时在线状态。设备可能按小时休眠。HTTP 成功仅代表服务已响应，没有设备显示回执。
- 全局输出尺寸默认 400×300，暂未按型号自动适配。接入不同分辨率设备前先确认规格。
- 当前版本适合受信任的局域网使用，管理接口尚未配置登录认证；不要直接暴露公网。

## 模拟接入

```sh
curl -D - -o /tmp/ink-device.bmp \
  -H 'x-devid: demo-device' \
  -H 'x-model: test-400x300' \
  -H 'x-battery: 85' \
  -H 'x-bv: 3.9' \
  -H 'x-logs: manual-test' \
  http://localhost:4000/generate-image
```

这会登记一台测试设备。真实测试时直接让硬件请求同一接口，然后在「请求记录 → 详情」检查完整数据。错误路径也会保留诊断记录；HTTP 服务实际接收到的请求才会出现。

运行 `npm test` 可验证 BMP、渲染、设备协议、静默、持久化与输入边界。测试使用独立临时数据目录，不混入真实设备数据。
