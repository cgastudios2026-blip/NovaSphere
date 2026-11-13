const state = {
  user: null,
  leaderboard: [],
  theme: localStorage.getItem('novaTheme') || 'dark',
  currentGame: null,
  currentQuestion: 0,
};

const authOverlay = document.getElementById('authOverlay');
const appShell = document.getElementById('appShell');
const loginBtn = document.getElementById('loginBtn');
const authTabs = document.querySelectorAll('[data-auth-tab]');
const authForms = document.querySelectorAll('.auth-form');
const authMessage = document.getElementById('authMessage');
const themeToggle = document.getElementById('themeToggle');
const logoutBtn = document.getElementById('logoutBtn');
const progressLogoutBtn = document.getElementById('progressLogoutBtn');
const accountLogoutBtn = document.getElementById('accountLogoutBtn');
const profileName = document.getElementById('profileName');
const profileEmail = document.getElementById('profileEmail');
const leaderboardBody = document.getElementById('leaderboardBody');
const gameModal = document.getElementById('gameModal');
const gameContainer = document.getElementById('gameContainer');
const closeGameModal = document.getElementById('closeGameModal');
const randomGameBtn = document.getElementById('playRandomGame');

const games = [
  'number',
  'tictactoe',
  'rps',
  'memory',
  'quiz',
  'dice',
  'typing',
  'reaction',
  'color',
  'spin',
];

function applyTheme(theme) {
  document.body.setAttribute('data-theme', theme);
  localStorage.setItem('novaTheme', theme);
  const icon = themeToggle.querySelector('i');
  icon.className = theme === 'dark' ? 'bx bx-moon' : 'bx bx-sun';
}

function showMessage(text, type = 'success') {
  authMessage.textContent = text;
  authMessage.style.color = type === 'success' ? 'var(--success)' : '#ff8c8c';
}

function showAuthTab(tabName) {
  authTabs.forEach((button) => {
    const active = button.dataset.authTab === tabName;
    button.classList.toggle('active', active);
  });

  authForms.forEach((form) => {
    form.classList.toggle('active', form.id === `${tabName}Form`);
  });
}

function setVisibleSection(targetId) {
  document.querySelectorAll('.nav-link').forEach((button) => {
    button.classList.toggle('active', button.dataset.target === targetId);
  });

  document.querySelectorAll('.page-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === targetId);
  });
}

function setLoggedInUI(user) {
  state.user = user;
  authOverlay.classList.add('hidden');
  appShell.classList.remove('hidden');
  localStorage.setItem('novaUser', JSON.stringify(user));
  profileName.textContent = `${user.first_name || user.name || 'Player'} ${user.last_name || ''}`.trim() || 'Player';
  profileEmail.textContent = user.email || 'player@example.com';
  document.getElementById('accountName').value = user.first_name || '';
  document.getElementById('accountSurname').value = user.last_name || '';
  document.getElementById('accountEmail').value = user.email || '';
  logoutBtn.style.display = 'inline-flex';
  renderLeaderboard();
}

