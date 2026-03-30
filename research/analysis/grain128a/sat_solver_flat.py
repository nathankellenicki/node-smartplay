#!/usr/bin/env python3
"""
Grain-128A SAT Solver — Flat Variable Encoding

Instead of building nested z3 expressions (which blow up exponentially),
this version creates EXPLICIT boolean variables for each state bit at
each round, connected by simple local constraints.

Total variables: ~128 key + 256 state × ~350 rounds + ~7000 aux = ~100K
Total clauses: ~500K

This is tractable for modern SAT solvers.
"""

import sys
import time
from z3 import *

class FlatGrain128A:
    """Grain-128A with flat variable encoding for SAT solving."""

    def __init__(self, solver, key_vars, iv_bytes, tag_name=""):
        self.s = solver
        self.tag = tag_name
        self.round = 0

        # Expand IV to bits
        iv_bits = []
        for byte_val in iv_bytes:
            for j in range(7, -1, -1):
                iv_bits.append(BoolVal(bool((byte_val >> j) & 1)))

        # LFSR state: explicit variables per round
        # Round 0 = initial state
        self.lfsr = []
        for i in range(128):
            if i < 96:
                self.lfsr.append(iv_bits[i])  # concrete IV bits
            elif i < 127:
                self.lfsr.append(BoolVal(True))  # padding
            else:
                self.lfsr.append(BoolVal(False))  # bit 127

        # NFSR state: key bits (these are the unknowns)
        self.nfsr = list(key_vars)

        self.aux_cnt = 0

    def _aux(self, name=""):
        """Create a fresh auxiliary variable."""
        self.aux_cnt += 1
        return Bool(f"{self.tag}_aux_{self.aux_cnt}")

    def _xor2(self, a, b):
        """a XOR b using an auxiliary variable."""
        r = self._aux()
        # r = a XOR b: encoded as (r => (a XOR b)) and ((a XOR b) => r)
        # Using z3's native Xor since we're constraining equality
        self.s.add(r == Xor(a, b))
        return r

    def _xor_multi(self, bits):
        """XOR multiple bits with balanced tree of aux vars."""
        if len(bits) == 1:
            return bits[0]
        if len(bits) == 2:
            return self._xor2(bits[0], bits[1])
        mid = len(bits) // 2
        left = self._xor_multi(bits[:mid])
        right = self._xor_multi(bits[mid:])
        return self._xor2(left, right)

    def _and2(self, a, b):
        """a AND b using an auxiliary variable."""
        r = self._aux()
        self.s.add(r == And(a, b))
        return r

    def _and3(self, a, b, c):
        return self._and2(a, self._and2(b, c))

    def _and4(self, a, b, c, d):
        return self._and2(a, self._and3(b, c, d))

    def _new_state_var(self, reg, idx):
        """Create a new state variable for the next round."""
        return Bool(f"{self.tag}_{reg}{idx}_r{self.round}")

    def clock(self, init_mode=False):
        """One clock step with flat variables."""
        self.round += 1
        s = self.lfsr
        n = self.nfsr

        # LFSR feedback: s[96]^s[81]^s[70]^s[38]^s[7]^s[0]
        lfsr_fb = self._xor_multi([s[96], s[81], s[70], s[38], s[7], s[0]])

        # NFSR feedback
        nfsr_lin = self._xor_multi([n[96], n[91], n[56], n[26], n[0]])
        nfsr_nl = self._xor_multi([
            self._and2(n[84], n[68]),
            self._and2(n[67], n[3]),
            self._and2(n[65], n[61]),
            self._and2(n[59], n[27]),
            self._and2(n[48], n[40]),
            self._and2(n[18], n[17]),
            self._and2(n[13], n[11]),
            self._and3(n[82], n[78], n[70]),
            self._and3(n[25], n[24], n[22]),
            self._and4(n[95], n[93], n[92], n[88]),
        ])
        nfsr_fb = self._xor2(nfsr_lin, nfsr_nl)

        # h function
        x0, x1 = n[12], s[8]
        x2, x3 = s[13], s[20]
        x4, x5 = n[95], s[42]
        x6, x7 = s[60], s[79]
        x8 = s[94]

        h = self._xor_multi([
            self._and2(x0, x1),
            self._and2(x2, x3),
            self._and2(x4, x5),
            self._and2(x6, x7),
            self._and3(x0, x4, x8),
        ])

        # Output y
        y = self._xor_multi([
            h, s[93], n[2], n[15], n[36], n[45], n[64], n[73], n[89]
        ])

        # Shift and feedback
        lfsr_out = s[0]

        if init_mode:
            new_lfsr = self._xor2(lfsr_fb, y)
            new_nfsr = self._xor_multi([nfsr_fb, lfsr_out, y])
        else:
            new_lfsr = lfsr_fb
            new_nfsr = self._xor2(nfsr_fb, lfsr_out)

        # Create new state variables for shifted registers
        new_lfsr_state = s[1:] + [new_lfsr]
        new_nfsr_state = n[1:] + [new_nfsr]

        # For every Nth round, create fresh variables and constrain equality
        # This prevents z3 from building deep expression chains
        if self.round % 16 == 0:
            fresh_lfsr = []
            for i in range(128):
                v = self._new_state_var("s", i)
                self.s.add(v == new_lfsr_state[i])
                fresh_lfsr.append(v)
            fresh_nfsr = []
            for i in range(128):
                v = self._new_state_var("n", i)
                self.s.add(v == new_nfsr_state[i])
                fresh_nfsr.append(v)
            self.lfsr = fresh_lfsr
            self.nfsr = fresh_nfsr
        else:
            self.lfsr = new_lfsr_state
            self.nfsr = new_nfsr_state

        return y

    def initialize(self):
        for i in range(256):
            self.clock(init_mode=True)
            if i % 64 == 0:
                print(f"  [{self.tag}] Init round {i}/256 (aux vars: {self.aux_cnt})", file=sys.stderr)
        print(f"  [{self.tag}] Init done. Aux vars: {self.aux_cnt}", file=sys.stderr)

    def keystream_byte(self, byte_idx):
        bits = []
        for j in range(8):
            bits.append(self.clock(init_mode=False))
        return bits


