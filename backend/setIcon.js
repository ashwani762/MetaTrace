
const { rcedit } = require('rcedit');
async function setIcon() {
  await rcedit('MetaTrace.exe', { icon: '../logo.ico' });
}
setIcon().catch(console.error);
