const mongoose = require('mongoose');
const logger = require('winston');


const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });


    logger.info(`MongoDB Connesso: ${conn.connection.host}`);


    // Gestione errori dopo la connessione
    mongoose.connection.on('error', (err) => {
      logger.error(`Errore MongoDB: ${err}`);
    });


    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnesso. Tentativo di riconnessione...');
    });


    // Gestione chiusura applicazione
    process.on('SIGINT', async () => {
      await mongoose.connection.close();
      logger.info('MongoDB disconnesso per chiusura applicazione');
      process.exit(0);
    });


  } catch (error) {
    logger.error(`Errore connessione MongoDB: ${error.message}`);
    process.exit(1);
  }
};


module.exports = connectDB;

