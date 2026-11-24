const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadGame(fillRect = () => {}) {
    const inputHandlers = {};
    const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    const element = { classList: { add() {}, remove() {} } };
    const canvas = { getContext: () => ({ fillRect, strokeRect() {} }) };
    const context = vm.createContext({
        window: { innerWidth: 800, innerHeight: 600, addEventListener() {} },
        document: {
            getElementById: id => id === 'gameCanvas' ? canvas : element,
            addEventListener(type, handler) { inputHandlers[type] = handler; },
        },
        requestAnimationFrame() {},
    });
    vm.runInContext(script, context);
    const run = code => vm.runInContext(code, context);
    run.key = (type, event) => {
        let prevented = false;
        inputHandlers[type]({ ...event, preventDefault() { prevented = true; } });
        return prevented;
    };
    return run;
}

test('browser shortcuts do not move players or consume the shortcut', () => {
    const run = loadGame();
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
        assert.equal(run.key('keydown', { key: 'w', [modifier]: true }), false);
        assert.equal(run('keys.w'), false);
    }
    assert.equal(run.key('keydown', { key: 'W', shiftKey: true }), true);
    assert.equal(run('keys.w'), true);
    run.key('keyup', { key: 'w', ctrlKey: true });
    assert.equal(run('keys.w'), false);
});

test('a held space key leaves the result visible until a fresh press', () => {
    const run = loadGame();
    run('gameOver = true; winner = "BLUE";');
    run.key('keydown', { key: ' ', repeat: true });
    assert.equal(run('gameOver'), true);
    assert.equal(run('winner'), 'BLUE');
    run.key('keyup', { key: ' ' });
    run.key('keydown', { key: ' ', repeat: false });
    assert.equal(run('gameOver'), false);
    assert.equal(run('winner'), null);
});

test('maze walls flash every three seconds and restart with the walls hidden', () => {
    const run = loadGame();
    assert.equal(run('updateFlash(2.95); wallsVisible'), false);
    assert.equal(run('updateFlash(0.10); wallsVisible'), true);
    assert.equal(run('updateFlash(0.36); wallsVisible'), false);
    assert.equal(run('updateFlash(2.60); wallsVisible'), true);
    assert.equal(run('restartGame(); updateFlash(0.15); wallsVisible'), false);
});

test('the renderer only draws wall tiles during a flash', () => {
    const fills = [];
    const run = loadGame(function () { fills.push(this.fillStyle); });
    run(`
        maze = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(0));
        maze[0][0] = 1;
        render();
    `);
    assert.equal(fills.filter(color => color === '#000000').length, 1, 'only the background is painted black');
    assert.equal(fills.includes('#FFFFFF'), false);

    fills.length = 0;
    run('wallsVisible = true; render();');
    assert.equal(fills.filter(color => color === '#FFFFFF').length, 1, 'the wall is drawn during the flash');
});

