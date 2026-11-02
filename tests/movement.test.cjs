const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadGame() {
    const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    const element = { classList: { add() {}, remove() {} } };
    const canvas = { getContext: () => ({ fillRect() {}, strokeRect() {} }) };
    const context = vm.createContext({
        window: { innerWidth: 800, innerHeight: 600, addEventListener() {} },
        document: {
            getElementById: id => id === 'gameCanvas' ? canvas : element,
            addEventListener() {},
        },
        requestAnimationFrame() {},
    });
    vm.runInContext(script, context);
    return code => vm.runInContext(code, context);
}

for (const [axis, direction] of [['x', 1], ['x', -1], ['y', 1], ['y', -1]]) {
    test(`movement cannot skip a wall along ${axis} in direction ${direction}`, () => {
        const run = loadGame();
        run(`
            CELL_SIZE = 6; OFFSET_X = 0; OFFSET_Y = 0;
            maze = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(0));
            const p = { x: 18.9, y: 18.9, size: 4.2 };
        `);
        const wall = direction > 0 ? 4 : 2;
        run(axis === 'x'
            ? `for (const row of maze) row[${wall}] = 1;`
            : `maze[${wall}].fill(1);`);
        run(`movePlayer(p, ${axis === 'x' ? direction : 0}, ${axis === 'y' ? direction : 0}, 18);`);
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
        movePlayer(p, 1, 0, 18);
        Math.abs(p.x - 36.9) < 1e-9;
    `), true);
});

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
