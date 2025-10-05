// Negative Blocks Shooter - minimal playable scaffold

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const ui = {
  score: document.getElementById('score'),
  wave: document.getElementById('wave'),
  health: document.getElementById('health'),
  powerups: document.getElementById('powerups'),
  perks: document.getElementById('perks')
};

const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('startBtn');

// Time
let lastTime = 0;
let accumulator = 0;
const fixedDt = 1 / 60;

// Input
const input = { left: false, right: false, up: false, down: false };
window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') input.left = true;
  if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') input.right = true;
  if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') input.up = true;
  if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') input.down = true;
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') input.left = false;
  if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') input.right = false;
  if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') input.up = false;
  if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') input.down = false;
});

// Util
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function randRange(a, b) { return a + Math.random() * (b - a); }
function chance(p) { return Math.random() < p; }

// Sound (WebAudio, no assets)
const Sound = {
  ctx: null,
  enabled: true,
  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
  },
  play(freq = 440, dur = 0.05, type = 'sine', gain = 0.08) {
    if (!this.enabled || !this.ctx) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.value = gain;
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t0);
    // quick envelope
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.stop(t0 + dur + 0.01);
  },
  // named cues
  cue(name) {
    switch(name){
      case 'fire': this.play(950, 0.03, 'triangle', 0.06); break;
      case 'enemyHit': this.play(260, 0.04, 'sawtooth', 0.06); break;
      case 'enemyDead': this.play(180, 0.08, 'square', 0.09); break;
      case 'blockTick': this.play(650, 0.02, 'square', 0.05); break;
      case 'blockPop': this.play(520, 0.10, 'triangle', 0.08); break;
      case 'blockCollide': this.play(110, 0.14, 'sine', 0.12); break;
      case 'pickup': this.play(780, 0.06, 'sine', 0.07); break;
      case 'playerHit': this.play(140, 0.10, 'sawtooth', 0.1); break;
      case 'gameOver': this.play(100, 0.25, 'square', 0.1); break;
      case 'explode':
        // layered down-sweep explosion
        this.play(220, 0.18, 'sawtooth', 0.12);
        this.play(120, 0.25, 'square', 0.09);
        this.play(60, 0.32, 'sine', 0.08);
        break;
      case 'laser':
        this.play(900, 0.12, 'sine', 0.06);
        this.play(700, 0.12, 'triangle', 0.04);
        break;
      default: break;
    }
  }
};

// Game state
const state = {
  running: false,
  paused: false,
  width: canvas.width,
  height: canvas.height,
  score: 0,
  wave: 1,
  waveTime: 0,
  waveDuration: 45,
  spawnCd: 0,
  spawnFlip: false,
  deathTimer: 0,
  player: null,
  orbs: [],
  bullets: [],
  enemies: [],
  enemyBullets: [],
  blocks: [],
  pickups: [],
  effects: [],
  timers: [],
  kills: { grunt: 0, battleship: 0, lasership: 0, boss: 0 },
};

// Control button states and positions
const controls = {
  pauseBtn: { x: state.width - 80, y: state.height - 50, w: 70, h: 20, text: '⏸️ Pause' },
  soundBtn: { x: state.width - 80, y: state.height - 26, w: 70, h: 20, text: '🔊 Sound' }
};

function addTimer(duration, onDone) {
  state.timers.push({ t: duration, onDone });
}

// Entities
class Player {
  constructor() {
    this.width = 28; this.height = 18;
    this.x = state.width / 2 - this.width / 2;
    this.y = state.height - this.height - 16;
    this.speed = 300;
    this.fireCooldown = 0;
    this.baseFireRate = 6; // shots per second
    this.damage = 1;
    this.health = 3;
    this.inv = 0; // invincibility after collisions
    this.buffs = [];
    // Permanent upgrades from pickups
    this.perm = { pierce: 0, spread: 0, homing: 0 };
  }
  rect() { return { x: this.x, y: this.y, w: this.width, h: this.height }; }
}

class Bullet { constructor(x, y, vx, vy, dmg, pierce = 0) { this.x = x; this.y = y; this.vx = vx; this.vy = vy; this.dmg = dmg; this.pierce = pierce; this.r = 2.5; this.dead = false; } }
class Enemy { constructor(x, y, hp, vx, vy, type = 'grunt') { this.x = x; this.y = y; this.hp = hp; this.vx = vx; this.vy = vy; this.type = type; this.w = 24; this.h = 18; this.fireCd = randRange(1.2, 2.2); this.dead = false; this.collides = (type !== 'battleship'); this.anchorY = null; this.shotsFired = 0; this.maxShots = (type === 'grunt') ? 2 : Infinity; } rect(){ return { x:this.x, y:this.y, w:this.w, h:this.h }; } }
class Block { constructor(x, y, value) { this.x=x; this.y=y; this.value=value; this.vy=randRange(40, 70); this.dead=false; const mag = Math.abs(value); const size = clamp(18 + mag * 1.2, 20, 60); this.w=size; this.h=size; } rect(){ return {x:this.x, y:this.y, w:this.w, h:this.h}; } }
class Pickup { constructor(x,y,kind,dur=6){ this.x=x; this.y=y; this.r=6; this.kind=kind; this.dur=dur; this.vy=60; this.dead=false; } }

function resetGame() {
  state.score = 0;
  state.wave = 1;
  state.waveDuration = 45;
  state.waveTime = state.waveDuration;
  state.spawnCd = 0;
  state.paused = false;
  state.bullets.length = 0;
  state.enemies.length = 0;
  state.enemyBullets.length = 0;
  state.blocks.length = 0;
  state.pickups.length = 0;
  state.effects.length = 0;
  state.timers.length = 0;
  state.deathTimer = 0;
  state.kills = { grunt: 0, battleship: 0, lasership: 0, boss: 0 };
  state.player = new Player();
  state.orbs = [];
  ui.score.textContent = `Score: ${state.score}`;
  ui.wave.textContent = `Wave ${state.wave} - ${Math.ceil(state.waveTime)}s`;
  ui.health.textContent = '❤❤❤';
  ui.perks.textContent = 'Upgrades: None';
  controls.pauseBtn.text = '⏸️ Pause';
}

