import { useState, useEffect, useCallback, useRef } from "react";
import * as Tone from "tone";

const BOARD_SIZE = 8;
const CELL = 64;
const BOARD_PX = CELL * BOARD_SIZE;

// Use filled unicode for both, style with CSS color
const PIECE_CHAR = { king: "♚\uFE0E", queen: "♛\uFE0E", rook: "♜\uFE0E", bishop: "♝\uFE0E", knight: "♞\uFE0E", pawn: "♟\uFE0E" };

const LEVELS = [
  { level: 1, name: "The Queen", target: "queen", count: 1, enemyCount: 2, startBpm: 40, bpmRamp: 0.12 },
  { level: 2, name: "The Rooks", target: "rook", count: 2, enemyCount: 3, startBpm: 46, bpmRamp: 0.14 },
  { level: 3, name: "The Knights", target: "knight", count: 2, enemyCount: 3, startBpm: 52, bpmRamp: 0.16 },
  { level: 4, name: "The Bishops", target: "bishop", count: 2, enemyCount: 4, startBpm: 58, bpmRamp: 0.18 },
  { level: 5, name: "The Pawns", target: "pawn", count: 8, enemyCount: 5, startBpm: 64, bpmRamp: 0.22 },
];

// All squares a piece attacks from (r,c)
function getAttackSquares(type, row, col) {
  const sq = [];
  const straight = [[-1,0],[1,0],[0,-1],[0,1]];
  const diag = [[-1,-1],[-1,1],[1,-1],[1,1]];
  const slide = (dirs) => {
    dirs.forEach(([dr,dc]) => {
      for (let i = 1; i < BOARD_SIZE; i++) {
        const r = row+dr*i, c = col+dc*i;
        if (r<0||r>=BOARD_SIZE||c<0||c>=BOARD_SIZE) break;
        sq.push([r,c]);
      }
    });
  };
  switch(type) {
    case "rook": slide(straight); break;
    case "bishop": slide(diag); break;
    case "queen": slide(straight); slide(diag); break;
    case "knight":
      [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]].forEach(([dr,dc]) => {
        const r=row+dr, c=col+dc;
        if (r>=0&&r<BOARD_SIZE&&c>=0&&c<BOARD_SIZE) sq.push([r,c]);
      });
      break;
    case "pawn":
      if (row+1<BOARD_SIZE&&col-1>=0) sq.push([row+1,col-1]);
      if (row+1<BOARD_SIZE&&col+1<BOARD_SIZE) sq.push([row+1,col+1]);
      break;
  }
  return sq;
}

// Get laser line segments from piece to attacked squares (for beam animation)
function getLaserLines(type, row, col) {
  const lines = [];
  const cx = col*CELL+CELL/2, cy = row*CELL+CELL/2;
  const straight = [[-1,0],[1,0],[0,-1],[0,1]];
  const diag = [[-1,-1],[-1,1],[1,-1],[1,1]];

  const addRay = (dirs) => {
    dirs.forEach(([dr,dc]) => {
      let endR=row, endC=col;
      for (let i=1;i<BOARD_SIZE;i++) {
        const r=row+dr*i, c=col+dc*i;
        if (r<0||r>=BOARD_SIZE||c<0||c>=BOARD_SIZE) break;
        endR=r; endC=c;
      }
      if (endR!==row||endC!==col) {
        lines.push({ x1:cx, y1:cy, x2:endC*CELL+CELL/2, y2:endR*CELL+CELL/2 });
      }
    });
  };

  switch(type) {
    case "rook": addRay(straight); break;
    case "bishop": addRay(diag); break;
    case "queen": addRay(straight); addRay(diag); break;
    case "knight":
      [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]].forEach(([dr,dc]) => {
        const r=row+dr, c=col+dc;
        if (r>=0&&r<BOARD_SIZE&&c>=0&&c<BOARD_SIZE) {
          // L-shape: go the 2-square direction first, then the 1-square turn
          if (Math.abs(dr) === 2) {
            // 2 vertical, then 1 horizontal
            const midX = cx;
            const midY = (row + dr) * CELL + CELL/2;
            lines.push({ x1:cx, y1:cy, x2:midX, y2:midY });
            lines.push({ x1:midX, y1:midY, x2:c*CELL+CELL/2, y2:midY });
          } else {
            // 2 horizontal, then 1 vertical
            const midX = (col + dc) * CELL + CELL/2;
            const midY = cy;
            lines.push({ x1:cx, y1:cy, x2:midX, y2:midY });
            lines.push({ x1:midX, y1:midY, x2:midX, y2:r*CELL+CELL/2 });
          }
        }
      });
      break;
    case "pawn":
      if (row+1<BOARD_SIZE&&col-1>=0) lines.push({x1:cx,y1:cy,x2:(col-1)*CELL+CELL/2,y2:(row+1)*CELL+CELL/2});
      if (row+1<BOARD_SIZE&&col+1<BOARD_SIZE) lines.push({x1:cx,y1:cy,x2:(col+1)*CELL+CELL/2,y2:(row+1)*CELL+CELL/2});
      break;
  }
  return lines;
}

