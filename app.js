const dom = {
  teamCount: document.getElementById('teamCount'),
  format: document.getElementById('format'),
  roundCount: document.getElementById('roundCount'),
  qualifiedCount: document.getElementById('qualifiedCount'),
  teamNames: document.getElementById('teamNames'),
  generateBtn: document.getElementById('generateBtn'),
  seedList: document.getElementById('seedList'),
  bracket: document.getElementById('bracket'),
  standings: document.getElementById('standings')
};

const state = {
  teams: [],
  rounds: 3,
  qualified: 4,
  format: 'bo1',
  firstRoundOrder: [],
  firstRoundWinRates: {}
};

const defaultWinRate = () => {
  if (state.format === 'bo3') return 60;
  if (state.format === 'bo5') return 65;
  return 55;
};

function sanitizeConfig() {
  let teamCount = Number(dom.teamCount.value) || 8;
  if (teamCount % 2 === 1) teamCount += 1;
  teamCount = Math.min(64, Math.max(2, teamCount));
  dom.teamCount.value = String(teamCount);

  const roundCount = Math.min(9, Math.max(1, Number(dom.roundCount.value) || 3));
  dom.roundCount.value = String(roundCount);

  let qualified = Math.min(teamCount, Math.max(1, Number(dom.qualifiedCount.value) || 4));
  dom.qualifiedCount.value = String(qualified);

  return { teamCount, roundCount, qualified };
}

function readTeams(teamCount) {
  const customNames = dom.teamNames.value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const teams = Array.from({ length: teamCount }, (_, index) => ({
    id: `T${index + 1}`,
    name: customNames[index] || `队伍${index + 1}`,
    wins: 0,
    losses: 0,
    opponentPoints: 0,
    opponents: []
  }));

  return teams;
}

function initializeTournament() {
  const { teamCount, roundCount, qualified } = sanitizeConfig();
  state.teams = readTeams(teamCount);
  state.rounds = roundCount;
  state.qualified = qualified;
  state.format = dom.format.value;
  state.firstRoundOrder = state.teams.map((team) => team.id);
  state.firstRoundWinRates = {};
  renderSeedList();
  recalculateAndRender();
}

function renderSeedList() {
  dom.seedList.innerHTML = '';
  state.firstRoundOrder.forEach((id) => {
    const team = state.teams.find((item) => item.id === id);
    const li = document.createElement('li');
    li.className = 'seed-item';
    li.textContent = team?.name || id;
    li.draggable = true;
    li.dataset.teamId = id;

    li.addEventListener('dragstart', () => li.classList.add('dragging'));
    li.addEventListener('dragend', () => li.classList.remove('dragging'));

    dom.seedList.appendChild(li);
  });
}

function bindSeedDragDrop() {
  dom.seedList.addEventListener('dragover', (event) => {
    event.preventDefault();
    const dragging = dom.seedList.querySelector('.dragging');
    if (!dragging) return;

    const siblings = [...dom.seedList.querySelectorAll('.seed-item:not(.dragging)')];
    const nextSibling = siblings.find((sibling) => event.clientX <= sibling.offsetLeft + sibling.offsetWidth / 2);
    dom.seedList.insertBefore(dragging, nextSibling || null);
  });

  dom.seedList.addEventListener('drop', () => {
    state.firstRoundOrder = [...dom.seedList.querySelectorAll('.seed-item')].map((item) => item.dataset.teamId);
    recalculateAndRender();
  });
}

function cloneTeams() {
  return state.teams.map((team) => ({ ...team, opponents: [...team.opponents] }));
}

function getTeamMap(teams) {
  return Object.fromEntries(teams.map((team) => [team.id, team]));
}

function pairRound(teamIds) {
  const matches = [];
  for (let i = 0; i < teamIds.length; i += 2) {
    if (teamIds[i + 1]) matches.push([teamIds[i], teamIds[i + 1]]);
  }
  return matches;
}

function sortForSwiss(teamList) {
  return [...teamList].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.opponentPoints !== a.opponentPoints) return b.opponentPoints - a.opponentPoints;
    return a.name.localeCompare(b.name, 'zh-CN');
  });
}

function chooseSwissPairs(teamList) {
  const sorted = sortForSwiss(teamList);
  const used = new Set();
  const pairs = [];

  for (let i = 0; i < sorted.length; i += 1) {
    const teamA = sorted[i];
    if (used.has(teamA.id)) continue;

    let candidate = null;
    for (let j = i + 1; j < sorted.length; j += 1) {
      const teamB = sorted[j];
      if (used.has(teamB.id)) continue;
      if (!teamA.opponents.includes(teamB.id)) {
        candidate = teamB;
        break;
      }
      if (!candidate) candidate = teamB;
    }

    if (candidate) {
      used.add(teamA.id);
      used.add(candidate.id);
      pairs.push([teamA.id, candidate.id]);
    }
  }

  return pairs;
}

