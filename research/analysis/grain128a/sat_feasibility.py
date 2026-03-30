#!/usr/bin/env python3
"""
SAT Feasibility Test: Can z3 recover a KNOWN Grain-128A key?

Test with progressively more init rounds (32, 64, 128, 256) and
measure solve time. This tells us if SAT is viable at all.
"""

import sys
import time
import subprocess
from z3 import *

def make_grain_solver(num_init_rounds, key_concrete, iv_concrete, num_ks_bytes):
    """Build a flat z3 model for Grain-128A with given init rounds.
    Returns (solver, key_vars, expected_ks_bytes)."""

    # First, compute the actual keystream with C implementation
    # We'll do it in Python to stay self-contained

    def concrete_grain(key, iv, init_rounds, ks_bytes):
        """Pure Python Grain-128A — concrete (not symbolic)."""
        lfsr = []
        for b in iv:
            for j in range(7, -1, -1):
                lfsr.append((b >> j) & 1)
        lfsr += [1] * 31 + [0]

        nfsr = []
        for b in key:
            for j in range(7, -1, -1):
                nfsr.append((b >> j) & 1)

        def fb_lfsr():
            return lfsr[96] ^ lfsr[81] ^ lfsr[70] ^ lfsr[38] ^ lfsr[7] ^ lfsr[0]
        def fb_nfsr():
            return (nfsr[96] ^ nfsr[91] ^ nfsr[56] ^ nfsr[26] ^ nfsr[0] ^
                    (nfsr[84] & nfsr[68]) ^ (nfsr[67] & nfsr[3]) ^
                    (nfsr[65] & nfsr[61]) ^ (nfsr[59] & nfsr[27]) ^
                    (nfsr[48] & nfsr[40]) ^ (nfsr[18] & nfsr[17]) ^
                    (nfsr[13] & nfsr[11]) ^ (nfsr[82] & nfsr[78] & nfsr[70]) ^
                    (nfsr[25] & nfsr[24] & nfsr[22]) ^
                    (nfsr[95] & nfsr[93] & nfsr[92] & nfsr[88]))
        def h_fn():
            return ((nfsr[12] & lfsr[8]) ^ (lfsr[13] & lfsr[20]) ^
                    (nfsr[95] & lfsr[42]) ^ (lfsr[60] & lfsr[79]) ^
                    (nfsr[12] & nfsr[95] & lfsr[94]))
        def output():
            return (h_fn() ^ lfsr[93] ^ nfsr[2] ^ nfsr[15] ^ nfsr[36] ^
                    nfsr[45] ^ nfsr[64] ^ nfsr[73] ^ nfsr[89])
        def clock(init):
            lf = fb_lfsr(); nf = fb_nfsr(); y = output(); lo = lfsr[0]
            if init:
                nl = lf ^ y; nn = nf ^ lo ^ y
            else:
                nl = lf; nn = nf ^ lo
            lfsr.pop(0); lfsr.append(nl)
            nfsr.pop(0); nfsr.append(nn)
            return y

        for _ in range(init_rounds):
            clock(True)
        result = []
        for _ in range(ks_bytes):
            byte = 0
            for _ in range(8):
                byte = (byte << 1) | clock(False)
            result.append(byte)
        return result

    expected_ks = concrete_grain(key_concrete, iv_concrete, num_init_rounds, num_ks_bytes)

    # Now build symbolic model
    solver = Solver()
    solver.set("timeout", 120 * 1000)  # 2 min per test

    key_vars = [Bool(f"k_{i}") for i in range(128)]

    # IV bits (concrete)
    iv_bits = []
    for b in iv_concrete:
        for j in range(7, -1, -1):
            iv_bits.append(BoolVal(bool((b >> j) & 1)))

    lfsr = list(iv_bits) + [BoolVal(True)] * 31 + [BoolVal(False)]
    nfsr = list(key_vars)

    aux_cnt = [0]
    def aux():
        aux_cnt[0] += 1
        return Bool(f"a{aux_cnt[0]}")

    def xor2(a, b):
        r = aux(); solver.add(r == Xor(a, b)); return r
    def xor_multi(bits):
        if len(bits) == 1: return bits[0]
        if len(bits) == 2: return xor2(bits[0], bits[1])
        m = len(bits) // 2
        return xor2(xor_multi(bits[:m]), xor_multi(bits[m:]))
    def and2(a, b):
        r = aux(); solver.add(r == And(a, b)); return r
    def and3(a, b, c): return and2(a, and2(b, c))
    def and4(a, b, c, d): return and2(a, and3(b, c, d))

    def clock_sym(init, rd):
        nonlocal lfsr, nfsr
        lf = xor_multi([lfsr[96], lfsr[81], lfsr[70], lfsr[38], lfsr[7], lfsr[0]])
        nf_lin = xor_multi([nfsr[96], nfsr[91], nfsr[56], nfsr[26], nfsr[0]])
        nf_nl = xor_multi([
            and2(nfsr[84], nfsr[68]), and2(nfsr[67], nfsr[3]),
            and2(nfsr[65], nfsr[61]), and2(nfsr[59], nfsr[27]),
            and2(nfsr[48], nfsr[40]), and2(nfsr[18], nfsr[17]),
            and2(nfsr[13], nfsr[11]), and3(nfsr[82], nfsr[78], nfsr[70]),
            and3(nfsr[25], nfsr[24], nfsr[22]),
            and4(nfsr[95], nfsr[93], nfsr[92], nfsr[88]),
        ])
        nf = xor2(nf_lin, nf_nl)
        h = xor_multi([
            and2(nfsr[12], lfsr[8]), and2(lfsr[13], lfsr[20]),
            and2(nfsr[95], lfsr[42]), and2(lfsr[60], lfsr[79]),
            and3(nfsr[12], nfsr[95], lfsr[94]),
        ])
        y = xor_multi([h, lfsr[93], nfsr[2], nfsr[15], nfsr[36],
                        nfsr[45], nfsr[64], nfsr[73], nfsr[89]])
        lo = lfsr[0]
        if init:
            new_l = xor2(lf, y)
            new_n = xor_multi([nf, lo, y])
        else:
            new_l = lf
            new_n = xor2(nf, lo)

        lfsr = lfsr[1:] + [new_l]
        nfsr = nfsr[1:] + [new_n]

        # Periodically cut chains
        if rd % 16 == 0:
            nl = []
            for i in range(128):
                v = Bool(f"s{i}_r{rd}"); solver.add(v == lfsr[i]); nl.append(v)
            nn = []
            for i in range(128):
                v = Bool(f"n{i}_r{rd}"); solver.add(v == nfsr[i]); nn.append(v)
            lfsr = nl; nfsr = nn

        return y

    # Init rounds
    for r in range(num_init_rounds):
        clock_sym(True, r)

    # Keystream
    ks_bits = []
    for r in range(num_ks_bytes * 8):
        ks_bits.append(clock_sym(False, num_init_rounds + r))

    # Add constraints from known keystream
    for byte_idx in range(num_ks_bytes):
        for j in range(8):
            bit = (expected_ks[byte_idx] >> (7 - j)) & 1
            solver.add(ks_bits[byte_idx * 8 + j] == BoolVal(bool(bit)))

    return solver, key_vars, expected_ks, aux_cnt[0]