function setLoggedOutUI() {
  state.user = null;
  localStorage.removeItem('novaSessionToken');
  localStorage.removeItem('novaUser');
  appShell.classList.remove('hidden');
  authOverlay.classList.add('hidden');
  showAuthTab('login');
  logoutBtn.style.display = 'none';
  if (profileName) profileName.textContent = 'Guest Player';
  if (profileEmail) profileEmail.textContent = 'guest@novasphere.local';
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isStrongPassword(password) {
  return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(password);
}

function getStoredUsers() {
  try {
    return JSON.parse(localStorage.getItem('novaUsers') || '[]');
  } catch (error) {
    return [];
  }
}

function saveStoredUsers(users) {
  localStorage.setItem('novaUsers', JSON.stringify(users));
}

async function apiRequest(path, options = {}) {
  const method = options.method || 'GET';
  const body = options.body ? JSON.stringify(options.body) : null;
  const token = localStorage.getItem('novaSessionToken');

  try {
    const response = await fetch(path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
      body,
    });

    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await response.json() : await response.text();

    if (!response.ok) {
      throw new Error(typeof payload === 'object' ? payload.message || 'Request failed' : payload || 'Request failed');
    }

    return payload;
  } catch (error) {
    if (path === '/api/register') {
      const users = getStoredUsers();
      const payload = options.body || {};
      const email = (payload.email || '').trim().toLowerCase();
      const existingUser = users.find((user) => (user.email || '').toLowerCase() === email);

      if (existingUser) {
        throw new Error('This email is already registered.');
      }

      const nextUser = {
        first_name: payload.first_name || '',
        last_name: payload.last_name || '',
        email,
        dob: payload.dob || '',
        age: computeAge(payload.dob || ''),
        password: payload.password || '',
        accepted_terms: !!payload.accepted_terms,
        accepted_privacy: !!payload.accepted_privacy,
      };

      users.push(nextUser);
      saveStoredUsers(users);
      return { message: 'Registration successful. You can now log in.' };
    }

    if (path === '/api/login') {
      const users = getStoredUsers();
      const payload = options.body || {};
      const email = (payload.email || '').trim().toLowerCase();
      const password = payload.password || '';
      const match = users.find((user) => (user.email || '').toLowerCase() === email && user.password === password);

      if (!match) {
        throw new Error('Invalid email or password.');
      }

      const token = 'local-' + Date.now();
      localStorage.setItem('novaSessionToken', token);
      const user = {
        first_name: match.first_name,
        last_name: match.last_name,
        email: match.email,
        dob: match.dob,
        age: match.age,
      };
      localStorage.setItem('novaUser', JSON.stringify(user));
      return { message: 'Login successful.', token, user };
    }

    if (path === '/api/forgot') {
      const payload = options.body || {};
      const email = (payload.email || '').trim().toLowerCase();
      const users = getStoredUsers();
      const match = users.some((user) => (user.email || '').toLowerCase() === email);
      if (!match) {
        throw new Error('No account was found for that email.');
      }
      return { message: `Password reset instructions were sent to ${email}.` };
    }

    if (path === '/api/logout') {
      return { message: 'Logged out successfully.' };
    }

    throw error;
  }
}

async function registerUser(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = {
    first_name: document.getElementById('firstName').value.trim(),
    last_name: document.getElementById('lastName').value.trim(),
    email: document.getElementById('registerEmail').value.trim(),
    dob: document.getElementById('dob').value,
    password: document.getElementById('registerPassword').value,
    confirm_password: document.getElementById('confirmPassword').value,
    accepted_terms: document.getElementById('termsCheck').checked,
    accepted_privacy: document.getElementById('privacyCheck').checked,
  };

  if (!payload.first_name || !payload.last_name) {
    showMessage('First name and surname are required.', 'error');
    return;
  }

  if (!/^[A-Za-zÀ-ÖØ-öø-ÿ' -]{2,}$/.test(payload.first_name) || !/^[A-Za-zÀ-ÖØ-öø-ÿ' -]{2,}$/.test(payload.last_name)) {
    showMessage('Names must use valid letters and be at least 2 characters long.', 'error');
    return;
  }

  if (!payload.email || !isValidEmail(payload.email)) {
    showMessage('Please enter a valid email address.', 'error');
    return;
  }

  if (!payload.dob || computeAge(payload.dob) < 13) {
    showMessage('You must be at least 13 years old to register.', 'error');
    return;
  }

  if (!isStrongPassword(payload.password)) {
    showMessage('Password must be at least 8 characters and include uppercase, lowercase, number, and special character.', 'error');
    return;
  }

  if (payload.password !== payload.confirm_password) {
    showMessage('Passwords do not match.', 'error');
    return;
  }

  if (!payload.accepted_terms || !payload.accepted_privacy) {
    showMessage('You must accept the Terms & Conditions and Privacy Policy.', 'error');
    return;
  }

  try {
    const result = await apiRequest('/api/register', { method: 'POST', body: payload });
    showMessage(result.message || 'Registration successful. Please sign in.', 'success');
    form.reset();
    document.getElementById('age').value = '';
    showAuthTab('login');
  } catch (error) {
    showMessage(error.message, 'error');
  }
}

