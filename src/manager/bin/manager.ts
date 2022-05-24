//const Manager = require('../lib/Manager');
//const m = new Manager();

import ManagerPubSub from '../lib/ManagerPubSub';
const mps = new ManagerPubSub();
import webapp from '../lib/ProcessManager';

webapp.listen(3000, () => {
  console.log('Webapp listening on port 3000');
});


// const fs = require('fs');
// const v8 = require('v8');
// 
// function createHeapSnapshot() {
//   const snapshotStream = v8.getHeapSnapshot();
//   // It's important that the filename end with `.heapsnapshot`,
//   // otherwise Chrome DevTools won't open it.
//   const fileName = `${Date.now()}.heapsnapshot`;
//   const fileStream = fs.createWriteStream(fileName);
//   snapshotStream.pipe(fileStream);
// }

//setInterval(createHeapSnapshot, 5*1000);

mps.start();

