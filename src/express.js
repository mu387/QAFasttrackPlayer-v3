const cors = require('cors');
const express = require('express');
const expressApp = express();
expressApp.use(express.json({ limit: '50mb' }));
expressApp.use(cors());

module.exports = { expressApp };
