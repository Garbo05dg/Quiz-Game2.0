const mongoose = require('mongoose');
const { connectDB } = require('../server.db');

(async () => {
  await connectDB();
  const indexes = await mongoose.connection.db.collection('users').indexes();
  console.log('Indici della collezione users:');
  console.log(indexes);
  process.exit(0);
})(); 