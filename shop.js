// Cache per gli items caricati dal backend
let _allShopItemsCache = null;

// Quanti oggetti avatar/sfondo mostrare ogni giorno
const SHOP_DAILY_AVATAR_COUNT = 2;
const SHOP_DAILY_BG_COUNT = 2;

// Funzione per mostrare il timer giornaliero del negozio SOLO nella modale shop
function renderShopTimer(seconds) {
  let timerEl = document.getElementById('shopTimer');
  // Se il timer non esiste nella modale, crealo sopra la lista
  if (!timerEl) {
    const modal = document.getElementById('shopModal');
    if (modal) {
      timerEl = document.createElement('div');
      timerEl.id = 'shopTimer';
      timerEl.style.fontWeight = 'bold';
      timerEl.style.fontSize = '1.1em';
      timerEl.style.marginBottom = '10px';
      // Inserisci sopra la lista oggetti
      const itemsList = document.getElementById('shopItemsList');
      if (itemsList && itemsList.parentNode) {
        itemsList.parentNode.insertBefore(timerEl, itemsList);
      } else {
        modal.insertBefore(timerEl, modal.firstChild);
      }
    }
  }
  if (!timerEl) return;
  function update() {
    if (seconds < 0) return;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    timerEl.textContent = `Aggiornamento tra: ${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    seconds--;
    if (seconds >= 0) setTimeout(update, 1000);
  }
  update();
}

// Funzione per ottenere la selezione giornaliera (stabile per ogni giorno)
async function getDailyShopItems() {
  if (!_allShopItemsCache) {
    try {
      const response = await fetch('/api/shop/items');
      if (!response.ok) {
        console.error('Failed to fetch shop items:', response.status);
        return [];
      }
      const data = await response.json();
      _allShopItemsCache = data.items;
      if (typeof data.secondsToMidnight === 'number') {
        renderShopTimer(data.secondsToMidnight);
      }
    } catch (error) {
      console.error('Error fetching shop items:', error);
      return [];
    }
  }

  // Usa la data locale come "seed"
  const today = new Date();
  const seed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
  function seededRandom(s) {
    // Semplice LCG
    s = Math.sin(s) * 10000;
    return s - Math.floor(s);
  }
  // Filtra avatar e sfondi
  const avatars = _allShopItemsCache.filter(i => i.type === 'avatar');
  const bgs = _allShopItemsCache.filter(i => i.type === 'background');
  // Mischia con seed
  const shuffledAvatars = avatars.slice().sort((a, b) => seededRandom(seed + a.id.length) - 0.5);
  const shuffledBgs = bgs.slice().sort((a, b) => seededRandom(seed + b.id.length) - 0.5);
  // Prendi N avatar/sfondi
  const dailyAvatars = shuffledAvatars.slice(0, SHOP_DAILY_AVATAR_COUNT);
  const dailyBgs = shuffledBgs.slice(0, SHOP_DAILY_BG_COUNT);
  // Valuta sempre disponibili
  const always = _allShopItemsCache.filter(i => i.type === 'currency');
  // Unisci tutto
  return [...dailyAvatars, ...dailyBgs, ...always];
}

// --- SHOP UI ---
window.showShop = async function() {
  closeAllModals(); // Assicurati che closeAllModals sia definita globalmente o passala come dipendenza
  let modal = document.getElementById('shopModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'shopModal';
    modal.className = 'profile-modal'; // Assumi che questa classe esista e sia definita in CSS
    modal.style.display = 'block';
    modal.style.minWidth = '340px';
    modal.style.zIndex = '10001'; // Usa stringhe per zIndex
    modal.innerHTML = `
      <h2>Negozio</h2>
      <div style="margin-bottom:10px;">
        <select id="shopFilterType">
          <option value="">Tutti</option>
          <option value="avatar">Avatar</option>
          <option value="background">Sfondi</option>
          <option value="currency">Valuta</option>
        </select>
      </div>
      <div id="shopItemsList"></div>
      <button id="closeShopModal" style="background:#888;margin-top:16px;">Chiudi</button>
      <div style="font-size:0.95em;color:#888;margin-top:8px;">Il negozio si aggiorna ogni giorno!</div>
    `;
    document.body.appendChild(modal);
    document.getElementById('closeShopModal').onclick = () => { modal.style.display = 'none'; };
    document.getElementById('shopFilterType').onchange = renderShopItems;

    // Aggiungi event listener per chiudere la modale cliccando fuori
    modal.addEventListener('mousedown', function(e) {
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    });
  } else {
    modal.style.display = 'block';
  }
  renderShopItems();
};

async function renderShopItems() {
  const filterElement = document.getElementById('shopFilterType');
  const listElement = document.getElementById('shopItemsList');

  if (!filterElement || !listElement) {
      console.error('Shop filter or list element not found.');
      return;
  }
  const filter = filterElement.value;
  listElement.innerHTML = '<p>Caricamento negozio...</p>';

  const items = await getDailyShopItems();
  listElement.innerHTML = '';

  if (!items || items.length === 0) {
    listElement.innerHTML = '<p>Impossibile caricare gli articoli del negozio. Riprova più tardi.</p>';
    return;
  }

  const user = window.lastLobbyPlayers && window.lastLobbyPlayers[0];
  const ownedAvatars = user && user.avatars ? user.avatars : [];
  const ownedBackgrounds = user && user.backgrounds ? user.backgrounds : [];

  items.filter(item => !filter || item.type === filter).forEach(item => {
    let priceStr = item.currency === 'coins' ? `🪙 ${item.price}` :
                   item.currency === 'gems' ? `💎 ${item.price}` :
                   `€ ${item.price}`;
    let imgHtml = '';
    if (item.img) {
        imgHtml = `<img src="${item.img}" alt="${item.name}" style="width:48px;height:48px;border-radius:8px;margin-right:8px;vertical-align:middle;">`;
    }
    
    let btn = `<button data-buy="${item.id}" style="margin-left:8px;">Compra</button>`;

    if (item.type === 'avatar' && ownedAvatars.includes(item.img)) {
      btn = `<button disabled style="margin-left:8px;background:#aaa;color:#fff;opacity:0.7;cursor:not-allowed;">Già in possesso</button>`;
    }
    if (item.type === 'background' && ownedBackgrounds.includes(item.img)) {
      imgHtml = `<img src="${item.img}" alt="${item.name}" style="width:48px;height:48px;border-radius:8px;margin-right:8px;vertical-align:middle;cursor:pointer;" onclick="window.setBackground('${item.img}')">`;
      btn = `<button disabled style="margin-left:8px;background:#aaa;color:#fff;opacity:0.7;cursor:not-allowed;">Già in possesso</button>`;
    }

    listElement.innerHTML += `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <span>${imgHtml}<b>${item.name}</b> ${item.rarity ? `<span style="color:gold;font-size:0.9em;">(${item.rarity})</span>` : ''}</span>
        <span>${priceStr} ${btn}</span>
      </div>
    `;
  });

  listElement.querySelectorAll('button[data-buy]').forEach(btn => {
    btn.onclick = function() {
      const id = this.getAttribute('data-buy');
      buyShopItem(id);
    };
  });
}

// --- LOGICA ACQUISTO FRONTEND (chiama backend) ---
function buyShopItem(itemId) {
  const username = localStorage.getItem('username');
  if (!username) {
      alert('Devi essere loggato per acquistare.');
      return;
  }

  fetch('/api/shop/buy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemId, username })
  })
  .then(res => res.json())
  .then(data => {
    if (data.url) { // Stripe redirect
      localStorage.setItem('shopJustPaid', '1'); // Flag per polling dopo redirect
      window.location.href = data.url;
    } else if (data.success) {
      alert('Acquisto completato!');
      if (window.socket) { // Usa window.socket se disponibile
        window.socket.emit('getProfile'); // Richiedi aggiornamento profilo
        window.socket.once('profileData', (profile) => {
            window.lastLobbyPlayers = window.lastLobbyPlayers || [{}];
            window.lastLobbyPlayers[0] = Object.assign(window.lastLobbyPlayers[0] || {}, profile);
            renderShopItems(); // Aggiorna la UI dello shop
        });
      }
    } else {
      alert(data.error || 'Errore acquisto');
    }
  })
  .catch(err => {
      console.error('Errore durante l\'acquisto:', err);
      alert('Errore di connessione durante l\'acquisto.');
  });
}

// Event Listener per il bottone dello shop (da main.js, assicurati che sia presente o aggiungilo qui se necessario)
// window.addEventListener('DOMContentLoaded', () => {
//   const shopButton = document.getElementById('shopButton');
//   if (shopButton) {
//     shopButton.onclick = window.showShop;
//   }
// });

// Funzione closeAllModals (se non è già globale da main.js)
if (typeof closeAllModals === 'undefined') {
    window.closeAllModals = function() {
        [
            'profileModal', 'leaderboardModal', 'friendsModal', 
            'missionsModal', 'shopModal', 'challengeModal', 
            'challengeInvitesModal'
        ].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
    };
} 