async function loginUser(event) {
  event.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  if (!isValidEmail(email)) {
    showMessage('Please enter a valid email address.', 'error');
    return;
  }

  if (!password || password.length < 6) {
    showMessage('Password must be at least 6 characters long.', 'error');
    return;
  }

  try {
    const result = await apiRequest('/api/login', {
      method: 'POST',
      body: { email, password },
    });

    localStorage.setItem('novaSessionToken', result.token);
    localStorage.setItem('novaUser', JSON.stringify(result.user));
    showMessage('Login successful.', 'success');
    setLoggedInUI(result.user);
    document.getElementById('loginForm').reset();
    await getLeaderboard();
  } catch (error) {
    showMessage(error.message, 'error');
  }
}

async function forgotPassword(event) {
  event.preventDefault();
  const email = document.getElementById('forgotEmail').value.trim();

  if (!isValidEmail(email)) {
    showMessage('Please enter a valid email address to continue.', 'error');
    return;
  }

  try {
    const result = await apiRequest('/api/forgot', {
      method: 'POST',
      body: { email },
    });
    showMessage(result.message || 'Reset link sent successfully.', 'success');
    document.getElementById('forgotForm').reset();
    showAuthTab('login');
  } catch (error) {
    showMessage(error.message, 'error');
  }
}

async function getLeaderboard() {
  try {
    const response = await fetch('/api/leaderboard');
    const payload = await response.json();
    if (response.ok) {
      state.leaderboard = payload.leaderboard || [];
      renderLeaderboard();
    }
  } catch (error) {
    state.leaderboard = [
      { name: 'Ava', score: 1480, streak: 12 },
      { name: 'Milo', score: 1340, streak: 10 },
      { name: 'Leah', score: 1285, streak: 9 },
      { name: 'Kai', score: 1200, streak: 8 },
      { name: 'Nia', score: 1145, streak: 7 },
    ];
    renderLeaderboard();
  }
}

function renderLeaderboard() {
  const rows = (state.leaderboard.length ? state.leaderboard : [
    { name: 'Ava', score: 1480, streak: 12 },
    { name: 'Milo', score: 1340, streak: 10 },
    { name: 'Leah', score: 1285, streak: 9 },
    { name: 'Kai', score: 1200, streak: 8 },
    { name: 'Nia', score: 1145, streak: 7 },
  ]).slice(0, 6);

  leaderboardBody.innerHTML = rows.map((player, index) => `
    <tr>
      <td>#${index + 1}</td>
      <td>${player.name}</td>
      <td>${player.score}</td>
      <td>${player.streak} days</td>
    </tr>
  `).join('');
}

function computeAge(dateString) {
  if (!dateString) return '';
  const today = new Date();
  const birthDate = new Date(dateString);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age -= 1;
  }
  return age;
}

function bindRegisterAge() {
  const dobInput = document.getElementById('dob');
  const ageInput = document.getElementById('age');
  dobInput.addEventListener('input', () => {
    ageInput.value = computeAge(dobInput.value);
  });
}

function bindNavigation() {
  document.querySelectorAll('.nav-link').forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.dataset.target;
      setVisibleSection(target);
    });
  });

  document.querySelectorAll('[data-target]').forEach((button) => {
    if (button.classList.contains('nav-link') || button.classList.contains('password-toggle')) return;
    button.addEventListener('click', () => {
      const target = button.dataset.target;
      setVisibleSection(target);
    });
  });
}

async function logoutAction() {
  try {
    const token = localStorage.getItem('novaSessionToken');
    if (token) {
      await apiRequest('/api/logout', { method: 'POST' });
    }
  } catch (error) {
    console.warn('Logout API warning:', error.message);
  } finally {
    setLoggedOutUI();
  }
}

function togglePasswordVisibility(button) {
  const input = document.getElementById(button.dataset.target);
  if (!input) return;
  const isVisible = input.type === 'text';
  input.type = isVisible ? 'password' : 'text';
  const icon = button.querySelector('i');
  icon.className = isVisible ? 'bx bx-show' : 'bx bx-hide';
}

