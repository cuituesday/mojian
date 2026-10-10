# 中文天气地点索引

`china-cities.json` 提取自和风天气公开的 [LocationList 城市坐标表](https://github.com/qwd/LocationList/blob/master/China-City-List-latest.csv)，仅保留中国大陆的 3183 条地点名称、上级行政区、经纬度、时区、行政代码及来源地点编号。来源版本为 `China-City-List v202506200`，Git blob 为 `3ee735fa2176d305909c354386ef8e903bcdeee7`；数据字段顺序记录在 JSON 的 `columns` 中。

这里只使用公开地点信息建立本地搜索索引，不调用和风天气 API，也不需要和风天气密钥；天气仍由 Open-Meteo 按坐标提供。来源中部分区县使用简称，搜索会补充常见行政后缀；显示名称保留来源原文。匹配时按行政代码校正上级市名称，例如枣庄的市中区，避免源表中的少量上级名称错误。

索引随项目和 Docker 镜像部署，运行时不会自动下载或覆盖。行政区更名、合并后需要更新该快照，并运行 `node --test test/city-search.test.js` 检查检索结果。更新时读取来源 CSV（注意带逗号的引用字段），筛选 `ISO_3166_1=CN`，按 `columns` 对应字段提取，保留数据版本和 blob 以便追溯。本地未命中的地点继续查询 Open-Meteo；该目录不是实时行政区权威名录。
