require('dotenv').config();
const mongoose = require('mongoose');
const  User  = require('../models/User'); // ATTENZIONE: percorso corretto!

const DB_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/quizgame';

async function deleteAllUsers() {
  try {
    await mongoose.connect(DB_URI);
    const result = await User.deleteMany({});
    console.log(`✅ Eliminati ${result.deletedCount} utenti`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Errore durante la cancellazione utenti:', error);
    process.exit(1);
  }
}

deleteAllUsers();
