require('dotenv').config(); // Carica le variabili d'ambiente dal file .env

console.log('DEBUG: STRIPE_SECRET_KEY:', process.env.STRIPE_SECRET_KEY);
console.log('DEBUG: STRIPE_WEBHOOK_SECRET:', process.env.STRIPE_WEBHOOK_SECRET);
console.log('DEBUG: JWT_SECRET:', process.env.JWT_SECRET); // Importante per l'autenticazione

const express = require('express');
const mongoose = require('mongoose');
const authRoutes = require('./routes/auth');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const cors = require('cors');
const User = require('./models/User');
const path = require('path');
const { connectDB } = require('./server.db');
const { start } = require('repl');
const { decode } = require('html-entities');
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
connectDB(); // connetti a MongoDB
const cron = require('node-cron');
// Ogni primo giorno del mese a mezzanotte
cron.schedule('0 0 1 * *', async () => {
  console.log('Reset mensile dei trofei...');
  await User.updateMany({}, { $set: { trophies: 0 } });
  // Qui puoi anche assegnare premi ai primi classificati, se vuoi!
});
const app = express();
app.use(cors());


// --- WEBHOOK STRIPE ---
app.post('/webhook/stripe', express.raw({type: 'application/json'}), async (req, res) => {
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET; // Utilizza la variabile d'ambiente
  let event;




  // Verifica firma Stripe
  if (endpointSecret) {
    const sig = req.headers['stripe-signature'];
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  } else {
    // Solo per test senza endpointSecret
    try {
      event = JSON.parse(req.body);
    } catch (err) {
      return res.status(400).send(`Webhook error: ${err.message}`);
    }
  }




  // Gestisci solo il pagamento completato
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const username = session.metadata?.username;
    const itemId = session.metadata?.itemId;




    // Trova l'item acquistato
    const item = SHOP_ITEMS.find(x => x.id === itemId);
    if (!item || item.type !== 'currency') return res.status(400).end();




    // Aggiorna il saldo dell'utente
    const user = await User.findOne({ username });
    if (!user) return res.status(404).end();




    if (item.id.startsWith('coins')) {
      user.coins = (user.coins || 0) + (item.amount || 0);
    } else if (item.id.startsWith('gems')) {
      user.gems = (user.gems || 0) + (item.amount || 0);
    }
    await user.save();
    console.log(`Stripe: accreditati ${item.amount} ${item.id.startsWith('coins') ? 'monete' : 'gemme'} a ${username}`);
  }




  res.json({received: true});
});

app.post('/api/webhook/stripe', express.raw({type: 'application/json'}), async (req, res) => {
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET; // Utilizza la variabile d'ambiente
  let event;

  // Verifica firma Stripe
  if (endpointSecret) {
    const sig = req.headers['stripe-signature'];
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  } else {
    // Solo per test senza endpointSecret
    try {
      event = JSON.parse(req.body);
    } catch (err) {
      return res.status(400).send(`Webhook error: ${err.message}`);
    }
  }

  // Gestisci solo il pagamento completato
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const username = session.metadata?.username;
    const itemId = session.metadata?.itemId;

    // Trova l'item acquistato
    const item = SHOP_ITEMS.find(x => x.id === itemId);
    if (!item || item.type !== 'currency') return res.status(400).end();

    // Aggiorna il saldo dell'utente
    const user = await User.findOne({ username });
    if (!user) return res.status(404).end();

    if (item.id.startsWith('coins')) {
      user.coins = (user.coins || 0) + (item.amount || 0);
    } else if (item.id.startsWith('gems')) {
      user.gems = (user.gems || 0) + (item.amount || 0);
    }
    await user.save();
    console.log(`Stripe: accreditati ${item.amount} ${item.id.startsWith('coins') ? 'monete' : 'gemme'} a ${username}`);
  }

  res.json({received: true});
});

// Body parser per tutte le altre route
app.use(express.json());


// --- CREA SERVER HTTP E SOCKET.IO PRIMA DI USARE io ---
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' }
});
// Tutte le altre route DOPO express.json()
app.use('/api/auth', authRoutes);
const leaderboardRoutes = require('./routes/leaderboard');
app.use('/api/leaderboard', leaderboardRoutes);
const lobbies = {};
const users = {}; // Mappa globale utenti: socket.id -> dati player








// Mappa username -> socket.id per notifiche dirette (semplice, volatile)
const onlineUsers = {};
// Mappa username -> array di inviti ricevuti (volatile, per demo)
const pendingChallenges = {};








