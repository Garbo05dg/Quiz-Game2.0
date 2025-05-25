const mongoose = require('mongoose');
// Utilizza una variabile d'ambiente per il MongoDB URI (oppure un valore di default)
const DB_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/quizgame';
// Funzione per connettersi al database
async function connectDB() {
  try {
    await mongoose.connect(DB_URI, {
      // Queste opzioni erano utili per versioni precedenti di Mongoose,
      // ma in Mongoose v6 sono abilitate di default.
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Connesso a MongoDB');
  } catch (err) {
    console.error('❌ Errore connessione MongoDB:', err);
    process.exit(1);
  }
}
// Definizione dello schema per l'utente con alcune validazioni di base
const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true },
    email: { type: String, required: false }, // puoi renderlo opzionale se non lo usi
    password: { type: String, required: true },
    country: { type: String, default: '' },
    language: { type: String, default: 'it' },
    level: { type: Number, default: 1 },
    xp: { type: Number, default: 0 },
    gamesPlayed: { type: Number, default: 0 },
    gamesWon: { type: Number, default: 0 },
    correctAnswers: { type: Number, default: 0 },
    wrongAnswers: { type: Number, default: 0 },
    trophies: { type: Number, default: 0 },
    coins: { type: Number, default: 0 },
    friends: [{ type: String }] // <--- aggiungi questo campo
  },
  { timestamps: true }
);
// Utilizza questo pattern per evitare di ridefinire il modello se già compilato
const User = mongoose.models.User || mongoose.model('User', userSchema);
// Esporta la funzione di connessione e il modello User
module.exports = {
  connectDB,
  User
};
