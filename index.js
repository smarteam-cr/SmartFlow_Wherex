require('dotenv').config();
const { start } = require('./src/start');

start().catch((err) => {
  console.error(err);
  process.exit(1);
});