async function translateTextServer(text, targetLang, sourceLang = 'en') {
  if (!targetLang || targetLang === sourceLang) return text;
  try {
    const res = await axios.post('http://localhost:5001/translate', {
      q: text,
      source: 'en',
      target: targetLang,
      format: 'text'
    }, {
      headers: { 'Content-Type': 'application/json' }
    });
    return res.data.translatedText || text;
  } catch (err) {
    console.error('Errore traduzione server:', err);
    return text;
  }
}
async function sendNewQuestion(lobbyId) {
  const lobby = lobbies[lobbyId];
  if (!lobby) return;








  lobby.answers = [];








  // Single player mode detection
  lobby.singlePlayerMode = (lobby.players.length === 1);








  // Prendi la lingua della lobby (default 'en')
  const targetLang = lobby.language || 'en';








  // Prendi categoria/difficoltà dalla lobby
  const category = lobby.category;
  const difficulty = lobby.difficulty;








  // Costruisci URL API con categoria/difficoltà
  let apiUrl = 'https://opentdb.com/api.php?amount=1&type=multiple';
  if (category) apiUrl += `&category=${category}`;
  if (difficulty) apiUrl += `&difficulty=${difficulty}`;








  if (lobby.questionsSent >= lobby.maxQuestions) {
    let maxScore = Math.max(...lobby.players.map(p => p.score));
    const sortedPlayers = [...lobby.players].sort((a, b) => b.score - a.score);








    for (const player of lobby.players) {
      // Calcola la differenza di risposte corrette/sbagliate solo per questa partita
      let correctDelta, wrongDelta;
      if (lobby.singlePlayerMode) {
        // In single player, aggiorna correct/wrong solo a fine partita
        correctDelta = player._sessionCorrect || 0;
        wrongDelta = player._sessionWrong || 0;
      } else {
        correctDelta = player._sessionCorrect || 0;
        wrongDelta = player._sessionWrong || 0;
      }








      // Trofei in base alla posizione
      const idx = sortedPlayers.findIndex(p => p.id === player.id);
      let trophies = 1;
      if (lobby.singlePlayerMode) {
        // Single player: calcolo trofei in base alle risposte sbagliate
        trophies = player.singlePlayerTrophies !== undefined ? player.singlePlayerTrophies : 0;
      } else if (lobby.isChallenge) {
        // In challenge, niente trofei
        trophies = 0;
      } else {
        if (idx === 0) trophies = 10;
        else if (idx === 1) trophies = 6;
        else if (idx === 2) trophies = 3;
        // Penalizza solo se ci sono almeno 2 giocatori
        if (sortedPlayers.length > 1 && idx === sortedPlayers.length - 1) trophies = -5;
      }








      // Prendi i dati attuali dal DB
      const user = await User.findOne({ username: new RegExp('^' + player.username + '$', 'i') });








      // Somma SOLO la differenza della partita alle statistiche globali
      let totalXp = (user?.xp || 0) + (player.xp || 0) + 15; // 15 XP per tutti
      let totalLevel = user?.level || 1;
      let totalGamesPlayed = (user?.gamesPlayed || 0) + 1;
      let totalGamesWon = user?.gamesWon || 0;
      let totalCorrectAnswers = (user?.correctAnswers || 0) + Math.max(0, correctDelta);
      let totalWrongAnswers = (user?.wrongAnswers || 0) + Math.max(0, wrongDelta);
      let totalTrophies = Math.max((user?.trophies || 0) + trophies, 0);








      // DEBUG: logga i valori prima dell'update
      console.log(`[TROPHIES] User: ${player.username} - Old: ${user?.trophies || 0}, Change: ${trophies}, New: ${totalTrophies}`);








      // In single player, considera sempre la partita "vinta" se il punteggio è > 0
      if ((lobby.singlePlayerMode && player.score > 0) || (!lobby.singlePlayerMode && player.score === maxScore && maxScore > 0)) {
        totalGamesWon += 1;
        totalXp += 30; // 30 XP extra per chi vince
      }








      // Gestione level up
      let xpForNextLevel = 100 + (totalLevel - 1) * 50;
      while (totalXp >= xpForNextLevel) {
        totalXp -= xpForNextLevel;
        totalLevel += 1;
        xpForNextLevel = 100 + (totalLevel - 1) * 50;
      }








      // Aggiorna il database con i valori FINALi
      const updateResult = await User.findOneAndUpdate(
        { username: new RegExp('^' + player.username + '$', 'i') },
        {
          $set: {
            level: totalLevel,
            xp: totalXp,
            gamesPlayed: totalGamesPlayed,
            gamesWon: totalGamesWon,
            correctAnswers: totalCorrectAnswers,
            wrongAnswers: totalWrongAnswers,
            trophies: totalTrophies
          }
        },
        { new: true }
      );








      // DEBUG: logga il risultato dell'update
      console.log(`[TROPHIES] Update result for ${player.username}:`, updateResult);








      // Aggiorna anche la mappa globale utenti
      if (users[player.id]) {
        users[player.id] = {
          ...player,
          username: player.username,
          level: totalLevel,
          xp: totalXp,
          gamesPlayed: totalGamesPlayed,
          gamesWon: totalGamesWon,
          correctAnswers: totalCorrectAnswers,
          wrongAnswers: totalWrongAnswers,
          trophies: totalTrophies
        };
      }
    }








    io.to(lobbyId).emit('gameOver', {
      message: 'Gioco terminato!',
      finalScores: lobby.players.map(p => ({
        id: p.id,
        name: p.name,
        language: p.language || 'Lingua sconosciuta',
        score: p.score,
        singlePlayerTrophies: p.singlePlayerTrophies,
      })),
      singlePlayerMode: lobby.singlePlayerMode
    });
    return;
  }








  const response = await axios.get(apiUrl);
  const questionData = response.data.results[0];








  const decodedQuestion = decode(questionData.question);
  const decodedAnswers = questionData.incorrect_answers.map(answer => decode(answer));
  const decodedCorrectAnswer = decode(questionData.correct_answer);








  // --- Traduci domanda e risposte ---
  const translatedQuestion = await translateTextServer(decodedQuestion, targetLang);
  const translatedCorrect = await translateTextServer(decodedCorrectAnswer, targetLang);
  const translatedIncorrects = [];
  for (const ans of decodedAnswers) {
    translatedIncorrects.push(await translateTextServer(ans, targetLang));
  }








  lobby.currentQuestion = {
    question: translatedQuestion,
    correct_answer: translatedCorrect,
    incorrect_answers: translatedIncorrects
  };
  lobby.questionsSent++;
  console.log('Invio domanda:', lobby.currentQuestion);








  // Single player: reset risposte e trofei per domanda
  if (lobby.singlePlayerMode) {
    if (lobby.questionsSent === 1) {
      lobby.players[0].singlePlayerTrophies = 10;
      lobby.players[0]._sessionCorrect = 0;
      lobby.players[0]._sessionWrong = 0;
      // Inizializza i power-up solo all'inizio della partita
      lobby.players[0].powerUpsUsed = {
        '5050': false,
        'skip': false,
        'time': false
      };
    }
    lobby.players[0].lastAnswer = null;
    lobby.players[0].answered = false;
    lobby.players[0].alreadyScored = false;
    lobby.singlePlayerShowedAnswer = false;
    // Invia lo stato dei power-up disponibili
    io.to(lobby.players[0].id).emit('powerUpStatus', {
      available: {
        '5050': !lobby.players[0].powerUpsUsed?.['5050'],
        'skip': !lobby.players[0].powerUpsUsed?.['skip'],
        'time': !lobby.players[0].powerUpsUsed?.['time']
      }
    });
  }








  io.to(lobbyId).emit('newQuestion', {
    ...lobby.currentQuestion,
    singlePlayerMode: lobby.singlePlayerMode,
    singlePlayerTrophies: lobby.singlePlayerMode ? lobby.players[0].singlePlayerTrophies : undefined
  });








  if (!lobby.players || lobby.players.length === 0) return;








  let timeRemaining = 20;
  lobby.timerInterval && clearInterval(lobby.timerInterval);








  lobby._timeRemaining = timeRemaining; // salva per power-up tempo extra








  lobby.timerInterval = setInterval(() => {
    // Usa il valore aggiornato se modificato da power-up
    timeRemaining = lobby._timeRemaining !== undefined ? lobby._timeRemaining : timeRemaining;
    timeRemaining--;
    lobby._timeRemaining = timeRemaining;
    io.to(lobbyId).emit('timerUpdate', timeRemaining);








    if (timeRemaining <= 0) {
      clearInterval(lobby.timerInterval);








      if (lobby.singlePlayerMode) {
        const player = lobby.players[0];
        // Aggiorna punteggio solo se non già aggiornato
        if (!player.alreadyScored) {
          if (player.answered && player.lastAnswer === lobby.currentQuestion.correct_answer) {
            player.score += 1;
            player._sessionCorrect = (player._sessionCorrect || 0) + 1;
          } else {
            player._sessionWrong = (player._sessionWrong || 0) + 1;
          }
          player.alreadyScored = true;
        }
        if (!player.answered || player.lastAnswer !== lobby.currentQuestion.correct_answer) {
          player.singlePlayerTrophies = Math.max(0, player.singlePlayerTrophies - 1);
        }
        io.to(lobbyId).emit('showCorrectAnswer', {
          correct_answer: lobby.currentQuestion.correct_answer
        });
        setTimeout(() => {
          const scores = lobby.players.map(p => ({
            id: p.id,
            name: p.name,
            score: p.score,
            singlePlayerTrophies: p.singlePlayerTrophies
          }));
          io.to(lobbyId).emit('scoreboard', scores);
          setTimeout(() => {
            sendNewQuestion(lobbyId);
          }, 5000);
        }, 4000);
        return;
      }








      if (Array.isArray(lobby.answers) && lobby.answers.length > 0) {
        const correctAnswers = lobby.answers.filter(a =>
          a.answer === lobby.currentQuestion.correct_answer
        );
        correctAnswers.sort((a, b) => a.timestamp - b.timestamp);
        const maxPoints = lobby.players.length;








        correctAnswers.forEach((entry, index) => {
          const player = lobby.players.find(p => p.id === entry.playerId);
          if (player) {
            const points = Math.max(maxPoints - index, 1);
            player.score += points;
            console.log(`+${points} punti a ${player.name} per risposta corretta #${index + 1}`);
          }
        });
      }








      io.to(lobbyId).emit('showCorrectAnswer', {
        correct_answer: lobby.currentQuestion.correct_answer
      });








      setTimeout(() => {
        const scores = lobby.players.map(p => ({
          id: p.id,
          name: p.name,
          score: p.score,
          singlePlayerTrophies: p.singlePlayerTrophies
        }));
        io.to(lobbyId).emit('scoreboard', scores);








        setTimeout(() => {
          sendNewQuestion(lobbyId);
        }, 5000);
      }, 4000);
    }
  }, 1000);
}