for (const [player, left, right, up, down] of [
    [0, 'a', 'd', 'w', 's'],
    [1, 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'],
]) {
    test(`opposing keys cancel movement for player ${player + 1}`, () => {
        const run = loadGame();
        assert.equal(run(`
            CELL_SIZE = 20; OFFSET_X = 0; OFFSET_Y = 0;
            maze = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(0));
            players = [{ x: 50, y: 50, size: 14 }, { x: 100, y: 100, size: 14 }];
            const before = { ...players[${player}] };
            keys.${left} = keys.${right} = keys.${up} = keys.${down} = true;
            updatePlayers(0.05);
            players[${player}].x === before.x && players[${player}].y === before.y;
        `), true);
    });
}

for (const [axis, direction] of [['x', 1], ['x', -1], ['y', 1], ['y', -1]]) {
    test(`movement cannot skip a wall along ${axis} in direction ${direction}`, () => {
        const run = loadGame();
        run(`
            CELL_SIZE = 6; OFFSET_X = 0; OFFSET_Y = 0;
            maze = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(0));
            const p = { x: 18.9, y: 18.9, size: 4.2 };
            players = [p, { x: 90, y: 90, size: 4.2 }];
        `);
        const wall = direction > 0 ? 4 : 2;
        run(axis === 'x'
            ? `for (const row of maze) row[${wall}] = 1;`
            : `maze[${wall}].fill(1);`);
        const key = axis === 'x' ? (direction > 0 ? 'd' : 'a') : (direction > 0 ? 's' : 'w');
        run(`keys.${key} = true; updatePlayers(0.1);`);
        const position = run(`p.${axis}`);
        assert.ok(direction > 0 ? position < wall * 6 : position > (wall + 1) * 6,
            'player crossed a complete wall in one frame');
    });
}

test('collision padding stays inside players on small screens', () => {
    const run = loadGame();
    assert.equal(run(`
        CELL_SIZE = 1; OFFSET_X = 0; OFFSET_Y = 0;
        maze = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(1));
        maze[1][1] = 0;
        checkWallCollision(1.15, 1.15, 0.7);
    `), false);
});

test('movement covers the requested distance in an open maze', () => {
    const run = loadGame();
    assert.equal(run(`
        CELL_SIZE = 6; OFFSET_X = 0; OFFSET_Y = 0;
        maze = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(0));
        const p = { x: 18.9, y: 18.9, size: 4.2 };
        players = [p, { x: 90, y: 90, size: 4.2 }];
        keys.d = true;
        updatePlayers(0.1);
        Math.abs(p.x - 36.9) < 1e-9;
    `), true);
});

test('a player wins when one frame crosses the goal on a small screen', () => {
    const run = loadGame();
    assert.equal(run(`
        CELL_SIZE = 1; OFFSET_X = 0; OFFSET_Y = 0;
        maze = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(0));
        gameOver = false; winner = null;
        const p = { x: 4, y: 10, size: 0.7, name: 'BLUE' };
        players = [p, { x: 16, y: 16, size: 0.7, name: 'RED' }];
        keys.d = true;
        updatePlayers(12 / PLAYER_SPEED);
        gameOver && winner === 'BLUE' && p.x < 12;
    `), true);
});

for (const [blueX, outcome, label] of [
    [6, 'RED', 'the first finisher wins even when both can reach the goal in one frame'],
    [8, 'DRAW', 'the race is a draw when both players reach the goal on the same step'],
]) {
    test(label, () => {
        const run = loadGame();
        run(`
            CELL_SIZE = 1; OFFSET_X = 0; OFFSET_Y = 0;
            maze = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(0));
            players = [
                { x: ${blueX}, y: 10, size: 0.7, name: 'BLUE' },
                { x: 8, y: 11, size: 0.7, name: 'RED' },
            ];
            keys.d = keys.ArrowRight = true;
            updatePlayers(0.05);
        `);
        assert.equal(run('winner'), outcome);
    });
}

for (const [player, horizontal, vertical] of [[0, 'd', 's'], [1, 'ArrowRight', 'ArrowDown']]) {
    test(`player ${player + 1} travels at the same speed diagonally and horizontally`, () => {
        function distance(diagonal) {
            const run = loadGame();
            return run(`
                CELL_SIZE = 20; OFFSET_X = 0; OFFSET_Y = 0;
                maze = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(0));
                players = [
                    { x: 50, y: 50, size: 14 },
                    { x: 100, y: 100, size: 14 },
                ];
                const before = { ...players[${player}] };
                keys.${horizontal} = true;
                keys.${vertical} = ${diagonal};
                updatePlayers(0.05);
                Math.hypot(players[${player}].x - before.x, players[${player}].y - before.y);
            `);
        }

        assert.ok(Math.abs(distance(false) - 9) < 1e-9);
        assert.ok(Math.abs(distance(true) - distance(false)) < 1e-9,
            'diagonal input grants extra movement speed');
    });
}
