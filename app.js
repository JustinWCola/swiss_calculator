const dom = {
  teamCount: document.getElementById('teamCount'),
  roundCount: document.getElementById('roundCount'),
  generateBtn: document.getElementById('generateBtn'),
  bracket: document.getElementById('bracket')
};

const state = {
  teams: [],
  rounds: 3,
  firstRoundPairs: [],
  matchInputs: {}
};

function sanitizeConfig() {
  let teamCount = Number(dom.teamCount.value) || 8;
  if (teamCount % 2 === 1) teamCount += 1;
  teamCount = Math.min(64, Math.max(2, teamCount));
  dom.teamCount.value = String(teamCount);

  const roundCount = Math.min(9, Math.max(1, Number(dom.roundCount.value) || 3));
  dom.roundCount.value = String(roundCount);

  return { teamCount, roundCount };
}

function createTeams(teamCount) {
  return Array.from({ length: teamCount }, (_, index) => ({
    id: `T${index + 1}`,
    name: `队伍${index + 1}`
  }));
}

function initializeFirstRoundPairs(teamIds) {
  const pairs = [];
  for (let i = 0; i < teamIds.length; i += 2) {
    pairs.push([teamIds[i], teamIds[i + 1]]);
  }
  return pairs;
}

function initializeTournament() {
  const { teamCount, roundCount } = sanitizeConfig();
  state.teams = createTeams(teamCount);
  state.rounds = roundCount;
  state.firstRoundPairs = initializeFirstRoundPairs(state.teams.map((team) => team.id));
  state.matchInputs = {};
  recalculateAndRender();
}

function createStatsMap() {
  return Object.fromEntries(state.teams.map((team) => [team.id, {
    id: team.id,
    name: team.name,
    scoreWins: 0,
    scoreLosses: 0,
    evalPoints: 0,
    opponentPoints: 0,
    opponents: []
  }]));
}

function sanitizeFirstRoundPairs() {
  const allIds = state.teams.map((team) => team.id);
  const used = new Set();
  const cleaned = [];

  state.firstRoundPairs.forEach((pair) => {
    const left = allIds.includes(pair[0]) && !used.has(pair[0]) ? pair[0] : null;
    const right = allIds.includes(pair[1]) && !used.has(pair[1]) && pair[1] !== left ? pair[1] : null;

    if (left) used.add(left);
    if (right) used.add(right);
    cleaned.push([left, right]);
  });

  const remain = allIds.filter((id) => !used.has(id));
  cleaned.forEach((pair) => {
    if (!pair[0]) pair[0] = remain.shift();
    if (!pair[1]) pair[1] = remain.shift();
  });

  return cleaned;
}

function recomputeOpponentPoints(statsMap) {
  Object.values(statsMap).forEach((team) => {
    team.opponentPoints = team.opponents.reduce((sum, opponentId) => {
      const opponent = statsMap[opponentId];
      return sum + ((opponent?.scoreWins || 0) - (opponent?.scoreLosses || 0));
    }, 0);
  });
}

function rankingBySwiss(statsMap) {
  return [...state.teams]
    .map((team) => statsMap[team.id])
    .sort((a, b) => {
      if (b.opponentPoints !== a.opponentPoints) return b.opponentPoints - a.opponentPoints;
      if (b.evalPoints !== a.evalPoints) return b.evalPoints - a.evalPoints;
      return a.name.localeCompare(b.name, 'zh-CN');
    });
}

function pairByRanking(statsMap) {
  const sorted = rankingBySwiss(statsMap);
  const pairs = [];
  for (let i = 0; i < sorted.length; i += 2) {
    if (sorted[i + 1]) pairs.push([sorted[i].id, sorted[i + 1].id]);
  }
  return pairs;
}

function readMatchInput(roundIndex, matchIndex) {
  const key = `r${roundIndex}-m${matchIndex}`;
  const existing = state.matchInputs[key];
  if (existing) return { ...existing, key };
  return {
    key,
    leftScore: 0,
    rightScore: 0,
    leftEval: 0,
    rightEval: 0
  };
}

function applyMatchResult(statsMap, leftId, rightId, input) {
  const left = statsMap[leftId];
  const right = statsMap[rightId];
  if (!left || !right) return;

  left.scoreWins += input.leftScore;
  left.scoreLosses += input.rightScore;
  right.scoreWins += input.rightScore;
  right.scoreLosses += input.leftScore;

  left.evalPoints += input.leftEval;
  right.evalPoints += input.rightEval;

  left.opponents.push(right.id);
  right.opponents.push(left.id);
}

