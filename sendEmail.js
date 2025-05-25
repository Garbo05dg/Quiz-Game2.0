const nodemailer = require('nodemailer');

let testAccountPromise = nodemailer.createTestAccount();

async function sendEmail({ to, subject, html }) {
  // Crea account di test solo la prima volta
  const testAccount = await testAccountPromise;

  // Crea un transporter SMTP di test
  let transporter = nodemailer.createTransport({
    host: testAccount.smtp.host,
    port: testAccount.smtp.port,
    secure: testAccount.smtp.secure,
    auth: {
      user: testAccount.user,
      pass: testAccount.pass
    }
  });

  // Invia l'email
  let info = await transporter.sendMail({
    from: 'Quiz Game <noreply@quizgame.test>',
    to,
    subject,
    html
  });

  // Mostra anteprima e link Ethereal in console
  console.log('Messaggio inviato: %s', info.messageId);
  console.log('Anteprima: %s', nodemailer.getTestMessageUrl(info));
}

module.exports = sendEmail; 