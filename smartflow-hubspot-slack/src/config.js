require('dotenv').config();

const REQUIRED_VARS = [
  'SLACK_BOT_TOKEN',
  'SLACK_CHANNEL_ID',
  'HUBSPOT_TOKEN',
  'HS_PIPELINE_ID',
  'HS_STAGE_NEW_ID',
  'HS_STAGE_COMPLETED_ID',
  'HUBSPOT_APP_SECRET',
  'MONGO_URI',
];

for (const name of REQUIRED_VARS) {
  if (!process.env[name]) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

module.exports = {
  SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
  SLACK_CHANNEL_ID: process.env.SLACK_CHANNEL_ID,
  HUBSPOT_TOKEN: process.env.HUBSPOT_TOKEN,
  HS_PIPELINE_ID: process.env.HS_PIPELINE_ID,
  HS_STAGE_NEW_ID: process.env.HS_STAGE_NEW_ID,
  HS_STAGE_COMPLETED_ID: process.env.HS_STAGE_COMPLETED_ID,
  HUBSPOT_APP_SECRET: process.env.HUBSPOT_APP_SECRET,
  MONGO_URI: process.env.MONGO_URI,
  POLL_INTERVAL_MIN: Number(process.env.POLL_INTERVAL_MIN) || 5,
  PORT: Number(process.env.PORT) || 3000,
};