let uid = 0;
const nid = () => ++uid;

function randomEmpty(occupied) {
  const s = new Set(occupied.map(([r,c])=>`${r},${c}`));
  for (let i=0;i<300;i++) {
    const r=Math.floor(Math.random()*BOARD_SIZE), c=Math.floor(Math.random()*BOARD_SIZE);
    if (!s.has(`${r},${c}`)) return [r,c];
  }
  return [0,0];
}

function spawnEnemyBatch(count, occupied) {
  const types = ["pawn","pawn","pawn","bishop","bishop","rook","rook","knight","queen"];
  const batch = [];
  const occ = [...occupied];
  for (let i=0;i<count;i++) {
    const type = types[Math.floor(Math.random()*types.length)];
    const [r,c] = randomEmpty(occ);
    batch.push({ id:nid(), type, row:r, col:c });
    occ.push([r,c]);
  }
  return batch;
}

export default function KingsGambit() {
  const [gs, setGs] = useState("menu");
  const [king, setKing] = useState({row:7,col:4});
  const [blacks, setBlacks] = useState([]);
  const [collectible, setCollectible] = useState(null); // white piece to collect
  const [hearts, setHearts] = useState([]);
  const [lives, setLives] = useState(3);
  const [level, setLevel] = useState(0);
  const [collected, setCollected] = useState(0);
  const [army, setArmy] = useState([]);
  const [bpm, setBpm] = useState(40);
  const [beat, setBeat] = useState(0);
  const [phase, setPhase] = useState("spawn"); // spawn | fire
  const [laserSquares, setLaserSquares] = useState(new Set());
  const [laserLines, setLaserLines] = useState([]);
  const [lasersVisible, setLasersVisible] = useState(false);
  const [hitFlash, setHitFlash] = useState(false);
  const [intro, setIntro] = useState("");
  const [toneReady, setToneReady] = useState(false);

  // Refs
  const r = useRef({});
  r.current = { king, blacks, collectible, hearts, lives, level, collected, army, bpm, beat, phase, gs };

  const loopRef = useRef(null);
  const synthRef = useRef(null);
  const laserSynthRef = useRef(null);
  const pickupSynthRef = useRef(null);
  const hitSynthRef = useRef(null);

  // Init audio - create synths lazily after Tone.start() for mobile compatibility
  const initSynths = useCallback(() => {
    if (synthRef.current) return; // already initialized
    synthRef.current = new Tone.MembraneSynth({
      pitchDecay:0.01, octaves:3, envelope:{attack:0.001,decay:0.15,sustain:0,release:0.05}
    }).toDestination();
    synthRef.current.volume.value = -6;

    laserSynthRef.current = new Tone.NoiseSynth({
      noise:{type:"white"}, envelope:{attack:0.005,decay:0.08,sustain:0,release:0.02}
    }).toDestination();
    laserSynthRef.current.volume.value = -14;

    pickupSynthRef.current = new Tone.Synth({
      oscillator:{type:"triangle"}, envelope:{attack:0.01,decay:0.15,sustain:0,release:0.1}
    }).toDestination();
    pickupSynthRef.current.volume.value = -8;

    hitSynthRef.current = new Tone.NoiseSynth({
      noise:{type:"pink"}, envelope:{attack:0.01,decay:0.2,sustain:0,release:0.1}
    }).toDestination();
    hitSynthRef.current.volume.value = -6;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (loopRef.current) { loopRef.current.stop(); loopRef.current.dispose(); }
      synthRef.current?.dispose();
      laserSynthRef.current?.dispose();
      pickupSynthRef.current?.dispose();
      hitSynthRef.current?.dispose();
    };
  }, []);

  const getOccupied = useCallback(() => {
    const o = [[r.current.king.row, r.current.king.col]];
    r.current.blacks.forEach(p => o.push([p.row,p.col]));
    if (r.current.collectible) o.push([r.current.collectible.row, r.current.collectible.col]);
    r.current.hearts.forEach(h => o.push([h.row,h.col]));
    return o;
  }, []);

  const spawnNewBatch = useCallback(() => {
    const lvl = LEVELS[r.current.level];
    const occ = getOccupied();
    const batch = spawnEnemyBatch(lvl.enemyCount, occ);
    setBlacks(batch);
    setPhase("spawn");
  }, [getOccupied]);

  const startBeatLoop = useCallback(() => {
    if (loopRef.current) { loopRef.current.stop(); loopRef.current.dispose(); }
    Tone.getTransport().cancel();
    Tone.getTransport().stop();
    Tone.getTransport().bpm.value = r.current.bpm;

    let localPhase = "spawn";

    loopRef.current = new Tone.Loop((time) => {
      Tone.getDraw().schedule(() => {
        if (r.current.gs !== "playing") return;

        const newBeat = r.current.beat + 1;
        setBeat(newBeat);

        if (localPhase === "spawn") {
          // SPAWN beat: pieces are visible as warning, play tick
          synthRef.current?.triggerAttackRelease("C2", "16n", Tone.now());
          localPhase = "fire";
          setPhase("fire");
        } else {
          // FIRE beat: lasers shoot, check hits, pieces vanish
          laserSynthRef.current?.triggerAttackRelease("16n", Tone.now());

          const currentBlacks = r.current.blacks;
          const allAttacked = new Set();
          const allLines = [];

          currentBlacks.forEach(p => {
            getAttackSquares(p.type, p.row, p.col).forEach(([ar,ac]) => allAttacked.add(`${ar},${ac}`));
            allLines.push(...getLaserLines(p.type, p.row, p.col));
          });

          setLaserSquares(allAttacked);
          setLaserLines(allLines);
          setLasersVisible(true);

          // Check king hit
          const k = r.current.king;
          if (allAttacked.has(`${k.row},${k.col}`)) {
            hitSynthRef.current?.triggerAttackRelease("8n", Tone.now());
            const nl = r.current.lives - 1;
            setLives(nl);
            setHitFlash(true);
            setTimeout(() => setHitFlash(false), 300);
            if (nl <= 0) {
              setGs("gameover");
              Tone.getTransport().stop();
              return;
            }
          }

          // Hearts survive lasers

          // Fade lasers
          const lvl = LEVELS[r.current.level];
          const flashDur = Math.max(100, (60000/r.current.bpm)*0.4);
          setTimeout(() => {
            setLasersVisible(false);
            setLaserSquares(new Set());
            setLaserLines([]);

            // Remove old blacks, spawn new batch
            const occ = [[r.current.king.row,r.current.king.col]];
            if (r.current.collectible) occ.push([r.current.collectible.row, r.current.collectible.col]);
            r.current.hearts.forEach(h => occ.push([h.row,h.col]));

            const batch = spawnEnemyBatch(lvl.enemyCount, occ);
            setBlacks(batch);
          }, flashDur);

          localPhase = "spawn";
          setPhase("spawn");

          // Maybe spawn collectible after beat 10
          if (newBeat >= 10 && !r.current.collectible && r.current.collected < lvl.count) {
            const occ = getOccupied();
            const [cr,cc] = randomEmpty(occ);
            setCollectible({ id:nid(), type:lvl.target, row:cr, col:cc });
          }

          // Spawn heart at beats 6 and 16 of every 20-beat cycle (fire-phase beats)
          const beatInCycle = newBeat % 20;
          if (beatInCycle === 6 || beatInCycle === 16) {
            const occ = getOccupied();
            const [hr,hc] = randomEmpty(occ);
            setHearts(prev => [...prev, { id:nid(), row:hr, col:hc }]);
          }

          // Maybe add an extra enemy as difficulty ramps
          if (newBeat % 20 === 0 && lvl.enemyCount < 7) {
            LEVELS[r.current.level].enemyCount = Math.min(7, lvl.enemyCount + 1);
          }

          // Ramp BPM
          const nb = Math.min(180, r.current.bpm + lvl.bpmRamp);
          setBpm(nb);
          Tone.getTransport().bpm.value = nb;
        }
      }, time);
    }, "4n");

    Tone.getTransport().start();
    loopRef.current.start(0);
  }, [getOccupied]);

  const initLevel = useCallback((lvlIdx) => {
    const lvl = LEVELS[lvlIdx];
    const kStart = {row:7,col:4};
    const occ = [[kStart.row,kStart.col]];
    const batch = spawnEnemyBatch(lvl.enemyCount, occ);

    setKing(kStart);
    setBlacks(batch);
    setCollectible(null);
    setHearts([]);
    setCollected(0);
    setLevel(lvlIdx);
    setBpm(lvl.startBpm);
    setBeat(0);
    setPhase("spawn");
    setLaserSquares(new Set());
    setLaserLines([]);
    setLasersVisible(false);
  }, []);

  const advanceLevel = useCallback(() => {
    Tone.getTransport().stop();
    const next = r.current.level + 1;
    if (next >= LEVELS.length) {
      setGs("win");
      return;
    }
    initLevel(next);
    setIntro(LEVELS[next].name);
    setGs("levelIntro");
    setTimeout(() => {
      setGs("playing");
      setIntro("");
      startBeatLoop();
    }, 2000);
  }, [initLevel, startBeatLoop]);

  const tryMove = useCallback((dr, dc) => {
    if (r.current.gs !== "playing") return;
    const k = r.current.king;
    const nr = k.row+dr, nc = k.col+dc;
    if (nr<0||nr>=BOARD_SIZE||nc<0||nc>=BOARD_SIZE) return;
    // Can't walk onto black pieces
    if (r.current.blacks.some(p => p.row===nr&&p.col===nc)) return;

    setKing({row:nr,col:nc});

    // Check collectible
    const c = r.current.collectible;
    if (c && c.row===nr && c.col===nc) {
      pickupSynthRef.current?.triggerAttackRelease("E5","16n",Tone.now());
      const nc2 = r.current.collected+1;
      setCollected(nc2);
      setArmy(prev => [...prev, {type:c.type, id:nid()}]);
      setCollectible(null);
      const lvl = LEVELS[r.current.level];
      if (nc2 >= lvl.count) {
        setTimeout(() => advanceLevel(), 500);
        return;
      }
      // Next collectible will spawn on a future beat
    }

    // Check hearts
    const hHit = r.current.hearts.find(h => h.row===nr&&h.col===nc);
    if (hHit) {
      pickupSynthRef.current?.triggerAttackRelease("C5","16n",Tone.now());
      setLives(l => Math.min(15, l+1));
      setHearts(prev => prev.filter(h => h.id!==hHit.id));
    }
  }, [advanceLevel]);

  const startGame = useCallback(async () => {
    if (!toneReady) { await Tone.start(); initSynths(); setToneReady(true); }
    setLives(3);
    setArmy([]);
    // Reset enemy counts
    LEVELS.forEach((l,i) => { l.enemyCount = [2,3,3,4,5][i]; });
    initLevel(0);
    setIntro(LEVELS[0].name);
    setGs("levelIntro");
    setTimeout(() => {
      setGs("playing");
      setIntro("");
      startBeatLoop();
    }, 2000);
  }, [toneReady, initLevel, startBeatLoop, initSynths]);

  // Keyboard
  useEffect(() => {
    const handle = (e) => {
      if (r.current.gs==="menu"||r.current.gs==="gameover"||r.current.gs==="win") {
        if (e.key===" "||e.key==="Enter") { e.preventDefault(); startGame(); }
        return;
      }
      if (r.current.gs!=="playing") return;
      let dr=0,dc=0;
      if (e.key==="ArrowUp"||e.key==="w") dr=-1;
      if (e.key==="ArrowDown"||e.key==="s") dr=1;
      if (e.key==="ArrowLeft"||e.key==="a") dc=-1;
      if (e.key==="ArrowRight"||e.key==="d") dc=1;
      if (dr||dc) { e.preventDefault(); tryMove(dr,dc); }
    };
    window.addEventListener("keydown",handle);
    return () => window.removeEventListener("keydown",handle);
  }, [startGame, tryMove]);

  // Click to move
  const boardClick = useCallback((e) => {
    if (r.current.gs!=="playing") return;
    const rect = e.currentTarget.getBoundingClientRect();
    const tc = Math.floor((e.clientX-rect.left)/CELL);
    const tr = Math.floor((e.clientY-rect.top)/CELL);
    const k = r.current.king;
    const dr=Math.sign(tr-k.row), dc=Math.sign(tc-k.col);
    if (dr||dc) tryMove(dr,dc);
  }, [tryMove]);

  const isDark = (r,c) => (r+c)%2===1;
  const curLvl = LEVELS[level];

  // Army display
  const armySlots = [];
  LEVELS.forEach((lvl) => {
    for (let j=0;j<lvl.count;j++) {
      const got = army.filter(a=>a.type===lvl.target).length;
      armySlots.push({ type:lvl.target, filled:j<got, key:`${lvl.target}-${j}` });
    }
  });

  const pieceStyle = (color, size=40) => ({
    fontSize: size,
    color: color,
    textShadow: color==="#fff"
      ? "0 0 2px rgba(0,0,0,0.8), 1px 1px 2px rgba(0,0,0,0.5)"
      : "0 0 2px rgba(255,255,255,0.3), 1px 1px 2px rgba(0,0,0,0.8)",
    lineHeight: 1,
  });

  return (
    <div style={{
      width:"100vw",minHeight:"100vh",background:"#0f0f1a",
      display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
      fontFamily:"'Georgia',serif",color:"#e8e0d4",userSelect:"none",overflow:"hidden",
    }}>
      {/* Title */}
      <div style={{textAlign:"center",marginBottom:12}}>
        <h1 style={{fontSize:28,fontWeight:700,margin:0,letterSpacing:3,color:"#f0d9b5"}}>♔ KING'S GAMBIT</h1>
        <p style={{margin:"2px 0",fontSize:11,color:"#6b5a3e",letterSpacing:1.5}}>A Chess.com Thinking Game Prototype</p>
      </div>

      {/* HUD */}
      <div style={{width:BOARD_PX,display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
        <div style={{display:"flex",gap:3}}>
          {Array.from({length:Math.max(3,lives)},(_,i) => (
            <span key={i} style={{fontSize:20,color:"#e33",opacity:i<lives?1:0.15,transition:"opacity 0.3s"}}>♥</span>
          ))}
        </div>
        {gs==="playing"&&curLvl&&(
          <div style={{fontSize:13,color:"#8b7355",textAlign:"center"}}>
            <span style={{color:"#b58863"}}>LEVEL {level+1}: </span>
            <span style={{color:"#f0d9b5"}}>{curLvl.name}</span>
            <span style={{color:"#6b5a3e",marginLeft:8}}>
              <span style={{...pieceStyle("#fff",16)}}>{PIECE_CHAR[curLvl.target]}</span> {Math.min(collected,curLvl.count)}/{curLvl.count}
            </span>
          </div>
        )}
        <div style={{fontSize:11,color:"#6b5a3e",minWidth:60,textAlign:"right"}}>
          {gs==="playing"&&<>{Math.round(bpm)} BPM</>}
        </div>
      </div>

      {/* Board */}
      <div onClick={boardClick} style={{
        position:"relative",width:BOARD_PX,height:BOARD_PX,
        border:"3px solid #8b7355",borderRadius:4,overflow:"hidden",cursor:"pointer",
        boxShadow:hitFlash
          ?"0 0 50px rgba(220,50,50,0.7),inset 0 0 40px rgba(220,50,50,0.3)"
          :"0 8px 32px rgba(0,0,0,0.6)",
        transition:"box-shadow 0.15s",
      }}>
        {/* Squares */}
        {Array.from({length:BOARD_SIZE},(_,rr) =>
          Array.from({length:BOARD_SIZE},(_,cc) => {
            const key=`${rr},${cc}`;
            const isLaser = lasersVisible && laserSquares.has(key);
            let bg = isDark(rr,cc) ? "#b58863" : "#f0d9b5";
            if (isLaser) bg = isDark(rr,cc) ? "#992222" : "#cc3333";
            return (
              <div key={key} style={{
                position:"absolute",left:cc*CELL,top:rr*CELL,width:CELL,height:CELL,
                background:bg,transition:isLaser?"background 0.05s":"background 0.25s",
              }}/>
            );
          })
        )}

        {/* Laser beam SVG overlay */}
        {lasersVisible && laserLines.length > 0 && (
          <svg style={{position:"absolute",inset:0,width:BOARD_PX,height:BOARD_PX,zIndex:5,pointerEvents:"none"}}>
            <defs>
              <filter id="glow">
                <feGaussianBlur stdDeviation="3" result="blur"/>
                <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
            </defs>
            {laserLines.map((l,i) => (
              <g key={i}>
                <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                  stroke="rgba(60,140,255,0.3)" strokeWidth="8" strokeLinecap="round"/>
                <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                  stroke="rgba(100,180,255,0.7)" strokeWidth="3" strokeLinecap="round" filter="url(#glow)"/>
                <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                  stroke="rgba(200,230,255,0.9)" strokeWidth="1" strokeLinecap="round"/>
              </g>
            ))}
          </svg>
        )}

        {/* Black pieces */}
        {blacks.map(p => (
          <div key={p.id} style={{
            position:"absolute",left:p.col*CELL,top:p.row*CELL,width:CELL,height:CELL,
            display:"flex",alignItems:"center",justifyContent:"center",zIndex:6,
            animation: phase==="spawn" ? "pieceAppear 0.2s ease-out" : undefined,
          }}>
            <span style={pieceStyle("#111",42)}>{PIECE_CHAR[p.type]}</span>
          </div>
        ))}

        {/* Collectible white piece */}
        {collectible && (
          <div style={{
            position:"absolute",left:collectible.col*CELL,top:collectible.row*CELL,
            width:CELL,height:CELL,display:"flex",alignItems:"center",justifyContent:"center",
            zIndex:7,animation:"pulse 1.2s ease-in-out infinite",
          }}>
            <span style={{
              ...pieceStyle("#fff",40),
              filter:"drop-shadow(0 0 12px rgba(255,215,0,0.6))",
            }}>{PIECE_CHAR[collectible.type]}</span>
          </div>
        )}

        {/* Hearts */}
        {hearts.map(h => (
          <div key={h.id} style={{
            position:"absolute",left:h.col*CELL,top:h.row*CELL,
            width:CELL,height:CELL,display:"flex",alignItems:"center",justifyContent:"center",
            zIndex:7,animation:"pulse 1.5s ease-in-out infinite",
          }}>
            <span style={{fontSize:28,color:"#ff6b6b",filter:"drop-shadow(0 0 8px rgba(255,80,80,0.5))"}}>♥</span>
          </div>
        ))}

        {/* King */}
        {(gs==="playing"||gs==="gameover") && (
          <div style={{
            position:"absolute",left:king.col*CELL,top:king.row*CELL,
            width:CELL,height:CELL,display:"flex",alignItems:"center",justifyContent:"center",
            zIndex:10,transition:"left 60ms ease-out,top 60ms ease-out",
          }}>
            <span style={{
              ...pieceStyle("#fff",46),
              filter:"drop-shadow(0 0 6px rgba(255,215,0,0.3))",
            }}>{PIECE_CHAR.king}</span>
          </div>
        )}

        {/* Level intro */}
        {gs==="levelIntro" && (
          <div style={{
            position:"absolute",inset:0,display:"flex",flexDirection:"column",
            alignItems:"center",justifyContent:"center",background:"rgba(15,15,26,0.88)",
            zIndex:30,animation:"fadeIn 0.3s",
          }}>
            <div style={{fontSize:14,color:"#8b7355",letterSpacing:2,marginBottom:6}}>LEVEL {level+1}</div>
            <div style={{fontSize:26,color:"#f0d9b5",fontWeight:700,letterSpacing:2,marginBottom:14}}>{intro}</div>
            <div style={{marginBottom:10}}>
              <span style={{...pieceStyle("#fff",48),filter:"drop-shadow(0 0 12px rgba(255,215,0,0.4))"}}>{PIECE_CHAR[curLvl?.target]}</span>
            </div>
            <div style={{fontSize:13,color:"#8b7355"}}>
              Collect {curLvl?.count} {curLvl?.target}{curLvl?.count>1?"s":""}
            </div>
          </div>
        )}

        {/* Menu */}
        {gs==="menu" && (
          <div style={{
            position:"absolute",inset:0,display:"flex",flexDirection:"column",
            alignItems:"center",justifyContent:"center",background:"rgba(15,15,26,0.95)",zIndex:30,
          }}>
            <div style={{...pieceStyle("#fff",56),marginBottom:16}}>{PIECE_CHAR.king}</div>
            <div style={{fontSize:14,color:"#b58863",maxWidth:340,textAlign:"center",lineHeight:1.7,marginBottom:6}}>
              Black pieces appear and fire lasers along their attack lines on the next beat.
            </div>
            <div style={{fontSize:13,color:"#8b7355",maxWidth:340,textAlign:"center",lineHeight:1.7,marginBottom:6}}>
              Dodge the lasers. Collect white pieces to build your army. Gather hearts to heal. The beat speeds up.
            </div>
            <div style={{fontSize:13,color:"#8b7355",maxWidth:340,textAlign:"center",lineHeight:1.7,marginBottom:22}}>
              Complete all 5 levels to win. You have three lives.
            </div>
            <button onClick={startGame} style={{
              background:"none",border:"2px solid #f0d9b5",color:"#f0d9b5",
              padding:"12px 40px",fontSize:16,fontFamily:"'Georgia',serif",
              letterSpacing:2,cursor:"pointer",borderRadius:4,
            }}
              onMouseOver={e=>{e.target.style.background="#f0d9b5";e.target.style.color="#0f0f1a";}}
              onMouseOut={e=>{e.target.style.background="none";e.target.style.color="#f0d9b5";}}
            >PLAY</button>
            <div style={{marginTop:12,fontSize:11,color:"#6b5a3e"}}>Arrow keys / WASD / click</div>
          </div>
        )}

        {/* Game Over */}
        {gs==="gameover" && (
          <div style={{
            position:"absolute",inset:0,display:"flex",flexDirection:"column",
            alignItems:"center",justifyContent:"center",background:"rgba(15,15,26,0.93)",zIndex:30,
          }}>
            <div style={{fontSize:16,color:"#c44",letterSpacing:2,marginBottom:12}}>CHECKMATE</div>
            <div style={{fontSize:14,color:"#8b7355",marginBottom:6}}>Level {level+1}: {curLvl?.name}</div>
            <div style={{fontSize:13,color:"#6b5a3e",marginBottom:20}}>Army: {army.length}/15 pieces</div>
            <button onClick={startGame} style={{
              background:"none",border:"2px solid #f0d9b5",color:"#f0d9b5",
              padding:"12px 40px",fontSize:16,fontFamily:"'Georgia',serif",
              letterSpacing:2,cursor:"pointer",borderRadius:4,
            }}
              onMouseOver={e=>{e.target.style.background="#f0d9b5";e.target.style.color="#0f0f1a";}}
              onMouseOut={e=>{e.target.style.background="none";e.target.style.color="#f0d9b5";}}
            >TRY AGAIN</button>
            <div style={{marginTop:10,fontSize:11,color:"#6b5a3e"}}>Space or Enter</div>
          </div>
        )}

        {/* Win */}
        {gs==="win" && (
          <div style={{
            position:"absolute",inset:0,display:"flex",flexDirection:"column",
            alignItems:"center",justifyContent:"center",background:"rgba(15,15,26,0.93)",zIndex:30,
          }}>
            <div style={{fontSize:18,color:"#daa520",letterSpacing:3,marginBottom:14,animation:"pulse 1.5s ease-in-out infinite"}}>
              ★ VICTORY ★
            </div>
            <div style={{fontSize:14,color:"#f0d9b5",marginBottom:12}}>Your army is complete!</div>
            <div style={{display:"flex",gap:6,marginBottom:8}}>
              {["queen","rook","rook","knight","knight","bishop","bishop"].map((t,i) => (
                <span key={i} style={{...pieceStyle("#fff",28),filter:"drop-shadow(0 0 6px rgba(255,215,0,0.4))"}}>{PIECE_CHAR[t]}</span>
              ))}
            </div>
            <div style={{display:"flex",gap:4,marginBottom:20}}>
              {Array.from({length:8},(_,i) => (
                <span key={i} style={{...pieceStyle("#fff",22),filter:"drop-shadow(0 0 6px rgba(255,215,0,0.4))"}}>{PIECE_CHAR.pawn}</span>
              ))}
            </div>
            <button onClick={startGame} style={{
              background:"none",border:"2px solid #f0d9b5",color:"#f0d9b5",
              padding:"12px 40px",fontSize:16,fontFamily:"'Georgia',serif",
              letterSpacing:2,cursor:"pointer",borderRadius:4,
            }}
              onMouseOver={e=>{e.target.style.background="#f0d9b5";e.target.style.color="#0f0f1a";}}
              onMouseOut={e=>{e.target.style.background="none";e.target.style.color="#f0d9b5";}}
            >PLAY AGAIN</button>
          </div>
        )}
      </div>

      {/* Army tracker */}
      <div style={{marginTop:10,width:BOARD_PX,display:"flex",justifyContent:"center",gap:5,flexWrap:"wrap"}}>
        {armySlots.map(a => (
          <span key={a.key} style={{
            fontSize: 22,
            lineHeight: 1,
            transition:"all 0.4s",
            transform: a.filled ? "scale(1.15)" : "scale(1)",
            ...(a.filled ? {
              color: "#fff",
              textShadow: "0 0 2px rgba(0,0,0,0.8), 1px 1px 2px rgba(0,0,0,0.5)",
              filter: "drop-shadow(0 0 6px rgba(255,215,0,0.5))",
            } : {
              color: "transparent",
              WebkitTextStroke: "1px #8b7355",
            }),
          }}>
            {PIECE_CHAR[a.type]}
          </span>
        ))}
      </div>

      {/* Controls */}
      {gs==="playing" && (
        <div style={{marginTop:8,fontSize:11,color:"#3a3528",letterSpacing:1}}>
          Arrow keys / WASD / click to move
        </div>
      )}

      <style>{`
        @keyframes pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.15)} }
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
        @keyframes pieceAppear { from{transform:scale(0);opacity:0} to{transform:scale(1);opacity:1} }
      `}</style>
    </div>
  );
}
