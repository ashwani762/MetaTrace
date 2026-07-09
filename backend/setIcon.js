
const { rcedit } = require('rcedit');
async function setIcon() {
  await rcedit('CppTemplateVisualizer.exe', { icon: '../logo.ico' });
}
setIcon().catch(console.error);