function buildRounds() {
  const statsMap = createStatsMap();
  const rounds = [];
  const firstRoundPairs = sanitizeFirstRoundPairs();

  for (let roundIndex = 0; roundIndex < state.rounds; roundIndex += 1) {
    const pairs = roundIndex === 0 ? firstRoundPairs : pairByRanking(statsMap);

    const matches = pairs.map(([leftId, rightId], matchIndex) => {
      const input = readMatchInput(roundIndex, matchIndex);
      applyMatchResult(statsMap, leftId, rightId, input);
      return { leftId, rightId, ...input };
    });

    recomputeOpponentPoints(statsMap);

    rounds.push({
      index: roundIndex + 1,
      matches
    });
  }

  state.firstRoundPairs = firstRoundPairs;
  return rounds;
}

function updateFirstRoundTeam(matchIndex, side, teamId) {
  const current = state.firstRoundPairs[matchIndex];
  if (!current) return;
  const next = [...current];
  next[side] = teamId;
  state.firstRoundPairs[matchIndex] = next;
  recalculateAndRender();
}

function updateMatchInput(key, field, value) {
  const current = state.matchInputs[key] || {
    leftScore: 0,
    rightScore: 0,
    leftEval: 0,
    rightEval: 0
  };
  state.matchInputs[key] = {
    ...current,
    [field]: Math.max(0, Number(value) || 0)
  };
  recalculateAndRender();
}

function createTeamInput(roundIndex, matchIndex, side, selectedId) {
  const select = document.createElement('select');
  state.teams.forEach((team) => {
    const option = document.createElement('option');
    option.value = team.id;
    option.textContent = team.name;
    if (team.id === selectedId) option.selected = true;
    select.appendChild(option);
  });
  select.addEventListener('change', () => {
    updateFirstRoundTeam(matchIndex, side, select.value);
  });
  return select;
}

function createValueInput(value, onChange) {
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.step = '1';
  input.value = String(value);
  input.addEventListener('change', onChange);
  return input;
}

function renderRounds(rounds) {
  dom.bracket.innerHTML = '';
  const nameMap = Object.fromEntries(state.teams.map((team) => [team.id, team.name]));

  rounds.forEach((round, roundIndex) => {
    const column = document.createElement('section');
    column.className = 'round-col';

    const title = document.createElement('h3');
    title.textContent = `第 ${round.index} 轮`;
    column.appendChild(title);

    const hint = document.createElement('div');
    hint.className = 'round-hint';
    hint.textContent = roundIndex === 0
      ? '在本列直接设置首轮对阵，再填写比分与评价分'
      : '本轮对阵按上一轮后“对手分＞评价分”排序自动生成';
    column.appendChild(hint);

    round.matches.forEach((match, matchIndex) => {
      const card = document.createElement('article');
      card.className = 'match';

      const head = document.createElement('div');
      head.className = 'match-head';
      head.textContent = `对局 ${matchIndex + 1}（名称 / 比分 / 评价分）`;
      card.appendChild(head);

      [['left', match.leftId], ['right', match.rightId]].forEach(([side, teamId]) => {
        const row = document.createElement('div');
        row.className = 'team-row';

        const teamField = roundIndex === 0
          ? createTeamInput(roundIndex, matchIndex, side === 'left' ? 0 : 1, teamId)
          : (() => {
              const label = document.createElement('div');
              label.className = 'team-label';
              label.textContent = nameMap[teamId] || teamId;
              return label;
            })();
        row.appendChild(teamField);

        const scoreField = side === 'left' ? 'leftScore' : 'rightScore';
        const evalField = side === 'left' ? 'leftEval' : 'rightEval';
        const scoreInput = createValueInput(match[scoreField], () => {
          updateMatchInput(match.key, scoreField, scoreInput.value);
        });
        const evalInput = createValueInput(match[evalField], () => {
          updateMatchInput(match.key, evalField, evalInput.value);
        });

        row.appendChild(scoreInput);
        row.appendChild(evalInput);
        card.appendChild(row);
      });

      column.appendChild(card);
    });

    dom.bracket.appendChild(column);
  });
}

function recalculateAndRender() {
  const rounds = buildRounds();
  renderRounds(rounds);
}

dom.generateBtn.addEventListener('click', initializeTournament);
initializeTournament();