// Spawning
function spawnWaveBurst(wave) {
  const lanes = Math.min(7, 5 + Math.floor((wave-1)/3));
  const enemyChance = Math.min(0.7, 0.25 + wave * 0.04);
  const blockChance = Math.max(0.04, 0.12 - wave * 0.1); // rarer negative blocks
  // Alternate between formation and scattered spawns for visibility
  if (state.spawnFlip) {
    const groupCount = Math.min(9, 3 + Math.floor(wave/1.5));
    const spacing = 26 + Math.min(32, wave * 1.1);
    const cx = state.width/2;
    const y0 = -100;
    spawnFormationV(cx, y0, groupCount, spacing, wave);
  } else {
    for (let i=0;i<lanes;i++) {
    const x = 40 + i * ((state.width - 80)/ Math.max(1,(lanes-1)));
    if (chance(enemyChance)) {
      const hp = Math.max(1, Math.ceil(2 + wave * 0.4));
      state.enemies.push(new Enemy(x, -randRange(30, 140), hp, 0, randRange(40, 90)));
    }
    if (chance(blockChance)) state.blocks.push(new Block(x, -randRange(120, 260), pickBlockValue(wave)));
    }
  }
  state.spawnFlip = !state.spawnFlip;
}

// Spawn a V formation centered at cx with "count" ships arranged in rows
function spawnFormationV(cx, yTop, count, spacing, wave){
  // rows grow 1,2,3,... until count is reached
  let remaining = count;
  let row = 0;
  const w2 = wave*wave;
  while (remaining > 0){
    row += 1;
    const inRow = Math.min(row, remaining);
    const y = yTop - 40 + row * spacing;
    const totalWidth = (inRow - 1) * spacing;
    for (let i=0;i<inRow;i++){
      const x = cx - totalWidth/2 + i * spacing + (row%2===0? spacing*0.15:0);
      const hp = Math.max(1, Math.ceil(2 + wave * 0.4));
      const e = new Enemy(x, y, hp, 0, randRange(55, 95), 'grunt');
      // slight lateral drift to sell formation motion
      e.vx = (i - (inRow-1)/2) * 6;
      state.enemies.push(e);
    }
    remaining -= inRow;
  }
}

function spawnBoss(wave){
  // Simple large enemy with more HP and frequent shots
  const w2 = wave * wave;
  const bossHp = Math.ceil(200 + wave * 50 + 5 * w2);
  const boss = new Enemy(state.width/2 - 40, -80, bossHp, 0, 30, 'boss');
  boss.w = 80; boss.h = 50; boss.fireCd = 0.6;
  state.enemies.push(boss);
}

function pickBlockValue(wave){
  const pool = [-1,-3,-5,-10];
  if (wave >= 4 && chance(0.3)) pool.push(-20);
  return pool[Math.floor(Math.random()*pool.length)];
}

// Collision helpers
function aabb(a,b){ return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }
function circleRect(cx, cy, r, rect){
  const rx = clamp(cx, rect.x, rect.x + rect.w);
  const ry = clamp(cy, rect.y, rect.y + rect.h);
  const dx = cx - rx; const dy = cy - ry;
  return dx*dx + dy*dy <= r*r;
}

// Buff system
function addBuff(player, kind, magnitude, duration){
  const until = duration;
  player.buffs.push({ kind, magnitude, t: until });
}
function getDerivedStats(player){
  let fireRate = player.baseFireRate;
  let damage = player.damage;
  let speed = player.speed;
  let pierce = 0;
  let spread = 0; // number of extra lanes
  let shield = 0;
  for (const b of player.buffs){
    if (b.kind === 'fireRate') fireRate += fireRate * b.magnitude;
    if (b.kind === 'damage') damage += damage * b.magnitude;
    if (b.kind === 'speed') speed += speed * b.magnitude;
    if (b.kind === 'pierce') pierce += b.magnitude;
    if (b.kind === 'spread') spread += b.magnitude;
    if (b.kind === 'shield') shield += b.magnitude;
  }
  // Include permanent upgrades
  pierce += player.perm.pierce;
  spread += player.perm.spread;
  const shotCount = clamp(1 + Math.floor(spread), 1, 7);
  const totalSpreadDeg = clamp(10 + spread * 10, 10, 60);
  return { fireRate: Math.min(fireRate, 20), damage: Math.min(damage, 4), speed: Math.min(speed, 750), pierce: Math.min(pierce, 4), shield, shotCount, totalSpreadDeg };
}

function grantBlockCollisionBuffs(magnitude){
  const p = state.player;
  // Scale: 10% fire, 5% damage, 6% speed per magnitude unit, 5*m shield
  addBuff(p,'fireRate', Math.min(1.5, 0.10 * magnitude), 6);
  addBuff(p,'damage', Math.min(3.0, 0.05 * magnitude), 6);
  addBuff(p,'speed', Math.min(1.5, 0.06 * magnitude), 6);
  addBuff(p,'shield', Math.min(150, 5 * magnitude), 8);
  // Also pierce per 8 magnitude
  const pierce = Math.floor(magnitude / 8);
  if (pierce > 0) addBuff(p,'pierce', pierce, 8);
  // Add spread per 6 magnitude
  const spread = Math.floor(magnitude / 6);
  if (spread > 0) addBuff(p,'spread', spread, 8);
  // brief invincibility
  p.inv = 0.6;
  // UI badge
  showBadge(`Block Power +${magnitude}`);
}

function showBadge(text){
  const el = document.createElement('div');
  el.className = 'badge';
  el.textContent = text;
  ui.powerups.appendChild(el);
  setTimeout(()=>{ el.remove(); }, 1200);
}