function bindPasswordToggles() {
  document.querySelectorAll('.password-toggle').forEach((button) => {
    button.addEventListener('click', () => togglePasswordVisibility(button));
  });
}

bindRegisterAge();
applyTheme(state.theme);
showAuthTab('login');
logoutBtn.style.display = 'none';
renderLeaderboard();
getLeaderboard();

if (localStorage.getItem('novaSessionToken')) {
  try {
    const token = localStorage.getItem('novaSessionToken');
    const user = JSON.parse(localStorage.getItem('novaUser') || 'null');
    if (user && token) {
      setLoggedInUI(user);
    } else {
      setLoggedOutUI();
    }
  } catch (error) {
    localStorage.removeItem('novaSessionToken');
    setLoggedOutUI();
  }
} else {
  setLoggedOutUI();
}

loginBtn.addEventListener('click', () => {
  authOverlay.classList.remove('hidden');
  appShell.classList.remove('hidden');
  showAuthTab('login');
});

document.getElementById('loginForm').addEventListener('submit', loginUser);
document.getElementById('registerForm').addEventListener('submit', registerUser);
document.getElementById('forgotForm').addEventListener('submit', forgotPassword);

authTabs.forEach((button) => {
  button.addEventListener('click', () => {
    showAuthTab(button.dataset.authTab);
  });
});

logoutBtn.addEventListener('click', logoutAction);
progressLogoutBtn.addEventListener('click', logoutAction);
accountLogoutBtn.addEventListener('click', logoutAction);

window.addEventListener('load', () => {
  bindNavigation();
  bindPasswordToggles();
  document.getElementById('themeSelect').value = state.theme;
  document.getElementById('themeSelect').addEventListener('change', (event) => {
    applyTheme(event.target.value);
  });

  themeToggle.addEventListener('click', () => {
    const nextTheme = document.body.getAttribute('data-theme') === 'dark' ? 'neon' : 'dark';
    applyTheme(nextTheme);
    document.getElementById('themeSelect').value = nextTheme;
  });

  document.getElementById('saveProfileBtn').addEventListener('click', async () => {
    const first = document.getElementById('accountName').value.trim();
    const last = document.getElementById('accountSurname').value.trim();
    const email = document.getElementById('accountEmail').value.trim();
    const user = { ...state.user, first_name: first, last_name: last, email };

    try {
      await apiRequest('/api/account', {
        method: 'POST',
        body: { first_name: first, last_name: last, email },
      });
      state.user = user;
      localStorage.setItem('novaUser', JSON.stringify(user));
      profileName.textContent = `${first} ${last}`.trim();
      profileEmail.textContent = email;
      showMessage('Profile updated successfully.', 'success');
    } catch (error) {
      showMessage(error.message, 'error');
    }
  });

  document.getElementById('closeGameModal').addEventListener('click', () => {
    gameModal.classList.add('hidden');
    gameContainer.innerHTML = '';
  });

  document.querySelectorAll('.game-card').forEach((card) => {
    card.addEventListener('click', () => openGame(card.dataset.game));
  });

  randomGameBtn.addEventListener('click', () => {
    const random = games[Math.floor(Math.random() * games.length)];
    openGame(random);
  });
});

function openGame(type) {
  gameModal.classList.remove('hidden');
  const map = {
    number: createNumberGuessGame,
    tictactoe: createTicTacToeGame,
    rps: createRpsGame,
    memory: createMemoryGame,
    quiz: createQuizGame,
    dice: createDiceGame,
    typing: createTypingGame,
    reaction: createReactionGame,
    color: createColorGame,
    spin: createLuckySpinGame,
  };

  if (map[type]) {
    map[type]();
  }
}

function createGameLayout(title) {
  gameContainer.innerHTML = `
    <div class="game-panel">
      <div class="game-header">
        <h3>${title}</h3>
        <div class="score-box">Score: <span id="gameScore">0</span></div>
      </div>
      <div class="mini-game" id="miniGame"></div>
    </div>
  `;
  return document.getElementById('miniGame');
}

function updateScore(value) {
  const scoreBox = document.getElementById('gameScore');
  if (scoreBox) {
    scoreBox.textContent = value;
  }
}