io.on('connection', (socket) => {
  console.log('Nuovo giocatore connesso:', socket.id);
  socket.on('setUser', async ({ username }) => {
    users[socket.id] = { username };
    if (username) {
      onlineUsers[username] = socket.id;
      try {
        // Carica amici dal database
        const user = await User.findOne({ username });
        if (user) {
          socket.emit('friendsList', user.friends || []);
        } else {
          // Opzionale: gestire il caso in cui l'utente non sia trovato, anche se setUser potrebbe essere chiamato per utenti non ancora in DB
          // console.log(`[setUser] Utente non trovato nel DB: ${username}, ma registrato come online.`);
          socket.emit('friendsList', []); // Invia lista amici vuota se utente non in DB
        }
        socket.emit('challengeInvitesList', pendingChallenges[username] || []);
      } catch (error) {
        console.error(`[setUser] Errore durante il recupero dell'utente ${username} dal DB:`, error);
        socket.emit('error', { message: 'Impossibile recuperare i dati utente dal server.' });
      }
    }
  });








  // --- AMICI: invia lista amici su richiesta ---
  socket.on('getFriendsList', async ({ username }) => {
    const user = await User.findOne({ username });
    socket.emit('friendsList', user?.friends || []);
  });








  // --- INVITI: invia lista inviti pendenti su richiesta ---
  socket.on('getChallengeInvites', ({ username }) => {
    socket.emit('challengeInvitesList', pendingChallenges[username] || []);
  });








  // --- AGGIUNGI AMICO ---
  socket.on('addFriend', async ({ username, friend }, cb) => {
    if (!username || !friend || username === friend) {
      if (cb) cb({ error: 'Nome utente non valido' });
      return;
    }
    const userDoc = await User.findOne({ username: friend });
    if (!userDoc) {
      if (cb) cb({ error: 'Utente non trovato' });
      return;
    }
    // Aggiorna amici su entrambi gli utenti nel DB
    await User.updateOne({ username }, { $addToSet: { friends: friend } });
    await User.updateOne({ username: friend }, { $addToSet: { friends: username } });
    // Carica lista aggiornata dal DB
    const user = await User.findOne({ username });
    const friendUser = await User.findOne({ username: friend });
    const userSocketId = onlineUsers[username];
    const friendSocketId = onlineUsers[friend];
    if (userSocketId) io.to(userSocketId).emit('friendsList', user.friends || []);
    if (friendSocketId) io.to(friendSocketId).emit('friendsList', friendUser.friends || []);
    if (cb) cb({ success: true });
  });








  socket.on('createLobby', async ({ username, language, country, category, difficulty }) => {
    const lobbyId = Math.random().toString(36).substr(2, 6).toUpperCase();
    lobbies[lobbyId] = {
      players: [],
      currentQuestion: null,
      questionsSent: 0,
      maxQuestions: 10,
      hostId: socket.id,
      language: language || 'en',
      category: category || '',
      difficulty: difficulty || ''
    };
    socket.join(lobbyId);
    // Carica o crea il profilo dal DB
    let user = await User.findOne({ username });
    if (!user) {
      socket.emit('error', 'Utente non registrato. Effettua il login.');
      return;
    }
    const playerData = {
      id: socket.id,
      score: 0, // solo il punteggio partita va azzerato
      name: user.username,
      username: user.username,
      language: user.language || 'en',
      level: user.level || 1,
      xp: user.xp || 0,
      gamesPlayed: user.gamesPlayed || 0,
      gamesWon: user.gamesWon || 0,
      correctAnswers: user.correctAnswers || 0,
      wrongAnswers: user.wrongAnswers || 0,
      trophies: user.trophies || 0, // <-- aggiungi anche i trofei
      coins: user.coins || 0        // <-- aggiungi anche le monete se usate
    };
    lobbies[lobbyId].players.push(playerData);








    // Salva tutte le statistiche nella mappa globale utenti
    users[socket.id] = { ...playerData };
    socket.emit('lobbyCreated', lobbyId);
    console.log(`Lobby creata: ${lobbyId} da ${username}`);
  });
  socket.on('joinLobby', async ({ lobbyId, username, language }) => {
    const lobby = lobbies[lobbyId];
    if (!lobby) {
      socket.emit('error', 'Lobby non trovata');
      return;
    }
    socket.join(lobbyId);
    // Carica o crea il profilo dal DB
    let user = await User.findOne({ username });
    // Se non esiste l'utente, permetti comunque l'accesso come guest
    let playerData = lobby.players.find(p => p.id === socket.id);
    if (!playerData) {
      playerData = {
        id: socket.id,
        score: 0,
        name: username,
        username: username,
        language: user?.language || language || 'it',
        level: user?.level || 1,
        xp: user?.xp || 0,
        gamesPlayed: user?.gamesPlayed || 0,
        gamesWon: user?.gamesWon || 0,
        correctAnswers: user?.correctAnswers || 0,
        wrongAnswers: user?.wrongAnswers || 0,
        trophies: user?.trophies || 0,
        coins: user?.coins || 0
      };
      lobby.players.push(playerData);
    }
    // Salva tutte le statistiche nella mappa globale utenti
    users[socket.id] = { ...playerData };
    if (!lobby.language && language) {
      lobby.language = language;
    }
    socket.emit('joinedLobbyState', {
      lobbyId,
      gameStarted: lobby.questionsSent > 0
    });
    io.to(lobbyId).emit('lobbyPlayers', lobby.players);
  });
  socket.on('startGame', ({ lobbyId, maxQuestions, language }) => {
    const lobby = lobbies[lobbyId];
    if (!lobby) return;
    if (lobby.hostId !== socket.id) {
      socket.emit('error', 'Solo l\'host può avviare il gioco');
      return;
    }
    if (language) lobby.language = language; // <-- aggiorna lingua se fornita
    lobbies[lobbyId].questionsSent = 0;
    lobbies[lobbyId].maxQuestions = maxQuestions === 20 ? 20 : 10;
    lobby.players.forEach(p => {
      p.score = 0;
      // Salva le statistiche di partenza per evitare somma multipla
      p._initialCorrectAnswers = p.correctAnswers || 0;
      p._initialWrongAnswers = p.wrongAnswers || 0;
      // Reset conteggio partita
      p._sessionCorrect = 0;
      p._sessionWrong = 0;
    });
    sendNewQuestion(lobbyId);
  });
  socket.on('submitAnswer', ({ lobbyId, answer }) => {
    const lobby = lobbies[lobbyId];
    if (!lobby || !lobby.currentQuestion) return;








    // Single player: consenti cambio risposta, salva solo l'ultima, NON inviare answerResult che blocca i bottoni
    if (lobby.singlePlayerMode) {
      const player = lobby.players[0];
      player.lastAnswer = answer;
      player.answered = true;
      // NON aggiornare correct/wrong qui!
      player.alreadyScored = false;
      return;
    }








    if (!lobby.answers) {
      lobby.answers = [];
    }
    const alreadyAnswered = lobby.answers.find(entry => entry.playerId === socket.id);
    if (alreadyAnswered) return;
    lobby.answers.push({
      playerId: socket.id,
      answer,
      timestamp: Date.now()
    });
    const correct = answer === lobby.currentQuestion.correct_answer;
    const player = lobby.players.find(p => p.id === socket.id);
    if (player) {
      if (correct) {
        player._sessionCorrect = (player._sessionCorrect || 0) + 1;
      } else {
        player._sessionWrong = (player._sessionWrong || 0) + 1;
      }
      if (users[player.id]) {
        users[player.id] = { ...player };
      }
      io.to(socket.id).emit('answerResult', {
        correct,
        correct_answer: lobby.currentQuestion.correct_answer,
        selected_answer: answer
      });
    }
  });








  socket.on('nextQuestionRequest', ({ lobbyId }) => {
    const lobby = lobbies[lobbyId];
    if (!lobby || !lobby.singlePlayerMode || !lobby.currentQuestion) return;
    if (lobby.singlePlayerShowedAnswer) return;








    lobby.singlePlayerShowedAnswer = true;
    const player = lobby.players[0];
    if (!player.alreadyScored) {
      if (player.answered && player.lastAnswer === lobby.currentQuestion.correct_answer) {
        player.score += 1;
        player._sessionCorrect = (player._sessionCorrect || 0) + 1;
      } else {
        player._sessionWrong = (player._sessionWrong || 0) + 1;
      }
      player.alreadyScored = true;
    }
    if (!player.answered || player.lastAnswer !== lobby.currentQuestion.correct_answer) {
      player.singlePlayerTrophies = Math.max(0, player.singlePlayerTrophies - 1);
    }
    io.to(lobbyId).emit('showCorrectAnswer', {
      correct_answer: lobby.currentQuestion.correct_answer
    });
    clearInterval(lobby.timerInterval);
    setTimeout(() => {
      const scores = lobby.players.map(p => ({
        id: p.id,
        name: p.name,
        score: p.score,
        singlePlayerTrophies: p.singlePlayerTrophies
      }));
      io.to(lobbyId).emit('scoreboard', scores);
      setTimeout(() => {
        sendNewQuestion(lobbyId);
      }, 5000);
    }, 4000);
  });








  socket.on('getScores', (lobbyId) => {
    const lobby = lobbies[lobbyId];
    if (!lobby) return;
    const scores = lobby.players.map(p => ({ id: p.id, name: p.name, score: p.score }));
    io.to(lobbyId).emit('scoreboard', scores);
  });
  socket.on('playerReady', (lobbyId) => {
    const lobby = lobbies[lobbyId];
    if (!lobby) return;
    // Inizializza sempre il Set se non esiste
    if (!lobby.readyPlayers) {
      lobby.readyPlayers = new Set();
    }
    lobby.readyPlayers.add(socket.id);
    // Quando tutti sono pronti, fai partire la partita
    if (lobby.readyPlayers.size === lobby.players.length) {
      lobby.readyPlayers.clear();
      lobby.questionsSent = 0;
      lobby.answers = [];
      lobby.players.forEach(p => p.score = 0);
      io.to(lobbyId).emit('restartGame');
      // Fai partire subito la partita dopo il restart
      sendNewQuestion(lobbyId);
    }
  });
  socket.on('getProfile', async () => {
    const username = users[socket.id]?.username;
    if (!username) {
      socket.emit('profileData', { name: 'Ospite', level: 1, xp: 0, xpForNextLevel: 100, gamesPlayed: 0, gamesWon: 0, correctAnswers: 0, wrongAnswers: 0, language: 'it', trophies: 0, coins: 0, gems: 0, avatars: [], backgrounds: [] });
      return;
    }
    const user = await User.findOne({ username });
    if (user) {
      const xpForNextLevel = 100 + (user.level - 1) * 50;
      socket.emit('profileData', {
        name: user.username,
        language: user.language || 'it',
        level: user.level,
        xp: user.xp,
        xpForNextLevel,
        gamesPlayed: user.gamesPlayed,
        gamesWon: user.gamesWon,
        correctAnswers: user.correctAnswers,
        wrongAnswers: user.wrongAnswers,
        trophies: user.trophies || 0,
        coins: user.coins || 0,
        gems: user.gems || 0,
        avatars: user.avatars || [],
        backgrounds: user.backgrounds || []
      });
    }
  });
  socket.on('usePowerUp', ({ lobbyId, type }) => {
    const lobby = lobbies[lobbyId];
    if (!lobby || !lobby.singlePlayerMode) return; // Solo single player!
    const player = lobby.players[0];
    if (!player.powerUpsUsed) {
      player.powerUpsUsed = { '5050': false, 'skip': false, 'time': false };
    }
    if (player.powerUpsUsed[type]) return; // Già usato








    if (type === '5050' && lobby.currentQuestion) {
      player.powerUpsUsed['5050'] = true;
      const correct = lobby.currentQuestion.correct_answer;
      const incorrects = [...lobby.currentQuestion.incorrect_answers];
      const keepIncorrect = incorrects[Math.floor(Math.random() * incorrects.length)];
      const keepAnswers = [correct, keepIncorrect];
      io.to(socket.id).emit('powerUpResult', { type: '5050', keepAnswers });
    }
    if (type === 'skip') {
      player.powerUpsUsed['skip'] = true;
      // Salta la domanda: passa subito alla prossima senza penalità
      clearInterval(lobby.timerInterval);
      io.to(lobbyId).emit('showCorrectAnswer', {
        correct_answer: lobby.currentQuestion.correct_answer
      });
      setTimeout(() => {
        const scores = lobby.players.map(p => ({
          id: p.id,
          name: p.name,
          score: p.score,
          singlePlayerTrophies: p.singlePlayerTrophies
        }));
        io.to(lobbyId).emit('scoreboard', scores);
        setTimeout(() => {
          sendNewQuestion(lobbyId);
        }, 5000);
      }, 4000);
    }
    if (type === 'time') {
      player.powerUpsUsed['time'] = true;
      // Aggiungi 10 secondi solo se il timer è attivo e >0
      if (typeof lobby._timeRemaining === 'number' && lobby._timeRemaining > 0) {
        lobby._timeRemaining += 10;
        io.to(socket.id).emit('powerUpResult', { type: 'time', added: 10, newTime: lobby._timeRemaining });
      }
    }
    // Aggiorna lo stato dei power-up disponibili dopo l'uso
    io.to(socket.id).emit('powerUpStatus', {
      available: {
        '5050': !player.powerUpsUsed['5050'],
        'skip': !player.powerUpsUsed['skip'],
        'time': !player.powerUpsUsed['time']
      }
    });
  });








  // --- SFIDA UN AMICO ---








  socket.on('challengeFriend', ({ to, from }) => {
    if (!to || !from) return;
    // Consenti invito solo se sono amici
    User.findOne({ username: from }).then(user => {
      if (!user || !user.friends.includes(to)) return;
      if (!pendingChallenges[to]) pendingChallenges[to] = [];
      if (!pendingChallenges[to].some(inv => inv.from === from)) {
        pendingChallenges[to].push({ from });
      }
      const toSocketId = onlineUsers[to];
      if (toSocketId) {
        io.to(toSocketId).emit('challengeInvite', { from });
        io.to(toSocketId).emit('challengeInvitesList', pendingChallenges[to]);
      }
      const fromSocketId = onlineUsers[from];
      if (fromSocketId) {
        io.to(fromSocketId).emit('challengeInvitesList', pendingChallenges[from] || []);
      }
    });
  });








  // Accetta una sfida
  socket.on('acceptChallenge', async ({ from, to }) => {
    // Rimuovi invito dai pending
    if (pendingChallenges[to]) {
      pendingChallenges[to] = pendingChallenges[to].filter(inv => inv.from !== from);
      // Aggiorna lista inviti all'utente che ha accettato
      const toSocketId = onlineUsers[to];
      if (toSocketId) {
        io.to(toSocketId).emit('challengeInvitesList', pendingChallenges[to]);
      }
    }
    // Aggiorna lista inviti anche per il mittente
    if (pendingChallenges[from]) {
      const fromSocketId = onlineUsers[from];
      if (fromSocketId) {
        io.to(fromSocketId).emit('challengeInvitesList', pendingChallenges[from]);
      }
    }
    // Crea una lobby privata con flag isChallenge
    const lobbyId = Math.random().toString(36).substr(2, 8).toUpperCase();
    lobbies[lobbyId] = {
      players: [],
      currentQuestion: null,
      questionsSent: 0,
      maxQuestions: 10,
      hostId: null, // verrà impostato dopo
      isChallenge: true
    };
    // Recupera socketId di entrambi
    const fromSocketId = onlineUsers[from];
    const toSocketId = onlineUsers[to];
    // Carica profili dal DB
    let userFrom = await User.findOne({ username: from });
    let userTo = await User.findOne({ username: to });
    // Prepara dati player
    const playerFrom = {
      id: fromSocketId,
      score: 0,
      name: userFrom?.username || from,
      username: from,
      language: userFrom?.language || 'it',
      level: userFrom?.level || 1,
      xp: userFrom?.xp || 0,
      gamesPlayed: userFrom?.gamesPlayed || 0,
      gamesWon: userFrom?.gamesWon || 0,
      correctAnswers: userFrom?.correctAnswers || 0,
      wrongAnswers: userFrom?.wrongAnswers || 0,
      trophies: userFrom?.trophies || 0,
      coins: userFrom?.coins || 0
    };
    const playerTo = {
      id: toSocketId,
      score: 0,
      name: userTo?.username || to,
      username: to,
      language: userTo?.language || 'it',
      level: userTo?.level || 1,
      xp: userTo?.xp || 0,
      gamesPlayed: userTo?.gamesPlayed || 0,
      gamesWon: userTo?.gamesWon || 0,
      correctAnswers: userTo?.correctAnswers || 0,
      wrongAnswers: userTo?.wrongAnswers || 0,
      trophies: userTo?.trophies || 0,
      coins: userTo?.coins || 0
    };
    // Aggiungi entrambi i player alla lobby
    lobbies[lobbyId].players.push(playerFrom, playerTo);
    lobbies[lobbyId].hostId = fromSocketId;
    // Aggiorna users map
    if (fromSocketId) users[fromSocketId] = { ...playerFrom };
    if (toSocketId) users[toSocketId] = { ...playerTo };
    // Unisci entrambi alla stanza
    if (fromSocketId) io.sockets.sockets.get(fromSocketId)?.join(lobbyId);
    if (toSocketId) io.sockets.sockets.get(toSocketId)?.join(lobbyId);
    // Notifica entrambi che la sfida è stata accettata e fornisci lobbyId
    if (fromSocketId) io.to(fromSocketId).emit('challengeAccepted', { lobbyId });
    if (toSocketId) io.to(toSocketId).emit('challengeAccepted', { lobbyId });
    // Invia stato lobby
    io.to(lobbyId).emit('lobbyPlayers', lobbies[lobbyId].players);
  });








  // Rifiuta una sfida
  socket.on('rejectChallenge', ({ from, to }) => {
    if (pendingChallenges[to]) {
      pendingChallenges[to] = pendingChallenges[to].filter(inv => inv.from !== from);
      // Aggiorna lista inviti all'utente che ha rifiutato
      const toSocketId = onlineUsers[to];
      if (toSocketId) {
        io.to(toSocketId).emit('challengeInvitesList', pendingChallenges[to]);
      }
    }
    // Aggiorna lista inviti anche per il mittente
    if (pendingChallenges[from]) {
      const fromSocketId = onlineUsers[from];
      if (fromSocketId) {
        io.to(fromSocketId).emit('challengeInvitesList', pendingChallenges[from]);
      }
    }
    // Notifica opzionale all'invitante
    const fromSocketId = onlineUsers[from];
    if (fromSocketId) {
      io.to(fromSocketId).emit('challengeRejected', { to });
    }
  });




  // --- CHAT DI LOBBY E PARTITA ---
  socket.on('lobbyChat', ({ lobbyId, username, msg }) => {
    // Inoltra il messaggio a TUTTI i client nella lobby, inclusi host e amici
    if (lobbyId && msg && username) {
      io.to(lobbyId).emit('lobbyChat', { username, msg });
    }
  });




  socket.on('disconnect', () => {
    for (const lobbyId in lobbies) {
      const lobby = lobbies[lobbyId];
      lobby.players = lobby.players.filter(p => p.id !== socket.id);
      if (lobby.readyPlayers) {
        lobby.readyPlayers.delete(socket.id);
      }
      io.to(lobbyId).emit('lobbyPlayers', lobby.players);
      if (lobby.players.length === 0) {
        delete lobbies[lobbyId];
      }
    }
    // Rimuovi da onlineUsers
    const username = users[socket.id]?.username;
    if (username) {
      delete onlineUsers[username];
      delete pendingChallenges[username];
    }
  });
});