def add_byte_constraint(solver, ks_bits, known_val):
    for j in range(8):
        bit = (known_val >> (7 - j)) & 1
        solver.add(ks_bits[j] == BoolVal(bool(bit)))


def main():
    print("=== Grain-128A Flat SAT Solver ===\n", file=sys.stderr)

    # X-Wing tag data
    payload_hex = "24d43e829f371f47ab8f3636426371d554f2b8f4c5b5afe910bf0083332f74f7ca47ef1ab079864" \
                  "14ececabd34f8daa679c64735bd10313c37f8dcdb4ad113bca30418026cadeb41c971ccaec1cddc" \
                  "92798e13259706a23d39e9d6f41e339bb2b9af46c222e8"
    payload = bytes.fromhex(payload_hex)
    iv = list(payload[:12])
    ct = list(payload[12:])

    # Known plaintext: TLV header + type_byte
    known_pt = [
        (0, 0x22),   # TLV type_id low
        (1, 0x00),   # TLV type_id high
        (2, 0x07),   # content_length low
        (3, 0x00),   # content_length high
        (10, 0x06),  # type_byte (item)
    ]

    # Known keystream bytes
    known_ks = [(off, ct[off] ^ pt_val) for off, pt_val in known_pt]

    solver = Solver()
    solver.set("timeout", 1800 * 1000)  # 30 min

    # 128 key bit variables
    key_vars = [Bool(f"k_{i}") for i in range(128)]

    print("Building X-Wing constraints...", file=sys.stderr)
    grain = FlatGrain128A(solver, key_vars, iv, "xw")
    grain.initialize()

    # Generate keystream and add constraints
    max_offset = max(off for off, _ in known_ks) + 1
    print(f"Generating {max_offset} keystream bytes...", file=sys.stderr)

    for byte_idx in range(max_offset):
        ks_bits = grain.keystream_byte(byte_idx)
        # Check if this byte has a known value
        for off, ks_val in known_ks:
            if off == byte_idx:
                print(f"  Constraining byte {byte_idx}: ks=0x{ks_val:02x}", file=sys.stderr)
                add_byte_constraint(solver, ks_bits, ks_val)

    print(f"\nTotal aux vars: {grain.aux_cnt}", file=sys.stderr)
    print(f"Starting solver...", file=sys.stderr)

    start = time.time()
    result = solver.check()
    elapsed = time.time() - start

    print(f"Result: {result} ({elapsed:.1f}s)", file=sys.stderr)

    if result == sat:
        model = solver.model()
        key_bytes = []
        for i in range(16):
            byte_val = 0
            for j in range(8):
                bit = model.evaluate(key_vars[i * 8 + j])
                if is_true(bit):
                    byte_val |= (1 << (7 - j))
            key_bytes.append(byte_val)
        print(f"\n*** KEY FOUND: {bytes(key_bytes).hex()} ***")
        print(f"Key: {' '.join(f'{b:02x}' for b in key_bytes)}")
    elif result == unknown:
        print("\nSolver timed out.")
        print("The flat encoding may still be too large for z3.")
        print("Consider using CryptoMiniSat with explicit DIMACS CNF.")
    else:
        print("\nUNSAT — constraints are inconsistent.")
        print("Plaintext offsets are likely wrong, or algorithm is not Grain-128A.")


if __name__ == "__main__":
    main()
