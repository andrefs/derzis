#!/usr/bin/env node
const process = require('process');
const config = require('../config');

if(!process.argv[2]){
  console.log('Usage: ');
  console.log(`  ${process.argv[2]} SEL1.SEL2.SEL3`);
  process.exit(0);
}

const sels = process.argv[2].split(/\./);
selConfig = config;
for(const s of sels){
  selConfig = selConfig[s];
}

console.log(selConfig);
