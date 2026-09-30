# 项目协作约定

- 日常开发在 `develop` 分支进行；开始修改前确认分支和工作区状态，保留用户未提交的更改。
- 完成功能和验证后再合并到 `main`。合并及推送按用户当次授权执行，不因存在 CI 就自动发布未获授权的开发内容。
- 本地继续使用 Node.js（`npm start` 或 `npm run start:background`）测试，数据保存在本地 `data/`。不要将本地服务自动改为使用 GHCR 镜像。
- `main` 推送触发测试、容器构建与验证，然后发布 `ghcr.io/cuituesday/mojian`；`develop` 和面向 `main` 的 PR 只运行测试，不发布镜像。
- GHCR 镜像留给后续服务器部署。当前不配置自动部署，不上传 `data/`、日志、密钥或本地依赖。