function renderBuffBadges(){
  const p = state.player; if (!p) return;
  // Clear old
  ui.powerups.innerHTML = '';
  // Aggregate notable buffs for UI
  const aggregate = {};
  for (const b of p.buffs){
    const key = b.kind;
    if (!aggregate[key]) aggregate[key] = { totalMag: 0, maxT: 0 };
    aggregate[key].totalMag += b.magnitude;
    aggregate[key].maxT = Math.max(aggregate[key].maxT, b.t);
  }
  const labels = {
    fireRate: 'Overclock',
    damage: 'Overcharge',
    speed: 'Surge',
    pierce: 'Pierce',
    spread: 'Spread',
    shield: 'Shield'
  };
  for (const key of Object.keys(aggregate)){
    const info = aggregate[key];
    const el = document.createElement('div');
    el.className = 'badge';
    const pct = (key === 'pierce' || key === 'shield' || key === 'spread') ? '' : `${Math.round(info.totalMag*100)}%`;
    const extra = key === 'pierce' ? `+${info.totalMag}` : key === 'shield' ? `${Math.round(info.totalMag)}` : key === 'spread' ? `+${Math.round(info.totalMag)}` : pct;
    el.textContent = `${labels[key]} ${extra} (${info.maxT.toFixed(1)}s)`;
    ui.powerups.appendChild(el);
  }
}

function renderPerkLine(){
  const p = state.player; if (!p) return;
  const parts = [];
  if (p.perm.pierce>0) parts.push(`Pierce +${p.perm.pierce}`);
  if (p.perm.spread>0) parts.push(`Spread +${p.perm.spread}`);
  if (p.perm.homing>0) parts.push(`Homing +${p.perm.homing}`);
  ui.perks.textContent = parts.length ? `Upgrades: ${parts.join('  |  ')}` : 'Upgrades: None';
}