function createNumberGuessGame() {
  const board = createGameLayout('Number Guess');
  let secret = Math.floor(Math.random() * 100) + 1;
  let attempts = 0;
  let score = 0;

  board.innerHTML = `
    <p>Guess a number from 1 to 100.</p>
    <div class="game-row">
      <input id="guessInput" type="number" min="1" max="100" placeholder="Enter your guess" />
      <button class="action-btn" id="checkGuess">Check</button>
    </div>
    <div id="guessOutput" class="score-box">Attempts: 0</div>
  `;

  const guessInput = document.getElementById('guessInput');
  const guessOutput = document.getElementById('guessOutput');
  const checkButton = document.getElementById('checkGuess');

  checkButton.addEventListener('click', () => {
    const value = Number(guessInput.value);
    if (!value || value < 1 || value > 100) {
      guessOutput.textContent = 'Enter a valid number between 1 and 100.';
      return;
    }
    attempts += 1;
    if (value === secret) {
      score += 10;
      updateScore(score);
      guessOutput.textContent = `Correct! You got it in ${attempts} tries.`;
      secret = Math.floor(Math.random() * 100) + 1;
      attempts = 0;
      guessInput.value = '';
    } else if (value < secret) {
      guessOutput.textContent = 'Too low. Try again!';
    } else {
      guessOutput.textContent = 'Too high. Try again!';
    }
  });
}

function createTicTacToeGame() {
  const board = createGameLayout('Tic Tac Toe');
  const cells = Array.from({ length: 9 }, () => '');
  let current = 'X';
  let score = 0;

  board.innerHTML = `
    <div id="ticTacToeBoard"></div>
  `;

  const ticBoard = document.getElementById('ticTacToeBoard');
  for (let i = 0; i < 9; i += 1) {
    const cell = document.createElement('button');
    cell.className = 'cell';
    cell.textContent = '';
    cell.addEventListener('click', () => {
      if (cell.textContent) return;
      cell.textContent = current;
      cells[i] = current;
      if (checkWinner(cells, current)) {
        score += 10;
        updateScore(score);
        alert(`${current} wins!`);
        resetBoard();
        return;
      }
      if (cells.every(Boolean)) {
        alert('Draw!');
        resetBoard();
        return;
      }
      current = current === 'X' ? 'O' : 'X';
    });
    ticBoard.appendChild(cell);
  }

  function resetBoard() {
    Array.from(ticBoard.children).forEach((node) => {
      node.textContent = '';
    });
    cells.fill('');
    current = 'X';
  }

  function checkWinner(values, player) {
    const wins = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8],
      [0, 3, 6], [1, 4, 7], [2, 5, 8],
      [0, 4, 8], [2, 4, 6],
    ];
    return wins.some((combo) => combo.every((index) => values[index] === player));
  }
}

function createRpsGame() {
  const board = createGameLayout('Rock Paper Scissors');
  let score = 0;
  board.innerHTML = `
    <div class="game-row">
      <button class="choice-btn" data-choice="rock">Rock</button>
      <button class="choice-btn" data-choice="paper">Paper</button>
      <button class="choice-btn" data-choice="scissors">Scissors</button>
    </div>
    <div id="rpsResult" class="score-box">Choose your move</div>
  `;

  board.querySelectorAll('.choice-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const choices = ['rock', 'paper', 'scissors'];
      const cpu = choices[Math.floor(Math.random() * choices.length)];
      const user = button.dataset.choice;
      const result = getRpsWinner(user, cpu);
      const resultBox = document.getElementById('rpsResult');
      if (result === 'win') {
        score += 10;
        updateScore(score);
        resultBox.textContent = `You won! ${user} beats ${cpu}.`;
      } else if (result === 'lose') {
        resultBox.textContent = `You lost! ${cpu} beats ${user}.`;
      } else {
        resultBox.textContent = `Draw! Both picked ${user}.`;
      }
    });
  });

  function getRpsWinner(player, cpu) {
    if (player === cpu) return 'draw';
    const wins = {
      rock: 'scissors',
      paper: 'rock',
      scissors: 'paper',
    };
    return wins[player] === cpu ? 'win' : 'lose';
  }
}

