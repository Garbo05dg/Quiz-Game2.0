const express = require('express');
const User = require('../models/User');
const jwtAuth = require('../middleware/jwtAuth');
const { csrfProtection } = require('../middleware/csrf');
const {
  validateProfileUpdate,
  validateAddFriend,
  validateChangePassword,
  handleValidationErrors
} = require('../middleware/validators');
const router = express.Router();
const bcrypt = require('bcrypt');

// Aggiorna profilo utente
router.post('/profile/update', jwtAuth, csrfProtection, validateProfileUpdate, handleValidationErrors, async (req, res) => {
  const userId = req.user.id;
  const update = {};
  if (req.body.email) update.email = req.body.email;
  if (req.body.country) update.country = req.body.country;
  if (req.body.language) update.language = req.body.language;
  try {
    const user = await User.findByIdAndUpdate(userId, update, { new: true });
    if (!user) return res.status(404).json({ error: 'Utente non trovato' });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: 'Errore aggiornamento profilo' });
  }
});

// Aggiungi amico
router.post('/friends/add', jwtAuth, csrfProtection, validateAddFriend, handleValidationErrors, async (req, res) => {
  const { username, friend } = req.body;
  if (username === friend) return res.status(400).json({ error: 'Non puoi aggiungere te stesso' });
  try {
    const user = await User.findOneAndUpdate(
      { username },
      { $addToSet: { friends: friend } },
      { new: true }
    );
    if (!user) return res.status(404).json({ error: 'Utente non trovato' });
    await User.updateOne({ username: friend }, { $addToSet: { friends: username } });
    res.json({ success: true, friends: user.friends });
  } catch (err) {
    res.status(500).json({ error: 'Errore aggiunta amico' });
  }
});

// Cambio password
router.post('/change-password', jwtAuth, csrfProtection, validateChangePassword, handleValidationErrors, async (req, res) => {
  const userId = req.user.id;
  const { oldPassword, newPassword } = req.body;
  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'Utente non trovato' });
    const valid = await bcrypt.compare(oldPassword, user.password);
    if (!valid) return res.status(401).json({ error: 'Vecchia password errata' });
    user.password = newPassword;
    await user.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Errore cambio password' });
  }
});

module.exports = router; 