// Game logic
function update(dt){
  const p = state.player;
  // If dying, play out explosion and delay game over overlay
  if (!p && state.deathTimer > 0){
    state.deathTimer -= dt;
    if (state.deathTimer <= 0){
      gameOver();
      return;
    }
  }
  // Timers
  for (let i=state.timers.length-1;i>=0;i--){
    const t = state.timers[i]; t.t -= dt; if (t.t <= 0){ t.onDone?.(); state.timers.splice(i,1); }
  }

  // Buffs tick
  if (p){
    for (let i=p.buffs.length-1;i>=0;i--){
      p.buffs[i].t -= dt; if (p.buffs[i].t <= 0) p.buffs.splice(i,1);
    }
    if (p.inv > 0) p.inv -= dt;
  }

  // Wave timer and spawning cadence
  state.waveTime -= dt;
  ui.wave.textContent = `Wave ${state.wave} - ${Math.max(0, Math.ceil(state.waveTime))}s`;
  const spawnRate = Math.max(0.7, 2.2 - state.wave * 0.12);
  state.spawnCd -= dt;
  if (state.spawnCd <= 0 && state.waveTime > 0){
    state.spawnCd += spawnRate;
    const enemyCap = Math.min(16, 6 + Math.floor(state.wave * 0.9));
    if (state.wave % 4 === 0 && state.enemies.filter(e=>e.type==='boss').length === 0){
      spawnBoss(state.wave);
    } else if (state.enemies.length < enemyCap) {
      spawnWaveBurst(state.wave);
      // chance to add a stationary battleship
      if (chance(0.25)){
        const hp = Math.ceil(40 + state.wave * 12 + 0.5 * state.wave * state.wave);
        const bx = randRange(60, state.width-100);
        const by = -120;
        const bs = new Enemy(bx, by, hp, 0, 70, 'battleship');
        bs.w = 60; bs.h = 34; bs.collides = false;
        state.enemies.push(bs);
      }
      // chance to add a laser-only ship
      if (chance(0.20)){
        const hp2 = Math.max(4, Math.ceil(6 + state.wave * 0.6));
        const lx = randRange(40, state.width-40);
        const ls = new Enemy(lx, -100, hp2, 0, 80, 'lasership');
        ls.w = 22; ls.h = 20; ls.collides = true;
        ls.beamCd = randRange(2.5, 4.0);
        state.enemies.push(ls);
      }
    }
  }
  // Advance wave after timer elapses and arena is clear
  if (state.waveTime <= 0 && state.enemies.length === 0 && state.blocks.length === 0){
    state.wave += 1;
    state.waveDuration = Math.min(75, 45 + state.wave * 3);
    state.waveTime = state.waveDuration;
    showBadge(`Wave ${state.wave}`);
  }

  // Player move
  if (p){
    const derived = getDerivedStats(p);
    const vx = (input.right?1:0) - (input.left?1:0);
    const vy = (input.down?1:0) - (input.up?1:0);
    p.x += vx * derived.speed * dt;
    p.y += vy * derived.speed * dt;
    p.x = clamp(p.x, 0, state.width - p.width);
    p.y = clamp(p.y, 0, state.height - p.height);
    // Fire
    p.fireCooldown -= dt;
    const fireInterval = 1 / derived.fireRate;
    if (p.fireCooldown <= 0){
      p.fireCooldown += fireInterval;
      // multi-shot with spread
      const centerX = p.x + p.width/2;
      const centerY = p.y;
      const speed = 480;
      const shots = derived.shotCount;
      const total = derived.totalSpreadDeg * Math.PI/180;
      // Regular spread shots
      for (let i=0;i<shots;i++){
        const t = shots === 1 ? 0 : (i/(shots-1) - 0.5);
        const ang = -Math.PI/2 + t * total; // up direction with spread
        const vxB = Math.cos(ang) * speed;
        const vyB = Math.sin(ang) * speed;
        const b = new Bullet(centerX, centerY, vxB, vyB, derived.damage, derived.pierce);
        state.bullets.push(b);
      }
      // Homing missiles (one per level of homing)
      for (let h=0; h< (p.perm.homing||0); h++){
        const ang = -Math.PI/2;
        const vxB = Math.cos(ang) * (speed*0.7);
        const vyB = Math.sin(ang) * (speed*0.7);
        const b = new Bullet(centerX, centerY, vxB, vyB, Math.max(derived.damage, 1.5), derived.pierce);
        b.homing = true; b.turnRate = 4.0; b.maxSpeed = speed*0.9;
        state.bullets.push(b);
      }
      Sound.cue('fire');
    }
    // Update orbiting orbs
    if (state.orbs && state.orbs.length){
      const baseAng = performance.now() * 0.0015;
      const count = state.orbs.length;
      for (let i=0;i<count;i++){
        const orb = state.orbs[i];
        const ang = baseAng + i * ((Math.PI*2)/count);
        const rr = orb.radius;
        orb.x = p.x + p.width/2 + Math.cos(ang) * rr;
        orb.y = p.y + p.height/2 + Math.sin(ang) * rr;
        // bullet
        orb.fireCd -= dt;
        if (orb.fireCd <= 0){
          orb.fireCd = 0.6;
          const speed = 420;
          state.bullets.push(new Bullet(orb.x, orb.y, 0, -speed, Math.max(0.8, p.damage*0.8), 0));
        }
        // laser
        orb.laserCd = (orb.laserCd || randRange(2.0, 3.0)) - dt;
        if (orb.laserCd <= 0){
          orb.laserCd = randRange(2.0, 3.0);
          const beam = { kind:'laser', x1:orb.x, y1:orb.y, x2:orb.x, y2:-20, w:4, t:0.25, tMax:0.25 };
          state.effects.push(beam);
          Sound.cue('laser');
          for (const e of state.enemies){
            if (e.dead) continue;
            const minX = Math.min(beam.x1 - 6, beam.x1 + 6);
            const maxX = Math.max(beam.x1 - 6, beam.x1 + 6);
            if (e.x + e.w > minX && e.x < maxX && e.y < orb.y){
              e.hp -= Math.max(2, p.damage * 2);
              if (e.hp <= 0){ e.dead = true; state.score += 10; ui.score.textContent = `Score: ${state.score}`; }
            }
          }
        }
      }
    }
  }

  // Bullets
  for (const b of state.bullets){
    // homing steering
    if (b.homing){
      let target = null; let best = Infinity;
      for (const e of state.enemies){
        if (e.dead) continue;
        const dx = (e.x+e.w/2) - b.x; const dy = (e.y+e.h/2) - b.y;
        const dist2 = dx*dx + dy*dy;
        if (dist2 < best){ best = dist2; target = e; }
      }
      if (target){
        const desiredAng = Math.atan2((target.y+target.h/2)-b.y, (target.x+target.w/2)-b.x);
        const curAng = Math.atan2(b.vy, b.vx);
        let diff = desiredAng - curAng;
        while (diff > Math.PI) diff -= Math.PI*2;
        while (diff < -Math.PI) diff += Math.PI*2;
        const maxTurn = b.turnRate * dt;
        const newAng = curAng + clamp(diff, -maxTurn, maxTurn);
        const speedMag = Math.min(b.maxSpeed, Math.hypot(b.vx, b.vy) + 200*dt);
        b.vx = Math.cos(newAng)*speedMag;
        b.vy = Math.sin(newAng)*speedMag;
      }
    }
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.y < -12 || b.y > state.height+12 || b.x < -12 || b.x > state.width+12) b.dead = true;
  }

  // Enemies
  for (const e of state.enemies){
    e.x += e.vx * dt; e.y += e.vy * dt;
    if (e.type === 'battleship'){
      // slow to a stop at anchor point
      if (e.anchorY == null) e.anchorY = randRange(120, 220);
      if (e.y < e.anchorY) e.vy = Math.min(e.vy + 10*dt, 50);
      else { e.vy = 0; e.y = e.anchorY; }
    }
    if (e.y > state.height + 40) e.dead = true;
    // enemy fire
    e.fireCd -= dt;
    const fireIntervalBase = (e.type === 'boss') ? 1.0 : (e.type === 'battleship' ? randRange(0.7, 1.2) : randRange(1.6, 2.4));
    const fireAccel = Math.max(0.5, 1.0 - (state.wave-1) * 0.06); // faster with waves
    const fireInterval = fireIntervalBase * fireAccel;
    if (e.fireCd <= 0 && e.y > 10 && e.shotsFired < e.maxShots){
      e.fireCd += fireInterval;
      e.shotsFired++;
      // planes only shoot forward (downward), not behind
      const speed = (e.type==='boss') ? 120 : 90;
      if (e.type === 'grunt'){
        state.enemyBullets.push({ x: e.x+e.w/2, y: e.y+e.h, vx: 0, vy: speed, r: 3, dead: false });
      } else {
        // boss/battleship use aimed logic
        const px = state.player?.x + (state.player?.width||0)/2 || e.x;
        const py = state.player?.y + (state.player?.height||0)/2 || e.y+100;
        const dx = px - (e.x + e.w/2);
        const dy = py - (e.y + e.h/2);
        const len = Math.hypot(dx, dy) || 1;
        state.enemyBullets.push({ x: e.x+e.w/2, y: e.y+e.h/2, vx: dx/len*speed, vy: dy/len*speed, r: 3, dead: false });
      }
      if (e.type==='boss'){
        // side shots
        state.enemyBullets.push({ x: e.x+e.w/2, y: e.y+e.h/2, vx: -60, vy: 120, r: 3, dead: false });
        state.enemyBullets.push({ x: e.x+e.w/2, y: e.y+e.h/2, vx: 60, vy: 120, r: 3, dead: false });
      } else if (e.type==='battleship'){
        // radial burst (recompute aim vector locally)
        const px2 = state.player?.x + (state.player?.width||0)/2 || e.x;
        const py2 = state.player?.y + (state.player?.height||0)/2 || e.y+100;
        const dx2 = px2 - (e.x + e.w/2);
        const dy2 = py2 - (e.y + e.h/2);
        const baseAng = Math.atan2(dy2, dx2);
        for (let k=0;k<4;k++){
          const a = baseAng + k * (Math.PI/2);
          state.enemyBullets.push({ x: e.x+e.w/2, y: e.y+e.h/2, vx: Math.cos(a)*80, vy: Math.sin(a)*80, r: 3, dead: false });
        }
      }
    }
  }

  // Blocks
  for (const bl of state.blocks){ bl.y += bl.vy * dt; if (bl.y > state.height + 30) bl.dead = true; }

  // Pickups
  for (const pu of state.pickups){ pu.y += pu.vy * dt; if (pu.y > state.height + 20) pu.dead = true; }

  // Enemy bullets
  for (const eb of state.enemyBullets){ eb.x += eb.vx * dt; eb.y += eb.vy * dt; if (eb.y > state.height + 30 || eb.y < -30 || eb.x < -30 || eb.x > state.width + 30) eb.dead = true; }

  // Effects (particles)
  for (const fx of state.effects){
    fx.t -= dt;
    if (fx.kind === 'particle'){
      fx.vx *= 0.98; fx.vy *= 0.98; fx.vy += 20*dt;
      fx.x += fx.vx * dt; fx.y += fx.vy * dt;
    } else if (fx.kind === 'laser'){
      // nothing to update besides lifetime
    }
  }
  state.effects = state.effects.filter(fx => fx.t > 0);

  // Collisions: bullets vs enemies
  for (const b of state.bullets){
    if (b.dead) continue;
    for (const e of state.enemies){
      if (e.dead) continue;
      if (circleRect(b.x, b.y, b.r, e.rect())){
        e.hp -= b.dmg;
        Sound.cue('enemyHit');
        if (e.hp <= 0){
          e.dead = true; state.score += 10; ui.score.textContent = `Score: ${state.score}`; Sound.cue('enemyDead');
          spawnEnemyExplosion(e.x + e.w/2, e.y + e.h/2, e.type==='boss' ? 60 : e.type==='battleship' ? 40 : 22);
          if (e.type === 'boss') state.kills.boss += 1; else if (e.type === 'battleship') state.kills.battleship += 1; else state.kills.grunt += 1;
          // Drop chance for spread pickup
          const dropRoll = Math.random();
          if (dropRoll < 0.04) state.pickups.push(new Pickup(e.x+e.w/2, e.y+e.h/2, 'spread', 0));
          else if (dropRoll < 0.08) state.pickups.push(new Pickup(e.x+e.w/2, e.y+e.h/2, 'triple', 0));
          else if (dropRoll < 0.11) state.pickups.push(new Pickup(e.x+e.w/2, e.y+e.h/2, 'homing', 0));
          else if (dropRoll < 0.14) state.pickups.push(new Pickup(e.x+e.w/2, e.y+e.h/2, 'orb', 0));
        }
        if (b.pierce > 0){ b.pierce -= 1; } else { b.dead = true; break; }
      }
    }
  }

  // Bullets should NOT affect negative number blocks anymore (pass-through)

  // Player vs blocks: grant temporary power-ups only (no bullet interaction)
  if (p){
    for (const bl of state.blocks){
      if (bl.dead) continue;
      if (aabb(p.rect(), bl.rect())){
        const m = Math.abs(bl.value);
        grantBlockCollisionBuffs(m);
        bl.dead = true;
        // minor score incentive on collision
        state.score += Math.max(1, Math.floor(m/2));
        ui.score.textContent = `Score: ${state.score}`;
        Sound.cue('blockCollide');
      }
    }
  }

  // Player vs pickups
  if (p){
    for (const pu of state.pickups){
      if (pu.dead) continue;
      if (circleRect(p.x + p.width/2, p.y + p.height/2, Math.max(p.width,p.height)/2, {x:pu.x-pu.r,y:pu.y-pu.r,w:pu.r*2,h:pu.r*2})){
        pu.dead = true;
        if (pu.kind === 'triple') { p.perm.pierce += 1; showBadge('Pierce +1 (permanent)'); }
        if (pu.kind === 'spread') { p.perm.spread += 1; showBadge('Spread +1 (permanent)'); }
        if (pu.kind === 'homing') { p.perm.homing += 1; showBadge('Homing +1 (permanent)'); }
        if (pu.kind === 'orb') {
          // add another orb
          state.orbs.push({ radius: 26 + state.orbs.length * 4, x: p.x, y: p.y, fireCd: randRange(0.2,0.5), laserCd: randRange(1.0,2.0) });
          showBadge('Orb +1');
        }
        // also play sound
        Sound.cue('pickup');
      }
    }
  }

  // Player vs enemy bullets and enemies
  if (p){
    // bullets
    for (const eb of state.enemyBullets){
      if (eb.dead) continue;
      if (circleRect(eb.x, eb.y, eb.r, p.rect())){
        eb.dead = true;
        if (p.inv <= 0){
          p.health -= 1;
          p.inv = 1.0;
          ui.health.textContent = '❤'.repeat(Math.max(0, p.health));
          Sound.cue('playerHit');
          if (p.health <= 0){ triggerDeath(p); return; }
        }
      }
    }
    // enemy contact (skip battleships)
    for (const e of state.enemies){
      if (e.dead) continue;
      if (!e.collides) continue;
      if (aabb(p.rect(), e.rect())){
        e.dead = true;
        if (p.inv <= 0){
          p.health -= 1;
          p.inv = 1.0;
          ui.health.textContent = '❤'.repeat(Math.max(0, p.health));
          Sound.cue('playerHit');
          if (p.health <= 0){ triggerDeath(p); return; }
        }
      }
    }
  }

  // Cleanup
  state.bullets = state.bullets.filter(b=>!b.dead);
  state.enemies = state.enemies.filter(e=>!e.dead);
  state.blocks = state.blocks.filter(b=>!b.dead);
  state.pickups = state.pickups.filter(pu=>!pu.dead);
  state.enemyBullets = state.enemyBullets.filter(eb=>!eb.dead);
}