function updateResult(teamMap, leftId, rightId, leftWinRate) {
  const left = teamMap[leftId];
  const right = teamMap[rightId];
  const leftWins = leftWinRate >= 50;

  left.opponents.push(right.id);
  right.opponents.push(left.id);

  if (leftWins) {
    left.wins += 1;
    right.losses += 1;
  } else {
    right.wins += 1;
    left.losses += 1;
  }
}

function recomputeOpponentPoints(teams, teamMap) {
  teams.forEach((team) => {
    team.opponentPoints = team.opponents.reduce((sum, opponentId) => {
      const opponent = teamMap[opponentId];
      return sum + (opponent?.wins || 0);
    }, 0);
  });
}

function pairingConfidence(teamA, teamB, pool) {
  const distance = Math.abs(teamA.opponentPoints - teamB.opponentPoints) + Math.abs(teamA.wins - teamB.wins) * 2;
  const weight = 1 / (1 + distance);
  const baseline = pool.reduce((sum, candidate) => {
    const d = Math.abs(teamA.opponentPoints - candidate.opponentPoints) + Math.abs(teamA.wins - candidate.wins) * 2;
    return sum + 1 / (1 + d);
  }, 0);
  return Math.round((weight / (baseline || 1)) * 100);
}

function buildRounds() {
  const teams = cloneTeams();
  const teamMap = getTeamMap(teams);
  const rounds = [];

  for (let roundIndex = 0; roundIndex < state.rounds; roundIndex += 1) {
    const pairs = roundIndex === 0
      ? pairRound(state.firstRoundOrder)
      : chooseSwissPairs(teams);

    const roundMatches = pairs.map(([leftId, rightId], matchIndex) => {
      const key = `r${roundIndex}-m${matchIndex}-${leftId}-${rightId}`;
      const winRate = state.firstRoundWinRates[key] ?? defaultWinRate();
      updateResult(teamMap, leftId, rightId, winRate);
      return { leftId, rightId, key, winRate };
    });

    recomputeOpponentPoints(teams, teamMap);

    rounds.push({
      index: roundIndex + 1,
      matches: roundMatches,
      standings: sortForSwiss(teams).map((t) => ({ ...t, opponents: [...t.opponents] }))
    });
  }

  return { rounds, finalStandings: sortForSwiss(teams) };
}

function renderRounds(rounds) {
  dom.bracket.innerHTML = '';
  const nameMap = Object.fromEntries(state.teams.map((team) => [team.id, team.name]));

  rounds.forEach((round, roundIndex) => {
    const standingMap = Object.fromEntries(round.standings.map((team) => [team.id, team]));
    const column = document.createElement('div');
    column.className = 'round-col';
    const title = document.createElement('h3');
    title.textContent = `第 ${round.index} 轮`;
    column.appendChild(title);

    round.matches.forEach((match) => {
      const leftName = nameMap[match.leftId];
      const rightName = nameMap[match.rightId];
      const card = document.createElement('article');
      card.className = 'match';

      const teams = document.createElement('div');
      teams.className = 'teams';
      teams.innerHTML = `<span>${leftName}</span><span>vs</span><span>${rightName}</span>`;
      card.appendChild(teams);

      const score = document.createElement('label');
      score.textContent = `${leftName} 胜率：${match.winRate}%`;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = '100';
      input.value = String(match.winRate);

      input.addEventListener('input', () => {
        score.firstChild.textContent = `${leftName} 胜率：${input.value}%`;
      });

      input.addEventListener('change', () => {
        state.firstRoundWinRates[match.key] = Number(input.value);
        recalculateAndRender();
      });

      score.appendChild(input);
      card.appendChild(score);

      if (roundIndex > 0) {
        const left = standingMap[match.leftId];
        const right = standingMap[match.rightId];
        const pool = round.standings.filter((team) => team.id !== left.id && team.id !== right.id);
        const confidence = pairingConfidence(left, right, pool.concat([right]));
        const probability = document.createElement('div');
        probability.className = 'probability';
        probability.textContent = `对阵概率（基于战绩+对手分）：${confidence}%`;
        card.appendChild(probability);
      }

      column.appendChild(card);
    });

    dom.bracket.appendChild(column);
  });
}

function renderStandings(finalStandings) {
  const tableRows = finalStandings.map((team, index) => `
    <tr class="${index < state.qualified ? 'qualify' : ''}">
      <td>${index + 1}</td>
      <td>${team.name}</td>
      <td>${team.wins}</td>
      <td>${team.losses}</td>
      <td>${team.opponentPoints}</td>
      <td>${index < state.qualified ? '出线' : '-'}</td>
    </tr>
  `).join('');

  dom.standings.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>排名</th>
          <th>队伍</th>
          <th>胜</th>
          <th>负</th>
          <th>对手分</th>
          <th>状态</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>
  `;
}

function recalculateAndRender() {
  const { rounds, finalStandings } = buildRounds();
  renderRounds(rounds);
  renderStandings(finalStandings);
}

dom.generateBtn.addEventListener('click', initializeTournament);
bindSeedDragDrop();
initializeTournament();
