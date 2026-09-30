const text = (id, x, y, content, size = 20, width = 380, height = 30, extra = {}) => ({ id, type: 'text', x, y, width, height, text: content, size, color: '#111111', bold: true, lineHeight: 1.1, fit: true, ...extra });
const rect = (id, x, y, width, height, color = '#111111') => ({ id, type: 'rect', x, y, width, height, color });
const widget = (id, type, x, y, width, height, extra = {}) => ({ id, type, x, y, width, height, color: '#111111', ...extra });
const base = (id, name, description, elements) => ({ id, name, description, builtin: true, width: 400, height: 300, background: '#ffffff', elements });
const weatherHeader = () => [
  widget('icon', 'weather-icon', 12, 12, 64, 58),
  text('temp', 88, 14, '温度：{{temperature}}°C', 18, 99, 24),
  text('humidity', 88, 44, '湿度：{{humidity}}%', 18, 99, 24),
  rect('v1',190,10,1,61), text('month',198,12,'{{month}}月',24,84,28,{align:'center'}),
  text('day',198,40,'{{day}}',32,84,35,{align:'center'}), rect('v2',290,10,1,61),
  text('lunar',298,13,'{{lunarDate}}',23,96,26,{align:'center'}), text('weekday',298,43,'{{weekday}}',23,96,26,{align:'center'}), rect('rule',10,80,380,1)
];
const themes = [
  base('calendar', '极简日历', '大字日期 · 中英星期 · 农历', [
    text('year',10,12,'{{year}}年',25,112,34),text('month-en',125,12,'{{monthEnglish}}',25,175,34,{align:'center'}),text('month',315,12,'{{monthNumber}}月',25,75,34,{align:'right'}),rect('line',10,50,380,1),
    text('day',8,57,'{{dayNumber}}',166,384,186,{align:'center'}),text('lunar',10,264,'{{lunarDate}}',25,138,33),text('week-en',150,265,'{{weekdayEnglish}}',23,144,32,{align:'center'}),text('weekday',298,264,'{{weekday}}',25,94,33,{align:'right'})
  ]),
  base('dashboard', '日历气象台', '农历、今明天气与日程，一屏查看', [
    text('date',5,2,'{{year}}年{{month}}月',19,230,27),text('battery',305,3,'电量 {{battery}}',15,88,24,{align:'right'}),rect('top',0,30,400,1),
    text('day',0,39,'{{dayNumber}}',92,108,109,{align:'center'}),text('week',110,60,'{{weekdayVertical}}',23,26,90),widget('icon','weather-icon',168,76,64,56),text('weather-flag',162,135,'{{weatherFlag}}',10,76,13,{align:'center',bold:false}),text('lunar-year',252,39,'{{lunarYear}} {{zodiac}} {{lunarMonth}}',21,145,28,{align:'center'}),text('lunar-day',245,69,'{{lunarDay}}',57,152,71,{align:'center'}),rect('middle',0,150,400,1),
    text('current-label',5,178,'当\n前',19,24,70),text('current',38,162,'温度:\n{{temperature}}°C\n湿度:\n{{humidity}}%',17,63,106),rect('v1',103,160,1,101),text('today',108,161,'今天\n{{condition}}\n{{high}}°C\n{{low}}°C',18,59,105,{align:'center'}),text('tomorrow',169,161,'明天\n{{tomorrowCondition}}\n{{tomorrowHigh}}°C\n{{tomorrowLow}}°C',18,54,105,{align:'center'}),rect('v2',225,160,1,101),text('schedule',239,173,'{{schedule}}',18,151,84,{align:'center'}),rect('bottom',0,269,400,1),text('city',5,275,'{{city}}',18,91,24),text('countdown',105,275,'{{countdown}}',17,290,24,{align:'right',color:'#ff0000'})
  ]),
  base('month-calendar', '农历月历', '完整月视图 · 周末标红 · 节日倒计时', [widget('month-grid','month-grid',0,0,400,249),rect('line',0,250,400,1),widget('icon','weather-icon',9,255,47,39),text('weather',61,256,'{{condition}} {{temperature}}°C {{weatherFlag}}',14,206,19),text('date',61,276,'{{monthNumber}}月{{dayNumber}}日（{{weekday}}）',14,217,21),text('city',281,255,'{{city}}',15,111,21,{align:'right'}),text('countdown',255,277,'{{countdown}}',12,139,20,{align:'right'})]),
  base('weather', '今日天气', '城市天气 · 今明预报 · 农历日期', [...weatherHeader(),text('city',16,99,'{{city}}',23,250,30),text('temperature',13,131,'{{temperature}}°',75,218,95,{align:'center'}),text('condition',244,140,'{{condition}}',28,144,38,{align:'center'}),text('humidity-body',224,188,'湿度 {{humidity}}%',18,163,30,{align:'center'}),rect('forecast-line',10,235,380,1),text('today',14,244,'今天 {{low}}° / {{high}}°',17,184,25),text('tomorrow',206,244,'明天 {{tomorrowLow}}° / {{tomorrowHigh}}°',17,184,25,{align:'right'}),text('source',14,277,'{{weatherSource}}',11,370,19,{bold:false})]),
  base('clock', '极简时钟', '时间、日期与农历', [text('date',12,15,'{{date}} · {{weekday}}',20,376,32),rect('top',10,54,380,1),text('time',8,88,'{{time}}',88,384,116,{align:'center'}),rect('bottom',10,242,380,1),text('lunar',12,261,'{{lunarYear}}年 {{lunarDate}}',24,376,33,{align:'center'})]),
  base('trending', '微博热搜', '天气日期抬头 · 热搜列表 · 自动翻页', [...weatherHeader(),widget('items','feed',10,95,380,159,{source:'trending',size:18,lineHeight:1.1,bold:true}),text('source',10,265,'{{trendingStatus}}',10,205,29,{bold:false}),text('page',219,268,'微博热搜 {{trendingPage}}/{{trendingPages}}',18,172,26,{align:'right'})]),
  base('news', '每日新闻', '天气日期抬头 · 新闻自动换行与分页', [...weatherHeader(),widget('items','feed',10,95,380,160,{source:'news',size:18,lineHeight:1.1,bold:true}),text('source',10,265,'{{newsStatus}}',10,202,29,{bold:false}),text('page',217,268,'每日新闻 {{newsPage}}/{{newsPages}}',18,174,26,{align:'right'})]),
  base('scenic-weather', '山间气象', '山野背景与城市天气', [widget('scene','landscape',0,0,400,300),rect('panel',12,12,250,165,'#ffffff'),text('city',24,22,'{{city}} · {{condition}}',20,224,31),text('temp',24,62,'{{temperature}}°',68,222,81),text('source',24,150,'{{weatherSource}}',11,226,23,{bold:false})]),
  base('memo', '一页备忘', '日期抬头与待办事项', [text('title',12,16,'今日备忘',28,222,38),text('date',248,24,'{{month}} / {{day}}',20,140,30,{align:'right'}),rect('line',10,65,380,2),text('memo',15,87,'{{memo}}',23,370,171,{lineHeight:1.6}),text('lunar',14,273,'{{lunarDate}} · {{weekday}}',17,370,23)])
];
const defaultSettings = {
  width:400,height:300,interval:'1005',timezone:'Asia/Shanghai',quietEnabled:false,quietStart:0,quietEnd:5,brightness:160,redThreshold:70,rotation:0,mode:'threshold',sound:false,
  serviceAddress:'',serverOverrideEnabled:false,serverHost:'',serverPort:4000,
  weatherLive:false,latitude:39.9042,longitude:116.4074,city:'北京',cityLocation:'北京市 · 中国',
  trendingSource:'weibo',newsSource:'toutiao',feedRotate:true,
  schedule:'当前没有日程',countdownName:'国庆节',countdownDate:'',
  memo:'□ 喝一杯水\n□ 阅读二十分钟\n□ 去户外走一走',trending:'手动内容 · 在这里填写热搜话题',news:'手动内容 · 在这里填写新闻标题'
};
module.exports = { themes, defaultSettings };