function createMemoryGame() {
  const board = createGameLayout('Memory Match');
  const icons = ['🍉', '🍇', '🍋', '🍒', '🍊', '🍏', '🍓', '🍍'];
  const cards = [...icons, ...icons].sort(() => Math.random() - 0.5);
  const revealed = [];
  let score = 0;

  board.innerHTML = `<div id="memoryBoard"></div>`;
  const memoryBoard = document.getElementById('memoryBoard');

  cards.forEach((icon) => {
    const tile = document.createElement('button');
    tile.className = 'memory-card';
    tile.textContent = '?';
    tile.dataset.icon = icon;
    tile.addEventListener('click', () => {
      if (tile.classList.contains('revealed') || revealed.includes(tile)) {
        return;
      }
      tile.textContent = icon;
      tile.classList.add('revealed');
      revealed.push(tile);
      if (revealed.length === 2) {
        if (revealed[0].dataset.icon === revealed[1].dataset.icon) {
          score += 10;
          updateScore(score);
          revealed.forEach((card) => {
            card.disabled = true;
          });
          revealed.length = 0;
        } else {
          setTimeout(() => {
            revealed.forEach((card) => {
              card.textContent = '?';
              card.classList.remove('revealed');
            });
            revealed.length = 0;
          }, 700);
        }
      }
    });
    memoryBoard.appendChild(tile);
  });
}

function createQuizGame() {
  const board = createGameLayout('Quiz');
  const questions = [
    { q: 'What does HTML stand for?', a: ['HyperText Markup Language', 'HighText Machine Logic', 'HyperTool Markup Language', 'HyperTransfer Method Language'], correct: 0 },
    { q: 'Which language runs in the browser?', a: ['Python', 'JavaScript', 'C++', 'SQL'], correct: 1 },
    { q: 'What is 9 × 9?', a: ['72', '81', '90', '88'], correct: 1 },
    { q: 'Which planet is known as the Red Planet?', a: ['Venus', 'Mars', 'Jupiter', 'Mercury'], correct: 1 },
    { q: 'Which is a CSS property for spacing?', a: ['margin', 'console.log', 'if', 'fetch'], correct: 0 },
  ];

  let score = 0;
  let questionIndex = 0;

  function renderQuestion() {
    const question = questions[questionIndex];
    board.innerHTML = `
      <div class="score-box">Question ${questionIndex + 1}/${questions.length}</div>
      <h4>${question.q}</h4>
      <div id="quizOptions"></div>
    `;
    const options = document.getElementById('quizOptions');
    question.a.forEach((option, index) => {
      const button = document.createElement('button');
      button.className = 'quiz-option';
      button.textContent = option;
      button.addEventListener('click', () => {
        if (index === question.correct) {
          score += 10;
          updateScore(score);
          button.style.borderColor = 'rgba(54, 211, 153, 0.7)';
        } else {
          button.style.borderColor = 'rgba(255, 124, 124, 0.7)';
        }
        setTimeout(() => {
          questionIndex += 1;
          if (questionIndex < questions.length) {
            renderQuestion();
          } else {
            board.innerHTML = `<div class="score-box">Quiz complete! Final score: ${score}</div>`;
          }
        }, 600);
      });
      options.appendChild(button);
    });
  }

  renderQuestion();
}

function createDiceGame() {
  const board = createGameLayout('Dice Clash');
  let score = 0;
  board.innerHTML = `
    <div class="game-row">
      <button class="action-btn" id="rollDiceBtn">Roll Dice</button>
    </div>
    <div id="diceResult" class="score-box">Your dice roll will appear here</div>
  `;

  document.getElementById('rollDiceBtn').addEventListener('click', () => {
    const player = Math.floor(Math.random() * 6) + 1;
    const cpu = Math.floor(Math.random() * 6) + 1;
    const result = document.getElementById('diceResult');
    if (player > cpu) {
      score += 10;
      updateScore(score);
      result.textContent = `You rolled ${player}, CPU rolled ${cpu}. You win!`;
    } else if (player < cpu) {
      result.textContent = `You rolled ${player}, CPU rolled ${cpu}. You lose!`;
    } else {
      result.textContent = `Draw! Both rolled ${player}.`;
    }
  });
}