// Render
function render(){
  ctx.clearRect(0,0,state.width,state.height);
  // background grid
  ctx.save();
  ctx.globalAlpha = 0.15;
  ctx.strokeStyle = '#1f2a44';
  for (let y=0;y<state.height;y+=24){ ctx.beginPath(); ctx.moveTo(0,y+0.5); ctx.lineTo(state.width,y+0.5); ctx.stroke(); }
  ctx.restore();

  // HUD inside canvas: score (left), hearts (right)
  ctx.fillStyle = '#e6edf3';
  ctx.font = 'bold 14px Inter, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`Score: ${state.score}` , 8, 8);
  // Wave/timer under score
  ctx.fillText(`Wave ${state.wave} - ${Math.max(0, Math.ceil(state.waveTime))}s`, 8, 26);
  // Upgrades line under wave
  if (state.player){
    const parts = [];
    if (state.player.perm.pierce>0) parts.push(`Pierce +${state.player.perm.pierce}`);
    if (state.player.perm.spread>0) parts.push(`Spread +${state.player.perm.spread}`);
    if (state.player.perm.homing>0) parts.push(`Homing +${state.player.perm.homing}`);
    if (state.orbs && state.orbs.length>0) parts.push(`Orbs ×${state.orbs.length}`);
    const upgrades = parts.length ? `Upgrades: ${parts.join('  |  ')}` : 'Upgrades: None';
    ctx.fillText(upgrades, 8, 44);
  }
  // Kills row (icons + counts)
  let ky = 64; let kx = 8;
  const drawGruntIcon = (x,y)=>{ ctx.save(); ctx.translate(x,y); ctx.fillStyle='#f59e0b'; ctx.beginPath(); ctx.moveTo(0, 8); ctx.lineTo(4,-4); ctx.lineTo(0,0); ctx.lineTo(-4,-4); ctx.closePath(); ctx.fill(); ctx.restore(); };
  const drawMotherIcon = (x,y)=>{ ctx.save(); ctx.translate(x,y); ctx.fillStyle='#94a3b8'; ctx.beginPath(); ctx.ellipse(0,0,6,4,0,0,Math.PI*2); ctx.fill(); ctx.restore(); };
  const drawBossIcon = (x,y)=>{ ctx.save(); ctx.translate(x,y); ctx.fillStyle='#ef4444'; ctx.beginPath(); ctx.arc(0,0,5,0,Math.PI*2); ctx.fill(); ctx.restore(); };
  if (state.kills.grunt > 0){ drawGruntIcon(kx+6, ky+6); ctx.fillText(`× ${state.kills.grunt}`, kx+16, ky); kx += 80; }
  if (state.kills.battleship > 0){ drawMotherIcon(kx+6, ky+6); ctx.fillText(`× ${state.kills.battleship}`, kx+16, ky); kx += 80; }
  if (state.kills.boss > 0){ drawBossIcon(kx+6, ky+6); ctx.fillText(`× ${state.kills.boss}`, kx+16, ky); }
  if (state.player){
    const hearts = '❤'.repeat(Math.max(0, state.player.health));
    ctx.textAlign = 'right';
    ctx.fillText(hearts, state.width - 8, 8);
  }

  // Control buttons (pause/sound)
  if (state.running) {
    ctx.save();
    // Pause button
    const pauseBtn = controls.pauseBtn;
    ctx.fillStyle = 'rgba(30, 41, 59, 0.9)';
    ctx.fillRect(pauseBtn.x, pauseBtn.y, pauseBtn.w, pauseBtn.h);
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    ctx.strokeRect(pauseBtn.x, pauseBtn.y, pauseBtn.w, pauseBtn.h);
    ctx.fillStyle = '#e6edf3';
    ctx.font = '12px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(pauseBtn.text, pauseBtn.x + pauseBtn.w/2, pauseBtn.y + pauseBtn.h/2);
    
    // Sound button
    const soundBtn = controls.soundBtn;
    const soundAlpha = Sound.enabled ? 0.9 : 0.5;
    ctx.fillStyle = `rgba(30, 41, 59, ${soundAlpha})`;
    ctx.fillRect(soundBtn.x, soundBtn.y, soundBtn.w, soundBtn.h);
    ctx.strokeStyle = '#475569';
    ctx.strokeRect(soundBtn.x, soundBtn.y, soundBtn.w, soundBtn.h);
    ctx.fillStyle = Sound.enabled ? '#e6edf3' : '#94a3b8';
    ctx.fillText(soundBtn.text, soundBtn.x + soundBtn.w/2, soundBtn.y + soundBtn.h/2);
    ctx.restore();
  }

  // player
  const p = state.player;
  if (p){
    // Futuristic jet fighter
    ctx.save();
    const cx = p.x + p.width/2;
    const cy = p.y + p.height/2;
    ctx.translate(cx, cy);
    // Body
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.moveTo(0, -14);     // nose
    ctx.lineTo(6, 8);       // right tail
    ctx.lineTo(0, 4);       // center notch
    ctx.lineTo(-6, 8);      // left tail
    ctx.closePath();
    ctx.fill();
    // Wings
    ctx.fillStyle = '#0ea5e9';
    ctx.beginPath();
    ctx.moveTo(-14, 2);
    ctx.lineTo(-2, 0);
    ctx.lineTo(-2, 6);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(14, 2);
    ctx.lineTo(2, 0);
    ctx.lineTo(2, 6);
    ctx.closePath();
    ctx.fill();
    // Cockpit
    ctx.fillStyle = '#e0f2fe';
    ctx.beginPath();
    ctx.arc(0, -6, 3, 0, Math.PI*2);
    ctx.fill();
    // Thruster flame (animated)
    const t = performance.now()*0.001;
    const flicker = 6 + Math.sin(t*20)*1.5;
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.moveTo(-2, 8);
    ctx.lineTo(2, 8);
    ctx.lineTo(0, 8 + flicker);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // orbiting orbs render
  if (state.orbs && state.player){
    for (const orb of state.orbs){
      ctx.save();
      ctx.translate(orb.x, orb.y);
      ctx.fillStyle = '#a78bfa';
      ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI*2); ctx.fill();
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = '#c4b5fd';
      ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI*2); ctx.stroke();
      ctx.restore();
    }
  }

  // bullets
  for (const b of state.bullets){
    if (b.homing){
      ctx.save();
      ctx.translate(b.x, b.y);
      const ang = Math.atan2(b.vy, b.vx);
      ctx.rotate(ang + Math.PI/2);
      ctx.fillStyle = '#93c5fd';
      // rectangular missile body
      ctx.fillRect(-3, -8, 6, 16);
      // small nose tip
      ctx.fillStyle = '#bfdbfe';
      ctx.fillRect(-2, -12, 4, 4);
      ctx.restore();
    } else {
      ctx.fillStyle = '#a7f3d0';
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI*2); ctx.fill();
    }
  }

  // enemies
  for (const e of state.enemies){
    if (e.type === 'battleship'){
      // stylized mothership (saucer)
      ctx.save();
      const cx = e.x + e.w/2, cy = e.y + e.h/2;
      ctx.translate(cx, cy);
      // bottom glow
      const grd = ctx.createRadialGradient(0, e.h*0.2, 2, 0, e.h*0.2, Math.max(e.w, e.h));
      grd.addColorStop(0, 'rgba(96,165,250,0.10)');
      grd.addColorStop(1, 'rgba(96,165,250,0)');
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.ellipse(0, e.h*0.25, e.w*0.8, e.h*0.8, 0, 0, Math.PI*2); ctx.fill();
      // main hull (ellipse)
      ctx.fillStyle = '#64748b';
      ctx.beginPath(); ctx.ellipse(0, 0, e.w*0.55, e.h*0.45, 0, 0, Math.PI*2); ctx.fill();
      // upper dome
      ctx.fillStyle = '#94a3b8';
      ctx.beginPath(); ctx.ellipse(0, -e.h*0.15, e.w*0.28, e.h*0.2, 0, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#e2e8f0';
      ctx.beginPath(); ctx.ellipse(-e.w*0.06, -e.h*0.18, e.w*0.10, e.h*0.07, 0, 0, Math.PI*2); ctx.fill();
      // light windows around rim
      const lights = 8;
      for (let i=0;i<lights;i++){
        const t = (i / lights) * Math.PI*2;
        const lx = Math.cos(t) * e.w*0.38;
        const ly = Math.sin(t) * e.h*0.18;
        ctx.fillStyle = (i%2===0)? '#93c5fd' : '#60a5fa';
        ctx.beginPath(); ctx.ellipse(lx, ly, 3.2, 2.2, 0, 0, Math.PI*2); ctx.fill();
      }
      // rotating halo ring
      ctx.save();
      ctx.rotate((performance.now()*0.001)% (Math.PI*2));
      ctx.strokeStyle = 'rgba(148,163,184,0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(0, e.h*0.05, e.w*0.65, e.h*0.55, 0, 0, Math.PI*2); ctx.stroke();
      ctx.restore();
      ctx.restore();
    } else {
      // stylized enemy plane (yellow)
      ctx.save();
      ctx.translate(e.x + e.w/2, e.y + e.h/2);
      // Body pointing downward
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.moveTo(0, 12);     // nose down
      ctx.lineTo(6, -6);     // right tail
      ctx.lineTo(0, -2);     // center notch
      ctx.lineTo(-6, -6);    // left tail
      ctx.closePath();
      ctx.fill();
      // Wings
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.moveTo(-12, -4);
      ctx.lineTo(-2, -2);
      ctx.lineTo(-2, 2);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(12, -4);
      ctx.lineTo(2, -2);
      ctx.lineTo(2, 2);
      ctx.closePath();
      ctx.fill();
      // Canopy
      ctx.fillStyle = '#fde68a';
      ctx.beginPath(); ctx.arc(0, 4, 2.5, 0, Math.PI*2); ctx.fill();
      ctx.restore();
    }
  }

  // blocks
  for (const bl of state.blocks){
    const magnitude = Math.abs(bl.value);
    const color = magnitude >= 10 ? '#ef4444' : magnitude >= 5 ? '#fb923c' : '#f59e0b';
    // draw 5-point star sized by magnitude
    const cx = bl.x + bl.w/2, cy = bl.y + bl.h/2;
    const base = clamp(10 + magnitude * 1.1, 14, 40);
    const outer = base, inner = base * 0.5;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(performance.now()*0.001 * 0.5);
    ctx.beginPath();
    for (let i=0;i<10;i++){
      const r = (i % 2 === 0) ? outer : inner;
      const a = -Math.PI/2 + i * Math.PI/5;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#0b1220';
    ctx.stroke();
    ctx.restore();
    // no numeral overlay: size indicates magnitude
  }

  // pickups
  for (const pu of state.pickups){
    const t = performance.now() * 0.001;
    if (pu.kind === 'homing'){
      // rectangular homing pickup (blue hues)
      ctx.save();
      ctx.translate(pu.x, pu.y);
      ctx.rotate(Math.sin(t*2) * 0.2);
      ctx.fillStyle = '#60a5fa';
      ctx.fillRect(-7, -10, 14, 20);
      ctx.fillStyle = '#1d4ed8';
      ctx.fillRect(-5, -14, 10, 6);
      ctx.restore();
    } else if (pu.kind === 'spread'){
      // diamond for spread (orange)
      ctx.save();
      ctx.translate(pu.x, pu.y);
      ctx.rotate(Math.PI/4);
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(-8, -8, 16, 16);
      ctx.restore();
    } else if (pu.kind === 'triple'){
      // circle for pierce (green)
      ctx.fillStyle = '#10b981';
      ctx.beginPath(); ctx.arc(pu.x, pu.y, pu.r+2, 0, Math.PI*2); ctx.fill();
    } else {
      // fallback
      ctx.fillStyle = '#cbd5e1';
      ctx.beginPath(); ctx.arc(pu.x, pu.y, pu.r, 0, Math.PI*2); ctx.fill();
    }
  }

  // enemy bullets
  ctx.fillStyle = '#fb7185';
  for (const eb of state.enemyBullets){ ctx.beginPath(); ctx.arc(eb.x, eb.y, eb.r, 0, Math.PI*2); ctx.fill(); }

  // effects
  for (const fx of state.effects){
    if (fx.kind === 'particle'){
      const a = Math.max(0, fx.t / fx.tMax);
      ctx.fillStyle = `rgba(245, 158, 11, ${a.toFixed(3)})`;
      ctx.beginPath(); ctx.arc(fx.x, fx.y, fx.r * a, 0, Math.PI*2); ctx.fill();
    } else if (fx.kind === 'laser'){
      const a = Math.max(0, fx.t / fx.tMax);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.strokeStyle = '#a78bfa';
      ctx.lineWidth = fx.w;
      ctx.beginPath();
      ctx.moveTo(fx.x1, fx.y1);
      ctx.lineTo(fx.x2, fx.y2);
      ctx.stroke();
      // glow core
      ctx.strokeStyle = '#c4b5fd';
      ctx.lineWidth = fx.w * 0.5;
      ctx.beginPath();
      ctx.moveTo(fx.x1, fx.y1);
      ctx.lineTo(fx.x2, fx.y2);
      ctx.stroke();
      ctx.restore();
    }
  }
}

function gameLoop(ts){
  if (!state.running){ lastTime = ts; requestAnimationFrame(gameLoop); return; }
  
  const delta = (ts - lastTime) / 1000; lastTime = ts;
  
  // If paused, only render but don't update
  if (state.paused) {
    render();
    renderBuffBadges();
    renderPerkLine();
    requestAnimationFrame(gameLoop);
    return;
  }
  
  accumulator += Math.min(delta, 0.1);
  while (accumulator >= fixedDt){ update(fixedDt); accumulator -= fixedDt; }
  render();
  renderBuffBadges();
  renderPerkLine();
  requestAnimationFrame(gameLoop);
}

startBtn.addEventListener('click', ()=>{
  overlay.classList.add('hidden');
  Sound.init();
  resetGame();
  state.running = true;
  // Hide DOM score/health since we render them in-canvas now
  if (ui.score) ui.score.style.display = 'none';
  if (ui.health) ui.health.style.display = 'none';
  if (ui.wave) ui.wave.style.display = 'none';
  if (ui.perks) ui.perks.style.display = 'none';
});

requestAnimationFrame(gameLoop);

function gameOver(){
  state.running = false;
  overlay.classList.remove('hidden');
  overlay.querySelector('h1').textContent = 'Game Over';
  overlay.querySelector('p').textContent = `Score: ${state.score}`;
  startBtn.textContent = 'Restart';
  Sound.cue('gameOver');
}

function triggerDeath(player){
  // spawn explosion particles at player location
  const cx = player.x + player.width/2;
  const cy = player.y + player.height/2;
  Sound.cue('explode');
  for (let i=0;i<40;i++){
    const ang = Math.random()*Math.PI*2;
    const speed = 60 + Math.random()*220;
    state.effects.push({ kind:'particle', x:cx, y:cy, vx:Math.cos(ang)*speed, vy:Math.sin(ang)*speed, r: 3 + Math.random()*4, t: 0.8 + Math.random()*0.4, tMax: 1.0 });
  }
  // remove player and delay game over overlay
  state.player = null;
  state.deathTimer = 1.1;
}

function spawnEnemyExplosion(x, y, count = 22){
  for (let i=0;i<count;i++){
    const ang = Math.random()*Math.PI*2;
    const speed = 50 + Math.random()*180;
    state.effects.push({ kind:'particle', x, y, vx:Math.cos(ang)*speed, vy:Math.sin(ang)*speed, r: 2 + Math.random()*3, t: 0.5 + Math.random()*0.4, tMax: 0.8 });
  }
}

// Canvas mouse click detection for control buttons
canvas.addEventListener('click', (e) => {
  if (!state.running) return;
  
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  
  // Check pause button click
  const pauseBtn = controls.pauseBtn;
  if (x >= pauseBtn.x && x <= pauseBtn.x + pauseBtn.w && 
      y >= pauseBtn.y && y <= pauseBtn.y + pauseBtn.h) {
    state.paused = !state.paused;
    if (state.paused) {
      controls.pauseBtn.text = '▶️ Resume';
    } else {
      controls.pauseBtn.text = '⏸️ Pause';
    }
    return;
  }
  
  // Check sound button click
  const soundBtn = controls.soundBtn;
  if (x >= soundBtn.x && x <= soundBtn.x + soundBtn.w && 
      y >= soundBtn.y && y <= soundBtn.y + soundBtn.h) {
    Sound.enabled = !Sound.enabled;
    if (Sound.enabled) {
      controls.soundBtn.text = '🔊 Sound';
    } else {
      controls.soundBtn.text = '🔇 Sound';
    }
    return;
  }
});

// Space bar to pause/resume
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && state.running) {
    e.preventDefault();
    state.paused = !state.paused;
    if (state.paused) {
      controls.pauseBtn.text = '▶️ Resume';
    } else {
      controls.pauseBtn.text = '⏸️ Pause';
    }
  }
});
