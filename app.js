const dom = {
  teamCount: document.getElementById('teamCount'),
  roundCount: document.getElementById('roundCount'),
  generateBtn: document.getElementById('generateBtn'),
  bracket: document.getElementById('bracket'),
  generationMeta: document.getElementById('generationMeta'),
  ranking: document.getElementById('ranking')
};

const state = {
  teams: [],
  rounds: 3,
  firstRoundPairs: [],
  matchInputs: {},
  generatedAt: null
};

function shuffleArray(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

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
  state.firstRoundPairs = initializeFirstRoundPairs(shuffleArray(state.teams.map((team) => team.id)));
  state.matchInputs = {};
  state.generatedAt = new Date();
  recalculateAndRender();
}

function createStatsMap() {
  return Object.fromEntries(state.teams.map((team) => [team.id, {
    id: team.id,
    name: team.name,
    scoreWins: 0,
    scoreLosses: 0,
    matchWins: 0,
    matchLosses: 0,
    matchDraws: 0,
    matchPoints: 0,
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
      // 对手分：累加“所有曾对阵过的对手”的总得分差（总得分 - 总失分）
      // 例如对手两轮比分分别为 2:1、2:0，则对手得分差为 (2+2)-(1+0)=3
      const oppDiff = (Number(opponent?.scoreWins) || 0) - (Number(opponent?.scoreLosses) || 0);
      return sum + oppDiff;
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

function pairByScoreGroups(statsMap, matchesPlayed) {
  // 按胜场数分组（胜者打胜者、负者打负者），胜场相同再按：对手分 > 评价分
  // matchesPlayed: 进入本轮前已打的局数（第2轮=1，第3轮=2...）
  const maxWins = Math.max(0, Number(matchesPlayed) || 0);

  const groups = Array.from({ length: maxWins + 1 }, () => []);
  Object.values(statsMap).forEach((team) => {
    const wins = Math.max(0, Math.min(maxWins, Number(team.matchWins) || 0));
    // groups[0] is highest wins (maxWins), groups[last] is 0 wins
    const groupIndex = maxWins - wins;
    groups[groupIndex].push(team.id);
  });

  const sortWithinGroup = (ids) => ids.sort((a, b) => {
    const A = statsMap[a];
    const B = statsMap[b];
    const scoreDiffA = (Number(A.scoreWins) || 0) - (Number(A.scoreLosses) || 0);
    const scoreDiffB = (Number(B.scoreWins) || 0) - (Number(B.scoreLosses) || 0);
    if (scoreDiffB !== scoreDiffA) return scoreDiffB - scoreDiffA;
    if ((B.opponentPoints || 0) !== (A.opponentPoints || 0)) return (B.opponentPoints || 0) - (A.opponentPoints || 0);
    if ((B.evalPoints || 0) !== (A.evalPoints || 0)) return (B.evalPoints || 0) - (A.evalPoints || 0);
    return (A.name || a).localeCompare(B.name || b, 'zh-CN');
  });

  groups.forEach(sortWithinGroup);

  // 若某胜场组为奇数，则从该组末尾（较低排序）浮动到下一组（更低胜场）
  for (let i = 0; i < groups.length - 1; i += 1) {
    if (groups[i].length % 2 === 1) {
      const moved = groups[i].pop();
      if (moved) groups[i + 1].unshift(moved);
      sortWithinGroup(groups[i + 1]);
    }
  }

  // 返回每个组：wins + pairs（即便为空组也返回，便于显示“第2轮0-1”这种标题）
  return groups.map((grp, idx) => {
    const wins = maxWins - idx;
    const pairs = [];
    for (let i = 0; i < grp.length; i += 2) {
      if (grp[i + 1]) pairs.push([grp[i], grp[i + 1]]);
    }
    return { wins, pairs };
  });
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

  // 默认值全 0 代表“未填写/未进行”，不计入胜负与对手分
  const isUnplayed =
    (Number(input.leftScore) || 0) === 0 &&
    (Number(input.rightScore) || 0) === 0 &&
    (Number(input.leftEval) || 0) === 0 &&
    (Number(input.rightEval) || 0) === 0;
  if (isUnplayed) return;

  left.scoreWins += input.leftScore;
  left.scoreLosses += input.rightScore;
  right.scoreWins += input.rightScore;
  right.scoreLosses += input.leftScore;

  left.evalPoints += input.leftEval;
  right.evalPoints += input.rightEval;

  left.opponents.push(right.id);
  right.opponents.push(left.id);

  // 按本场比分判断胜负：胜者 +1，负者 +0，平局双方 +0.5
  if (input.leftScore > input.rightScore) {
    left.matchWins += 1;
    right.matchLosses += 1;
    left.matchPoints += 1;
  } else if (input.leftScore < input.rightScore) {
    right.matchWins += 1;
    left.matchLosses += 1;
    right.matchPoints += 1;
  } else {
    left.matchDraws += 1;
    right.matchDraws += 1;
    left.matchPoints += 0.5;
    right.matchPoints += 0.5;
  }
}

function buildRounds() {
  const statsMap = createStatsMap();
  const rounds = [];
  const firstRoundPairs = sanitizeFirstRoundPairs();

  for (let roundIndex = 0; roundIndex < state.rounds; roundIndex += 1) {
    if (roundIndex === 0) {
      const matches = firstRoundPairs.map(([leftId, rightId], matchIndex) => {
        const input = readMatchInput(roundIndex, matchIndex);
        applyMatchResult(statsMap, leftId, rightId, input);
        return { leftId, rightId, ...input };
      });
      recomputeOpponentPoints(statsMap);
      rounds.push({ index: roundIndex + 1, rows: [{ wins: 0, matches }] });
    } else {
      const targetRows = roundIndex + 0;
      const rowsPairs = pairByScoreGroups(statsMap, roundIndex);
      const rows = [];
      let matchCounter = 0;
      rowsPairs.forEach((rowObj) => {
        const matches = rowObj.pairs.map(([leftId, rightId]) => {
          const input = readMatchInput(roundIndex, matchCounter);
          matchCounter += 1;
          applyMatchResult(statsMap, leftId, rightId, input);
          return { leftId, rightId, ...input };
        });
        rows.push({ wins: rowObj.wins, matches });
      });

      recomputeOpponentPoints(statsMap);
      rounds.push({ index: roundIndex + 1, rows });
    }
  }

  state.firstRoundPairs = firstRoundPairs;
  state.latestStatsMap = statsMap;
  return rounds;
}

function renderRankingTable(statsMap) {
  if (!dom.ranking) return;

  const teams = Object.values(statsMap || {});
  const ranked = teams
    .map((t) => {
      const scoreDiff = (Number(t.scoreWins) || 0) - (Number(t.scoreLosses) || 0);
      return {
        id: t.id,
        name: t.name || t.id,
        scoreWins: Number(t.scoreWins) || 0,
        scoreLosses: Number(t.scoreLosses) || 0,
        scoreDiff,
        opponentPoints: Number(t.opponentPoints) || 0,
        evalPoints: Number(t.evalPoints) || 0,
        matchWins: Number(t.matchWins) || 0
      };
    })
    .sort((a, b) => {
      if (b.matchWins !== a.matchWins) return b.matchWins - a.matchWins;
      if (b.scoreDiff !== a.scoreDiff) return b.scoreDiff - a.scoreDiff;
      if (b.opponentPoints !== a.opponentPoints) return b.opponentPoints - a.opponentPoints;
      if (b.evalPoints !== a.evalPoints) return b.evalPoints - a.evalPoints;
      return a.name.localeCompare(b.name, 'zh-CN');
    });

  const table = document.createElement('table');
  table.className = 'ranking-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th style="width: 56px;">排名</th>
        <th>队伍</th>
        <th style="width: 90px;">比分</th>
        <th style="width: 90px;">对手分</th>
        <th style="width: 90px;">评价分</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tbody = table.querySelector('tbody');
  ranked.forEach((row, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td>${row.name}</td>
      <td>${row.scoreWins}-${row.scoreLosses}</td>
      <td>${row.opponentPoints}</td>
      <td>${row.evalPoints}</td>
    `;
    tbody.appendChild(tr);
  });

  dom.ranking.innerHTML = '';
  dom.ranking.appendChild(table);
}

function updateFirstRoundTeam(matchIndex, side, teamId) {
  const current = state.firstRoundPairs[matchIndex];
  if (!current) return;
  const next = [...current];
  next[side] = teamId;
  state.firstRoundPairs[matchIndex] = next;
  recalculateAndRender();
}

function updateTeamName(teamId, value) {
  const team = state.teams.find((item) => item.id === teamId);
  if (!team) return;

  const nextName = String(value).trim();
  team.name = nextName || team.name;
  recalculateAndRender();
}

function updateMatchInput(key, field, value) {
  const current = state.matchInputs[key] || {
    leftScore: 0,
    rightScore: 0,
    leftEval: 0,
    rightEval: 0
  };
  const numericValue = Number(value);
  const safeValue = Number.isFinite(numericValue) ? numericValue : 0;
  const nextValue = field === 'leftScore' || field === 'rightScore'
    ? Math.max(0, safeValue)
    : safeValue;

  const nextInput = {
    ...current,
    [field]: nextValue
  };

  if (field === 'leftEval') {
    nextInput.rightEval = -nextValue;
  } else if (field === 'rightEval') {
    nextInput.leftEval = -nextValue;
  }

  state.matchInputs[key] = {
    ...nextInput
  };
  recalculateAndRender();
}

function createFirstRoundTeamNameInput(teamId) {
  const team = state.teams.find((item) => item.id === teamId);
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = '24';
  input.value = team?.name || teamId;
  input.placeholder = '输入队伍名称';
  input.addEventListener('change', () => {
    updateTeamName(teamId, input.value);
  });
  return input;
}

function createValueInput(value, onChange, options = {}) {
  const input = document.createElement('input');
  input.type = 'number';
  if (options.min !== undefined) input.min = String(options.min);
  if (options.step !== undefined) input.step = String(options.step);
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
    if (roundIndex > 0) column.classList.add('round-col--linked');

    // Column-level title is removed; each group shows its own round label.

    // rounds.rows is an array of stacks (rows). Each stack is an array of matches.
    const stacks = document.createElement('div');
    stacks.className = 'round-stacks';
    (round.rows || []).forEach((stackObj, stackIndex) => {
      const stack = document.createElement('div');
      stack.className = 'match-stack';

      // group header showing round-style label: 第{轮次}轮{胜-负}
      const groupHeader = document.createElement('div');
      groupHeader.className = 'group-header';
      const wins = Number(stackObj.wins || 0);
      const matchesPlayed = Math.max(0, Number(round.index) - 1);
      const losses = Math.max(0, matchesPlayed - wins);
      const fmt = (v) => (Number.isInteger(v) ? String(v) : String(v));
      groupHeader.textContent = `第${round.index}轮 ${fmt(wins)}-${fmt(losses)}`;
      stack.appendChild(groupHeader);

      stackObj.matches.forEach((match, matchIndex) => {
        const card = document.createElement('article');
        card.className = 'match';

        const cols = document.createElement('div');
        cols.className = 'match-cols';
        cols.innerHTML = '<div>队伍</div><div>比分</div><div>评价</div>';
        card.appendChild(cols);

        const leftScoreNum = Number(match.leftScore) || 0;
        const rightScoreNum = Number(match.rightScore) || 0;
        const isPlayed = !(leftScoreNum === 0 && rightScoreNum === 0 && (Number(match.leftEval) || 0) === 0 && (Number(match.rightEval) || 0) === 0);
        const isDraw = isPlayed && leftScoreNum === rightScoreNum;
        const leftWin = isPlayed && !isDraw && leftScoreNum > rightScoreNum;
        const rightWin = isPlayed && !isDraw && rightScoreNum > leftScoreNum;

        [['left', match.leftId], ['right', match.rightId]].forEach(([side, teamId]) => {
          const row = document.createElement('div');
          row.className = 'team-row';

          if (isPlayed) {
            if (isDraw) row.classList.add('team-row--draw');
            if (side === 'left' && leftWin) row.classList.add('team-row--win');
            if (side === 'left' && rightWin) row.classList.add('team-row--lose');
            if (side === 'right' && rightWin) row.classList.add('team-row--win');
            if (side === 'right' && leftWin) row.classList.add('team-row--lose');
          }

          const teamField = roundIndex === 0
            ? createFirstRoundTeamNameInput(teamId)
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
          }, { min: 0, step: 1 });
          const evalInput = createValueInput(match[evalField], () => {
            updateMatchInput(match.key, evalField, evalInput.value);
          }, { step: 'any' });

          scoreInput.title = '比分';
          evalInput.title = '评价分';

          row.appendChild(scoreInput);
          row.appendChild(evalInput);
          card.appendChild(row);
        });

        stack.appendChild(card);
      });

      stacks.appendChild(stack);
    });

    column.appendChild(stacks);

    dom.bracket.appendChild(column);
  });
}

function recalculateAndRender() {
  const rounds = buildRounds();
  renderRounds(rounds);
  renderRankingTable(state.latestStatsMap);
  if (dom.generationMeta) {
    const generatedAtText = state.generatedAt
      ? state.generatedAt.toLocaleString('zh-CN', { hour12: false })
      : '未记录';
    dom.generationMeta.textContent = `已生成 ${state.teams.length} 支队伍，${state.rounds} 轮，更新时间 ${generatedAtText}`;
  }
}

dom.generateBtn.addEventListener('click', initializeTournament);
initializeTournament();
