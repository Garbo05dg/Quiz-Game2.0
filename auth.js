const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const router = express.Router();
const crypto = require('crypto'); // Aggiunto per generare il token di reset
const JWT_SECRET = process.env.JWT_SECRET || 'il-tuo-super-segreto';
const sendEmail = require('../utils/sendEmail');


// POST /register - Registrazione nuovo utente
router.post('/register', async (req, res) => {
  console.log('[AUTH DEBUG] /register - JWT_SECRET:', JWT_SECRET);
  const { username, email, password, country } = req.body;
  // Controlla che i campi obbligatori siano presenti
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Username, email e password sono obbligatori' });
  }
  // Regex semplice per email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Email non valida' });
  }
  try {
    // Verifica se l'username è già in uso
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ error: 'Username già in uso' });
    }
    // Verifica se l'email è già in uso
    const existingEmail = await User.findOne({ email });
    if (existingEmail) {
      return res.status(400).json({ error: 'Email già in uso' });
    }
    // Genera token di conferma email
    const emailConfirmToken = crypto.randomBytes(32).toString('hex');
    // Creazione del nuovo utente
    const newUser = new User({
      username,
      email,
      password, // password in chiaro; verrà hashata nel pre('save')
      country,
      emailConfirmed: false,
      emailConfirmToken
    });
    // Salva l'utente nel database
    await newUser.save();
    // Invia email di conferma
    const confirmUrl = `http://localhost:3000/api/auth/confirm-email/${emailConfirmToken}`;
    await sendEmail({
      to: email,
      subject: 'Conferma la tua email - Quiz Game',
      html: `<p>Ciao ${username},</p>
             <p>Per attivare il tuo account clicca qui:</p>
             <a href="${confirmUrl}">${confirmUrl}</a>
             <p>Se non hai richiesto la registrazione, ignora questa email.</p>`
    });
    // Crea un token JWT (valido per 24 ore)
    const token = jwt.sign(
      { id: newUser._id, username: newUser.username },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    res.status(201).json({
      token,
      username: newUser.username,
      country: newUser.country,
      message: 'Registrazione avvenuta! Controlla la tua email per confermare l’account.'
    });
  } catch (error) {
    console.error("Errore durante la registrazione:", error);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// GET /confirm-email/:token - Conferma email
router.get('/confirm-email/:token', async (req, res) => {
  const { token } = req.params;
  try {
    const user = await User.findOne({ emailConfirmToken: token });
    if (!user) {
      return res.status(400).send('Token di conferma non valido o già usato.');
    }
    user.emailConfirmed = true;
    user.emailConfirmToken = undefined;
    await user.save();
    res.send('Email confermata! Ora puoi effettuare il login.');
  } catch (error) {
    console.error('Errore durante la conferma email:', error);
    res.status(500).send('Errore interno del server.');
  }
});

// LOGIN
router.post('/login', async (req, res) => {
  console.log('[AUTH DEBUG] /login - JWT_SECRET:', JWT_SECRET);
  const { username, password } = req.body;
  const utente = await User.findOne({ username });
  if (!utente || !(await bcrypt.compare(password, utente.password))) {
    return res.status(401).json({ error: 'Credenziali non valide' });
  }
  if (!utente.emailConfirmed) {
    return res.status(403).json({ error: 'Devi confermare la tua email prima di poter accedere.' });
  }
  const token = jwt.sign({ id: utente._id }, JWT_SECRET);
  res.json({ token, username: utente.username, country: utente.country });
});


// GUEST LOGIN
router.post('/guest-login', (req, res) => {
  // Puoi scegliere un nome di default per l'ospite o prendere quello passato dal client
  const guestName = req.body.username || 'Ospite'; // Usa 'Ospite' se non viene fornito un nome
  // Crea un token JWT temporaneo per l'ospite
  const token = jwt.sign(
    { username: guestName, isGuest: true }, // Aggiungi un flag per identificare l'ospite
    JWT_SECRET,
    { expiresIn: '24h' } // Token valido per 24 ore
  );
  // Rispondi con il token e il nome dell'ospite
  res.json({
    token,
    username: guestName,
    isGuest: true // Flag per indicare che è un ospite
  });
});

// POST /forgot-password - Richiesta di reset password
router.post('/forgot-password', async (req, res) => {
  console.log('[AUTH DEBUG] /forgot-password - JWT_SECRET:', JWT_SECRET);
  const { username } = req.body; // Modificato da email a username

  if (!username) {
    return res.status(400).json({ message: 'Username richiesto.' }); // Messaggio modificato
  }

  try {
    const user = await User.findOne({ username }); // Modificato per cercare per username

    if (!user) {
      // Per motivi di sicurezza, non rivelare se l'username esiste o meno
      console.log(`[Forgot Password] Tentativo di reset per username non trovato: ${username}`);
      return res.status(200).json({ message: 'Se il tuo username è registrato, riceverai istruzioni (controlla la console del server).' });
    }

    // Genera un token di reset
    const resetToken = crypto.randomBytes(20).toString('hex');

    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 3600000; // Token valido per 1 ora

    await user.save();

    // INVIO EMAIL REALE (Ethereal)
    const resetUrl = `http://localhost:3000/reset-password.html?token=${resetToken}`;
    await sendEmail({
      to: user.email,
      subject: 'Reset password Quiz Game',
      html: `<p>Ciao ${user.username},</p>
             <p>Per reimpostare la password clicca qui:</p>
             <a href="${resetUrl}">${resetUrl}</a>
             <p>Se non hai richiesto il reset, ignora questa email.</p>`
    });
    console.log(`[Forgot Password] Email inviata a ${user.email} (link: ${resetUrl})`);

    res.status(200).json({ message: 'Se il tuo username è registrato, riceverai istruzioni (controlla la console del server).' });

  } catch (error) {
    console.error("Errore durante la richiesta di reset password:", error);
    res.status(500).json({ message: 'Errore interno del server.' });
  }
});

// POST /reset-password/:token - Effettua il reset della password
router.post('/reset-password/:token', async (req, res) => {
  const { token } = req.params;
  const { password } = req.body;

  if (!password || password.length < 6) {
    return res.status(400).json({ message: 'La password deve essere di almeno 6 caratteri.' });
  }

  try {
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() } // Controlla che il token non sia scaduto
    });

    if (!user) {
      return res.status(400).json({ message: 'Token di reset password non valido o scaduto.' });
    }

    // Imposta la nuova password (verrà hashata dal middleware pre-save)
    user.password = password;
    user.resetPasswordToken = undefined; // o null
    user.resetPasswordExpires = undefined; // o null

    await user.save();

    // Opzionale: invia un token JWT per far fare login automatico all'utente
    // const loginToken = jwt.sign({ id: user._id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
    // res.json({ message: 'Password resettata con successo.', token: loginToken, username: user.username });

    res.status(200).json({ message: 'Password resettata con successo. Ora puoi effettuare il login con la nuova password.' });

  } catch (error) {
    console.error("Errore durante il reset della password:", error);
    res.status(500).json({ message: 'Errore interno del server.' });
  }
});

module.exports = router;

