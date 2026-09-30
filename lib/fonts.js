const path = require('node:path');
const { registerFont } = require('canvas');
for (const weight of ['Regular', 'Bold']) {
  registerFont(path.join(__dirname, '../public/fonts', `NotoSansSC-${weight}.otf`), {
    family: 'Mojian Text', weight: weight === 'Bold' ? 'bold' : 'normal'
  });
}
