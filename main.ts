import { readFileSync as rf, writeFileSync as wf, mkdirSync as md } from "node:fs";
import { join } from "node:path";

// Tiny stack VM for make.fun ISA v1. node main.ts [inputDir] [outputDir]
// (defaults /input, /output). Runs i001..i040, writing stdout.bin + exit.txt.
// 32-bit wrapping ints, 256-value stack, 64-deep calls, 256 words of memory,
// 1,000,000 steps, 65,536 output bytes, traps 2..11. Deterministic: no clock,
// no randomness, no environment reads.
const IN = process.argv[2] || "/input";
const OUT = process.argv[3] || "/output";

function run(p, inp) {
  const s = new Int32Array(256);
  let sp = 0;
  const c = new Int32Array(64);
  let cp = 0;
  const me = new Int32Array(256);
  const ch = [];
  let ol = 0, ip = 0, pc = 0, n = 0;
  const T = (e) => { throw e; };
  const out = (e) => ({ exit: e, out: Buffer.concat(ch, ol) });
  const push = (v) => { if (sp >= 256) T(3); s[sp++] = v; };
  const pop = () => { if (sp < 1) T(2); return s[--sp]; };
  const bin = (f) => { if (sp < 2) T(2); const b = s[--sp]; s[sp - 1] = f(s[sp - 1], b) | 0; };
  const un = (f) => { if (sp < 1) T(2); s[sp - 1] = f(s[sp - 1]) | 0; };
  try {
    for (;;) {
      if (n >= 1e6) T(10);
      if (pc < 0 || pc >= p.length) T(9);
      const o = p[pc];
      if (!(o <= 7 || (o >= 16 && o <= 30) || (o >= 32 && o <= 34) ||
        (o >= 48 && o <= 52) || (o >= 64 && o <= 65) || (o >= 80 && o <= 83))) T(5);
      const il = o === 1 ? 1 : o === 2 ? 4 : o >= 48 && o <= 51 ? 2 : 0;
      if (pc + 1 + il > p.length) T(9);
      n++;
      let q = pc + 1 + il;
      const off = () => ((p[pc + 1] | (p[pc + 2] << 8)) << 16) >> 16;
      switch (o) {
        case 0: return out(0); // HALT
        case 1: push((p[pc + 1] << 24) >> 24); break; // PUSH8, sign-extended
        case 2: push(p.readInt32LE(pc + 1)); break; // PUSH32
        case 3: pop(); break; // POP
        case 4: if (sp < 1) T(2); push(s[sp - 1]); break; // DUP
        case 5: if (sp < 2) T(2); { const t = s[sp - 1]; s[sp - 1] = s[sp - 2]; s[sp - 2] = t; } break; // SWAP
        case 6: if (sp < 2) T(2); push(s[sp - 2]); break; // OVER
        case 7: if (sp < 3) T(2); { const a = s[sp - 3]; s[sp - 3] = s[sp - 2]; s[sp - 2] = s[sp - 1]; s[sp - 1] = a; } break; // ROT
        case 16: bin((a, b) => (a + b) | 0); break; // ADD
        case 17: bin((a, b) => (a - b) | 0); break; // SUB
        case 18: bin((a, b) => Math.imul(a, b)); break; // MUL, low 32 bits
        case 19: bin((a, b) => { if (!b) T(4); return (a / b) | 0; }); break; // DIV, INT_MIN/-1 wraps
        case 20: bin((a, b) => { if (!b) T(4); return a % b; }); break; // MOD, sign of dividend
        case 21: bin((a, b) => { if (!b) T(4); return Math.floor((a >>> 0) / (b >>> 0)); }); break; // DIVU
        case 22: bin((a, b) => { if (!b) T(4); return (a >>> 0) % (b >>> 0); }); break; // MODU
        case 23: un((a) => -a); break; // NEG
        case 24: bin((a, b) => a & b); break; // AND
        case 25: bin((a, b) => a | b); break; // OR
        case 26: bin((a, b) => a ^ b); break; // XOR
        case 27: un((a) => ~a); break; // NOT
        case 28: bin((a, b) => a << (b & 31)); break; // SHL
        case 29: bin((a, b) => a >> (b & 31)); break; // SHR, arithmetic
        case 30: bin((a, b) => a >>> (b & 31)); break; // SHRU, logical
        case 32: bin((a, b) => (a === b ? 1 : 0)); break; // EQ
        case 33: bin((a, b) => (a < b ? 1 : 0)); break; // LT, signed
        case 34: bin((a, b) => ((a >>> 0) < (b >>> 0) ? 1 : 0)); break; // LTU
        case 48: q = pc + 3 + off(); break; // JMP
        case 49: if (pop() === 0) q = pc + 3 + off(); break; // JZ
        case 50: if (pop() !== 0) q = pc + 3 + off(); break; // JNZ
        case 51: if (cp >= 64) T(7); c[cp++] = pc + 3; q = p[pc + 1] | (p[pc + 2] << 8); break; // CALL
        case 52: if (!cp) T(8); q = c[--cp]; break; // RET
        case 64: { if (sp < 1) T(2); const a = s[sp - 1]; if (a < 0 || a > 255) T(6); s[sp - 1] = me[a]; break; } // LOAD
        case 65: { if (sp < 2) T(2); const a = s[--sp], v = s[--sp]; if (a < 0 || a > 255) T(6); me[a] = v; break; } // STORE
        case 80: { const v = pop(), t = String(v); if (ol + t.length > 65536) T(11); ch.push(Buffer.from(t)); ol += t.length; break; } // PRINT
        case 81: { const v = pop(); if (ol + 1 > 65536) T(11); ch.push(Buffer.from([v & 255])); ol++; break; } // PUTC
        case 82: push(ip < inp.length ? inp[ip++] : -1); break; // IN, -1 at end of input
        case 83: return out(pop() & 255); // EXIT, low byte is the code
      }
      pc = q;
    }
  } catch (e) { return out(typeof e === "number" ? e : 9); }
}

for (let i = 1; i <= 40; i++) {
  const id = "i" + String(i).padStart(3, "0");
  let p, inp;
  try { p = rf(join(IN, id, "program.bin")); } catch { p = Buffer.alloc(0); }
  try { inp = rf(join(IN, id, "input.bin")); } catch { inp = Buffer.alloc(0); }
  const r = run(p, inp);
  const d = join(OUT, id);
  md(d, { recursive: true });
  wf(join(d, "stdout.bin"), r.out);
  wf(join(d, "exit.txt"), r.exit + "\n");
}