def main():
    key = [0x42, 0x13, 0x37, 0xDE, 0xAD, 0xBE, 0xEF, 0x00,
           0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]
    iv = [0x24, 0xD4, 0x3E, 0x82, 0x9F, 0x37, 0x1F, 0x47,
          0xAB, 0x8F, 0x36, 0x36]  # X-Wing IV

    print("=== Grain-128A SAT Feasibility Test ===")
    print(f"Key: {bytes(key).hex()}")
    print(f"IV:  {bytes(iv).hex()}")
    print(f"Known KS bytes: 5\n")

    for rounds in [32, 64, 128, 192, 256]:
        print(f"--- {rounds} init rounds ---")
        sys.stdout.flush()

        s, kv, expected_ks, n_aux = make_grain_solver(rounds, key, iv, 5)
        print(f"  Aux vars: {n_aux}, Expected KS: {bytes(expected_ks[:5]).hex()}")
        sys.stdout.flush()

        start = time.time()
        result = s.check()
        elapsed = time.time() - start

        if result == sat:
            model = s.model()
            recovered = []
            for i in range(16):
                b = 0
                for j in range(8):
                    if is_true(model.evaluate(kv[i*8+j])):
                        b |= (1 << (7-j))
                recovered.append(b)
            match = (recovered == key)
            print(f"  SAT in {elapsed:.1f}s — Key: {bytes(recovered).hex()} {'✓ CORRECT' if match else '✗ WRONG'}")
        elif result == unknown:
            print(f"  TIMEOUT ({elapsed:.1f}s)")
        else:
            print(f"  UNSAT ({elapsed:.1f}s) — BUG in encoding!")

        sys.stdout.flush()
        if elapsed > 120:
            print("\nStopping — solve time too long for higher rounds.")
            break


if __name__ == "__main__":
    main()
