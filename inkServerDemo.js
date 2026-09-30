const express = require('express');
const https = require('https');
const { createCanvas, registerFont, loadImage } = require('canvas');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 4000;


function createBMPHeader(width, height) {
  const fileSize = 54 + width * height * 3; // 文件头大小 + 图像数据大小
  const header = Buffer.alloc(54);

  header.write('BM', 0);
  header.writeUInt32LE(fileSize, 2);
  header.writeUInt32LE(0, 6);
  header.writeUInt32LE(54, 10);
  header.writeUInt32LE(40, 14);
  header.writeInt32LE(width, 18);
  header.writeInt32LE(height, 22);
  header.writeUInt16LE(1, 26);
  header.writeUInt16LE(24, 28);
  header.writeUInt32LE(0, 30);
  header.writeUInt32LE(width * height * 3, 34);
  header.writeInt32LE(2835, 38);
  header.writeInt32LE(2835, 42);
  header.writeUInt32LE(0, 46);
  header.writeUInt32LE(0, 50);
  return header;
}


function convertToBMPData(imageData, width, height) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const paddingSize = rowSize - (width * 3);

  const bmpData = Buffer.alloc(rowSize * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixelIndex = ((height - 1 - y) * width + x) * 4; // 垂直翻转
      const r = imageData[pixelIndex];
      const g = imageData[pixelIndex + 1];
      const b = imageData[pixelIndex + 2];

      const bmpIndex = y * rowSize + x * 3;
      bmpData[bmpIndex] = b;     // B
      bmpData[bmpIndex + 1] = g; // G
      bmpData[bmpIndex + 2] = r; // R
    }
    for (let p = 0; p < paddingSize; p++) {
      const padIndex = y * rowSize + width * 3 + p;
      bmpData[padIndex] = 0;
    }
  }

  return bmpData;
}

app.get('/generate-image', async (req, res) => {

  var istest = req.query.istest;


  var devId = req.headers['x-devid'];//设备号
  var model = req.headers["x-model"];//型号
  var batteryValue=req.headers["x-bv"];//电压
  var battery=req.headers["x-battery"];//电池百分比 0-100
  var logs=req.headers["x-logs"];//启动日志


  const canvas = createCanvas(400, 300);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);



  // todo 这里可以显示你自定义的画面=============
  ctx.font = "30px Arial"
  ctx.fillStyle = "red";
  ctx.fillText("Hello, World!", 100, 100);

  var fver = '1.0.0';
  var fmd5 = '';
  // 获取最新固件信息
  try {
    var otaApi = "https://funnycoo.cn:4001/getOtaInfo?model=" + model + "&devId=" + devId;
    const response = await axios.get(otaApi);
    const data = response.data;
    if (data.success) {
      fver = data.data.ver;
      fmd5 = data.data.md5;
    }
  } catch (error) {
    console.log(error);
  }

  //数据返回============
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const bmpHeader = createBMPHeader(canvas.width, canvas.height);
  const bmpData = convertToBMPData(imageData.data, canvas.width, canvas.height);
  const buffer = Buffer.concat([bmpHeader, bmpData]);

  res.setHeader('Content-Type', 'image/bmp');
  if (!istest) {
    res.setHeader('Content-Disposition', 'attachment; filename="time-info.bmp"');
    res.writeHead(200, {
      'Content-Type': 'image/bmp',
      'Content-Length': buffer.length, // 如果知道确切大小的话
      'Connection': 'close',
      'wt': "1005",// 1005:5分钟刷新一次 , 0:1小时刷新一次,  1:2小时刷新一次,
      'fmd5': fmd5,
      'fver': fver
    });

    res.end(buffer);

    return;
  }

  res.setHeader('Content-Type', 'image/bmp');
  res.send(buffer);
});




app.listen(PORT, () => {
  console.log(`设备请求    http://[ip]:${PORT}/generate-image`);
  console.log(`测试预览    http://localhost:${PORT}/generate-image?istest=1`)
});