// Avvia il server HTTP
httpServer.listen(3000, () => {
  console.log('Server avviato su http://localhost:3000');
});
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Endpoint per ottenere gli SHOP_ITEMS (rotazione giornaliera 2 avatar + 2 sfondi)
app.get('/api/shop/items', (req, res) => {
  // Filtra avatar e sfondi
  const avatars = SHOP_ITEMS.filter(x => x.type === 'avatar');
  const backgrounds = SHOP_ITEMS.filter(x => x.type === 'background');

  // Calcola la finestra in base al giorno (rotazione ciclica)
  const today = new Date();
  const dayIndex = Math.floor(today.getTime() / (1000 * 60 * 60 * 24)); // giorni dal 1970
  const avatarWindow = 2;
  const bgWindow = 2;

  // Indice di partenza per la finestra
  const avatarStart = (dayIndex * avatarWindow) % avatars.length;
  const bgStart = (dayIndex * bgWindow) % backgrounds.length;

  // Prendi 2 avatar e 2 sfondi, ciclando se serve
  const dailyAvatars = avatars.slice(avatarStart, avatarStart + avatarWindow)
    .concat(avatarStart + avatarWindow > avatars.length ? avatars.slice(0, (avatarStart + avatarWindow) % avatars.length) : []);
  const dailyBackgrounds = backgrounds.slice(bgStart, bgStart + bgWindow)
    .concat(bgStart + bgWindow > backgrounds.length ? backgrounds.slice(0, (bgStart + bgWindow) % backgrounds.length) : []);

  // Valute virtuali sempre visibili
  const currencies = SHOP_ITEMS.filter(x => x.type === 'currency');

  // Calcola i secondi rimanenti alla mezzanotte
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setHours(24, 0, 0, 0);
  const secondsToMidnight = Math.floor((tomorrow - now) / 1000);

  res.json({
    items: [...dailyAvatars, ...dailyBackgrounds, ...currencies],
    secondsToMidnight
  });
});

