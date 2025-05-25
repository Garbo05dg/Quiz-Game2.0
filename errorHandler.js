const winston = require('winston');
const nodemailer = require('nodemailer');
const axios = require('axios');

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const ALERT_EMAIL_TO = process.env.ALERT_EMAIL_TO;
const ALERT_EMAIL_FROM = process.env.ALERT_EMAIL_FROM;
const ALERT_EMAIL_PASS = process.env.ALERT_EMAIL_PASS;

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/security.log', level: 'warn' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}

// Funzione per inviare alert Slack
async function sendSlackAlert(message) {
  if (!SLACK_WEBHOOK_URL) return;
  try {
    await axios.post(SLACK_WEBHOOK_URL, { text: message });
  } catch (err) {
    // Non loggare ricorsivamente
    console.error('Errore invio alert Slack:', err.message);
  }
}

// Funzione per inviare alert email
async function sendEmailAlert(subject, message) {
  if (!ALERT_EMAIL_TO || !ALERT_EMAIL_FROM || !ALERT_EMAIL_PASS) return;
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: ALERT_EMAIL_FROM,
        pass: ALERT_EMAIL_PASS
      }
    });
    await transporter.sendMail({
      from: ALERT_EMAIL_FROM,
      to: ALERT_EMAIL_TO,
      subject,
      text: message
    });
  } catch (err) {
    console.error('Errore invio alert email:', err.message);
  }
}

class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

const errorHandler = async (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  // Log dell'errore
  logger.error('Error 💥:', {
    message: err.message,
    stack: err.stack,
    statusCode: err.statusCode,
    path: req.path,
    method: req.method,
    ip: req.ip
  });

  // Alert solo per errori critici (500 o sicurezza)
  if (err.statusCode >= 500 || err.statusCode === 403) {
    const alertMsg = `ALERT: Errore critico (${err.statusCode}) su ${req.method} ${req.path}\nMessaggio: ${err.message}\nIP: ${req.ip}`;
    sendSlackAlert(alertMsg);
    sendEmailAlert('ALERT: Errore critico backend', alertMsg);
  }

  if (process.env.NODE_ENV === 'development') {
    res.status(err.statusCode).json({
      status: err.status,
      error: err,
      message: err.message,
      stack: err.stack
    });
  } else {
    // In produzione, nascondi i dettagli dell'errore
    if (err.isOperational) {
      res.status(err.statusCode).json({
        status: err.status,
        message: err.message
      });
    } else {
      // Errori di programmazione o sconosciuti
      res.status(500).json({
        status: 'error',
        message: 'Qualcosa è andato storto!'
      });
    }
  }
};

module.exports = {
  AppError,
  errorHandler,
  logger
}; 