const { body, validationResult } = require('express-validator');


// Validazione registrazione utente
const validateRegistration = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 20 })
    .withMessage('Username deve essere tra 3 e 20 caratteri')
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage('Username può contenere solo lettere, numeri, - e _'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password deve essere almeno 6 caratteri')
    .matches(/\d/)
    .withMessage('Password deve contenere almeno un numero'),
  body('email')
    .isEmail()
    .withMessage('Email non valida')
    .normalizeEmail()
];


// Validazione login
const validateLogin = [
  body('username').trim().notEmpty().withMessage('Username richiesto'),
  body('password').notEmpty().withMessage('Password richiesta')
];


// Validazione acquisto shop
const validatePurchase = [
  body('itemId').notEmpty().withMessage('ID oggetto richiesto'),
  body('currency')
    .isIn(['coins', 'gems', 'eur'])
    .withMessage('Valuta non valida')
];


// Middleware per gestire gli errori di validazione
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};


module.exports = {
  validateRegistration,
  validateLogin,
  validatePurchase,
  handleValidationErrors
};