const SHOP_ITEMS = [
  // Avatar rari/esclusivi
{ id: 'avatar9', type: 'avatar', name: 'Avatar Drago', img: 'avatars/avatar9.png', price: 200, currency: 'coins', rarity: 'rare' },
  { id: 'avatar10', type: 'avatar', name: 'Avatar Ninja', img: 'avatars/avatar10.png', price: 300, currency: 'coins', rarity: 'epic' },
  { id: 'avatar11', type: 'avatar', name: 'Avatar Fenice', img: 'avatars/avatar11.png', price: 500, currency: 'gems', rarity: 'legendary' },
  { id: 'avatar12', type: 'avatar', name: 'Avatar Robot', img: 'avatars/avatar12.png', price: 150, currency: 'coins', rarity: 'rare' },
  { id: 'avatar13', type: 'avatar', name: 'Avatar Pirata', img: 'avatars/avatar13.png', price: 180, currency: 'coins', rarity: 'rare' },
  { id: 'avatar14', type: 'avatar', name: 'Avatar Astronauta', img: 'avatars/avatar14.png', price: 220, currency: 'coins', rarity: 'epic' },
  { id: 'avatar15', type: 'avatar', name: 'Avatar Gatto', img: 'avatars/avatar15.png', price: 120, currency: 'coins', rarity: 'common' },
  { id: 'avatar16', type: 'avatar', name: 'Avatar Cagnolino', img: 'avatars/avatar16.png', price: 120, currency: 'coins', rarity: 'common' },
  { id: 'avatar17', type: 'avatar', name: 'Avatar Unicorno', img: 'avatars/avatar17.png', price: 250, currency: 'coins', rarity: 'epic' },
  { id: 'avatar18', type: 'avatar', name: 'Avatar T-rex', img: 'avatars/avatar18.png', price: 400, currency: 'gems', rarity: 'legendary' },
  { id: 'avatar19', type: 'avatar', name: 'Avatar Fantasma', img: 'avatars/avatar19.png', price: 350, currency: 'gems', rarity: 'legendary' },
  { id: 'avatar20', type: 'avatar', name: 'Avatar Alieno', img: 'avatars/avatar20.png', price: 400, currency: 'gems', rarity: 'legendary' },
  { id: 'avatar21', type: 'avatar', name: 'Avatar Angioletto', img: 'avatars/avatar21.png', price: 450, currency: 'gems', rarity: 'legendary' },
  { id: 'avatar22', type: 'avatar', name: 'Avatar Diavoletto', img: 'avatars/avatar22.png', price: 400, currency: 'gems', rarity: 'legendary' },
  { id: 'avatar23', type: 'avatar', name: 'Avatar Cavaliere', img: 'avatars/avatar23.png', price: 200, currency: 'coins', rarity: 'rare' },
  { id: 'avatar24', type: 'avatar', name: 'Avatar Principessa', img: 'avatars/avatar24.png', price: 220, currency: 'coins', rarity: 'epic' },
  { id: 'avatar25', type: 'avatar', name: 'Avatar Samurai', img: 'avatars/avatar25.png', price: 250, currency: 'coins', rarity: 'epic' },
  { id: 'avatar26', type: 'avatar', name: 'Avatar Astronauta Rosa', img: 'avatars/avatar26.png', price: 230, currency: 'coins', rarity: 'epic' },
  { id: 'avatar27', type: 'avatar', name: 'Avatar Panda', img: 'avatars/avatar27.png', price: 180, currency: 'coins', rarity: 'common' },
  { id: 'avatar28', type: 'avatar', name: 'Avatar Volpe', img: 'avatars/avatar28.png', price: 180, currency: 'coins', rarity: 'common' },
  { id: 'avatar29', type: 'avatar', name: 'Avatar Cavallo', img: 'avatars/avatar29.png', price: 200, currency: 'coins', rarity: 'rare' },
  { id: 'avatar30', type: 'avatar', name: 'Avatar Polpo', img: 'avatars/avatar30.png', price: 210, currency: 'coins', rarity: 'rare' },
  { id: 'avatar31', type: 'avatar', name: 'Avatar Strega', img: 'avatars/avatar31.png', price: 300, currency: 'gems', rarity: 'legendary' },
  { id: 'avatar32', type: 'avatar', name: 'Avatar Supereroe', img: 'avatars/avatar32.png', price: 350, currency: 'gems', rarity: 'legendary' },
  { id: 'avatar33', type: 'avatar', name: 'Avatar Leone', img: 'avatars/avatar33.png', price: 220, currency: 'coins', rarity: 'epic' },
  { id: 'avatar34', type: 'avatar', name: 'Avatar Pinguino', img: 'avatars/avatar34.png', price: 140, currency: 'coins', rarity: 'common' },
  { id: 'avatar35', type: 'avatar', name: 'Avatar Koala', img: 'avatars/avatar35.png', price: 160, currency: 'coins', rarity: 'common' },
  { id: 'avatar36', type: 'avatar', name: 'Avatar Squalo', img: 'avatars/avatar36.png', price: 200, currency: 'coins', rarity: 'rare' },
  { id: 'avatar37', type: 'avatar', name: 'Avatar Gufo', img: 'avatars/avatar37.png', price: 180, currency: 'coins', rarity: 'rare' },
  { id: 'avatar38', type: 'avatar', name: 'Avatar Lupo', img: 'avatars/avatar38.png', price: 210, currency: 'coins', rarity: 'epic' },
  { id: 'avatar39', type: 'avatar', name: 'Avatar Elefante', img: 'avatars/avatar39.png', price: 170, currency: 'coins', rarity: 'common' },
  { id: 'avatar40', type: 'avatar', name: 'Avatar Coccinella', img: 'avatars/avatar40.png', price: 120, currency: 'coins', rarity: 'common' },
  { id: 'avatar41', type: 'avatar', name: 'Avatar Pappagallo', img: 'avatars/avatar41.png', price: 180, currency: 'coins', rarity: 'rare' },
  { id: 'avatar42', type: 'avatar', name: 'Avatar Delfino', img: 'avatars/avatar42.png', price: 200, currency: 'coins', rarity: 'rare' },
  { id: 'avatar43', type: 'avatar', name: 'Avatar Leone Marino', img: 'avatars/avatar43.png', price: 150, currency: 'coins', rarity: 'common' },
  { id: 'avatar44', type: 'avatar', name: 'Avatar Fenicottero', img: 'avatars/avatar44.png', price: 170, currency: 'coins', rarity: 'rare' },
  { id: 'avatar45', type: 'avatar', name: 'Avatar Scoiattolo', img: 'avatars/avatar45.png', price: 120, currency: 'coins', rarity: 'common' },
  { id: 'avatar46', type: 'avatar', name: 'Avatar Cervo', img: 'avatars/avatar46.png', price: 180, currency: 'coins', rarity: 'rare' },
  { id: 'avatar47', type: 'avatar', name: 'Avatar Riccio', img: 'avatars/avatar47.png', price: 130, currency: 'coins', rarity: 'common' },
  { id: 'avatar48', type: 'avatar', name: 'Avatar Giraffa', img: 'avatars/avatar48.png', price: 200, currency: 'coins', rarity: 'rare' },
  { id: 'avatar49', type: 'avatar', name: 'Avatar Gorilla', img: 'avatars/avatar49.png', price: 210, currency: 'coins', rarity: 'epic' },
  { id: 'avatar50', type: 'avatar', name: 'Avatar Cammello', img: 'avatars/avatar50.png', price: 170, currency: 'coins', rarity: 'common' },
  { id: 'avatar51', type: 'avatar', name: 'Avatar Zebra', img: 'avatars/avatar51.png', price: 180, currency: 'coins', rarity: 'rare' },
  { id: 'avatar52', type: 'avatar', name: 'Avatar Piuma', img: 'avatars/avatar52.png', price: 120, currency: 'coins', rarity: 'common' },
  { id: 'avatar53', type: 'avatar', name: 'Avatar Orso Polare', img: 'avatars/avatar53.png', price: 200, currency: 'coins', rarity: 'rare' },
  { id: 'avatar54', type: 'avatar', name: 'Avatar Rana', img: 'avatars/avatar54.png', price: 120, currency: 'coins', rarity: 'common' },
  { id: 'avatar55', type: 'avatar', name: 'Avatar Coccodrillo', img: 'avatars/avatar55.png', price: 210, currency: 'coins', rarity: 'epic' },
  { id: 'avatar56', type: 'avatar', name: 'Avatar Fenice Blu', img: 'avatars/avatar56.png', price: 500, currency: 'gems', rarity: 'legendary' },
  { id: 'avatar57', type: 'avatar', name: 'Avatar Drago Verde', img: 'avatars/avatar57.png', price: 500, currency: 'gems', rarity: 'legendary' },
  { id: 'avatar58', type: 'avatar', name: 'Avatar Robot Rosso', img: 'avatars/avatar58.png', price: 250, currency: 'coins', rarity: 'epic' },
  { id: 'avatar59', type: 'avatar', name: 'Avatar Astronauta Giallo', img: 'avatars/avatar59.png', price: 230, currency: 'coins', rarity: 'epic' },
  { id: 'avatar60', type: 'avatar', name: 'Avatar Gatto Nero', img: 'avatars/avatar60.png', price: 150, currency: 'coins', rarity: 'rare' },
  { id: 'avatar61', type: 'avatar', name: 'Avatar Volpe Artica', img: 'avatars/avatar61.png', price: 200, currency: 'coins', rarity: 'rare' },
  { id: 'avatar62', type: 'avatar', name: 'Avatar Panda Rosso', img: 'avatars/avatar62.png', price: 220, currency: 'coins', rarity: 'epic' },
  { id: 'avatar63', type: 'avatar', name: 'Avatar Unicorno Arcobaleno', img: 'avatars/avatar63.png', price: 60, currency: 'gems', rarity: 'legendary' },
  { id: 'avatar64', type: 'avatar', name: 'Avatar Elfa', img: 'avatars/avatar64.png', price: 60, currency: 'gems', rarity: 'legendary' },
  // Sfondi
  { id: 'bg1', type: 'background', name: 'Sfondo Galassia', img: 'backgrounds/bg1.jpg', price: 100, currency: 'coins' },
  { id: 'bg2', type: 'background', name: 'Sfondo Foresta', img: 'backgrounds/bg2.jpg', price: 120, currency: 'coins' },
  { id: 'bg3', type: 'background', name: 'Sfondo Spiaggia', img: 'backgrounds/bg3.jpg', price: 120, currency: 'coins' },
  { id: 'bg4', type: 'background', name: 'Sfondo Città Notturna', img: 'backgrounds/bg4.jpg', price: 140, currency: 'coins' },
  { id: 'bg5', type: 'background', name: 'Sfondo Tramonto', img: 'backgrounds/bg5.jpg', price: 130, currency: 'coins' },
  { id: 'bg6', type: 'background', name: 'Sfondo Montagna', img: 'backgrounds/bg6.jpg', price: 130, currency: 'coins' },
  { id: 'bg7', type: 'background', name: 'Sfondo Spazio', img: 'backgrounds/bg7.jpg', price: 150, currency: 'coins' },
  // Valuta virtuale (sempre disponibili)
  { id: 'coins500', type: 'currency', name: '500 Monete', price: 2, currency: 'eur', amount: 500 },
  { id: 'gems10', type: 'currency', name: '10 Gemme', price: 1, currency: 'eur', amount: 10 }
];




