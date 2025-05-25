// models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true },
    email: { type: String, unique: true, sparse: true },
    emailConfirmed: { type: Boolean, default: false },
    emailConfirmToken: String,
    password: { type: String, required: true, minlength: 6 },
    country: { type: String, default: '' },
    // PROFILO
    level: { type: Number, default: 1 },
    xp: { type: Number, default: 0 },
    gamesPlayed: { type: Number, default: 0 },
    gamesWon: { type: Number, default: 0 },
    correctAnswers: { type: Number, default: 0 },
    wrongAnswers: { type: Number, default: 0 },
    language: { type: String, default: 'it' },
    trophies: { type: Number, default: 0 },
    coins: { type: Number, default: 0 },
    gems: { type: Number, default: 0 },
    avatars: [{ type: String }],      // immagini avatar sbloccati
    backgrounds: [{ type: String }],  // immagini sfondi sbloccati
    friends: [{ type: String }],
    resetPasswordToken: String, // Aggiunto per il reset password
    resetPasswordExpires: Date  // Aggiunto per la scadenza del token di reset
  },
  { timestamps: true }
);


// Middleware per hashare la password prima del salvataggio
userSchema.pre('save', async function (next) {
  // Se la password non è stata modificata, salta l'hashing
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});


// Crea il modello "User" o, se già definito (ad es. in ambienti con hot-reload), usalo
const User = mongoose.models.User || mongoose.model('User', userSchema);


module.exports = User;
