// Copyright (c) 2024 MetaTrace Contributors
// 
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT


const { rcedit } = require('rcedit');
async function setIcon() {
  await rcedit('MetaTrace.exe', { icon: '../logo.ico' });
}
setIcon().catch(console.error);