// --- SHOP ENDPOINT (FASE 3) ---
app.post('/api/shop/buy', async (req, res) => {
  const { itemId, username } = req.body;
  const item = SHOP_ITEMS.find(x => x.id === itemId);
  if (!item) return res.status(400).json({ error: 'Oggetto non trovato' });




  // Valuta reale: Stripe (solo stub, implementa con Stripe SDK)
if (item.currency === 'eur') {
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: item.name,
          },
          unit_amount: item.price * 100, // prezzo in centesimi
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: 'http://localhost:3000/shop-success.html',
      cancel_url: 'http://localhost:3000/shop-cancel.html',
      metadata: {
        username,
        itemId: item.id
      }
    });
    return res.json({ url: session.url });
  } catch (err) {
    console.error('Errore Stripe:', err);
    return res.status(500).json({ error: 'Errore pagamento Stripe' });
  }
}








  // Valuta virtuale (coins/gems)
  if (!username) return res.status(401).json({ error: 'Utente non autenticato' });
  const user = await User.findOne({ username });
  if (!user) return res.status(404).json({ error: 'Utente non trovato' });




  // Controlla saldo
  if (item.currency === 'coins') {
    if ((user.coins || 0) < item.price) return res.json({ error: 'Monete insufficienti' });
    user.coins -= item.price;
  } else if (item.currency === 'gems') {
    if ((user.gems || 0) < item.price) return res.json({ error: 'Gemme insufficienti' });
    user.gems -= item.price;
  }




  // Aggiorna inventario/avatar/sfondi
  if (item.type === 'avatar') {
    if (!user.avatars) user.avatars = [];
    if (!user.avatars.includes(item.img)) user.avatars.push(item.img);
  }
  if (item.type === 'background') {
    if (!user.backgrounds) user.backgrounds = [];
    if (!user.backgrounds.includes(item.img)) user.backgrounds.push(item.img);
  }
  // Aggiorna valuta se acquisti monete/gemme (valuta reale)
  if (item.type === 'currency' && item.currency === 'eur') {
    // L'accredito avviene tramite webhook Stripe dopo il pagamento
    // Qui non fare nulla
  }




  await user.save();
  res.json({ success: true });
});