function createTypingGame() {
  const board = createGameLayout('Typing Sprint');
  const phrase = 'code your future with focus and flair';
  let score = 0;

  board.innerHTML = `
    <p>${phrase}</p>
    <textarea id="typingInput" rows="3" placeholder="Type the sentence here..."></textarea>
    <button class="action-btn" id="submitTyping">Submit</button>
    <div id="typingResult" class="score-box">Ready to type</div>
  `;

  document.getElementById('submitTyping').addEventListener('click', () => {
    const input = document.getElementById('typingInput').value.trim();
    const result = document.getElementById('typingResult');
    if (input === phrase) {
      score += 10;
      updateScore(score);
      result.textContent = 'Perfect! Speed bonus earned.';
    } else {
      result.textContent = 'Nice try — match the phrase exactly.';
    }
  });
}

function createReactionGame() {
  const board = createGameLayout('Reaction Race');
  let score = 0;
  let started = false;
  let timeoutId = null;

  board.innerHTML = `
    <button class="action-btn" id="reactionBtn">Start</button>
    <div id="reactionResult" class="score-box">Wait for green then click.</div>
  `;

  const button = document.getElementById('reactionBtn');
  const result = document.getElementById('reactionResult');

  button.addEventListener('click', () => {
    if (!started) {
      started = true;
      button.textContent = 'Wait...';
      result.textContent = 'Wait for the signal...';
      timeoutId = setTimeout(() => {
        button.style.background = 'linear-gradient(135deg, #36d399, #20d4ff)';
        button.textContent = 'CLICK NOW!';
        result.textContent = 'Now!';
      }, 1500 + Math.random() * 2000);
      return;
    }

    if (button.textContent === 'CLICK NOW!') {
      clearTimeout(timeoutId);
      score += 10;
      updateScore(score);
      result.textContent = 'Excellent reaction!';
      button.textContent = 'Play again';
      button.style.background = '';
      started = false;
    }
  });
}

function createColorGame() {
  const board = createGameLayout('Color Guess');
  const colors = ['#7c5cff', '#20d4ff', '#ff5fcf', '#fbbf24', '#36d399'];
  const target = colors[Math.floor(Math.random() * colors.length)];
  let score = 0;

  board.innerHTML = `
    <div class="game-row">
      <div class="color-swatch" style="background:${target};"></div>
      <span>Pick the matching color</span>
    </div>
    <div class="game-row" id="colorChoices"></div>
    <div id="colorResult" class="score-box">Choose the correct color</div>
  `;

  const choices = document.getElementById('colorChoices');
  [...colors].forEach((color) => {
    const btn = document.createElement('button');
    btn.className = 'number-btn';
    btn.style.background = color;
    btn.style.width = '60px';
    btn.style.height = '60px';
    btn.addEventListener('click', () => {
      const result = document.getElementById('colorResult');
      if (color === target) {
        score += 10;
        updateScore(score);
        result.textContent = 'Correct! Great eye.';
      } else {
        result.textContent = 'Not quite — try again.';
      }
    });
    choices.appendChild(btn);
  });
}

function createLuckySpinGame() {
  const board = createGameLayout('Lucky Spin');
  let score = 0;

  board.innerHTML = `
    <div class="game-row">
      <button class="action-btn" id="spinBtn">Spin</button>
    </div>
    <div id="spinResult" class="score-box">Tap spin for a lucky prize</div>
  `;

  const spinBtn = document.getElementById('spinBtn');
  spinBtn.addEventListener('click', () => {
    const rewards = ['🎯 Bonus', '💎 Gold', '🚀 Boost', '🎁 Surprise', '⭐ Star'];
    const reward = rewards[Math.floor(Math.random() * rewards.length)];
    score += 10;
    updateScore(score);
    document.getElementById('spinResult').textContent = `Lucky spin: ${reward}`;
  });
}

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !gameModal.classList.contains('hidden')) {
    gameModal.classList.add('hidden');
    gameContainer.innerHTML = '';
  }
});
