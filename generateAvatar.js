const fs = require('fs');
const path = require('path');
const { avataaars } = require('@dicebear/collection');
const { createAvatar } = require('@dicebear/core');

const username = process.argv[2] || 'default';

let svg;
if (username.toLowerCase() === 'pinguino') {
  // SVG semplice di un pinguino (puoi sostituirlo con uno più dettagliato)
  svg = `
<svg width="128" height="128" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="64" cy="80" rx="40" ry="40" fill="#222"/>
  <ellipse cx="64" cy="100" rx="28" ry="20" fill="#fff"/>
  <ellipse cx="50" cy="75" rx="6" ry="8" fill="#fff"/>
  <ellipse cx="78" cy="75" rx="6" ry="8" fill="#fff"/>
  <ellipse cx="50" cy="77" rx="2" ry="3" fill="#222"/>
  <ellipse cx="78" cy="77" rx="2" ry="3" fill="#222"/>
  <polygon points="64,90 60,100 68,100" fill="#ffb300"/>
</svg>
  `;
} else {
  svg = createAvatar(avataaars, { seed: username }).toString();
}

const avatarsDir = path.join('C:/Users/lucab/OneDrive/Desktop/quiz-game-backend/public/avatars');
if (!fs.existsSync(avatarsDir)) {
    fs.mkdirSync(avatarsDir, { recursive: true });
}

const filePath = path.join(avatarsDir, `avatar-${username}.svg`);
fs.writeFileSync(filePath, svg);

console.log(`Avatar generated for ${username}: ${filePath}`);
