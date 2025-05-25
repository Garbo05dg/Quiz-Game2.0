const express = require('express');
const router = express.Router();
const User = require('../models/User');

router.get('/trophies/global', async (req, res) => {
  const username = req.query.username;
  const top = await User.find().sort({ trophies: -1 }).limit(10).select('username country trophies -_id');
  let yourPosition = 0, yourTrophies = 0;
  if (username) {
    const all = await User.find().sort({ trophies: -1 }).select('username');
    yourPosition = all.findIndex(u => u.username === username) + 1;
    const user = await User.findOne({ username });
    yourTrophies = user ? user.trophies : 0;
  }
  res.json({ top, yourPosition, yourTrophies });
});

// Classifica nazionale
router.get('/trophies/country/:country', async (req, res) => {
  const username = req.query.username;
  const country = req.params.country;
  const top = await User.find({ country }).sort({ trophies: -1 }).limit(10).select('username country trophies -_id');
  let yourPosition = 0, yourTrophies = 0;
  if (username) {
    const all = await User.find({ country }).sort({ trophies: -1 }).select('username');
    yourPosition = all.findIndex(u => u.username === username) + 1;
    const user = await User.findOne({ username, country });
    yourTrophies = user ? user.trophies : 0;
  }
  res.json({ top, yourPosition, yourTrophies });
});
module.exports = router; 